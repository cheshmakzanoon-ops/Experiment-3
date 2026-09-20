import * as T from 'three';
import { clamp } from '../core/math.ts';
import { box, mesh } from './geometry.ts';
import { driverMaterials } from './driver-materials.ts';
import { buildGlove, buildDriverTorso, driverBodyPose, sleeveGeometry } from './driver-anatomy.ts';

/** Analytic two-bone IK in vehicle-local metres. The pole chooses the elbow's
 * bend plane. Unreachable targets are reported, not hidden by stretching bones. */
export class ArmPose {
  readonly elbow = new T.Vector3();
  readonly wrist = new T.Vector3();
  reachable = true;
  private axis = new T.Vector3();
  private bend = new T.Vector3();
  solve(shoulder: T.Vector3, target: T.Vector3, pole: T.Vector3, upper: number, lower: number) {
    if (!(upper > 0 && lower > 0) || !Number.isFinite(upper + lower))
      throw new Error('Invalid driver limb length');
    this.axis.copy(target).sub(shoulder);
    const requested = this.axis.length();
    if (!Number.isFinite(requested) || !Number.isFinite(pole.lengthSq()))
      throw new Error('Invalid driver joint position');
    const distance = clamp(requested, Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6);
    this.reachable = requested <= upper + lower && requested >= Math.abs(upper - lower);
    if (requested > 1e-8) this.axis.multiplyScalar(1 / requested);
    else this.axis.set(0, 0, 1);
    this.bend.copy(pole).sub(shoulder);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    if (this.bend.lengthSq() < 1e-10) {
      this.bend.set(0, -1, 0).addScaledVector(this.axis, this.axis.y);
      if (this.bend.lengthSq() < 1e-10)
        this.bend.set(1, 0, 0).addScaledVector(this.axis, -this.axis.x);
    }
    this.bend.normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const radius = Math.sqrt(Math.max(0, upper * upper - along * along));
    this.elbow.copy(shoulder).addScaledVector(this.axis, along).addScaledVector(this.bend, radius);
    this.wrist.copy(shoulder).addScaledVector(this.axis, distance);
    return this;
  }
}

/** Responds only to observed powertrain changes. Seeks/discontinuities establish
 * a new baseline and never manufacture dozens of paddle taps during replay. */
export class DriverActions {
  up = 0;
  down = 0;
  button = 0;
  private time = -1;
  private gear = 0;
  private mode = 0;
  sample(time: number, gear: number, mode: number) {
    if (![time, gear, mode].every(Number.isFinite)) throw new Error('Invalid driver action');
    const dt = time - this.time;
    if (this.time < 0 || dt < 0 || dt > 0.35) {
      this.up = this.down = this.button = 0;
    } else {
      this.up = Math.max(0, this.up - dt / 0.16);
      this.down = Math.max(0, this.down - dt / 0.16);
      this.button = Math.max(0, this.button - dt / 0.22);
      if (gear > this.gear) this.up = 1;
      else if (gear < this.gear) this.down = 1;
      if (mode !== this.mode) this.button = 1;
    }
    this.time = time;
    this.gear = gear;
    this.mode = mode;
  }
}

interface Arm {
  side: number;
  shoulder: T.Vector3;
  index: T.Group;
  pole: T.Vector3;
  hand: T.Group;
  upper: T.Mesh;
  lower: T.Mesh;
  elbow: T.Mesh;
  thumb: T.Group;
  paddle: T.Group;
  pose: ArmPose;
}
const UPPER = 0.37,
  LOWER = 0.36;
export class DriverRig {
  readonly root = new T.Group();
  readonly actions = new DriverActions();
  private readonly arms: Arm[] = [];
  readonly body = new T.Group();
  headRoll = 0;
  headPitch = 0;
  private bodyPose = { compression: 0, headRoll: 0, headPitch: 0 };
  private target = new T.Vector3();
  private delta = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);
  constructor(private steering: T.Group) {
    this.root.name = 'Articulated driver';
    const materials = driverMaterials();
    const { suit } = materials;
    this.body.name = 'Restrained driver torso';
    this.root.add(this.body);
    buildDriverTorso(this.body, materials);
    const paddleMaterial = new T.MeshStandardMaterial({
      color: 0x59646b,
      metalness: 0.7,
      roughness: 0.33,
    });
    for (const side of [-1, 1]) {
      const shoulder = new T.Vector3(side * 0.16, 0.015, -0.48);
      const pole = new T.Vector3(side * 0.24, -0.32, -0.23);
      const { root: hand, thumb, index } = buildGlove(side, materials);
      hand.position.set(side * 0.178, -0.009, -0.01);
      steering.add(hand);
      const paddle = new T.Group();
      paddle.name = side < 0 ? 'Upshift paddle' : 'Downshift paddle';
      paddle.position.set(side * 0.104, 0, 0.041);
      box(paddle, paddleMaterial, side * 0.017, 0, 0, 0.031, 0.087, 0.006);
      steering.add(paddle);
      const upper = mesh(this.root, sleeveGeometry(true), suit);
      const lower = mesh(this.root, sleeveGeometry(false), suit);
      const elbow = mesh(this.root, new T.SphereGeometry(0.045, 16, 12), suit);
      this.arms.push({
        side,
        shoulder,
        index,
        pole,
        hand,
        upper,
        lower,
        elbow,
        thumb,
        paddle,
        pose: new ArmPose(),
      });
    }
    this.update(0, 1, 1);
  }
  private segment(mesh: T.Mesh, from: T.Vector3, to: T.Vector3) {
    this.delta.copy(to).sub(from);
    const length = this.delta.length();
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      this.up,
      this.delta.multiplyScalar(1 / Math.max(length, 1e-8)),
    );
    mesh.scale.y = length;
  }
  update(time: number, gear: number, mode: number, lateralG = 0, longitudinalG = 0, verticalG = 1) {
    const pose = driverBodyPose(lateralG, longitudinalG, verticalG, this.bodyPose);
    this.body.scale.y = 1 - pose.compression;
    this.body.position.y = 0.015 * pose.compression;
    this.headRoll = pose.headRoll;
    this.headPitch = pose.headPitch;
    this.actions.sample(time, gear, mode);
    this.steering.updateMatrix();
    for (const arm of this.arms) {
      // Wrist is the cuff's car-local anchor, transformed by the actual wheel.
      this.target
        .copy(arm.hand.position)
        .add(this.delta.set(0, -0.043, -0.038))
        .applyMatrix4(this.steering.matrix);
      arm.pose.solve(arm.shoulder, this.target, arm.pole, UPPER, LOWER);
      this.segment(arm.upper, arm.shoulder, arm.pose.elbow);
      this.segment(arm.lower, arm.pose.elbow, arm.pose.wrist);
      arm.elbow.position.copy(arm.pose.elbow);
      const pull = arm.side < 0 ? this.actions.up : this.actions.down;
      arm.paddle.rotation.y = -arm.side * pull * 0.18;
      arm.index.position.z = pull * 0.0025;
      arm.thumb.rotation.z = arm.side * this.actions.button * 0.2;
    }
  }
  diagnostics() {
    return this.arms.map((arm) => ({
      side: arm.side,
      shoulder: arm.shoulder.toArray(),
      elbow: arm.pose.elbow.toArray(),
      wrist: arm.pose.wrist.toArray(),
      reachable: arm.pose.reachable,
      upperLength: arm.shoulder.distanceTo(arm.pose.elbow),
      lowerLength: arm.pose.elbow.distanceTo(arm.pose.wrist),
      paddleRadians: arm.paddle.rotation.y,
    }));
  }
}
