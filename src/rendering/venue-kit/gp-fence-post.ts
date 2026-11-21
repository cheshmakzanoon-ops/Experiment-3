import * as T from 'three';

/** Bent galvanised channel. Local +X leans toward the racing surface.
 * The web and returned flanges retain their actual thickness at the elbow.
 * The wire lies against the road-facing edge of the flange. */
export function gpFencePostGeometry() {
  const flange = [
    [-0.09, -0.055],
    [0, -0.055],
    [0, -0.041],
    [-0.074, -0.041],
    [-0.074, 0.041],
    [0, 0.041],
    [0, 0.055],
    [-0.09, 0.055],
  ];
  const angle = Math.atan2(0.45, 0.5);
  const rings = [
    { x: 0, y: 0.82, angle: 0, miter: 1 },
    { x: 0, y: 4, angle: angle / 2, miter: 1 / Math.cos(angle / 2) },
    { x: 0.45, y: 4.5, angle, miter: 1 },
  ];
  const positions: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  function point(row: number, corner: number) {
    const r = rings[row],
      [x, z] = flange[corner];
    positions.push(r.x + x * r.miter * Math.cos(r.angle), r.y - x * r.miter * Math.sin(r.angle), z);
  }
  // Each sheet face has its own vertices so the folds catch the light.
  for (let j = 0; j < flange.length; j++) {
    const next = (j + 1) % flange.length,
      base = positions.length / 3;
    for (let row = 0; row < rings.length; row++) {
      point(row, j);
      point(row, next);
      const length = Math.hypot(flange[next][0] - flange[j][0], flange[next][1] - flange[j][1]);
      uv.push(0, rings[row].y, length, rings[row].y);
      if (row < rings.length - 1) {
        const a = base + 2 * row;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const cap = T.ShapeUtils.triangulateShape(
    flange.map(([x, z]) => new T.Vector2(x, z)),
    [],
  );
  for (const row of [0, 2]) {
    const base = positions.length / 3;
    flange.forEach(([x, z], j) => {
      point(row, j);
      uv.push(x, z);
    });
    for (const [a, b, c] of cap) {
      if (row === 0) indices.push(base + a, base + b, base + c);
      else indices.push(base + c, base + b, base + a);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
