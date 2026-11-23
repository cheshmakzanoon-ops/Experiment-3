import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type {
  captureGpGrandstands,
  captureGpShadowEdges,
} from './fixtures/gp-grandstand-review.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

let fixtureScript: string;
test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-grandstand-review.ts'),
        name: 'GpStandReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP stand fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP stand fixture chunk');
  fixtureScript = chunk.code;
});

const inspections = [
  ['poggio-alto', 'architecture'],
  ['cape-wrenna', 'architecture'],
  ['haarveld', 'architecture'],
  ['montejaral', 'architecture'],
  ['haarveld', 'trackside'],
] as const;

test('GP cloud spreads the canopy shadow while the contact shadow holds its edge', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<title>GP canopy shadow inspection</title>');
  await page.addScriptTag({ content: fixtureScript });
  const result = await page.evaluate(() =>
    (
      window as unknown as { GpStandReview: { captureGpShadowEdges: typeof captureGpShadowEdges } }
    ).GpStandReview.captureGpShadowEdges(),
  );
  await info.attach('directional-shadow-widths.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  for (const shot of result.shots.slice(0, 3))
    await info.attach(shot.name, {
      body: Buffer.from(shot.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  const [sun, thin, shower, held, rewound] = result.shots;
  expect(thin.canopy).toBeGreaterThan(sun.canopy);
  expect(shower.canopy).toBeGreaterThan(sun.canopy * 2);
  expect(sun.foot).toBeGreaterThan(0);
  expect(shower.foot).toBe(sun.foot);
  expect(shower.hash).toBe(held.hash);
  expect(rewound.hash).toBe(sun.hash);
  expect(shower.calls).toBe(sun.calls);
  expect(shower.triangles).toBe(sun.triangles);
});

for (const [id, view] of inspections) {
  const title =
    view === 'architecture'
      ? `${id} grandstand renders its production crowd and stable wet/held/reset materials`
      : `${id} front walkway shows the seated crowd tracking passing riders`;
  test(title, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setContent('<!doctype html><title>Production GP grandstand inspection</title>');
    await page.addScriptTag({ content: fixtureScript });
    const result = await page.evaluate(
      ({ venue, camera }) =>
        (
          window as unknown as {
            GpStandReview: { captureGpGrandstands: typeof captureGpGrandstands };
          }
        ).GpStandReview.captureGpGrandstands([venue], camera),
      { venue: id, camera: view },
    );
    for (const capture of result.captures)
      await info.attach(`${capture.venue}-grandstand.png`, {
        contentType: 'image/png',
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
      });
    await info.attach(`${id}-grandstand-webgl.json`, {
      contentType: 'application/json',
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    });
    expect(errors).toEqual([]);
    expect(result.glError).toBe(0);
    expect(result.captures.map((capture) => capture.venue)).toEqual([id]);
    for (const capture of result.captures) {
      expect(capture.architectureBatches).toBe(5);
      expect(capture.seats).toBeGreaterThan(500);
      expect(capture.crowdClusters).toBeGreaterThan(0);
      expect(capture.gaze[1]).not.toBe(capture.gaze[0]);
      expect(capture.gaze[2]).toBe(capture.gaze[1]);
      expect(capture.label).not.toMatch(/AUREL/);
      expect(capture.architecture.triangles).toBeLessThan(capture.site.length * 300 + 2000);
      expect(capture.retained).toEqual(capture.baseline.retained);
      expect(capture.baseline.render.glError).toBe(0);
      const structuralIncrease = capture.structure.triangles - capture.baseline.structure.triangles;
      expect(capture.architecture.addedTriangles).toBe(structuralIncrease);
      expect(structuralIncrease).toBeLessThan(capture.site.length * 200 + 1000);
      const [dry, held, wet, wetHeld, restored] = capture.states;
      // The wide camera contains the entire structure, so the exact increase
      // in submitted primitives equals the new architecture. At the walkway,
      // frustum culling cuts different roof spans in the two building meshes.
      if (view === 'architecture') {
        expect(dry.triangles - capture.baseline.render.triangles).toBe(structuralIncrease);
      } else {
        expect(capture.seats).toBe(952);
        expect(dry.calls).toBeLessThan(40);
      }
      expect(dry.hash).toBe(held.hash);
      expect(wet.hash).toBe(wetHeld.hash);
      expect(wet.hash).not.toBe(dry.hash);
      expect(restored.hash).toBe(dry.hash);
      for (const state of capture.states) {
        expect(state.glError).toBe(0);
        expect(state.coloured).toBeGreaterThan(600000);
        expect(state.calls).toBeLessThan(90);
        expect(state.triangles).toBe(dry.triangles);
        expect(state.resources).toEqual(dry.resources);
      }
      expect(capture.afterDispose.geometries).toBe(0);
      expect(capture.afterDispose.textures).toBe(0);
      expect(capture.weather.materialRoles.metal).toBe(2);
    }
  });
}
