#!/usr/bin/env node
/**
 * TRAILER PIPELINE (marketing). Honest scope: this repository cannot record a real trailer (no GPU; software GL
 * runs at single-digit fps). What it CAN do is produce, from the real game, the KEYFRAMES of every storyboard
 * shot (docs/studio/store/TRAILER_STORYBOARD.md), write the exact assembly recipe with the shot timings, and
 * assemble a silent 15-20 s ANIMATIC from those stills (slow pushes, board wipes, captions in the game's type).
 * An animatic made of stills is labelled as one; it is not gameplay footage and is not a Steam trailer.
 *
 *   node scripts/studio/tools/trailer-capture.mjs --list              shots, timings, where each keyframe comes from
 *   node scripts/studio/tools/trailer-capture.mjs --url http://127.0.0.1:4291 [--only t02,t04]   capture keyframes
 *   node scripts/studio/tools/trailer-capture.mjs --teaser            assemble the animatic (needs ffmpeg with libx264)
 *   node scripts/studio/tools/trailer-capture.mjs --captions          caption overlays (transparent 1920x1080 PNGs)
 *   node scripts/studio/tools/trailer-capture.mjs --recipe-script     write trailer/assemble-from-clips.sh (real clips)
 *
 * Output: docs/studio/store/trailer/{keyframes,captions,capsule-teaser-animatic.mp4,assemble-from-clips.sh}.
 * Capture reuses lib/game-director.mjs (pause on the moment, grow the viewport, redraw: the technique store-shots
 * found reliable on software GL). Frame-accurate 2-4 s clips at 30 fps are impractical there: a keyframe is
 * minutes. Where a keyframe equals a key-art frame or a store screenshot, that file is reused, not retaken.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runShots } from './lib/game-director.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const STORE = join(ROOT, 'docs/studio/store');
const OUT = join(STORE, 'trailer');
const KEYS = join(OUT, 'keyframes');
const url = (p) => pathToFileURL(p).href;
const SAIRA = join(ROOT, 'node_modules/@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2');
const STENCIL = join(ROOT, 'src/ui/fonts/saira-stencil-one-latin-400-normal.woff2');

/**
 * The storyboard as data (one source of truth for timings). `frame`: where the keyframe comes from, first
 * existing file wins. `capture`: a game-director shot (only the ones this tool takes itself). `caption`: the
 * storyboard's own caption. Times are seconds into the 75 s main trailer.
 */
