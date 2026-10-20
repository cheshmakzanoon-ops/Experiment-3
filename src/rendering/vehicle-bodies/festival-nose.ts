import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { ClosedBodyModel } from './closed-body.ts';
import type { Pt } from './loft.ts';
import { placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** The two original road-car front ends share a smooth, monotone sweep. It
 * starts beyond the front wheel arch, so the axle, arch and collision envelope
 * remain fixed. Every exterior assembly uses the same map after construction. */
function noseProjection(model: ClosedBodyModel, x: number, z: number) {
  const sweep = model.s.frontSweep ?? 0;
  const depth = Math.max(0.3, model.s.overhang[0] - model.f.radius - 0.09);
  const t = clamp((z - model.zFront + depth) / depth, 0, 1);
  const blend = t * t * (3 - 2 * t);
  const half = model.halfWidth(model.zFront),
    h2 = half * half;
  const shape = (x * x) / (h2 + x * x);
  return {
    z: z - sweep * shape * blend,
    dx: (-sweep * blend * 2 * x * h2) / (h2 + x * x) ** 2,
    dz: 1 - (sweep * shape * 6 * t * (1 - t)) / depth,
  };
}

export function festivalNoseZ(model: ClosedBodyModel, x: number, z: number) {
  return model.s.frontSweep ? noseProjection(model, x, z).z : z;
}

/** Maximum sampled chord deviation of the curved nose, in metres. Small
 * hardware that is already straight under this map needs no extra triangles. */
const NOSE_CHORD_ERROR = [0.00045, 0.0015, 0.006] as const;

/** One deformation for painted skin, real ducts, lamp pockets and aero edges.
 * Its inverse-transpose keeps the curved shading normals consistent. The
 * position map has a positive longitudinal derivative throughout this kit. */
export function warpFestivalNose(
  geometry: T.BufferGeometry,
  model: ClosedBodyModel,
  detail: Detail = 0,
) {
  if (!model.s.frontSweep) return;
  const start = model.f.frontAxle + model.f.radius + 0.09;
  geometry.computeBoundingBox();
  if (geometry.boundingBox!.max.z <= start) return;
  tessellateNose(geometry, model, start, NOSE_CHORD_ERROR[detail]);
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  const n = new T.Vector3();
  for (let i = 0; i < position.count; i++) {
    const warp = noseProjection(model, position.getX(i), position.getZ(i));
    if (warp.z === position.getZ(i) && warp.dx === 0 && warp.dz === 1) continue;
    position.setZ(i, warp.z);
    if (normal) {
      n.set(
        normal.getX(i) - (warp.dx * normal.getZ(i)) / warp.dz,
        normal.getY(i),
        normal.getZ(i) / warp.dz,
      ).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Subdivide where the actual sweep departs from a straight chord. A fixed
 * 75 mm grid previously inflated straight grille slats and splitter plates.
 * Quarter-point probes catch the smoothstep's inflection, where a midpoint
 * alone could incorrectly accept a bent edge. Interior probes cover the
 * mixed lateral/longitudinal curvature. Existing hard normals and every
 * material group/vertex channel survive interpolation unchanged. */
function tessellateNose(
  geometry: T.BufferGeometry,
  model: ClosedBodyModel,
  start: number,
  tolerance: number,
) {
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => ({
    name,
    size: attribute.itemSize,
    normalized: attribute.normalized,
    values: Array.from(attribute.array),
  }));
  const positions = attributes.find((a) => a.name === 'position')!.values;
  const source = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: positions.length / 3 }, (_, i) => i);
  const groups = geometry.groups.length
    ? geometry.groups.map((g) => ({ ...g }))
    : [{ start: 0, count: source.length, materialIndex: 0 }];
  const indices: number[] = [],
    revisedGroups: typeof groups = [];
  const sweep = model.s.frontSweep ?? 0,
    depth = Math.max(0.3, model.s.overhang[0] - model.f.radius - 0.09),
    halfSquared = model.halfWidth(model.zFront) ** 2;
  const projectedZ = (x: number, z: number) => {
    const t = clamp((z - model.zFront + depth) / depth, 0, 1);
    return z - ((sweep * x * x) / (halfSquared + x * x)) * t * t * (3 - 2 * t);
  };
  const mappedZ: number[] = [];
  for (let i = 0; i < positions.length; i += 3)
    mappedZ.push(projectedZ(positions[i], positions[i + 2]));
  const edgeSize = (a: number, b: number) =>
    Math.max(
      Math.abs(positions[a * 3] - positions[b * 3]),
      Math.abs(positions[a * 3 + 2] - positions[b * 3 + 2]),
    );
  const edgeErrors = new Map<string, number>();
  const edgeError = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = edgeErrors.get(key);
    if (cached !== undefined) return cached;
    let error = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = positions[a * 3] + (positions[b * 3] - positions[a * 3]) * t,
        z = positions[a * 3 + 2] + (positions[b * 3 + 2] - positions[a * 3 + 2]) * t;
      error = Math.max(
        error,
        Math.abs(projectedZ(x, z) - (mappedZ[a] + (mappedZ[b] - mappedZ[a]) * t)),
      );
    }
    edgeErrors.set(key, error);
    return error;
  };
  const interiorError = (a: number, b: number, c: number) => {
    let error = 0;
    for (const [u, v, w] of [
      [1 / 3, 1 / 3, 1 / 3],
      [0.5, 0.25, 0.25],
      [0.25, 0.5, 0.25],
      [0.25, 0.25, 0.5],
    ]) {
      const x = positions[a * 3] * u + positions[b * 3] * v + positions[c * 3] * w,
        z = positions[a * 3 + 2] * u + positions[b * 3 + 2] * v + positions[c * 3 + 2] * w;
      error = Math.max(
        error,
        Math.abs(projectedZ(x, z) - (mappedZ[a] * u + mappedZ[b] * v + mappedZ[c] * w)),
      );
    }
    return error;
  };
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = midpoints.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    for (const attribute of attributes)
      for (let c = 0; c < attribute.size; c++)
        attribute.values.push(
          (attribute.values[a * attribute.size + c] + attribute.values[b * attribute.size + c]) *
            0.5,
        );
    mappedZ.push(projectedZ(positions[index * 3], positions[index * 3 + 2]));
    midpoints.set(key, index);
    return index;
  };
  const centroid = (a: number, b: number, c: number) => {
    const index = positions.length / 3;
    for (const attribute of attributes)
      for (let k = 0; k < attribute.size; k++)
        attribute.values.push(
          (attribute.values[a * attribute.size + k] +
            attribute.values[b * attribute.size + k] +
            attribute.values[c * attribute.size + k]) /
            3,
        );
    mappedZ.push(projectedZ(positions[index * 3], positions[index * 3 + 2]));
    return index;
  };
  const split = (a: number, b: number, c: number, depth = 0) => {
    const ux = positions[b * 3] - positions[a * 3],
      uy = positions[b * 3 + 1] - positions[a * 3 + 1],
      uz = positions[b * 3 + 2] - positions[a * 3 + 2],
      vx = positions[c * 3] - positions[a * 3],
      vy = positions[c * 3 + 1] - positions[a * 3 + 1],
      vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const areaSquared =
      (uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2;
    // Loft caps can contain collinear source triangles. They have no surface
    // to curve; repeatedly refining their collapsed edges cannot add detail.
    if (areaSquared < 1e-20) return;
    if (depth > 32) throw new Error('Festival nose chord refinement did not converge');
    if (Math.max(positions[a * 3 + 2], positions[b * 3 + 2], positions[c * 3 + 2]) <= start) {
      indices.push(a, b, c);
      return;
    }
    const ab = edgeError(a, b),
      bc = edgeError(b, c),
      ca = edgeError(c, a);
    if (Math.max(ab, bc, ca) <= tolerance) {
      if (interiorError(a, b, c) > tolerance) {
        // Keep already-accepted boundary chords intact. Both incident faces
        // then make identical edge splits, avoiding tiny T-junction cracks.
        const m = centroid(a, b, c);
        split(a, b, m, depth + 1);
        split(b, c, m, depth + 1);
        split(c, a, m, depth + 1);
        return;
      } else {
        indices.push(a, b, c);
        return;
      }
    }
    if (Math.max(edgeSize(a, b), edgeSize(b, c), edgeSize(c, a)) < 0.001) {
      indices.push(a, b, c);
      return;
    }
    const sizeAB = ab > tolerance ? edgeSize(a, b) : -1,
      sizeBC = bc > tolerance ? edgeSize(b, c) : -1,
      sizeCA = ca > tolerance ? edgeSize(c, a) : -1;
    if (sizeAB >= sizeBC && sizeAB >= sizeCA) {
      const m = midpoint(a, b);
      split(a, m, c, depth + 1);
      split(m, b, c, depth + 1);
    } else if (sizeBC >= sizeCA) {
      const m = midpoint(b, c);
      split(a, b, m, depth + 1);
      split(a, m, c, depth + 1);
    } else {
      const m = midpoint(c, a);
      split(a, b, m, depth + 1);
      split(m, b, c, depth + 1);
    }
  };
  for (const group of groups) {
    const first = indices.length;
    for (let k = group.start; k < group.start + group.count; k += 3)
      split(source[k], source[k + 1], source[k + 2]);
    revisedGroups.push({
      start: first,
      count: indices.length - first,
      materialIndex: group.materialIndex,
    });
  }
  for (const attribute of attributes)
    geometry.setAttribute(
      attribute.name,
      new T.Float32BufferAttribute(attribute.values, attribute.size, attribute.normalized),
    );
  geometry.setIndex(indices);
  geometry.clearGroups();
  for (const group of revisedGroups)
    geometry.addGroup(group.start, group.count, group.materialIndex);
}

