// Drive the car lab (lab.ts) with Playwright and save one JPEG per view.
//
//   node scripts/studio/tools/car-lab/shots.mjs --url http://127.0.0.1:4298 --out <dir> \
//        --id apx01 --views front34,rear34,cockpit [--prefix after] [--pose '{"steer":0.4,"brake":1}']
//        [--w 1280 --h 720] [--max-kb 200] [--env 0.9] [--exposure 1]
//        [--eval 'lab.formula().paint.iridescence = 0.3']   JS run in the page after the machine is built
//
// One page per machine id (the lab builds the machine from ?id=). Several ids: --id apx01,gpr1.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const url = arg('url', 'http://127.0.0.1:4298');
const out = arg('out', '.');
const prefix = arg('prefix', '');
const ids = arg('id', 'apx01').split(',');
const views = arg('views', 'front34').split(',');
const pose = JSON.parse(arg('pose', '{}'));
const width = Number(arg('w', 1280)),
  height = Number(arg('h', 720));
const maxKb = Number(arg('max-kb', 200));
const evalCode = arg('eval', '');
const env = arg('env', '0.6'),
  exposure = arg('exposure', '1');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--headless=new',
  ],
});
const errors = [];
const stats = {};
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(`${id} page: ${e.message}`.slice(0, 300)));
  page.on(
    'console',
    (m) => m.type() === 'error' && errors.push(`${id} console: ${m.text()}`.slice(0, 300)),
  );
  const t0 = Date.now();
  await page.goto(
    `${url}/scripts/studio/tools/car-lab/index.html?id=${id}&w=${width}&h=${height}&env=${env}&exposure=${exposure}`,
  );
  await page.waitForFunction(() => document.title.startsWith('lab:'), null, { timeout: 240000 });
  const title = await page.title();
  if (title.startsWith('lab:error')) throw new Error(title);
  console.log(`${id} ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (evalCode) await page.evaluate((code) => new Function('lab', code)(window.lab), evalCode);
  for (const view of views) {
    const [name, extra] = view.split('@');
    const merged = { ...pose, ...(extra ? JSON.parse(decodeURIComponent(extra)) : {}) };
    const info = await page.evaluate(([v, p]) => window.lab.render(v, p), [name, merged]);
    const file = join(out, `${prefix ? `${prefix}-` : ''}${id}-${name}.jpg`);
    for (let q = 86; q >= 40; q -= 8) {
      await page.locator('canvas').screenshot({ path: file, type: 'jpeg', quality: q });
      if (statSync(file).size <= maxKb * 1024) break;
    }
    stats[`${id}/${name}`] = { ...info, kb: Math.round(statSync(file).size / 1024) };
    console.log(
      `${id} ${name} ${stats[`${id}/${name}`].kb} KB, ${info.triangles} tris, ${info.calls} calls`,
    );
  }
  await page.close();
}
await browser.close();
writeFileSync(
  join(out, `${prefix ? `${prefix}-` : ''}lab-manifest.json`),
  JSON.stringify({ stats, errors }, null, 2),
);
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
