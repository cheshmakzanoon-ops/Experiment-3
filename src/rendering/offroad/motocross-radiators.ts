import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add, tube, type BikeMaterials } from '../bike.ts';
import type { RiderDetail } from '../rider.ts';

/** One continuous folded metal ribbon per coolant-tube gap. The air passages
 * remain open from front to back: a solid black backing must not turn the
 * radiator into a grille painted on a box. This is constructed once per LOD. */
export function motocrossRadiatorFins(detail: RiderDetail) {
  const rows = detail === 'high' ? 32 : detail === 'mid' ? 16 : 8,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    halfThickness = 0.00035;
  for (let cell = 0; cell < 5; cell++) {
    const first = positions.length / 3,
      left = -0.041 + (cell * 0.082) / 5 + 0.0014,
      right = -0.041 + ((cell + 1) * 0.082) / 5 - 0.0014,
      path = Array.from(
        { length: rows + 1 },
        (_, i) => new T.Vector2(i % 2 === 0 ? left : right, -0.108 + (i * 0.216) / rows),
      );
    for (let i = 0; i <= rows; i++) {
      const before = path[Math.max(0, i - 1)],
        after = path[Math.min(rows, i + 1)],
        tangent = after.clone().sub(before).normalize(),
        nx = -tangent.y * halfThickness,
        ny = tangent.x * halfThickness,
        p = path[i];
      for (const [sign, z] of [
        [-1, -0.016],
        [1, -0.016],
        [1, 0.016],
        [-1, 0.016],
      ]) {
        positions.push(p.x + sign * nx, p.y + sign * ny, z);
        uv.push(i / rows, z > 0 ? 1 : 0);
      }
      if (i < rows)
        for (let edge = 0; edge < 4; edge++) {
          const a = first + i * 4 + edge,
            b = first + i * 4 + ((edge + 1) % 4);
          indices.push(a, b, a + 4, b, b + 4, a + 4);
        }
    }
    const end = first + rows * 4;
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
    indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
  }
  const indexed = new T.BufferGeometry();
  indexed.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Ref 002: a recessed core, three narrow roost guards and formed end tanks.
 * All parts retain the original cooling-package envelope behind the shrouds
 * and enter the existing rigid material batches. No new texture or material
 * owner is needed, including the coating inherited from the bike. */
export function addMotocrossRadiators(
  parent: T.Group,
  detail: RiderDetail,
  materials: BikeMaterials,
) {
  for (const side of [-1, 1]) {
    const x = side * 0.115,
      y = -0.105,
      z = 0.189;
    for (const end of [-1, 1]) {
      add(
        parent,
        new RoundedBoxGeometry(0.104, 0.024, 0.038, 1, 0.006),
        materials.aluminium,
        x,
        y + end * 0.121,
        z,
      ).name = 'Motocross formed radiator end tank';
      add(parent, new T.BoxGeometry(0.095, 0.004, 0.04), materials.steel, x, y + end * 0.111, z);
    }
    for (const edge of [-1, 1])
      add(
        parent,
        new T.BoxGeometry(0.006, 0.226, 0.035),
        materials.aluminium,
        x + edge * 0.048,
        y,
        z,
      );
    if (detail === 'far') {
      add(parent, new T.BoxGeometry(0.087, 0.216, 0.027), materials.dark, x, y, z);
      continue;
    }
    const tubes: T.BufferGeometry[] = [];
    for (let column = 0; column < 6; column++) {
      const geometry = new T.BoxGeometry(0.003, 0.222, 0.032);
      geometry.translate(-0.041 + (column * 0.082) / 5, 0, 0);
      tubes.push(geometry);
    }
    const tubeGeometry = mergeGeometries(tubes, false)!;
    for (const geometry of tubes) geometry.dispose();
    add(parent, tubeGeometry, materials.steel, x, y, z).name =
      'Motocross flat radiator coolant tubes';
    add(parent, motocrossRadiatorFins(detail), materials.steel, x, y, z).name =
      'Motocross open folded radiator fins';
    // Three vertical blades shield the fine core without hiding the spaces
    // between them. Their angled section catches light along one thin edge.
    for (const column of [-1, 0, 1]) {
      const blade = add(
        parent,
        new T.BoxGeometry(0.004, 0.234, 0.018),
        materials.dark,
        x + column * 0.032,
        y,
        0.218,
      );
      blade.rotation.y = side * 0.23;
    }
    for (const end of [-1, 1])
      add(parent, new T.BoxGeometry(0.09, 0.005, 0.012), materials.dark, x, y + end * 0.115, 0.218);
    const hosePoints: [number, number, number][] = [
      [side * 0.119, -0.232, 0.18],
      [side * 0.11, -0.27, 0.13],
      [side * 0.076, -0.225, 0.04],
    ];
    add(parent, tube(hosePoints, 0.011, 12, 6), materials.dark).name =
      'Motocross radiator return hose';
    if (detail === 'high')
      for (const [start, end] of [
        [0, 1],
        [2, 1],
      ]) {
        const origin = new T.Vector3(...hosePoints[start]),
          direction = new T.Vector3(...hosePoints[end]).sub(origin).normalize(),
          collar = add(
            parent,
            new T.CylinderGeometry(0.012, 0.012, 0.008, 10, 1, true),
            materials.steel,
          );
        collar.position.copy(origin).addScaledVector(direction, 0.011);
        collar.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
      }
  }
  if (detail !== 'far') {
    add(
      parent,
      tube(
        [
          [-0.074, 0.015, 0.189],
          [-0.043, 0.04, 0.17],
          [0.043, 0.04, 0.17],
          [0.074, 0.015, 0.189],
        ],
        0.008,
        14,
        6,
      ),
      materials.dark,
    );
    add(
      parent,
      new T.CylinderGeometry(0.0105, 0.0105, 0.019, 10),
      materials.aluminium,
      -0.115,
      0.035,
      0.189,
    );
    add(
      parent,
      new T.CylinderGeometry(0.018, 0.018, 0.005, 10),
      materials.steel,
      -0.115,
      0.046,
      0.189,
    );
    add(
      parent,
      new RoundedBoxGeometry(0.043, 0.006, 0.013, 1, 0.003),
      materials.steel,
      -0.115,
      0.046,
      0.189,
    );
  }
}
