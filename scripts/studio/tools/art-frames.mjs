#!/usr/bin/env node
/**
 * KEY-ART FRAME DIRECTOR (marketing). Captures the game frames that `capsule-art.mjs` composes into the Steam
 * capsules and library art. Boots the REAL game (headless Chromium, software GL, so a frame takes 5-15 minutes)
 * and frames each hero moment with the game's own photo studio. Output: docs/studio/store/art/frames/*.jpg plus
 * manifest.json (entry, camera, build, note) and progress.log. Resumable: a captured frame is skipped.
 *
 *   npx vite build --outDir /tmp/dist-art && npx vite preview --outDir /tmp/dist-art --host 127.0.0.1 --port 4291 &
 *   node scripts/studio/tools/art-frames.mjs --list
 *   node scripts/studio/tools/art-frames.mjs --url http://127.0.0.1:4291 --preview --only apx01-showroom
 *       (a quick look at the camera at 640x360: written to <out>/_preview/, never recorded)
 *   node scripts/studio/tools/art-frames.mjs --url http://127.0.0.1:4291              (what is missing)
 *   node scripts/studio/tools/art-frames.mjs --url ... --only coast-eh3-wide --force  (a retake)
 *
 * Honest limits: these are SOFTWARE-GL frames. Resolution is real, but a GPU build looks better (bloom,
 * reflections, frame-rate motion blur). Retake the hero frames on a GPU before launch (gate G8); this tool is
 * the same recipe. Frames contain no HUD or menu (the studio's UI is hidden). Nothing is composited here.
 */
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runShots, readManifest } from './lib/game-director.mjs';

/**
 * The frame table. The first line of every entry says what the frame is for. Photo values are the studio's
 * (azimuth degrees around the car, elevation degrees, distance metres, focal length mm on a 24 mm gate).
 */
