import * as T from 'three';
import { sampleBody, sculptedLoft, type BodySection, type LoftOpening } from './bodywork.ts';

/** Original Aurel body envelopes. These shape the rendering, not aerodynamic
 * force coefficients or physical wheel hardpoints. Dimensions are metres. */
export const NOSE_SECTIONS: readonly BodySection[] = Object.freeze([
  [0.32, -0.004, 0.305, 0.211],
  [0.45, 0.014, 0.299, 0.183],
  [0.7, 0.035, 0.28, 0.151],
  [1.12, 0.019, 0.224, 0.118],
  [1.5, -0.046, 0.165, 0.082],
  [1.85, -0.12, 0.135, 0.057],
  [2.15, -0.151, 0.124, 0.047],
  [2.34, -0.178, 0.102, 0.04],
  [2.42, -0.186, 0.08, 0.028],
  [2.435, -0.186, 0.067, 0.024],
]);
export const POD_SECTIONS: readonly BodySection[] = Object.freeze([
  [-1.8, -0.275, 0.08, 0.055],
  [-1.58, -0.214, 0.183, 0.096],
  [-1.25, -0.175, 0.257, 0.123],
  [-0.9, -0.105, 0.305, 0.14],
  [-0.5, -0.042, 0.326, 0.16],
  [-0.1, -0.015, 0.324, 0.165],
  [0.2, 0.04, 0.29, 0.112],
  [0.36, 0.035, 0.24, 0.076],
  [0.39, 0.025, 0.225, 0.075],
]);
export const ENGINE_SECTIONS: readonly BodySection[] = Object.freeze([
  [-2.15, -0.12, 0.027, 0.036],
  [-1.9, -0.095, 0.09, 0.091],
  [-1.55, -0.01, 0.135, 0.155],
  [-1.2, 0.066, 0.19, 0.196],
  [-0.92, 0.132, 0.23, 0.232],
  [-0.75, 0.225, 0.15, 0.343],
  [-0.62, 0.34, 0.1, 0.36],
  [-0.54, 0.43, 0.095, 0.28],
]);
export const POD_OPENINGS: readonly LoftOpening[] = Object.freeze(
  Array.from({ length: 8 }, (_, i) =>
    Object.freeze({
      z0: -0.92 + i * 0.082,
      z1: -0.889 + i * 0.082,
      u0: 0.425,
      u1: 0.575,
    }),
  ),
);

/** Identical parameterisation to sculptedLoft. Used by inset cooling outlets,
 * conformal paint and suspension mounts, so details cannot float off the shell. */
export function bodySurface(
  sections: readonly BodySection[],
  z: number,
  u: number,
  undercut = 0,
  flatten = 0,
  offset = 0,
  out = new T.Vector3(),
) {
  if (
    ![u, undercut, flatten, offset].every(Number.isFinite) ||
    u < 0 ||
    u > 1 ||
    undercut < 0 ||
    undercut > 0.9 ||
    flatten < 0 ||
    flatten > 0.9
  )
    throw new Error('Invalid body surface coordinates');
  const [sampleZ, y, w, h] = sampleBody(sections, z);
  const a = u * Math.PI * 2 - Math.PI / 2,
    sn = Math.sin(a),
    cs = Math.cos(a);
  const lower = T.MathUtils.clamp((-sn - 0.05) / 0.85, 0, 1);
  return out.set(
    Math.sign(cs) * Math.abs(cs) ** (1 - flatten * 0.4) * w * (1 - lower * undercut) + cs * offset,
    y + Math.sign(sn) * Math.abs(sn) ** (1 - flatten * 0.5) * h + sn * offset,
    sampleZ,
  );
}

export function bodySurfacePatch(
  sections: readonly BodySection[],
  area: LoftOpening,
  undercut = 0,
  flatten = 0,
  offset = 0.0015,
  rows = 8,
  columns = 12,
) {
  if (
    ![area.z0, area.z1, area.u0, area.u1].every(Number.isFinite) ||
    area.z0 >= area.z1 ||
    area.u0 >= area.u1 ||
    area.u0 < 0 ||
    area.u1 > 1 ||
    area.z0 < sections[0][0] ||
    area.z1 > sections.at(-1)![0]
  )
    throw new Error('Invalid body patch');
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    v = new T.Vector3();
  if (![rows, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 64))
    throw new Error('Invalid surface patch subdivisions');
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= columns; j++) {
      bodySurface(
        sections,
        T.MathUtils.lerp(area.z0, area.z1, i / rows),
        T.MathUtils.lerp(area.u0, area.u1, j / columns),
        undercut,
        flatten,
        offset,
        v,
      );
      positions.push(v.x, v.y, v.z);
      uv.push(1 - j / columns, i / rows);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Visual wishbone inboard attachments now terminate ON the authored monocoque
 * or engine shell, not at a constant X that lies in air beside a tapered nose. */
export function suspensionMount(wheelX: number, wheelZ: number, dy: number, dz: number) {
  if (![wheelX, wheelZ, dy, dz].every(Number.isFinite) || wheelX === 0)
    throw new Error('Invalid suspension mount');
  const front = wheelZ > 0,
    u = wheelX > 0 ? (dy > 0 ? 0.29 : 0.22) : dy > 0 ? 0.71 : 0.78;
  return bodySurface(
    front ? NOSE_SECTIONS : ENGINE_SECTIONS,
    wheelZ + dz,
    u,
    0,
    front ? 0.32 : 0.18,
    0.002,
  );
}

export const POD_UNDERCUT = 0.48;
export const POD_FLATTEN = 0.88;
/** The deck has an authored longitudinal downwash channel between its raised
 * shoulders. Both cooling apertures and all LODs use the same surface function. */
function podChannel(z: number, u: number) {
  const length = T.MathUtils.clamp((z + 1.65) / 1.75, 0, 1);
  return -0.041 * Math.sin(Math.PI * length) ** 2 * Math.exp(-(((u - 0.5) / 0.088) ** 2));
}
export function shapePodSurface(geometry: T.BufferGeometry) {
  const p = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + podChannel(p.getZ(i), uv.getX(i)));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
export function sidepodShell(detail: 'high' | 'mid' | 'far' = 'high', openings = true) {
  return shapePodSurface(
    sculptedLoft(POD_SECTIONS, POD_UNDERCUT, POD_FLATTEN, openings ? POD_OPENINGS : [], detail),
  );
}
export function sidepodPatch(area: LoftOpening, offset: number) {
  const geometry = bodySurfacePatch(POD_SECTIONS, area, POD_UNDERCUT, POD_FLATTEN, offset, 4, 8);
  const p = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const u = T.MathUtils.lerp(area.u0, area.u1, 1 - uv.getX(i));
    p.setY(i, p.getY(i) + podChannel(p.getZ(i), u));
  }
  geometry.computeVertexNormals();
  return geometry;
}
