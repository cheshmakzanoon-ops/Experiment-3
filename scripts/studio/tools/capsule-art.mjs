#!/usr/bin/env node
/**
 * CAPSULE ART COMPOSER (marketing). Builds every Steam store image from REAL game frames and the original
 * vector brand (docs/studio/store/brand/*.svg), at the exact sizes Steamworks asks for, and writes
 * docs/studio/store/art/**, a manifest (size, sources, hash) and a contact sheet.
 *
 *   node scripts/studio/tools/capsule-art.mjs                 build everything
 *   node scripts/studio/tools/capsule-art.mjs --only header,small     some assets (ids from --list)
 *   node scripts/studio/tools/capsule-art.mjs --list          the asset table
 *   node scripts/studio/tools/capsule-art.mjs --markdown      the file / Steam slot / alt text table for STORE_PAGE.md
 *   node scripts/studio/tools/capsule-art.mjs --verify        re-read the files on disk: sizes, formats, IP text check
 *
 * Needs only what the repo already has: Playwright's Chromium (CPU rasteriser, no WebGL; set CHROMIUM_PATH
 * if it is not at /opt/pw-browsers/chromium), the bundled Saira fonts, the frames in
 * docs/studio/store/art/frames and docs/studio/store/screenshots, and the SVGs. No network, no stock art.
 *
 * Layout language (docs/studio/store/BRAND.md): an asphalt board with a forward-leaning edge (the wordmark's
 * 10 degree slant), an amber lane line along that edge, a paper strip for the tagline, chalk type. No gradient
 * is used as decoration; the only soft edges are the blur of the page background and a mask that keeps the
 * hero's left third quiet.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const ART = join(ROOT, 'docs/studio/store/art');
const BRAND = join(ROOT, 'docs/studio/store/brand');
const FRAMES = join(ART, 'frames');
const SAIRA = join(ROOT, 'node_modules/@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2');
const STENCIL = join(ROOT, 'src/ui/fonts/saira-stencil-one-latin-400-normal.woff2');

const C = {
  ink: '#0b0c0d',
  a0: '#121315',
  a1: '#1a1b1e',
  a2: '#24262a',
  chalk: '#f1ecdf',
  dim: '#c9c3b3',
  paper: '#e8dfc8',
  paperInk: '#14110c',
  amber: '#ffb21a',
};
const TAN = Math.tan((10 * Math.PI) / 180);
const TAGLINE = 'RACE THE WRONG MACHINE';
// The library logo has to read over any hero art: a 4 px hard ink outline, then the game's hard offset shadow (no blur).
const OUTLINE = `filter:drop-shadow(4px 0 0 ${C.ink}) drop-shadow(-4px 0 0 ${C.ink}) drop-shadow(0 4px 0 ${C.ink}) drop-shadow(0 -4px 0 ${C.ink}) drop-shadow(6px 7px 0 ${C.ink});`;
const url = (p) => pathToFileURL(p).href;

// ---- Image headers (no decoder needed: sizes are verified from the bytes on disk) ------------------------
export function imageInfo(buffer) {
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colourType: buffer[25] };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buffer[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
      }
      i += 2 + buffer.readUInt16BE(i + 2);
    }
  }
  throw new Error('not a PNG or JPEG');
}
const sizeOfFile = (path) => imageInfo(readFileSync(path));

// ---- Sources: the first existing file of each role wins; the manifest says which one was used ------------
const SOURCES = {
  pairing: ['frames/wildcard-knobblies-banking.jpg', '../screenshots/snow-pass.jpg'],
  coast: ['frames/coast-eh3-wide.jpg', '../screenshots/festival-dawn.jpg'],
  apx: ['frames/apx01-showroom.jpg', '../screenshots/menu-board.jpg'],
  apxp: ['frames/apx01-portrait.jpg', 'frames/apx01-showroom.jpg', '../screenshots/menu-board.jpg'],
  gp: ['frames/gp-lean-side.jpg', '../screenshots/gp-corner.jpg'],
  dirt: ['frames/mx-jump-side.jpg', '../screenshots/motocross-jump.jpg'],
  night: ['frames/night-gt-neon.jpg', '../screenshots/night-street-rain.jpg'],
};
const used = new Map();
const current = new Set();
function source(role) {
  for (const rel of SOURCES[role]) {
    const path = join(ART, rel);
    if (existsSync(path)) {
      const size = sizeOfFile(path);
      current.add(role);
      used.set(role, { role, file: relative(ROOT, path).split('\\').join('/'), width: size.width, height: size.height });
      return { path, ...size };
    }
  }
  throw new Error(`no frame for role ${role}: ${SOURCES[role].join(' or ')}`);
}

// ---- Layout pieces. All numbers are CSS px at the asset's 1x size; the screenshot's scale does the rest ----
/** A crop of a source frame fitted into a box: the crop is centred on (fx, fy) (0..1) and `zoom` 1 = the whole frame. */
function photo(role, box, { fx = 0.5, fy = 0.5, zoom = 1, css = '' } = {}) {
  const s = source(role);
  const aspect = box.w / box.h;
  let cw = s.width / zoom;
  let ch = cw / aspect;
  if (ch > s.height / zoom) {
    ch = s.height / zoom;
    cw = ch * aspect;
  }
  const cx = Math.min(Math.max(fx * s.width, cw / 2), s.width - cw / 2);
  const cy = Math.min(Math.max(fy * s.height, ch / 2), s.height - ch / 2);
  const k = box.w / cw;
  return `<div class="box" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"><img src="${url(s.path)}" style="width:${(s.width * k).toFixed(2)}px;height:${(s.height * k).toFixed(2)}px;left:${(-(cx - cw / 2) * k).toFixed(2)}px;top:${(-(cy - ch / 2) * k).toFixed(2)}px;${css}"></div>`;
}
const brand = (file, x, y, w, extra = '') => `<img class="brand" src="${url(join(BRAND, file))}" style="left:${x}px;top:${y}px;width:${w}px;${extra}">`;
const aspectOf = { 'motobound-wordmark.svg': 915.6 / 150, 'motobound-lockup-stacked.svg': 915.6 / 354, 'motobound-lockup-horizontal.svg': 1115.6 / 156, 'motobound-roundel.svg': 1 };
const hOf = (file, w) => w / aspectOf[file];
/** A forward-leaning board: width `bw` at the bottom, `bw + H*tan10` at the top; an amber lane line rides its edge. */
function board(H, bw, line = 3, y0 = 0) {
  const top = bw + H * TAN;
  return (
    `<div class="board" style="clip-path:polygon(0 0,${top}px 0,${bw}px 100%,0 100%);height:${H}px;top:${y0}px;width:${top}px"></div>` +
    `<div class="lane" style="clip-path:polygon(${top}px 0,${top + line / 1}px 0,${bw + line}px 100%,${bw}px 100%);height:${H}px;top:${y0}px;width:${top + line + 2}px"></div>`
  );
}
/** The paper strip (the entry-desk label): ink on paper, notched top-right corner. */
function tag(text, x, y, size, pad = 0.55) {
  const n = Math.round(size * 0.6);
  return `<div class="tag" style="left:${x}px;top:${y}px;font-size:${size}px;padding:${(size * pad).toFixed(1)}px ${(size * 0.9).toFixed(1)}px;clip-path:polygon(0 0,calc(100% - ${n}px) 0,100% ${n}px,100% 100%,0 100%)">${text}</div>`;
}
/** One discipline cell for the band: a crop, a stencil numeral on a paper plate, a label strip. */
function band(cells, box, { labelH = 20, font = 11 } = {}) {
  const gap = 2;
  const cw = (box.w - gap * (cells.length - 1)) / cells.length;
  return (
    `<div class="boxfill" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;background:${C.a0}"></div>` +
    cells
      .map((c, i) => {
        const x = box.x + i * (cw + gap);
        return (
          photo(c.role, { x, y: box.y, w: cw, h: box.h - labelH }, c) +
          `<div class="strip" style="left:${x}px;top:${box.y + box.h - labelH}px;width:${cw}px;height:${labelH}px;font-size:${font}px"><b class="num">${c.n}</b>${c.label}</div>`
        );
      })
      .join('')
  );
}

