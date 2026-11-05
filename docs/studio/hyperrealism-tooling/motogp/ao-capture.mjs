// Usage: node ao-capture.mjs <outPrefix> <lean> <views...>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const WT = '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68';
const req = createRequire(`${WT}/package.json`);
const { chromium } = createRequire('/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const { build } = await import(req.resolve('vite'));
const [out, lean, debug, ...views] = process.argv.slice(2);
process.chdir(WT);
const { fixtureDefine } = await import(`${WT}/e2e/fixtures/owner-build.ts`);
const N = '/home/user/Experiment-3/node_modules/three';
const bundle = await build({
  configFile: false,
  root: WT,
  define: fixtureDefine(),
  logLevel: 'error',
  resolve: {
    alias: [
      { find: /^three$/, replacement: `${N}/build/three.module.js` },
      { find: /^three\/addons\/(.*)$/, replacement: `${N}/examples/jsm/$1` },
    ],
  },
  build: {
    write: false,
    lib: {
      entry: '/tmp/claude-0/-home-user-Experiment-3/77bc90d5-fa90-573c-91d6-9e500a2bf2c9/scratchpad/motogp/ao-fixture.ts',
      name: 'AoFixture',
      formats: ['iife'],
    },
  },
});
const output = Array.isArray(bundle) ? bundle[0] : bundle;
const chunk = output.output.find((e) => e.type === 'chunk');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console', m.text().slice(0, 600));
});
await page.setContent('<!doctype html><title>ao</title>');
await page.addScriptTag({ content: chunk.code });
const t0 = Date.now();
const r = await page.evaluate(
  ([views, lean, debug]) => window.AoFixture.capture(views, lean, debug),
  [views, Number(lean), Number(debug)],
);
for (const o of r.out)
  writeFileSync(`${out}-${o.view}-${o.on ? 'ao' : 'base'}.png`, Buffer.from(o.image.split(',')[1], 'base64'));
console.log(JSON.stringify({ ...r, out: undefined, ms: Date.now() - t0 }));
await browser.close();
