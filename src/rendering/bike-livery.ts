import { canvasTexture } from './geometry.ts';
import { drawWordmark } from './studio/brand-atlas.ts';
import type { RiderColours } from './rider.ts';

/** Original rider suit and helmet artwork, not copied team marks. The GP
 * machines' own liveries are painted by gp-race-bodywork.ts. */

export function riderPanelTexture(colours: RiderColours, torso: boolean, outwardReadable = false) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    const word = (...args: Parameters<typeof drawWordmark>) => {
      // The body loft uses +cos(phi), unlike the helmet's -cos(phi). Reverse
      // ink about its existing centre so each word reads outward; keep panel
      // backgrounds, UV seams, neck bands and the front zip in their places.
      if (outwardReadable) {
        c.save();
        c.translate(args[2] * 2, 0);
        c.scale(-1, 1);
      }
      drawWordmark(...args);
      if (outwardReadable) c.restore();
    };
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = css(colours.secondary);
    for (const x of [0, 512, 990]) c.fillRect(x, 0, 38, 512);
    for (const x of [0, 512]) {
      c.beginPath();
      c.moveTo(x + 30, 418);
      c.lineTo(x + 215, 346);
      c.lineTo(x + 420, 352);
      c.lineTo(x + 493, 440);
      c.lineTo(x + 493, 512);
      c.lineTo(x + 30, 512);
      c.closePath();
      c.fill();
      // Stitched light inserts wrap the shoulder and lower back, not the
      // whole limb. Dual edge stitches remain stationary in the bind UVs.
      c.fillStyle = '#d9ddd6';
      c.fillRect(x + 42, 36, 421, torso ? 38 : 24);
      c.fillStyle = css(colours.secondary);
      c.fillRect(x + 42, 79, 421, 3);
      c.strokeStyle = '#a8aead';
      c.lineWidth = 1.3;
      c.setLineDash([5, 4]);
      for (const y of [32, 80, 441]) {
        c.beginPath();
        c.moveTo(x + 45, y);
        c.lineTo(x + 461, y);
        c.stroke();
      }
      c.setLineDash([]);
      // Graphic sweep: a broad secondary band edged in accent, rising across
      // the panel the way factory leathers carry their colour (REF 018, 045).
      const sweep = (points: readonly (readonly [number, number])[], fill: string) => {
        c.beginPath();
        points.forEach(([px, py], i) => (i ? c.lineTo(x + px, py) : c.moveTo(x + px, py)));
        c.closePath();
        c.fillStyle = fill;
        c.fill();
      };
      sweep(
        [
          [42, 372],
          [470, 286],
          [470, 316],
          [42, 404],
        ],
        css(colours.secondary),
      );
      sweep(
        [
          [42, 364],
          [470, 278],
          [470, 286],
          [42, 372],
        ],
        css(colours.accent),
      );
      c.strokeStyle = '#e4e6e0';
      if (torso) {
        word(c, 'MOTOBOUND', x + 256, 142, 26, { weight: 0.2, slant: 0.14 });
        word(c, 'WORKS RACING', x + 256, 178, 11, { weight: 0.14, tracking: 0.24 });
        // Title partner on a dark, rounded panel rather than a paper box.
        c.fillStyle = '#1c2125';
        c.beginPath();
        c.roundRect(x + 128, 210, 256, 48, 10);
        c.fill();
        c.strokeStyle = '#e8eae4';
        word(c, 'MERIDIAN OIL', x + 256, 236, 20, {
          weight: 0.19,
          width: 0.88,
          slant: 0.1,
        });
        // Dense small partner marks at real patch scale.
        c.strokeStyle = '#e4e6e0';
        for (const [text, px, py, h] of [
          ['KESTREL', 120, 300, 10],
          ['VOLTEX', 392, 300, 11],
          ['NORDFIN', 256, 288, 9],
          ['AXON', 96, 222, 9],
          ['TITAN-X', 418, 222, 9],
          ['GRIPLINE', 256, 432, 10],
        ] as const)
          word(c, text, x + px, py, h, { weight: 0.16, tracking: 0.1 });
      } else {
        word(c, 'WORKS', x + 250, 176, 22, { weight: 0.21, slant: 0.18 });
        word(c, 'RACING', x + 250, 204, 11, { weight: 0.15, tracking: 0.3 });
        for (const [text, py] of [
          ['VOLTEX', 248],
          ['KESTREL', 270],
        ] as const)
          word(c, text, x + 250, py, 9, { weight: 0.16, tracking: 0.12 });
      }
      c.fillStyle = css(colours.secondary);
    }
    if (torso) {
      c.fillStyle = '#23272b';
      c.fillRect(253, 350, 6, 146);
      c.fillStyle = '#8b9296';
      for (let y = 353; y < 492; y += 7) c.fillRect(252, y, 8, 2);
    }
  });
}

/** Paint laid out for helmetShell's azimuth/height UVs. Broad asymmetric
 * chevrons identify an entrant at riding distance; the smooth shell supplies
 * all lighting. This is original artwork, not an extracted racing livery. */
export function helmetLiveryTexture(colours: RiderColours) {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    const polygon = (points: readonly (readonly [number, number])[], colour: string) => {
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    // Long crown lanes taper into the eye-port shoulders. The rear half has
    // the same panel cadence but different diagonal spacing for orientation.
    for (const x of [0, 512]) {
      polygon(
        [
          [x + 44, 0],
          [x + 162, 0],
          [x + 218, 168],
          [x + 171, 236],
          [x + 110, 202],
          [x + 67, 90],
        ],
        '#e5e9e7',
      );
      polygon(
        [
          [x + 56, 0],
          [x + 141, 0],
          [x + 196, 167],
          [x + 162, 208],
          [x + 123, 185],
          [x + 79, 78],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 316, 0],
          [x + 407, 0],
          [x + 385, 94],
          [x + 312, 215],
          [x + 291, 169],
        ],
        css(colours.accent),
      );
      polygon(
        [
          [x + 360, 296],
          [x + 487, 216],
          [x + 512, 248],
          [x + 512, 439],
          [x + 292, 456],
          [x + 182, 423],
        ],
        css(colours.secondary),
      );
      polygon(
        [
          [x + 350, 312],
          [x + 501, 241],
          [x + 512, 259],
          [x + 369, 334],
          [x + 200, 441],
          [x + 182, 423],
        ],
        css(colours.accent),
      );
    }
    c.fillStyle = '#e5e9e7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'italic 900 29px "Saira Variable", sans-serif';
    c.fillText('MB', 256, 187, 68);
    c.font = 'italic 800 40px "Saira Variable", sans-serif';
    c.fillText('MOTOBOUND', 768, 313, 282);
    c.font = '600 15px sans-serif';
    c.fillText('RACING EQUIPMENT', 768, 348, 256);
    // Fine lower edge trim follows the real neck-opening contour.
    c.fillStyle = css(colours.secondary);
    c.fillRect(0, 481, 1024, 31);
    c.fillStyle = css(colours.accent);
    c.fillRect(0, 475, 1024, 5);
  });
}