// ---- The assets ---------------------------------------------------------------------------------------------
/**
 * id, file (relative to art/), size [w, h] of the FILE, dpr (layout is drawn at size/dpr), format,
 * safe (the rule the layout obeys), alt (store-page alt text), build() -> body HTML at 1x.
 */
const ASSETS = [
  {
    id: 'header',
    file: 'capsule/header-920x430.png',
    size: [920, 430],
    dpr: 2,
    format: 'png',
    where: 'Store page header capsule; library "recent games" header',
    safe: 'logo inside 6% margins; board never wider than 48%; tagline paper strip fully inside the board',
    alt: 'MOTOBOUND key art: a motocross rider on the tarmac of a banked speed bowl with a rival ahead, beside the logo and the line RACE THE WRONG MACHINE on a dark board.',
    build: () => {
      const W = 460,
        H = 215,
        bw = 206;
      const lw = 164;
      return (
        photo('pairing', { x: 0, y: 0, w: W, h: H }, { fx: 0.331, fy: 0.52, zoom: 1.6 }) +
        board(H, bw) +
        brand('motobound-lockup-stacked.svg', 22, 58, lw) +
        tag(TAGLINE, 22, 58 + hOf('motobound-lockup-stacked.svg', lw) + 14, 9.5)
      );
    },
  },
  {
    id: 'header-1x',
    file: 'capsule/header-460x215.png',
    size: [460, 215],
    dpr: 1,
    format: 'png',
    where: 'Legibility check at the size Steam shows on a 1x screen',
    safe: 'same layout as header',
    alt: 'MOTOBOUND header capsule at 460x215.',
    build: () => ASSETS.find((a) => a.id === 'header').build(),
  },
  {
    id: 'small',
    file: 'capsule/capsule-small-462x174.png',
    size: [462, 174],
    dpr: 2,
    format: 'png',
    where: 'Search results, "more like this", bundles',
    safe: 'wordmark only (no tagline), at least 12 px margins at 1x; nothing finer than 8 px',
    alt: 'MOTOBOUND small capsule: the wordmark on a dark board beside a motocross rider seen from behind.',
    build: () => {
      const W = 231,
        H = 87,
        bw = 152;
      const lw = 124;
      return (
        photo('pairing', { x: 0, y: 0, w: W, h: H }, { fx: 0.359, fy: 0.546, zoom: 2.74 }) +
        board(H, bw, 2) +
        brand('motobound-wordmark.svg', 14, (H - hOf('motobound-wordmark.svg', lw)) / 2, lw)
      );
    },
  },
  {
    id: 'small-1x',
    file: 'capsule/capsule-small-231x87.png',
    size: [231, 87],
    dpr: 1,
    format: 'png',
    where: 'Legibility check at the size Steam shows on a 1x screen',
    safe: 'same layout as small',
    alt: 'MOTOBOUND small capsule at 231x87.',
    build: () => ASSETS.find((a) => a.id === 'small').build(),
  },
  {
    id: 'main',
    file: 'capsule/capsule-main-1232x706.png',
    size: [1232, 706],
    dpr: 2,
    format: 'png',
    where: 'Store front featured slot; Next Fest and sale placements',
    safe: 'logo inside the board, bands 84 px at 1x, labels 11 px at 1x',
    alt: 'MOTOBOUND main capsule: the logo and tagline beside a motocross rider on a banked speed bowl, with four bands below for circuit, GP bike, dirt and festival.',
    build: () => {
      const W = 616,
        H = 353,
        bandH = 90,
        bw = 266;
      const lw = 214;
      const bandBox = { x: 0, y: H - bandH, w: W, h: bandH };
      return (
        photo('pairing', { x: 0, y: 0, w: W, h: H - bandH }, { fx: 0.331, fy: 0.53, zoom: 1.6 }) +
        board(H - bandH, bw) +
        brand('motobound-lockup-stacked.svg', 30, 62, lw) +
        tag(TAGLINE, 30, 62 + hOf('motobound-lockup-stacked.svg', lw) + 18, 12) +
        band(
          [
            { role: 'night', label: 'CIRCUIT', n: 1, fx: 0.42, fy: 0.62, zoom: 1.7 },
            { role: 'gp', label: 'GP BIKE', n: 2, fx: 0.5, fy: 0.56, zoom: 1.28 },
            { role: 'dirt', label: 'DIRT', n: 3, fx: 0.5, fy: 0.52, zoom: 1.4 },
            { role: 'coast', label: 'FESTIVAL', n: 4, fx: 0.5, fy: 0.66, zoom: 1.9 },
          ],
          bandBox,
          { labelH: 22, font: 11 },
        )
      );
    },
  },
  {
    id: 'main-1x',
    file: 'capsule/capsule-main-616x353.png',
    size: [616, 353],
    dpr: 1,
    format: 'png',
    where: 'Legibility check at the size Steam shows on a 1x screen',
    safe: 'same layout as main',
    alt: 'MOTOBOUND main capsule at 616x353.',
    build: () => ASSETS.find((a) => a.id === 'main').build(),
  },
  {
    id: 'vertical',
    file: 'capsule/capsule-vertical-748x896.png',
    size: [748, 896],
    dpr: 2,
    format: 'png',
    where: 'Store front and sale pages (portrait)',
    safe: 'logo board on top, hero in the middle, three discipline bands at the base; 14 px margins at 1x',
    alt: 'MOTOBOUND vertical capsule: the logo and tagline on a dark board above a motocross rider in the air in a forest, with bands below for GP bike, circuit and festival.',
    build: () => {
      const W = 374,
        H = 448,
        top = 118,
        bandH = 86;
      return (
        `<div class="boxfill" style="left:0;top:0;width:${W}px;height:${H}px;background:${C.a0}"></div>` +
        photo('dirt', { x: 0, y: top, w: W, h: H - top - bandH }, { fx: 0.5, fy: 0.52, zoom: 1.5 }) +
        `<div class="boxfill" style="left:0;top:0;width:${W}px;height:${top}px;background:${C.a0}"></div>` +
        `<div class="laneh" style="top:${top - 1}px;width:${W}px"></div>` +
        brand('motobound-lockup-horizontal.svg', 22, 26, W - 44) +
        tag(TAGLINE, 22, 26 + hOf('motobound-lockup-horizontal.svg', W - 44) + 14, 11.5) +
        band(
          [
            { role: 'gp', label: 'GP BIKE', n: 2, fx: 0.5, fy: 0.56, zoom: 1.45 },
            { role: 'night', label: 'CIRCUIT', n: 1, fx: 0.42, fy: 0.62, zoom: 1.9 },
            { role: 'coast', label: 'FESTIVAL', n: 4, fx: 0.5, fy: 0.66, zoom: 2.4 },
          ],
          { x: 0, y: H - bandH, w: W, h: bandH },
          { labelH: 22, font: 11 },
        )
      );
    },
  },
  {
    id: 'library-capsule',
    file: 'library/library-capsule-600x900.png',
    size: [600, 900],
    dpr: 1,
    format: 'png',
    where: 'Steam library grid (portrait)',
    safe: 'lower third is a quiet board carrying only the logo and tagline; no detail below y=600',
    alt: 'MOTOBOUND library capsule: the original APX-01 formula car in a dark showroom above the logo and tagline on a dark board.',
    build: () => {
      const W = 600,
        H = 900,
        top = 612;
      return (
        photo('apxp', { x: 0, y: 0, w: W, h: top }, { fx: 0.415, fy: 0.54, zoom: 1.3 }) +
        `<div class="boxfill" style="left:0;top:${top}px;width:${W}px;height:${H - top}px;background:${C.a0}"></div>` +
        `<div class="laneh" style="top:${top - 2}px;width:${W}px;height:4px"></div>` +
        brand('motobound-lockup-stacked.svg', (W - 380) / 2, top + 44, 380) +
        tag(TAGLINE, (W - 270) / 2, top + 44 + hOf('motobound-lockup-stacked.svg', 380) + 26, 14)
      );
    },
  },
  {
    id: 'library-header',
    file: 'library/library-header-920x430.png',
    size: [920, 430],
    dpr: 2,
    format: 'png',
    where: 'Steam library "recent games" header (re-uses the header composition)',
    safe: 'same as header',
    alt: 'MOTOBOUND library header: the same art as the store header capsule.',
    build: () => ASSETS.find((a) => a.id === 'header').build(),
  },
  {
    id: 'library-hero',
    file: 'library/library-hero-3840x1240.jpg',
    size: [3840, 1240],
    dpr: 1,
    format: 'jpeg',
    where: 'Top of the library game page. NO text or logo (the logo is layered separately)',
    safe: 'no text; the left third is held dark for the logo; the subject sits centre-right',
    alt: 'A white electric hypercar seen side-on on the Solvane coast road in low evening light, the sea on the horizon; the left of the picture is held dark for the logo.',
    build: () => {
      const W = 3840,
        H = 1240;
      return (
        photo('coast', { x: 0, y: 0, w: W, h: H }, { fx: 0.5, fy: 0.5, zoom: 1.0 }) +
        // Keep the left third quiet for the logo overlay: a plain mask over the photo, not a decorative gradient.
        `<div class="quiet" style="width:${W * 0.5}px;height:${H}px"></div>`
      );
    },
  },
  {
    id: 'page-background',
    file: 'page/page-background-1438x810.jpg',
    size: [1438, 810],
    dpr: 1,
    format: 'jpeg',
    where: 'Behind the store page',
    safe: 'blurred, dark (mean luminance about 15%), no focal point under the page text',
    alt: 'A dark, blurred view of the Solvane coast road and a white hypercar, used behind the store page.',
    luma: 0.15,
    build: () =>
      photo('coast', { x: 0, y: 0, w: 1438, h: 810 }, { fx: 0.62, fy: 0.5, zoom: 1.0, css: 'filter:blur(16px) saturate(.75) brightness(.42);transform:scale(1.06)' }),
  },
  {
    id: 'library-logo',
    file: 'library/library-logo-1280x720.png',
    size: [1280, 720],
    dpr: 1,
    format: 'png',
    transparent: true,
    where: 'Layered over the library hero',
    safe: 'transparent; lockup inside 40 px margins; a hard ink offset keeps it readable over light art',
    alt: 'The MOTOBOUND logo: amber roundel, chalk wordmark, three lane chevrons.',
    build: () => {
      const w = 1180;
      return brand('motobound-lockup-stacked.svg', (1280 - w) / 2, (720 - hOf('motobound-lockup-stacked.svg', w)) / 2, w, OUTLINE);
    },
  },
  {
    id: 'library-logo-mono',
    file: 'library/library-logo-mono-white-1280x720.png',
    size: [1280, 720],
    dpr: 1,
    format: 'png',
    transparent: true,
    where: 'One-colour fallback for the library logo',
    safe: 'one colour (chalk), roundel knocked out; inside 40 px margins',
    alt: 'The MOTOBOUND logo in one colour.',
    build: () => {
      const w = 1180;
      return brand('motobound-lockup-mono-chalk.svg', (1280 - w) / 2, (720 - hOf('motobound-lockup-horizontal.svg', w)) / 2, w, OUTLINE);
    },
  },
  {
    id: 'community-icon',
    file: 'icons/community-icon-184x184.jpg',
    size: [184, 184],
    dpr: 1,
    format: 'jpeg',
    where: 'Steam community hub icon (JPG, no wordmark)',
    safe: 'mark only, 14% margins',
    alt: 'The MOTOBOUND roundel on dark asphalt.',
    build: () => `<div class="boxfill" style="left:0;top:0;width:184px;height:184px;background:${C.a0}"></div>` + brand('motobound-roundel.svg', 20, 20, 144),
  },
  {
    id: 'client-icon',
    file: 'icons/client-icon-256x256.png',
    size: [256, 256],
    dpr: 1,
    format: 'png',
    where: 'Steam client icon source and the desktop shell icon (replaces the placeholder in desktop/build/icon.png)',
    safe: 'mark only on a square, 12% margins',
    alt: 'The MOTOBOUND roundel on dark asphalt.',
    build: () => `<div class="boxfill" style="left:0;top:0;width:256px;height:256px;background:${C.a0}"></div>` + brand('motobound-roundel.svg', 30, 30, 196),
  },
  {
    id: 'icon-master',
    file: 'icons/icon-1024x1024.png',
    size: [1024, 1024],
    dpr: 1,
    format: 'png',
    where: 'Master icon for ICO/ICNS conversion',
    safe: 'mark only, 12% margins',
    alt: 'The MOTOBOUND roundel on dark asphalt.',
    build: () => `<div class="boxfill" style="left:0;top:0;width:1024px;height:1024px;background:${C.a0}"></div>` + brand('motobound-roundel.svg', 124, 124, 776),
  },
  {
    id: 'event-banner',
    file: 'event/event-banner-800x450.png',
    size: [800, 450],
    dpr: 1,
    format: 'png',
    where: 'News and event posts (small event art)',
    safe: 'header layout at 800 wide',
    alt: 'MOTOBOUND event banner: the logo and tagline beside a motocross rider on a banked speed bowl.',
    build: () => {
      const W = 800,
        H = 450,
        bw = 352;
      const lw = 282;
      return (
        photo('pairing', { x: 0, y: 0, w: W, h: H }, { fx: 0.331, fy: 0.5, zoom: 1.6 }) +
        board(H, bw, 4) +
        brand('motobound-lockup-stacked.svg', 38, 140, lw) +
        tag(TAGLINE, 38, 140 + hOf('motobound-lockup-stacked.svg', lw) + 22, 15)
      );
    },
  },
];

