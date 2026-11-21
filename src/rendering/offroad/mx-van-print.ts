import * as T from 'three';
import { MX_PADDOCK_CREWS } from './mx-canopy-print.ts';

/** Transparent die-cut vinyl on the cargo door. Exposed areas retain each
 * van's own body colour. Marks and crew names match the roof at its bay. */
export function mxVanPrint() {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array(4), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  const w = 1024,
    row = 256;
  canvas.width = w;
  canvas.height = row * MX_PADDOCK_CREWS.length;
  const c = canvas.getContext('2d')!;
  const polygon = (colour: string, points: number[]) => {
    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath();
    c.fill();
  };
  for (const [i, [base, light, accent, name]] of MX_PADDOCK_CREWS.entries()) {
    c.save();
    c.translate(0, i * row);
    polygon(base, [21, 147, 274, 62, 883, 48, 995, 27, 839, 123, 385, 176, 66, 215, 188, 151]);
    polygon(light, [110, 147, 297, 83, 561, 78, 422, 118, 210, 140, 75, 190]);
    polygon(accent, [61, 223, 362, 173, 827, 126, 969, 51, 853, 148, 242, 205]);
    polygon('#e2e5df', [300, 184, 666, 146, 609, 158, 280, 193]);
    c.fillStyle = '#f3f2e7';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = 'italic 900 53px sans-serif';
    c.fillText(name, 305, 109, 468);
    c.fillStyle = accent;
    c.font = 'bold 16px sans-serif';
    c.fillText('MOTOBOUND   /   RACE SERVICE', 325, 141, 252);
    c.restore();
  }
  const t = new T.CanvasTexture(canvas);
  t.name = 'MX race service van vinyl';
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
