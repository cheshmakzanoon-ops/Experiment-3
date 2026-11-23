import { drawWordmark } from './studio/brand-atlas.ts';
import type { bikeInstrumentReadout, gpInstrumentTelemetry } from './bike-cockpit.ts';

export const GP_TFT_LED_COUNT = 15;
const W = 512,
  H = 288;
const INK = '#eaf4e9',
  LABEL = '#9bb3a8',
  WARNING = '#ffce74';
const STYLE = { weight: 0.16, width: 1.02, tracking: 0.13, corner: 0.13 };
const CHARS = '0123456789NLR°%—';
const CELL = 44,
  CAP = 49,
  ROW = 55;
type Artwork = { plate: HTMLCanvasElement; glyphs: HTMLCanvasElement };
let shared: Artwork | undefined;

function drawLamp(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour?: string,
) {
  c.beginPath();
  c.arc(x, y, radius + 1.8, 0, 2 * Math.PI);
  c.fillStyle = '#171b20';
  c.fill();
  c.beginPath();
  c.arc(x, y, radius, 0, 2 * Math.PI);
  c.fillStyle = colour ?? '#283030';
  c.fill();
  if (colour) {
    c.beginPath();
    c.arc(x - radius * 0.25, y - radius * 0.28, radius * 0.34, 0, 2 * Math.PI);
    c.fillStyle = '#ffffda';
    c.fill();
  }
}

function title(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  cap: number,
  colour = LABEL,
) {
  c.strokeStyle = colour;
  drawWordmark(c, text, x, y, cap, STYLE, 'left');
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  c.beginPath();
  c.arc(x, y, radius, 0, 2 * Math.PI);
  c.stroke();
}

/** The instrument and its type are rasterized once, in instrument pixels.
 * Digits occupy fixed cells so shifts and changing speed never move a column. */
function artwork(): Artwork {
  if (shared) return shared;
  const plate = document.createElement('canvas'),
    glyphs = document.createElement('canvas');
  plate.width = W;
  plate.height = H;
  glyphs.width = CHARS.length * CELL;
  glyphs.height = ROW * 2;
  const c = plate.getContext('2d')!,
    g = glyphs.getContext('2d')!;
  c.fillStyle = '#080c0e';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#3b4747';
  c.fillRect(39, 37, 434, 239);
  c.fillStyle = '#101e21';
  c.fillRect(42, 40, 428, 233);
  c.fillStyle = '#080f11';
  c.fillRect(50, 50, 412, 15);
  c.fillStyle = '#384a4a';
  c.fillRect(167, 83, 2, 166);
  c.fillRect(373, 83, 2, 109);
  c.fillRect(187, 202, 256, 2);
  // Rear-quarter foil makes the screw heads legible against black polymer.
  for (const x of [20, 492])
    for (const y of [19, 269]) {
      c.lineWidth = 2;
      c.strokeStyle = '#545c5d';
      circle(c, x, y, 4.3);
      c.strokeStyle = '#20282b';
      c.beginPath();
      c.moveTo(x - 2, y + 2);
      c.lineTo(x + 2, y - 2);
      c.stroke();
    }
  for (let i = 0; i < GP_TFT_LED_COUNT; i++)
    drawLamp(c, 56 + (i * 400) / (GP_TFT_LED_COUNT - 1), 19, 7.3);
  for (let i = 0; i < 6; i++) {
    drawLamp(c, 19, 65 + i * 36, 6.4);
    drawLamp(c, 493, 65 + i * 36, 6.4);
  }
  for (const [i, name] of ['F °C', 'R °C', 'LEAN', 'CTRL'].entries()) {
    const y = 91 + i * 43;
    // The cap temperature labels use a drawn degree ring on either side.
    title(c, name.includes('°') ? name[0] : name, 52, y, 12.6);
    if (name.includes('°')) {
      c.lineWidth = 1.8;
      c.strokeStyle = LABEL;
      circle(c, 67, y - 4.6, 2);
      title(c, 'C', 72, y, 12.6);
    }
  }
  title(c, 'KM/H', 188, 92, 14);
  title(c, 'GEAR', 390, 92, 14);
  title(c, 'RPM', 188, 222, 14);
  for (let row = 0; row < 2; row++) {
    const ink = row ? WARNING : INK;
    for (const [i, ch] of Array.from(CHARS).entries()) {
      const x = i * CELL + CELL / 2,
        y = row * ROW + ROW / 2;
      g.strokeStyle = ink;
      g.lineWidth = CAP * 0.095;
      if (ch === '°') circle(g, x, y - CAP * 0.27, CAP * 0.12);
      else if (ch === '%') {
        circle(g, x - CAP * 0.16, y - CAP * 0.26, CAP * 0.084);
        circle(g, x + CAP * 0.16, y + CAP * 0.26, CAP * 0.084);
        g.beginPath();
        g.moveTo(x - CAP * 0.21, y + CAP * 0.42);
        g.lineTo(x + CAP * 0.21, y - CAP * 0.42);
        g.stroke();
      } else drawWordmark(g, ch === '—' ? '-' : ch, x, y, CAP, { ...STYLE, weight: 0.17 });
    }
  }
  return (shared = { plate, glyphs });
}

