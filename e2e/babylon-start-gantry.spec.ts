import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { babylonStartGantry } from './fixtures/babylon-start-gantry.ts';

for (const mode of ['native', 'standalone', 'context-loss'] as const)
  test(`original A07 native GLB/PNG structure and ownership (${mode}; not final PBR parity)`, async ({
    page,
  }, info) => {
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/babylon-start-gantry.ts'),
          name: 'BabylonStartGantryProbe',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing A07 fixture output');
    const chunk = output.output.find((item) => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A07 fixture code');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/babylon-start-gantry-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Isolated original A07 structure qualification</title>',
      }),
    );
    await page.goto('/babylon-start-gantry-fixture');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      ({ standalone, loss }) =>
        (
          window as unknown as {
            BabylonStartGantryProbe: { babylonStartGantry: typeof babylonStartGantry };
          }
        ).BabylonStartGantryProbe.babylonStartGantry(standalone, loss),
      { standalone: mode === 'standalone', loss: mode === 'context-loss' },
    );
    for (const view of [
      ...report.images,
      ...(report.restart?.images.map((view) => ({ ...view, name: `restart-${view.name}` })) ?? []),
    ])
      await info.attach(`a07-${mode}-${view.name}.png`, {
        body: Buffer.from(view.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`a07-${mode}.json`, {
      body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(report.failure).toBeNull();
    expect(report.rows).toHaveLength(2);
    expect(report.images).toHaveLength(6);
    expect(errors).toEqual([]);
    if (mode === 'standalone') expect(report.transport).toBe('standalone');
    if (mode === 'context-loss')
      expect(report.loss).toMatchObject({
        disposed: true,
        resources: report.baseline,
        diagnostics: { lost: true, losses: 1 },
      });
    else expect(report.loss).toBeNull();
    if (mode === 'context-loss') {
      expect(report.restart?.failure).toBeNull();
      expect(report.restart?.rows).toHaveLength(2);
      expect(report.restart?.images).toHaveLength(6);
    }
  });