export const FRAMES = [
  {
    id: 'apx01-showroom',
    title: 'APX-01 in the showroom, no paddock board',
    kind: 'menu-photo',
    use: 'vertical capsule, library capsule, small capsule subject, teaser opener',
    entry: { plate: 'circuit', circuit: 'aurel', vehicle: 'apx01', weather: 'clear', light: 'day' },
    photo: { backdrop: 'studio', view: 'orbit', azimuth: 28, elevation: 7, distance: 7.2, focalLength: 50, filter: 'cinematic', vignette: 0.35 },
    alt: 'The original APX-01 formula car in a dark showroom, low three-quarter front view.',
  },
  {
    id: 'apx01-portrait',
    title: 'APX-01 in the showroom, near-square frame for the portrait capsules',
    kind: 'menu-photo',
    use: 'library capsule (600x900), vertical capsule backdrop',
    size: [1200, 1224],
    entry: { plate: 'circuit', circuit: 'aurel', vehicle: 'apx01', weather: 'clear', light: 'day' },
    photo: { backdrop: 'studio', view: 'orbit', azimuth: 32, elevation: 8, distance: 10.5, focalLength: 40, filter: 'cinematic', vignette: 0.35 },
    alt: 'The original APX-01 formula car in a dark showroom, whole car in a near-square frame.',
  },
  {
    id: 'coast-eh3-wide',
    title: 'EH-3 hypercar on the Solvane coast at golden hour (3840x1240)',
    kind: 'festival-coast',
    use: 'library hero (native size), page background, header capsule, main capsule',
    size: [3840, 1240],
    entry: { vehicle: 'eh3', weather: 'clear', light: 'sunset' },
    event: 'coast-trap',
    orbit: 3,
    traffic: false, // the kept frame was taken with traffic on (a tan car intrudes bottom-left; the capsule tool masks it)
    alt: 'A white electric hypercar on the coast highway of the Solvane region in low golden light.',
  },
  {
    id: 'wildcard-knobblies-banking',
    title: 'Wildcard: motocross bikes on a banked oval',
    kind: 'wildcard',
    use: 'header capsule (the pairing), main capsule, teaser shot 9',
    event: 'knobblies-on-the-banking',
    view: 'chase',
    // The photo studio's orbit camera was tried here and framed the grass (the camera sits under the 31 degree
    // banking), so this frame is the plain chase camera held on the moment.
    pick: { seconds: 24, minSpeed: 25 },
    alt: 'A motocross bike on the banked wall of a speed bowl, with the rest of the field ahead of it.',
  },
  {
    id: 'gp-lean-side',
    title: 'GP bike at full lean, side-on',
    kind: 'session',
    use: 'main capsule band, vertical capsule band, teaser shot 5',
    entry: { plate: 'gp', mode: 'practice', circuit: 'vellamar', vehicle: 'gpr1', weather: 'clear', light: 'day', opponents: '0' },
    view: 'chase',
    pick: { scan: 'lean', attempts: 12, minLean: 0.55 },
    photo: { backdrop: 'circuit', view: 'orbit', azimuth: 90, elevation: 6, distance: 5.2, focalLength: 60, filter: 'cinematic', vignette: 0.3 },
    alt: 'A GP motorcycle leaned over hard through a corner, seen side-on at knee height.',
  },
  {
    id: 'mx-jump-side',
    title: 'Motocross rider in the air, side-on',
    kind: 'session',
    use: 'vertical capsule hero, main capsule band, teaser shot 7',
    entry: { plate: 'dirt', mode: 'practice', circuit: 'valley-ridge-mx', vehicle: 'mx450', weather: 'clear', light: 'day', opponents: '0' },
    view: 'chase',
    pick: { scan: 'air', attempts: 12, maxAir: 1.8 }, // the first run never caught the 0.05-0.7 s window: a poll on software GL is slow, so any early-to-mid flight will do
    photo: { backdrop: 'circuit', view: 'orbit', azimuth: 90, elevation: 8, distance: 7.5, focalLength: 50, filter: 'cinematic', vignette: 0.3 },
    alt: 'A motocross rider and bike in the air off the lip of a jump, seen from the side.',
  },
  {
    id: 'night-gt-neon',
    title: 'GT-10M on the neon city circuit at night',
    kind: 'session',
    use: 'main capsule band, teaser shot 3',
    entry: { plate: 'circuit', mode: 'practice', circuit: 'neon-city', vehicle: 'gt10m', weather: 'clear', light: 'night', opponents: '0' },
    view: 'chase',
    pick: { seconds: 22, minSpeed: 40 },
    photo: { backdrop: 'circuit', view: 'orbit', azimuth: 25, elevation: 5, distance: 6.5, focalLength: 40, filter: 'cinematic', vignette: 0.35 },
    alt: 'A mid-engine GT car on a floodlit city street circuit at night, low three-quarter view.',
  },
];

// Capture order = value to the capsules, so a run cut short still leaves the most useful frames.
const ORDER = ['apx01-showroom', 'wildcard-knobblies-banking', 'coast-eh3-wide', 'mx-jump-side', 'apx01-portrait', 'gp-lean-side', 'night-gt-neon'];
FRAMES.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

const { values: v } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string', default: 'docs/studio/store/art/frames' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    preset: { type: 'string', default: 'high' },
    'budget-minutes': { type: 'string', default: '0' },
  },
});
const out = resolve(v.out);
if (v.list) {
  const m = readManifest(join(out, 'manifest.json'));
  for (const f of FRAMES) {
    const e = m.shots[f.id];
    console.log(`${f.id.padEnd(30)} ${(e?.status ?? 'todo').padEnd(9)} ${(f.size ?? [1920, 1080]).join('x').padEnd(10)} ${e?.note ?? ''}`);
  }
  process.exit(0);
}
if (!v.url) {
  console.error('usage: art-frames.mjs --url http://127.0.0.1:4291 [--only id,id] [--force] [--preview] | --list');
  process.exit(2);
}
const result = await runShots({
  shots: FRAMES,
  out,
  url: v.url,
  only: v.only ? v.only.split(',') : null,
  force: v.force,
  preview: v.preview,
  debug: v.debug,
  preset: v.preset,
  budgetMinutes: Number(v['budget-minutes']),
  tool: 'scripts/studio/tools/art-frames.mjs',
});
process.exit(result.failed ? 3 : 0);
