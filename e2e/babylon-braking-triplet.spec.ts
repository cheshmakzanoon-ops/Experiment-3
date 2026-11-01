import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { babylonBrakingTriplet } from './fixtures/babylon-braking-triplet.ts';

for (const mode of ['native', 'standalone', 'context-loss'] as const)
  test(`original A09 triplet, atlas, same-canvas prints and native depth (${mode}; not final PBR parity)`, async ({
    page,
  }, info) => {
    expect(
      createHash('sha256').update(readFileSync('src/rendering/track-boards.ts')).digest('hex'),
    ).toBe('a721839b06187f91a940d316de8785f53d2e93d5789547ca1a575d6679016750');
    expect(
      createHash('sha256').update(readFileSync('src/rendering/track-board-plan.ts')).digest('hex'),
    ).toBe('cb437c9444b3d644c8aa64312c644654d92a86943b803f35698dbce715b36e7c');
    expect(
      createHash('sha256')
        .update(readFileSync('src/rendering/studio/branding-plan.ts'))
        .digest('hex'),
    ).toBe('b9dd6915f7fd08373f8479f575d0308ecaaffc5582025fe5ada7f823c3fc4bbd');
    expect(
      createHash('sha256')
        .update(readFileSync('public/models/aurel-track-boards.glb'))
        .digest('hex'),
    ).toBe('5a2886f0454fafafc85de772e272eb26ace69722e714ecde2d3da6a983ee1555');
    expect(
      createHash('sha256')
        .update(readFileSync('src/rendering/studio/brand-atlas.ts'))
        .digest('hex'),
    ).toBe('dca85756467bfc3420acb61a5cba7592dd7b988d60152a6d01dcd5fd5ef817e6');
    expect(
      createHash('sha256').update(readFileSync('src/rendering/geometry.ts')).digest('hex'),
    ).toBe('c120aa6b3b8ad80f6a600d77fc3717c4638f89c3ab4bc36fea520345ebfacd26');
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/babylon-braking-triplet.ts'),
          name: 'BabylonBrakingTripletProbe',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing A09 fixture output');
    const chunk = output.output.find((item) => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A09 fixture code');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/babylon-braking-triplet-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Isolated original A09 triplet</title>',
      }),
    );
    await page.goto('/babylon-braking-triplet-fixture');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      ({ standalone, loss }) =>
        (
          window as unknown as {
            BabylonBrakingTripletProbe: { babylonBrakingTriplet: typeof babylonBrakingTriplet };
          }
        ).BabylonBrakingTripletProbe.babylonBrakingTriplet(standalone, loss),
      { standalone: mode === 'standalone', loss: mode === 'context-loss' },
    );
    for (const view of [
      ...report.images,
      ...(report.restart?.images.map((view) => ({ ...view, name: `restart-${view.name}` })) ?? []),
    ])
      await info.attach(`braking-triplet-${mode}-${view.name}.png`, {
        body: Buffer.from(view.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`braking-triplet-${mode}.json`, {
      body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(report.failure).toBeNull();
    expect(report.rows).toHaveLength(2);
    expect(report.images).toHaveLength(42);
    expect(errors).toEqual([]);
    if (mode === 'standalone') expect(report.transport).toBe('standalone');
    if (mode === 'context-loss') expect(report.loss).toMatchObject({ lost: true, losses: 1 });
    else expect(report.loss).toBeNull();
    if (mode === 'context-loss') {
      expect(report.restart?.failure).toBeNull();
      expect(report.restart?.rows).toHaveLength(2);
      expect(report.restart?.images).toHaveLength(42);
    }
  });
