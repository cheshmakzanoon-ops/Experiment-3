import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type { captureGpOpticsAndCloth } from './fixtures/gp-visor-and-flags.ts';

test('GP visor reveals the recessed rider and held flags follow reversible crosswinds', async ({page}, info) => {
  const bundle = await build({configFile: false, define: fixtureDefine(), logLevel: 'error',
    build: {write: false, lib: {entry: resolve('e2e/fixtures/gp-visor-and-flags.ts'), name: 'GpCloseup', formats: ['iife']}}});
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP close-up review');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP close-up script');
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent('<title>Grand Prix rider and supporter review</title>');
  await page.addScriptTag({content: chunk.code});
  const {captures, ...metrics} = await page.evaluate(() =>
    (window as unknown as {GpCloseup: {captureGpOpticsAndCloth: typeof captureGpOpticsAndCloth}}).GpCloseup.captureGpOpticsAndCloth());
  for (const frame of captures)
    await info.attach(frame.name + '.png', {body: Buffer.from(frame.image.split(',')[1], 'base64'), contentType: 'image/png'});
  await info.attach('optics-and-cloth.json', {body: JSON.stringify({...metrics, frames: captures.map(({name, draws, triangles}) => ({name, draws, triangles})), errors}), contentType: 'application/json'});
  expect(errors).toEqual([]);
  expect(metrics.glError).toBe(0);
  expect(metrics.gazePixels).toBeGreaterThan(8);
  expect(metrics.lidPixels).toBeGreaterThan(20);
  expect(metrics.eyesRestore).toBe(0);
  expect(metrics.facePixels).toBeGreaterThan(120);
  expect(metrics.windPixels).toBeGreaterThan(600);
  expect(metrics.calmPixels).toBeGreaterThan(600);
  expect(metrics.faceRestore).toBe(0);
  expect(metrics.windRestore).toBe(0);
  for (const frame of captures.filter(frame => frame.name.startsWith('supporters-'))) expect(frame.draws).toBe(1);
});
