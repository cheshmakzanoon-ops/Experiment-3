import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import type { EngineVoices } from '../src/audio/engine-voices.ts';
import type { AudioView } from '../src/audio/spatial.ts';

// This is the production synthesis graph in a real browser's offline audio
// renderer. The prescribed source trajectory is an isolated acoustic fixture,
// not a fabricated driving result or a substitute for the full game acceptance.
test('actual engine output follows camera stereo, Doppler, distance and pass-by motion', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('src/audio/engine-voices.ts'),
        name: 'EngineOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing engine audio bundle');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing engine audio entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(
    async ({ CAR_STRIDE, F, H, HEADER, base }) => {
      const { EngineVoices } = (
        window as unknown as {
          EngineOracle: { EngineVoices: new (context: BaseAudioContext) => EngineVoices };
        }
      ).EngineOracle;
      const measurements: Record<
        string,
        { left: number; right: number; crossings: number; peak: number; finite: boolean }
      > = {};
      const view: AudioView = {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rightX: 1,
        rightY: 0,
        rightZ: 0,
        interior: false,
        followedCar: 0,
      };
      const rms = (signal: Float32Array, start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += signal[i] ** 2;
        return Math.sqrt(sum / (end - start));
      };
      for (const mode of ['left', 'right', 'rest', 'approach', 'recede', 'distant', 'passby']) {
        const context = new OfflineAudioContext(2, 48000, 48000),
          graph = new EngineVoices(context);
        const f = new Float32Array(HEADER + CAR_STRIDE);
        f[H.CARS] = 1;
        f[base + F.RPM] = 8000;
        f[base + F.ENGINE_TORQUE] = 400;
        f[base + F.QW] = 1;
        f[base + F.Z] = -30;
        if (mode === 'left') f[base + F.X] = -100;
        if (mode === 'right') f[base + F.X] = 100;
        if (mode === 'approach') f[base + F.VZ] = 60;
        if (mode === 'recede') f[base + F.VZ] = -60;
        if (mode === 'distant') f[base + F.Z] = -300;
        for (let i = 0; i < 40; i++) {
          f[H.TIME] = i / 40;
          if (mode === 'passby') {
            f[base + F.X] = (i / 40 - 0.5) * 120;
            f[base + F.Z] = -8;
            f[base + F.VX] = 120;
          }
          graph.update(f, view, i / 40);
        }
        const buffer = await context.startRendering(),
          left = buffer.getChannelData(0),
          right = buffer.getChannelData(1);
        let crossings = 0,
          peak = 0,
          finite = true;
        for (let i = 12000; i < left.length; i++) {
          if (left[i] + right[i] >= 0 && left[i - 1] + right[i - 1] < 0) crossings++;
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          finite &&= Number.isFinite(left[i] + right[i]);
        }
        measurements[mode] = {
          left: rms(left, 12000, 48000),
          right: rms(right, 12000, 48000),
          crossings,
          peak,
          finite,
        };
        if (mode === 'passby') {
          measurements.passbyBefore = {
            ...measurements[mode],
            left: rms(left, 6000, 15000),
            right: rms(right, 6000, 15000),
          };
          measurements.passbyAfter = {
            ...measurements[mode],
            left: rms(left, 35000, 44000),
            right: rms(right, 35000, 44000),
          };
        }
        graph.dispose();
        graph.dispose();
      }
      return measurements;
    },
    { CAR_STRIDE, F, H, HEADER, base: carBase(0) },
  );
  await info.attach('camera-relative-engine-audio.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.left.left).toBeGreaterThan(report.left.right * 10);
  expect(report.right.right).toBeGreaterThan(report.right.left * 10);
  expect(report.rest.left).toBeGreaterThan(0.001);
  expect(report.approach.crossings / report.rest.crossings).toBeCloseTo(343 / 283, 1);
  expect(report.recede.crossings / report.rest.crossings).toBeCloseTo(343 / 403, 1);
  expect(report.distant.left + report.distant.right).toBe(0);
  expect(report.passbyBefore.left).toBeGreaterThan(report.passbyBefore.right * 3);
  expect(report.passbyAfter.right).toBeGreaterThan(report.passbyAfter.left * 3);
  for (const signal of Object.values(report)) {
    expect(signal.finite).toBe(true);
    expect(signal.peak).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});
