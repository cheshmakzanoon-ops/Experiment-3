import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { canvasTexture } from './geometry.ts';
import { liveryScheme } from './car-livery.ts';
import {
  BRAND_ART,
  drawMark,
  drawWordmark,
  fitHeight,
  type WordmarkStyle,
} from './studio/brand-atlas.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { carbonMaterial } from './materials.ts';
import { bikeSurfaceMaps } from './bike-surface-detail.ts';
import {
  GP_LIVERY_FRAME,
  installShellInterior,
  liveryUv,
  shellPanelGeometry,
  type P3,
  type ShellPanel,
} from './gp-race-shell.ts';

/** GP race shell (R6). Replaces the inflated earlier GP fairings with the
 * long, low, sharp-nosed proportions of the supplied MotoGP 26 references
 * (REF 001, 003, 018, 028, 046, 056, 060): a pointed nose over the front
 * tyre, a tall bubble screen, box wings on the nose cheeks, flat creased
 * flanks with exit louvres, a low belly pan, a narrow seat and a high tail.
 * All geometry is original and procedural; liveries are original artwork.
 *
 * Frame: BikeModel's sprung CG frame (+Z forward, road at y = -0.62 for the
 * GP prototypes, front axle at z = +0.70, steering head top near y = 0.31). */
export type GpShellVariant = 'gpr1' | 'gpr2';

/** Front tyre clearance: inside the fork (|x| < 0.16) the skin must clear
 * the fully compressed (125 mm) tyre and fender; outside it, the side
 * silhouette keeps a tight gap to the static tyre, as on the reference bikes. */
const AXLE_STATIC = new T.Vector2(0.7, -0.32);
const AXLE_COMPRESSED = new T.Vector2(0.7 - 0.125 * Math.sin(0.42), -0.32 + 0.125 * Math.cos(0.42));
export function gpFrontTyreExclusion(p: T.Vector3) {
  const dz0 = p.z - AXLE_STATIC.x,
    dy0 = p.y - AXLE_STATIC.y;
  if (dz0 * dz0 + dy0 * dy0 < 0.325 * 0.325) return true;
  if (Math.abs(p.x) >= 0.165) return false;
  const dz = p.z - AXLE_COMPRESSED.x,
    dy = p.y - AXLE_COMPRESSED.y;
  return dz * dz + dy * dy < 0.335 * 0.335;
}

interface Section {
  z: number;
  /** Half-section columns (x, y[, dz]) from the upper edge to the lower edge. */
  c: readonly (readonly [number, number] | readonly [number, number, number])[];
}
function net(sections: readonly Section[]): P3[][] {
  return [...sections]
    .sort((a, b) => a.z - b.z)
    .map((s) => s.c.map(([x, y, dz = 0]) => [x, y, s.z + dz] as P3));
}

/** Nose, upper fairing, flanks and belly pan, one continuous moulding per
 * side. Columns: 0 upper edge, 1 shoulder, 2 shoulder fold, 3-5 flank,
 * 6 belly fold, 7 belly side, 8 keel. */
