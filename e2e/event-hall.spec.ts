import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { surveyEventHall } from './fixtures/event-hall.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A71 ${lighting}: full production hall, cockpit and unchanged physical traversal`, async ({
    page,
  }, info) => {
    test.setTimeout(600000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/event-hall.ts'),
          name: 'HallSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing A71 observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No A71 observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/event-hall-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A71 production event hall inspection</title>',
      }),
    );
    await page.goto('/event-hall-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as { HallSurvey: { surveyEventHall: typeof surveyEventHall } }
        ).HallSurvey.surveyEventHall(l),
      lighting,
    );
    for (const image of [
      ...report.images,
      report.cockpit,
      ...report.driving.map((d, i) => ({ ...d, name: `physical-drive-${i}` })),
    ])
      await info.attach(`${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    const data = {
      ...report,
      errors,
      images: report.images.map(({ image: _image, ...m }) => m),
      cockpit: { name: report.cockpit.name, stats: report.cockpit.stats },
      driving: report.driving.map(({ image: _image, ...d }) => d),
    };
    await writeFile(info.outputPath('a71-report.json'), JSON.stringify(data, null, 2));
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.asset.finalArtApproved).toBe(false);
    expect(report.frameUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.identitiesUnchanged).toBe(true);
    expect(report.observedCounts).toEqual([9024, 2208, 720]);
    expect(report.memories).toHaveLength(10);
    for (const memory of report.memories) expect(memory).toEqual(report.memoryBefore);
    expect(report.images).toHaveLength(5);
    expect(report.driveCompleted).toBe(true);
    expect(report.driving.length).toBeGreaterThanOrEqual(4);
    for (const image of report.images) {
      expect(image.range).toBeGreaterThan(30);
      requireOperationsInspectionBudget(image, image.passes);
    }
    const stats = report.cockpit.stats;
    requireInfrastructureRenderBudget(
      lighting,
      { name: 'normal-cockpit', calls: stats.drawCalls, triangles: stats.triangles },
      stats.drawBreakdown,
    );
  });
}
