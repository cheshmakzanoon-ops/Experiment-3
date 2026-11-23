import * as T from 'three';
import { add, type BikeMaterials } from '../bike.ts';
import { batchBikeRigidMeshes } from '../bike-rigid-batch.ts';

// All dimensions in metres. The bell crank pivots on the swingarm. Two
// pull rods join its short arm to a fixed transverse pin in the chassis.
const ARM_PIN = new T.Vector3(0, 0.021, -0.177);
const FRAME_PIN = new T.Vector3(0, -0.418, -0.091);
const SHORT_ARM = 0.093, LONG_ARM = 0.119, PULL_ROD = 0.199;
const INCLUDED_ANGLE = -2.506;
const EYE_Y = LONG_ARM * Math.sin(INCLUDED_ANGLE), EYE_Z = LONG_ARM * Math.cos(INCLUDED_ANGLE);

function bore(shape: T.Shape, z: number, y: number, r: number) {
  const hole = new T.Path();
  hole.absarc(z, y, r, 0, 2 * Math.PI, true);
  shape.holes.push(hole);
}

/** Cast rocker cheeks and waisted pull rods have real bearing bores.
 * The section is drawn in side elevation and extruded across the motorcycle. */
function linkagePlate(rocker: boolean, detailed: boolean) {
  const shape = new T.Shape();
  if (rocker) {
    shape.moveTo(EYE_Z - 0.012, EYE_Y + 0.009);
    shape.lineTo(-0.013, 0.013);
    shape.quadraticCurveTo(-0.007, 0.018, 0.006, 0.016);
    shape.lineTo(SHORT_ARM, 0.013);
    shape.quadraticCurveTo(SHORT_ARM + 0.022, 0, SHORT_ARM, -0.014);
    shape.lineTo(0.012, -0.019);
    shape.lineTo(EYE_Z + 0.012, EYE_Y - 0.01);
    shape.quadraticCurveTo(EYE_Z - 0.018, EYE_Y - 0.02, EYE_Z - 0.012, EYE_Y + 0.009);
    bore(shape, 0, 0, 0.008);
    bore(shape, SHORT_ARM, 0, 0.007);
    bore(shape, EYE_Z, EYE_Y, 0.007);
  } else {
    shape.moveTo(0, 0.013);
    shape.quadraticCurveTo(PULL_ROD / 2, 0.004, PULL_ROD, 0.013);
    shape.quadraticCurveTo(PULL_ROD + 0.024, 0, PULL_ROD, -0.013);
    shape.quadraticCurveTo(PULL_ROD / 2, -0.004, 0, -0.013);
    shape.quadraticCurveTo(-0.024, 0, 0, 0.013);
    bore(shape, 0, 0, 0.007);
    bore(shape, PULL_ROD, 0, 0.007);
  }
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: detailed ? 4 : 3 })
    .translate(0, 0, -0.004).rotateY(-Math.PI / 2);
}

export class MotocrossShockLinkage {
  readonly rocker = new T.Group();
  readonly rods = new T.Group();
  private readonly shockBearing = new T.Object3D();
  private readonly armPin = new T.Vector3();
  private readonly framePin = new T.Vector3();

  constructor(root: T.Group, chassis: T.Group, swingarm: T.Group, materials: BikeMaterials, detailed: boolean) {
    this.rocker.name = 'Motocross suspension bell crank';
    this.rods.name = 'Motocross paired suspension pull rods';
    this.shockBearing.name = 'Motocross rocker shock bearing';
    this.shockBearing.position.set(0, EYE_Y, EYE_Z);
    this.rocker.add(this.shockBearing);
    root.add(this.rocker, this.rods);
    for (const [group, rocker, offset] of [[this.rocker, true, 0.026], [this.rods, false, 0.043]] as const) {
      const plate = linkagePlate(rocker, detailed);
      add(group, plate, materials.aluminium, offset);
      add(group, plate.clone(), materials.aluminium, -offset);
    }
    const pin = (group: T.Group, y: number, z: number, size: number, width: number) => {
      add(group, new T.CylinderGeometry(size, size, width, detailed ? 10 : 6), materials.steel, 0, y, z)
        .rotation.z = Math.PI / 2;
    };
    pin(swingarm, ARM_PIN.y, ARM_PIN.z, 0.008, 0.21);
    pin(chassis, FRAME_PIN.y, FRAME_PIN.z, 0.007, 0.17);
    pin(this.rocker, EYE_Y, EYE_Z, 0.007, 0.07);
    pin(this.rocker, 0, SHORT_ARM, 0.007, 0.102);
    batchBikeRigidMeshes(this.rocker);
    batchBikeRigidMeshes(this.rods);
  }

  /** Intersect the short-arm and pull-rod circles in the sagittal plane.
   * The intersection below the swingarm is the physical assembly branch
   * throughout the measured axle travel. Nothing stretches during a seek. */
  update(chassis: T.Matrix4, swingarm: T.Matrix4, out: T.Vector3) {
    const a = this.armPin.copy(ARM_PIN).applyMatrix4(swingarm);
    const b = this.framePin.copy(FRAME_PIN).applyMatrix4(chassis);
    const dz = b.z - a.z, dy = b.y - a.y, distance = Math.hypot(dz, dy);
    const along = (SHORT_ARM * SHORT_ARM - PULL_ROD * PULL_ROD + distance * distance) / (2 * distance);
    const across = Math.sqrt(Math.max(0, SHORT_ARM * SHORT_ARM - along * along));
    const pinZ = (along * dz + across * dy) / distance;
    const pinY = (along * dy - across * dz) / distance;
    this.rocker.position.copy(a);
    this.rocker.rotation.x = -Math.atan2(pinY, pinZ);
    this.rods.position.copy(b);
    this.rods.rotation.x = -Math.atan2(a.y + pinY - b.y, a.z + pinZ - b.z);
    return out.copy(this.shockBearing.position).applyQuaternion(this.rocker.quaternion).add(a);
  }
}