function bodyNet(variant: GpShellVariant): P3[][] {
  const r2 = variant === 'gpr2';
  // GP-R2: a blunter, wider nose and a taller brow; the same chassis behind.
  const n = r2 ? 1.07 : 1;
  const nose = (y: number) => (r2 ? y * 1.04 : y);
  // Upper sections are arches: a narrow brow over the screen base widening
  // to the cheek fold, as in the tall front views of REF 028, 047 and 060.
  return net([
    {
      // Rear edge, raked forward at the top like the reference side panels.
      z: -0.1,
      c: [
        [0.163, 0.03, 0.0],
        [0.186, 0.0, -0.01],
        [0.2, -0.045, -0.02],
        [0.212, -0.13, -0.04],
        [0.216, -0.24, -0.07],
        [0.204, -0.38, -0.1],
        [0.178, -0.475, -0.13],
        [0.1, -0.528, -0.15],
        [0, -0.54, -0.16],
      ],
    },
    {
      z: 0.0,
      c: [
        [0.168, 0.1],
        [0.192, 0.07],
        [0.208, 0.03],
        [0.226, -0.07],
        [0.234, -0.19],
        [0.224, -0.34],
        [0.2, -0.462],
        [0.112, -0.534],
        [0, -0.547],
      ],
    },
    {
      z: 0.13,
      c: [
        [0.171, 0.185],
        [0.198, 0.152],
        [0.218, 0.1],
        [0.24, -0.01],
        [0.25, -0.14],
        [0.236, -0.31],
        [0.21, -0.448],
        [0.118, -0.528],
        [0, -0.543],
      ],
    },
    {
      // Behind the screen the upper edge dives under the clip-ons: the bars,
      // levers and reservoirs sweep through an open pocket at racing lock.
      z: 0.27,
      c: [
        [0.17, 0.2],
        [0.198, 0.178],
        [0.222, 0.135],
        [0.246, 0.035],
        [0.258, -0.1],
        [0.243, -0.27],
        [0.216, -0.425],
        [0.12, -0.512],
        [0, -0.527],
      ],
    },
    {
      z: 0.4,
      c: [
        [0.176, 0.195],
        [0.204, 0.172],
        [0.228, 0.13],
        [0.249, 0.04],
        [0.259, -0.07],
        [0.243, -0.235],
        [0.215, -0.385],
        [0.118, -0.47],
        [0, -0.485],
      ],
    },
    {
      z: 0.46,
      c: [
        [0.17, 0.198],
        [0.196, 0.178],
        [0.222, 0.135],
        [0.245, 0.045],
        [0.255, -0.05],
        [0.24, -0.2],
        [0.211, -0.345],
        [0.114, -0.425],
        [0, -0.44],
      ],
    },
    {
      // Upper fairing rear edge and screen base.
      z: 0.52,
      c: [
        [0.142, 0.302],
        [0.162, 0.29],
        [0.186, 0.242],
        [0.224, 0.126],
        [0.246, 0.0],
        [0.232, -0.155],
        [0.205, -0.295],
        [0.108, -0.365],
        [0, -0.38],
      ],
    },
    {
      z: 0.57,
      c: [
        [0.125 * n, 0.298],
        [0.148 * n, 0.288],
        [0.172 * n, 0.245],
        [0.212 * n, 0.14],
        [0.236 * n, 0.02],
        [0.226 * n, -0.12],
        [0.2, -0.24],
        [0.105, -0.3],
        [0, -0.315],
      ],
    },
    {
      z: 0.67,
      c: [
        [0.085 * n, 0.287],
        [0.112 * n, 0.278],
        [0.14 * n, nose(0.242)],
        [0.183 * n, 0.15],
        [0.212 * n, 0.06],
        [0.208 * n, -0.02],
        [0.19 * n, -0.1],
        [0.1, -0.145],
        [0, -0.155],
      ],
    },
    {
      z: 0.79,
      c: [
        [0.004, nose(0.26)],
        [0.05 * n, nose(0.25)],
        [0.088 * n, nose(0.216)],
        [0.135 * n, 0.15],
        [0.168 * n, 0.08],
        [0.168 * n, 0.025],
        [0.15 * n, -0.02],
        [0.075, -0.042],
        [0, -0.048],
      ],
    },
    {
      z: 0.855,
      c: [
        [0, nose(0.215)],
        [0.035 * n, nose(0.208)],
        [0.065 * n, nose(0.184)],
        [0.098 * n, 0.135],
        [0.124 * n, 0.088],
        [0.122 * n, 0.052],
        [0.105 * n, 0.026],
        [0.052, 0.013],
        [0, 0.01],
      ],
    },
    {
      z: r2 ? 0.915 : 0.92,
      c: [
        [0, nose(0.15)],
        [0.02 * n, nose(0.146)],
        [0.038 * n, nose(0.132)],
        [0.06 * n, 0.105],
        [0.078 * n, 0.08],
        [0.076 * n, 0.06],
        [0.064 * n, 0.046],
        [0.032, 0.038],
        [0, 0.036],
      ],
    },
    {
      z: r2 ? 0.955 : 0.968,
      c: [
        [0, 0.094],
        [0.008, 0.093],
        [0.015, 0.09],
        [0.022, 0.083],
        [0.026, 0.075],
        [0.025, 0.067],
        [0.02, 0.062],
        [0.01, 0.059],
        [0, 0.058],
      ],
    },
  ]);
}

/** Fuel tank and airbox cover under the rider's chest, closing the opening
 * between the flank upper edges. Columns: crown to the hidden lower edge. */
function tankNet(variant: GpShellVariant): P3[][] {
  const r2 = variant === 'gpr2';
  const h = r2 ? 0.985 : 1;
  // A flat-topped, creased cover high under the rider's chest. The airbox
  // end stays behind the clip-on sweep (bars at z ~0.37-0.40).
  return net([
    {
      z: -0.21,
      c: [
        [0, 0.272],
        [0.06, 0.27],
        [0.098, 0.262],
        [0.118, 0.228],
        [0.12, 0.17],
        [0.11, 0.12],
      ],
    },
    {
      z: -0.1,
      c: [
        [0, 0.318 * h],
        [0.075, 0.316 * h],
        [0.118, 0.304],
        [0.142, 0.255],
        [0.146, 0.17],
        [0.14, 0.09],
      ],
    },
    {
      z: 0.03,
      c: [
        [0, 0.37 * h],
        [0.085, 0.367 * h],
        [0.13, 0.352],
        [0.157, 0.29],
        [0.162, 0.2],
        [0.158, 0.11],
      ],
    },
    {
      z: 0.15,
      c: [
        [0, 0.392 * h],
        [0.085, 0.389 * h],
        [0.13, 0.372],
        [0.157, 0.31],
        [0.163, 0.24],
        [0.16, 0.17],
      ],
    },
    {
      z: 0.25,
      c: [
        [0, 0.386 * h],
        [0.072, 0.382 * h],
        [0.11, 0.362],
        [0.134, 0.31],
        [0.142, 0.25],
        [0.14, 0.19],
      ],
    },
    {
      z: 0.31,
      c: [
        [0, 0.352],
        [0.05, 0.348],
        [0.078, 0.332],
        [0.096, 0.295],
        [0.104, 0.25],
        [0.1, 0.2],
      ],
    },
  ]);
}

/** Seat base, tail hump and undertail in one moulding. Columns: crown,
 * shoulder, upper fold, side, lower fold, underside, keel. */
