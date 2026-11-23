import * as T from 'three';
import type { CarMaterials } from './common.ts';
import type { BodyFrame } from './frame.ts';
import type { Ring } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import type { Parts } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Clockwise as seen looking along +Z. Each station runs from the inboard
 * lower corner around the bright upper lip and back under the outside cheek. */
const MOUTH = [
  [0, 0.32],
  [0.035, 0.76],
  [0.13, 0.96],
  [0.32, 1],
  [0.79, 0.93],
  [0.95, 0.82],
  [1, 0.61],
  [0.95, 0.43],
  [0.72, 0.25],
  [0.32, 0.035],
  [0.14, 0],
  [0.04, 0.085],
] as const;

function strip(a: T.Vector3[], b: T.Vector3[], flip: boolean) {
  const vertices = [...a, ...b];
  const index: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length,
      k = i + a.length,
      l = j + a.length;
    index.push(...(flip ? [i, j, k, j, l, k] : [i, k, j, j, k, l]));
  }
  const geom = new T.BufferGeometry().setFromPoints(vertices);
  geom.setIndex(index);
  geom.computeVertexNormals();
  return geom;
}

/** Forward-facing radiator mouths, including the painted outer moulding,
 * rolled lip, narrowing carbon throat and recessed honeycomb face. The rear
 * shell runs into the existing sidepod. The front of the duct clears the tub. */
export function addFormulaInlets(
  parts: Parts,
  frame: BodyFrame,
  materials: CarMaterials,
  podWidth: number,
  model: string,
  detail: Detail,
) {
  const inner = 0.246,
    span = podWidth - inner;
  const z = frame.frontAxle - (model === 'fr3' ? 0.74 : 0.77);
  const lipHeight = model === 'fx26' ? 0.193 : model === 'jf2' ? 0.208 : 0.175;
  const bottom = frame.y(model === 'fr3' ? 0.235 : 0.224);
  const profile = detail === 2 ? MOUTH.filter((_, i) => i % 2 === 0) : MOUTH;
  for (const side of [-1, 1]) {
    const ring = (width: number, height: number, dz: number, dy: number) =>
      profile.map(
        ([u, v]) =>
          new T.Vector3(
            side * (inner + span * (0.5 + (u - 0.5) * width)),
            bottom + (0.5 + (v - 0.5) * height) * lipHeight + dy,
            z + dz - u * 0.04 + v * 0.025,
          ),
      );
    const rear = ring(1.11, 1.12, -0.39, -0.029);
    const outside = ring(1, 1, -0.014, 0);
    const bead = ring(0.965, 0.952, 0, 0);
    const inside = ring(0.87, 0.78, -0.003, 0.002);
    const screen = ring(0.72, 0.61, -0.067, 0.002);
    const flip = side < 0;
    parts.add(strip(rear, outside, flip), materials.paint);
    parts.add(strip(outside, bead, flip), materials.paint);
    parts.add(strip(bead, inside, flip), materials.accent);
    parts.add(strip(inside, screen, flip), sharedMaterials.carbonSatin());
    const centre = screen
      .reduce((v, p) => v.add(p), new T.Vector3())
      .multiplyScalar(1 / screen.length);
    const face = new T.BufferGeometry().setFromPoints([...screen, centre]);
    const indices: number[] = [];
    for (let i = 0; i < screen.length; i++) {
      const next = (i + 1) % screen.length;
      indices.push(screen.length, flip ? i : next, flip ? next : i);
    }
    face.setIndex(indices);
    face.computeVertexNormals();
    parts.add(face, sharedMaterials.grille());
  }
}

function numberPanel(vertices: number[], uv: number[], indices: number[]) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A number panel on the rising nose. Both long edges follow the original
 * loft, with UVs oriented for a viewer looking towards the driver. */
export function addFormulaNoseNumber(
  parts: Parts,
  materials: CarMaterials,
  noseZ: number,
  topAt: (z: number) => number,
) {
  const vertices: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4,
      z = noseZ - 0.27 - t * 0.25;
    const half = 0.072 + t * 0.021;
    for (const side of [-1, 1]) {
      vertices.push(side * half, topAt(z) + 0.0018, z);
      uv.push((side + 1) / 2, t);
    }
    if (i > 0) {
      const a = 2 * (i - 1);
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  parts.add(numberPanel(vertices, uv, indices), materials.board);
}

/** The side numbers wrap around the engine cover, above the shoulder. Sample
 * the actual loft profile to keep both decals seated as the tail tapers. */
export function addFormulaCoverNumbers(
  parts: Parts,
  materials: CarMaterials,
  cockpitZ: number,
  profile: (z: number) => Ring,
  topAt: (z: number) => number,
) {
  for (const side of [-1, 1]) {
    const vertices: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    for (let station = 0; station <= 6; station++) {
      const t = station / 6,
        z = cockpitZ - 0.54 - t * 0.29;
      const section = profile(z).half,
        top = topAt(z) - 0.068;
      for (let row = 0; row <= 3; row++) {
        const v = row / 3,
          y = top - 0.172 * (1 - v);
        let width = 0;
        for (let i = 1; i < section.length; i++) {
          const [ax, ay] = section[i - 1],
            [bx, by] = section[i];
          if (ay === by || y < Math.min(ay, by) || y > Math.max(ay, by)) continue;
          width = Math.max(width, ax + (bx - ax) * ((y - ay) / (by - ay)));
        }
        vertices.push(side * (width + 0.0025), y, z);
        uv.push(side > 0 ? t : 1 - t, v);
        if (station > 0 && row > 0) {
          const a = (station - 1) * 4 + row - 1;
          indices.push(
            ...(side > 0
              ? [a, a + 4, a + 1, a + 1, a + 4, a + 5]
              : [a, a + 1, a + 4, a + 1, a + 5, a + 4]),
          );
        }
      }
    }
    parts.add(numberPanel(vertices, uv, indices), materials.board);
  }
}
