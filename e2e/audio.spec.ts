import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import {
  HEADER,
  CAR_STRIDE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

// Bundle the actual contact graph as a test script; no mocked AudioContext and
// no running WebGL scene. This isolates signal measurements from GPU timing.
test('real offline audio distinguishes surface spectra and guards airborne contact', async ({
  page,
}, info) => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('src/audio/surface-audio.ts'), name: 'ApexContact', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing bundled audio fixture');
  const code = output.output.find((entry) => entry.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('Audio fixture is not executable');
  await page.addScriptTag({ content: code.code });
  const measurements = await page.evaluate(
    async ({ HEADER, CAR_STRIDE, F, H, W, WHEEL_BASE, WHEEL_STRIDE, base }) => {
      const library = (
        window as unknown as {
          ApexContact: {
            ContactAudio: new (ctx: BaseAudioContext) => {
              update(frame: Float32Array, cockpit: boolean, time: number): void;
              dispose(): void;
            };
          };
        }
      ).ApexContact;
      const reports: Record<
        string,
        { rms: number; highFrequency: number; peak: number; finite: boolean }
      > = {};
      for (const [name, surface, loaded, flat] of [
        ['grass', 3, true, false],
        ['gravel', 4, true, false],
        ['airborne', 4, false, false],
        ['flat', 0, true, true],
      ] as const) {
        const context = new OfflineAudioContext(1, 48000, 48000);
        const graph = new library.ContactAudio(context);
        const frame = new Float32Array(HEADER + CAR_STRIDE);
        frame[H.CARS] = 1;
        frame[base + F.SPEED] = 40;
        frame[base + F.RPM] = 8000;
        for (let wheel = 0; wheel < 4; wheel++) {
          const p = base + WHEEL_BASE + wheel * WHEEL_STRIDE;
          frame[p + W.LOAD] = loaded ? 2000 : 0;
          frame[p + W.SURFACE] = surface;
          frame[p + W.OMEGA] = 120;
          frame[p + W.FLAT] = flat ? 0.8 : 0;
        }
        for (let step = 0; step < 40; step++) {
          frame[H.TIME] = step / 40;
          graph.update(frame, true, step / 40);
        }
        const buffer = await context.startRendering(),
          data = buffer.getChannelData(0);
        let sum = 0,
          diff = 0,
          peak = 0,
          finite = true;
        for (let i = 12000; i < data.length; i++) {
          sum += data[i] ** 2;
          diff += (data[i] - data[i - 1]) ** 2;
          peak = Math.max(peak, Math.abs(data[i]));
          finite &&= Number.isFinite(data[i]);
        }
        reports[name] = {
          rms: Math.sqrt(sum / 36000),
          highFrequency: diff / Math.max(sum, 1e-12),
          peak,
          finite,
        };
        graph.dispose();
        graph.dispose();
      }
      return reports;
    },
    { HEADER, CAR_STRIDE, F, H, W, WHEEL_BASE, WHEEL_STRIDE, base: carBase(0) },
  );
  expect(measurements.grass.rms).toBeGreaterThan(0.001);
  expect(measurements.gravel.rms).toBeGreaterThan(0.001);
  expect(measurements.gravel.highFrequency).toBeGreaterThan(measurements.grass.highFrequency * 5);
  expect(measurements.airborne.rms).toBe(0);
  expect(measurements.flat.rms).toBeGreaterThan(0.01);
  for (const signal of Object.values(measurements)) {
    expect(signal.finite).toBe(true);
    expect(signal.peak).toBeLessThan(1);
  }
  await info.attach('actual-audio-signals.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});
