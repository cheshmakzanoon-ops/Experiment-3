import { PitComposition } from './pit-presentation.ts';
import { Quaternion, Vector3 } from 'three';
import { vehicleAt } from '../simulation/vehicles.ts';
import { F, H, R, RACE_BASE, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';

/** Read-only composition of real nearby competitors. No car teleports, hidden
 * opponents, altered race state, or fabricated cinematic events. */
export class RaceComposition {
  readonly target = new Vector3();
  readonly velocity = new Vector3();
  radius = 3.1;
  kind: 'single' | 'battle' | 'pack' | 'pit' | 'finish' | 'grid' = 'single';
  participants: number[] = [];
  private readonly pit = new PitComposition();
  private positions: Vector3[] = Array.from({ length: 12 }, () => new Vector3());
  private readonly carOrientation = new Quaternion();
  private readonly carProbes = Array.from({ length: 8 }, () => new Vector3());
  private readonly moving = {
    moving: true,
    anchor: new Vector3(),
    points: [] as Vector3[],
    maxDistance: 430,
  };
  get visibility() {
    if (this.moving.points.length) return this.moving;
    return this.kind === 'pit' && this.pit.active ? this.pit.visibility : undefined;
  }
  reset() {
    this.participants = [];
    this.moving.points.length = 0;
    this.radius = 3.1;
    this.kind = 'single';
  }
  /** `subjectRadius`: the bounding sphere of one complete participant
   * (3.1 m: a car; a GP motorcycle and rider is smaller). */
  update(frame: Float32Array, followed: number, subjectRadius = 3.1, observeFormula = false) {
    this.moving.points.length = 0;
    if (!Number.isFinite(subjectRadius) || subjectRadius <= 0)
      throw new Error('Invalid composition subject radius');
    const count = frame[H.CARS];
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 12 ||
      !Number.isInteger(followed) ||
      followed < 0 ||
      followed >= count ||
      frame.length < HEADER + count * CAR_STRIDE
    )
      throw new Error('Invalid composition frame');
    const o = carBase(followed);
    const finiteFields = [F.X, F.Y, F.Z, F.VX, F.VY, F.VZ, F.SPEED];
    for (let id = 0; id < count; id++)
      for (const field of finiteFields)
        if (!Number.isFinite(frame[carBase(id) + field]))
          throw new Error('Non-finite composition participant');
    const anchor = this.positions[followed].set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
    this.target.copy(anchor);
    this.velocity.set(frame[o + F.VX], frame[o + F.VY], frame[o + F.VZ]);
    this.radius = subjectRadius;
    const previous = new Set(this.participants);
    this.participants = [followed];
    this.kind = frame[o + F.IN_PIT]
      ? 'pit'
      : frame[o + F.FINISH]
        ? 'finish'
        : frame[H.PHASE] < 2
          ? 'grid'
          : 'single';
    if (this.kind === 'pit') {
      this.radius = this.pit.apply(frame, o, this.target);
      return this;
    }
    if (frame[o + F.RETIRED]) return this;
    const leave = observeFormula ? 21 : 14;
    const join = observeFormula ? 16 : 10;
    let totalWeight = 1;
    const selected: { id: number; distance: number; weight: number }[] = [];
    for (let id = 0; id < count; id++) {
      if (id === followed) continue;
      const b = carBase(id);
      if (frame[b + F.RETIRED] || frame[b + F.IN_PIT]) continue;
      const p = this.positions[id].set(frame[b + F.X], frame[b + F.Y], frame[b + F.Z]);
      const distance = p.distanceTo(anchor);
      if (distance >= (previous.has(id) ? leave : join) || Math.abs(p.y - anchor.y) > 2.5) continue;
      const vx = frame[b + F.VX],
        vz = frame[b + F.VZ],
        playerSpeed = Math.hypot(frame[o + F.VX], frame[o + F.VZ]),
        otherSpeed = Math.hypot(vx, vz);
      // Opposite directions and overlapping bridges are not racing battles.
      if (
        playerSpeed > 3 &&
        otherSpeed > 3 &&
        (vx * frame[o + F.VX] + vz * frame[o + F.VZ]) / (playerSpeed * otherSpeed) < 0.4
      )
        continue;
      const t = Math.max(0, Math.min(1, (leave - distance) / (leave * 0.5))),
        weight = t * t * (3 - 2 * t);
      selected.push({ id, distance, weight });
    }
    selected.sort((a, b) => a.distance - b.distance || a.id - b.id);
    // The protocol already bounds the field to twelve cars. Truncating to the
    // nearest three rivals both cropped dense packs and changed the optical
    // subject abruptly when two rivals traded distance order.
    for (const { id, weight } of selected) {
      const b = carBase(id);
      this.target.addScaledVector(this.positions[id], weight);
      this.velocity.x += frame[b + F.VX] * weight;
      this.velocity.y += frame[b + F.VY] * weight;
      this.velocity.z += frame[b + F.VZ] * weight;
      totalWeight += weight;
      this.participants.push(id);
    }
    this.target.multiplyScalar(1 / totalWeight);
    this.velocity.multiplyScalar(1 / totalWeight);
    // A true bounding sphere centred at the composed target, not a distance
    // heuristic around just the player. Every selected complete car must fit.
    for (const id of this.participants)
      this.radius = Math.max(
        this.radius,
        this.positions[id].distanceTo(this.target) + subjectRadius,
      );
    if (this.kind === 'single' && this.participants.length > 1)
      this.kind = this.participants.length > 2 ? 'pack' : 'battle';
    if (observeFormula) {
      this.moving.anchor.copy(anchor);
      const w = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])).wheelPositions;
      this.carOrientation
        .set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW])
        .normalize();
      // The head can see a car's CG past a bridge support while losing a wing,
      // both front wheels, or its opponent. Sample the actual racing envelope.
      for (let i = 0; i < 4; i++) {
        const [x, , z] = w[i];
        this.moving.points.push(
          this.carProbes[i].set(x, -0.08, z).applyQuaternion(this.carOrientation).add(anchor),
        );
      }
      this.moving.points.push(
        this.carProbes[4]
          .set(0, 0.48, w[2][2] - 0.5)
          .applyQuaternion(this.carOrientation)
          .add(anchor),
      );
      this.moving.points.push(
        this.carProbes[5]
          .set(0, -0.16, w[0][2] + 0.55)
          .applyQuaternion(this.carOrientation)
          .add(anchor),
      );
      for (let i = 0; i < Math.min(2, selected.length); i++)
        this.moving.points.push(this.carProbes[6 + i].copy(this.positions[selected[i].id]));
    }
    return this;
  }
  diagnostics() {
    return {
      kind: this.kind,
      participants: [...this.participants],
      radius: this.radius,
      target: this.target.toArray(),
    };
  }
}
