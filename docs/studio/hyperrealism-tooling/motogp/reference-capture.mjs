// Usage: node capture.mjs <worktree> <outPrefix> [views...]
import { createRequire } from 'node:module';
const req = createRequire('/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68/package.json');
const { chromium } = createRequire('/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const { build } = await import(req.resolve('vite'));
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const [root, out, ...views] = process.argv.slice(2);
process.chdir(root);
const { fixtureDefine } = await import(resolve(root, 'e2e/fixtures/owner-build.ts'));
const bundle = await build({
  configFile: false, define: fixtureDefine(), logLevel: 'error',
  build: { write: false, lib: { entry: resolve(root, 'e2e/fixtures/motogp-reference-review.ts'), name: 'MotoGPReview', formats: ['iife'] } },
});
const output = Array.isArray(bundle) ? bundle[0] : bundle;
const chunk = output.output.find((e) => e.type === 'chunk');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 400)); });
await page.setContent('<!doctype html><title>cap</title>');
await page.addScriptTag({ content: chunk.code });
for (const view of views.length ? views : ['rear']) {
  const t0 = Date.now();
  const r = await page.evaluate((v) => window.MotoGPReview.captureBike(v, 'high', 'gpr1', false), view);
  writeFileSync(`${out}-${view}.png`, Buffer.from(r.image.split(',')[1], 'base64'));
  console.log(view, 'ms', Date.now() - t0);
}
await browser.close();
