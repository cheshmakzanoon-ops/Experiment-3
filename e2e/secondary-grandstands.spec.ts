import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { surveySecondaryStands } from './fixtures/secondary-grandstands.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A12 ${lighting}: six production stands, cockpit and unchanged physical traversal`, async ({
    page,
  }, info) => {
    test.setTimeout(600000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/secondary-grandstands.ts'),
          name: 'StandSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing A12 observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No A12 observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/secondary-stand-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A12 production event hall inspection</title>',
      }),
    );
    await page.goto('/secondary-stand-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as {
            StandSurvey: { surveySecondaryStands: typeof surveySecondaryStands };
          }
        ).StandSurvey.surveySecondaryStands(l),
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
    await writeFile(info.outputPath('a12-report.json'), JSON.stringify(data, null, 2));
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.asset.finalArtApproved).toBe(false);
    expect(report.frameUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.identitiesUnchanged).toBe(true);
    expect(report.observedTiers).toEqual([0, 1, 2]);
    expect(report.changedStandPixels).toBeGreaterThan(250);
    expect(report.liveFramesUnchanged).toBe(true);
    expect(report.liveWaterUnchanged).toBe(true);
    expect(report.diagnostics.sites.map((s) => s.s)).toEqual([450, 780, 1220, 1670, 2210, 2600]);
    for (const site of report.diagnostics.sites) {
      expect(site.batches).toBe(10);
      expect(
        report.driving.filter((d) => d.site === site.s && d.mode === 'cockpit').length,
      ).toBeGreaterThanOrEqual(4);
      expect(report.driving.some((d) => d.site === site.s && d.mode === 'chase')).toBe(true);
    }
    expect(report.memories).toHaveLength(22);
    for (const memory of report.memories) expect(memory).toEqual(report.memoryBefore);
    expect(report.images).toHaveLength(11);
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
