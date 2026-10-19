import { ChassisBox, BoxContact, SweptBoxContact } from './obb.ts';
import { clamp, mod, Vec3 } from '../core/math.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';
/** Scratch state is owned per collision solver, not by a mutable module singleton. */
export class CollisionSolver {
  private n = new Vec3();
  private boxes: ChassisBox[] = [];
  private starts: ChassisBox[] = [];
  private captured: Vehicle[] = [];
  private capturedSpeed: number[] = [];
  private capturedSpin: number[] = [];
  private sweepEligible: boolean[] = [];
  private sweepMinX: number[] = [];
  private sweepMaxX: number[] = [];
  private pendingSweep = false;
  private order: number[] = [];
  private contact = new BoxContact();
  private sweep = new SweptBoxContact();
  private sweepNormal = new Vec3();
  private sweepPoint = new Vec3();
  private endA = new Vec3();
  private endB = new Vec3();
  private speedA = new Vec3();
  private speedB = new Vec3();
  private corner = new Vec3();
  private rA = new Vec3();
  private rB = new Vec3();
  private vA = new Vec3();
  private vB = new Vec3();
  private cross = new Vec3();
  private inertia = new Vec3();
  private point = new Vec3();
  private trackPos = trackPoint();
  /** Per-solve diagnostics for physics verification and profiling. */
  sweptContacts = 0;
  sweepQueries = 0;
  sweepIterationLimits = 0;
  sweepLimitReached = false;

