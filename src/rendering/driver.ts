import * as T from 'three';
import { clamp } from '../core/math.ts';
import { box, mesh, mergeStatic, tube } from './geometry.ts';

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
  private target = new T.Vector3();
  private delta = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);
  constructor(private steering: T.Group) {
    this.root.name = 'Articulated driver';
    const suit = new T.MeshStandardMaterial({ color: 0x273d46, roughness: 0.94 });
    const glove = new T.MeshStandardMaterial({ color: 0xd8d4c5, roughness: 0.91 });
    const grip = new T.MeshStandardMaterial({ color: 0x222a2a, roughness: 0.97 });
    const stitch = new T.MeshStandardMaterial({ color: 0x928d7c, roughness: 1 });
    const paddleMaterial = new T.MeshStandardMaterial({
      color: 0x59646b,
      metalness: 0.7,
      roughness: 0.33,
    });
    for (const side of [-1, 1]) {
      const shoulder = new T.Vector3(side * 0.16, 0.015, -0.48);
      const pole = new T.Vector3(side * 0.24, -0.32, -0.23);
      const hand = new T.Group();
      hand.name = side < 0 ? 'Right glove' : 'Left glove';
      hand.position.set(side * 0.178, -0.009, -0.01);
      steering.add(hand);
      const palm = mesh(hand, new T.SphereGeometry(1, 20, 14), glove);
      palm.scale.set(0.031, 0.05, 0.026);
      const pad = mesh(hand, new T.SphereGeometry(1, 16, 12), grip, 0, -0.002, 0.017);
      pad.scale.set(0.025, 0.044, 0.016);
      const cuff = mesh(
        hand,
        new T.CylinderGeometry(0.028, 0.034, 0.05, 16),
        suit,
        0,
        -0.051,
        -0.022,
      );
      cuff.rotation.x = -0.8;
      for (let finger = 0; finger < 4; finger++) {
        const y = 0.028 - finger * 0.018;
        tube(
          hand,
          glove,
          [
            [side * 0.012, y, -0.022],
            [side * 0.033, y, -0.007],
            [side * 0.028, y - 0.002, 0.022],
            [side * 0.004, y - 0.004, 0.032],
          ],
          0.008,
        );
        tube(
          hand,
          stitch,
          [
            [side * 0.01, y + 0.006, -0.028],
            [side * 0.027, y + 0.005, -0.016],
            [side * 0.036, y + 0.004, 0.001],
          ],
          0.0012,
        );
      }
      const thumb = new T.Group();
      const thumbMesh = mesh(thumb, new T.CapsuleGeometry(0.01, 0.025, 5, 12), glove, 0, 0.014, 0);
      thumbMesh.rotation.z = side * 0.55;
      thumb.position.set(-side * 0.024, 0.017, -0.012);
      // Merge the static glove, retaining the independently moving thumb.
      mergeStatic(hand);
      hand.add(thumb);
      const paddle = new T.Group();
      paddle.name = side < 0 ? 'Upshift paddle' : 'Downshift paddle';
      paddle.position.set(side * 0.104, 0, 0.041);
      box(paddle, paddleMaterial, side * 0.017, 0, 0, 0.031, 0.087, 0.006);
      steering.add(paddle);
      const upper = mesh(this.root, new T.CylinderGeometry(0.045, 0.053, 1, 16), suit);
      const lower = mesh(this.root, new T.CylinderGeometry(0.03, 0.042, 1, 16), suit);
      const elbow = mesh(this.root, new T.SphereGeometry(0.045, 16, 12), suit);
      this.arms.push({
        side,
        shoulder,
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
  update(time: number, gear: number, mode: number) {
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
