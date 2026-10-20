import { expect, test as base } from '@playwright/test';
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { captureMotocrossBike } from './fixtures/motocross-bike-review.ts';

type CaptureOptions = {
  id: string;
  detail: 'high' | 'mid' | 'far';
  view?: string;
  samples?: Parameters<typeof captureMotocrossBike>[3];
};
type CaptureResult = ReturnType<typeof captureMotocrossBike>[number];
type Review = {
  capture: (options: CaptureOptions) => Promise<ReturnType<typeof captureMotocrossBike>>;
  attach: (name: string, result: CaptureResult) => Promise<void>;
};

// One fixture bundle per worker; each independent contract still receives a
// fresh page and the original production geometry/material constructors.
let bundleCode: Promise<string> | undefined;
async function compileReview() {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-bike-review.ts'),
        name: 'MotocrossReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing motocross GPU fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing motocross GPU fixture chunk');
  return chunk.code;
}

const test = base.extend<{ review: Review }>({
  review: async ({ page }, use, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setContent('<!doctype html><title>Motocross production-model GPU review</title>');
    bundleCode ??= compileReview();
    await page.addScriptTag({ content: await bundleCode });
    const capture = (options: CaptureOptions) =>
      page.evaluate(
        (c) =>
          (
            window as unknown as {
              MotocrossReview: { captureMotocrossBike: typeof captureMotocrossBike };
            }
          ).MotocrossReview.captureMotocrossBike(c.id, c.detail, c.view, c.samples),
        options,
      );
    const attach = async (name: string, result: CaptureResult) => {
      // Keep successful evidence as named files even with the line reporter;
      // attachments alone otherwise survive only inside retained traces.
      const imagePath = info.outputPath(`${name}.png`),
        metricsPath = info.outputPath(`${name}-metrics.json`);
      await mkdir(dirname(imagePath), { recursive: true });
      await Promise.all([
        writeFile(imagePath, Buffer.from(result.image.split(',')[1], 'base64')),
        writeFile(
          metricsPath,
          JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
        ),
      ]);
      await info.attach(`${name}.png`, { path: imagePath, contentType: 'image/png' });
      await info.attach(`${name}-metrics.json`, {
        path: metricsPath,
        contentType: 'application/json',
      });
      expect(result.glError).toBe(0);
      expect(result.finiteGeometry).toBe(true);
      expect(result.hash).not.toBe(0);
      expect(result.calls).toBeLessThan(200);
      expect(result.triangles).toBeLessThan(130000);
      if (result.chain) {
        expect(result.chain.finite).toBe(true);
        expect(result.chain.counts).toEqual([96, 192]);
      }
      expect(result.bounds.min.y).toBeGreaterThan(-0.006);
      for (const contact of result.contacts) {
        // Measure the real glove hold and skinned sole, not bone origins.
        expect(contact.handError).toBeLessThan(1e-6);
        expect(contact.ankleError).toBeLessThan(0.009);
        expect(contact.soleContactFound).toBe(true);
        expect(contact.wristJointError).toBeLessThan(1e-6);
        expect(contact.ankleJointError).toBeLessThan(1e-6);
        expect(contact.calfAttachmentError).toBeLessThan(1e-6);
        expect(contact.calfSamples).toBeGreaterThan(10);
      }
    };
    await use({ capture, attach });
    expect(errors).toEqual([]);
  },
});

// Contracts keep the configured 300 s per-case budget and every original
// sample/assertion. A slow earlier model cannot consume the onboard, mud or
// drivetrain contract's entire deadline before that contract begins.
for (const id of ['mx450', 'mx250'])
  test(`Motocross ${id}: production high/mid/far geometry and LOD budgets`, async ({ review }) => {
    const { capture, attach } = review;
    const triangles: number[] = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const [result] = await capture({ id, detail });
      await attach(`${id}-${detail}`, result);
      triangles.push(result.triangles);
      expect(result.bounds.max.z - result.bounds.min.z).toBeLessThan(2.55);
    }
    expect(triangles[0]).toBeGreaterThan(triangles[1]);
    expect(triangles[1]).toBeGreaterThan(triangles[2]);
  });