function tailNet(variant: GpShellVariant): P3[][] {
  const r2 = variant === 'gpr2';
  // GP-R2 keeps a shallower, flatter tail; GP-R1 a tall stepped hump. Both
  // have flat flanks between two folds and a squared rear face (REF 018, 046).
  const hump = r2 ? 0.78 : 1;
  const top = (y: number) => 0.262 + (y - 0.262) * hump;
  return net([
    {
      z: -0.955,
      c: [
        [0, top(0.384)],
        [0.034, top(0.383)],
        [0.05, top(0.374)],
        [0.052, 0.33],
        [0.049, 0.286],
        [0.03, 0.272],
        [0, 0.27],
      ],
    },
    {
      z: -0.905,
      c: [
        [0, top(0.405)],
        [0.042, top(0.404)],
        [0.061, top(0.394)],
        [0.064, 0.335],
        [0.06, 0.264],
        [0.038, 0.25],
        [0, 0.247],
      ],
    },
    {
      z: -0.78,
      c: [
        [0, top(0.416)],
        [0.049, top(0.415)],
        [0.072, top(0.402)],
        [0.076, 0.33],
        [0.073, 0.244],
        [0.046, 0.225],
        [0, 0.221],
      ],
    },
    {
      z: -0.63,
      c: [
        [0, top(0.39)],
        [0.055, top(0.388)],
        [0.084, top(0.374)],
        [0.087, 0.305],
        [0.084, 0.221],
        [0.055, 0.196],
        [0, 0.192],
      ],
    },
    {
      z: -0.53,
      c: [
        [0, top(0.31)],
        [0.063, top(0.308)],
        [0.092, top(0.296)],
        [0.097, 0.25],
        [0.095, 0.188],
        [0.063, 0.164],
        [0, 0.159],
      ],
    },
    {
      z: -0.34,
      c: [
        [0, 0.262],
        [0.079, 0.26],
        [0.115, 0.252],
        [0.123, 0.212],
        [0.121, 0.155],
        [0.084, 0.128],
        [0, 0.122],
      ],
    },
    {
      z: -0.2,
      c: [
        [0, 0.262],
        [0.09, 0.258],
        [0.13, 0.247],
        [0.14, 0.2],
        [0.14, 0.13],
        [0.1, 0.1],
        [0, 0.095],
      ],
    },
  ]);
}

/** Thin padded seat on the tail crown. */
function seatNet(): P3[][] {
  return net([
    {
      z: -0.53,
      c: [
        [0, 0.296],
        [0.06, 0.295],
        [0.095, 0.29],
        [0.108, 0.278],
      ],
    },
    {
      z: -0.44,
      c: [
        [0, 0.284],
        [0.07, 0.283],
        [0.108, 0.278],
        [0.122, 0.264],
      ],
    },
    {
      z: -0.3,
      c: [
        [0, 0.281],
        [0.075, 0.28],
        [0.115, 0.274],
        [0.13, 0.258],
      ],
    },
    {
      z: -0.2,
      c: [
        [0, 0.284],
        [0.07, 0.283],
        [0.108, 0.276],
        [0.122, 0.26],
      ],
    },
  ]);
}

/** Transmissive bubble from the nose's open upper edge to its free top
 * edge. Columns: base on the fairing edge, side, upper side, crown. */
function screenNet(variant: GpShellVariant): P3[][] {
  const tall = variant === 'gpr2' ? 0.95 : 1;
  const crown = (y: number) => 0.3 + (y - 0.3) * tall;
  return net([
    {
      z: 0.52,
      c: [
        [0.142, 0.302],
        [0.137, 0.385],
        [0.102, crown(0.468)],
        [0, crown(0.505)],
      ],
    },
    {
      z: 0.575,
      c: [
        [0.125, 0.299],
        [0.12, 0.37],
        [0.09, crown(0.444)],
        [0, crown(0.478)],
      ],
    },
    {
      z: 0.63,
      c: [
        [0.11, 0.294],
        [0.105, 0.35],
        [0.078, crown(0.412)],
        [0, crown(0.44)],
      ],
    },
    {
      z: 0.7,
      c: [
        [0.076, 0.282],
        [0.073, 0.318],
        [0.054, crown(0.357)],
        [0, crown(0.377)],
      ],
    },
    {
      z: 0.755,
      c: [
        [0.032, 0.267],
        [0.031, 0.285],
        [0.023, crown(0.304)],
        [0, crown(0.314)],
      ],
    },
    {
      z: 0.788,
      c: [
        [0.005, 0.259],
        [0.005, 0.261],
        [0.004, 0.263],
        [0, 0.264],
      ],
    },
  ]);
}

/** Inner upper fairing (REF 017, 074, 088): the carbon cockpit floor inside
 * the nose, between the screen's base edges, that frames the race TFT from
 * the rider's eye. Its rear lip stays ahead of everything the steering
 * sweeps at racing lock and full fork travel (fork tubes, clamp, hoses;
 * z >= 0.545, checked in tests/gp-race-shell.test.ts); it dips under the
 * dash so the display stands proud of it. Columns: centre line to the
 * screen-base edge (faces up). */
