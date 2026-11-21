import { drawGpEquipment } from './gp-equipment-print.ts';
import { GP_LUMBAR_PLEATS } from './gp-rider-suit.ts';
import { canvasTexture } from './geometry.ts';
import { type LiveryScheme } from './car-livery.ts';
import { BRAND_ART, drawMark, drawWordmark, fitHeight, type Brand } from './studio/brand-atlas.ts';
import type { RiderColours } from './rider.ts';

const chalk = '#e2e5dc';
const hide = '#22262b';
const rubber = '#181b20';
const hex = (value: number) => '#' + value.toString(16).padStart(6, '0');

function badge(c: CanvasRenderingContext2D, partner: Brand, x: number, y: number, w: number, h: number) {
  // The suit loft winds towards its front, so outside-facing type runs toward decreasing U.
  c.save();
  c.translate(x, y);
  c.scale(-1, 1);
  drawMark(c, { ...BRAND_ART[partner], ink: chalk }, -w / 2, -h / 2, w, h);
  c.restore();
}

/** The torso wrap runs from the right seam across the chest, left flank and
 * airbag back to the same seam. The pale saddle stops short of the number
 * and the lower back expands into the seat of the one-piece leathers. */
export function gpTorsoPrint(colours: RiderColours, number: number, team: LiveryScheme) {
  return canvasTexture(1024, 512, c => {
    c.fillStyle = hex(colours.primary);
    c.fillRect(0, 0, 1024, 512);
    // Armhole gussets and the return under the ribs. Include the cut at both ends of U.
    for (const x of [0, 512, 1024]) {
      c.save();
      c.translate(x, 0);
      c.beginPath();
      c.moveTo(-87, 19);
      c.bezierCurveTo(-120, 85, -59, 142, -59, 212);
      c.bezierCurveTo(-62, 296, -108, 363, -142, 433);
      c.quadraticCurveTo(-104, 408, -54, 393);
      c.lineTo(0, 462);
      c.lineTo(54, 393);
      c.quadraticCurveTo(103, 408, 142, 433);
      c.bezierCurveTo(94, 339, 63, 287, 59, 212);
      c.bezierCurveTo(60, 132, 119, 77, 87, 19);
      c.closePath();
      c.fillStyle = hex(colours.secondary);
      c.fill();
      for (const sign of [-1, 1]) {
        c.save();
        c.scale(sign, 1);
        c.beginPath();
        c.moveTo(74, 88);
        c.bezierCurveTo(65, 144, 41, 176, 49, 236);
        c.quadraticCurveTo(51, 289, 92, 350);
        c.bezierCurveTo(63, 277, 48, 240, 62, 184);
        c.closePath();
        c.fillStyle = hex(colours.accent);
        c.fill();
        c.restore();
      }
      c.restore();
    }
    for (const mid of [256, 768]) {
      c.save();
      c.translate(mid, 0);
      // The two shoulders carry light hide that flows toward the collar. A narrow
      // coloured return keeps the armhole distinct when the rider is tucked.
      for (const sign of [-1, 1]) {
        c.save();
        c.scale(sign, 1);
        c.beginPath();
        c.moveTo(42, 0);
        c.lineTo(206, 0);
        c.bezierCurveTo(222, 35, 192, 89, 158, 131);
        c.bezierCurveTo(136, 157, 125, 192, 125, 217);
        c.quadraticCurveTo(109, 175, 119, 149);
        c.bezierCurveTo(151, 82, 111, 48, 42, 15);
        c.closePath();
        c.fillStyle = chalk;
        c.fill();
        c.beginPath();
        c.moveTo(180, 27);
        c.bezierCurveTo(177, 66, 157, 84, 143, 104);
        c.strokeStyle = hex(colours.primary);
        c.lineWidth = 4;
        c.stroke();
        c.restore();
      }
      c.beginPath();
      c.moveTo(-198, 512);
      c.lineTo(-186, 430);
      c.bezierCurveTo(-140, 402, -108, 346, 0, 345);
      c.bezierCurveTo(107, 346, 146, 403, 186, 430);
      c.lineTo(199, 512);
      c.closePath();
      c.fillStyle = hide;
      c.fill();
      c.strokeStyle = '#484b4d';
      c.lineWidth = 2;
      c.stroke();
      if (mid === 768) {
        // Transverse concertina above the seat. The bend shortens each rib
        // toward the hip and leaves an uninterrupted central sponsor panel.
        const pleats = GP_LUMBAR_PLEATS;
        for (let i = 0; i < pleats.count; i++) {
          const w = pleats.width + Math.sin(i / (pleats.count - 1) * Math.PI) * pleats.flare,
            y = pleats.first + i * pleats.pitch,
            rise = pleats.curve * w * w;
          c.beginPath();
          c.moveTo(-w, y + rise);
          c.quadraticCurveTo(0, y - rise, w, y + rise);
          c.strokeStyle = i === 0 ? '#515355' : '#32373d';
          c.lineWidth = 3;
          c.stroke();
        }
        const digits = String(number).padStart(2, '0');
        c.save();
        c.scale(-1, 1);
        const style = { weight: .22, slant: .14, width: 1.04, tracking: .08 };
        const h = fitHeight(digits, 178, 86, style);
        c.strokeStyle = rubber;
        drawWordmark(c, digits, 0, 137, h, { ...style, weight: .37 });
        c.strokeStyle = chalk;
        drawWordmark(c, digits, 0, 137, h, style);
        c.restore();
      } else {
        c.fillStyle = rubber;
        c.fillRect(-3, 48, 6, 418);
        c.fillStyle = '#9b9da0';
        for (let y = 55; y < 451; y += 6) c.fillRect(-2, y, 4, 1.8);
      }
      // Ink transfers follow the dyed hide, without a rectangular background.
      badge(c, team.title, 0, mid === 768 ? 231 : 169, 250, 48);
      badge(c, team.partners[0], -72, 302, 97, 23);
      badge(c, team.partners[1], 72, 302, 97, 23);
      c.restore();
    }
  });
}

