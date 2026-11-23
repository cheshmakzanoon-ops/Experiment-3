import * as T from 'three';
import { add, type BikeMaterials } from '../bike.ts';
import { batchBikeRigidMeshes } from '../bike-rigid-batch.ts';
import {
  MX_BOOT_PEG,
  MX_BOOT_PEDAL,
  MX_PEG_TOP,
  motocrossBootFrame,
  motocrossPedalAngle,
} from './motocross-rider-contact.ts';

const UP = new T.Vector3(0, 1, 0);
export const MX_PEG = Object.freeze([0.17, -0.44, -0.1] as const);

/** Lever blank in its side elevation (+Z forward). The rear heel of the
 * forging pulls the pushrod; the toe basket is wide enough for a mud boot. */
function leverBlank(tipY: number, tipZ: number, brake: boolean) {
  const s = new T.Shape();
  s.moveTo(-0.036, 0.029);
  s.quadraticCurveTo(-0.052, 0.026, -0.046, 0.012);
  s.lineTo(-0.012, -0.009);
  s.quadraticCurveTo(-0.005, -0.017, 0.014, -0.015);
  s.lineTo(tipZ * 0.68, tipY - 0.015);
  s.lineTo(tipZ, tipY - 0.005);
  s.lineTo(tipZ, tipY + 0.005);
  s.lineTo(tipZ * 0.68, tipY + 0.001);
  s.lineTo(0.014, 0.009);
  s.quadraticCurveTo(0.006, 0.017, -0.012, 0.012);
  s.closePath();
  if (brake) {
    const relief = new T.Path();
    relief.moveTo(0.023, -0.006);
    relief.lineTo(0.061, tipY * 0.5 - 0.007);
    relief.lineTo(0.056, tipY * 0.5 - 0.002);
    relief.lineTo(0.027, -0.001);
    relief.closePath();
    s.holes.push(relief);
  }
  return new T.ExtrudeGeometry(s, {
    depth: 0.0045,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.0008,
    bevelSegments: 1,
    curveSegments: 3,
  })
    .translate(0, 0, -0.00225)
    .rotateY(-Math.PI / 2);
}

/** The crank and boot share the peg's transverse pivot line. The upper end
 * of the rod slides inside its frame-mounted cylinder as the bell crank turns. */
export class MotocrossFootControls {
  readonly brake = new T.Group();
  readonly outlet = new T.Vector3();
  private readonly clevis = new T.Vector3(-0.001, 0.021, -0.039);
  private readonly mouth = new T.Vector3(-0.134, -0.335, -0.151);
  private readonly rod: T.Mesh;
  private readonly lower = new T.Vector3();
  private readonly axis = new T.Vector3();

  constructor(parent: T.Group, materials: BikeMaterials, detailed: boolean) {
    const pegY = MX_PEG[1] + MX_PEG_TOP;
    const tip = new T.Vector3()
      .fromArray(MX_BOOT_PEDAL)
      .sub(new T.Vector3().fromArray(MX_BOOT_PEG))
      .applyQuaternion(motocrossBootFrame(new T.Quaternion()));
    const segments = detailed ? 10 : 6;
    for (const side of [-1, 1]) {
      const isBrake = side < 0,
        x = side * 0.133;
      const pedal = isBrake ? this.brake : new T.Group();
      pedal.name = isBrake ? 'Motocross rear brake pedal' : 'Motocross gear selector';
      pedal.position.set(x, pegY, MX_PEG[2]);
      parent.add(pedal);
      const y = tip.y + (isBrake ? -0.008 : 0.041);
      add(pedal, leverBlank(y, tip.z, isBrake), materials.aluminium);
      add(
        parent,
        new T.CylinderGeometry(0.009, 0.009, 0.039, segments),
        materials.steel,
        x - side * 0.012,
        pegY,
        MX_PEG[2],
      ).rotation.z = Math.PI / 2;
      if (isBrake) {
        // Open toe cage, with tooth peaks lying on the actual sole landmark.
        for (const z of [-0.012, 0.012]) {
          add(
            pedal,
            new T.BoxGeometry(0.052, 0.008, 0.0035),
            materials.steel,
            side * 0.023,
            y,
            tip.z + z,
          );
          if (detailed)
            for (let i = 0; i < 5; i++) {
              const tooth = new T.CylinderGeometry(0.001, 0.0032, 0.0045, 4);
              add(pedal, tooth, materials.steel, side * (0.005 + i * 0.01), y + 0.00575, tip.z + z);
            }
        }
        for (const offset of [-0.001, 0.047])
          add(
            pedal,
            new T.BoxGeometry(0.004, 0.008, 0.0275),
            materials.steel,
            side * offset,
            y,
            tip.z,
          );
        add(
          pedal,
          new T.CylinderGeometry(0.0075, 0.0075, 0.012, segments),
          materials.steel,
          this.clevis.x,
          this.clevis.y,
          this.clevis.z,
        ).rotation.z = Math.PI / 2;
      } else {
        // Folding, rubber-sleeved left toe piece sits over the boot.
        add(
          pedal,
          new T.CylinderGeometry(0.009, 0.009, 0.048, segments),
          materials.dark,
          side * 0.022,
          y,
          tip.z,
        ).rotation.z = Math.PI / 2;
        if (detailed)
          for (const off of [0.006, 0.016, 0.026, 0.036])
            add(
              pedal,
              new T.CylinderGeometry(0.0105, 0.0105, 0.004, segments),
              materials.dark,
              side * off,
              y,
              tip.z,
            ).rotation.z = Math.PI / 2;
      }
      batchBikeRigidMeshes(pedal);
    }
    const barrel = add(
      parent,
      new T.CylinderGeometry(0.011, 0.013, 0.054, segments),
      materials.caliper,
      this.mouth.x,
      this.mouth.y + 0.026,
      this.mouth.z - 0.005,
    );
    barrel.rotation.x = -0.18;
    barrel.updateMatrix();
    this.outlet.set(0, 0.027, 0).applyMatrix4(barrel.matrix);
    // A separate pivot keeps the rod clear of the parent rigid batching pass.
    const linkage = new T.Group();
    linkage.name = 'Motocross hydraulic brake pushrod';
    parent.add(linkage);
    this.rod = add(linkage, new T.CylinderGeometry(0.003, 0.003, 1, segments), materials.steel);
    this.update(0);
  }

