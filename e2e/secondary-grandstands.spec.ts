import { createHash } from 'node:crypto';
import type { SecondaryStandCaptureSink } from './fixtures/secondary-stand-capture.ts';
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
    // Software-GPU execution of the complete 12-car, six-site survey is an
    // evidence workload, not a hardware frame-time benchmark. Keep the 45s
    // application GPU gate, all render budgets and all coverage assertions.
    test.setTimeout(1800000);
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
    const progress: { stage: string; elapsedMs: number }[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.text().startsWith('[a12-survey] ')) {
        const event = JSON.parse(m.text().slice('[a12-survey] '.length));
        progress.push({ stage: event.stage, elapsedMs: event.elapsedMs });
        console.info(`[A12 ${lighting}] ${event.stage} (${Math.round(event.elapsedMs)} ms)`);
      }
      if (m.type() === 'error') errors.push(m.text());
    });
    const captures: { name: string; bytes: number; sha256: string }[] = [];
    const sink: SecondaryStandCaptureSink = async ({ name, image }) => {
      if (!/^[a-z0-9-]+$/.test(name) || captures.some((c) => c.name === name))
        throw new Error('Invalid or duplicate A12 capture name');
      if (!image.startsWith('data:image/png;base64,') || image.length > 16000000)
        throw new Error('Invalid A12 PNG envelope');
      const body = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
      if (!body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('Invalid A12 PNG signature');
      await info.attach(`${lighting}-${name}.png`, { body, contentType: 'image/png' });
      captures.push({
        name,
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
      await writeFile(
        info.outputPath('a12-captures.json'),
        JSON.stringify({ lighting, captures }, null, 2),
      );
    };
    await page.exposeFunction('persistA12Capture', sink);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/secondary-stand-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A12 production secondary-stand inspection</title>',
      }),
    );
    await page.goto('/secondary-stand-survey');
    await page.addScriptTag({ content: chunk.code });
    let report: Awaited<ReturnType<typeof surveySecondaryStands>>;
    try {
      report = await page.evaluate(
        (l) =>
          (
            window as unknown as {
              StandSurvey: { surveySecondaryStands: typeof surveySecondaryStands };
            }
          ).StandSurvey.surveySecondaryStands(l, (capture) =>
            (
              window as unknown as { persistA12Capture: SecondaryStandCaptureSink }
            ).persistA12Capture(capture),
          ),
        lighting,
      );
    } finally {
      // Preserve the last completed stage even when a browser timeout prevents
      // returning the final report or capturing its canvas.
      await writeFile(
        info.outputPath('a12-progress.json'),
        JSON.stringify({ lighting, progress, errors }, null, 2),
      );
    }
    expect(captures.map((c) => c.name)).toEqual([
      report.cockpit.name,
      ...report.images.map((image) => image.name),
      ...report.driving.map((_, i) => `physical-drive-${i}`),
    ]);
    const data = { ...report, errors, captures };
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