export const SHOTS = [
  { n: 1, at: 0, dur: 4, title: 'Cold open: paddock showroom orbit', venue: 'aurel', vehicle: 'apx01', weather: 'clear', light: 'day', camera: 'showroom orbit', frame: ['art/apx01-showroom.jpg', '../screenshots/menu-board.jpg'] },
  { n: 2, at: 4, dur: 5, title: 'Lights out, low chase with the pack', venue: 'aurel', vehicle: 'apx01 + 7 rivals', weather: 'clear', light: 'day', camera: 'chase', frame: ['keyframes/t02-grid-pack.jpg', '../screenshots/formula-fog-golden.jpg'],
    capture: { id: 't02-grid-pack', title: 'Formula pack, first corners', kind: 'session', entry: { plate: 'circuit', mode: 'race', circuit: 'aurel', vehicle: 'apx01', weather: 'clear', light: 'day', opponents: '7', laps: '1' }, view: 'chase', hud: true, pick: { seconds: 18, minSpeed: 30 }, alt: 'A formula car chasing the pack through the first corners of the Aurel circuit with the race HUD.' } },
  { n: 3, at: 9, dur: 5, title: 'Night street run', caption: "CIRCUITS THAT DON'T LOOK LIKE CIRCUITS.", venue: 'neon-city', vehicle: 'gt10m', weather: 'clear', light: 'night', camera: 'low front 3/4, T-cam', frame: ['art/night-gt-neon.jpg', '../screenshots/night-street-rain.jpg'] },
  { n: 4, at: 14, dur: 5, title: 'Harbour streets in the rain', caption: 'WEATHER THAT CHANGES THE RACE.', venue: 'riviera', vehicle: 'fx26', weather: 'rain', light: 'day', camera: 'chase, cockpit', frame: ['keyframes/t04-rain-harbour.jpg', '../screenshots/night-street-rain.jpg'],
    capture: { id: 't04-rain-harbour', title: 'Formula car on the harbour streets in the rain', kind: 'session', entry: { plate: 'circuit', mode: 'practice', circuit: 'riviera', vehicle: 'fx26', weather: 'rain', light: 'day', opponents: '0' }, view: 'chase', hud: true, pick: { seconds: 24, minSpeed: 30 }, alt: 'A formula car on wet harbour streets with spray and the race HUD.' } },
  { n: 5, at: 19, dur: 5, title: 'GP bike lean through a coastal corner', venue: 'vellamar', vehicle: 'gpr1', weather: 'clear', light: 'day', camera: 'trackside pan, rider cam', frame: ['art/gp-lean-side.jpg', '../screenshots/gp-corner.jpg'] },
  { n: 6, at: 24, dur: 5, title: 'Superbikes, the rain arrives', venue: 'haarveld', vehicle: 'sbk1000', weather: 'dry-to-rain', light: 'day', camera: 'helicopter, chase', frame: ['../screenshots/gp-corner.jpg'], note: 'no keyframe of its own yet; the GP frame stands in' },
  { n: 7, at: 29, dur: 6, title: 'Gate drop, holeshot, the big jump', caption: 'MOTOCROSS. REAL JUMPS.', venue: 'valley-ridge-mx', vehicle: 'mx450', weather: 'clear', light: 'day', camera: 'rider cam, trackside slow-mo', frame: ['art/mx-jump-side.jpg', '../screenshots/motocross-jump.jpg'] },
  { n: 8, at: 35, dur: 5, title: 'Floodlit supercross rhythm section', caption: 'SUPERCROSS.', venue: 'arena-nord-sx', vehicle: 'mx250', weather: 'clear', light: 'venue (floodlit)', camera: 'low trackside, chase', frame: ['keyframes/t08-sx-floodlit.jpg', '../screenshots/motocross-jump.jpg'],
    capture: { id: 't08-sx-floodlit', title: 'Two-stroke motocross bike in the floodlit supercross arena', kind: 'session', entry: { plate: 'dirt', mode: 'practice', circuit: 'arena-nord-sx', vehicle: 'mx250', weather: 'clear', light: 'night', opponents: '0' }, view: 'chase', hud: true, pick: { seconds: 14, minSpeed: 12 }, alt: 'A motocross bike in the floodlit supercross arena with the race HUD.' } },
  { n: 9, at: 40, dur: 6, title: 'The hook: the wrong machine at the right venue', caption: 'WILDCARD: WRONG CAR. RIGHT TRACK.', venue: 'speedbowl (Wildcard: knobblies-on-the-banking)', vehicle: 'mx450', weather: 'clear', light: 'day', camera: 'chase', frame: ['art/wildcard-knobblies-banking.jpg', '../screenshots/snow-pass.jpg'], note: 'the Wildcard series shipped (29 events), so this shot is no longer PENDING' },
  { n: 10, at: 46, dur: 4, title: 'Trophy truck through the forest', venue: 'pinewood-stage', vehicle: 'dx8', weather: 'clear', light: 'day', camera: 'chase, hood', frame: ['keyframes/t10-gravel-truck.jpg', '../screenshots/snow-pass.jpg'],
    capture: { id: 't10-gravel-truck', title: 'Trophy truck on the forest gravel stage', kind: 'session', entry: { plate: 'circuit', mode: 'practice', circuit: 'pinewood-stage', vehicle: 'dx8', weather: 'clear', light: 'day', opponents: '0' }, view: 'chase', hud: true, pick: { seconds: 20, minSpeed: 20 }, alt: 'A trophy truck on a forest gravel stage with the race HUD.' } },
  { n: 11, at: 50, dur: 6, title: 'Coast road at golden hour', caption: 'THEN LEAVE THE TRACK.', venue: 'Solvane Coast, coast highway', vehicle: 'eh3 (storyboard: sc7)', weather: 'clear', light: 'golden hour', camera: 'chase, bonnet, drone', frame: ['art/coast-eh3-wide.jpg', '../screenshots/festival-dawn.jpg'] },
  { n: 12, at: 56, dur: 5, title: 'Drift zone: the roadster hangs the tail', venue: 'Varda Hairpins Drift Zone', vehicle: 'rd2', weather: 'clear', light: 'day', camera: 'trackside, T-cam', frame: [], note: 'NOT CAPTURED: a drift in progress needs a driver or a drift-capable autopilot; needs a GPU session' },
  { n: 13, at: 61, dur: 4, title: 'Airfield jump, skill chain banks', venue: 'Kestrel Airfield', vehicle: 'rd2', weather: 'clear', light: 'day', camera: 'side-on slow-mo', frame: [], note: 'NOT CAPTURED: festival jump zone, needs a driver; needs a GPU session' },
  { n: 14, at: 65, dur: 3, title: 'Photo mode freeze', venue: 'aurel', vehicle: 'apx01', weather: 'clear', light: 'dusk', camera: 'photo studio', frame: ['../screenshots/photo-studio.jpg'] },
  { n: 15, at: 68, dur: 4, title: 'Results card, then the montage', venue: 'various', vehicle: 'various', weather: 'various', light: 'various', camera: 'replay cuts', frame: ['../screenshots/results-board.jpg'] },
  { n: 16, at: 72, dur: 3, title: 'End card: logo on the asphalt board', venue: '', vehicle: '', weather: '', light: '', camera: 'design', frame: [], note: 'designed by this tool (the animatic end card); the wishlist line and release window are added when they are real' },
];
/** The 30 s cut-down: shots, in order, 5 s each (storyboard: 4-6 s). */
export const CUTDOWN = [2, 7, 5, 11, 9, 15];

