import * as T from 'three';
import type { CarMaterials, DriverArmAnchor } from './common.ts';
import { drivingGloveMaterial, steeringGlove } from './steering-glove.ts';
import { sharedMaterials } from './materials.ts';

/** Two-bone driver arms share the steering wheel's presented angle, including
 * replay seeks. Road-car hands alternate a pull and a regrip at parking lock.
 * Short-throw cockpits retain their bounded rim travel. */
export const HAND_TRAVEL = (60 * Math.PI) / 180;
/** Bone length margin over the rest pose so the glove can travel along the rim. */
const REACH = 1.12;
const REGRIP_START = 0.63;
const REGRIP_SPAN = 0.78;
const COLUMN_AXIS = new T.Vector3(0, 0, 1);
const UP = new T.Vector3(0, 1, 0);

interface Arm {
  side: -1 | 1;
  shoulder: T.Vector3;
  pole: T.Vector3;
  upper: number;
  fore: number;
  /** Rest glove on the rim, in the steering column frame (polar). */
  angle: number;
  radius: number;
  z: number;
  upperMesh: T.Mesh;
  foreMesh: T.Mesh;
  elbowMesh: T.Mesh;
  gloveMesh: T.Mesh;
  thickness: number;
}

export class DriverArms {
  readonly group = new T.Group();
  private readonly arms: Arm[] = [];
  private readonly wrist = new T.Quaternion();
  private readonly elbow = new T.Vector3();
  private readonly hand = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly offset = new T.Vector3();
  /** `column` is buildSteering's tilt group (a child of the LOD group, so its
   * matrix maps the wheel frame into the same car frame as the anchors). */
  constructor(
    anchors: readonly DriverArmAnchor[],
    private readonly column: T.Group,
    mats: CarMaterials,
    private readonly roadGrip = false,
  ) {
    this.group.name = 'Driver arms (follow the steering wheel)';
    const tube = new T.CylinderGeometry(
        roadGrip ? 0.88 : 1,
        roadGrip ? 1.08 : 1,
        1,
        roadGrip ? 14 : 10,
      ),
      ball = new T.SphereGeometry(1, 10, 8);
    column.updateMatrix();
    const inverse = column.matrix.clone().invert();
    for (const a of anchors) {
      const local = a.hand.clone().applyMatrix4(inverse),
        upper = a.elbow.distanceTo(a.shoulder) * REACH,
        fore = a.elbow.distanceTo(a.hand) * REACH;
      const rest = this.direction.copy(a.hand).sub(a.shoulder).normalize();
      const pole = a.elbow.clone().sub(a.shoulder);
      pole.addScaledVector(rest, -pole.dot(rest)).normalize();
      const make = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
        const mesh = new T.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = false;
        this.group.add(mesh);
        return mesh;
      };
      this.arms.push({
        side: a.side,
        shoulder: a.shoulder.clone(),
        pole,
        upper,
        fore,
        angle: Math.atan2(local.y, local.x),
        radius: Math.hypot(local.x, local.y),
        z: local.z,
        upperMesh: make(tube, mats.suit, 'Upper arm'),
        foreMesh: make(tube, mats.suit, 'Forearm'),
        elbowMesh: make(ball, mats.suit, 'Elbow'),
        gloveMesh: roadGrip
          ? make(steeringGlove(a.side), drivingGloveMaterial, 'Glove')
          : make(ball, sharedMaterials.trim(), 'Glove'),
        thickness: a.radius,
      });
    }
    this.update(0);
  }
  /** Pose both arms for a steering-wheel rotation `wheel` (rad about its axis). */
  update(wheel: number) {
    const turn = Math.max(-HAND_TRAVEL, Math.min(HAND_TRAVEL, wheel));
    this.column.updateMatrix();
    for (const arm of this.arms) {
      let travel = turn,
        release = 0;
      if (this.roadGrip) {
        const sign = Math.sign(wheel);
        const magnitude = Math.abs(wheel);
        // The descending hand feeds first. Bands alternate, so one hand
        // always carries wheel torque while its partner slides round the rim.
        const start = REGRIP_START + (arm.side === sign ? REGRIP_SPAN : 0);
        travel = wheel;
        if (magnitude > start) {
          const cycles = (magnitude - start) / (2 * REGRIP_SPAN);
          const laps = Math.floor(cycles);
          const t = Math.min(1, (cycles - laps) * 2);
          const ease = t * t * t * (t * (6 * t - 15) + 10);
          travel = sign * (magnitude - 2 * REGRIP_SPAN * (laps + ease));
          release = 16 * t * t * (1 - t) * (1 - t);
        }
      }
      const angle = arm.angle + travel;
      const radius = arm.radius + release * arm.thickness * 0.14;
      this.hand
        .set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          arm.z - release * arm.thickness * 0.22,
        )
        .applyMatrix4(this.column.matrix);
      this.solve(arm);
      arm.gloveMesh.position.copy(this.hand);
      if (this.roadGrip) {
        this.wrist.setFromAxisAngle(COLUMN_AXIS, angle);
        arm.gloveMesh.quaternion.copy(this.column.quaternion).multiply(this.wrist);
      }
      arm.gloveMesh.scale.setScalar(arm.thickness);
      arm.elbowMesh.position.copy(this.elbow);
      arm.elbowMesh.scale.setScalar(arm.thickness * 1.02);
      this.bone(arm.upperMesh, arm.shoulder, this.elbow, arm.thickness);
      this.bone(arm.foreMesh, this.elbow, this.hand, arm.thickness);
    }
  }
  /** Two-bone solve (law of cosines): elbow in `this.elbow`; the hand is pulled
   * back along the shoulder line when it is out of reach. */
  private solve(arm: Arm) {
    const { shoulder, upper: a, fore: b } = arm;
    const line = this.direction.copy(this.hand).sub(shoulder);
    const distance = line.length();
    const clamped = Math.min(Math.max(distance, Math.abs(a - b) + 1e-4), a + b - 1e-4);
    if (distance > 1e-6) line.multiplyScalar(1 / distance);
    else line.copy(arm.pole);
    if (clamped !== distance) this.hand.copy(shoulder).addScaledVector(line, clamped);
    const along = (a * a - b * b + clamped * clamped) / (2 * clamped),
      height = Math.sqrt(Math.max(0, a * a - along * along));
    const side = this.offset.copy(arm.pole).addScaledVector(line, -arm.pole.dot(line));
    if (side.lengthSq() < 1e-8) side.crossVectors(UP, line);
    side.normalize();
    this.elbow.copy(shoulder).addScaledVector(line, along).addScaledVector(side, height);
  }
  /** Unit cylinder (radius 1, height 1) laid between two points. */
  private bone(mesh: T.Mesh, from: T.Vector3, to: T.Vector3, radius: number) {
    const span = this.offset.copy(to).sub(from),
      length = span.length();
    mesh.position.copy(from).addScaledVector(span, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, length > 1e-9 ? span.multiplyScalar(1 / length) : UP);
    mesh.scale.set(radius, Math.max(length, 1e-4), radius);
  }
  /** Glove world (car-frame) positions, for tests and diagnostics. */
  gloves() {
    return this.arms.map((arm) => arm.gloveMesh.position.clone());
  }
  /** Bone lengths and the current elbow-to-shoulder / elbow-to-glove spans. */
  spans() {
    return this.arms.map((arm) => ({
      upper: arm.upper,
      fore: arm.fore,
      upperNow: arm.shoulder.distanceTo(arm.elbowMesh.position),
      foreNow: arm.elbowMesh.position.distanceTo(arm.gloveMesh.position),
    }));
  }
}
