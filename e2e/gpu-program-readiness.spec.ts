import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { probeProgramReadiness } from './fixtures/program-readiness.ts';

/** Small native-GL coverage proof, not a preparation speed benchmark. */
test('all live shader programs include shared-material and older variants', async ({
  page,
}, info) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/program-readiness.ts'),
        name: 'ProgramReadiness',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing program readiness build');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing program readiness code');
  await page.setContent('<!doctype html><canvas width="64" height="64"></canvas>');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(async () => {
    const probe = (
      window as unknown as {
        ProgramReadiness: { probeProgramReadiness: typeof probeProgramReadiness };
      }
    ).ProgramReadiness.probeProgramReadiness;
    return probe(document.querySelector('canvas')!);
  });
  await info.attach('all-program-readiness.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.complete).toBe('complete');
  expect(report.sharedMaterialCount).toBe(1);
  // Mesh, instanced and skinned each use front/back transparent variants,
  // alongside the older unrelated live program.
  expect(report.generatedPrograms).toBeGreaterThanOrEqual(7);
  expect(report.baselineChecked).toBeLessThan(report.generatedPrograms);
  expect(report.allChecked).toBe(report.generatedPrograms);
  expect(report.olderPrograms).toBeGreaterThan(0);
  expect(report.olderChecked).toBe(true);
  expect(report.eachChecked).toBe(true);
  expect(report.programsAfterDraw).toBe(report.generatedPrograms);
  expect(report.shaderErrorsEnabled).toBe(true);
  expect(report.yields).toBeGreaterThan(0);
  expect(report.glError).toBe(0);
  expect(browserErrors).toEqual([]);
});
