import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Probe from './fixtures/race-surface-atmosphere.ts';
import manifest from '../src/rendering/apx01-driver.manifest.json' with { type: 'json' };

let code: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-surface-atmosphere.ts'),
        name: 'RaceSurfaceProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing race-surface fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing race-surface code');
  code = chunk.code;
});
// Keep all four full-scene views and all eight timing samples per view. Each
// case gets the unchanged ordinary timeout, rather than putting 80 synchronized
// software-GPU renders into one indivisible five-minute browser call.
const cases: {
  method: 'roadMaterialGPU' | 'rainFogGPU' | 'fullSceneFogGPU';
  mode?: Probe.FogView;
}[] = [
  { method: 'roadMaterialGPU' },
  { method: 'rainFogGPU' },
  { method: 'fullSceneFogGPU', mode: 'populated-grid' },
  { method: 'fullSceneFogGPU', mode: 'low-district' },
  { method: 'fullSceneFogGPU', mode: 'high-district' },
  { method: 'fullSceneFogGPU', mode: 'long-district' },
];
for (const { method, mode } of cases) {
  test(`race surface and atmosphere: ${method}${mode ? ` ${mode}` : ''} preserves production resources and negative controls`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 640, height: 400 });
    await page.route('**/race-surface-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Controlled production surface and atmosphere</title>',
      }),
    );
    await page.goto('/race-surface-fixture');
    await page.addScriptTag({ content: code });
    const report = await page.evaluate(
      async ({ method, mode }) => {
        const probe = (window as unknown as { RaceSurfaceProbe: typeof Probe }).RaceSurfaceProbe;
        if (method === 'fullSceneFogGPU') {
          if (!mode) throw new Error('Missing declared full-scene fog view');
          return probe.fullSceneFogGPU(mode);
        }
        return probe[method]();
      },
      { method, mode },
    );
    for (const [name, image] of Object.entries(report.images))
      await info.attach(`${name}.png`, {
        body: Buffer.from(image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`${method}${mode ? `-${mode}` : ''}.json`, {
      body: JSON.stringify(report, (k, v) => (k === 'images' ? undefined : v), 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    if ('observations' in report) {
      expect(report.sourceUnchanged).toBe(true);
      expect(report.authored).toMatchObject({ loaded: true, sha256: manifest.sha256, joints: 9 });
      expect(report.sigma).toBeGreaterThan(0);
      expect(report.observations).toHaveLength(1);
      expect(report.observations[0].mode).toBe(mode);
      for (const row of report.observations) {
        // The analytical budget is 1e-6 optical depth. Quantization may change
        // a boundary channel by one code value, but not hide a visible patch.
        expect(row.difference.maxChannelDelta, row.mode).toBeLessThanOrEqual(1);
        expect(row.held.maxChannelDelta, row.mode).toBe(0);
        expect(row.restored.maxChannelDelta, row.mode).toBe(0);
        expect(row.countsEqual, row.mode).toBe(true);
        expect(row.before, row.mode).toEqual(row.after);
        expect(row.calls, row.mode).toBeGreaterThan(0);
        expect(row.timings).toHaveLength(8);
        expect(row.timings.filter((t) => t.bounded)).toHaveLength(4);
        expect(row.timings.filter((t) => !t.bounded)).toHaveLength(4);
      }
    } else {
      expect(report.before).toEqual(report.after);
      expect(report.counts[0]).toEqual(report.counts[1]);
      expect(report.comparisons.held.maxChannelDelta).toBe(0);
      expect(report.comparisons.restored.maxChannelDelta).toBe(0);
      expect(report.comparisons.rewound.maxChannelDelta).toBe(0);
      if ('coordinate' in report.comparisons) {
        expect(report.comparisons.coordinate.changedChannels).toBeGreaterThan(100);
        expect(report.comparisons.coordinate.maxChannelDelta).toBeGreaterThan(10);
        expect(report.comparisons.reference.maxChannelDelta).toBeLessThanOrEqual(1);
        expect('sourceUnchanged' in report && report.sourceUnchanged).toBe(true);
      } else {
        expect(report.comparisons.changed.changedChannels).toBeGreaterThan(10000);
        expect(report.comparisons.changed.meanChannelDelta).toBeGreaterThan(0.1);
        expect(report.before.textures).toBe(3);
      }
    }
  });
}
