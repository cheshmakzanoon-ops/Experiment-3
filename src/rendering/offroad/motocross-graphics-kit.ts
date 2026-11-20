import * as T from 'three';
import { canvasTexture } from '../geometry.ts';
import type { RiderColours, RiderDetail } from '../rider.ts';

// Pixel rectangles in the original artwork, measured from the top left. The
// printed faces and their unprinted reverse sides share one material at every LOD.
const PANELS = {
  shroud: [0, 0, 512, 512],
  fender: [512, 0, 256, 512],
  guard: [768, 0, 128, 512],
  bar: [896, 0, 128, 384],
  blank: [896, 384, 128, 128],
} as const;
type Panel = keyof typeof PANELS;

/** Each tile has a four-pixel gutter. Even the plain return retains a 2D
 * footprint for anisotropic sampling. The tail reads toward the rear tip. */
export function mapMxKitPanel(
  geometry: T.BufferGeometry,
  panel: Panel,
  printed: (index: number) => boolean,
  reverse = false,
) {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const [x, y, w, h] = PANELS[printed(i) ? panel : 'blank'];
    const u = T.MathUtils.clamp(uv.getX(i), 0, 1);
    const v = T.MathUtils.clamp(uv.getY(i), 0, 1);
    uv.setXY(i, (x + 4 + u * (w - 8)) / 1024, 1 - (y + 4 + (reverse ? v : 1 - v) * (h - 8)) / 512);
  }
  return geometry;
}

/** Original die-cut graphics. All the plastics of a machine use this sheet,
 * including the bar cover. The middle and distant models use smaller mips
 * of the same design so opponents keep their team identity on long shots. */
export function mxKitTexture(colours: RiderColours, model: string, detail: RiderDetail) {
  const scale = detail === 'high' ? 1 : detail === 'mid' ? 0.5 : 0.25;
  const ink = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;
  const base = ink(colours.primary),
    dark = ink(colours.secondary),
    accent = ink(colours.accent);
  const paper = '#ebe9dc',
    charcoal = '#212329';
  const size = model === 'mx250' ? '250' : '450';
  const texture = canvasTexture(1024 * scale, 512 * scale, (c) => {
    c.scale(scale, scale);
    c.fillStyle = base;
    c.fillRect(0, 0, 1024, 512);
    const polygon = (fill: string, points: readonly number[]) => {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
      c.closePath();
      c.fill();
    };
    const tile = (panel: Panel, draw: () => void) => {
      const [x, y, w, h] = PANELS[panel];
      c.save();
      c.translate(x, y);
      c.beginPath();
      c.rect(0, 0, w, h);
      c.clip();
      draw();
      c.restore();
    };
    tile('shroud', () => {
      polygon(paper, [0, 265, 174, 262, 369, 110, 512, 85, 512, 266, 273, 329, 158, 409, 0, 407]);
      polygon(dark, [0, 289, 178, 279, 370, 134, 512, 113, 512, 233, 305, 286, 158, 385, 0, 381]);
      polygon(accent, [80, 304, 196, 284, 386, 153, 509, 135, 447, 164, 370, 177, 190, 300]);
      c.save();
      c.translate(267, 251);
      c.rotate(-0.29);
      c.textAlign = 'center';
      c.font = 'italic 900 64px "Saira Variable", sans-serif';
      c.fillStyle = paper;
      c.fillText('MX', -67, 0, 94);
      c.fillText(size, 31, 0, 125);
      c.font = '800 18px "Saira Variable", sans-serif';
      c.fillText('M O T O B O U N D', 2, 24, 184);
      c.restore();
    });
    tile('fender', () => {
      // The arrow sweeps around the crown. A strip of moulded plastic stays
      // visible on either side, even at the wider rear shoulder.
      for (const side of [-1, 1]) {
        c.save();
        c.translate(128, 0);
        c.scale(side, 1);
        polygon(dark, [7, 68, 52, 119, 102, 131, 116, 431, 78, 369, 63, 248, 28, 155]);
        polygon(paper, [10, 76, 58, 136, 99, 149, 103, 171, 51, 151]);
        polygon(accent, [60, 176, 98, 190, 104, 300, 88, 264, 84, 207]);
        c.restore();
      }
      // Carry the shoulder pinstripes around the nose; the rider sees this
      // upper end of the atlas beyond the number plate from the cockpit.
      polygon(dark, [15, 8, 57, 12, 128, 63, 199, 12, 241, 8, 160, 81, 128, 107, 97, 81]);
      polygon(paper, [41, 13, 62, 15, 128, 67, 194, 15, 215, 13, 128, 81]);
      polygon(accent, [67, 25, 93, 41, 128, 68, 163, 41, 189, 25, 128, 76]);
      c.fillStyle = paper;
      c.font = 'italic 900 27px "Saira Variable", sans-serif';
      c.textAlign = 'center';
      c.fillText(size, 128, 212, 55);
    });
    tile('guard', () => {
      polygon(paper, [8, 82, 118, 47, 118, 406, 28, 469]);
      polygon(dark, [9, 117, 117, 78, 116, 372, 32, 437]);
      polygon(accent, [2, 352, 120, 261, 118, 283, 7, 375]);
      c.translate(78, 219);
      c.rotate(-Math.PI / 2);
      c.font = 'italic 900 25px "Saira Variable", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = paper;
      c.fillText('MOTOBOUND', 0, 0, 170);
    });
    tile('bar', () => {
      c.fillStyle = charcoal;
      c.fillRect(0, 0, 128, 384);
      for (const y of [22, 350]) {
        c.fillStyle = accent;
        c.fillRect(3, y, 122, 5);
        c.fillStyle = base;
        c.fillRect(3, y + 7, 122, 8);
      }
      c.translate(65, 192);
      c.rotate(-Math.PI / 2);
      c.fillStyle = paper;
      c.textAlign = 'center';
      c.font = 'italic 900 33px "Saira Variable", sans-serif';
      c.fillText('MOTOBOUND', 0, 12, 252);
    });
  });
  texture.name = `${model} die-cut racing plastics (${detail})`;
  return texture;
}
