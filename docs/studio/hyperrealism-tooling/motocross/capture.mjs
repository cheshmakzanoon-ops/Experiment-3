// Throwaway: capture real MX/SX gameplay frames from the production app.
// usage: node capture.mjs <circuit> <quality> <tag> [raceSeconds] [shots=gate,ride]
// Every shot pauses the session, hides the HTML overlay (#app) and waits for
// fresh frames, so the sim cannot run on while the software GPU renders.
import { chromium } from 'playwright';
const [circuit = 'valley-ridge-mx', quality = 'high', tag = 'before', rideArg = '12', shotsArg = 'gate,ride'] = process.argv.slice(2);
const ride = Number(rideArg);
const shots = new Set(shotsArg.split(','));
const OUT = '/tmp/claude-0/-home-user-Experiment-3/77bc90d5-fa90-573c-91d6-9e500a2bf2c9/scratchpad/mx';
const entry = circuit.endsWith('-sx') ? 'STADIUM SX' : 'OUTDOOR MX';
const machine = circuit.endsWith('-sx') ? 'mx250' : 'mx450';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const mesa = process.env.MX_BACKEND === 'mesa';
const browser = await chromium.launch(mesa ? {
  headless: false,
  executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--gpu-watchdog-timeout-seconds=120'],
} : {
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 1500)); });
const diag = () => page.evaluate(() => window.apexDiagnostics());
const poll = async (fn, timeout, what) => {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await fn()) return true; } catch {}
    if (Date.now() > end) { if (what) throw new Error('timeout: ' + what); return false; }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
const frames = async () => (await diag()).presentation?.frames ?? 0;
const hideUi = (hidden) => page.evaluate((h) => {
  let s = document.getElementById('mx-capture-hide');
  if (!s) { s = document.createElement('style'); s.id = 'mx-capture-hide'; document.head.appendChild(s); }
  s.textContent = h ? '#app { visibility: hidden !important; }' : '';
}, hidden);
const shot = async (name, ui = false) => {
  await hideUi(!ui);
  const f = await frames();
  await poll(async () => (await frames()) >= f + 2, 400000, null);
  const path = `${OUT}/${circuit}-${quality}-${tag}-${name}.png`;
  await page.screenshot({ path, timeout: 240000 });
  await hideUi(false);
  log('captured', path);
};
const pause = async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).waitFor({ state: 'visible', timeout: 120000 });
  await poll(async () => (await diag()).workerPause.pending === false, 120000, 'pause');
};
const resume = async () => {
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await poll(async () => (await diag()).workerPause.paused === false, 120000, 'resume');
};
try {
  await page.goto('http://127.0.0.1:5183/?firstrun=0', { timeout: 180000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 300000 });
  log('menu visible');
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('#settingsForm').waitFor({ state: 'visible' });
  await page.locator('[name=quality]').selectOption(quality);
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 300000 });
  await poll(async () => (await diag()).settingsTransition.busy === false, 300000, 'settings');
  log('quality', quality);
  await page.getByRole('radio', { name: /^DIRT/ }).click();
  await page.getByRole('button', { name: entry, exact: true }).click();
  await page.locator('#vehicle').selectOption(machine);
  await poll(async () => (await diag()).menuPreview?.machine === machine, 300000, 'machine');
  if (shots.has('menu')) await shot('menu', true);
  if (shots.has('menuonly')) throw new Error('menu only');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await page.locator('#raceBriefing').waitFor({ state: 'visible', timeout: 1800000 });
  log('briefing');
  await page.getByRole('button', { name: 'GO TO THE GATE', exact: true }).click();
  await poll(async () => (await diag()).state === 'driving', 300000, 'driving');
  log('driving');
  if (shots.has('gate')) { await pause(); await shot('gate'); await resume(); }
  if (shots.has('ride') || shots.has('onboard') || shots.has('tv')) {
    await page.keyboard.press('g');
    await poll(async () => (await diag()).auto === true, 60000, 'auto');
    const start = (await diag()).frame[0];
    await poll(async () => (await diag()).frame[0] > start + ride, 1800000, 'ride time');
    await pause();
    log('paused at sim', ((await diag()).frame[0] - start).toFixed(1), 's after auto');
    if (shots.has('ride')) await shot('ride');
    if (shots.has('onboard') || shots.has('tv')) {
      await resume();
      await page.keyboard.press('c');
      await new Promise((r) => setTimeout(r, 1500));
      await pause();
      await shot(shots.has('tv') ? 'tv' : 'onboard');
    }
  }
} catch (e) {
  log('ERROR', e.message);
}
log('errors:', errors.length ? errors.slice(0, 5).join('\n') : 'none');
await browser.close();
