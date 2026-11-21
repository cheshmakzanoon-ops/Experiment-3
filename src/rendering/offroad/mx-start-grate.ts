import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Dimensions are in the slab's coordinate system. Its top is +0.06 m.
const HALF = 0.365,
  REAR = -0.99,
  FRONT = 1.1,
  TOP = 0.06,
  COLUMNS = 7,
  ROWS = 56,
  RIM = 0.018;

/** Concrete retaining the perimeter and a real opening under each launch
 * cassette. The riding surface of the steel is flush with the surrounding pad. */
export function mxArenaStartSlab(span: number, lanes: readonly number[]) {
  const rect = (path: T.Path, left: number, right: number, rear: number, front: number) => {
    path.moveTo(left, -rear);
    path.lineTo(right, -rear);
    path.lineTo(right, -front);
    path.lineTo(left, -front);
    path.closePath();
  };
  const shape = new T.Shape();
  rect(shape, -span / 2, span / 2, -1.3, 1.3);
  for (const x of lanes) {
    const hole = new T.Path();
    // The return faces of an opening point into the pocket.
    rect(hole, x + HALF, x - HALF, REAR, FRONT);
    shape.holes.push(hole);
  }
  return new T.ExtrudeGeometry(shape, { depth: TOP * 2, bevelEnabled: false })
    .rotateX(-Math.PI / 2)
    .translate(0, -TOP, 0);
}

/** Short webs of expanded steel join on alternate half-pitch rows. A
 * trapezoidal cross-section catches light on the crown and on a wider,
 * darker sheared edge. The open diamonds reveal the bed underneath. */
export function mxArenaStartGrate() {
  const position: number[] = [],
    indices: number[] = [];
  const columns = COLUMNS,
    rows = ROWS,
    rim = RIM;
  const half = HALF - rim * 0.5;
  const z0 = REAR + rim * 0.5,
    z1 = FRONT - rim * 0.5;
  const web = (x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0,
      dz = z1 - z0,
      inv = 1 / Math.hypot(dx, dz);
    const nx = dz * inv,
      nz = -dx * inv,
      first = position.length / 3;
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
    ]) {
      for (const [side, depth] of [
        [-0.0037, -0.024],
        [-0.0037, -0.004],
        [-0.0009, 0],
        [0.0037, -0.003],
        [0.0037, -0.024],
      ])
        position.push(x + side * nx, TOP + depth, z + side * nz);
    }
    for (let i = 0; i < 4; i++) {
      const a = first + i;
      indices.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
    }
  };
  for (let row = 0; row < rows; row++) {
    const a = T.MathUtils.lerp(z0, z1, row / rows),
      b = T.MathUtils.lerp(z0, z1, (row + 1) / rows);
    for (let column = 0; column < columns; column++) {
      const left = -half + (2 * half * column) / columns,
        right = -half + (2 * half * (column + 1)) / columns,
        middle = (left + right) * 0.5;
      if (row % 2) {
        web(middle, a, left, b);
        web(middle, a, right, b);
      } else {
        web(left, a, middle, b);
        web(right, a, middle, b);
      }
    }
  }
  const grate = new T.BufferGeometry();
  grate.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  grate.setIndex(indices);
  grate.computeVertexNormals();
  // One template for the whole grid. All of the rails and support ribs use
  // the same galvanized material as the lattice and receive arena lighting.
  const parts = [grate];
  for (const x of [-HALF + rim / 2, HALF - rim / 2])
    parts.push(
      new T.BoxGeometry(rim, 0.034, FRONT - REAR).translate(x, TOP - 0.017, (FRONT + REAR) / 2),
    );
  for (const z of [REAR + rim / 2, FRONT - rim / 2])
    parts.push(new T.BoxGeometry(HALF * 2 - rim * 2, 0.034, rim).translate(0, TOP - 0.017, z));
  for (let i = 1; i <= 3; i++)
    parts.push(
      new T.BoxGeometry(HALF * 2 - rim * 2, 0.023, 0.013).translate(
        0,
        TOP - 0.034,
        T.MathUtils.lerp(REAR, FRONT, i / 4),
      ),
    );
  for (const part of parts) part.deleteAttribute('uv');
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return merged;
}

/** Once the diamond webs become subpixel, sample a mipmapped plan view.
 * The same tread pitch and three cross-bearers keep the pattern registered
 * as the camera passes the gate. A whole grid then uses two triangles per lane. */
export function mxStartGrateDistanceMaterial() {
  const w = 128,
    h = 384,
    span = FRONT - REAR;
  const pixel = span / h,
    dx = (2 * HALF - RIM) / COLUMNS,
    dz = (span - RIM) / ROWS;
  const invSlope = 1 / Math.hypot(1 / dx, 0.5 / dz);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w,
        v = (y + 0.5) / h;
      const across = u * 2 * HALF,
        along = (1 - v) * span;
      const cell = (across - RIM * 0.5) / dx,
        row = (along - RIM * 0.5) / dz;
      const a = cell + row * 0.5,
        b = cell - row * 0.5;
      const wire = Math.min(Math.abs(a - Math.round(a)), Math.abs(b - Math.round(b))) * invSlope;
      const rim = Math.min(across, 2 * HALF - across, along, span - along);
      const steel =
        1 - T.MathUtils.smoothstep(Math.min(wire - 0.0037, rim - RIM), -pixel * 0.45, pixel * 0.45);
      const support = (Math.abs((along / span) * 4 - Math.round((along / span) * 4)) * span) / 4;
      const bed = support < 0.007 ? 74 : 49 + 4 * Math.sin(18 * across + 5 * along);
      const i = (y * w + x) * 4;
      rgba[i] = T.MathUtils.lerp(bed, 151, steel);
      rgba[i + 1] = T.MathUtils.lerp(bed * 0.9, 153, steel);
      rgba[i + 2] = T.MathUtils.lerp(bed * 0.78, 149, steel);
      rgba[i + 3] = 255;
    }
  const map = new T.DataTexture(rgba, w, h);
  map.colorSpace = T.SRGBColorSpace;
  map.generateMipmaps = true;
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return new T.MeshStandardMaterial({
    name: 'Distant galvanized launch grate',
    map,
    roughness: 0.78,
    metalness: 0.22,
  });
}

export function mxStartGrateDistancePlane() {
  return new T.PlaneGeometry(2 * HALF, FRONT - REAR)
    .rotateX(-Math.PI / 2)
    .translate(0, TOP, (FRONT + REAR) / 2);
}
