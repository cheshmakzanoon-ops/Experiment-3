import * as T from 'three';

/** Original captive quick-release filler. Coordinates in metres on the
 * sprung prototype tank, +Z forward. A soft gasket beds against the curved
 * paint. The rigid seat, folding bail and socket heads share a milled plane. */
export function gpFuelFiller(tank: T.BufferGeometry, r2: boolean, high: boolean) {
  const centre = r2 ? 0.197 : 0.184;
  const radius = 0.051,
    segments = high ? 32 : 18;
  const pos = tank.getAttribute('position'),
    index = tank.index;
  const faces: number[][] = [];
  for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
    const xs = [pos.getX(a), pos.getX(b), pos.getX(c)];
    const zs = [pos.getZ(a) - centre, pos.getZ(b) - centre, pos.getZ(c) - centre];
    if (
      Math.min(...xs) > radius ||
      Math.max(...xs) < -radius ||
      Math.min(...zs) > radius ||
      Math.max(...zs) < -radius
    )
      continue;
    const dx = xs[1] - xs[0],
      dz = zs[1] - zs[0];
    const ex = xs[2] - xs[0],
      ez = zs[2] - zs[0],
      det = dx * ez - dz * ex;
    if (det >= -1e-10) continue;
    const y = pos.getY(a);
    faces.push([xs[0], zs[0], y, dx, dz, pos.getY(b) - y, ex, ez, pos.getY(c) - y, det]);
  }
  function skin(x: number, z: number) {
    let top = -Infinity;
    for (const [ax, az, ay, dx, dz, dy, ex, ez, ey, det] of faces) {
      const u = ((x - ax) * ez - (z - az) * ex) / det;
      const v = (dx * (z - az) - dz * (x - ax)) / det;
      if (u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001) top = Math.max(top, ay + u * dy + v * ey);
    }
    if (!Number.isFinite(top)) throw new Error('GP tank crown does not support the filler');
    return top;
  }
  function ring(r: number, count = segments, x = 0, z = 0, rot = 0) {
    return Array.from({ length: count }, (_, i) => {
      const angle = rot + (i * Math.PI * 2) / count;
      return new T.Vector2(x + r * Math.cos(angle), z + r * Math.sin(angle));
    });
  }
  const slope = (skin(0, 0.012) - skin(0, -0.012)) / 0.024;
  let bed = skin(0, 0);
  for (const r of [radius * 0.5, radius])
    for (const p of ring(r)) bed = Math.max(bed, skin(p.x, p.y) - p.y * slope);
  type Height = number | ((p: T.Vector2) => number);
  function surface() {
    const vertices: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    const vertex = (p: T.Vector2, height: Height) => {
      vertices.push(
        p.x,
        typeof height === 'number' ? bed + slope * p.y + height : height(p),
        p.y + centre,
      );
      uv.push(0.5 + p.x / 0.12, 0.5 + p.y / 0.12);
      return vertices.length / 3 - 1;
    };
    return {
      band(from: T.Vector2[], h0: Height, to: T.Vector2[], h1: Height) {
        const a = from.map((p) => vertex(p, h0)),
          b = to.map((p) => vertex(p, h1));
        for (let i = 0; i < a.length; i++) {
          const j = (i + 1) % a.length;
          indices.push(a[i], b[i], b[j], a[i], b[j], a[j]);
        }
      },
      top(outline: T.Vector2[], holes: T.Vector2[][], h: number) {
        const points = [...outline, ...holes.flat()];
        const base = points.map((p) => vertex(p, h));
        for (const [a, b, c] of T.ShapeUtils.triangulateShape(outline, holes)) {
          const p = points[a],
            q = points[b],
            r = points[c];
          const det = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
          if (det < 0) indices.push(base[a], base[b], base[c]);
          else indices.push(base[a], base[c], base[b]);
        }
      },
      geometry() {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        g.setIndex(indices);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
      },
    };
  }
  const alloy = surface(),
    insert = surface();
  const gasket = ring(radius),
    flange = ring(0.049),
    bevel = ring(0.0477),
    seat = ring(0.0354);
  insert.band(gasket, (p) => skin(p.x, p.y) - 0.00025, gasket, 0.0008);
  insert.band(gasket, 0.0008, flange, 0.0015);
  alloy.band(flange, 0.0012, bevel, 0.0036);
  const holes: T.Vector2[][] = [];
  if (high)
    for (const bolt of ring(0.0423, 6, 0, 0, Math.PI / 6)) {
      const screw = ring(0.0031, 8, bolt.x, bolt.y);
      const head = ring(0.00245, 8, bolt.x, bolt.y);
      const hex = ring(0.00125, 6, bolt.x, bolt.y);
      holes.push(screw);
      alloy.band(screw, 0.0036, head, 0.0021);
      alloy.top(head, [hex], 0.0021);
      insert.top(hex, [], 0.0009);
      insert.band(hex, 0.0021, hex, 0.0009);
    }
  alloy.top(bevel, [seat, ...holes], 0.0036);
  alloy.band(seat, 0.0036, ring(0.034), 0.0015);
  insert.band(ring(0.034), 0.0015, ring(0.0328), 0.0011);
  insert.band(ring(0.0328), 0.0011, ring(0.0315), 0.0021);
  insert.top(ring(0.0315), [], 0.0021);

  // The folded D-shaped bail stands clear of its recessed bed. Its open
  // centre and hinge knuckles survive a grazing camera angle.
  const bail = (w: number, front: number, back: number) => {
    const points: T.Vector2[] = [new T.Vector2(-w, front), new T.Vector2(w, front)];
    const n = high ? 10 : 6;
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI * i) / n;
      points.push(new T.Vector2(w * Math.cos(a), -0.002 - back * Math.sin(a)));
    }
    return points.reverse();
  };
  const outer = bail(0.018, 0.0105, 0.019),
    inner = bail(0.0138, 0.0062, 0.0148);
  alloy.band(outer, 0.0024, outer, 0.0054);
  alloy.band(outer, 0.0054, inner, 0.0054);
  alloy.band(inner, 0.0054, inner, 0.0024);
  for (const x of [-0.011, 0.011]) {
    const lug = ring(0.0035, high ? 12 : 6, x, 0.0125);
    insert.band(lug, 0.0021, lug, 0.0044);
    insert.top(lug, [], 0.0044);
  }
  return { alloy: alloy.geometry(), insert: insert.geometry() };
}
