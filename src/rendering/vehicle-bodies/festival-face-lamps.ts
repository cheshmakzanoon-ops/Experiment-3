import * as T from 'three';
import type { ClosedBodyModel, Greenhouse } from './closed-body.ts';
import type { CarMaterials } from './common.ts';
import { roundedBox, type Pt } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

export interface FaceLamp {
  side: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outline: Pt[];
}
/** Original conventional headlights occupy the upright bumper face. Their
 * outlines and the centre grille share the same available cross-section. */
export function festivalFaceLamps(model: ClosedBodyModel): FaceLamp[] {
  const s = model.s;
  if (!s.bonnetPress || !s.frontSweep || s.bondedHeadlamps) return [];
  const z = model.zFront,
    profile = model.ring(z, 0).half;
  const low = Math.min(...profile.map((p) => p[1])),
    high = Math.max(...profile.map((p) => p[1])),
    span = high - low;
  const round = s.lamps.front === 'round',
    twin = s.lamps.front === 'twin',
    truck = s.style === 'truck';
  const height = Math.min(
    span * (round ? 0.52 : twin ? 0.39 : truck ? 0.31 : 0.3),
    round ? 0.165 : twin ? 0.154 : truck ? 0.18 : 0.109,
  );
  const y = low + span * (truck ? 0.67 : round ? 0.64 : 0.69),
    edge = Math.min(model.sideX(z, y - height / 2), model.sideX(z, y + height / 2));
  const width = round
    ? height
    : Math.min(edge * (twin ? 0.48 : 0.49), height * (twin ? 2.18 : truck ? 2.1 : 3.55));
  return [-1, 1].map((side) => {
    const x = side * (edge - width / 2 - (truck ? 0.04 : 0.033));
    let uv: Pt[];
    if (round)
      uv = Array.from({ length: 28 }, (_, i) => [
        Math.cos((i * 2 * Math.PI) / 28) * 0.5,
        Math.sin((i * 2 * Math.PI) / 28) * 0.5,
      ]);
    else if (truck)
      uv = [
        [-0.49, -0.35],
        [-0.41, -0.5],
        [0.43, -0.5],
        [0.5, -0.33],
        [0.5, 0.33],
        [0.41, 0.5],
        [-0.38, 0.5],
        [-0.5, 0.3],
      ];
    else if (twin)
      uv = [
        [-0.5, -0.28],
        [-0.38, -0.5],
        [0.34, -0.46],
        [0.49, -0.27],
        [0.5, 0.27],
        [0.36, 0.49],
        [-0.35, 0.5],
        [-0.49, 0.3],
      ];
    else
      uv = [
        [-0.5, -0.13],
        [-0.37, -0.47],
        [0.31, -0.42],
        [0.5, -0.17],
        [0.47, 0.48],
        [0.23, 0.43],
        [-0.38, 0.19],
      ];
    const outline = uv.map(([u, v]): Pt => [x + side * u * width, y + v * height]);
    if (side < 0) outline.reverse();
    return { side, x, y, width, height, outline };
  });
}

