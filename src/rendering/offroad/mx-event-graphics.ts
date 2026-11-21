import * as T from 'three';
import { Random } from '../../core/math.ts';

/** Original inks for the outdoor scrim and arena displays. A single texture
 * also holds a dedicated lap-line panel beyond the crew flag's UV island. */
export function mxEventAtlas(indoor: boolean) {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([230, 220, 190, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('MX event graphics require a 2D canvas');
  const ink = indoor ? '#121e36' : '#182f2b';
  const paper = indoor ? '#e4eff1' : '#efe6cc';
  const accent = indoor ? '#3ad6d5' : '#ed824b';
  const marker = indoor ? '#bbe8e3' : '#cad765';
  const ground = [ink, paper, ink, marker];
  const titles = ['MOTOBOUND', indoor ? 'ARENA NORD' : 'VALLEY RIDGE', 'HOLESHOT', 'TRACK CREW'];
  const notes = [
    indoor ? 'SUPERCROSS' : 'NATIONAL MX',
    indoor ? 'SUPERCROSS' : 'MOTOCROSS',
    'FIRST CORNER',
    'COURSE SERVICES',
  ];
  const type = (words: string, x: number, y: number, w: number, h: number) => {
    c.save();
    c.translate(x, y);
    c.transform(1, 0, -0.13, 1, 0, 0);
    c.font = '900 ' + h + 'px Arial, sans-serif';
    c.textBaseline = 'middle';
    c.scale(w / c.measureText(words).width, 1);
    c.fillText(words, 0, 0);
    c.restore();
  };
  const chevron = (x: number, y: number, w: number, h: number) => {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w - h * 0.48, y + h);
    c.lineTo(x - h * 0.48, y + h);
    c.fill();
  };
  for (let row = 0; row < 4; row++) {
    const y = row * 128,
      light = row === 1 || row === 3;
    c.fillStyle = ground[row];
    c.fillRect(0, y, 2048, 128);
    c.fillStyle = row === 3 ? ink : accent;
    for (let k = 0; k < 3; k++) chevron(49 + k * 39, y + 14, 23, 99);
    c.fillStyle = light ? ink : paper;
    type(titles[row], 195, y + 69, row === 3 ? 620 : 1000, 118);
    const x = row === 3 ? 880 : 1300;
    c.fillRect(x, y + 24, 5, 80);
    type(notes[row], x + 42, y + 64, row === 3 ? 363 : 588, 51);
    c.fillStyle = light ? ink : marker;
    c.fillRect(0, y + 119, 2048, 4);
  }
  // TV-safe contrast. The square flags and wide word fit the 6.3:1 metal
  // board and the woven span without reversing the print on the outbound face.
  const lx = 1376,
    ly = 384,
    w = 668;
  c.fillStyle = ink;
  c.fillRect(lx, ly, w + 4, 128);
  c.fillStyle = paper;
  type('FINISH', lx + 122, ly + 69, 430, 117);
  for (const x of [lx + 22, lx + w - 90])
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 3; i++)
        if ((j + i) % 2 === 0) c.fillRect(x + i * 22, ly + 19 + j * 22, 22, 22);
  c.fillStyle = accent;
  c.fillRect(lx, ly + 117, w, 8);
  if (!indoor) {
    const random = new Random(71268);
    c.globalAlpha = 0.09;
    for (let i = 0; i < 4400; i++) {
      c.fillStyle = i % 2 ? '#34291d' : '#ffffff';
      c.fillRect(
        random.next() * 2048,
        random.next() * 512,
        1 + random.next() * 3,
        1 + random.next() * 2,
      );
    }
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = T.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function mxAtlasRow(g: T.BufferGeometry, row: number) {
  const uv = g.getAttribute('uv');
  // Inset half a texel on the borders to prevent adjacent ink bleeding.
  for (let i = 0; i < uv.count; i++) uv.setY(i, (3 - row + (0.5 + uv.getY(i) * 127) / 128) / 4);
  return g;
}

export function mxFinishPrint(g: T.BufferGeometry) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, (1377 + 666 * uv.getX(i)) / 2048);
  return mxAtlasRow(g, 3);
}
