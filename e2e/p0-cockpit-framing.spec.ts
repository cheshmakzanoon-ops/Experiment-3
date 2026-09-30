import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { cockpitFramingSurvey, CockpitSurveyRow } from './fixtures/cockpit-framing.ts';

for (const group of ['framing', 'controls', 'driving', 'weather'] as const)
  test(`P0 actual supplied cockpit: ${group}, full circuit and camera framing evidence`, async ({
    page,
  }, info) => {
    const bundled = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/cockpit-framing.ts'),
          name: 'CockpitSurvey',
          formats: ['iife'],
        },
      },
    });
    const result = Array.isArray(bundled) ? bundled[0] : bundled;
    if (!('output' in result)) throw new Error('Missing cockpit survey');
    const chunk = result.output.find((item) => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing cockpit survey script');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/cockpit-survey', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Production cockpit framing survey</title>',
      }),
    );
    await page.goto('/cockpit-survey');
    await page.addScriptTag({ content: chunk.code });
    await page.exposeFunction('recordCockpit', async (row: CockpitSurveyRow) => {
      await info.attach(`p0-${row.name}.png`, {
        body: Buffer.from(row.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
      await info.attach(`p0-${row.name}.json`, {
        body: JSON.stringify(row, (key, value) => (key === 'image' ? undefined : value), 2),
        contentType: 'application/json',
      });
    });
    const report = await page.evaluate((group) => {
      const api = window as unknown as {
        CockpitSurvey: { cockpitFramingSurvey: typeof cockpitFramingSurvey };
        recordCockpit: (row: CockpitSurveyRow) => Promise<void>;
      };
      return api.CockpitSurvey.cockpitFramingSurvey(group, (row) => api.recordCockpit(row));
    }, group);
    for (const row of report.rows) {
      expect(row.visual.suppliedPlayer).not.toBeNull();
      expect(row.camera.position.every(Number.isFinite)).toBe(true);
      expect(row.nearIntersections, row.name).toEqual([]);
      if (row.name !== 'pod-retained') {
        expect(row.camera.fov, row.name).toBe(report.calibration.verticalFov);
        expect(row.visual.screenVisible, row.name).toBe(true);
        expect(Math.abs(row.visual.wheelProjection[0]), row.name).toBeLessThan(0.15);
        expect(row.visual.wheelProjection[1], row.name).toBeGreaterThan(-0.8);
        expect(row.visual.wheelProjection[1], row.name).toBeLessThan(0);
      }
      expect(row.image.length).toBeGreaterThan(10000);
    }
    await info.attach('p0-cockpit.json', {
      body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(report.sourceFramesUnchanged).toBe(true);
    expect(report.sourceEyeRetained).toBe(true);
    expect(report.glError).toBe(0);
    if (group === 'driving') {
      expect(report.rows.find((row) => row.name === 'kerb-contact')!.surface).toContain(2);
      expect(report.rows.find((row) => row.name === 'moving')!.speed).toBeGreaterThan(10);
    }
    if (group === 'controls') {
      const right = report.rows.find((row) => row.name === 'right-lock')!;
      expect(report.rows.find((row) => row.name === 'paused')!.camera).toEqual(right.camera);
    }
    if (group === 'weather') {
      expect(report.rows.find((row) => row.name === 'wet-night')!.rain).toBeGreaterThan(0);
      expect(report.rows.find((row) => row.name === 'pod-retained')!.camera.fov).toBeGreaterThan(
        report.calibration.verticalFov,
      );
    }
    expect(errors).toEqual([]);
  });
