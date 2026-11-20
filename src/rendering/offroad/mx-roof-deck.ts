import * as T from 'three';

/** Formed roof sheets with a trapezoidal flute section, a folded edge at
 * each eave and a closed top. Ribs span across the purlins. The terrace
 * carries a thin sheet and the arena has an insulated flat outer skin. */
export function mxRoofDeck(width: number, length: number, kind: 'terrace' | 'arena') {
  const arena = kind === 'arena';
  const ribs = Math.max(1, Math.round(length / (arena ? 0.85 : 0.43)));
  const x = width / 2,
    z = length / 2;
  const positions: number[] = [],
    colours: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], tone: number) => {
    const first = positions.length / 3;
    const end = a[2] === b[2] && a[2] === c[2];
    const side = a[0] === b[0] && a[0] === c[0];
    for (const [px, py, pz] of [a, b, c, d]) {
      positions.push(px, py, pz);
      colours.push(tone, tone, tone);
      uv.push((side ? pz + z : px + x) / 2.4, (end || side ? py : pz + z) / 2.4);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  const fold = [
    [0, 0],
    [0.12, 0],
    [0.28, 1],
    [0.72, 1],
    [0.88, 0],
    [1, 0],
  ];
  const lower = (v: number) => (arena ? -0.36 + 0.14 * v : -0.06 + 0.096 * v);
  const upper = (v: number) => (arena ? 0.225 : lower(v) + 0.019);
  for (let rib = 0; rib < ribs; rib++) {
    // Slight differences in mill finish between lengths of installed sheet.
    const finish = 0.96 + 0.04 * Math.cos(Math.floor(rib / 4) * 2.37);
    for (let j = 1; j < fold.length; j++) {
      const [u0, v0] = fold[j - 1],
        [u1, v1] = fold[j];
      const z0 = -z + (length * (rib + u0)) / ribs,
        z1 = -z + (length * (rib + u1)) / ribs;
      const y0 = lower(v0),
        y1 = lower(v1),
        t0 = upper(v0),
        t1 = upper(v1);
      quad(
        [-x, y0, z0],
        [x, y0, z0],
        [x, y1, z1],
        [-x, y1, z1],
        finish * (arena ? 0.59 : 0.46) * (1 - (v0 + v1) * 0.075),
      );
      quad([-x, t0, z0], [-x, t1, z1], [x, t1, z1], [x, t0, z0], finish);
      quad([-x, t0, z0], [-x, y0, z0], [-x, y1, z1], [-x, t1, z1], finish * 0.72);
      quad([x, t0, z0], [x, t1, z1], [x, y1, z1], [x, y0, z0], finish * 0.72);
    }
  }
  const y = lower(0),
    t = upper(0);
  quad([-x, t, -z], [x, t, -z], [x, y, -z], [-x, y, -z], 0.78);
  quad([-x, t, z], [-x, y, z], [x, y, z], [x, t, z], 0.78);
  const geometry = new T.BufferGeometry();
  geometry.name = arena ? 'Deep-fluted arena structural decking' : 'Folded steel terrace canopy';
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
