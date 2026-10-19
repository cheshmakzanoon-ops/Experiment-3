import { Quat, Vec3 } from '../core/math.ts';
import type { RigidBody } from './rigid.ts';

/** Convex chassis proxy in metres. Orientation follows the full rigid body,
 * not just yaw. Wheels and wings remain a fidelity boundary of this proxy. */
export class ChassisBox {
  readonly axes = [new Vec3(), new Vec3(), new Vec3()];
  half: readonly number[] = [0.94, 0.38, 2.5];
  readonly center = new Vec3();
  readonly orientation = new Quat();
  minX = 0;
  maxX = 0;
  update(body: RigidBody) {
    this.center.copy(body.position);
    this.orientation.x = body.orientation.x;
    this.orientation.y = body.orientation.y;
    this.orientation.z = body.orientation.z;
    this.orientation.w = body.orientation.w;
    this.updateAxes();
    return this;
  }
  copy(box: ChassisBox) {
    this.half = box.half;
    this.center.copy(box.center);
    this.orientation.x = box.orientation.x;
    this.orientation.y = box.orientation.y;
    this.orientation.z = box.orientation.z;
    this.orientation.w = box.orientation.w;
    this.updateAxes();
    return this;
  }
  /** Linear centre travel and shortest-arc quaternion interpolation. The
   * original force integrator owns the endpoints; this is a substep path. */
  interpolate(a: ChassisBox, b: ChassisBox, fraction: number) {
    this.half = a.half;
    const qa = a.orientation,
      qb = b.orientation,
      q = this.orientation;
    const dot = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w,
      sign = dot < 0 ? -1 : 1,
      cosine = Math.min(1, Math.abs(dot));
    let wa = 1 - fraction,
      wb = fraction;
    if (cosine < 1) {
      const angle = Math.acos(cosine),
        sine = Math.sin(angle);
      wa = Math.sin((1 - fraction) * angle) / sine;
      wb = Math.sin(fraction * angle) / sine;
    }
    wb *= sign;
    q.x = qa.x * wa + qb.x * wb;
    q.y = qa.y * wa + qb.y * wb;
    q.z = qa.z * wa + qb.z * wb;
    q.w = qa.w * wa + qb.w * wb;
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    q.x /= length;
    q.y /= length;
    q.z /= length;
    q.w /= length;
    this.center.set(
      a.center.x + (b.center.x - a.center.x) * fraction,
      a.center.y + (b.center.y - a.center.y) * fraction,
      a.center.z + (b.center.z - a.center.z) * fraction,
    );
    this.updateAxes();
    return this;
  }
  rotationTo(box: ChassisBox) {
    const a = this.orientation,
      b = box.orientation;
    return 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));
  }
  /** World rotation vector for the same shortest arc, in radians. */
  rotationVectorTo(box: ChassisBox, out: Vec3) {
    const a = this.orientation,
      b = box.orientation,
      dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w,
      sign = dot < 0 ? -1 : 1;
    out.set(
      sign * (b.x * a.w - b.w * a.x - b.y * a.z + b.z * a.y),
      sign * (b.y * a.w - b.w * a.y + b.x * a.z - b.z * a.x),
      sign * (b.z * a.w - b.w * a.z - b.x * a.y + b.y * a.x),
    );
    const sine = out.length();
    return sine > 1e-12
      ? out.scale((2 * Math.atan2(sine, Math.abs(dot))) / sine)
      : out.set(0, 0, 0);
  }
  private updateAxes() {
    for (let i = 0; i < 3; i++)
      this.orientation.rotate(
        this.axes[i].set(Number(i === 0), Number(i === 1), Number(i === 2)),
        this.axes[i],
      );
    const radius =
      Math.abs(this.axes[0].x) * this.half[0] +
      Math.abs(this.axes[1].x) * this.half[1] +
      Math.abs(this.axes[2].x) * this.half[2];
    this.minX = this.center.x - radius;
    this.maxX = this.center.x + radius;
  }
  radius(n: Vec3) {
    return (
      Math.abs(this.axes[0].dot(n)) * this.half[0] +
      Math.abs(this.axes[1].dot(n)) * this.half[1] +
      Math.abs(this.axes[2].dot(n)) * this.half[2]
    );
  }
  support(n: Vec3, out: Vec3) {
    out.copy(this.center);
    for (let i = 0; i < 3; i++) {
      const d = this.axes[i].dot(n);
      if (Math.abs(d) > 1e-7) out.addScaled(this.axes[i], Math.sign(d) * this.half[i]);
    }
    return out;
  }
}

/** All 15 separating axes: three faces per box and nine edge cross-products.
 * Scratch storage belongs to this query instance and is reused each solve. */
