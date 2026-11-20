import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type * as Proof from './fixtures/shader-work-proof.ts';

let code: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/shader-work-proof.ts'),
        name: 'ShaderWorkProof',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing shader proof build');
  const chunk = result.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing shader proof code');
  code = chunk.code;
});

for (const method of ['weatherWorkProof', 'fogWorkProof'] as const) {
  test(`inactive shader work: ${method} preserves native pixels and active effects`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/shader-work-proof', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Production shader work proof</title>',
      }),
    );
    await page.goto('/shader-work-proof');
    await page.addScriptTag({ content: code });
    const report = await page.evaluate(
      (method) =>
        (window as unknown as { ShaderWorkProof: typeof Proof }).ShaderWorkProof[method](),
      method,
    );
    await info.attach(`${method}.json`, {
      body: JSON.stringify(report, (k, v) => (k === 'image' ? undefined : v), 2),
      contentType: 'application/json',
    });
    await info.attach(`${method}.png`, {
      body: Buffer.from(report.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
    expect(report.glError).toBe(0);
    if ('rows' in report) {
      expect(report.rows).toHaveLength(20);
      for (const row of report.rows) {
        const label = `${row.role}/${row.mode}`;
        expect(row.comparison.maxChannelDelta, label).toBeLessThanOrEqual(1);
        expect(row.comparison.meanChannelDelta, label).toBeLessThan(0.01);
        expect(row.held.maxChannelDelta, label).toBe(0);
        expect(row.countsEqual, label).toBe(true);
        if (row.mode === 'dry' || row.mode === 'dry-restored') {
          expect(row.comparison.maxChannelDelta, label).toBe(0);
          expect(row.fromDry.maxChannelDelta, label).toBe(0);
        } else if (row.mode !== 'snow' || row.role !== 'leather') {
          expect(row.fromDry.changedChannels, label).toBeGreaterThan(100);
        }
      }
    } else {
      for (const kind of ['disabled', 'held', 'restored'] as const)
        expect(report[kind].maxChannelDelta, kind).toBe(0);
      for (const kind of ['fog', 'aerial', 'cloud', 'grounding'] as const)
        expect(report[kind].changedChannels, kind).toBeGreaterThan(100);
      expect(report.enabledUniforms).toContain('apexLocalSigma');
      expect(report.disabledUniforms).not.toContain('apexLocalSigma');
      expect(report.disabledUniforms).not.toContain('apexFogVolumes');
      expect(report.reusedPrograms).toBe(report.programs);
      expect(report.countsEqual).toBe(true);
    }
  });
}
