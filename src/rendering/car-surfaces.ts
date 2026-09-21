import * as T from 'three';
import { sampleBody, type BodySection, type LoftOpening } from './bodywork.ts';

/** Original Aurel body envelopes. These shape the rendering, not aerodynamic
 * force coefficients or physical wheel hardpoints. Dimensions are metres. */
export const NOSE_SECTIONS: readonly BodySection[] = Object.freeze([
  [0.4, 0.025, 0.3, 0.17],
  [0.58, 0.026, 0.288, 0.158],
  [1.12, -0.012, 0.231, 0.119],
  [1.58, -0.07, 0.171, 0.091],
  [2.03, -0.148, 0.109, 0.065],
  [2.38, -0.22, 0.077, 0.032],
  [2.55, -0.256, 0.049, 0.019],
  [2.6, -0.266, 0.016, 0.008],
]);
export const POD_SECTIONS: readonly BodySection[] = Object.freeze([
  [-1.75, -0.257, 0.032, 0.036],
  [-1.4, -0.224, 0.132, 0.086],
  [-0.91, -0.153, 0.244, 0.134],
  [-0.38, -0.062, 0.301, 0.154],
  [0.06, -0.015, 0.307, 0.158],
  [0.26, 0.012, 0.27, 0.127],
  [0.39, 0.025, 0.225, 0.075],
]);
export const ENGINE_SECTIONS: readonly BodySection[] = Object.freeze([
  [-2.15, -0.11, 0.015, 0.032],
  [-1.82, -0.04, 0.106, 0.104],
  [-1.42, 0.07, 0.156, 0.189],
  [-1.01, 0.202, 0.212, 0.292],
  [-0.73, 0.295, 0.166, 0.425],
  [-0.55, 0.36, 0.09, 0.27],
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