/** A single existing texture contains two complete cylindrical wraps. The
 * first 512px are a sleeve, the second a trouser leg. V=0 is the armhole
 * or hip and V=1 is the cuff. All cut edges meet at the wrap seam. */
export function gpLimbPrint(colours: RiderColours, team: LiveryScheme) {
  return canvasTexture(1024, 512, c => {
    c.save();
    c.scale(1, 0.75);
    for (const sleeve of [true, false]) {
      c.save();
      c.translate(sleeve ? 0 : 512, 0);
      c.beginPath();
      c.rect(0, 0, 512, 512);
      c.clip();
      c.fillStyle = hex(colours.primary);
      c.fillRect(0, 0, 512, 512);
      for (const x of [0, 256, 512]) {
        c.save();
        c.translate(x, 0);
        c.beginPath();
        c.moveTo(-79, 512);
        c.bezierCurveTo(-59, 443, -101, 380, -88, 324);
        c.bezierCurveTo(-80, 278, -49, 267, -47, 218);
        c.quadraticCurveTo(-44, 144, -63, 83);
        c.lineTo(-54, 0);
        c.lineTo(32, 0);
        c.bezierCurveTo(18, 108, 51, 200, 71, 251);
        c.bezierCurveTo(92, 303, 57, 380, 82, 512);
        c.closePath();
        c.fillStyle = hex(colours.secondary);
        c.fill();
        // Buff outer slider saddle, running onto the lower limb instead of
        // cutting a straight band around the knee or elbow.
        c.beginPath();
        c.moveTo(-43, sleeve ? 422 : 456);
        c.bezierCurveTo(-67, 344, -38, 285, -22, 249);
        c.bezierCurveTo(9, 196, -25, 132, -19, 87);
        c.quadraticCurveTo(-7, 147, 24, 193);
        c.bezierCurveTo(63, 283, 23, 298, 9, 332);
        c.bezierCurveTo(-13, 371, -22, 405, -43, sleeve ? 422 : 456);
        c.closePath();
        c.fillStyle = sleeve ? chalk : '#c3c8c5';
        c.fill();
        c.beginPath();
        c.moveTo(-56, 407);
        c.bezierCurveTo(-75, 325, -43, 289, -31, 269);
        c.strokeStyle = hex(colours.accent);
        c.lineWidth = sleeve ? 5 : 7;
        c.stroke();
        c.restore();
      }
      for (const x of [124, 380]) {
        badge(c, sleeve ? team.partners[0] : team.title, x, sleeve ? 360 : 385, 112, 24);
      }
      c.restore();
    }
    c.restore();
    drawGpEquipment(c, colours, team);
  });
}