const CSS = `
@font-face{font-family:'Saira';src:url(${url(SAIRA)}) format('woff2');font-weight:100 900;font-stretch:50% 125%}
@font-face{font-family:'Saira Stencil One';src:url(${url(STENCIL)}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{overflow:hidden;background:${C.a0}}
html.clear,html.clear body{background:transparent}
.cv{position:relative;overflow:hidden;background:${C.a0}}
.box{position:absolute;overflow:hidden}
.box img{position:absolute;max-width:none;display:block}
.boxfill{position:absolute}
.board{position:absolute;left:0;background:${C.a0}}
.lane{position:absolute;left:0;background:${C.amber}}
.laneh{position:absolute;left:0;height:3px;background:${C.amber}}
.brand{position:absolute;display:block;height:auto}
.tag{position:absolute;background:${C.paper};color:${C.paperInk};font:700 12px/1 'Saira',sans-serif;font-stretch:92%;letter-spacing:.16em;text-transform:uppercase;white-space:nowrap}
.strip{position:absolute;background:${C.a0};color:${C.chalk};font:700 11px/1 'Saira',sans-serif;font-stretch:92%;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:.7em;padding-left:.8em;border-top:2px solid ${C.amber}}
.strip .num{display:inline-flex;align-items:center;justify-content:center;min-width:1.5em;height:1.5em;background:${C.paper};color:${C.paperInk};font:400 1.05em/1 'Saira Stencil One',sans-serif;letter-spacing:0}
.quiet{position:absolute;left:0;top:0;background:${C.a0};-webkit-mask-image:linear-gradient(90deg,#000 0%,rgba(0,0,0,.92) 60%,transparent 100%);mask-image:linear-gradient(90deg,#000 0%,rgba(0,0,0,.92) 60%,transparent 100%)}
`;

