// node test-results/f1-capture/run.mjs <label> <preset> [shots] [circuit] [warmSeconds] [lighting]
// shots: comma list of mode[:frames[:follow]] e.g. chase:90,trackside:120:0
import { chromium } from '/home/user/Experiment-3/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const [label = 'shot', preset = 'high', shotList = 'chase:60,trackside:90', circuit = '', warm = '40', lighting = '', opponents = '7'] =
  process.argv.slice(2);
const out = '/tmp/claude-0/-home-user-Experiment-3/77bc90d5-fa90-573c-91d6-9e500a2bf2c9/scratchpad/f1';
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', '--gpu-watchdog-timeout-seconds=600'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  const text = m.text();
  if (text.startsWith('F1CAP')) log(text);
  else if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${text.slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('crash', () => {
  console.log('PAGE CRASHED (likely OOM)');
  process.exit(3);
});
try {
  await page.goto('http://127.0.0.1:5181/test-results/f1-capture/index.html', { timeout: 600000 });
  await page.waitForFunction(() => window.F1CaptureReady === true, null, { timeout: 900000, polling: 1000 });
  log('module ready');
  const boot = await page.evaluate(
    (o) => window.F1Capture.boot(o),
    { preset, width: 960, height: 540, warmSeconds: Number(warm), circuit: circuit || undefined, lighting: lighting || undefined, opponents: Number(opponents) },
  );
  log('booted', JSON.stringify(boot));
  for (const spec of shotList.split(',')) {
    const [mode, frames = '4', follow = '0', settle = '6'] = spec.split(':');
    const r = await page.evaluate(
      ([m, f, w, s]) => window.F1Capture.shoot(m, Number(f), Number(w), Number(s)),
      [mode, frames, follow, settle],
    );
    const file = `${out}/${label}-${preset}-${mode}${follow !== '0' ? '-car' + follow : ''}.png`;
    writeFileSync(file, Buffer.from(r.image.split(',')[1], 'base64'));
    log('wrote', file, `${r.ms} ms`);
  }
} catch (e) {
  errors.push('runner: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  const unique = [...new Set(errors)];
  log('console errors/warnings:', unique.length);
  for (const e of unique.slice(0, 40)) console.log('  ', e);
  await browser.close();
}
