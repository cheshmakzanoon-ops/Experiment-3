import * as T from 'three';
import type { P3 } from './gp-race-shell.ts';

/** A moulded foil swept along its span. The bike travels in +Z. The rounded
 * leading edge and knife-edge trailing seam follow a chord perpendicular to
 * the local span, even round the return of a box wing. Dimensions are metres. */
export function gpAerofoil(
  path: readonly P3[],
  chord: number,
  thickness: number,
  segments: number,
  sides: number,
  tipChord = chord,
) {
  const curve = new T.CatmullRomCurve3(
    path.map((p) => new T.Vector3(...p)),
    false,
    'centripetal',
  );
  const positions: number[] = [],
    indices: number[] = [];
  const point = new T.Vector3(),
    tangent = new T.Vector3(),
    up = new T.Vector3(),
    ahead = new T.Vector3();
  const forward = new T.Vector3(0, 0, 1);
  const stride = sides + 1;
  for (let row = 0; row <= segments; row++) {
    const span = row / segments;
    curve.getPointAt(span, point);
    curve.getTangentAt(span, tangent);
    up.crossVectors(forward, tangent).normalize();
    ahead.crossVectors(tangent, up).normalize();
    const length = T.MathUtils.lerp(chord, tipChord, span * span * (3 - 2 * span));
    for (let j = 0; j <= sides; j++) {
      // Start and finish at the trailing edge. Split its normals while the
      // leading edge has one smooth vertex shared by the two skin surfaces.
      const angle = ((j / sides) * 2 - 1) * Math.PI;
      const x = (1 - Math.cos(angle)) / 2;
      const half =
        j === 0 || j === sides
          ? 0
          : 5 *
            thickness *
            Math.sign(Math.sin(angle)) *
            (0.2969 * Math.sqrt(x) -
              0.126 * x -
              0.3516 * x * x +
              0.2843 * x ** 3 -
              0.1036 * x ** 4);
      const z = (0.65 - x) * length,
        h = half * length;
      positions.push(
        point.x + ahead.x * z + up.x * h,
        point.y + ahead.y * z + up.y * h,
        point.z + ahead.z * z + up.z * h,
      );
      if (row < segments && j < sides) {
        const a = row * stride + j,
          b = a + stride;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // Give the end faces their own normals. Open foil ends show the background
  // through the carbon at a grazing angle, especially at the tail tips.
  for (const row of [0, segments]) {
    const start = row * stride,
      base = positions.length / 3;
    for (let j = 0; j < sides; j++) {
      const i = (start + j) * 3;
      positions.push(positions[i], positions[i + 1], positions[i + 2]);
    }
    for (let j = 1; j + 1 < sides; j++) {
      if (row === 0) indices.push(base, base + j, base + j + 1);
      else indices.push(base, base + j + 1, base + j);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
