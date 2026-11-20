import * as T from 'three';
import { add, tube, type BikeMaterials } from './bike.ts';
import { gpRearBrakeAngle, GP_FOOTPEG_RADIUS } from './gp-rider-contact.ts';
import { GP_REARSET_PEG } from './gp-rearsets.ts';
import type { RiderDetail } from './rider.ts';

const X = new T.Vector3(1, 0, 0),
  UP = new T.Vector3(0, 1, 0);
const CAM_ARM = 0.064;
const pullPivot = new T.Vector3(-0.112, GP_REARSET_PEG[1] + GP_FOOTPEG_RADIUS, GP_REARSET_PEG[2]);
const pullEye = new T.Vector3(0, -0.039, 0.011);
function turning(profile: readonly (readonly [number, number])[], detail: RiderDetail) {
  return new T.LatheGeometry(
    profile.map(([r, x]) => new T.Vector2(r, x)),
    detail === 'high' ? 36 : detail === 'mid' ? 24 : 12,
  ).rotateZ(-Math.PI / 2);
}

/** The drum and its heat-dissipating ribs rotate around the fixed brake plate. */
export function classicDrum(detail: RiderDetail) {
  const p: [number, number][] = [
    [0.015, -0.05],
    [0.086, -0.05],
    [0.093, -0.047],
    [0.093, -0.04],
    [0.087, -0.038],
  ];
  if (detail !== 'far') {
    for (const x of [-0.031, -0.015, 0.001, 0.017]) {
      p.push([0.086, x], [0.095, x + 0.0018], [0.095, x + 0.0045], [0.085, x + 0.006]);
    }
  }
  p.push([0.083, 0.032], [0.072, 0.037], [0.044, 0.039], [0.016, 0.046]);
  return turning(p, detail);
}

/** An external cam opens the shoes inside the drum. Its steel pull rod has
 * a fixed length between a frame-mounted brake pedal and a swinging axle.
 * Solve the two circles in the swingarm plane at each recorded pose. */
export class ClassicRearBrake {
  readonly root = new T.Group();
  readonly lever = new T.Group();
  readonly rod: T.Mesh;
  readonly rodLength: number;
  readonly front = new T.Vector3();
  readonly back = new T.Vector3();
  private readonly inverse = new T.Matrix4();
  private readonly delta = new T.Vector3();
  constructor(
    arm: number,
    restAngle: number,
    pivot: T.Vector3,
    detail: RiderDetail,
    m: BikeMaterials,
  ) {
    this.root.name = 'Classic rear drum brake linkage';
    const plate = add(
      this.root,
      turning(
        [
          [0.016, -0.067],
          [0.041, -0.066],
          [0.054, -0.061],
          [0.083, -0.06],
          [0.089, -0.057],
          [0.089, -0.052],
        ],
        detail,
      ),
      m.aluminium,
      0,
      0,
      -arm,
    );
    plate.name = 'Fixed drum backing plate';
    this.lever.name = 'Drum operating cam';
    this.lever.position.set(-0.072, 0.023, -arm + 0.038);
    this.root.add(this.lever);
    add(this.lever, new T.CylinderGeometry(0.011, 0.011, 0.028, 10), m.steel).rotation.z =
      Math.PI / 2;
    add(
      this.lever,
      tube(
        [
          [0, 0, 0],
          [-0.016, -0.014, 0],
          [-0.039, -0.032, 0],
          [-0.04, -CAM_ARM, 0],
        ],
        0.0058,
        6,
        6,
      ),
      m.aluminium,
    );
    add(
      this.lever,
      new T.CylinderGeometry(0.0085, 0.0085, 0.016, 10),
      m.steel,
      -0.04,
      -CAM_ARM,
      0,
    ).rotation.z = Math.PI / 2;
    this.rod = add(
      this.root,
      new T.CylinderGeometry(0.0033, 0.0033, 1, detail === 'high' ? 8 : 5),
      m.steel,
    );
    this.rod.name = 'Rear brake pull rod';
    // The backing plate takes the braking torque through a stay to the arm.
    add(
      this.root,
      tube(
        [
          [-0.071, 0.065, -arm + 0.046],
          [-0.084, 0.077, -arm + 0.12],
          [-0.101, 0.055, -arm * 0.42],
        ],
        0.0066,
        5,
        6,
      ),
      m.steel,
    );
    const neutral = this.front
      .copy(pullEye)
      .add(pullPivot)
      .sub(pivot)
      .applyAxisAngle(X, -restAngle);
    this.back.copy(this.lever.position).add(new T.Vector3(-0.04, -CAM_ARM, 0));
    this.rodLength = neutral.distanceTo(this.back);
  }
  update(frame: T.Matrix4, swingarm: T.Matrix4, brake: number) {
    this.inverse.copy(swingarm).invert().multiply(frame);
    this.front
      .copy(pullEye)
      .applyAxisAngle(X, gpRearBrakeAngle(brake))
      .add(pullPivot)
      .applyMatrix4(this.inverse);
    const cam = this.lever.position;
    const dy = this.front.y - cam.y,
      dz = this.front.z - cam.z;
    const distance = Math.hypot(dy, dz);
    // This branch (below the cam spindle) is continuous through suspension
    // travel. The other circle intersection would turn the operating arm over.
    const along = T.MathUtils.clamp(
      (CAM_ARM ** 2 + distance ** 2 - this.rodLength ** 2) / (2 * distance),
      -CAM_ARM,
      CAM_ARM,
    );
    const across = Math.sqrt(Math.max(0, CAM_ARM ** 2 - along ** 2));
    const y = (along * dy - across * dz) / distance,
      z = (along * dz + across * dy) / distance;
    this.lever.rotation.x = Math.atan2(-z, -y);
    this.back.set(cam.x - 0.04, cam.y + y, cam.z + z);
    this.delta.subVectors(this.front, this.back);
    this.rod.position.copy(this.back).lerp(this.front, 0.5);
    this.rod.scale.y = this.delta.length();
    this.rod.quaternion.setFromUnitVectors(UP, this.delta.normalize());
  }
}
