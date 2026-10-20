import * as T from 'three';
import type { RiderDetail } from './rider.ts';
import { sampleProfile } from './profile-sampling.ts';

/** REF018/060: a race fairing is a thin skin around the engine and radiator,
 * with a returned shoulder into the nose. It is not a closed oval tank below
 * another disconnected cowl. These original GP-R2 profiles retain the compact
 * loop-wing identity and leave the steering, radiator and wheel well open. */
export function gpR2LowerFairing(detail: RiderDetail) {
  const stations = [-0.3, -0.16, 0.02, 0.18, 0.3, 0.4, 0.5],
    centres = [-0.29, -0.235, -0.19, -0.15, -0.11, -0.04, 0.06],
    widths = [0.1, 0.15, 0.21, 0.233, 0.235, 0.218, 0.18],
    bottoms = [0.045, 0.15, 0.245, 0.28, 0.26, 0.19, 0.1],
    // A lowered cockpit scallop clears the swept switch housings at full
    // steering lock before the shoulder rises into the fixed nose cheek.
    shoulders = [-0.2, -0.05, 0.105, 0.145, 0.155, 0.238, 0.19],
    upperWidths = [0.8, 0.84, 0.9, 0.96, 0.96, 1, 1],
    rows = detail === 'high' ? 36 : detail === 'mid' ? 22 : 10,
    columns = detail === 'high' ? 36 : detail === 'mid' ? 24 : 12,
    upperAngle = 0.78,
    exponent = 2 / 3.5,
    upperSine = Math.sin(upperAngle),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    for (let j = 0; j <= columns; j++) {
      const u = j / columns,
        angle = T.MathUtils.lerp(upperAngle, -Math.PI - upperAngle, u),
        c = Math.cos(angle),
        s = Math.sin(angle),
        up = Math.max(0, s) / upperSine,
        // The radiator mouth is a curved, real opening: shoulder tips reach
        // the cowl, while the belly stops behind the compressed front tyre.
        front = 0.31 + 0.08 * c * c + 0.06 * up,
        rear = -0.285 + 0.09 * up,
        z = T.MathUtils.lerp(rear, front, v),
        y = sampleProfile(stations, centres, z),
        w = sampleProfile(stations, widths, z),
        top = (sampleProfile(stations, shoulders, z) - y) / upperSine ** exponent,
        bottom = sampleProfile(stations, bottoms, z),
        upperWidth = sampleProfile(stations, upperWidths, z);
      positions.push(
        Math.sign(c) * Math.abs(c) ** exponent * w * (1 - (1 - upperWidth) * up),
        y + Math.sign(s) * Math.abs(s) ** exponent * (s >= 0 ? top : bottom),
        z,
      );
      uvs.push(u, v);
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const outer = new T.BufferGeometry();
  outer.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  outer.setIndex(indices);
  outer.computeVertexNormals();
  const normal = outer.getAttribute('normal'),
    outerCount = positions.length / 3,
    outerIndices = indices.length;
  // Offset along the actual surface normal, not a flattened second sheet.
  // Both skins and every cut edge are opaque geometric material.
  for (let i = 0; i < outerCount; i++) {
    positions.push(
      positions[i * 3] - normal.getX(i) * 0.0025,
      positions[i * 3 + 1] - normal.getY(i) * 0.0025,
      positions[i * 3 + 2] - normal.getZ(i) * 0.0025,
    );
    uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
  }
  for (let i = 0; i < outerIndices; i += 3)
    indices.push(indices[i] + outerCount, indices[i + 2] + outerCount, indices[i + 1] + outerCount);
  const boundary = [
    ...Array.from({ length: columns + 1 }, (_, j) => j),
    ...Array.from({ length: rows }, (_, i) => (i + 1) * (columns + 1) + columns),
    ...Array.from({ length: columns }, (_, j) => rows * (columns + 1) + columns - j - 1),
    ...Array.from({ length: rows - 1 }, (_, i) => (rows - 1 - i) * (columns + 1)),
  ];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      start = positions.length / 3,
      length = Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2],
      );
    // Give the cut edge its own normals and real UV area; sharing front/back
    // UVs here would create a degenerate tangent in the paint normal map.
    for (const vertex of [a, b, a + outerCount, b + outerCount])
      positions.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    uvs.push(0, 0, length, 0, 0, 0.0025, length, 0.0025);
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  outer.dispose();
  const geometry = new T.BufferGeometry();
  geometry.name = 'GP-R2 thin shoulder-to-belly fairing skin';
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
