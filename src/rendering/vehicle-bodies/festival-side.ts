import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { ClosedBodyModel } from './closed-body.ts';
import type { CarMaterials } from './common.ts';
import { roundedBox, type Pt } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { placed, type Parts } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Original stamped-panel construction for the RH3 and SC7. Dimensions are
 * authored in metres; the reference photographs guide construction, not a
 * claim of measured replicas. No new material or texture is allocated. */
export const FESTIVAL_DOOR_JOINT = Object.freeze({
  width: 0.0055,
  floorWidth: 0.0029,
  depth: 0.003,
  handleClearance: 0.014,
});

const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Only the sampled rocker-to-belt segment moves. Its endpoints and all
 * wheel, shoulder and deck samples retain their original positions. */
export function shapeFestivalSide(
  model: ClosedBodyModel,
  z: number,
  half: Pt[],
  counts: readonly number[],
) {
  const amount = model.s.sideSculpt;
  if (!amount) return;
  const { f, s } = model,
    front = f.frontAxle - f.radius - 0.075,
    rear = s.sideIntake
      ? f.rearAxle + f.radius + 0.39 + 0.28 + 0.035
      : f.rearAxle + f.radius + 0.075;
  if (z <= rear || z >= front) return;
  const along = Math.sin(((z - rear) / (front - rear)) * Math.PI) ** 2,
    start = counts[0] + counts[1] + counts[2] + counts[3];
  for (let i = 1; i < counts[4]; i++) {
    const index = start + i,
      [x, y] = half[index];
    half[index] = [x - amount * along * Math.sin((i / counts[4]) * Math.PI) ** 2, y];
  }
}

export interface FestivalDoorPath {
  name: 'perimeter' | 'divider';
  /** Longitudinal z and vertical y in the vehicle frame. */
  points: Pt[];
  /** First point of the aft boundary, used to place the rear-door hardware. */
  rearStart?: number;
}

function quadratic(points: Pt[], a: Pt, control: Pt, b: Pt, steps: number) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    points.push([
      u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
    ]);
  }
}

/** A complete rounded lower perimeter, with an arch-following RH3 rear
 * boundary. The SC7 door stops before the separate side-intake opening. */
export function festivalDoorPaths(model: ClosedBodyModel, detail: Detail = 0): FestivalDoorPath[] {
  if (!model.s.sideSculpt) return [];
  const { f, s } = model,
    [ws, rf, rr] = s.cabin,
    lower = f.y(s.floor + 0.14),
    frontTop = Math.min(f.z(ws) - 0.04, f.frontAxle - 0.18),
    frontFoot = f.frontAxle - f.radius - 0.12,
    rounded = detail === 0 ? 6 : 4;
  const points: Pt[] = [
    [frontTop, model.topY(frontTop) + 0.015],
    [frontFoot + 0.03, lower + 0.17],
    [frontFoot + 0.012, lower + 0.07],
  ];
  quadratic(points, points.at(-1)!, [frontFoot + 0.012, lower], [frontFoot - 0.06, lower], rounded);
  let rearStart: number;
  if (s.style === 'saloon') {
    const radius = f.radius + 0.105,
      edge = f.rearAxle + radius,
      rise = Math.min(0.06, f.hubRear - lower);
    points.push([edge + 0.06, lower]);
    rearStart = points.length - 1;
    quadratic(points, points.at(-1)!, [edge, lower], [edge, lower + rise], rounded);
    if (f.hubRear > lower + rise + 1e-6) points.push([edge, f.hubRear]);
    const count = detail === 0 ? 10 : 7;
    for (let i = 1; i <= count; i++) {
      const angle = (i / count) * 1.3;
      points.push([f.rearAxle + radius * Math.cos(angle), f.hubRear + radius * Math.sin(angle)]);
    }
    const top = f.rearAxle + 0.035;
    points.push([top, model.topY(top) + 0.015]);
  } else {
    const top = f.z(rr) - 0.025,
      foot = top + 0.06;
    points.push([foot + 0.07, lower]);
    rearStart = points.length - 1;
    quadratic(points, points.at(-1)!, [foot, lower], [foot, lower + 0.07], rounded);
    points.push([top, model.topY(top) + 0.015]);
  }
  const paths: FestivalDoorPath[] = [{ name: 'perimeter', points, rearStart }];
  if (s.style === 'saloon') {
    // This is the same B-pillar station used by Greenhouse.material().
    const pillar = (f.z(rf) + f.z(rr)) / 2 - 0.08;
    paths.push({
      name: 'divider',
      points: [
        [pillar, lower],
        [pillar, model.topY(pillar) + 0.015],
      ],
    });
  }
  return paths;
}