export function addFestivalFaceLamps(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  pockets: FaceLamp[],
  optics: { dark: T.Material; clear: T.Material; amber: T.Material },
) {
  const z = model.zFront,
    truck = model.s.style === 'truck',
    round = model.s.lamps.front === 'round',
    twin = model.s.lamps.front === 'twin';
  for (const p of pockets) {
    const pane = (scale: number, d: number) => {
      const shape = new T.Shape(
        p.outline.map(([x, y]) => new T.Vector2(p.x + (x - p.x) * scale, p.y + (y - p.y) * scale)),
      );
      return new T.ShapeGeometry(shape).translate(0, 0, z + d);
    };
    // A tapering reveal gives every opening a dark seal and a separate,
    // enclosed reflector basin behind its outer lens.
    const ring = (outer: number, inner: number, front: number, back: number) => {
      const v: number[] = [],
        idx: number[] = [];
      for (const [x, y] of p.outline) {
        v.push(
          p.x + (x - p.x) * outer,
          p.y + (y - p.y) * outer,
          z + front,
          p.x + (x - p.x) * inner,
          p.y + (y - p.y) * inner,
          z + back,
        );
      }
      for (let k = 0; k < p.outline.length; k++) {
        const a = 2 * k,
          b = 2 * ((k + 1) % p.outline.length);
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const far = detail === 2;
    if (far) parts.add(pane(1, 0.005), optics.dark);
    else {
      parts.add(ring(1.003, 0.91, 0.0005, -0.009), sharedMaterials.trim());
      parts.add(ring(0.91, 0.78, -0.009, -0.046), optics.dark);
      parts.add(pane(0.81, -0.047), optics.dark);
    }
    const seat = far ? 0.009 : -0.027;
    const projector = (centre: number, r: number) => {
      const segments = detail === 0 ? 24 : detail === 1 ? 14 : 8;
      if (!far) {
        const bowl = new T.LatheGeometry(
          [
            new T.Vector2(r * 0.46, -0.012),
            new T.Vector2(r * 0.64, -0.009),
            new T.Vector2(r * 0.93, 0.001),
            new T.Vector2(r, 0.006),
            new T.Vector2(r * 0.94, 0.009),
          ],
          segments,
        ).rotateX(Math.PI / 2);
        parts.add(bowl, sharedMaterials.chrome(), placed(centre, p.y, z + seat));
      }
      const lens = new T.SphereGeometry(1, segments, far ? 4 : 8).scale(
        r * 0.65,
        r * 0.65,
        far ? 0.002 : 0.009,
      );
      parts.add(lens, mats.head, placed(centre, p.y, z + seat + 0.003));
    };
    if (round || twin) {
      const r = Math.min(p.height * 0.38, p.width / (twin ? 4.9 : 2.5));
      if (twin) for (const offset of [-1, 1]) projector(p.x + offset * p.width * 0.202, r);
      else projector(p.x, r);
    } else {
      const units = truck ? 3 : 2;
      for (let i = 0; i < units; i++)
        projector(
          p.x + p.side * ((i + 0.5) / units - 0.5) * p.width * 0.71,
          Math.min(p.height * 0.23, p.width * 0.11),
        );
      const guide = roundedBox(
        p.width * (truck ? 0.66 : 0.69),
        truck ? 0.01 : 0.007,
        far ? 0.002 : 0.005,
        0.002,
        1,
      );
      parts.add(
        guide,
        mats.head,
        placed(
          p.x,
          p.y + p.height * (truck ? 0.28 : 0.12),
          z + seat + 0.006,
          0,
          0,
          p.side * (truck ? 0 : 0.06),
        ),
      );
      if (!far)
        parts.add(
          roundedBox(0.01, p.height * 0.4, 0.004, 0.002, 1),
          optics.amber,
          placed(p.x + p.side * p.width * 0.37, p.y + p.height * 0.025, z - 0.012),
        );
    }
    if (!far) parts.add(pane(0.965, -0.002), optics.clear);
  }
}

/** The RP-6 roof light is an auxiliary forward projector array. A sealed
 * alloy extrusion carries heat fins behind it and bolts to two roof feet. */
export function addPickupRoofLamp(
  parts: Parts,
  greenhouse: Greenhouse,
  mats: CarMaterials,
  detail: Detail,
) {
  const width = greenhouse.model.s.width * 0.58,
    z = greenhouse.zRF - 0.09;
  const section = greenhouse.control(z),
    [footX, roofY] = section[3];
  const y = roofY + 0.093,
    casing = sharedMaterials.trim(),
    metal = sharedMaterials.steel();
  parts.add(roundedBox(width, 0.087, 0.104, 0.012, detail === 0 ? 2 : 1), casing, placed(0, y, z));
  for (const side of [-1, 1]) {
    parts.add(
      roundedBox(0.085, 0.026, 0.14, 0.009, 1),
      casing,
      placed(side * footX, roofY + 0.008, z),
    );
    parts.add(
      roundedBox(0.034, 0.065, 0.072, 0.008, 1),
      metal,
      placed(side * footX, roofY + 0.044, z),
    );
  }
  if (detail !== 2)
    for (const offset of [-0.022, 0, 0.022])
      parts.add(
        new T.BoxGeometry(width - 0.034, 0.007, 0.013),
        metal,
        placed(0, y + offset, z - 0.056),
      );
  const cells = detail === 2 ? 8 : 16,
    pitch = (width - 0.078) / cells;
  for (let i = 0; i < cells; i++) {
    const x = (i - (cells - 1) / 2) * pitch;
    if (detail !== 2) {
      const bowl = new T.LatheGeometry(
        [new T.Vector2(0.012, 0.001), new T.Vector2(0.024, 0.005), new T.Vector2(0.03, 0.012)],
        detail === 0 ? 12 : 8,
      ).rotateX(Math.PI / 2);
      parts.add(bowl, sharedMaterials.chrome(), placed(x, y, z + 0.053));
    }
    const lens =
      detail === 2
        ? new T.PlaneGeometry(0.063, 0.032)
        : new T.CircleGeometry(0.014, detail === 0 ? 12 : 8);
    parts.add(lens, mats.head, placed(x, y, z + 0.057));
  }
}