export function gpInnerFairingNet(): P3[][] {
  return net([
    {
      z: 0.545,
      c: [
        [0, 0.276],
        [0.048, 0.278],
        [0.091, 0.286],
        [0.128, 0.296],
      ],
    },
    {
      z: 0.575,
      c: [
        [0, 0.274],
        [0.045, 0.277],
        [0.085, 0.285],
        [0.12, 0.295],
      ],
    },
    {
      z: 0.63,
      c: [
        [0, 0.272],
        [0.04, 0.275],
        [0.075, 0.282],
        [0.105, 0.29],
      ],
    },
    {
      z: 0.7,
      c: [
        [0, 0.266],
        [0.025, 0.268],
        [0.05, 0.272],
        [0.072, 0.278],
      ],
    },
  ]);
}

/** A closed aerofoil swept along a path; the chord follows +Z. */
function sweptFoil(
  path: readonly P3[],
  chord: number,
  thickness: number,
  segments: number,
  sides: number,
): T.BufferGeometry {
  const curve = new T.CatmullRomCurve3(
    path.map((p) => new T.Vector3(...p)),
    false,
    'centripetal',
  );
  const position: number[] = [],
    index: number[] = [];
  const tangent = new T.Vector3(),
    normal = new T.Vector3(),
    forward = new T.Vector3(0, 0, 1);
  // Section: NACA-like symmetric foil around the path, leading edge forward.
  const section: [number, number][] = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const u = (Math.cos(a) + 1) / 2; // 0 trailing .. 1 leading
    const half =
      5 *
      thickness *
      (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    section.push([(u - 0.35) * chord, Math.sign(Math.sin(a)) * half * chord]);
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    // Thickness direction is perpendicular to both the path and the chord.
    normal.crossVectors(tangent, forward).normalize();
    if (normal.lengthSq() < 0.5) normal.set(0, 1, 0);
    const chordDir = new T.Vector3().crossVectors(normal, tangent).normalize();
    if (chordDir.z < 0) chordDir.negate();
    for (const [c, h] of section)
      position.push(
        p.x + chordDir.x * c + normal.x * h,
        p.y + chordDir.y * c + normal.y * h,
        p.z + chordDir.z * c + normal.z * h,
      );
  }
  for (let i = 0; i < segments; i++)
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k,
        b = i * sides + ((k + 1) % sides),
        c = a + sides,
        d = b + sides;
      index.push(a, c, b, b, c, d);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function mirrorGeometry(g: T.BufferGeometry) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const index = m.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  m.computeVertexNormals();
  return m;
}
function pair(g: T.BufferGeometry) {
  const merged = mergeGeometries([g, mirrorGeometry(g)], false)!;
  g.dispose();
  return merged;
}

/** Nose box wings: an upper blade from the cheek out to an end plate that
 * turns down and returns as a lower blade, enclosing an open box. */
function boxWings(variant: GpShellVariant, detail: RiderDetail): T.BufferGeometry {
  const high = detail === 'high';
  const r2 = variant === 'gpr2';
  const z = r2 ? 0.72 : 0.755;
  const loop: P3[] = r2
    ? [
        [0.205, 0.105, z + 0.01],
        [0.25, 0.115, z],
        [0.292, 0.1, z - 0.01],
        [0.31, 0.06, z - 0.015],
        [0.3, 0.012, z - 0.02],
        [0.262, -0.008, z - 0.02],
        [0.218, -0.01, z - 0.015],
      ]
    : [
        [0.195, 0.09, z + 0.02],
        [0.238, 0.098, z + 0.01],
        [0.278, 0.084, z],
        [0.298, 0.05, z - 0.005],
        [0.29, 0.012, z - 0.01],
        [0.258, -0.004, z - 0.01],
        [0.212, -0.006, z - 0.005],
      ];
  const wing = sweptFoil(loop, r2 ? 0.15 : 0.135, 0.12, high ? 28 : 12, high ? 10 : 6);
  // Inner slat: a short third element between the blades (REF 056, 060).
  const slat = sweptFoil(
    r2
      ? [
          [0.215, 0.05, z - 0.0],
          [0.255, 0.052, z - 0.005],
          [0.288, 0.045, z - 0.01],
        ]
      : [
          [0.2, 0.045, z + 0.01],
          [0.24, 0.047, z + 0.005],
          [0.276, 0.042, z],
        ],
    0.085,
    0.1,
    high ? 8 : 4,
    high ? 8 : 6,
  );
  const both = mergeGeometries([wing, slat], false)!;
  wing.dispose();
  slat.dispose();
  return pair(both);
}

/** Ground-effect side scoops low on the fairing behind the front tyre. */
function lowerScoops(variant: GpShellVariant, detail: RiderDetail): T.BufferGeometry {
  const high = detail === 'high';
  const r2 = variant === 'gpr2';
  const g = sweptFoil(
    [
      [0.238, -0.12, 0.395],
      [0.262, -0.175, 0.38],
      [0.268, -0.235, 0.36],
      [0.252, -0.285, 0.34],
    ],
    r2 ? 0.16 : 0.14,
    0.14,
    high ? 14 : 6,
    high ? 10 : 6,
  );
  return pair(g);
}

/** Ram-air mouth under the nose tip: a dark recessed lip. */
function intakeMouth(variant: GpShellVariant, detail: RiderDetail): T.BufferGeometry {
  const r2 = variant === 'gpr2';
  const panel: ShellPanel = {
    name: 'GP ram-air mouth',
    rows: detail === 'high' ? 3 : 1,
    cols: detail === 'high' ? 3 : 1,
    net: net([
      {
        z: 0.9,
        c: [
          [0, 0.07],
          [0.04, 0.066],
          [0.062, 0.05],
          [0.058, 0.03],
          [0, 0.02],
        ],
      },
      {
        z: r2 ? 0.938 : 0.95,
        c: [
          [0, 0.074],
          [0.03, 0.071],
          [0.047, 0.058],
          [0.044, 0.044],
          [0, 0.04],
        ],
      },
    ]),
  };
  return shellPanelGeometry(panel);
}