interface Ribbon {
  polygon: Pt[];
  a: Pt;
  normal: Pt;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

/** Mitered ends make adjacent strips share one boundary, including the
 * sampled round corners. Their interiors never stack over one another. */
function ribbons(paths: FestivalDoorPath[], width: number): Ribbon[] {
  const result: Ribbon[] = [];
  for (const path of paths) {
    const points = path.points,
      normals = points.slice(1).map((b, i): Pt => {
        const a = points[i],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      }),
      miters = points.map((_, i): Pt => {
        if (i === 0) return normals[0];
        if (i === points.length - 1) return normals.at(-1)!;
        const a = normals[i - 1],
          b = normals[i],
          denominator = 1 + a[0] * b[0] + a[1] * b[1];
        return [(a[0] + b[0]) / denominator, (a[1] + b[1]) / denominator];
      });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        ma = miters[i],
        mb = miters[i + 1];
      // Counterclockwise in projected z/y coordinates.
      const polygon: Pt[] = [
        [a[0] - ma[0] * width, a[1] - ma[1] * width],
        [b[0] - mb[0] * width, b[1] - mb[1] * width],
        [b[0] + mb[0] * width, b[1] + mb[1] * width],
        [a[0] + ma[0] * width, a[1] + ma[1] * width],
      ];
      result.push({
        polygon,
        a,
        normal: normals[i],
        minZ: Math.min(...polygon.map((p) => p[0])),
        maxZ: Math.max(...polygon.map((p) => p[0])),
        minY: Math.min(...polygon.map((p) => p[1])),
        maxY: Math.max(...polygon.map((p) => p[1])),
      });
    }
  }
  return result;
}

/** Split the production skin itself into retained paint, painted bevels and
 * recessed dark floors. Intersections interpolate the original triangle's
 * surface and UVs; a drawn line above an intact body cannot pass this cut. */