function pageHtml(asset, body) {
  const [w, h] = asset.size.map((v) => v / asset.dpr);
  return `<!doctype html><html class="${asset.transparent ? 'clear' : ''}"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="cv" style="width:${w}px;height:${h}px;${asset.transparent ? 'background:transparent' : ''}">${body}</div></body></html>`;
}

// ---- Run --------------------------------------------------------------------------------------------------
const { values: v } = parseArgs({
  options: {
    only: { type: 'string' },
    list: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    markdown: { type: 'boolean', default: false },
    'no-sheet': { type: 'boolean', default: false },
  },
});

if (v.list) {
  for (const a of ASSETS) console.log(`${a.id.padEnd(20)} ${a.size.join('x').padEnd(10)} ${a.format.padEnd(5)} ${a.file}`);
  process.exit(0);
}

const manifestPath = join(ART, 'manifest.json');

async function ipCheck(texts) {
  const { findBrands } = await import(pathToFileURL(join(ROOT, 'scripts/ip-denylist.mjs')).href);
  const hits = [];
  for (const [label, text] of texts) for (const hit of findBrands(text)) hits.push(`${label}: ${JSON.stringify(hit)}`);
  return hits;
}

/** Text that ends up in the images or their alt text: the IP guard's matcher must find nothing in it. */
function allText() {
  const out = [['tagline', TAGLINE]];
  for (const a of ASSETS) out.push([`alt ${a.id}`, a.alt], [`where ${a.id}`, a.where]);
  for (const f of ['motobound-wordmark.svg', 'motobound-roundel.svg', 'motobound-lockup-horizontal.svg', 'motobound-lockup-stacked.svg'])
    out.push([f, readFileSync(join(BRAND, f), 'utf8')]);
  return out;
}

