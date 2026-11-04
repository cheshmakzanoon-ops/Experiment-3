// Offline audio measurement rig. Renders the production audio graph (RacingAudio,
// UiSounds, CueSynth) into an OfflineAudioContext inside headless Chromium, writes
// 32-bit float stereo WAV files and runs the numpy analysis (audio-analyze.py).
//
//   node --no-warnings scripts/studio/tools/audio-render.mjs --out <dir>
//        [--only substr,substr] [--group engine|tyre|surface|wind|weather|impact|airborne|mix|ui]
//        [--volume 0.45] [--stems] [--no-analyse] [--live] [--label name]
//
// --stems   also renders the mix scenes once per bus (needs the mixer of the build under test)
// --live    adds a live-AudioContext smoke test (autoplay policy, unlock, review tap)
// Output: <dir>/wav/*.wav, <dir>/meta.json, <dir>/analysis.json (+ <dir>/shots/*.png)
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const out = resolve(value('out', join(process.env.TMPDIR ?? '/tmp', 'moto-audio-rig')));
const only = value('only', '').split(',').filter(Boolean);
const group = value('group', '');
const volume = Number(value('volume', '0.45'));
mkdirSync(join(out, 'wav'), { recursive: true });

function wav(left, right, sampleRate) {
  const frames = left.length,
    data = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    data[2 * i] = left[i];
    data[2 * i + 1] = right[i];
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.byteLength, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.byteLength, 40);
  return Buffer.concat([header, Buffer.from(data.buffer)]);
}
const decode = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

/** Autoplay policy on the production RacingAudio in a LIVE AudioContext, default browser
 * policy (no --autoplay-policy flag): start() must return without a gesture and report locked;
 * a real click must unlock it; the review tap must then carry signal. */
async function liveSmoke(code) {
  const live = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--headless=new', '--autoplay-policy=document-user-activation-required'],
  });
  const page = await live.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  // page.evaluate() and setContent() run with a user gesture, which would unlock the context
  // by itself: serve a real page over HTTP and let its own script start the audio, as the
  // game's session start does for a player who reached it with a gamepad.
  const html = `<!doctype html><script>${code.replace(/<\/script/gi, '<\\/script')}\nwindow.MotoAudioRig = MotoAudioRigBundle.MotoAudioRig;\nwindow.__before = null;\nwindow.MotoAudioRig.probeResume().then((r) => (window.__probe = r)); window.MotoAudioRig.liveStart().then((r) => (window.__before = r));</script>`;
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = { errors };
  await page.waitForFunction(() => window.__before && window.__probe, null, { timeout: 30000 });
  result.probe = await page.evaluate(() => window.__probe);
  result.beforeGesture = await page.evaluate(() => window.__before);
  result.afterWaitNoGesture = await page.evaluate(() => window.MotoAudioRig.liveState());
  await page.mouse.click(20, 20); // a trusted pointer event
  await page.waitForTimeout(300);
  result.afterClick = await page.evaluate(() => window.MotoAudioRig.liveState());
  result.tap = await page.evaluate(() => window.MotoAudioRig.liveTap());
  await live.close();
  server.close();
  console.log('live context:', JSON.stringify(result));
  return result;
}

console.log('bundling the audio fixture...');
const result = await build({
  configFile: false,
  root: resolve(here, '../../..'),
  define: { __SUPPLIED_PLAYER__: 'false' },
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    lib: { entry: join(here, 'audio-fixture.ts'), name: 'MotoAudioRigBundle', formats: ['iife'] },
  },
});
const bundle = Array.isArray(result) ? result[0] : result;
const chunk = bundle.output.find((entry) => entry.type === 'chunk');
if (!chunk) throw new Error('The audio fixture did not bundle');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--headless=new',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto('about:blank');
await page.addScriptTag({
  content: `${chunk.code}\nwindow.MotoAudioRig = MotoAudioRigBundle.MotoAudioRig;`,
});

const list = await page.evaluate(() => window.MotoAudioRig.list());
const cues = await page.evaluate(() => window.MotoAudioRig.uiCues());
const wanted = list.filter(
  (s) => (!group || s.group === group) && (!only.length || only.some((o) => s.id.includes(o))),
);
const runUi =
  (!group || group === 'ui') && (!only.length || only.some((o) => 'ui'.includes(o) || o === 'ui'));
console.log(
  `rendering ${wanted.length} scenarios${runUi ? ` + ${cues.length + 1} UI sounds` : ''}...`,
);

const written = [];
const save = (r) => {
  const file = `${r.meta.id}.wav`;
  writeFileSync(join(out, 'wav', file), wav(decode(r.left), decode(r.right), r.meta.sampleRate));
  written.push({ ...r.meta, file });
};
const t0 = Date.now();
let n = 0;
const buses = value('buses', '');
const options = { volume };
if (buses)
  options.buses = Object.fromEntries(
    buses
      .split(',')
      .map((kv) => kv.split(':'))
      .map(([k, v]) => [k, Number(v)]),
  );
if (flag('bypass')) options.bypassDynamics = true;
for (const s of wanted) {
  const r = await page.evaluate(([id, o]) => window.MotoAudioRig.render(id, o), [s.id, options]);
  save(r);
  if (++n % 20 === 0)
    console.log(`  ${n}/${wanted.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
if (flag('stems')) {
  // Each mix scene once per bus, others silent, dynamics bypassed: a pre-limiter stem.
  const mixes = list.filter((s) => s.group === 'mix' && !s.id.includes('grid'));
  for (const s of mixes)
    for (const stem of ['engine', 'effects', 'ambience']) {
      const levels = { engine: 0, effects: 0, ambience: 0 };
      levels[stem] = 1;
      const r = await page.evaluate(
        ([id, o]) => window.MotoAudioRig.render(id, o),
        [s.id, { volume, buses: levels, bypassDynamics: true }],
      );
      r.meta.id = `${r.meta.id}__stem-${stem}`;
      r.meta.group = 'stem';
      r.meta.tags = { ...r.meta.tags, stem };
      save(r);
    }
}
if (runUi) {
  for (const cue of cues)
    save(await page.evaluate(([c, v]) => window.MotoAudioRig.renderUi(c, v), [cue, volume]));
  save(await page.evaluate(() => window.MotoAudioRig.renderDrivingCues()));
}

const meta = {
  label: value('label', 'run'),
  volume,
  scenarios: written,
  errors,
  seconds: (Date.now() - t0) / 1000,
};
await browser.close();
if (flag('live')) meta.live = await liveSmoke(chunk.code);
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(
  `rendered ${written.length} files in ${meta.seconds.toFixed(0)} s; page errors: ${errors.length}`,
);
for (const e of errors.slice(0, 10)) console.log('  ', e);

if (!flag('no-analyse')) {
  const py = join(here, 'audio-analyze.py');
  if (!existsSync(py)) throw new Error(`Missing ${py}`);
  const run = spawnSync(
    'python3',
    ['-I', py, '--in', out, '--out', join(out, 'analysis.json'), '--shots', join(out, 'shots')],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) process.exit(run.status ?? 1);
}
