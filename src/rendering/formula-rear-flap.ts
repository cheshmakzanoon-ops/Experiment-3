import * as T from 'three';
import { clamp } from '../core/math.ts';
import { mergeStatic } from './geometry.ts';

export type RearSkin = 'rear_paint' | 'rear_carbon';

/** Car-local metres. The journals are inboard of the rear endplates, close to
 * the upper element's trailing edge. Positive Z points towards the nose. */
const HINGE_Y = 0.607;
const HINGE_Z = -2.255;
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

  mount(wing: T.Group) {
    mergeStatic(this.skin);
    this.hinge.name = 'Rear wing flap journals';
    this.hinge.position.set(0, HINGE_Y, HINGE_Z);
    this.skin.position.copy(this.hinge.position).negate();
    this.hinge.add(this.skin);
    wing.add(this.hinge);
  }

  setTravel(fraction: number) {
    this.hinge.rotation.x = formulaFlapAngle(fraction);
  }
}