if (v.markdown) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const a of manifest.assets.filter((x) => !x.id.endsWith('-1x'))) console.log(`| \`art/${a.file}\` (${a.width}x${a.height}) | ${a.steamSlot} | ${a.alt} |`);
  process.exit(0);
}

if (v.verify) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let bad = 0;
  for (const a of manifest.assets) {
    const path = join(ART, a.file);
    if (!existsSync(path)) {
      console.log(`MISSING  ${a.file}`);
      bad++;
      continue;
    }
    const info = imageInfo(readFileSync(path));
    const ok = info.width === a.width && info.height === a.height && info.format === a.format && (!a.transparent || info.colourType === 6);
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
    const same = sha === a.sha256;
    console.log(`${ok ? 'ok      ' : 'BAD SIZE'} ${a.file} ${info.width}x${info.height} ${info.format}${a.transparent ? ` alpha(colour type ${info.colourType})` : ''}${same ? '' : ' (differs from the manifest hash: rebuilt since?)'}`);
    if (!ok) bad++;
  }
  const hits = await ipCheck(allText());
  console.log(hits.length ? `IP check: ${hits.length} hit(s)\n  ${hits.join('\n  ')}` : 'IP check: findBrands found nothing in the tagline, alt text or brand SVG text');
  if (hits.length) bad++;
  process.exit(bad ? 1 : 0);
}

