import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';
import type { surveyInfrastructure } from './fixtures/track-infrastructure.ts';

// Same camera/snapshot/render workload on the unchanged baseline. Only new-kit
// existence/negative controls are unavailable in that deliberately older source.
const baseline = process.env.INFRASTRUCTURE_BASELINE === '1';
for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A01-A07 complete production ${lighting} scene, visible assets and recorded start`, async ({
    page,
  }, info) => {
    test.setTimeout(420000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/track-infrastructure.ts'),
          name: 'InfrastructureSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing production infrastructure fixture');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/infrastructure-survey', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Aurel track infrastructure evidence</title>',
      }),
    );
    await page.goto('/infrastructure-survey');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      (lighting) =>
        (
          window as unknown as {
            InfrastructureSurvey: { surveyInfrastructure: typeof surveyInfrastructure };
          }
        ).InfrastructureSurvey.surveyInfrastructure(lighting),
      lighting,
    );
    for (const image of report.images)
      await info.attach(`${lighting}-${image.name}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`infrastructure-${lighting}.json`, {
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
    expect(report.memoryAfter).toEqual(report.memoryBefore);
    expect(report.heldMaxDelta).toBe(0);
    expect(report.gate).toEqual({ station: 1041.1996354671487, side: -1 });
    expect(report.images).toHaveLength(11);
    for (const image of report.images) {
      expect(image.lit, image.name).toBeGreaterThan(0.2);
      expect(image.range, image.name).toBeGreaterThan(30);
      // Retain the direct-scene limit, and account separately for every cockpit pass.
      requireInfrastructureRenderBudget(lighting, image, report.source.drawBreakdown);
      if (!baseline && image.name !== 'normal-cockpit') {
        expect(image.changed, image.name).toBeGreaterThan(100);
        expect(image.peakDelta, image.name).toBeGreaterThan(30);
      }
    }
    expect(report.lampSamples.map((s) => s.lights)).toEqual([0, 1, 2, 3, 4, 5, 0, 3, 3, 0]);
    for (const sample of report.lampSamples)
      for (let lamp = 0; lamp < 5; lamp++) {
        if (lamp < sample.lights)
          expect(sample.gain[lamp], `stage ${sample.lights} lamp ${lamp}`).toBeGreaterThan(15);
        else expect(Math.abs(sample.gain[lamp]), `off lamp ${lamp}`).toBeLessThan(1);
      }
    expect(report.marshal.active).toBeGreaterThan(0);
    expect(report.marshal.gripError).toBeLessThan(0.00001);
    expect(report.marshal.unreachable).toBe(0);
    if (!baseline) {
      const detail = report.source.infrastructureDetail;
      expect(detail.startGantry).toMatchObject({
        modules: 1,
        retainedStartLamps: 5,
        finalArtApproved: false,
      });
      expect(detail.recoveryGates).toMatchObject({
        accessGates: 6,
        circuitGates: 5,
        routes: 5,
        gateOperation: false,
      });
      for (const kit of Object.values(detail)) {
        expect(kit).toMatchObject({ loaded: true, physicsChanged: false, finalArtApproved: false });
        expect(kit!.chunks).toBeGreaterThan(0);
      }
      for (const far of report.far) {
        expect(far!.selectedLods[0]).toBe(0);
        expect(far!.selectedLods[1]).toBe(0);
        expect(far!.selectedLods[2]).toBeGreaterThan(0);
      }
    }
  });
}