for (const [name, view, sample] of [
  ['standing-side', 'side', { standing: 1, body: 0.6 }],
  ['braced-front', 'front', { standing: 1, body: -0.8, steer: 0.12 }],
  ['inside-foot-dab', 'front', { dab: 1, lean: 0.55, steer: 0.12 }],
  ['rear-components', 'rear', { standing: 0.45 }],
  ['helmet-and-gear', 'helmet', {}],
] as const)
  test(`Motocross MX450 reachable pose: ${name}`, async ({ review }) => {
    const { capture, attach } = review;
    const [result] = await capture({ id: 'mx450', detail: 'high', view, samples: [sample] });
    await attach(name, result);
  });

for (const id of ['mx250', 'mx450'])
  test(`Motocross ${id}: production onboard visibility and contacts`, async ({ review }) => {
    const { capture, attach } = review;
    const samples = await capture({
      id,
      detail: 'high',
      view: 'onboard',
      samples: [
        { speed: 0 },
        { standing: 1, body: 0.7, steer: 0.12, speed: 25 },
        { standing: 1, body: -0.8, brake: 0.9, lean: 0.35, steer: -0.18, speed: 30 },
      ],
    });
    for (const [pose, result] of samples.entries()) {
      await attach(`${id}-production-onboard-${pose}`, result);
      const cockpit = result.cockpit;
      expect(cockpit).not.toBeNull();
      expect(cockpit!.headVisible).toBe(false);
      expect(cockpit!.torsoVisible).toBe(false);
      expect(cockpit!.handsVisible).toEqual([true, true]);
      for (const [x, y] of cockpit!.sleeveEntries)
        expect(y < -0.95 || Math.abs(x) > 0.98).toBe(true);
      expect(cockpit!.visibleControls).toBe(3);
      expect(cockpit!.clearForwardSamples).toBe(15);
      for (const control of cockpit!.controls) {
        const [x, y, z] = control.ndc;
        expect(Math.abs(x)).toBeLessThan(0.95);
        expect(Math.abs(y)).toBeLessThan(0.95);
        expect(z).toBeGreaterThan(-1);
        expect(z).toBeLessThan(1);
      }
    }
  });

test('Motocross MX450: reversible mud on the same production instance', async ({ review }) => {
  const { capture, attach } = review;
  const sequence = await capture({
    id: 'mx450',
    detail: 'high',
    view: 'three-quarter',
    samples: [{}, { mud: 0.9, wet: 0.55 }, { mud: 0.9, wet: 0.55 }, {}],
  });
  for (const [i, result] of sequence.entries()) {
    await attach(`same-instance-mud-${i}`, result);
    expect(result.instance).toBe(sequence[0].instance);
    expect(result.resources).toEqual(sequence[0].resources);
  }
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
});

test('Motocross MX450: recorded tyre wear and wetness rewind without resource churn', async ({
  review,
}) => {
  const { capture, attach } = review;
  const wornWet = { rearWear: 0.72, rearWater: 0.8, rearRotation: 0.2 };
  const sequence = await capture({
    id: 'mx450',
    detail: 'high',
    view: 'rear-tyre',
    samples: [{ rearRotation: 0.2 }, wornWet, wornWet, { rearRotation: 0.2 }],
  });
  for (const [i, result] of sequence.entries()) {
    await attach(`recorded-tyre-surface-${i}`, result);
    expect(result.instance).toBe(sequence[0].instance);
    expect(result.resources).toEqual(sequence[0].resources);
  }
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
});

