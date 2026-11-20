import * as T from 'three';
import { Random } from '../../core/math.ts';

const TAU = Math.PI * 2;
const TILE = 256;

/** Two mipmapped atlas patches, one for the cut face of the roll and one
 * for its circumference. Both faces have continuous fibres at the rim.
 * Paint the stalks once at venue load, independent of camera and replay. */
function strawAtlas() {
  const width = TILE * 2,
    pixels = new Uint8Array(width * TILE * 4);
  const random = new Random(0x3526ad7);
  const chroma = (index: number, value: number, warmth: number) => {
    pixels[index] = Math.min(246, Math.max(53, 168 + value + warmth));
    pixels[index + 1] = Math.min(222, Math.max(40, 132 + value * 0.88));
    pixels[index + 2] = Math.min(169, Math.max(24, 75 + value * 0.69 - warmth * 0.4));
    pixels[index + 3] = 255;
  };
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < width; x++) {
      const u = ((x % TILE) + 0.5) / TILE,
        v = (y + 0.5) / TILE;
      const dx = (u - 0.51) * 2,
        dy = (v - 0.49) * 2;
      const r = Math.hypot(dx, dy),
        a = Math.atan2(dy, dx);
      const phase =
        x < TILE
          ? r * 56 - a + r * (1.3 * Math.sin(a * 3) + 0.9 * Math.cos(a * 7))
          : TAU * (v * 10 + 0.09 * Math.sin(TAU * u * 2) + 0.09 * Math.sin(TAU * (u + v)));
      const groove = 0.5 + 0.5 * Math.cos(phase);
      const tuft = Math.sin(TAU * (u * 3 + v * 2)) + Math.cos(TAU * (u + v * 4));
      chroma(
        4 * (y * width + x),
        7 + tuft * 4 - 29 * groove ** 5 + (random.next() - 0.5) * 21,
        tuft * 2,
      );
    }
  // Short overlapping cut stems follow each turn of the spiral. On the roll
  // the same stems run around the circumference and wrap at its UV seam.
  for (let face = 0; face < 2; face++)
    for (let stem = 0; stem < 13000; stem++) {
      const x = random.next() * TILE,
        y = random.next() * TILE;
      const sweep = (random.next() - 0.5) * (face ? 0.65 : 0.92);
      const angle = sweep + (face ? 0 : Math.atan2(y - TILE * 0.49, x - TILE * 0.51) + Math.PI / 2);
      const length = 2 + random.next() ** 2 * 11,
        sx = Math.cos(angle),
        sy = Math.sin(angle);
      const light = (random.next() - 0.43) * 74;
      for (let p = 0; p < length; p++) {
        const local = Math.floor(x + sx * p),
          row = Math.floor(y + sy * p);
        if (row < 0 || row >= TILE || (!face && (local < 0 || local >= TILE))) continue;
        const i = 4 * (row * width + face * TILE + ((local + TILE) % TILE));
        const shift = light * Math.sin((Math.PI * (p + 1)) / (length + 1));
        for (let c = 0; c < 3; c++)
          pixels[i + c] = Math.min(245, Math.max(22, pixels[i + c] + shift * (1 - c * 0.13)));
      }
    }
  const map = new T.DataTexture(pixels, width, TILE);
  map.colorSpace = T.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.magFilter = T.LinearFilter;
  map.anisotropy = 4;
  map.name = 'MX wound straw and cut fibres';
  map.needsUpdate = true;
  return map;
}

export function mxStrawBale() {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const sides = 28;
  const radial = (a: number) => 1 + 0.012 * Math.sin(3 * a + 0.35) + 0.008 * Math.cos(5 * a);
  const ring = (r: number, y: number, cap: number, v: number) => {
    const start = positions.length / 3;
    for (let k = 0; k <= sides; k++) {
      const u = k / sides,
        a = u * TAU,
        ca = Math.cos(a),
        sa = Math.sin(a);
      const radius = r * radial(a);
      positions.push(ca * radius, y, sa * radius);
      if (cap) uvs.push(0.25 + cap * ca * r * 0.38, 0.5 + sa * r * 0.76);
      else uvs.push(0.503 + u * 0.494, 0.01 + v * 0.98);
    }
    return start;
  };
  function connect(first: number, second: number) {
    for (let k = 0; k < sides; k++) {
      const a = first + k,
        b = second + k;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const profile = [
    [-0.575, 0.551],
    [-0.558, 0.599],
    [-0.49, 0.617],
    [-0.35, 0.621],
    [-0.322, 0.611],
    [-0.302, 0.62],
    [0, 0.626],
    [0.302, 0.62],
    [0.322, 0.611],
    [0.35, 0.62],
    [0.49, 0.615],
    [0.558, 0.596],
    [0.575, 0.551],
  ];
  let previous = -1;
  for (const [y, r] of profile) {
    const next = ring(r, y, 0, (y + 0.575) / 1.15);
    if (previous >= 0) connect(previous, next);
    previous = next;
  }
  for (const end of [-1, 1]) {
    // A single centre vertex and shallow dished end rings avoid a fan of
    // zero-area triangles at the core of the roll.
    const centre = positions.length / 3;
    positions.push(0, end * 0.553, 0);
    uvs.push(0.25, 0.5);
    let inner = ring(0.115, end * 0.559, end, 0);
    for (let k = 0; k < sides; k++) {
      if (end > 0) indices.push(centre, inner + k + 1, inner + k);
      else indices.push(centre, inner + k, inner + k + 1);
    }
    for (const [radius, depth] of [
      [0.33, 0.567],
      [0.49, 0.578],
      [0.551, 0.575],
    ]) {
      const outer = ring(radius, end * depth, end, 0);
      if (end > 0) connect(outer, inner);
      else connect(inner, outer);
      inner = outer;
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The UV seam duplicates a ring vertex. Average its normals so sunlight
  // cannot reveal the seam when several bales are rolled to different angles.
  const normals = geometry.getAttribute('normal'),
    average = new T.Vector3();
  const fixRing = (start: number) => {
    const last = start + sides;
    average
      .set(
        normals.getX(start) + normals.getX(last),
        normals.getY(start) + normals.getY(last),
        normals.getZ(start) + normals.getZ(last),
      )
      .normalize();
    for (const i of [start, last]) normals.setXYZ(i, average.x, average.y, average.z);
  };
  for (let i = 0; i < profile.length; i++) fixRing(i * (sides + 1));
  const capStart = profile.length * (sides + 1),
    capCount = 1 + 4 * (sides + 1);
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < 4; i++) fixRing(capStart + side * capCount + 1 + i * (sides + 1));
  geometry.computeBoundingSphere();
  const map = strawAtlas();
  const material = new T.MeshStandardMaterial({
    name: 'MX round straw bales',
    map,
    bumpMap: map,
    bumpScale: 0.009,
    roughness: 0.98,
  });
  return { geometry, material };
}
