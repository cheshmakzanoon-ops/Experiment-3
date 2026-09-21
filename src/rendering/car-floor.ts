import * as T from 'three';
export type CarDetail = 'high' | 'mid' | 'far';
// z, half-width, underside height at centre, venturi rise. One original floor
// envelope serves every LOD; low detail changes tessellation, never the shape.
export const FLOOR_STATIONS = Object.freeze([
  [-2.18, 0.6, -0.385, 0.142],
  [-1.9, 0.84, -0.405, 0.094],
  [-1.55, 0.89, -0.41, 0.039],
  [-0.7, 0.935, -0.41, 0.02],
  [0.15, 0.82, -0.405, 0.031],
  [0.6, 0.6, -0.377, 0.023],
  [0.96, 0.34, -0.352, 0.008],
] as const);
export const FLOOR_THICKNESS = 0.012;
export function floorPoint(station: number, across: number, top: boolean, out = new T.Vector3()) {
  if (
    !Number.isInteger(station) ||
    station < 0 ||
    station >= FLOOR_STATIONS.length ||
    !Number.isFinite(across) ||
    Math.abs(across) > 1
  )
    throw new Error('Invalid floor surface coordinate');
  const [z, w, y, rise] = FLOOR_STATIONS[station];
  // A flat centre plank and edge rails bracket two actual raised tunnels. They
  // open at the rear diffuser rather than terminating in disconnected boxes.
  const u = Math.abs(across),
    tunnel = Math.sin(Math.PI * T.MathUtils.clamp((u - 0.12) / 0.88, 0, 1)) ** 2;
  return out.set(across * w, y + rise * tunnel + (top ? FLOOR_THICKNESS : 0), z);
}
export function floorGeometry(detail: CarDetail = 'high') {
  if (!['high', 'mid', 'far'].includes(detail)) throw new Error('Invalid car detail');
  const across = detail === 'high' ? 32 : detail === 'mid' ? 16 : 8,
    stride = across + 1,
    rows = FLOOR_STATIONS.length;
  const p: number[] = [],
    uv: number[] = [],
    index: number[] = [],
    v = new T.Vector3();
  // Duplicate skins/edges for hard rim normals. All four boundaries are sealed.
  for (const top of [false, true])
    for (let i = 0; i < rows; i++)
      for (let j = 0; j <= across; j++) {
        floorPoint(i, (j / across) * 2 - 1, top, v);
        p.push(v.x, v.y, v.z);
        uv.push(j / across, i / (rows - 1));
      }
  const skin = rows * stride;
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < across; j++) {
      const a = i * stride + j,
        b = a + stride;
      index.push(a, a + 1, b, a + 1, b + 1, b);
      index.push(a + skin, b + skin, a + 1 + skin, a + 1 + skin, b + skin, b + 1 + skin);
    }
  const edge = (a: number, b: number) => {
    const base = p.length / 3;
    for (const n of [a, b, b + skin, a + skin]) {
      p.push(...p.slice(n * 3, n * 3 + 3));
      uv.push(n === a || n === a + skin ? 0 : 1, n >= skin ? 1 : 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let j = 0; j < across; j++) {
    edge(j + 1, j);
    edge((rows - 1) * stride + j, (rows - 1) * stride + j + 1);
  }
  for (let i = 0; i < rows - 1; i++) {
    edge(i * stride, (i + 1) * stride);
    edge((i + 1) * stride + across, i * stride + across);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
/** Closed annular carbon cover with a shallow dish and rolled outer lip, axis
 * +Z. Existing carrier/spin ownership and car-local outward orientation remain. */
export function wheelCoverGeometry(detail: CarDetail = 'high') {
  if (!['high', 'mid', 'far'].includes(detail)) throw new Error('Invalid car detail');
  const g = new T.LatheGeometry(
    [
      [0.052, -0.003],
      [0.055, 0.003],
      [0.115, 0.009],
      [0.202, 0.003],
      [0.225, 0.001],
      [0.228, -0.001],
      [0.227, -0.005],
      [0.202, -0.003],
      [0.115, 0.003],
      [0.052, -0.006],
      [0.052, -0.003],
    ]
      .reverse()
      .map(([r, d]) => new T.Vector2(r, d)),
    detail === 'high' ? 48 : detail === 'mid' ? 24 : 12,
  );
  g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Thin closed fences sit on the shared floor skin. They replace cylindrical
 * edge rails and detached diffuser boxes while retaining the same LOD envelope. */
export function floorFenceGeometry(across: number, start: number, end: number, height: number) {
  if (
    !Number.isFinite(across) ||
    Math.abs(across) > 1 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    height > 0.2 ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end >= FLOOR_STATIONS.length ||
    end <= start
  )
    throw new Error('Invalid floor fence');
  const p: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  for (let row = start; row <= end; row++) {
    const v = floorPoint(row, across, true);
    const rise = height * (row === end ? 0.2 : row === start ? 0.65 : 1);
    for (const [x, y] of [
      [-0.003, 0],
      [0.003, 0],
      [0.003, rise],
      [-0.003, rise],
    ]) {
      p.push(v.x + x, v.y + y, v.z);
      uv.push((row - start) / (end - start), y === 0 ? 0 : 1);
    }
    if (row < end) {
      const a = (row - start) * 4;
      for (let j = 0; j < 4; j++) {
        const k = (j + 1) % 4;
        ix.push(a + j, a + k, a + 4 + j, a + k, a + 4 + k, a + 4 + j);
      }
    }
  }
  const last = (end - start) * 4;
  ix.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
