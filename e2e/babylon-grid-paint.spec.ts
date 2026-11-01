import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { babylonGridPaint } from './fixtures/babylon-grid-paint.ts';

for (const mode of ['native', 'standalone', 'context-loss'] as const)
  test(`original dry Formula grid paint, fixed factors and source-classified road depth (${mode}; not final PBR parity)`, async ({
    page,
  }, info) => {
    expect(
      createHash('sha256').update(readFileSync('src/rendering/circuit.ts')).digest('hex'),
    ).toBe('d11fbbbb5dd7efc427dc230da026dfe8e33f0f6aad191f282de5704248f948bc');
    expect(
      createHash('sha256').update(readFileSync('src/rendering/geometry.ts')).digest('hex'),
    ).toBe('c120aa6b3b8ad80f6a600d77fc3717c4638f89c3ab4bc36fea520345ebfacd26');
    expect(
      createHash('sha256').update(readFileSync('src/rendering/grid-paint.ts')).digest('hex'),
    ).toBe('c40ed74cf2aa982ba94c38b9341aaf7f638c26dc3271cff4d245f5649af98f30');
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/babylon-grid-paint.ts'),
          name: 'BabylonGridPaintProbe',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing grid fixture output');
    const chunk = output.output.find((item) => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing grid fixture code');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/babylon-grid-paint-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Isolated original Formula grid paint</title>',
      }),
    );
    await page.goto('/babylon-grid-paint-fixture');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      ({ standalone, loss }) =>
        (
          window as unknown as {
            BabylonGridPaintProbe: {
              babylonGridPaint: typeof babylonGridPaint;
            };
          }
        ).BabylonGridPaintProbe.babylonGridPaint(standalone, loss),
      { standalone: mode === 'standalone', loss: mode === 'context-loss' },
    );
    for (const view of [
      ...report.images,
      ...(report.restart?.images.map((view) => ({ ...view, name: `restart-${view.name}` })) ?? []),
    ])
      await info.attach(`grid-paint-${mode}-${view.name}.png`, {
        body: Buffer.from(view.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`grid-paint-${mode}.json`, {
      body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(report.failure).toBeNull();
    expect(report.rows).toHaveLength(2);
    expect(report.rows).toEqual([
      expect.objectContaining({ cycle: 0, triangles: 432, slots: 12, boxes: 36, disposed: true }),
      expect.objectContaining({ cycle: 1, triangles: 432, slots: 12, boxes: 36, disposed: true }),
    ]);
    expect(report.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'original-road-depth',
          view: 'front-top',
          visible: 162,
          occluded: 0,
          total: 162,
        }),
        expect.objectContaining({
          phase: 'original-road-depth',
          view: 'rear-top',
          visible: 153,
          occluded: 9,
          total: 162,
        }),
      ]),
    );
    expect(report.images).toHaveLength(25);
    expect(errors).toEqual([]);
    if (mode === 'native') expect(report.transport).toBe('ubo');
    if (mode === 'standalone') expect(report.transport).toBe('standalone');
    if (mode === 'context-loss') expect(report.loss).toMatchObject({ lost: true, losses: 1 });
    else expect(report.loss).toBeNull();
    if (mode === 'context-loss') {
      expect(report.restart?.failure).toBeNull();
      expect(report.restart?.rows).toHaveLength(2);
      expect(report.restart?.images).toHaveLength(25);
      expect(report.restart?.transport).toBe(report.transport);
    }
  });
