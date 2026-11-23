import * as T from 'three';
import { spectatorKitGeometry } from './human-kit.ts';

export const GP_FAN_VIEWS = 16;
const VIEWS = GP_FAN_VIEWS,
  TILE_W = 32,
  TILE_H = 64,
  POSES = 16,
  WIDTH = VIEWS * TILE_W,
  HEIGHT = 2 * POSES * TILE_H;
export const GP_FAN_CARD_WIDTH = 0.96,
  GP_FAN_CARD_HEIGHT = 1.84,
  GP_FAN_CARD_Y = 0.51;
const CENTRE_X = [-0.14, -0.48] as const;
const smooth = (a: number, b: number, x: number) => T.MathUtils.smoothstep(x, a, b);

/** Rasterise the original middle-distance spectator sculpt into two aligned
 * atlas halves. The upper half stores object normals, the lower separate
 * weights for shirt dye, skin and trousers. RGB is coverage-premultiplied,
 * keeping distant mip levels clean around the outline. No light is baked in. */
function bakeTile(data: Uint8Array, geometry: T.BufferGeometry, row: number, view: number) {
  const standing = (row >> 2) & 1,
    folded = (row >> 1) & 1,
    cap = row & 1;
  const rest = geometry.getAttribute('position'),
    tags = geometry.getAttribute('crowdPerson');
  const position = standing ? geometry.getAttribute('standingPosition') : rest;
  const normal = geometry.getAttribute(standing ? 'standingNormal' : 'normal'),
    index = geometry.index!;
  const angle = (view * 2 * Math.PI) / VIEWS,
    sin = Math.sin(angle),
    cos = Math.cos(angle);
  const px = new Float32Array(position.count),
    py = new Float32Array(position.count),
    pz = new Float32Array(position.count);
  const weights = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) - CENTRE_X[standing],
      z = position.getZ(i),
      y = position.getY(i);
    px[i] = ((x * cos - z * sin) / GP_FAN_CARD_WIDTH + 0.5) * TILE_W;
    py[i] = ((y - GP_FAN_CARD_Y) / GP_FAN_CARD_HEIGHT + 0.5) * TILE_H;
    pz[i] = x * sin + z * cos;
    const joint = tags.getX(i),
      region = tags.getY(i),
      accessory = tags.getZ(i);
    const bx = rest.getX(i),
      by = rest.getY(i);
    let skin = 0,
      denim = 0,
      shirt = 0;
    if (accessory === 1) shirt = 0.7;
    else if (joint === 3) {
      // The bare head faces -X. Hair occupies more of the back of the skull.
      const hair = smooth(0.71, 0.755, by + 0.075 * (bx - 0.06));
      skin = 1 - hair;
    } else if (joint === 1 || joint === 2) {
      skin = region === 1 ? 1 : 0;
      shirt = 1 - skin;
    } else {
      denim = by < 0.17 || (bx < -0.1 && by < 0.25) ? 1 : 0;
      if (by < -0.205 && bx < -0.2) denim = 0.16;
      skin = by > 0.535 + 0.3 * (bx - 0.085) ? 1 : 0;
      shirt = 1 - Math.max(skin, by < 0.17 || (bx < -0.1 && by < 0.25) ? 1 : 0);
    }
    weights.set([shirt, skin, denim], i * 3);
  }
  const depth = new Float32Array(TILE_W * TILE_H).fill(-Infinity);
  const second = WIDTH * TILE_H * POSES * 4;
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k),
      b = index.getX(k + 1),
      c = index.getX(k + 2);
    const tag = tags.getZ(a);
    if (
      (tag === 1 && !cap) ||
      tag === 2 ||
      (tag === 3 && folded) ||
      (tag === 4 && !folded) ||
      tag >= 5
    )
      continue;
    const x0 = px[a],
      y0 = py[a],
      x1 = px[b] - x0,
      y1 = py[b] - y0,
      x2 = px[c] - x0,
      y2 = py[c] - y0;
    const det = x1 * y2 - x2 * y1;
    if (Math.abs(det) < 1e-7) continue;
    const minX = Math.max(1, Math.floor(Math.min(x0, px[b], px[c]))),
      maxX = Math.min(TILE_W - 2, Math.ceil(Math.max(x0, px[b], px[c])));
    const minY = Math.max(1, Math.floor(Math.min(y0, py[b], py[c]))),
      maxY = Math.min(TILE_H - 2, Math.ceil(Math.max(y0, py[b], py[c])));
    for (let iy = minY; iy <= maxY; iy++)
      for (let ix = minX; ix <= maxX; ix++) {
        const dx = ix + 0.5 - x0,
          dy = iy + 0.5 - y0,
          wb = (dx * y2 - x2 * dy) / det,
          wc = (x1 * dy - dx * y1) / det,
          wa = 1 - wb - wc;
        if (wb < 0 || wc < 0 || wa < 0) continue;
        const z = wa * pz[a] + wb * pz[b] + wc * pz[c],
          j = iy * TILE_W + ix;
        if (z <= depth[j]) continue;
        depth[j] = z;
        const pix = ((row * TILE_H + iy) * WIDTH + view * TILE_W + ix) * 4;
        const nx = normal.getX(a) * wa + normal.getX(b) * wb + normal.getX(c) * wc;
        const ny = normal.getY(a) * wa + normal.getY(b) * wb + normal.getY(c) * wc;
        const nz = normal.getZ(a) * wa + normal.getZ(b) * wb + normal.getZ(c) * wc;
        const inv = 0.5 / (Math.hypot(nx, ny, nz) || 1);
        data[pix] = Math.round((0.5 + nx * inv) * 255);
        data[pix + 1] = Math.round((0.5 + ny * inv) * 255);
        data[pix + 2] = Math.round((0.5 + nz * inv) * 255);
        data[pix + 3] = data[pix + second + 3] = 255;
        for (let ch = 0; ch < 3; ch++)
          data[pix + second + ch] = Math.round(
            255 * (wa * weights[3 * a + ch] + wb * weights[3 * b + ch] + wc * weights[3 * c + ch]),
          );
      }
  }
}

let shared: T.DataTexture | undefined;
let users = 0;
export function acquireGpCrowdAtlas() {
  if (!shared) {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    for (const family of [0, 1]) {
      const g = spectatorKitGeometry(family ? 'b' : 'a', 1);
      for (let pose = 0; pose < 8; pose++)
        for (let view = 0; view < VIEWS; view++) bakeTile(bytes, g, 8 * family + pose, view);
      g.dispose();
    }
    shared = new T.DataTexture(bytes, WIDTH, HEIGHT);
    shared.name = 'GP spectator angular normals and garment weights';
    shared.colorSpace = T.NoColorSpace;
    shared.generateMipmaps = true;
    shared.minFilter = T.LinearMipmapLinearFilter;
    shared.magFilter = T.LinearFilter;
    shared.needsUpdate = true;
  }
  users++;
  return shared;
}
export function releaseGpCrowdAtlas() {
  if (users > 0 && --users === 0) {
    shared!.dispose();
    shared = undefined;
  }
}
