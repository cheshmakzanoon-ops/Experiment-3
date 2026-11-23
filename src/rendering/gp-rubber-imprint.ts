import * as T from 'three';
import { Random, smooth } from '../core/math.ts';

/** A tyre wipes hot rubber across the high points in the asphalt. The centre
 * carries the greatest pressure; either shoulder may briefly lose contact.
 * The mask holds linear coverage in green, the channel Three reads for
 * alphaMap. Encoding coverage in canvas alpha loses it on straight-RGB upload. */
export function gpRubberImprint() {
  const width = 64,
    height = 256;
  const random = new Random(58317);
  const lattice = Float32Array.from({ length: 64 * 32 }, () => random.next());
  // Each longitudinal field closes at y=1. Bilinear smooth noise keeps the
  // ends of the repeated stamp continuous through the full mip chain.
  const noise = (x: number, y: number, rows: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y * rows);
    const fx = x - ix,
      fy = y * rows - iy;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const a = (iy % rows) * 64,
      b = ((iy + 1) % rows) * 64;
    const l = ix & 63,
      r = (ix + 1) & 63;
    const first = lattice[a + l] + u * (lattice[a + r] - lattice[a + l]);
    const next = lattice[b + l] + u * (lattice[b + r] - lattice[b + l]);
    return first + v * (next - first);
  };
  const bytes = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) / height;
    const sweep = (noise(2.4, y, 5) - 0.5) * 0.095;
    const left = 0.045 + 0.12 * noise(7.3, y, 8);
    const right = 0.955 - 0.12 * noise(12.8, y, 7);
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) / width;
      const feather = smooth(left, left + 0.17, x) * (1 - smooth(right - 0.17, right, x));
      const fibre = noise((x + sweep) * 33 + 14, y, 9);
      const smear = noise((x + sweep) * 9 + 38, y, 6);
      const grit = noise(x * 49 + 18, y, 32);
      const ink =
        feather *
        (0.28 + 0.72 * smooth(0.18, 0.8, smear)) *
        (0.34 + 0.66 * fibre) *
        (0.85 + 0.15 * grit);
      const at = 4 * (row * width + col),
        coverage = Math.round(255 * ink);
      bytes[at] = bytes[at + 1] = bytes[at + 2] = coverage;
      bytes[at + 3] = 255;
    }
  }
  const texture = new T.DataTexture(bytes, width, height, T.RGBAFormat);
  texture.name = 'GP tyre scrub coverage';
  texture.colorSpace = T.NoColorSpace;
  texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