test('Motocross MX250: articulated chest and corner gaze retain contact through a reversible lean change', async ({
  review,
}) => {
  const { capture, attach } = review;
  const left = { lean: -0.45, steer: 0.12, standing: 0.35, speed: 20 };
  const right = { lean: 0.45, steer: -0.12, standing: 0.35, speed: 20 };
  const sequence = await capture({
    id: 'mx250',
    detail: 'high',
    view: 'rear',
    samples: [left, right, right, left],
  });
  for (const [i, result] of sequence.entries()) {
    await attach(`articulated-corner-${i}`, result);
    expect(result.instance).toBe(sequence[0].instance);
    expect(result.resources).toEqual(sequence[0].resources);
    expect(result.motion.chestQuaternion).not.toEqual(result.motion.pelvisQuaternion);
  }
  expect(sequence[0].motion.helmetForward[0]).toBeLessThan(0);
  expect(sequence[1].motion.helmetForward[0]).toBeGreaterThan(0);
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
});

test('Motocross MX450: suspension absorption, gaze and lever are reversible on the production rig', async ({
  review,
}) => {
  const { capture, attach } = review;
  const relaxed = { standing: 1, body: 0.35, pitch: 0.22, elevation: 0.3 };
  const compressed = { ...relaxed, forkOffset: 0.13, shockOffset: 0.13, brake: 0.8 };
  // Controlled geometry inspection: these are posed fixture samples, not
  // claimed simulated landings. MX45 separately exercises the live worker.
  const sequence = await capture({
    id: 'mx450',
    detail: 'high',
    view: 'motion-side',
    samples: [relaxed, compressed, compressed, relaxed],
  });
  for (const [i, result] of sequence.entries()) {
    await attach(`suspension-motion-${i}`, result);
    expect(result.instance).toBe(sequence[0].instance);
    expect(result.resources).toEqual(sequence[0].resources);
  }
  expect(sequence[1].motion.pelvis[1]).toBeLessThan(sequence[0].motion.pelvis[1] - 0.025);
  expect(sequence[1].motion.frontLever).toBeLessThan(sequence[0].motion.frontLever! - 0.1);
  expect(sequence[0].hash).not.toBe(sequence[1].hash);
  expect(sequence[1].hash).toBe(sequence[2].hash);
  expect(sequence[0].hash).toBe(sequence[3].hash);
  expect(sequence[1].motion).toEqual(sequence[2].motion);
  expect(sequence[0].motion).toEqual(sequence[3].motion);
});

for (const [id, detail] of [
  ['mx450', 'high'],
  ['mx250', 'mid'],
] as const)
  test(`Motocross ${id} ${detail}: reversible drivetrain wheel phase`, async ({ review }) => {
    const { capture, attach } = review;
    const drive = await capture({
      id,
      detail,
      view: 'drivetrain',
      samples: [
        { rearRotation: 0.2, forkOffset: 0.04, shockOffset: -0.01 },
        { rearRotation: 1.1, forkOffset: 0.04, shockOffset: -0.01 },
        { rearRotation: 1.1, forkOffset: 0.04, shockOffset: -0.01 },
        { rearRotation: 0.2, forkOffset: 0.04, shockOffset: -0.01 },
      ],
    });
    for (const [i, result] of drive.entries()) {
      await attach(`${id}-${detail}-drive-${i}`, result);
      expect(result.chain).not.toBeNull();
      expect(result.instance).toBe(drive[0].instance);
      expect(result.resources).toEqual(drive[0].resources);
    }
    expect(drive[0].chain!.hash).not.toBe(drive[1].chain!.hash);
    expect(drive[1].chain!.hash).toBe(drive[2].chain!.hash);
    expect(drive[0].chain!.hash).toBe(drive[3].chain!.hash);
    expect(drive[1].chain!.versions).toEqual(drive[2].chain!.versions);
    expect(drive[0].hash).not.toBe(drive[1].hash);
    expect(drive[1].hash).toBe(drive[2].hash);
    expect(drive[0].hash).toBe(drive[3].hash);
  });
