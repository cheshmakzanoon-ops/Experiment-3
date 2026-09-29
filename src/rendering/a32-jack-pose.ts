import * as T from 'three';
import manifest from './a32-pit-jacks.manifest.json' with { type: 'json' };

export type JackRole = 'front' | 'rear';
export type JackPoint = readonly [number, number, number];
export interface PitJackFits {
  front: JackPoint;
  rear: JackPoint;
  source: 'supplied-player' | 'authored-rival' | 'legacy-prototype';
}
const UNIT = new T.Vector3(1, 1, 1);
const X = new T.Vector3(1, 0, 0);
const Y = new T.Vector3(0, 1, 0);

/** A rigid lever and a counter-rotating saddle. Floor, target and parts are
 * car-local. Solve from the presented snapshot, never integrate a frame delta.
 * The chassis rolls along the ground to cancel the lift arm's horizontal arc.
 * Only the car-contact target comes from the car: the prop never changes physics. */
export class A32JackPose {
  readonly root = new T.Matrix4();
  readonly parts = Array.from({ length: 4 }, () => new T.Matrix4());
  readonly contact = new T.Vector3();
  readonly grips = [new T.Vector3(), new T.Vector3()] as const;
  readonly wheels = [new T.Vector3(), new T.Vector3()] as const;
  readonly handOrientation = new T.Quaternion();
  private readonly pivot = new T.Vector3();
  private readonly position = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly local = new T.Matrix4();
  angle = 0;
  wheelAngle = 0;
  /** The contact point is on the top of the pad, not at its underside origin. */
  set(role: JackRole, target: JackPoint, floorY: number): this {
    const spec = manifest.kinematics[role];
    if (!spec || target.length !== 3 || !target.every(Number.isFinite) || !Number.isFinite(floorY))
      throw new Error('Invalid A32 contact or ground');
    const sine = (target[1] - floorY - spec.pivot[1] - spec.padTop) / spec.length;
    if (sine < -0.06 || sine > Math.sin(spec.maxAngle) + 1e-7)
      throw new Error('A32 contact is outside the authored lift range');
    this.angle = Math.asin(sine);
    const yaw = role === 'front' ? Math.PI : 0;
    const direction = role === 'front' ? -1 : 1;
    const reach = spec.length * Math.cos(this.angle);
    this.handOrientation.setFromAxisAngle(Y, yaw);
    this.position.set(target[0], floorY, target[2] - direction * reach);
    this.root.compose(this.position, this.handOrientation, UNIT);
    this.parts[0].copy(this.root);
    this.rotation.setFromAxisAngle(X, -this.angle);
    this.local.compose(this.pivot.fromArray(spec.pivot), this.rotation, UNIT);
    this.parts[1].multiplyMatrices(this.root, this.local);
    // The pad has its own hinge: keep its top horizontal while the fork turns.
    this.pivot.set(0, 0, spec.length).applyQuaternion(this.rotation);
    this.pivot.y += spec.pivot[1];
    this.local.makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z);
    this.parts[2].multiplyMatrices(this.root, this.local);
    this.contact.set(0, spec.padTop, 0).applyMatrix4(this.parts[2]);
    // Exact distance relative to the horizontal rest pose, not accumulated roll.
    this.wheelAngle = -(spec.length - reach) / spec.wheelRadius;
    this.local.compose(
      this.pivot.fromArray(spec.wheelPivot),
      this.rotation.setFromAxisAngle(X, this.wheelAngle),
      UNIT,
    );
    this.parts[3].multiplyMatrices(this.root, this.local);
    for (let hand = 0; hand < 2; hand++) {
      this.grips[hand]
        .set(((hand === 0 ? -1 : 1) * spec.gripSpacing) / 2, spec.grip[1], spec.grip[2])
        .applyMatrix4(this.parts[1]);
      this.wheels[hand]
        .set(((hand === 0 ? -1 : 1) * spec.width) / 2, 0, spec.wheelPivot[2])
        .applyMatrix4(this.root);
    }
    return this;
  }
}
