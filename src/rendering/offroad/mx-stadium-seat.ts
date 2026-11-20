import * as T from 'three';

/** Injection-moulded stadium bucket. The pan and raked back share a rolled
 * transition. Twenty indexed triangles per seat include the front return,
 * lateral bolsters, tapered shoulders and the downturn at the upper rim. */
export function mxStadiumSeatGeometry() {
  const profile = [
    // height, fore/aft, half-width, side bolster, side sweep
    [0.423, 0.203, 0.177, 0.018, -0.023],
    [0.483, 0.193, 0.209, 0.018, -0.026],
    [0.464, 0.015, 0.218, 0.039, 0.004],
    [0.484, -0.164, 0.206, 0.047, 0.04],
    [0.845, -0.218, 0.191, -0.029, 0.057],
    [0.851, -0.244, 0.178, -0.033, 0.046],
  ];
  const positions: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  for (const [row, [y, z, w, bolster, sweep]] of profile.entries()) {
    for (const side of [-1, 0, 1]) {
      const edge = Math.abs(side);
      positions.push(side * w, y + edge * bolster, z + edge * sweep);
      const shade = (row === 0 ? 0.7 : row === 3 ? 0.89 : 1) - edge * 0.04;
      colours.push(shade, shade, shade);
    }
    if (row === 0) continue;
    for (let column = 0; column < 2; column++) {
      const a = (row - 1) * 3 + column,
        b = a + 3;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.name = 'Moulded stadium seat shell with rolled rims';
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
