/** Real browser DOM / Canvas2D / OfflineAudioContext checks. This intentionally
 * does not call a UI fixture a rendered WebGL game or mark GPU acceptance done. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
const root = process.cwd();
const out = resolve(process.env.REFERENCE_EVIDENCE_DIR || 'test-results/reference-components');
await mkdir(out, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'apex-reference-ui-'));
const source = (path) => JSON.stringify(resolve(root, path).replaceAll('\\', '/'));
const entry = join(scratch, 'entry.js');
await writeFile(
  entry,
  `
import * as T from ${source('node_modules/three/build/three.module.js')};
import {PhotoStudio} from ${source('src/ui/photo-studio.ts')};
import {DEFAULT_LIVERY, validateLivery} from ${source('src/storage/livery.ts')};
import {flankLivery, repaintFlank} from ${source('src/rendering/car-livery.ts')};
import {TextureBudget} from ${source('src/rendering/texture-budget.ts')};
import {CueSynth} from ${source('src/audio/driving-cues.ts')};
import {referenceReview, bindReferenceReview} from ${source('src/ui/reference-review.ts')};
import {REFERENCES} from ${source('src/ui/reference-catalogue.ts')};
import {audioAccessibility, readDrivingAudio} from ${source('src/ui/audio-accessibility.ts')};
import {DEFAULT_DRIVING_AUDIO} from ${source('src/audio/driving-cues.ts')};
const fixture = { lastSettings: null, previewLivery: null, savedLivery: null, references: REFERENCES };
fixture.photo = new PhotoStudio(document.querySelector('#app'), {
 change: p => fixture.lastSettings = structuredClone(p),
 preview: p => fixture.previewLivery = structuredClone(p),
 save: async p => { fixture.savedLivery = structuredClone(p); },
 capture: () => {}, close: () => fixture.photo.close(),
});
fixture.open = () => fixture.photo.open(validateLivery(fixture.savedLivery || DEFAULT_LIVERY), 3);
fixture.review = () => { fixture.photo.close(); document.querySelector('#testPanel').innerHTML = referenceReview(); bindReferenceReview(document.querySelector('#testPanel')); };
fixture.audio = () => { document.querySelector('#proof').hidden = true; document.querySelector('#testPanel').innerHTML = '<form id="audioForm">' + audioAccessibility(DEFAULT_DRIVING_AUDIO) + '</form>'; };
fixture.readAudio = () => readDrivingAudio(document.querySelector('#audioForm'));
fixture.pixels = (livery) => {
 const budget = new TextureBudget(), group = new T.Group();
 const sides = [1,-1].map(side => flankLivery(new T.MeshPhysicalMaterial({color:0xc97235}), side, 0));
 for (const material of sides) group.add(new T.Mesh(new T.PlaneGeometry(), material));
 budget.register(group); budget.configure(128, 1);
 const hashes = () => sides.map(material => {
   const c = material.map.image, bytes = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let hash=2166136261; for(const byte of bytes) hash=Math.imul(hash^byte,16777619);
   return {hash:hash>>>0,width:c.width,height:c.height};
 });
 const before=hashes();
 for (const material of sides) { repaintFlank(material,0,validateLivery(livery)); budget.refresh(material.map); }
 const after=hashes();
 budget.configure(512, 1); const resized=hashes();
 const source=sides[0].map.image; const preview=document.querySelector('#uvProof');
 preview.width=source.width;preview.height=source.height;preview.getContext('2d').drawImage(source,0,0);
 budget.dispose();
 for(const object of group.children) { object.geometry.dispose();object.material.dispose(); }
 return {before,after,resized};
};
fixture.offlineAudio = async () => {
 const rate=24000, ctx=new OfflineAudioContext(2,rate,rate), synth=new CueSynth(ctx,ctx.destination);
 synth.play({kind:'turn',frequency:660,pan:-0.85,duration:0.15},0,0.7);
 synth.play({kind:'brake',frequency:800,pan:0,duration:0.15},0.25,0.7);
 synth.play({kind:'turn',frequency:660,pan:0.85,duration:0.15},0.5,0.7);
 const buffer=await ctx.startRendering();
 const channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
 const energy=(start,end)=>channels.map(channel=>channel.slice(start*rate,end*rate).reduce((total,value)=>total+value*value,0));
 return {finite:channels.every(c=>c.every(Number.isFinite)),left:energy(0,0.18),centre:energy(.25,.43),right:energy(.5,.68),silence:energy(.8,1),peak:Math.max(...channels.map(c=>Math.max(...c.map(Math.abs))))};
};
window.referenceFixture=fixture; fixture.open();
`,
);
let browser;
try {
  const built = await build({
    root,
    configFile: false,
    logLevel: 'error',
    publicDir: false,
    build: {
      write: false,
      minify: false,
      lib: { entry, name: 'ReferenceComponentFixture', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  const code = result.output.find((item) => item.type === 'chunk').code;
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const css = await readFile(resolve(root, 'src/ui/style.css'), 'utf8');
  await page.setContent(
    `<style>${css}\n#testPanel {padding:32px;max-width:1100px;margin:auto} #proof {pointer-events:none;position:fixed;left:40px;top:240px;width:370px;z-index:5} #proof canvas{width:300px;height:300px;display:block} #fixtureLabel{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#142e36;padding:8px;font:12px sans-serif;color:white}</style><div id="app"></div><div id="testPanel"></div><div id="proof"><p>Actual car UV texture / Canvas2D evidence<br>Not a rendered gameplay screenshot</p><canvas id="uvProof"></canvas></div><div id="fixtureLabel">SOURCE COMPONENT TEST · Game canvas intentionally omitted · GPU scene acceptance is separate</div>`,
  );
  await page.addScriptTag({ content: code });
  const input = async (selector, value) =>
    page.locator(selector).evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await page.locator('[data-decal="enabled"]').check();
  await page.locator('[data-decal="text"]').fill('NORTH');
  await input('#decal-x', '0.45');
  await page.locator('[data-decal="slot"]').selectOption('6');
  await page.locator('[data-decal="enabled"]').check();
  await page.locator('[data-decal="text"]').fill('MERIDIAN');
  await input('#decal-rotation', '20');
  await page.locator('#saveLivery').click();
  const saved = await page.evaluate(() => window.referenceFixture.savedLivery);
  assert.deepEqual(
    saved.decals.map((r) => [r.id, r.side, r.text]),
    [
      [1, 'left', 'NORTH'],
      [6, 'right', 'MERIDIAN'],
    ],
  );
  assert.equal(saved.decals[0].x, 0.45);
  assert.equal(saved.decals[1].rotation, 20);
  await page.locator('#photoTarget').selectOption('2');
  assert.equal(
    await page.evaluate(() => window.referenceFixture.lastSettings.target),
    2,
    'numeric car selection must not become a string',
  );
  await page.locator('#photoTarget').selectOption('0');
  await page.locator('#photo-depthOfField').check();
  await page.locator('#photo-focusMode').selectOption('manual');
  await input('#photo-focusDistance', '17');
  await page.locator('#photo-survey').selectOption('split');
  let lens = await page.evaluate(() => window.referenceFixture.lastSettings);
  assert.equal(lens.depthOfField, true);
  assert.equal(lens.focusMode, 'manual');
  assert.equal(lens.focusDistance, 17);
  assert.equal(lens.survey, 'split');
  await page.locator('#photoBackdrop').selectOption('studio');
  lens = await page.evaluate(() => window.referenceFixture.lastSettings);
  assert.equal(lens.survey, 'off');
  await page.locator('#photoBackdrop').selectOption('headquarters');
  await page.locator('#photo-survey').selectOption('split');
  const headquarters = await page.evaluate(() => window.referenceFixture.lastSettings);
  assert.equal(headquarters.backdrop, 'headquarters');
  assert.equal(headquarters.survey, 'off', 'workshop must not impersonate circuit survey');
  assert.equal(await page.locator('#photo-survey').inputValue(), 'off');
  await page.locator('#photoBackdrop').selectOption('studio');
  const pixels = await page.evaluate((saved) => window.referenceFixture.pixels(saved), saved);
  assert.equal(pixels.after[0].width, 128);
  assert.equal(pixels.resized[0].width, 512);
  assert.notEqual(pixels.before[0].hash, pixels.after[0].hash);
  assert.notEqual(pixels.before[1].hash, pixels.after[1].hash);
  const leftOnly = await page.evaluate(
    (saved) =>
      window.referenceFixture.pixels({
        ...saved,
        decals: saved.decals.filter((r) => r.side === 'left'),
      }),
    saved,
  );
  assert.equal(
    leftOnly.before[1].hash,
    leftOnly.after[1].hash,
    'left decal must not bleed to right flank',
  );
  await page.locator('.photo-drawer').evaluate((node) => (node.scrollTop = node.scrollHeight));
  await page.screenshot({ path: join(out, 'decal-component.png') });
  await page.evaluate(() => window.referenceFixture.review());
  assert.equal(await page.locator('[data-reference]').count(), 100);
  assert.equal(await page.locator('.reference-inspect').count(), 84);
  await page.locator('#referenceFilter').selectOption('excluded');
  assert.equal(await page.locator('[data-reference]:visible').count(), 16);
  await page.locator('#referenceFilter').selectOption('all');
  await page.locator('#referenceSearch').fill('001');
  assert.ok((await page.locator('[data-reference]:visible').count()) >= 1);
  await page.evaluate(() => window.referenceFixture.audio());
  await page.locator('[name="cue_enabled"]').check();
  await page.locator('[name="cue_invertStereo"]').check();
  await input('[name="cue_lookahead"]', '65');
  const audioOptions = await page.evaluate(() => window.referenceFixture.readAudio());
  assert.equal(audioOptions.lookahead, 65);
  assert.equal(audioOptions.enabled, true);
  assert.equal(audioOptions.invertStereo, true);
  await page.screenshot({ path: join(out, 'audio-component.png') });
  const audio = await page.evaluate(() => window.referenceFixture.offlineAudio());
  assert.ok(audio.finite);
  assert.ok(audio.peak > 0.01 && audio.peak < 0.2);
  assert.ok(audio.left[0] > audio.left[1] * 10);
  assert.ok(audio.right[1] > audio.right[0] * 10);
  assert.ok(Math.abs(audio.centre[0] - audio.centre[1]) < 1e-6);
  assert.deepEqual(audio.silence, [0, 0]);
  const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  assert.deepEqual(errors, []);
  const evidence = {
    result: 'pass',
    scope:
      'source DOM, Canvas2D livery maps, geometry-independent controls and real OfflineAudioContext PCM; NOT WebGL scene validation',
    webgl2,
    saved,
    lens,
    headquarters,
    pixels,
    leftOnly,
    audioOptions,
    audio,
    errors,
  };
  await writeFile(join(out, 'component-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await rm(scratch, { recursive: true, force: true });
}
