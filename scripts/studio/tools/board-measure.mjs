// Measure the Paddock Board's left panel at a viewport: which children take the height.
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/studio/tools/board-measure.mjs [width height]
// Builds e2e/fixtures/launch-board.ts like e2e/60-launch-board.spec.ts and prints the panel's
// clientHeight / scrollHeight plus every direct child of the form with its rendered height.
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [w, h] = [Number(process.argv[2] ?? 1280), Number(process.argv[3] ?? 720)];
const built = await build({
  configFile: false,
  define: { __SUPPLIED_PLAYER__: 'false' },
  logLevel: 'error',
  build: {
    write: false,
    lib: { entry: resolve('e2e/fixtures/launch-board.ts'), name: 'LaunchBoard', formats: ['iife'] },
  },
});
const output = Array.isArray(built) ? built[0] : built;
const script = output.output.find((item) => item.type === 'chunk');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.setContent('<!doctype html><title>board</title>');
await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
for (const asset of output.output)
  if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
    await page.addStyleTag({ content: String(asset.source) });
await page.addScriptTag({ content: script.code });
await page.evaluate(() => window.LaunchBoard.mountLaunchBoard());
await page.evaluate(() => document.fonts.ready);
const report = await page.evaluate(() => {
  const body = document.querySelector('.menu-body');
  const form = document.querySelector('#sessionForm');
  const rows = [...(form?.children ?? [])].map((el) => ({
    el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`,
    h: Math.round(el.getBoundingClientRect().height * 10) / 10,
    display: getComputedStyle(el).display,
  }));
  const board = body?.querySelector('.lb-board');
  const above = [...(board?.children ?? [])].map((el) => ({
    el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`,
    h: Math.round(el.getBoundingClientRect().height * 10) / 10,
  }));
  return {
    client: body?.clientHeight,
    scroll: body?.scrollHeight,
    gap: getComputedStyle(form).rowGap,
    above,
    rows,
    blurb: document.querySelector('#machineBlurb')?.textContent,
  };
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