const only = v.only ? new Set(v.only.split(',')) : null;
const todo = ASSETS.filter((a) => !only || only.has(a.id));
const hits = await ipCheck(allText());
if (hits.length) {
  console.error(`IP guard: refusing to build, text hits ${hits.join('; ')}`);
  process.exit(4);
}

const work = join(tmpdir(), `capsule-art-${process.pid}`);
mkdirSync(work, { recursive: true });
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

/** Mean luminance (0..1) and transparency facts of an encoded image, read back through a canvas. */
async function analyse(buffer, format) {
  const page = await browser.newPage();
  const b64 = buffer.toString('base64');
  const result = await page.evaluate(
    async ([data, mime]) => {
      const img = new Image();
      img.src = `data:${mime};base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.min(img.width, 480);
      c.height = Math.round((c.width / img.width) * img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let clear = 0;
      for (let i = 0; i < px.length; i += 4) {
        sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        if (px[i + 3] < 8) clear++;
      }
      const n = px.length / 4;
      return { meanLuma: sum / n, clearFraction: clear / n, cornerAlpha: px[3] };
    },
    [b64, format === 'png' ? 'image/png' : 'image/jpeg'],
  );
  await page.close();
  return result;
}

const results = [];
for (const asset of todo) {
  const out = join(ART, asset.file);
  mkdirSync(dirname(out), { recursive: true });
  current.clear();
  const body = asset.build();
  const roles = [...current];
  const htmlPath = join(work, `${asset.id}.html`);
  writeFileSync(htmlPath, pageHtml(asset, body));
  const [w, h] = asset.size.map((s) => s / asset.dpr);
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: asset.dpr });
  const page = await context.newPage();
  await page.goto(url(htmlPath));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  });
  const options = { type: asset.format === 'png' ? 'png' : 'jpeg', omitBackground: !!asset.transparent, timeout: 600000 };
  if (asset.format === 'jpeg') options.quality = 92;
  let buffer = await page.screenshot(options);
  let facts = await analyse(buffer, asset.format);
  // The page background is tuned to a target luminance: nudge the brightness once if it is off by more than 2 points.
  if (asset.luma && Math.abs(facts.meanLuma - asset.luma) > 0.02) {
    const k = Math.min(1.8, Math.max(0.5, asset.luma / Math.max(facts.meanLuma, 0.01)));
    const html = readFileSync(htmlPath, 'utf8').replace(/brightness\(([\d.]+)\)/, (_, b) => `brightness(${(Number(b) * k).toFixed(3)})`);
    writeFileSync(htmlPath, html);
    await page.goto(url(htmlPath));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    });
    buffer = await page.screenshot(options);
    facts = await analyse(buffer, asset.format);
  }
  await context.close();
  const info = imageInfo(buffer);
  if (info.width !== asset.size[0] || info.height !== asset.size[1]) throw new Error(`${asset.id}: rendered ${info.width}x${info.height}, wanted ${asset.size.join('x')}`);
  if (asset.transparent && (info.colourType !== 6 || facts.cornerAlpha !== 0)) throw new Error(`${asset.id}: expected a transparent PNG (colour type ${info.colourType}, corner alpha ${facts.cornerAlpha})`);
  writeFileSync(out, buffer);
  console.log(`${asset.id.padEnd(18)} ${asset.size.join('x').padEnd(10)} ${(buffer.length / 1024).toFixed(0).padStart(5)} KB  luma ${facts.meanLuma.toFixed(3)}${asset.transparent ? `  clear ${(facts.clearFraction * 100).toFixed(0)}%` : ''}  ${asset.file}`);
  results.push({ asset, buffer, facts, info, roles });
}

// ---- ICO / ICNS-ready icon set (ImageMagick if it is there; the PNGs are the source of truth) -------------------
let ico = null;
try {
  const master = join(ART, 'icons/icon-1024x1024.png');
  const icoPath = join(ART, 'icons/icon.ico');
  if ((!only || only.has('icon-master')) && existsSync(master)) {
    execFileSync('convert', [master, '-define', 'icon:auto-resize=256,128,64,48,32,24,16', icoPath], { stdio: 'ignore' });
    ico = relative(ART, icoPath);
    console.log(`icon.ico (256,128,64,48,32,24,16) ${(statSync(icoPath).size / 1024).toFixed(0)} KB`);
  }
} catch {
  console.log('icon.ico skipped: ImageMagick `convert` is not available; build it from icons/icon-1024x1024.png');
}

// ---- Manifest + contact sheet ----------------------------------------------------------------------------------
const framesManifestPath = join(FRAMES, 'manifest.json');
const frameNotes = existsSync(framesManifestPath) ? JSON.parse(readFileSync(framesManifestPath, 'utf8')).shots : {};
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).assets : [];
const rendered = new Map(results.map((r) => [r.asset.id, r]));
const entries = ASSETS.map((asset) => {
  const r = rendered.get(asset.id);
  const prior = previous.find((p) => p.id === asset.id);
  if (!r && !prior) return null;
  if (!r) return prior;
  return {
    id: asset.id,
    file: asset.file,
    width: r.info.width,
    height: r.info.height,
    format: r.info.format,
    transparent: !!asset.transparent,
    bytes: r.buffer.length,
    sha256: createHash('sha256').update(r.buffer).digest('hex'),
    meanLuma: Number(r.facts.meanLuma.toFixed(3)),
    steamSlot: asset.where,
    safeArea: asset.safe,
    alt: asset.alt,
    sources: r.roles.map((role) => {
      const s = used.get(role);
      const name = s?.file?.split('/').pop()?.replace('.jpg', '');
      return { role, ...s, captured: frameNotes[name]?.takenAt ?? null, build: frameNotes[name]?.build ?? null };
    }),
    generatedBy: 'scripts/studio/tools/capsule-art.mjs',
  };
}).filter(Boolean);
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      version: 1,
      note: 'Game frames are software-GL captures (SwiftShader); retake on a GPU before launch. Brand SVGs are hand-authored (docs/studio/store/BRAND.md).',
      generatedBy: 'scripts/studio/tools/capsule-art.mjs',
      icoSet: ico,
      assets: entries,
    },
    null,
    2,
  ) + '\n',
);

if (!v['no-sheet']) {
  // Contact sheet: every asset at a readable scale with its size, plus the 1x legibility row at true pixels.
  const tile = (e, scale, bg = '#2a2b2f') => {
    const w = Math.round(e.width * scale);
    const h = Math.round(e.height * scale);
    return `<figure style="width:${w}px"><div style="width:${w}px;height:${h}px;background:${bg}"><img src="${url(join(ART, e.file))}" style="width:${w}px;height:${h}px;display:block"></div><figcaption>${e.id.toUpperCase()} <b>${e.width}x${e.height}</b> ${e.format.toUpperCase()} ${(e.bytes / 1024).toFixed(0)} KB</figcaption></figure>`;
  };
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  const row = (...ids) => `<div class="row">${ids.filter((i) => by[i]).map((i) => tile(by[i], 0.5)).join('')}</div>`;
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
body{background:${C.a1};padding:32px;overflow:visible;color:${C.chalk};font-family:'Saira',sans-serif}
h1{font:400 28px 'Saira Stencil One';letter-spacing:.04em;margin-bottom:6px}
p.s{color:${C.dim};font-size:14px;margin-bottom:22px}
.row{display:flex;gap:24px;align-items:flex-start;margin-bottom:28px;flex-wrap:wrap}
figure{display:block}figcaption{font:600 12px 'Saira';letter-spacing:.1em;color:${C.dim};margin-top:6px;text-transform:uppercase}figcaption b{color:${C.amber}}
h2{font:700 13px 'Saira';letter-spacing:.16em;text-transform:uppercase;color:${C.amber};margin:8px 0 12px}
</style></head><body><h1>MOTOBOUND STEAM ART</h1><p class="s">Generated by scripts/studio/tools/capsule-art.mjs. Game frames are software-GL captures. Capsules at 50%; the legibility row is at true 1x pixels.</p>
<h2>Capsules (2x files at 50%)</h2>${row('header', 'main', 'vertical')}${row('small', 'library-capsule', 'event-banner')}
<h2>Legibility at the pixel size Steam shows on a 1x screen (not scaled)</h2><div class="row">${['header-1x', 'small-1x', 'main-1x'].filter((i) => by[i]).map((i) => tile(by[i], 1)).join('')}</div>
<h2>Library hero 3840x1240 and page background 1438x810 (scaled)</h2><div class="row">${by['library-hero'] ? tile(by['library-hero'], 0.32) : ''}${by['page-background'] ? tile(by['page-background'], 0.5) : ''}</div>
<h2>Library logo (transparent) on dark and on light ground, then icons</h2><div class="row">${by['library-logo'] ? tile(by['library-logo'], 0.4, '#0b0c0d') + tile(by['library-logo'], 0.4, '#e8dfc8') : ''}${by['library-logo-mono'] ? tile(by['library-logo-mono'], 0.4, '#3a5a7a') : ''}${['community-icon', 'client-icon'].filter((i) => by[i]).map((i) => tile(by[i], 1)).join('')}${by['icon-master'] ? tile(by['icon-master'], 0.25) : ''}</div>
</body></html>`;
  const sheetPath = join(work, 'sheet.html');
  writeFileSync(sheetPath, sheet);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto(url(sheetPath));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  });
  await page.screenshot({ path: join(ART, 'contact-sheet.png'), fullPage: true, type: 'png' });
  await page.close();
  console.log('contact-sheet.png');
}
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(`done: ${results.length} asset(s), manifest ${relative(ROOT, manifestPath)}`);
