import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { controlAngles } from '../src/rendering/cockpit.ts';
import type { captureCockpitArticulation } from './fixtures/cockpit-detail.ts';

test('detailed cockpit retains physical steering, recorded selectors, pause and rewind', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/cockpit-detail.ts'),
        name: 'CockpitProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing cockpit fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing cockpit fixture code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent('<!doctype html><title>Production cockpit articulation</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        CockpitProbe: { captureCockpitArticulation: typeof captureCockpitArticulation };
      }
    ).CockpitProbe.captureCockpitArticulation(),
  );
  for (const capture of result.captures)
    await info.attach(`cockpit-${capture.name}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('cockpit-articulation.json', {
    body: JSON.stringify(
      { ...result, errors, captures: result.captures.map(({ image: _image, ...data }) => data) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.fabricTextures).toBe(2);
  expect(result.disposedFabric).toBe(2);
  expect(result.disposedSelectors).toBe(3);
  expect(result.captures).toHaveLength(5);
  for (const c of result.captures) {
    expect(c.screenVisible, c.name).toBe(true);
    expect(c.wheelAngle).toBeCloseTo(-c.steer * 2.2, 7);
    expect(c.dialAngles).toEqual(controlAngles(c.bias, c.differential, c.ers).toArray());
    expect(c.dialInstances).toHaveLength(3);
    for (const instances of c.dialInstances) {
      expect(instances.count).toBe(3);
      instances.matrices.forEach((m, i) => {
        expect(Math.atan2(m[1], m[0])).toBeCloseTo(c.dialAngles[i], 6);
        expect(m[12]).toBeCloseTo((i - 1) * -0.073, 6);
        expect(m[13]).toBeCloseTo(-0.056, 6);
        expect(m[14]).toBeCloseTo(-0.025, 6);
      });
    }
    expect(c.image.length, c.name).toBeGreaterThan(50000);
    expect(c.drawCalls).toBeGreaterThan(10);
    for (const j of c.joints) {
      expect(j.reachable).toBe(true);
      expect(j.upperLength).toBeCloseTo(0.37, 8);
      expect(j.lowerLength).toBeCloseTo(0.36, 8);
    }
    expect(c.mirrors).toHaveLength(2);
    for (const mirror of c.mirrors) {
      expect(mirror.width).toBe(512);
      expect(mirror.height).toBe(192);
      expect(mirror.range).toBeGreaterThan(20);
    }
  }
  const [neutral, left, right, paused, rewind] = result.captures;
  expect(left.wheelAngle).toBeGreaterThan(0.5);
  expect(right.wheelAngle).toBeLessThan(-0.5);
  expect(right.joints).toEqual(paused.joints);
  expect(right.dialAngles).toEqual(paused.dialAngles);
  expect(rewind.joints).toEqual(neutral.joints);
  expect(rewind.dialAngles).toEqual(neutral.dialAngles);
  expect(paused.textures).toBeLessThanOrEqual(right.textures);
  expect(rewind.geometries).toBeLessThanOrEqual(right.geometries);
  expect(result.seekMemory).toHaveLength(4);
  for (const memory of result.seekMemory) {
    expect(memory.textures).toBeLessThanOrEqual(rewind.textures);
    expect(memory.geometries).toBeLessThanOrEqual(rewind.geometries);
  }
});
