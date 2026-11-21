import type * as T from 'three';
import type { RiderColours } from './rider.ts';
import type { LiveryScheme } from './car-livery.ts';
import { BRAND_ART, drawMark } from './studio/brand-atlas.ts';

const parts = ['plain', 'palm', 'back', 'closure', 'knuckle', 'digit', 'foot', 'shaft'] as const;
export type GpEquipmentPart = (typeof parts)[number];

/** Eight guttered leather cuts share the bottom 128 px of the limb print.
 * The grain remains on the original material and the bones retain their UV seams. */
export function gpEquipmentUv(
  geometry: T.BufferGeometry,
  part: GpEquipmentPart,
  reinforcement = false,
) {
  const uv = geometry.getAttribute('uv'),
    column = parts.indexOf(part);
  for (let i = 0; i < uv.count; i++) {
    const u = reinforcement ? 0.1 + 0.3 * uv.getX(i) : uv.getX(i);
    const v = reinforcement ? 0.72 * uv.getY(i) : uv.getY(i);
    uv.setXY(i, (column * 128 + 4 + 120 * u) / 1024, (4 + 120 * v) / 512);
  }
  return geometry;
}

/** Original dyed gauntlets and racing boots. The protective pieces turn
 * around the pattern at the same circumferential station on a rigid digit
 * and on its articulated counterpart. The underside remains grippy hide. */