export interface FestivalLampPocket {
  side: number;
  width: number;
  depth: number;
  base: T.Matrix4;
  inverse: T.Matrix4;
  /** Counter-clockwise in local X/Z; local +Y is the outward normal. */
  outline: Pt[];
}

/** The SC7's twin outlets sit ahead of the windscreen/cowl transition. Their
 * base is horizontal; each visible piece follows the evaluated bonnet height
 * independently, so a rigid plate cannot bridge the curved fender surface. */
export function festivalBonnetPockets(model: ClosedBodyModel): FestivalLampPocket[] {
  if (!model.s.frontSweep || !model.s.bonnetVents) return [];
  const z = model.f.frontAxle + Math.min(0.23, model.s.overhang[0] * 0.25),
    width = 0.235,
    depth = 0.28;
  return [-1, 1].map((side) => {
    const x = side * model.halfWidth(z) * 0.47,
      base = placed(x, model.surfaceY(z, Math.abs(x)), z);
    const outline: Pt[] = [
      [-0.5, -0.4],
      [-0.42, -0.5],
      [0.42, -0.5],
      [0.5, -0.4],
      [0.38, 0.5],
      [-0.38, 0.5],
    ].map(([u, v]) => [u * width, v * depth]);
    return { side, width, depth, base, inverse: base.clone().invert(), outline };
  });
}

