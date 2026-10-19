import * as T from 'three';

/** Test-only surface rasterization. A vertical column can meet a boot above
 * or below a spar; intersect occupied intervals instead of comparing their
 * outer bounds. Triangle projection keeps a full suspension sweep inexpensive.
 * Original meshes, geometry, materials and transforms are never modified. */
export interface MeshColumnGrid {
  x: number;
  z: number;
  step: number;
  columns: number;
  rows: number;
}
type Interval = readonly [number, number];
type Hit = { y: number; enter: boolean };

export function meshColumnsFor(meshes: readonly T.Mesh[], step = 0.008): MeshColumnGrid {
  const bounds = new T.Box3(),
    point = new T.Vector3();
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      bounds.expandByPoint(point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
  }
  if (bounds.isEmpty() || !Number.isFinite(step) || step <= 0)
    throw new Error('A mesh clearance grid needs finite geometry and a positive step');
  return {
    x: bounds.min.x + step / 2,
    z: bounds.min.z + step / 2,
    step,
    columns: Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / step)),
    rows: Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / step)),
  };
}

function occupied(hits: Hit[]): Interval[] {
  hits.sort((a, b) => b.y - a.y);
  const intervals: Interval[] = [];
  let winding = 0,
    top = 0;
  for (let i = 0; i < hits.length; ) {
    const y = hits[i].y;
    let entering = false,
      leaving = false;
    // Shared triangle edges yield duplicate intersections. Count a coincident
    // oriented surface once; opposed surfaces at the same height cancel.
    do {
      entering ||= hits[i].enter;
      leaving ||= !hits[i].enter;
      i++;
    } while (i < hits.length && Math.abs(hits[i].y - y) < 1e-7);
    const next = winding + Number(entering) - Number(leaving);
    if (winding <= 0 && next > 0) top = y;
    if (winding > 0 && next <= 0 && top - y > 1e-8) intervals.push([y, top]);
    winding = next;
  }
  return intervals;
}

function union(intervals: Interval[]): Interval[] {
  if (intervals.length < 2) return intervals;
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + 1e-7) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

/** Outward-facing triangles describe the occupied material. Each mesh can
 * contain several batched shells; an oriented winding sweep retains their
 * union without filling the air between a sole, rib and protective slider. */
function rasterize(meshes: readonly T.Mesh[], grid: MeshColumnGrid) {
  const result = new Map<number, Interval[]>(),
    point = new T.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position'),
      index = mesh.geometry.index,
      vertices = new Float64Array(position.count * 3),
      hits = new Map<number, Hit[]>();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertices.set([point.x, point.y, point.z], i * 3);
    }
    const count = index?.count ?? position.count;
    for (let i = 0; i < count; i += 3) {
      const a = (index ? index.getX(i) : i) * 3,
        b = (index ? index.getX(i + 1) : i + 1) * 3,
        c = (index ? index.getX(i + 2) : i + 2) * 3,
        ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2],
        bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2],
        cx = vertices[c],
        cy = vertices[c + 1],
        cz = vertices[c + 2],
        denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) < 1e-12) continue;
      const firstX = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - grid.x) / grid.step - 1e-8)),
        lastX = Math.min(
          grid.columns - 1,
          Math.floor((Math.max(ax, bx, cx) - grid.x) / grid.step + 1e-8),
        ),
        firstZ = Math.max(0, Math.ceil((Math.min(az, bz, cz) - grid.z) / grid.step - 1e-8)),
        lastZ = Math.min(
          grid.rows - 1,
          Math.floor((Math.max(az, bz, cz) - grid.z) / grid.step + 1e-8),
        );
      for (let row = firstZ; row <= lastZ; row++)
        for (let column = firstX; column <= lastX; column++) {
          const x = grid.x + column * grid.step,
            z = grid.z + row * grid.step,
            u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator,
            v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator,
            w = 1 - u - v;
          if (u < -1e-8 || v < -1e-8 || w < -1e-8) continue;
          const key = row * grid.columns + column,
            list = hits.get(key) ?? [];
          list.push({ y: u * ay + v * by + w * cy, enter: denominator < 0 });
          hits.set(key, list);
        }
    }
    for (const [key, column] of hits) {
      const intervals = occupied(column);
      if (intervals.length) result.set(key, [...(result.get(key) ?? []), ...intervals]);
    }
  }
  for (const [key, intervals] of result) result.set(key, union(intervals));
  return result;
}

export function meshColumnOverlap(
  first: readonly T.Mesh[],
  second: readonly T.Mesh[],
  grid: MeshColumnGrid,
) {
  const a = rasterize(first, grid),
    b = rasterize(second, grid);
  let maximumOverlap = 0,
    comparedColumns = 0,
    intersectingColumns = 0;
  let worst: { x: number; z: number; first: Interval; second: Interval } | undefined;
  for (const [key, firstIntervals] of a) {
    const secondIntervals = b.get(key);
    if (!secondIntervals?.length) continue;
    comparedColumns++;
    let intersects = false;
    for (const i of firstIntervals)
      for (const j of secondIntervals) {
        const overlap = Math.min(i[1], j[1]) - Math.max(i[0], j[0]);
        intersects ||= overlap > 1e-6;
        if (overlap > maximumOverlap) {
          maximumOverlap = overlap;
          worst = {
            x: grid.x + (key % grid.columns) * grid.step,
            z: grid.z + Math.floor(key / grid.columns) * grid.step,
            first: i,
            second: j,
          };
        }
      }
    if (intersects) intersectingColumns++;
  }
  return {
    maximumOverlap,
    comparedColumns,
    intersectingColumns,
    firstColumns: a.size,
    secondColumns: b.size,
    worst,
  };
}
