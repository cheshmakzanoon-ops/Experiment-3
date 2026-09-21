import { bodySurface, ENGINE_SECTIONS } from './car-surfaces.ts';
import { tireProfile } from './tire-profile.ts';
import * as T from 'three';
import { aeroPlate, wingElement } from './bodywork.ts';
import { mesh, rod } from './geometry.ts';
import type { CarDetail } from './car-floor.ts';

/** One authored assembly, three sampling densities. Values are visual metres,
 * not invented CFD coefficients. Damage still owns the complete wing groups. */
export interface WingSurface {
  readonly span: number;
  readonly chord: number;
  readonly camber: number;
  readonly thickness: number;
  readonly sweep: number;
  readonly gull: number;
  readonly y: number;
  readonly z: number;
  readonly incidence: number;
  readonly painted: boolean;
}
export const FRONT_SURFACES: readonly WingSurface[] = Object.freeze(
  [
    {
      span: 1.965,
      chord: 0.32,
      camber: 0.009,
      thickness: 0.01,
      sweep: 0.105,
      gull: 0.018,
      y: -0.319,
      z: 2.47,
      incidence: 0.04,
      painted: true,
    },
    {
      span: 1.947,
      chord: 0.225,
      camber: 0.017,
      thickness: 0.008,
      sweep: 0.116,
      gull: 0.016,
      y: -0.293,
      z: 2.3,
      incidence: 0.12,
      painted: false,
    },
    {
      span: 1.925,
      chord: 0.208,
      camber: 0.021,
      thickness: 0.008,
      sweep: 0.13,
      gull: 0.01,
      y: -0.25,
      z: 2.145,
      incidence: 0.2,
      painted: false,
    },
    {
      span: 1.9,
      chord: 0.187,
      camber: 0.025,
      thickness: 0.008,
      sweep: 0.145,
      gull: 0.002,
      y: -0.196,
      z: 2.0,
      incidence: 0.28,
      painted: true,
    },
  ].map((surface) => Object.freeze(surface)),
);
export const REAR_SURFACES: readonly WingSurface[] = Object.freeze(
  [
    {
      span: 1.65,
      chord: 0.425,
      camber: 0.031,
      thickness: 0.014,
      sweep: 0.028,
      gull: -0.045,
      y: 0.467,
      z: -1.99,
      incidence: 0.035,
      painted: false,
    },
    {
      span: 1.64,
      chord: 0.242,
      camber: 0.026,
      thickness: 0.011,
      sweep: 0.03,
      gull: -0.019,
      y: 0.583,
      z: -2.15,
      incidence: 0.09,
      painted: true,
    },
  ].map((surface) => Object.freeze(surface)),
);
export const FRONT_ENDPLATE: readonly (readonly [number, number])[] = Object.freeze([
  [1.76, -0.322],
  [2.49, -0.359],
  [2.62, -0.339],
  [2.66, -0.29],
  [2.64, -0.224],
  [2.53, -0.2],
  [2.18, -0.175],
  [1.9, -0.113],
  [1.79, -0.171],
]);
export const REAR_ENDPLATE: readonly (readonly [number, number])[] = Object.freeze([
  [-2.32, 0.23],
  [-2.15, 0.194],
  [-1.9, 0.2],
  [-1.77, 0.365],
  [-1.76, 0.51],
  [-1.81, 0.593],
  [-1.9, 0.643],
  [-2.24, 0.656],
  [-2.32, 0.615],
]);
export const HALO_POINTS: readonly (readonly [number, number, number])[] = Object.freeze([
  [-0.31, 0.24, -0.55],
  [-0.33, 0.51, -0.28],
  [-0.25, 0.57, 0.31],
  [0, 0.55, 0.66],
  [0.25, 0.57, 0.31],
  [0.33, 0.51, -0.28],
  [0.31, 0.24, -0.55],
]);
export const COCKPIT_RIM: readonly (readonly [number, number, number])[] = Object.freeze([
  [-0.29, 0.14, 0.36],
  [-0.34, 0.2, 0],
  [-0.32, 0.23, -0.5],
  [0, 0.27, -0.65],
  [0.32, 0.23, -0.5],
  [0.34, 0.2, 0],
  [0.29, 0.14, 0.36],
]);
export const ENGINE_FIN: readonly (readonly [number, number])[] = Object.freeze([
  [-1.94, -0.005],
  [-1.57, 0.153],
  [-1.14, 0.315],
  [-0.8, 0.585],
  [-0.76, 0.633],
  [-1.04, 0.447],
  [-1.43, 0.264],
  [-1.94, 0.113],
]);
function curveMesh(points: typeof HALO_POINTS, radius: number, detail: CarDetail) {
  const curve = new T.CatmullRomCurve3(points.map((v) => new T.Vector3(...v)));
  return new T.TubeGeometry(
    curve,
    detail === 'high' ? 64 : detail === 'mid' ? 32 : 16,
    radius,
    detail === 'high' ? 12 : 8,
    false,
  );
}
export function addSafetyCell(parent: T.Group, carbon: T.Material, detail: CarDetail) {
  mesh(parent, curveMesh(HALO_POINTS, 0.033, detail), carbon).name = 'Aurel V2 halo';
  mesh(parent, curveMesh(COCKPIT_RIM, 0.037, detail), carbon).name = 'Padded cockpit rim';
  rod(parent, carbon, new T.Vector3(0, 0.15, 0.63), new T.Vector3(0, 0.55, 0.66), 0.027);
  mesh(parent, aeroPlate(ENGINE_FIN, 0.012), carbon).name = 'Engine cover dorsal edge';
}
export function buildWing(
  parent: T.Group,
  end: 'front' | 'rear',
  detail: CarDetail,
  paint: T.Material,
  carbon: T.Material,
) {
  const surfaces = end === 'front' ? FRONT_SURFACES : REAR_SURFACES;
  for (const [index, d] of surfaces.entries()) {
    const part = mesh(
      parent,
      wingElement(d.span, d.chord, d.camber, d.thickness, d.sweep, d.gull, detail),
      d.painted ? paint : carbon,
      0,
      d.y,
      d.z,
    );
    part.rotation.x = d.incidence;
    part.name = `${end} slotted surface ${index + 1}`;
  }
  for (const side of [-1, 1]) {
    mesh(
      parent,
      aeroPlate(end === 'front' ? FRONT_ENDPLATE : REAR_ENDPLATE, end === 'front' ? 0.012 : 0.018),
      paint,
      side * (end === 'front' ? 0.984 : 0.839),
    );
    if (end === 'front') {
      // Thin swept supports replace protruding rectangular cascade blocks.
      for (let i = 0; i < 3; i++) {
        const d = FRONT_SURFACES[i + 1],
          before = FRONT_SURFACES[i];
        mesh(
          parent,
          aeroPlate(
            [
              [before.z - 0.09, before.y + 0.006],
              [before.z - 0.048, before.y + 0.006],
              [d.z + 0.067, d.y + 0.022],
              [d.z + 0.034, d.y + 0.022],
            ],
            0.008,
          ),
          carbon,
          side * 0.73,
        );
      }
      // The nose joins the second element via two actual vertical pylons.
      mesh(
        parent,
        aeroPlate(
          [
            [2.16, -0.289],
            [2.29, -0.292],
            [2.3, -0.181],
            [2.16, -0.166],
          ],
          0.017,
        ),
        carbon,
        side * 0.083,
      );
    } else {
      rod(
        parent,
        carbon,
        new T.Vector3(side * 0.24, -0.28, -1.9),
        new T.Vector3(side * 0.24, 0.475, -2.04),
        0.019,
      );
      if (detail !== 'far')
        for (let i = 0; i < 3; i++)
          mesh(
            parent,
            aeroPlate(
              [
                [-2.27, 0.29 + i * 0.036],
                [-2.01, 0.3 + i * 0.036],
                [-2.01, 0.306 + i * 0.036],
                [-2.27, 0.296 + i * 0.036],
              ],
              0.002,
            ),
            carbon,
            side * 0.852,
          );
    }
  }
}