/** Original bonded lamp outlines, informed by the separate lamp housing and
 * white guide in references 091/099. Dimensions are authored, not measured. */
export function festivalLampPockets(model: ClosedBodyModel): FestivalLampPocket[] {
  if (!model.s.frontSweep) return [];
  const z = model.zFront - 0.18,
    half = model.halfWidth(z);
  const width = model.s.style === 'supercar' ? 0.4 : 0.37;
  const depth = model.s.style === 'supercar' ? 0.15 : 0.17;
  return [-1, 1].map((side) => {
    const x = side * half * 0.66,
      ax = Math.abs(x);
    const dz = (model.surfaceY(z + 0.015, ax) - model.surfaceY(z - 0.015, ax)) / 0.03;
    const dx = (model.surfaceY(z, ax + 0.015) - model.surfaceY(z, Math.max(0, ax - 0.015))) / 0.03;
    const base = placed(x, model.surfaceY(z, ax), z, -Math.atan(dz), 0, side * Math.atan(dx));
    const outline: Pt[] = [
      [-0.5, -0.33],
      [-0.43, 0.35],
      [0.29, 0.47],
      [0.5, 0.08],
      [0.4, -0.46],
    ].map(([u, v]) => [side * u * width, v * depth]);
    const area = outline.reduce((sum, p, i) => {
      const q = outline[(i + 1) % outline.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    if (area < 0) outline.reverse();
    return { side, width, depth, base, inverse: base.clone().invert(), outline };
  });
}

/** Follow the actual curved fender along the aperture's projection normal,
 * ensuring the lens reveal meets the clipped body instead of floating above. */
export function festivalLampEdge(
  model: ClosedBodyModel,
  pocket: FestivalLampPocket,
  point: Pt,
  offset = 0,
) {
  let y = 0;
  const world = new T.Vector3();
  const error = (height: number) => {
    world.set(point[0], height, point[1]).applyMatrix4(pocket.base);
    return world.y - model.surfaceY(world.z, Math.abs(world.x));
  };
  for (let k = 0; k < 5; k++) {
    const e = error(y),
      derivative = (error(y + 0.001) - e) / 0.001;
    if (Math.abs(derivative) < 0.05) break;
    y = clamp(y - e / derivative, -0.08, 0.08);
  }
  return world.set(point[0], y + offset, point[1]).applyMatrix4(pocket.base);
}

/** Surface-following rubber reveal and the inner wall of the physical pocket.
 * Both merge into existing trim/optics batches; the pane adds no new material. */
export function festivalLampReveal(
  model: ClosedBodyModel,
  pocket: FestivalLampPocket,
  wall = false,
) {
  const positions: number[] = [],
    indices: number[] = [];
  for (const point of pocket.outline) {
    const edge = wall
      ? new T.Vector3(point[0] * 0.94, -0.008, point[1] * 0.94).applyMatrix4(pocket.base)
      : festivalLampEdge(model, pocket, point, 0.0003);
    const inner = new T.Vector3(
      point[0] * (wall ? 0.89 : 0.94),
      wall ? -0.049 : -0.008,
      point[1] * (wall ? 0.89 : 0.94),
    ).applyMatrix4(pocket.base);
    positions.push(...edge.toArray(), ...inner.toArray());
  }
  for (let i = 0; i < pocket.outline.length; i++) {
    const a = i * 2,
      b = ((i + 1) % pocket.outline.length) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function festivalLampPane(model: ClosedBodyModel, pocket: FestivalLampPocket) {
  const points = [festivalLampEdge(model, pocket, [0, 0], 0.001)];
  for (const p of pocket.outline)
    points.push(festivalLampEdge(model, pocket, [p[0] * 0.95, p[1] * 0.95], 0.001));
  const indices: number[] = [];
  for (let i = 0; i < pocket.outline.length; i++)
    indices.push(0, ((i + 1) % pocket.outline.length) + 1, i + 1);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      points.flatMap((p) => p.toArray()),
      3,
    ),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Subtract the two convex lamp apertures from the actual loft triangles.
 * Sequential half-plane clipping retains disjoint outside fragments and
 * interpolates position, normal and UV at every intersection. Underbody faces
 * fall outside the local height band and remain intact. */
export function cutFestivalBodyPockets(geometry: T.BufferGeometry, model: ClosedBodyModel) {
  const pockets = [...festivalLampPockets(model), ...festivalBonnetPockets(model)];
  if (!pockets.length) return;
  const position = Array.from(geometry.getAttribute('position').array);
  const normal = Array.from(geometry.getAttribute('normal').array);
  const uv = Array.from(geometry.getAttribute('uv').array);
  const sourceIndex = geometry.getIndex();
  if (!sourceIndex) throw new Error('A lamp pocket requires the indexed body loft');
  const indices: number[] = [],
    groups: { start: number; count: number; materialIndex: number }[] = [];
  type Vertex = { id: number; local: T.Vector3 };
  const vertex = (id: number, inverse: T.Matrix4): Vertex => ({
    id,
    local: new T.Vector3(position[id * 3], position[id * 3 + 1], position[id * 3 + 2]).applyMatrix4(
      inverse,
    ),
  });
  const intersection = (a: Vertex, b: Vertex, t: number): Vertex => {
    const id = position.length / 3;
    for (let c = 0; c < 3; c++) {
      position.push(position[a.id * 3 + c] + t * (position[b.id * 3 + c] - position[a.id * 3 + c]));
      normal.push(normal[a.id * 3 + c] + t * (normal[b.id * 3 + c] - normal[a.id * 3 + c]));
    }
    const length = Math.hypot(normal[id * 3], normal[id * 3 + 1], normal[id * 3 + 2]);
    if (length > 0) for (let c = 0; c < 3; c++) normal[id * 3 + c] /= length;
    for (let c = 0; c < 2; c++)
      uv.push(uv[a.id * 2 + c] + t * (uv[b.id * 2 + c] - uv[a.id * 2 + c]));
    return { id, local: a.local.clone().lerp(b.local, t) };
  };
  const subtract = (triangle: number[], pocket: FestivalLampPocket): number[][] => {
    let inside = triangle.map((id) => vertex(id, pocket.inverse));
    if (
      inside.every((v) => v.local.y < -0.085) ||
      inside.every((v) => v.local.y > 0.085) ||
      inside.every((v) => v.local.x < -pocket.width * 0.55) ||
      inside.every((v) => v.local.x > pocket.width * 0.55) ||
      inside.every((v) => v.local.z < -pocket.depth * 0.55) ||
      inside.every((v) => v.local.z > pocket.depth * 0.55)
    )
      return [triangle];
    const retained: number[][] = [];
    for (let edge = 0; edge < pocket.outline.length && inside.length; edge++) {
      const a = pocket.outline[edge],
        b = pocket.outline[(edge + 1) % pocket.outline.length];
      const distance = (v: Vertex) =>
        (b[0] - a[0]) * (v.local.z - a[1]) - (b[1] - a[1]) * (v.local.x - a[0]);
      const next: Vertex[] = [],
        outside: Vertex[] = [];
      for (let i = 0; i < inside.length; i++) {
        const p = inside[i],
          q = inside[(i + 1) % inside.length],
          dp = distance(p),
          dq = distance(q);
        if (dp >= -1e-10) next.push(p);
        if (dp <= 1e-10) outside.push(p);
        if ((dp > 1e-10 && dq < -1e-10) || (dp < -1e-10 && dq > 1e-10)) {
          const cut = intersection(p, q, dp / (dp - dq));
          next.push(cut);
          outside.push(cut);
        }
      }
      for (let i = 1; i < outside.length - 1; i++) {
        const a = outside[0],
          b = outside[i],
          c = outside[i + 1];
        if (b.local.clone().sub(a.local).cross(c.local.clone().sub(a.local)).lengthSq() > 1e-18)
          retained.push([a.id, b.id, c.id]);
      }
      inside = next;
    }
    return retained;
  };
  for (const group of geometry.groups) {
    const start = indices.length;
    for (let k = group.start; k < group.start + group.count; k += 3) {
      let triangles = [[sourceIndex.getX(k), sourceIndex.getX(k + 1), sourceIndex.getX(k + 2)]];
      for (const pocket of pockets) triangles = triangles.flatMap((t) => subtract(t, pocket));
      for (const triangle of triangles) indices.push(...triangle);
    }
    if (indices.length > start)
      groups.push({
        start,
        count: indices.length - start,
        materialIndex: group.materialIndex ?? 0,
      });
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.clearGroups();
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
}
