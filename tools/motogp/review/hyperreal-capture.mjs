// MotoGP hyperrealism review capture: live GP race frames from the production
// Simulation + RacingRenderer at several lap moments and cameras.
//
//   xvfb-run -a -s "-screen 0 1280x800x24" node tools/motogp/review/hyperreal-capture.mjs \
//     <outDir> [--preset high] [--weather clear] [--circuit poggio-alto] \
//     [--moments 24,32,40] [--views chase,cockpit,trackside] [--size 1280x720]
//
// Writes <view>-<moment>s.jpg per capture plus metrics.json. Software GL
// (SwiftShader / llvmpipe) prepares shaders slowly: expect several minutes.
import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve, relative } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const out = resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'hyperreal-capture');
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [width, height] = flag('size', '1280x720').split('x').map(Number);
const options = {
  preset: flag('preset', 'high'),
  weather: flag('weather', 'clear'),
  circuit: flag('circuit', 'poggio-alto'),
  moments: flag('moments', '24,32,40').split(',').map(Number),
  views: flag('views', 'chase,cockpit,trackside').split(','),
  opponents: Number(flag('opponents', '5')),
  width,
  height,
};
mkdirSync(out, { recursive: true });
const bundle = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: { entry: resolve('e2e/fixtures/motogp-hyperreal-capture.ts'), name: 'GPHyperreal', formats: ['iife'] },
  },
});
const chunk = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((o) => o.type === 'chunk');
const assets = {};
const mime = (p) =>
  /\.(jpg|jpeg)$/.test(p) ? 'image/jpeg' : p.endsWith('.webp') ? 'image/webp' : p.endsWith('.png') ? 'image/png'
    : p.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
function walk(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = resolve(root, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(webp|png|jpg|jpeg|avif|ktx2|wasm|js|hdr|exr)$/.test(p))
      assets[relative(resolve('public'), p)] = `data:${mime(p)};base64,${readFileSync(p).toString('base64')}`;
  }
}
for (const dir of ['basis', 'third-party/texture', 'third-party/ground', 'third-party/hdri']) walk(resolve('public/assets', dir));
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--gpu-watchdog-timeout-seconds=600'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (/^(prepared|captured) /.test(m.text())) console.log(m.text());
  });
  await page.exposeFunction('saveCapture', (name, url) =>
    writeFileSync(resolve(out, name), Buffer.from(url.split(',')[1], 'base64')),
  );
  await page.setContent('<!doctype html><title>MotoGP hyperrealism capture</title>');
  await page.addScriptTag({ content: chunk.code });
  await page.evaluate((a) => window.GPHyperreal.installOfflineAssets(a), assets);
  const started = Date.now();
  const result = await page.evaluate((o) => window.GPHyperreal.captureGPMoments(o), options);
  for (const c of result.captures) {
    writeFileSync(resolve(out, `${c.view}-${c.moment}s.jpg`), Buffer.from(c.image.split(',')[1], 'base64'));
    delete c.image;
  }
  writeFileSync(
    resolve(out, 'metrics.json'),
    JSON.stringify({ ...result, options, errors, seconds: (Date.now() - started) / 1000 }, null, 2),
  );
  console.log(JSON.stringify(result.captures.map((c) => `${c.view}@${c.moment}s ${c.speedKph.toFixed(0)}kph lean ${c.leanDeg.toFixed(0)}°`)));
  if (errors.length || result.glError !== 0 || !result.finite) throw new Error(JSON.stringify({ errors, glError: result.glError }));
} finally {
  await browser.close();
}