export function drawGpEquipment(
  c: CanvasRenderingContext2D,
  colours: RiderColours,
  team: LiveryScheme,
) {
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  const primary = hex(colours.primary),
    secondary = hex(colours.secondary),
    accent = hex(colours.accent);
  const ivory = '#d6d7cd',
    dark = '#202227',
    edge = '#45494b';
  const patch = (points: number[][], fill: string, stroke?: string) => {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1.3;
      c.stroke();
    }
  };
  const stitch = (points: number[][]) => {
    c.save();
    c.setLineDash([2.4, 2.1]);
    c.strokeStyle = '#a1a29a';
    c.lineWidth = 0.9;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    c.restore();
  };
  parts.forEach((part, i) => {
    c.save();
    c.translate(i * 128, 384);
    c.beginPath();
    c.rect(0, 0, 128, 128);
    c.clip();
    c.fillStyle = dark;
    c.fillRect(0, 0, 128, 128);
    if (part === 'palm') {
      patch(
        [
          [0, 0],
          [85, 0],
          [75, 22],
          [61, 41],
          [49, 54],
          [0, 59],
        ],
        secondary,
      );
      patch(
        [
          [69, 69],
          [99, 47],
          [126, 55],
          [126, 110],
          [101, 113],
          [77, 93],
        ],
        '#51483e',
        '#3c3936',
      );
      patch(
        [
          [8, 88],
          [34, 78],
          [64, 91],
          [71, 107],
          [52, 120],
          [3, 116],
        ],
        '#383a39',
      );
      stitch([
        [72, 71],
        [99, 51],
        [120, 57],
      ]);
    } else if (part === 'back') {
      c.fillStyle = primary;
      c.fillRect(0, 0, 128, 128);
      patch(
        [
          [0, 3],
          [34, 9],
          [49, 45],
          [48, 64],
          [22, 95],
          [0, 119],
        ],
        ivory,
      );
      patch(
        [
          [128, 3],
          [107, 11],
          [92, 38],
          [89, 72],
          [104, 105],
          [128, 122],
        ],
        secondary,
      );
      patch(
        [
          [62, 49],
          [76, 34],
          [65, 82],
          [35, 108],
        ],
        accent,
      );
      stitch([
        [3, 119],
        [25, 92],
        [51, 64],
        [52, 48],
        [37, 8],
      ]);
      drawMark(c, { ...BRAND_ART[team.title], ink: ivory }, 41, 68, 44, 18);
    } else if (part === 'closure') {
      patch(
        [
          [1, 13],
          [121, 7],
          [126, 24],
          [117, 112],
          [12, 118],
          [2, 103],
        ],
        secondary,
        edge,
      );
      patch(
        [
          [0, 29],
          [29, 19],
          [80, 18],
          [57, 35],
          [0, 49],
        ],
        accent,
      );
      drawMark(c, { ...BRAND_ART[team.title], ink: ivory }, 39, 45, 59, 35);
      stitch([
        [12, 110],
        [110, 104],
        [119, 29],
      ]);
    } else if (part === 'knuckle') {
      for (let k = 0; k < 4; k++) {
        const y = 5 + 30 * k,
          w = k === 3 ? 28 : 34;
        patch(
          [
            [10, y + 7],
            [27, y],
            [w + 17, y + 3],
            [w + 24, y + 12],
            [w + 14, y + 22],
            [19, y + 26],
            [9, y + 19],
          ],
          ivory,
          '#666a67',
        );
        patch(
          [
            [22, y + 5],
            [w + 12, y + 5],
            [w + 18, y + 9],
            [27, y + 11],
          ],
          '#a7aca9',
        );
        for (let j = 0; j < 2; j++)
          patch(
            [
              [27 + j * 10, y + 14],
              [33 + j * 10, y + 13],
              [31 + j * 10, y + 17],
              [26 + j * 10, y + 18],
            ],
            dark,
          );
      }
    } else if (part === 'digit') {
      patch(
        [
          [5, 127],
          [8, 62],
          [15, 14],
          [26, 2],
          [48, 4],
          [61, 21],
          [57, 81],
          [46, 127],
        ],
        primary,
      );
      for (const [y, h] of [
        [15, 30],
        [56, 21],
        [89, 28],
      ]) {
        patch(
          [
            [16, y + 5],
            [26, y],
            [45, y + 1],
            [53, y + 6],
            [48, y + h],
            [26, y + h + 1],
            [15, y + h - 6],
          ],
          ivory,
          edge,
        );
        patch(
          [
            [20, y + 4],
            [28, y + 1],
            [43, y + 3],
            [47, y + 6],
            [25, y + 9],
          ],
          '#adb0aa',
        );
      }
      stitch([
        [10, 124],
        [13, 60],
        [20, 11],
      ]);
    } else {
      // A boot is a continuous wrap. Repeat around the side seam so both
      // sidewalls carry their own counter and the instep has a dark flex zone.
      const shaft = part === 'shaft';
      for (const x of [0, 64, 128]) {
        c.save();
        c.translate(x, 0);
        patch(
          [
            [-20, 0],
            [18, 0],
            [25, 22],
            [18, 58],
            [10, 84],
            [15, 121],
            [-5, 129],
            [-12, 87],
            [-22, 53],
          ],
          shaft ? primary : secondary,
        );
        patch(
          [
            [-15, 1],
            [7, 0],
            [14, 20],
            [12, 42],
            [3, 63],
            [-7, 91],
            [-13, 111],
            [-17, 91],
            [-15, 65],
            [-5, 41],
          ],
          ivory,
        );
        patch(
          [
            [-17, 113],
            [-7, 83],
            [7, 61],
            [13, 49],
            [9, 71],
            [-7, 109],
          ],
          accent,
        );
        if (shaft) {
          for (let j = 0; j < 3; j++)
            patch(
              [
                [-9, 18 + j * 7],
                [3, 15 + j * 7],
                [1, 18 + j * 7],
                [-10, 21 + j * 7],
              ],
              dark,
            );
        } else {
          for (let j = 0; j < 4; j++)
            patch(
              [
                [15, 39 + j * 8],
                [25, 42 + j * 8],
                [25, 45 + j * 8],
                [14, 42 + j * 8],
              ],
              edge,
            );
        }
        c.restore();
      }
      if (shaft) drawMark(c, { ...BRAND_ART[team.title], ink: ivory }, 24, 37, 20, 11);
    }
    c.restore();
  });
}
