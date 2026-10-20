import * as T from 'three';

/** Refine a longitudinal surface curve before deformation. Hard normals, UVs
 * and material groups survive interpolation; shared edges use identical
 * subdivisions. The unaffected vehicle body remains untouched. */
export function tessellateBodyCurve(
  geometry: T.BufferGeometry,
  projectedZ: (x: number, z: number, y: number) => number,
  affected: (z: number) => boolean,
  tolerance: number,
  heightSensitive = false,
  localTolerance?: (x: number, y: number, z: number) => number,
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
  const mappedZ: number[] = [];
  for (let i = 0; i < positions.length; i += 3)
    mappedZ.push(projectedZ(positions[i], positions[i + 2], positions[i + 1]));
  const edgeSize = (a: number, b: number) =>
    Math.max(
      Math.abs(positions[a * 3] - positions[b * 3]),
      heightSensitive ? Math.abs(positions[a * 3 + 1] - positions[b * 3 + 1]) : 0,
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
        y = positions[a * 3 + 1] + (positions[b * 3 + 1] - positions[a * 3 + 1]) * t,
        z = positions[a * 3 + 2] + (positions[b * 3 + 2] - positions[a * 3 + 2]) * t;
      error = Math.max(
        error,
        Math.abs(projectedZ(x, z, y) - (mappedZ[a] + (mappedZ[b] - mappedZ[a]) * t)) *
          (localTolerance ? tolerance / localTolerance(x, y, z) : 1),
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
        y = positions[a * 3 + 1] * u + positions[b * 3 + 1] * v + positions[c * 3 + 1] * w,
        z = positions[a * 3 + 2] * u + positions[b * 3 + 2] * v + positions[c * 3 + 2] * w;
      error = Math.max(
        error,
        Math.abs(projectedZ(x, z, y) - (mappedZ[a] * u + mappedZ[b] * v + mappedZ[c] * w)) *
          (localTolerance ? tolerance / localTolerance(x, y, z) : 1),
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
    mappedZ.push(
      projectedZ(positions[index * 3], positions[index * 3 + 2], positions[index * 3 + 1]),
    );
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
    mappedZ.push(
      projectedZ(positions[index * 3], positions[index * 3 + 2], positions[index * 3 + 1]),
    );
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
    if (depth > 32) throw new Error('Vehicle body curve refinement did not converge');
    if ([a, b, c].every((index) => !affected(positions[index * 3 + 2]))) {
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