/** Rounded shoulder and inner bead at every LOD. Local Y is the axle, matching
 * the existing radius-only deformation path and leaving rigid rims unchanged. */
export function reducedTireGeometry(width: number, detail: CarDetail) {
  if (!Number.isFinite(width) || width <= 0 || width > 0.5) throw new Error('Invalid tire width');
  const profile = tireProfile(width / 2);
  const g = new T.LatheGeometry(profile, detail === 'high' ? 48 : detail === 'mid' ? 24 : 16);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The airbox is a real open-mouth duct through the closed engine-cover endcap,
 * not a detached circular torus above it. Shared by every car detail level. */
export function addAirbox(
  parent: T.Group,
  paint: T.Material,
  carbon: T.Material,
  dark: T.Material,
  detail: CarDetail,
) {
  const segments = detail === 'high' ? 40 : detail === 'mid' ? 12 : 8;
  const outer = new T.Shape();
  for (let j = 0; j <= segments; j++) {
    const p = bodySurface(ENGINE_SECTIONS, -0.54, j / segments, 0, 0.18);
    if (j === 0) outer.moveTo(p.x, p.y);
    else outer.lineTo(p.x, p.y);
  }
  outer.closePath();
  const inlet = new T.Path();
  inlet.moveTo(-0.064, 0.502);
  inlet.quadraticCurveTo(-0.075, 0.513, -0.059, 0.546);
  inlet.lineTo(-0.022, 0.642);
  inlet.quadraticCurveTo(0, 0.669, 0.022, 0.642);
  inlet.lineTo(0.059, 0.546);
  inlet.quadraticCurveTo(0.075, 0.513, 0.064, 0.502);
  inlet.quadraticCurveTo(0, 0.482, -0.064, 0.502);
  inlet.closePath();
  outer.holes.push(inlet);
  mesh(parent, new T.ShapeGeometry(outer, detail === 'high' ? 12 : 5), paint, 0, 0, -0.54);
  const points = inlet.getPoints(detail === 'high' ? 12 : 5),
    pos: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  for (let row = 0; row < 2; row++)
    for (let j = 0; j < points.length; j++) {
      const p = points[j],
        factor = row === 0 ? 1 : 0.87;
      pos.push(p.x * factor, 0.55 + (p.y - 0.55) * factor, -0.539 - row * 0.13);
      uv.push(j / (points.length - 1), row);
    }
  for (let j = 0; j < points.length - 1; j++) {
    const a = j,
      b = j + points.length;
    ix.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  mesh(parent, g, carbon);
  const back = new T.Shape(points);
  mesh(parent, new T.ShapeGeometry(back), dark, 0, 0, -0.67);
}