/** Swingarm "spoon": a cupped carbon deflector under the arm ahead of the
 * rear tyre (REF 018, 030, 046). Swingarm frame: pivot at the origin, the
 * rear axle at z = -arm; it follows the tyre at a constant radius. */
export function gpSwingarmSpoon(arm: number, detail: RiderDetail): T.BufferGeometry {
  const rows = detail === 'high' ? 4 : 2,
    cols = detail === 'high' ? 3 : 1;
  const section = (angle: number, r: number, w: number): P3[] => {
    // angle: from straight ahead of the axle, turning down under the tyre.
    const z = -arm + Math.cos(angle) * r,
      y = -Math.sin(angle) * r;
    const lip = 0.035;
    // Lip first, keel last: with stations ascending along +Z this winds the
    // visible underside outward (down), the lip outward (sideways).
    return [
      [w + 0.01, y + lip, z + 0.01],
      [w, y + 0.006, z],
      [w * 0.6, y - 0.004, z],
      [0, y, z],
    ];
  };
  return shellPanelGeometry({
    name: 'GP swingarm spoon',
    net: [
      section(0.95, 0.37, 0.07),
      section(0.78, 0.372, 0.095),
      section(0.58, 0.375, 0.11),
      section(0.4, 0.378, 0.1),
    ],
    rows,
    cols,
    creases: [1],
  });
}

// ---- Livery -------------------------------------------------------------

type ZY = readonly [number, number];
const ATLAS = { w: 2048, h: 1024 };
function atlasPoint(side: 1 | -1, [z, y]: ZY): [number, number] {
  const f = GP_LIVERY_FRAME;
  const u = (z - f.zMin) / (f.zMax - f.zMin),
    v = (f.yMax - y) / (f.yMax - f.yMin);
  return [side > 0 ? (1 - u) * 1024 : 1024 + u * 1024, v * ATLAS.h];
}
const PX_PER_M = 1024 / (GP_LIVERY_FRAME.zMax - GP_LIVERY_FRAME.zMin);

/** Clearcoat (R) and roughness (G) of each painted zone: the livery is a
 * colour atlas plus this finish atlas sharing the same side-view UVs, so
 * ducts, seams and satin keels read as different surfaces, not one gloss. */
const FINISH = Object.freeze({
  gloss: '#ff4700',
  satin: '#80a000',
  matte: '#00f000',
});
type Finish = keyof typeof FINISH;

interface LiveryPen {
  poly(points: readonly ZY[], colour: string, finish?: Finish): void;
  line(points: readonly ZY[], width: number, colour: string, finish?: Finish): void;
  dots(points: readonly ZY[], radius: number, colour: string): void;
  text(
    value: string,
    at: ZY,
    height: number,
    width: number,
    colour: string,
    style?: WordmarkStyle,
  ): void;
  mark(brand: string, at: ZY, w: number, h: number, colour: string): void;
}

