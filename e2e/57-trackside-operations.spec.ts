import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';
import type { surveyTracksideOperations } from './fixtures/trackside-operations.ts';
const baseline = process.env.OPERATIONS_BASELINE === '1';
for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A08-A10 complete production ${lighting} operations and recorded local signals`, async ({
    page,
  }, info) => {
    test.setTimeout(420000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/trackside-operations.ts'),
          name: 'OperationsSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing operations observer');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('No observer code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/operations-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Aurel production operations survey</title>',
      }),
    );
    await page.goto('/operations-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (l) =>
        (
          window as unknown as {
            OperationsSurvey: { surveyTracksideOperations: typeof surveyTracksideOperations };
          }
        ).OperationsSurvey.surveyTracksideOperations(l),
      lighting,
    );
    for (const image of report.images)
      await info.attach(`${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await writeFile(
      info.outputPath('operations-report.json'),
      JSON.stringify(
        {
          ...report,
          images: report.images.map(({ image: _image, ...metrics }) => metrics),
          errors,
        },
        null,
        2,
      ),
    );
    await info.attach(`operations-${lighting}.json`, {
      body: JSON.stringify(
        {
          ...report,
          images: report.images.map(({ image: _image, ...metrics }) => metrics),
          errors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.heldMaxDelta).toBe(0);
    expect(report.memoryAfter).toEqual(report.memoryBefore);
    expect(report.images).toHaveLength(baseline ? 13 : 14);
    for (const image of report.images) {
      expect(image.range, image.name).toBeGreaterThan(30);
      if (image.name === 'normal-cockpit')
        requireInfrastructureRenderBudget(lighting, image, report.normalStats.drawBreakdown);
      else requireOperationsInspectionBudget(image, image.passes!);
      if (!baseline && image.changed !== null) {
        expect(image.changed, image.name).toBeGreaterThan(100);
        expect(image.peakDelta, image.name).toBeGreaterThan(30);
      }
    }
    if (!baseline) {
      expect(report.signalEvidence).toMatchObject({
        sequence: [0, 1, 1, 0, 1, 0],
        unchanged: true,
        independent: true,
      });
      expect(report.signalEvidence!.gain).toBeGreaterThan(15);
      expect(report.detail.signalHardware).toMatchObject({
        loaded: true,
        flagBacks: 12,
        utilities: 13,
        sensors: 3,
        physicsChanged: false,
        finalArtApproved: false,
      });
      expect(report.detail.trackBoards).toMatchObject({
        loaded: true,
        modules: 20,
        physicsChanged: false,
        finalArtApproved: false,
      });
      expect(report.detail.broadcastCameras).toMatchObject({
        loaded: true,
        modules: 20,
        physicsChanged: false,
        finalArtApproved: false,
      });
      for (const far of report.far) {
        expect(far!.selectedLods[0]).toBe(0);
        expect(far!.selectedLods[1]).toBe(0);
        expect(far!.selectedLods[2]).toBeGreaterThan(0);
      }
    }
  });
}
