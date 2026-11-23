import * as T from 'three';
import { clamp } from '../core/math.ts';
import { mergeStatic, mesh, rod } from './geometry.ts';
import { sculptedLoft, type BodySection } from './bodywork.ts';

export type RearSkin = 'rear_paint' | 'rear_carbon';

/** Car-local metres. The journals are inboard of the rear endplates, close to
 * the upper element's trailing edge. Positive Z points towards the nose. */
const HINGE_Y = 0.607;
const HINGE_Z = -2.255;
const BASE_PIN = new T.Vector3(0, 0.613, -2.012);
const FLAP_PIN = new T.Vector3(0, 0.618, -2.124);
const UP = new T.Vector3(0, 1, 0);
const BARREL = 0.063;
const DRIVE_COVER: readonly BodySection[] = [
  [-2.016, 0.591, 0.014, 0.026],
  [-1.997, 0.561, 0.026, 0.064],
  [-1.963, 0.549, 0.031, 0.073],
  [-1.921, 0.528, 0.029, 0.055],
  [-1.876, 0.507, 0.02, 0.031],
  [-1.827, 0.49, 0.006, 0.008],
];
export function formulaFlapAngle(travel: number) {
  return -0.4 * clamp(travel, 0, 1);
}

/** The Blender exports batch by finish. The two endplates lie entirely beyond
 * |x| = .83 m. The separate carbon Gurney lip lies above the mainplane and
 * its stays. These clearances also hold on the decimated exports. Preserve
 * each original corner, UV seam, normal and winding when separating the parts. */
export function separateRearSkin(source: T.BufferGeometry, role: RearSkin) {
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const index = source.getIndex()!;
  const remap = new Int32Array(position.count);
  const moving = new Uint8Array(position.count);
  const parts = [0, 1].map(() => ({
    xyz: [] as number[],
    n: [] as number[],
    uv: [] as number[],
    indices: [] as number[],
  }));
  for (let i = 0; i < position.count; i++) {
    moving[i] = Number(
      role === 'rear_paint' ? Math.abs(position.getX(i)) < 0.826 : position.getY(i) > 0.563,
    );
    const part = parts[moving[i]];
    remap[i] = part.xyz.length / 3;
    part.xyz.push(position.getX(i), position.getY(i), position.getZ(i));
    part.n.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    part.uv.push(uv.getX(i), uv.getY(i));
  }
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (moving[a] !== moving[b] || moving[a] !== moving[c])
      throw new Error(`Rear flap boundary intersects ${role}`);
    parts[moving[a]].indices.push(remap[a], remap[b], remap[c]);
  }
  return parts.map((part) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(part.xyz, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(part.n, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(part.uv, 2));
    geometry.setIndex(part.indices);
    return geometry;
  });
}

/** Children keep their closed, chassis-space vertex coordinates. The team
 * livery printed across the moving flap therefore turns with the composite. */
export class FormulaRearFlap {
  readonly hinge = new T.Group();
  readonly skin = new T.Group();
  private drive?: { axis: T.Group; piston: T.Mesh };
  private readonly travelVector = new T.Vector3();

  /** Fixed hydraulic cover and two flap-side pickup ears share the existing
   * carbon and alloy batches. The telescoping rod stays independent. */
  buildDrive(wing: T.Group, carbon: T.Material, alloy: T.Material, detail: 'high' | 'mid' | 'far') {
    mesh(wing, sculptedLoft(DRIVE_COVER, 0, 0.32, [], detail === 'high' ? 'mid' : 'far'), carbon);
    if (detail === 'far') return;
    const segments = detail === 'high' ? 12 : 8;
    for (const x of [-0.009, 0.009]) {
      rod(
        this.skin,
        carbon,
        new T.Vector3(x, 0.589, -2.106),
        new T.Vector3(x, FLAP_PIN.y, FLAP_PIN.z),
        0.0056,
      );
    }
    const pin = new T.CylinderGeometry(0.0055, 0.0055, 0.033, segments);
    pin.rotateZ(Math.PI / 2);
    mesh(this.skin, pin, alloy, FLAP_PIN.x, FLAP_PIN.y, FLAP_PIN.z);
    const axis = new T.Group();
    axis.name = 'Wing flap hydraulic cylinder';
    axis.position.copy(BASE_PIN);
    mesh(axis, new T.CylinderGeometry(0.009, 0.012, BARREL, segments), carbon, 0, BARREL / 2);
    mesh(axis, new T.CylinderGeometry(0.0115, 0.0115, 0.009, segments), alloy, 0, BARREL - 0.0045);
    mergeStatic(axis);
    const piston = mesh(axis, new T.CylinderGeometry(0.0055, 0.0055, 1, segments), alloy);
    piston.name = 'Flap piston up to the pickup pin';
    this.drive = { axis, piston };
  }

  mount(wing: T.Group) {
    mergeStatic(this.skin);
    this.hinge.name = 'Rear wing flap journals';
    this.hinge.position.set(0, HINGE_Y, HINGE_Z);
    this.skin.position.copy(this.hinge.position).negate();
    this.hinge.add(this.skin);
    wing.add(this.hinge);
    if (this.drive) {
      wing.add(this.drive.axis);
      this.setTravel(0);
    }
  }

  setTravel(fraction: number) {
    this.hinge.rotation.x = formulaFlapAngle(fraction);
    if (!this.drive) return;
    const vector = this.travelVector
      .copy(FLAP_PIN)
      .sub(this.hinge.position)
      .applyQuaternion(this.hinge.quaternion)
      .add(this.hinge.position)
      .sub(BASE_PIN);
    const length = vector.length();
    this.drive.axis.quaternion.setFromUnitVectors(UP, vector.multiplyScalar(1 / length));
    this.drive.piston.scale.y = length - BARREL + 0.003;
    this.drive.piston.position.y = length - this.drive.piston.scale.y / 2;
  }
}