function pen(
  c: CanvasRenderingContext2D,
  side: 1 | -1,
  finishOnly: boolean,
  accent: string,
): LiveryPen {
  const path = (points: readonly ZY[]) => {
    c.beginPath();
    points.forEach((p, i) => {
      const [x, y] = atlasPoint(side, p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
  };
  return {
    poly(points, colour, finish = 'gloss') {
      path(points);
      c.closePath();
      c.fillStyle = finishOnly ? FINISH[finish] : colour;
      c.fill();
    },
    line(points, width, colour, finish = 'gloss') {
      path(points);
      c.lineWidth = Math.max(1, width * PX_PER_M);
      c.lineJoin = 'round';
      c.strokeStyle = finishOnly ? FINISH[finish] : colour;
      c.stroke();
    },
    dots(points, radius, colour) {
      if (finishOnly) return;
      c.fillStyle = colour;
      for (const p of points) {
        const [x, y] = atlasPoint(side, p);
        c.beginPath();
        c.arc(x, y, Math.max(1, radius * PX_PER_M), 0, Math.PI * 2);
        c.fill();
      }
    },
    text(value, at, height, width, colour, style = { weight: 0.2, slant: 0.12, tracking: 0.08 }) {
      if (finishOnly) return;
      const [x, y] = atlasPoint(side, at);
      c.strokeStyle = colour;
      drawWordmark(
        c,
        value,
        x,
        y,
        fitHeight(value, width * PX_PER_M, height * PX_PER_M, style),
        style,
      );
    },
    mark(brand, at, w, h, colour) {
      if (finishOnly || !(brand in BRAND_ART)) return;
      const [x, y] = atlasPoint(side, at);
      drawMark(
        c,
        { ...BRAND_ART[brand as keyof typeof BRAND_ART], ink: colour, accent },
        x - (w * PX_PER_M) / 2,
        y - (h * PX_PER_M) / 2,
        w * PX_PER_M,
        h * PX_PER_M,
      );
    },
  };
}

/** One flank of an original race livery, in metres on the side view. */
function drawLivery(p: LiveryPen, entrant: number, variant: GpShellVariant) {
  const scheme = liveryScheme(entrant);
  const number = String((entrant % 98) + 2).padStart(2, '0');
  const base = new T.Color(scheme.primary);
  const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
  const ink = lum > 0.55 ? '#15191d' : '#f1f2ed';
  const keel = `#${new T.Color(scheme.secondary).getHexString()}`;
  const seam = `#${base.clone().multiplyScalar(0.42).getHexString()}`;
  const black = '#08090a';
  const accent = scheme.accent;
  const r2 = variant === 'gpr2';
  // Satin keel: lower flank and belly pan under a rising sweep.
  p.poly(
    [
      [1.0, -0.1],
      [0.5, -0.1],
      [0.3, -0.19],
      [0.0, -0.27],
      [-0.3, -0.3],
      [-0.3, -0.62],
      [1.0, -0.62],
    ],
    keel,
    'satin',
  );
  p.line(
    [
      [0.5, -0.1],
      [0.3, -0.19],
      [0.0, -0.27],
      [-0.3, -0.3],
    ],
    0.012,
    accent,
  );
  // Nose duct: the matte recess under the cheek fold that carries the wings.
  p.poly(
    r2
      ? [
          [0.96, 0.07],
          [0.8, 0.088],
          [0.6, 0.065],
          [0.47, 0.0],
          [0.46, -0.07],
          [0.6, -0.04],
          [0.8, 0.0],
          [0.96, 0.05],
        ]
      : [
          [0.96, 0.066],
          [0.8, 0.078],
          [0.62, 0.052],
          [0.49, -0.005],
          [0.48, -0.075],
          [0.62, -0.045],
          [0.8, -0.005],
          [0.96, 0.046],
        ],
    black,
    'matte',
  );
  // Exit gills behind the radiator, raked like the reference flanks; the
  // carbon louvre blades sit in front of them.
  p.poly(
    [
      [0.44, 0.13],
      [0.27, 0.115],
      [0.21, -0.075],
      [0.36, -0.06],
    ],
    black,
    'matte',
  );
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    p.line(
      [
        [0.27 - 0.06 * t + 0.012, 0.115 - 0.19 * t],
        [0.44 - 0.08 * t - 0.012, 0.13 - 0.19 * t],
      ],
      0.009,
      '#2b2f33',
      'satin',
    );
  }
  // Knee-grip pads on the tank flanks (textured, matte).
  p.poly(
    [
      [0.1, 0.33],
      [-0.06, 0.315],
      [-0.17, 0.268],
      [-0.17, 0.205],
      [0.0, 0.205],
      [0.12, 0.25],
    ],
    '#16181a',
    'matte',
  );
  // Shoulder stripe along the brow fold, into the tank.
  p.line(
    [
      [0.94, 0.135],
      [0.79, 0.2],
      [0.6, 0.238],
      [0.42, 0.238],
      [0.25, 0.205],
    ],
    0.016,
    '#eceee8',
  );
  p.line(
    [
      [0.93, 0.118],
      [0.78, 0.18],
      [0.6, 0.215],
      [0.42, 0.214],
      [0.26, 0.186],
    ],
    0.006,
    accent,
  );
  // Panel seams and quick-release fasteners: upper/lower fairing joint,
  // nose cone joint and the side panel's rear return.
  const joint: ZY[] = [
    [0.47, -0.065],
    [0.3, -0.115],
    [0.12, -0.15],
    [-0.08, -0.17],
  ];
  p.line(joint, 0.004, seam, 'matte');
  p.line(
    [
      [0.66, 0.28],
      [0.62, 0.15],
      [0.6, 0.02],
    ],
    0.003,
    seam,
    'matte',
  );
  p.line(
    [
      [-0.07, 0.03],
      [-0.1, -0.2],
      [-0.15, -0.45],
    ],
    0.004,
    seam,
    'matte',
  );
  p.dots(
    [
      [0.42, -0.08],
      [0.2, -0.137],
      [0.0, -0.162],
      [0.64, 0.24],
      [0.615, 0.08],
      [-0.085, -0.08],
      [-0.12, -0.32],
      [0.15, -0.5],
      [-0.05, -0.51],
    ],
    0.0045,
    '#9aa0a6',
  );
  // Belly cooling slots.
  for (let i = 0; i < 4; i++) {
    const z = 0.2 - i * 0.07;
    p.poly(
      [
        [z, -0.49],
        [z - 0.045, -0.495],
        [z - 0.05, -0.515],
        [z - 0.005, -0.51],
      ],
      black,
      'matte',
    );
  }
  // Title partner across the flank; secondary partners and model badges.
  p.text(scheme.title, [0.06, -0.06], 0.055, 0.3, ink, {
    weight: 0.24,
    slant: 0.14,
    tracking: 0.06,
  });
  p.text(scheme.partners[0], [0.16, -0.225], 0.026, 0.26, '#f1f2ed');
  p.text(scheme.partners[1], [0.68, 0.17], 0.02, 0.16, ink);
  p.text('MOTOBOUND', [0.0, -0.38], 0.03, 0.34, '#f1f2ed', {
    weight: 0.22,
    slant: 0.16,
    tracking: 0.12,
  });
  p.text(r2 ? 'GP-R2  PROTOTYPE' : 'GP-R1  PROTOTYPE', [0.33, 0.2], 0.012, 0.16, ink, {
    weight: 0.16,
    tracking: 0.2,
  });
  // Dense small partner tags at a real machine's sticker scale.
  const tags: [string, ZY, number, string][] = [
    ['TITAN-X', [0.85, 0.105], 0.07, ink],
    ['KESTREL', [0.73, 0.115], 0.07, ink],
    ['VOLTEX', [0.06, 0.07], 0.1, ink],
    ['GRIPLINE', [0.36, -0.29], 0.1, '#f1f2ed'],
    ['ORBITEL', [0.22, -0.42], 0.09, '#f1f2ed'],
    ['AXON', [0.55, -0.2], 0.05, '#f1f2ed'],
    ['NORTHLINE', [-0.4, 0.2], 0.11, ink],
    ['VANTA', [-0.88, 0.25], 0.06, ink],
    ['SILVERLINE', [0.1, 0.015], 0.1, ink],
  ];
  for (const [value, at, width, colour] of tags)
    p.text(value, at, 0.014, width, colour, { weight: 0.16, tracking: 0.08 });
  // Tail: number in a light raked bay, partner on the hump.
  p.poly(
    [
      [-0.6, 0.36],
      [-0.94, 0.395],
      [-0.96, 0.278],
      [-0.64, 0.262],
    ],
    '#eceee8',
  );
  p.line(
    [
      [-0.6, 0.36],
      [-0.64, 0.262],
    ],
    0.008,
    accent,
  );
  p.text(number, [-0.79, 0.322], 0.08, 0.2, '#16191d', {
    weight: 0.27,
    slant: 0.17,
    tracking: 0.12,
    width: 1,
  });
  p.line(
    [
      [-0.2, 0.13],
      [-0.6, 0.19],
      [-0.98, 0.268],
    ],
    0.012,
    keel,
    'satin',
  );
  // Tank: accent pinstripe and a small model badge.
  p.line(
    [
      [0.34, 0.296],
      [0.1, 0.276],
      [-0.2, 0.244],
    ],
    0.005,
    accent,
  );
}

/** Colour and finish atlases for one entrant. */
export function gpLiveryTextures(entrant: number, variant: GpShellVariant) {
  const scheme = liveryScheme(entrant);
  const draw = (finishOnly: boolean) => (c: CanvasRenderingContext2D) => {
    c.fillStyle = finishOnly ? FINISH.gloss : scheme.primary;
    c.fillRect(0, 0, ATLAS.w, ATLAS.h);
    for (const side of [1, -1] as const)
      drawLivery(pen(c, side, finishOnly, scheme.accent), entrant, variant);
  };
  const map = canvasTexture(ATLAS.w, ATLAS.h, draw(false));
  const finish = canvasTexture(ATLAS.w / 2, ATLAS.h / 2, (c) => {
    c.scale(0.5, 0.5);
    draw(true)(c);
  });
  finish.colorSpace = T.NoColorSpace;
  return { map, finish };
}

/** Front number decal art: number on a light oval bay. */
function noseNumberTexture(entrant: number, accent: string) {
  const number = String((entrant % 98) + 2).padStart(2, '0');
  return canvasTexture(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = '#eceee8';
    c.beginPath();
    c.ellipse(128, 128, 118, 92, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = accent;
    c.lineWidth = 7;
    c.stroke();
    c.strokeStyle = '#15181c';
    const style = { weight: 0.27, slant: 0.14, tracking: 0.12, width: 1 };
    drawWordmark(c, number, 128, 132, fitHeight(number, 190, 120, style), style);
  });
}

// ---- Assembly -----------------------------------------------------------

const liveryMaterials = new WeakMap<BikeMaterials, Map<GpShellVariant, T.MeshPhysicalMaterial>>();
const satinCarbon = new WeakMap<BikeMaterials, T.MeshPhysicalMaterial>();

/** Raw satin carbon for the inner upper fairing: matte so the cockpit floor
 * throws no sky glare into the rider's sightline (REF 017/088). */
export function gpSatinCarbon(materials: BikeMaterials) {
  let material = satinCarbon.get(materials);
  if (material) return material;
  material = carbonMaterial('satin');
  material.name = 'GP satin carbon (inner fairing)';
  tagWeatherSurface(material, 'paint', 0.8);
  materials.list.push(material);
  satinCarbon.set(materials, material);
  return material;
}

/** Orange peel in the clear coat only (REF 018/028/056): a filtered
 * polyurethane height field at about 1.5 mm cells, sampled in the livery's
 * side-view UVs (one U unit spans 4.08 m, one V unit 1.24 m). The paint
 * colour and decals below stay flat; the coat's reflections ripple. */
const PAINT_PEEL = Object.freeze({ repeat: [200, 60] as const, scale: 0.16 });
const noseMaterials = new WeakMap<BikeMaterials, T.MeshPhysicalMaterial>();

/** Entrant paint shared by all LODs of one machine. */
export function gpLiveryMaterial(
  materials: BikeMaterials,
  entrant: number,
  variant: GpShellVariant,
) {
  let byVariant = liveryMaterials.get(materials);
  if (!byVariant) liveryMaterials.set(materials, (byVariant = new Map()));
  let material = byVariant.get(variant);
  if (material) return material;
  const { map, finish } = gpLiveryTextures(entrant, variant);
  const peel = bikeSurfaceMaps('paint');
  peel.roughnessMap.dispose();
  peel.normalMap.repeat.set(...PAINT_PEEL.repeat);
  peel.normalMap.name = 'GP clear-coat orange peel';
  material = new T.MeshPhysicalMaterial({
    map,
    roughness: 1,
    roughnessMap: finish,
    metalness: 0,
    clearcoat: 1,
    clearcoatMap: finish,
    clearcoatRoughness: 0.035,
    clearcoatNormalMap: peel.normalMap,
    clearcoatNormalScale: new T.Vector2(PAINT_PEEL.scale, PAINT_PEEL.scale),
    name: 'GP race shell livery (clear-coated)',
  });
  installShellInterior(material);
  tagWeatherSurface(material, 'paint');
  materials.list.push(material);
  byVariant.set(variant, material);
  return material;
}

function noseNumberMaterial(materials: BikeMaterials, entrant: number) {
  let material = noseMaterials.get(materials);
  if (material) return material;
  material = new T.MeshPhysicalMaterial({
    map: noseNumberTexture(entrant, liveryScheme(entrant).accent),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    name: 'GP nose number',
  });
  tagWeatherSurface(material, 'paint');
  materials.list.push(material);
  noseMaterials.set(materials, material);
  return material;
}

export interface GpRaceBodywork {
  root: T.Group;
  body: T.Mesh;
  tank: T.Mesh;
  tail: T.Mesh;
}

/** Build the complete race shell for one LOD. Geometry is owned per model;
 * materials are owned by the entrant's BikeMaterials. */
export function gpRaceBodywork(
  materials: BikeMaterials,
  detail: RiderDetail,
  variant: GpShellVariant,
  entrant: number,
  transmissive = detail === 'high',
): GpRaceBodywork {
  const root = new T.Group();
  root.name = `GP race shell R6 ${variant} (${detail})`;
  const high = detail === 'high',
    far = detail === 'far';
  const paint = gpLiveryMaterial(materials, entrant, variant);
  const mesh = (geometry: T.BufferGeometry, material: T.Material, name: string, shadow = true) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const m = new T.Mesh(geometry, material);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const rows = high ? 4 : far ? 1 : 2,
    cols = high ? 3 : far ? 1 : 2;
  const painted = (geometries: T.BufferGeometry[]) => {
    const merged = mergeGeometries(
      geometries.map((g) => liveryUv(g)),
      false,
    )!;
    geometries.forEach((g) => g.dispose());
    return merged;
  };
  const bodyGeometry = liveryUv(
    shellPanelGeometry({
      name: 'GP flank and nose',
      net: bodyNet(variant),
      creases: [2, 4, 6],
      ridge: true,
      caps: { end: true },
      rows,
      cols,
      exclude: gpFrontTyreExclusion,
    }),
  );
  const tankGeometry = liveryUv(
    shellPanelGeometry({ name: 'GP tank cover', net: tankNet(variant), creases: [2], rows, cols }),
  );
  const tailGeometry = liveryUv(
    shellPanelGeometry({
      name: 'GP tail',
      net: tailNet(variant),
      creases: [2, 4],
      rows,
      cols,
      caps: { start: true },
    }),
  );
  const body = mesh(bodyGeometry, paint, 'GP race shell / flank and nose');
  const tank = mesh(tankGeometry, paint, 'GP race shell / tank');
  const tail = mesh(tailGeometry, paint, 'GP race shell / tail');
  if (!far) {
    mesh(painted([boxWings(variant, detail)]), paint, 'GP race shell / box wings');
    mesh(
      painted([lowerScoops(variant, detail)]),
      materials.carbon,
      'GP race shell / ground-effect scoops',
    );
    mesh(intakeMouth(variant, detail), materials.dark, 'GP race shell / ram-air mouth', false);
    mesh(
      shellPanelGeometry({ name: 'GP seat', net: seatNet(), rows, cols }),
      materials.seat,
      'GP race shell / seat pad',
    );
    mesh(
      shellPanelGeometry({ name: 'GP inner upper fairing', net: gpInnerFairingNet(), rows, cols }),
      gpSatinCarbon(materials),
      'GP race shell / inner upper fairing',
    );
  }
  const screen = mesh(
    shellPanelGeometry({
      name: 'GP screen',
      net: screenNet(variant),
      rows: high ? 4 : 2,
      // Finer around the arch at high LOD: its free rim is the onboard view's
      // horizon line and must read as a curve, not a polygon.
      cols: high ? 7 : 2,
    }),
    transmissive ? materials.screen : materials.screenLight,
    'GP race shell / screen',
    false,
  );
  screen.renderOrder = 2;
  if (!far) {
    // Front number, projected onto the actual nose skin.
    body.updateMatrixWorld(true);
    const decal = new DecalGeometry(
      body,
      new T.Vector3(0, variant === 'gpr2' ? 0.17 : 0.162, 0.873),
      new T.Euler(-0.78, 0, 0),
      new T.Vector3(0.15, 0.11, 0.2),
    );
    if (decal.getAttribute('position').count) {
      // Clipped decal vertices carry interpolated, slightly short normals.
      decal.normalizeNormals();
      mesh(decal, noseNumberMaterial(materials, entrant), 'GP race shell / nose number', false);
    } else decal.dispose();
  }
  root.userData.gpRaceShell = 'r6';
  return { root, body, tank, tail };
}