export class BoxContact {
  readonly normal = new Vec3();
  readonly point = new Vec3();
  depth = 0;
  private axis = new Vec3();
  private delta = new Vec3();
  private aPoint = new Vec3();
  private bPoint = new Vec3();
  intersect(a: ChassisBox, b: ChassisBox): boolean {
    this.delta.copy(a.center).sub(b.center);
    this.depth = Infinity;
    for (let k = 0; k < 15; k++) {
      if (k < 3) this.axis.copy(a.axes[k]);
      else if (k < 6) this.axis.copy(b.axes[k - 3]);
      else this.axis.cross(a.axes[Math.floor((k - 6) / 3)], b.axes[(k - 6) % 3]);
      const magnitude = this.axis.length();
      if (magnitude < 1e-7) continue;
      this.axis.scale(1 / magnitude);
      const distance = this.delta.dot(this.axis);
      const overlap = a.radius(this.axis) + b.radius(this.axis) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < this.depth) {
        this.depth = overlap;
        this.normal.copy(this.axis).scale(distance < 0 ? -1 : 1);
      }
    }
    this.contactPoint(a, b);
    return Number.isFinite(this.depth);
  }
  /** Greatest separating-axis gap. Positive is a conservative lower bound
   * on separation; negative is overlap. The normal points from B toward A. */
  separation(a: ChassisBox, b: ChassisBox) {
    this.delta.copy(a.center).sub(b.center);
    let gap = -Infinity;
    for (let k = 0; k < 15; k++) {
      if (k < 3) this.axis.copy(a.axes[k]);
      else if (k < 6) this.axis.copy(b.axes[k - 3]);
      else this.axis.cross(a.axes[Math.floor((k - 6) / 3)], b.axes[(k - 6) % 3]);
      const magnitude = this.axis.length();
      if (magnitude < 1e-7) continue;
      this.axis.scale(1 / magnitude);
      const distance = this.delta.dot(this.axis),
        candidate = Math.abs(distance) - a.radius(this.axis) - b.radius(this.axis);
      if (candidate > gap) {
        gap = candidate;
        this.normal.copy(this.axis).scale(distance < 0 ? -1 : 1);
      }
    }
    this.depth = -gap;
    this.contactPoint(a, b);
    return gap;
  }
  private contactPoint(a: ChassisBox, b: ChassisBox) {
    a.support(this.axis.copy(this.normal).scale(-1), this.aPoint);
    b.support(this.normal, this.bPoint);
    this.point.copy(this.aPoint).add(this.bPoint).scale(0.5);
    // Face-centre support points are clamped into the overlap along each box
    // tangent; this avoids applying aligned contacts at an arbitrary corner.
    for (let boxIndex = 0; boxIndex < 2; boxIndex++) {
      const box = boxIndex === 0 ? a : b;
      this.delta.copy(this.point).sub(box.center);
      for (let i = 0; i < 3; i++) {
        if (Math.abs(box.axes[i].dot(this.normal)) > 0.95) continue;
        const along = this.delta.dot(box.axes[i]);
        const excess = Math.max(0, Math.abs(along) - box.half[i]);
        if (excess) this.point.addScaled(box.axes[i], -Math.sign(along) * excess);
      }
    }
  }
}

/** Bounded conservative advancement between two integrated endpoint poses.
 * Rotation contributes angle * bounding radius to the closing-speed bound.
 * An exhausted query is explicit; it must not be described as a proven miss. */
export class SweptBoxContact {
  readonly normal = new Vec3();
  readonly point = new Vec3();
  fraction = Infinity;
  iterations = 0;
  exhausted = false;
  private a = new ChassisBox();
  private b = new ChassisBox();
  private contact = new BoxContact();
  private relative = new Vec3();
  private rotationA = new Vec3();
  private rotationB = new Vec3();
  private arm = new Vec3();
  private motionA = new Vec3();
  private motionB = new Vec3();
  intersect(startA: ChassisBox, endA: ChassisBox, startB: ChassisBox, endB: ChassisBox) {
    this.fraction = Infinity;
    this.iterations = 0;
    this.exhausted = false;
    this.relative.copy(endA.center).sub(startA.center).sub(endB.center).add(startB.center);
    startA.rotationVectorTo(endA, this.rotationA);
    startB.rotationVectorTo(endB, this.rotationB);
    const angularBound =
      this.rotationA.length() * Math.hypot(...startA.half) +
      this.rotationB.length() * Math.hypot(...startB.half);
    let fraction = 0;
    for (let iteration = 0; iteration < 80; iteration++) {
      this.iterations = iteration + 1;
      this.a.interpolate(startA, endA, fraction);
      this.b.interpolate(startB, endB, fraction);
      const gap = this.contact.separation(this.a, this.b);
      if (gap <= 1e-5) {
        // Existing contact belongs to the endpoint solver unless its actual
        // interpolated contact-point motion is approaching. This includes
        // touching/shallow-overlap starts that could otherwise cross fully.
        if (fraction === 0 && !this.approachingStart(startA, endA, startB, endB)) return false;
        this.fraction = fraction;
        this.normal.copy(this.contact.normal);
        this.point.copy(this.contact.point);
        return true;
      }
      const closing = -this.relative.dot(this.contact.normal) + angularBound;
      if (!(closing > 0)) return false;
      const next = fraction + gap / closing;
      if (next > 1) return false;
      if (!(next > fraction)) {
        this.exhausted = true;
        return false;
      }
      fraction = next;
    }
    this.exhausted = true;
    return false;
  }
  private approachingStart(a: ChassisBox, endA: ChassisBox, b: ChassisBox, endB: ChassisBox) {
    this.arm.copy(this.contact.point).sub(a.center);
    this.motionA.cross(this.rotationA, this.arm).add(endA.center).sub(a.center);
    this.arm.copy(this.contact.point).sub(b.center);
    this.motionB.cross(this.rotationB, this.arm).add(endB.center).sub(b.center);
    return this.motionA.sub(this.motionB).dot(this.contact.normal) < -1e-9;
  }
}