  /** Capture immediately before a physics substep. Recovery/placement before
   * this call starts a new path, so teleporting a car cannot hit everything
   * between its previous and new positions. A capture is consumed once. */
  beginStep(cars: Vehicle[]) {
    while (this.starts.length < cars.length) this.starts.push(new ChassisBox());
    this.captured.length = cars.length;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      this.captured[i] = car;
      this.starts[i].half = car.definition.halfExtents;
      this.starts[i].update(car.body);
      this.capturedSpeed[i] = car.body.velocity.length();
      this.capturedSpin[i] = car.body.omega.length();
    }
    this.pendingSweep = true;
  }
  impulse(a: Vehicle, b: Vehicle | null, contact: Vec3, normal: Vec3, penetration: number) {
    const { rA, rB, vA, vB, cross, inertia } = this,
      A = a.body,
      B = b?.body;
    A.pointVelocity(contact, vA);
    if (B) B.pointVelocity(contact, vB);
    else vB.set(0, 0, 0);
    vA.sub(vB);
    const vn = vA.dot(normal),
      inverseMass = 1 / A.mass + (B ? 1 / B.mass : 0);
    rA.copy(contact).sub(A.position);
    cross.cross(rA, normal);
    A.inverseInertia(cross, inertia);
    let denominator = inverseMass + inertia.dot(cross);
    if (B) {
      rB.copy(contact).sub(B.position);
      cross.cross(rB, normal);
      B.inverseInertia(cross, inertia);
      denominator += inertia.dot(cross);
    }
    if (vn < 0) {
      const j = (-1.08 * vn) / denominator;
      A.velocity.addScaled(normal, j / A.mass);
      cross.cross(rA, normal).scale(j);
      A.inverseInertia(cross, inertia);
      A.omega.add(inertia);
      if (B) {
        B.velocity.addScaled(normal, -j / B.mass);
        cross.cross(rB, normal).scale(-j);
        B.inverseInertia(cross, inertia);
        B.omega.add(inertia);
      }
      // Recompute tangential relative velocity after the normal impulse.
      // Friction has rotational effective mass and angular impulse too.
      A.pointVelocity(contact, vA);
      if (B) B.pointVelocity(contact, vB);
      else vB.set(0, 0, 0);
      vA.sub(vB).addScaled(normal, -vA.dot(normal));
      const speed = vA.length();
      if (speed > 1e-5) {
        vA.scale(1 / speed);
        cross.cross(rA, vA);
        A.inverseInertia(cross, inertia);
        let tangentMass = inverseMass + inertia.dot(cross);
        if (B) {
          cross.cross(rB, vA);
          B.inverseInertia(cross, inertia);
          tangentMass += inertia.dot(cross);
        }
        const jt = Math.min(j * 0.3, speed / tangentMass);
        A.velocity.addScaled(vA, -jt / A.mass);
        cross.cross(rA, vA).scale(-jt);
        A.inverseInertia(cross, inertia);
        A.omega.add(inertia);
        if (B) {
          B.velocity.addScaled(vA, jt / B.mass);
          cross.cross(rB, vA).scale(jt);
          B.inverseInertia(cross, inertia);
          B.omega.add(inertia);
        }
      }
      const energy = (0.5 * vn * vn) / denominator;
      a.impactAt(energy, contact);
      if (b) b.impactAt(energy, contact);
    }
    const correction = (Math.max(0, penetration - 0.004) * 0.48) / inverseMass;
    A.position.addScaled(normal, correction / A.mass);
    if (B) B.position.addScaled(normal, -correction / B.mass);
  }
  solve(cars: Vehicle[], track: Track, dt = 0) {
    const { n, point, trackPos } = this;
    this.sweptContacts = 0;
    this.sweepQueries = 0;
    this.sweepIterationLimits = 0;
    this.sweepLimitReached = false;
    while (this.boxes.length < cars.length) this.boxes.push(new ChassisBox());
    if (this.order.length !== cars.length) this.order = cars.map((_, i) => i);
    for (let i = 0; i < cars.length; i++) {
      this.boxes[i].half = cars[i].definition.halfExtents;
      this.boxes[i].update(cars[i].body);
    }
    if (
      this.pendingSweep &&
      Number.isFinite(dt) &&
      dt > 0 &&
      this.captured.length === cars.length &&
      cars.every((car, i) => this.captured[i] === car)
    )
      this.solveSwept(cars, dt);
    this.pendingSweep = false;
    for (let i = 0; i < cars.length; i++) {
      this.sweepMinX[i] = this.boxes[i].minX;
      this.sweepMaxX[i] = this.boxes[i].maxX;
    }
    // Sweep-and-prune broad phase; stable ID tie-break makes ordering repeatable.
    this.order.sort((a, b) => this.sweepMinX[a] - this.sweepMinX[b] || cars[a].id - cars[b].id);
    for (let k = 0; k < cars.length; k++) {
      const i = this.order[k],
        a = cars[i],
        A = this.boxes[i];
      for (let l = k + 1; l < cars.length; l++) {
        const j = this.order[l],
          B = this.boxes[j];
        // Frozen candidate extents keep depenetration from invalidating the
        // sort order and its early-out within this pass.
        if (this.sweepMinX[j] > this.sweepMaxX[i]) break;
        if (this.contact.intersect(A, B)) {
          this.impulse(a, cars[j], this.contact.point, this.contact.normal, this.contact.depth);
          A.update(a.body);
          B.update(cars[j].body);
        }
      }
    }
    for (const a of cars) {
      let deepest = 0;
      // Probe chassis corners, not just its centre, against track barriers.
      for (let side = -1; side <= 1; side += 2)
        for (let end = -1; end <= 1; end += 2) {
          a.body.orientation
            .rotate(
              this.corner.set(
                side * a.definition.halfExtents[0],
                0,
                end * a.definition.halfExtents[2],
              ),
              this.corner,
            )
            .add(a.body.position);
          let lateral = track.nearest(this.corner.x, this.corner.z, trackPos, this.corner.y);
          // Stadium rhythm lanes are close enough that a chassis corner can
          // be nearer the next lane while the bike is still on this one.
          // That lane's opposite-facing wall would push it farther out. Keep
          // the usual exact projection unless it leaves the bike's local
          // course neighbourhood, then project only around its own station.
          if (track.circuit.offroad && a.definition.bike?.offroad) {
            const reach = Math.max(
              4,
              3 * Math.hypot(a.definition.halfExtents[0], a.definition.halfExtents[2]),
            );
            const distance =
              mod(trackPos.s - a.s + track.length / 2, track.length) - track.length / 2;
            if (Math.abs(distance) > reach) {
              let along = 0;
              for (let i = 0; i < 3; i++) {
                track.at(a.s + along, trackPos);
                const step =
                  (this.corner.x - trackPos.x) * trackPos.tx +
                  (this.corner.z - trackPos.z) * trackPos.tz;
                along = clamp(along + step, -reach, reach);
              }
              track.at(a.s + along, trackPos);
              lateral =
                (this.corner.x - trackPos.x) * trackPos.nx +
                (this.corner.z - trackPos.z) * trackPos.nz;
            }
          }
          const boundary = track.boundaryAt(trackPos, Math.sign(lateral));
          const penetration = Math.abs(lateral) - boundary;
          if (penetration > deepest) {
            deepest = penetration;
            n.set(-trackPos.nx * Math.sign(lateral), 0, -trackPos.nz * Math.sign(lateral));
            point.copy(this.corner);
          }
        }
      if (deepest > 0) this.impulse(a, null, point, n, deepest);
    }
  }

  private solveSwept(cars: Vehicle[], dt: number) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i],
        start = this.starts[i],
        end = this.boxes[i],
        travel = Math.sqrt(start.center.distanceSq(end.center)),
        speed = Math.max(this.capturedSpeed[i], car.body.velocity.length()),
        spin = Math.max(this.capturedSpin[i], car.body.omega.length());
      // Resets inside an adapter step have no physical velocity connecting
      // their poses. The allowance admits small contact/suspension corrections.
      this.sweepEligible[i] =
        travel <= speed * dt + 0.05 && start.rotationTo(end) <= spin * dt + 0.05;
    }
    let remaining = dt;
    const eventBudget = Math.max(8, cars.length * 2);
    for (let event = 0; event < eventBudget; event++) {
      for (let i = 0; i < cars.length; i++) {
        const start = this.starts[i],
          end = this.boxes[i],
          radius = Math.hypot(...start.half);
        // A centre segment expanded by the bounding sphere also contains
        // every intermediate rotation outside the two endpoint AABBs.
        this.sweepMinX[i] = Math.min(start.center.x, end.center.x) - radius;
        this.sweepMaxX[i] = Math.max(start.center.x, end.center.x) + radius;
      }
      this.order.sort((a, b) => this.sweepMinX[a] - this.sweepMinX[b] || cars[a].id - cars[b].id);
      let fraction = Infinity,
        first = -1,
        second = -1;
      for (let k = 0; k < cars.length; k++) {
        const i = this.order[k];
        if (!this.sweepEligible[i]) continue;
        for (let l = k + 1; l < cars.length; l++) {
          const j = this.order[l];
          if (this.sweepMinX[j] > this.sweepMaxX[i]) break;
          if (!this.sweepEligible[j] || !this.sweptBoundsOverlap(i, j)) continue;
          this.sweepQueries++;
          const hit = this.sweep.intersect(
            this.starts[i],
            this.boxes[i],
            this.starts[j],
            this.boxes[j],
          );
          if (this.sweep.exhausted) this.sweepIterationLimits++;
          if (hit && this.sweep.fraction < fraction && this.approachingAt(cars, i, j)) {
            fraction = this.sweep.fraction;
            first = i;
            second = j;
            this.sweepNormal.copy(this.sweep.normal);
            this.sweepPoint.copy(this.sweep.point);
          }
        }
      }
      if (first < 0) return;
      // Advance every candidate's geometric start to the same event time.
      // Forces were already integrated once; only the remaining positional
      // drift responds to this impulse. Rotation from the impulse drifts in
      // the next substep, retaining the integrated inertia orientation here.
      for (let i = 0; i < cars.length; i++)
        this.starts[i].interpolate(this.starts[i], this.boxes[i], fraction);
      remaining *= 1 - fraction;
      const a = cars[first],
        b = cars[second];
      this.endA.copy(a.body.position);
      this.endB.copy(b.body.position);
      this.speedA.copy(a.body.velocity);
      this.speedB.copy(b.body.velocity);
      a.body.position.copy(this.starts[first].center);
      b.body.position.copy(this.starts[second].center);
      this.impulse(a, b, this.sweepPoint, this.sweepNormal, 0);
      this.speedA.scale(-1).add(a.body.velocity);
      this.speedB.scale(-1).add(b.body.velocity);
      a.body.position.copy(this.endA).addScaled(this.speedA, remaining);
      b.body.position.copy(this.endB).addScaled(this.speedB, remaining);
      this.boxes[first].update(a.body);
      this.boxes[second].update(b.body);
      this.sweptContacts++;
      if (remaining <= 0) return;
    }
    this.sweepLimitReached = true;
  }
  private sweptBoundsOverlap(i: number, j: number) {
    const a = this.starts[i].center,
      endA = this.boxes[i].center,
      b = this.starts[j].center,
      endB = this.boxes[j].center,
      radius = Math.hypot(...this.starts[i].half) + Math.hypot(...this.starts[j].half);
    return (
      Math.min(a.y, endA.y) <= Math.max(b.y, endB.y) + radius &&
      Math.min(b.y, endB.y) <= Math.max(a.y, endA.y) + radius &&
      Math.min(a.z, endA.z) <= Math.max(b.z, endB.z) + radius &&
      Math.min(b.z, endB.z) <= Math.max(a.z, endA.z) + radius
    );
  }
  private approachingAt(cars: Vehicle[], i: number, j: number) {
    const t = this.sweep.fraction;
    this.rA
      .copy(this.boxes[i].center)
      .sub(this.starts[i].center)
      .scale(t)
      .add(this.starts[i].center);
    this.rB
      .copy(this.boxes[j].center)
      .sub(this.starts[j].center)
      .scale(t)
      .add(this.starts[j].center);
    this.rA.scale(-1).add(this.sweep.point);
    this.rB.scale(-1).add(this.sweep.point);
    this.vA.cross(cars[i].body.omega, this.rA).add(cars[i].body.velocity);
    this.vB.cross(cars[j].body.omega, this.rB).add(cars[j].body.velocity);
    // Previous events change velocity without repeating the force/rotation
    // integration. Reject geometrically rediscovered but separating contacts.
    return this.vA.sub(this.vB).dot(this.sweep.normal) < -1e-8;
  }
}