const frameOf = (shot) => {
  for (const rel of shot.frame) {
    const path = rel.startsWith('art/') ? join(STORE, 'art/frames', rel.slice(4)) : rel.startsWith('keyframes/') ? join(OUT, rel) : join(OUT, rel);
    if (existsSync(path)) return path;
  }
  return null;
};

const { values: v } = parseArgs({
  options: {
    url: { type: 'string' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    teaser: { type: 'boolean', default: false },
    captions: { type: 'boolean', default: false },
    'recipe-script': { type: 'boolean', default: false },
    fps: { type: 'string', default: '30' },
    'no-stamp': { type: 'boolean', default: false },
    'budget-minutes': { type: 'string', default: '0' },
  },
});

// ---- --list -----------------------------------------------------------------------------------------------------
if (v.list) {
  const mm = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  console.log('shot  time        dur  keyframe');
  for (const s of SHOTS) {
    const f = frameOf(s);
    console.log(`t${String(s.n).padStart(2, '0')}   ${mm(s.at)}-${mm(s.at + s.dur)}  ${String(s.dur).padStart(2)} s  ${f ? relative(ROOT, f) : 'none'}${s.capture ? '   [captured by this tool]' : ''}${s.note ? `   (${s.note})` : ''}`);
  }
  console.log(`\ncut-down (30 s): ${CUTDOWN.map((n) => `t${String(n).padStart(2, '0')}`).join(' ')} at 5 s each`);
  process.exit(0);
}

// ---- --recipe-script --------------------------------------------------------------------------------------------
if (v['recipe-script']) {
  mkdirSync(OUT, { recursive: true });
  const body = `#!/usr/bin/env bash
# Assemble the main trailer from REAL clips. Generated by scripts/studio/tools/trailer-capture.mjs --recipe-script
# from the storyboard table (one source of truth for the timings). Needs: ffmpeg with libx264 and aac.
#
#   clips/tNN.mp4   one clip per storyboard shot (tNN = shot number), recorded from the packaged game on a GPU at
#                   1920x1080 60 fps, at least as long as the shot's duration below. Hard cuts, no crossfades.
#   captions/*.png  transparent 1920x1080 overlays (node scripts/studio/tools/trailer-capture.mjs --captions)
#   music.wav       an ORIGINAL or CC0 / CC-BY-credited bed (log the licence in LEGAL_CHECKLIST.md). Optional.
#   end card        shot 16 is rendered by --teaser's end card page; export it as clips/t16.mp4 or leave it out.
#
# Usage: bash assemble-from-clips.sh [main|cutdown] [OUTPUT.mp4]
set -euo pipefail
cd "$(dirname "$0")"
MODE="\${1:-main}"
OUTFILE="\${2:-trailer-\${MODE}.mp4}"
FPS=60
W=1920; H=1080
mkdir -p .work
rm -f .work/*.mp4 .work/list.txt

# shot  duration  caption-file
if [ "$MODE" = "cutdown" ]; then
  SHOTS=( ${CUTDOWN.map((n) => `"${n}:5"`).join(' ')} )
else
  SHOTS=( ${SHOTS.map((s) => `"${s.n}:${s.dur}"`).join(' ')} )
fi
declare -A CAPTION=( ${SHOTS.filter((s) => s.caption).map((s) => `[${s.n}]="captions/caption-${String(s.n).padStart(2, '0')}.png"`).join(' ')} )

for entry in "\${SHOTS[@]}"; do
  n="\${entry%%:*}"; d="\${entry##*:}"
  nn=$(printf '%02d' "$n")
  clip="clips/t\${nn}.mp4"
  if [ ! -f "$clip" ]; then echo "missing $clip (skipped; record it, see docs/studio/store/TRAILER_CAPTURE.md)"; continue; fi
  cap="\${CAPTION[$n]:-}"
  if [ -n "$cap" ] && [ -f "$cap" ]; then
    # caption in for the first 3.2 s of the shot, 0.5 s after the cut
    ffmpeg -y -loglevel error -i "$clip" -i "$cap" -t "$d" \\
      -filter_complex "[0:v]scale=\${W}:\${H}:flags=lanczos,fps=\${FPS},setsar=1[v];[v][1:v]overlay=0:0:enable='between(t,0.5,3.7)'[o]" \\
      -map "[o]" -an -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p ".work/s\${nn}.mp4"
  else
    ffmpeg -y -loglevel error -i "$clip" -t "$d" \\
      -vf "scale=\${W}:\${H}:flags=lanczos,fps=\${FPS},setsar=1" \\
      -an -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p ".work/s\${nn}.mp4"
  fi
  echo "file 's\${nn}.mp4'" >> .work/list.txt
done

ffmpeg -y -loglevel error -f concat -safe 0 -i .work/list.txt -c copy .work/video.mp4
if [ -f music.wav ]; then
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 .work/video.mp4)
  ffmpeg -y -loglevel error -i .work/video.mp4 -i music.wav -t "$DUR" \\
    -filter_complex "[1:a]afade=t=in:d=1,afade=t=out:st=$(awk "BEGIN{print $DUR-2}"):d=2[a]" \\
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$OUTFILE"
else
  ffmpeg -y -loglevel error -i .work/video.mp4 -c copy -movflags +faststart "$OUTFILE"
fi
echo "wrote $OUTFILE"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of default=nw=1 "$OUTFILE"
`;
  const path = join(OUT, 'assemble-from-clips.sh');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  console.log(`wrote ${relative(ROOT, path)}`);
  process.exit(0);
}

// ---- Shared page pieces (animatic, captions) -------------------------------------------------------------------------
const C = { a0: '#121315', a1: '#1a1b1e', chalk: '#f1ecdf', dim: '#c9c3b3', paper: '#e8dfc8', paperInk: '#14110c', amber: '#ffb21a' };
const CSS = `
@font-face{font-family:'Saira';src:url(${url(SAIRA)}) format('woff2');font-weight:100 900;font-stretch:50% 125%}
@font-face{font-family:'Saira Stencil One';src:url(${url(STENCIL)}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:${C.a0}}
html.clear,html.clear body{background:transparent}
.layer{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
.layer img{position:absolute;max-width:none;display:block}
.cap{position:absolute;left:96px;bottom:128px;background:${C.paper};color:${C.paperInk};font:700 40px/1 'Saira',sans-serif;font-stretch:92%;letter-spacing:.14em;text-transform:uppercase;padding:22px 36px;white-space:nowrap;clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%);border-left:10px solid ${C.amber}}
.stamp{position:absolute;right:48px;top:40px;background:${C.a0};color:${C.dim};font:650 15px/1 'Saira',sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:9px 14px;border-top:3px solid ${C.amber}}
.wipe{position:absolute;top:0;height:1080px;background:${C.a0}}
.wipelane{position:absolute;top:0;height:1080px;background:${C.amber}}
.end{position:absolute;inset:0;background:${C.a0}}
.end img{position:absolute;max-width:none}
`;
const SKEW = 1080 * Math.tan((10 * Math.PI) / 180);

// ---- --captions -------------------------------------------------------------------------------------------------
async function launch() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'] });
}
if (v.captions) {
  const dir = join(OUT, 'captions');
  mkdirSync(dir, { recursive: true });
  const browser = await launch();
  for (const s of SHOTS.filter((x) => x.caption)) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(`<!doctype html><html class="clear"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="cap">${s.caption}</div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const file = join(dir, `caption-${String(s.n).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
    console.log(`caption shot ${s.n}: ${relative(ROOT, file)}`);
  }
  await browser.close();
  process.exit(0);
}

// ---- --teaser (animatic) ------------------------------------------------------------------------------------------
if (v.teaser) {
  const fps = Number(v.fps);
  /** The animatic's beats: a keyframe, a hold, a slow push (zoom z0 -> z1 around (fx, fy), drifting dx, dy), a caption. */
  const BEATS = [
    { n: 1, hold: 2.0, fx: 0.4, fy: 0.68, z0: 1.3, z1: 1.45 },
    { n: 2, hold: 2.0, fx: 0.5, fy: 0.62, z0: 1.0, z1: 1.12 },
    { n: 3, hold: 2.2, fx: 0.5, fy: 0.62, z0: 1.12, z1: 1.0 },
    { n: 4, hold: 1.8, fx: 0.5, fy: 0.62, z0: 1.0, z1: 1.14 },
    { n: 5, hold: 1.8, fx: 0.5, fy: 0.55, z0: 1.0, z1: 1.16 },
    { n: 7, hold: 2.0, fx: 0.5, fy: 0.5, z0: 1.18, z1: 1.0 },
    { n: 9, hold: 2.4, fx: 0.5, fy: 0.55, z0: 1.0, z1: 1.15 },
    { n: 11, hold: 2.4, fx: 0.5, fy: 0.55, z0: 1.15, z1: 1.0 },
  ]
    .map((b) => ({ ...b, shot: SHOTS.find((s) => s.n === b.n) }))
    .map((b) => ({ ...b, file: frameOf(b.shot) }))
    .filter((b) => b.file);
  const END = 2.8;
  const WIPE = 0.4;
  let t = 0;
  for (const b of BEATS) {
    b.start = t;
    t += b.hold;
  }
  const endStart = t;
  const total = endStart + END;
  const frames = Math.round(total * fps);
  const brandSvg = join(STORE, 'brand/motobound-lockup-stacked.svg');
  const layers = BEATS.map((b, i) => `<div class="layer" id="b${i}" style="display:none"><img id="i${i}" src="${url(b.file)}"></div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${layers}
<div class="cap" id="cap" style="display:none"></div>
<div class="end" id="end" style="display:none"><img src="${url(brandSvg)}" id="logo" style="width:1060px;left:430px;top:260px"><div class="cap" id="endtag" style="left:700px;bottom:auto;top:700px;font-size:34px;border-left:0">RACE THE WRONG MACHINE</div></div>
<div class="wipe" id="wipe" style="display:none"></div><div class="wipelane" id="wipelane" style="display:none"></div>
${v['no-stamp'] ? '' : '<div class="stamp" id="stamp">Animatic. Stills from the game. Software GL.</div>'}
<script>
const BEATS=${JSON.stringify(BEATS.map((b) => ({ start: b.start, hold: b.hold, fx: b.fx, fy: b.fy, z0: b.z0, z1: b.z1, caption: b.shot.caption ?? '' })))};
const END_START=${endStart}, WIPE=${WIPE}, SKEW=${SKEW}, W=1920, H=1080;
const ease=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const snap=(x)=>1-Math.pow(1-Math.min(1,Math.max(0,x)),4);
function place(i,t){
  const b=BEATS[i], img=document.getElementById('i'+i), p=Math.min(1,Math.max(0,(t-b.start)/b.hold));
  const e=ease(p), z=b.z0+(b.z1-b.z0)*e, sw=img.naturalWidth, sh=img.naturalHeight, a=W/H;
  let cw=sw/z, ch=cw/a; if(ch>sh/z){ch=sh/z;cw=ch*a}
  const cx=Math.min(Math.max(b.fx*sw,cw/2),sw-cw/2), cy=Math.min(Math.max(b.fy*sh,ch/2),sh-ch/2), k=W/cw;
  img.style.width=(sw*k)+'px'; img.style.height=(sh*k)+'px'; img.style.left=(-(cx-cw/2)*k)+'px'; img.style.top=(-(cy-ch/2)*k)+'px';
}
window.ready=Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))).then(()=>document.fonts.ready);
window.renderAt=function(t){
  const cuts=[...BEATS.map(b=>b.start).slice(1),END_START];
  let cur=-1; for(let i=0;i<BEATS.length;i++){ if(t>=BEATS[i].start) cur=i; }
  const ended=t>=END_START;
  BEATS.forEach((b,i)=>{ document.getElementById('b'+i).style.display=(!ended&&i===cur)?'block':'none'; });
  if(cur>=0&&!ended) place(cur,t);
  document.getElementById('end').style.display=ended?'block':'none';
  const cap=document.getElementById('cap');
  if(!ended&&cur>=0&&BEATS[cur].caption){
    const dt=t-BEATS[cur].start, show=dt>0.3&&dt<BEATS[cur].hold-0.15;
    cap.style.display=show?'block':'none'; cap.textContent=BEATS[cur].caption;
    cap.style.transform='translateX('+(-(1-snap((dt-0.3)/0.18))*700)+'px)';
  } else cap.style.display='none';
  if(ended){
    const dt=t-END_START, logo=document.getElementById('logo'), tag=document.getElementById('endtag');
    logo.style.transform='translateY('+((1-snap(dt/0.3))*36)+'px)'; logo.style.opacity=Math.min(1,dt/0.12);
    tag.style.opacity=dt>0.5?1:0; tag.style.transform='translateX('+(-(1-snap((dt-0.5)/0.2))*400)+'px)';
  }
  // The board wipe: a slanted asphalt panel with an amber lane edge crosses the frame on every cut and the end card.
  const wipe=document.getElementById('wipe'), lane=document.getElementById('wipelane');
  const cutTimes=[...BEATS.map(b=>b.start).slice(1),END_START]; let p=-1;
  for(const c of cutTimes){ const q=(t-(c-WIPE/2))/WIPE; if(q>=0&&q<=1){p=q;} }
  if(p<0){wipe.style.display='none';lane.style.display='none';}
  else{
    const pw=W*1.1+SKEW, left=-pw+(W+pw)*ease(p);
    wipe.style.display='block'; lane.style.display='block';
    wipe.style.left=left+'px'; wipe.style.width=pw+'px'; wipe.style.clipPath='polygon(0 0,'+pw+'px 0,'+(pw-SKEW)+'px 100%,0 100%)';
    lane.style.left=left+'px'; lane.style.width=(pw+22)+'px'; lane.style.clipPath='polygon('+pw+'px 0,'+(pw+22)+'px 0,'+(pw-SKEW+22)+'px 100%,'+(pw-SKEW)+'px 100%)';
  }
};
</script></body></html>`;
  // Encoder check first: no point rendering frames that cannot be encoded.
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const h264 = enc.status === 0 && /libx264/.test(enc.stdout);
  if (!h264) {
    console.error(`no libx264 in ${ffmpeg}: cannot write the H.264 animatic here. See docs/studio/store/TRAILER_CAPTURE.md for the command to run on a machine that has it.`);
  }
  mkdirSync(OUT, { recursive: true });
  const work = join(tmpdir(), `teaser-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const htmlPath = join(work, 'teaser.html');
  writeFileSync(htmlPath, html);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(url(htmlPath));
  await page.evaluate(() => window.ready);
  console.log(`animatic: ${BEATS.length} beats + end card, ${total.toFixed(1)} s, ${frames} frames at ${fps} fps`);
  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((tt) => window.renderAt(tt), i / fps);
    await page.screenshot({ path: join(work, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if (i % 90 === 0) console.log(`  frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  await browser.close();
  if (h264) {
    const outFile = join(OUT, 'capsule-teaser-animatic.mp4');
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(work, 'f%05d.jpg'), '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile]);
    console.log(`wrote ${relative(ROOT, outFile)} (${(statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)`);
    writeFileSync(
      join(OUT, 'teaser-timings.json'),
      JSON.stringify({ fps, seconds: Number(total.toFixed(2)), frames, beats: BEATS.map((b) => ({ shot: b.n, start: Number(b.start.toFixed(2)), hold: b.hold, keyframe: relative(ROOT, b.file), caption: b.shot.caption ?? null })), endCard: { start: Number(endStart.toFixed(2)), seconds: END }, label: 'ANIMATIC from stills, software-GL frames; not gameplay footage and not a Steam trailer' }, null, 2) + '\n',
    );
  }
  rmSync(work, { recursive: true, force: true });
  process.exit(h264 ? 0 : 5);
}

// ---- default: capture the keyframes this tool owns --------------------------------------------------------------------
if (!v.url) {
  console.error('usage: trailer-capture.mjs --list | --url http://127.0.0.1:4291 [--only t02,t04] [--preview] | --teaser | --captions | --recipe-script');
  process.exit(2);
}
const table = SHOTS.filter((s) => s.capture).map((s) => ({ ...s.capture, size: [1920, 1080] }));
const only = v.only ? v.only.split(',').map((x) => (/^t\d+$/.test(x) ? SHOTS.find((s) => `t${String(s.n).padStart(2, '0')}` === x)?.capture?.id : x)).filter(Boolean) : null;
const result = await runShots({ shots: table, out: KEYS, url: v.url, only, force: v.force, preview: v.preview, budgetMinutes: Number(v['budget-minutes']), tool: 'scripts/studio/tools/trailer-capture.mjs' });
process.exit(result.failed ? 3 : 0);
