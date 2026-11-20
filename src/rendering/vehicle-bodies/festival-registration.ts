import * as T from 'three';
import type { ClosedBodyModel } from './closed-body.ts';
import { festivalRegistrationPocket } from './festival-rear.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

const IDS = ['eh3', 'sc7', 'rh3', 'rs5', 'rm8', 'rg63', 'rp6', 'rr4', 'lx12', 'rd2'];
const W = 128,
  H = 32,
  SIZE = 256;
const GLYPHS: Record<string, readonly number[]> = {
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  P: [30, 17, 17, 30, 16, 16, 16],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  X: [17, 17, 10, 4, 10, 17, 17],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 16, 30, 1, 1, 30],
  '6': [14, 16, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
};
let printed: T.MeshStandardMaterial | undefined;

/** A single mipmapped stock sheet for the whole road grid. Each registration
 * is drawn once at startup, including in a renderer without a DOM canvas. */
function stock() {
  if (printed) return printed;
  const data = new Uint8Array(SIZE * SIZE * 4);
  IDS.forEach((id, i) => {
    const ox = (i % 2) * W,
      oy = Math.floor(i / 2) * H;
    const dot = (x: number, y: number, rgb: number) => {
      const off = ((oy + H - 1 - y) * SIZE + ox + x) * 4;
      data[off] = rgb >>> 16;
      data[off + 1] = rgb >>> 8;
      data[off + 2] = rgb;
      data[off + 3] = 255;
    };
    const dark = 0x263533,
      band = 0x245d61,
      paper = 0xeee9d9;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
        dot(x, y, border ? 0xb7b8a9 : x < 18 ? band : paper);
      }
    const letter = (c: string, x: number, y: number, scale: number, color: number) => {
      GLYPHS[c].forEach((row, v) => {
        for (let u = 0; u < 5; u++)
          if (row & (16 >> u))
            for (let j = 0; j < scale; j++)
              for (let k = 0; k < scale; k++) dot(x + u * scale + k, y + v * scale + j, color);
      });
    };
    // Solvane Coast monogram above a two-tone coastal horizon.
    letter('S', 4, 7, 1, paper);
    letter('C', 10, 7, 1, paper);
    for (let x = 3; x < 16; x++) {
      dot(x, 21 - Math.round(3 * Math.sin((Math.PI * (x - 3)) / 12)), 0xd7b46d);
      dot(x, 23, 0xb5d4c5);
    }
    const code = id.toUpperCase();
    const left = 73 - (code.length * 18 - 3 + 5) / 2;
    let x = Math.round(left);
    for (let j = 0; j < code.length; j++) {
      if (j === 2) x += 5;
      letter(code[j], x, 6, 3, dark);
      x += 18;
    }
  });
  const texture = new T.DataTexture(data, SIZE, SIZE, T.RGBAFormat);
  texture.name = 'Solvane Coast registration stock';
  texture.colorSpace = T.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  printed = new T.MeshStandardMaterial({ map: texture, roughness: 0.42, metalness: 0.12 });
  printed.name = 'Solvane registration enamel';
  return printed;
}

/** Mount on the back of the registration well, or on the pickup's bumper
 * step. The far shell carries the same coloured face on its closed cap. */
export function addFestivalRegistration(
  parts: Parts,
  model: ClosedBodyModel,
  id: string,
  detail: Detail,
) {
  const index = IDS.indexOf(id);
  if (index < 0) return;
  const pocket = festivalRegistrationPocket(model),
    truck = model.s.loadFloor !== undefined;

  const width = pocket ? pocket.width * 0.718 : 0.344,
    height = pocket ? pocket.height * 0.465 : 0.109;
  const y = pocket ? pocket.y - 0.004 : model.f.y(model.s.floor + 0.14) + 0.018;
  const z = model.zRear + (detail === 2 ? -0.006 : truck ? -0.138 : pocket ? 0.039 : -0.006);
  const face = new T.PlaneGeometry(width, height, 2, 1);
  const uv = face.getAttribute('uv');
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      ((index % 2) * W + 1 + uv.getX(i) * (W - 2)) / SIZE,
      (Math.floor(index / 2) * H + 1 + uv.getY(i) * (H - 2)) / SIZE,
    );
  parts.add(face, stock(), placed(0, y, z, 0, Math.PI));
}