function digits(
  c: CanvasRenderingContext2D,
  sheet: HTMLCanvasElement,
  text: string,
  right: number,
  y: number,
  height: number,
  warning = false,
) {
  const width = (height * CELL) / ROW;
  const advance = 0.87 * width;
  let x = right - width;
  for (let i = text.length - 1; i >= 0; i--) {
    const code = CHARS.indexOf(text[i]);
    if (code >= 0)
      c.drawImage(sheet, code * CELL, warning ? ROW : 0, CELL, ROW, x, y, width, height);
    x -= advance;
  }
}

/** Redraw only the changing recorded channels over the shared, screen-printed face. */
export function drawGpRaceDisplay(
  c: CanvasRenderingContext2D,
  readout: ReturnType<typeof bikeInstrumentReadout>,
  telemetry: ReturnType<typeof gpInstrumentTelemetry>,
  lit: number,
  limiter: number,
) {
  const { plate, glyphs } = artwork();
  c.drawImage(plate, 0, 0);
  for (let i = 0; i < lit; i++)
    drawLamp(
      c,
      56 + (i * 400) / (GP_TFT_LED_COUNT - 1),
      19,
      7.3,
      i < 5 ? '#48dc7e' : i < 10 ? '#ffd055' : i < 14 ? '#ff483a' : '#60b8ff',
    );
  for (let i = 0; i < telemetry.braking; i++) drawLamp(c, 19, 245 - i * 36, 6.4, '#ff644d');
  for (let i = 0; i < telemetry.drive; i++) drawLamp(c, 493, 245 - i * 36, 6.4, '#4bd98b');
  c.fillStyle = lit === GP_TFT_LED_COUNT ? '#ff7152' : '#77baf2';
  c.fillRect(50, 50, 412 * readout.fill, 15);
  c.fillStyle = '#63847c';
  for (let rpm = 1000; rpm < limiter; rpm += 1000) c.fillRect(50 + (412 * rpm) / limiter, 67, 2, 5);
  const values = [telemetry.front, telemetry.rear, telemetry.lean, `${telemetry.control}%`];
  for (const [i, value] of values.entries())
    digits(c, glyphs, value, 156, 98 + i * 43, 21.5, i === 3 && telemetry.control >= 10);
  digits(c, glyphs, String(readout.speed), 360, 109, 75);
  digits(c, glyphs, readout.gear, 452, 111, 66);
  digits(c, glyphs, String(readout.rpm), 367, 231, 29);
  if (telemetry.pit) {
    c.fillStyle = '#342c1a';
    c.fillRect(384, 217, 75, 38);
    title(c, 'PIT', 397, 236, 19, WARNING);
  }
}
