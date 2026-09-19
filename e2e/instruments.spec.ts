import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyInstrumentCanvas } from './fixtures/instruments.ts';

test('actual cockpit canvas refreshes after hitches, shifts and replay rewinds', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/instruments.ts'),
        name: 'InstrumentOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing instrument fixture');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing instrument fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Instrument canvas oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (
      window as unknown as {
        InstrumentOracle: { verifyInstrumentCanvas: typeof verifyInstrumentCanvas };
      }
    ).InstrumentOracle.verifyInstrumentCanvas(),
  );
  expect(measured.first.changed).toBe(true);
  expect(measured.hitch.changed).toBe(true);
  expect(measured.hitch.text).toContain('158 KM/H');
  expect(measured.gear.changed).toBe(true);
  expect(measured.gear.text[0]).toBe('3');
  expect(measured.paused.changed).toBe(false);
  expect(measured.rewind.changed).toBe(true);
  expect(measured.rewind.text).toContain('72 KM/H');
  expect(measured.brightPixels).toBeGreaterThan(100);
  expect(measured.articulated.phase).toBeCloseTo(6 + 100 / 15, 5);
  expect(measured.articulated.hubHeight).toBeCloseTo(-0.2, 5);
  expect(measured.articulated.steer).toBeCloseTo(0.2, 5);
  expect(measured.articulated.steeringWheel).toBeCloseTo(-0.44, 5);
  expect(errors).toEqual([]);
  await info.attach('instrument-canvas.json', {
    body: JSON.stringify(measured),
    contentType: 'application/json',
  });
});
