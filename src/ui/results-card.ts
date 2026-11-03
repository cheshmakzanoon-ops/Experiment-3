import { ART_VIEW } from './track-art.ts';

/** The result share card: a 1200 x 630 PNG drawn on a canvas from the finished session
 * (the size social feeds and Steam screenshots crop well). Everything is local: the card is
 * built from the snapshot's own figures and the venue's own line art, and saved through the
 * browser's download. No network, no external image, no account. The look is the paddock's:
 * ink on paper for the strip, amber on asphalt for the position, the venue drawn as the
 * loading board draws it. */
export const CARD = Object.freeze({ width: 1200, height: 630 });
export interface ShareCardData {
  /** Session line, e.g. "GRAND PRIX · 3 LAPS". */
  session: string;
  venue: string;
  machine: string;
  weather: string;
  player: string;
  /** 1-based finishing position, field size, and whether the player finished. */
  position: number;
  field: number;
  finished: boolean;
  raceTime: string;
  bestLap: string;
  /** "+2.310 s to the winner", "FASTEST LAP"... already formatted; may be empty. */
  gaps: string[];
  podium: { place: number; name: string; time: string }[];
  /** The venue's centreline as an SVG path in ART_VIEW units (track-art.ts), if any. */
  path: string | null;
  /** The date line on the strip (local date). */
  date: string;
}
const INK = '#0b0c0d',
  ASPHALT = '#1a1b1e',
  ASPHALT0 = '#121315',
  CHALK = '#f1ecdf',
  DIM = '#c9c3b3',
  FAINT = '#a39e92',
  PAPER = '#e8dfc8',
  PAPER_INK = '#14110c',
  AMBER = '#ffb21a';
const MEDAL = ['#e9b949', '#c3c7cc', '#c27a43'];
const STENCIL = "'Saira Stencil One', 'Saira Variable', 'Arial Narrow', Arial, sans-serif";
const SANS = "'Saira Variable', 'Arial Narrow', Arial, sans-serif";

/** Draw the card. Pure over the context, so it runs on any 2D canvas. */
export function drawShareCard(ctx: CanvasRenderingContext2D, d: ShareCardData) {
  const { width: W, height: H } = CARD;
  ctx.save();
  ctx.fillStyle = ASPHALT;
  ctx.fillRect(0, 0, W, H);
  // Paper strip: wordmark and date.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, 78);
  ctx.fillStyle = PAPER_INK;
  ctx.textBaseline = 'middle';
  ctx.font = `400 44px ${STENCIL}`;
  ctx.textAlign = 'left';
  ctx.fillText('MOTOBOUND', 40, 41);
  ctx.font = `650 22px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(d.date.toUpperCase(), W - 40, 41);
  // Position: the stencil numeral on asphalt.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = AMBER;
  ctx.font = `400 210px ${STENCIL}`;
  ctx.fillText(d.finished ? `P${d.position}` : 'END', 40, 290);
  ctx.fillStyle = DIM;
  ctx.font = `650 26px ${SANS}`;
  ctx.fillText(d.finished ? `OF ${d.field}` : 'SESSION ENDED', 46, 332);
  // Who, where, what.
  ctx.fillStyle = CHALK;
  ctx.font = `750 40px ${SANS}`;
  ctx.fillText(d.player.toUpperCase(), 46, 392);
  ctx.fillStyle = DIM;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText(`${d.venue.toUpperCase()}`, 46, 432);
  ctx.fillStyle = FAINT;
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText(
    `${d.machine.toUpperCase()} · ${d.session.toUpperCase()} · ${d.weather.toUpperCase()}`,
    46,
    466,
  );
  // Figures.
  const figures: [string, string][] = [
    ['RACE TIME', d.raceTime],
    ['BEST LAP', d.bestLap],
  ];
  let x = 46;
  for (const [label, value] of figures) {
    ctx.fillStyle = FAINT;
    ctx.font = `650 18px ${SANS}`;
    ctx.fillText(label, x, 512);
    ctx.fillStyle = CHALK;
    ctx.font = `400 38px ${STENCIL}`;
    ctx.fillText(value, x, 556);
    x += 250;
  }
  ctx.fillStyle = DIM;
  ctx.font = `600 22px ${SANS}`;
  if (d.gaps.length) ctx.fillText(d.gaps.slice(0, 2).join('  ·  ').toUpperCase(), 46, 598);
  // The venue, drawn from its centreline.
  const bx = 640,
    by = 110,
    bw = 520,
    bh = 390;
  ctx.fillStyle = ASPHALT0;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(241,236,223,0.32)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
  if (d.path && typeof Path2D !== 'undefined') {
    const scale = Math.min((bw - 60) / ART_VIEW.width, (bh - 60) / ART_VIEW.height);
    ctx.translate(bx + (bw - ART_VIEW.width * scale) / 2, by + (bh - ART_VIEW.height * scale) / 2);
    ctx.scale(scale, scale);
    const line = new Path2D(d.path);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 9;
    ctx.stroke(line);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3.4;
    ctx.stroke(line);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Podium strip along the bottom of the venue box.
  const top = d.podium.slice(0, 3);
  top.forEach((p, i) => {
    const px = bx + i * (bw / 3);
    ctx.fillStyle = MEDAL[i] ?? FAINT;
    ctx.beginPath();
    ctx.arc(px + 26, by + bh + 46, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `400 20px ${STENCIL}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.place), px + 26, by + bh + 47);
    ctx.textAlign = 'left';
    ctx.fillStyle = CHALK;
    ctx.font = `700 19px ${SANS}`;
    ctx.fillText(p.name.toUpperCase(), px + 52, by + bh + 38);
    ctx.fillStyle = FAINT;
    ctx.font = `600 16px ${SANS}`;
    ctx.fillText(p.time, px + 52, by + bh + 60);
  });
  ctx.restore();
}

/** Render the card to a PNG. Waits for the faces the card uses so the stencil numerals are not a fallback. */
export async function renderShareCard(d: ShareCardData, doc: Document = document): Promise<Blob> {
  const canvas = doc.createElement('canvas');
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  try {
    await Promise.all([doc.fonts.load(`400 40px ${STENCIL}`), doc.fonts.load(`650 20px ${SANS}`)]);
  } catch {
    // A missing face falls back to the next in the stack; the card is still drawn.
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available, so the result card cannot be drawn.');
  drawShareCard(ctx, d);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The result card could not be encoded.'))),
      'image/png',
    ),
  );
}
export function shareCardFilename(venueId: string, position: number, finished: boolean) {
  return `motobound-${venueId}-${finished ? `p${position}` : 'result'}.png`;
}