export function cutFestivalDoorJoints(
  geometry: T.BufferGeometry,
  model: ClosedBodyModel,
  detail: Detail,
) {
  const strips = ribbons(festivalDoorPaths(model, detail), FESTIVAL_DOOR_JOINT.width / 2);
  if (!strips.length || detail === 2) return;
  const positions = Array.from(geometry.getAttribute('position').array),
    normals = Array.from(geometry.getAttribute('normal').array),
    uvs = Array.from(geometry.getAttribute('uv').array),
    source = geometry.getIndex();
  if (!source) throw new Error('Door joints require the indexed painted body loft');
  const batches = new Map<number, number[]>();
  const emit = (polygon: number[], material: number) => {
    let batch = batches.get(material);
    if (!batch) batches.set(material, (batch = []));
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      const ab = new T.Vector3()
          .fromArray(positions, b * 3)
          .sub(new T.Vector3().fromArray(positions, a * 3)),
        ac = new T.Vector3()
          .fromArray(positions, c * 3)
          .sub(new T.Vector3().fromArray(positions, a * 3));
      if (ab.cross(ac).lengthSq() > 1e-20) batch.push(a, b, c);
    }
  };
  const interpolate = (a: number, b: number, t: number) => {
    const index = positions.length / 3;
    for (let c = 0; c < 3; c++) {
      positions.push(positions[a * 3 + c] + t * (positions[b * 3 + c] - positions[a * 3 + c]));
      normals.push(normals[a * 3 + c] + t * (normals[b * 3 + c] - normals[a * 3 + c]));
    }
    for (let c = 0; c < 2; c++) uvs.push(uvs[a * 2 + c] + t * (uvs[b * 2 + c] - uvs[a * 2 + c]));
    const length = Math.hypot(...normals.slice(index * 3, index * 3 + 3));
    if (length) for (let c = 0; c < 3; c++) normals[index * 3 + c] /= length;
    return index;
  };
  const split = (polygon: number[], distance: (id: number) => number) => {
    const inside: number[] = [],
      outside: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = distance(a),
        db = distance(b);
      if (da >= -1e-10) inside.push(a);
      if (da <= 1e-10) outside.push(a);
      if ((da > 1e-10 && db < -1e-10) || (da < -1e-10 && db > 1e-10)) {
        const cut = interpolate(a, b, da / (da - db));
        inside.push(cut);
        outside.push(cut);
      }
    }
    return { inside, outside };
  };
  const sunk = (
    polygon: number[],
    side: number,
    distance: (id: number) => number,
    bevel: boolean,
  ) => {
    const shifted = polygon.map((id) => {
      const d = bevel
        ? FESTIVAL_DOOR_JOINT.depth *
          clamp(
            (FESTIVAL_DOOR_JOINT.width / 2 - Math.abs(distance(id))) /
              ((FESTIVAL_DOOR_JOINT.width - FESTIVAL_DOOR_JOINT.floorWidth) / 2),
            0,
            1,
          )
        : FESTIVAL_DOOR_JOINT.depth;
      const copy = interpolate(id, id, 0);
      positions[copy * 3] -= side * d;
      return copy;
    });
    if (bevel && shifted.length >= 3) {
      const a = new T.Vector3().fromArray(positions, shifted[0] * 3),
        n = new T.Vector3();
      for (let i = 1; i < shifted.length - 1; i++) {
        n.fromArray(positions, shifted[i] * 3)
          .sub(a)
          .cross(new T.Vector3().fromArray(positions, shifted[i + 1] * 3).sub(a));
        if (n.lengthSq() > 1e-20) break;
      }
      if (n.lengthSq() > 1e-20) {
        n.normalize();
        for (const id of shifted) {
          normals[id * 3] = n.x;
          normals[id * 3 + 1] = n.y;
          normals[id * 3 + 2] = n.z;
        }
      }
    }
    emit(shifted, bevel ? 0 : 1);
  };
  for (const group of geometry.groups) {
    const material = group.materialIndex ?? 0;
    for (let k = group.start; k < group.start + group.count; k += 3) {
      const triangle = [source.getX(k), source.getX(k + 1), source.getX(k + 2)];
      if (
        material !== 0 ||
        triangle.some((id) => Math.abs(positions[id * 3]) < model.halfBase * 0.6)
      ) {
        emit(triangle, material);
        continue;
      }
      const side = Math.sign(positions[triangle[0] * 3]);
      let remaining = [triangle];
      for (const strip of strips) {
        const next: number[][] = [];
        for (const polygon of remaining) {
          if (
            polygon.every((id) => positions[id * 3 + 2] < strip.minZ) ||
            polygon.every((id) => positions[id * 3 + 2] > strip.maxZ) ||
            polygon.every((id) => positions[id * 3 + 1] < strip.minY) ||
            polygon.every((id) => positions[id * 3 + 1] > strip.maxY)
          ) {
            next.push(polygon);
            continue;
          }
          let inside = polygon;
          for (let i = 0; i < strip.polygon.length && inside.length; i++) {
            const a = strip.polygon[i],
              b = strip.polygon[(i + 1) % strip.polygon.length];
            const parts = split(
              inside,
              (id) =>
                (b[0] - a[0]) * (positions[id * 3 + 1] - a[1]) -
                (b[1] - a[1]) * (positions[id * 3 + 2] - a[0]),
            );
            if (parts.outside.length >= 3) next.push(parts.outside);
            inside = parts.inside;
          }
          if (inside.length >= 3) {
            const distance = (id: number) =>
              (positions[id * 3 + 2] - strip.a[0]) * strip.normal[0] +
              (positions[id * 3 + 1] - strip.a[1]) * strip.normal[1];
            const left = split(inside, (id) => FESTIVAL_DOOR_JOINT.floorWidth / 2 - distance(id));
            sunk(left.outside, side, distance, true);
            const right = split(
              left.inside,
              (id) => FESTIVAL_DOOR_JOINT.floorWidth / 2 + distance(id),
            );
            sunk(right.outside, side, distance, true);
            sunk(right.inside, side, distance, false);
          }
        }
        remaining = next;
      }
      for (const polygon of remaining) emit(polygon, material);
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  const indices: number[] = [];
  geometry.clearGroups();
  for (const [material, batch] of batches) {
    geometry.addGroup(indices.length, batch.length, material);
    indices.push(...batch);
  }
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Separate folded sill with a narrow dark underside. The rounded longitudinal
 * taper terminates inside the painted body before either wheel envelope. */
export function addFestivalSills(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
) {
  if (!model.s.sideSculpt || detail === 2) return;
  const { f, s } = model,
    start = f.rearAxle + f.radius + 0.085,
    end = f.frontAxle - f.radius - 0.085,
    count = Math.ceil((end - start) / (detail === 0 ? 0.035 : 0.075)),
    bottom = f.y(s.floor + 0.026),
    top = f.y(s.floor + 0.127);
  for (const side of [-1, 1]) {
    const paint: number[] = [],
      trim: number[] = [];
    const section = (z: number) => {
      const t = smooth((z - start) / 0.16) * smooth((end - z) / 0.16);
      return [
        [bottom, -0.008],
        [bottom, 0.014],
        [bottom + 0.024, 0.017],
        [top - 0.022, 0.018],
        [top, 0.001],
        [top - 0.003, -0.008],
      ].map(
        ([y, out]) =>
          new T.Vector3(side * (model.sideX(z, y, detail) + (out + 0.01) * t - 0.01), y, z),
      );
    };
    let previous = section(start);
    for (let i = 1; i <= count; i++) {
      const current = section(start + ((end - start) * i) / count);
      for (let j = 0; j < previous.length; j++) {
        const k = (j + 1) % previous.length,
          vertices =
            side > 0
              ? [previous[j], previous[k], current[j], current[j], previous[k], current[k]]
              : [previous[j], current[j], previous[k], current[j], current[k], previous[k]],
          target = j < 2 ? trim : paint;
        for (const vertex of vertices) target.push(vertex.x, vertex.y, vertex.z);
      }
      previous = current;
    }
    for (const [values, material] of [
      [paint, mats.paint],
      [trim, sharedMaterials.trim()],
    ] as const) {
      const geometry = new T.BufferGeometry().setAttribute(
        'position',
        new T.Float32BufferAttribute(values, 3),
      );
      geometry.computeVertexNormals();
      parts.add(geometry, material);
    }
  }
}

/** Original handle meshes and mounting order are retained. Only the RH3 rear
 * assembly moves; its complete generated envelope must fit ahead of the joint. */
export function addFestivalDoorHandles(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  side: number,
) {
  const { f, s } = model,
    [, rf, rr] = s.cabin,
    classic = s.lamps.front === 'round' && s.numbers === 'none',
    stations = s.style === 'saloon' ? [(rf + rr) * 0.5 - 0.1, rr - 0.03] : [(rf + rr) * 0.5 + 0.06];
  for (let i = 0; i < stations.length; i++) {
    let z = f.z(stations[i]);
    const y = f.y(s.belt) + 0.04,
      recess = roundedBox(0.012, 0.036, 0.15, 0.011, 2),
      grip = roundedBox(0.022, 0.018, 0.119, 0.007, 2);
    if (s.sideSculpt && s.style === 'saloon' && i === 1) {
      recess.computeBoundingBox();
      grip.computeBoundingBox();
      const envelope = recess
          .boundingBox!.clone()
          .union(grip.boundingBox!.clone().translate(new T.Vector3(0, 0.002, 0))),
        low = y + envelope.min.y,
        high = y + envelope.max.y,
        perimeter = festivalDoorPaths(model)[0],
        rear = perimeter.points.slice(perimeter.rearStart);
      let boundary = -Infinity;
      for (let k = 1; k < rear.length; k++) {
        const a = rear[k - 1],
          b = rear[k];
        if (Math.max(a[1], b[1]) < low || Math.min(a[1], b[1]) > high) continue;
        for (const h of [low, high]) {
          const t = a[1] === b[1] ? 0 : clamp((h - a[1]) / (b[1] - a[1]), 0, 1);
          boundary = Math.max(boundary, a[0] + t * (b[0] - a[0]));
        }
      }
      z = Math.max(
        z,
        boundary +
          FESTIVAL_DOOR_JOINT.width / 2 +
          FESTIVAL_DOOR_JOINT.handleClearance -
          envelope.min.z,
      );
    }
    const x = model.sideX(z, y);
    if (x < 0.1) {
      recess.dispose();
      grip.dispose();
      continue;
    }
    parts.add(recess, sharedMaterials.trim(), placed(side * (x + 0.006), y, z));
    parts.add(
      grip,
      classic ? sharedMaterials.chrome() : mats.paint,
      placed(side * (x + 0.018), y + 0.002, z),
    );
  }
}