  update(rearBrake: number) {
    this.brake.rotation.x = motocrossPedalAngle(rearBrake);
    this.lower.copy(this.clevis).applyQuaternion(this.brake.quaternion).add(this.brake.position);
    this.axis.subVectors(this.mouth, this.lower);
    this.rod.scale.y = this.axis.length();
    this.rod.position.copy(this.lower).lerp(this.mouth, 0.5);
    this.rod.quaternion.setFromUnitVectors(UP, this.axis.normalize());
  }
}

/** Route the hose from the frame-mounted master cylinder to the rear
 * caliper's existing tail. A short loop bends beside the arm pivot; the rest
 * of the hose and its saddles rotate rigidly on the non-spinning swingarm. */
export function motocrossRearBrakeLine(
  chassis: T.Group, arm: T.Group, pivot: T.Vector3, armLength: number, outlet: T.Vector3,
  materials: BikeMaterials, detailed: boolean,
) {
  const onArm = (x: number, y: number, z: number) => new T.Vector3(x, y, z).add(pivot);
  const path = new T.CatmullRomCurve3([
    outlet.clone(),
    outlet.clone().add(new T.Vector3(-0.004, 0.018, -0.012)),
    onArm(-0.141, 0.078, -0.053),
    onArm(-0.123, 0.055, -0.091),
    onArm(-0.109, 0.055, -0.145),
    onArm(-0.111, 0.05, -armLength * 0.53),
    onArm(-0.113, 0.045, -armLength + 0.2),
  ]);
  const rows = detailed ? 22 : 13, sides = 5;
  const g = new T.TubeGeometry(path, rows, 0.0035, sides, false);
  const count = g.getAttribute('position').count;
  const weights = new Float32Array(4 * count), indices = new Uint16Array(4 * count);
  const centre = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    path.getPointAt(row / rows, centre);
    const follow = T.MathUtils.smoothstep(-centre.z, 0.183, 0.245);
    for (let side = 0; side <= sides; side++) {
      const k = 4 * (row * (sides + 1) + side);
      indices[k + 1] = 1;
      weights[k] = 1 - follow;
      weights[k + 1] = follow;
    }
  }
  g.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
  g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  const fixed = new T.Bone(), moving = new T.Bone();
  chassis.add(fixed);
  arm.add(moving);
  const line = new T.SkinnedMesh(g, materials.dark);
  line.name = 'Motocross flexible rear hydraulic line';
  line.bind(new T.Skeleton([fixed, moving], [
    new T.Matrix4(), new T.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z),
  ]), new T.Matrix4());
  line.castShadow = line.receiveShadow = true;
  g.computeBoundingSphere();
  line.boundingSphere = g.boundingSphere!.clone();
  line.boundingSphere.radius += 0.18;
  for (const [x, y, z] of [[-0.109, 0.055, -0.145], [-0.111, 0.05, -armLength * 0.53]]) {
    add(arm, new T.BoxGeometry(0.019, 0.0045, 0.015), materials.aluminium, x, y + 0.003, z);
  }
  add(chassis, new T.CylinderGeometry(0.0057, 0.0067, 0.012, 6), materials.steel,
    outlet.x - 0.001, outlet.y + 0.005, outlet.z - 0.002).rotation.x = -0.4;
  return line;
}
