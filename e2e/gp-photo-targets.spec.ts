import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';
import type { PhotoStudio } from '../src/ui/photo-studio.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('photo controls follow the selected prototype or car in a mixed replay', async ({ page }) => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    define: fixtureDefine(),
    build: {
      write: false,
      lib: { entry: resolve('src/ui/photo-studio.ts'), name: 'PhotoControls', formats: ['iife'] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing photo controls output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing photo controls script');
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: chunk.code });
  await page.evaluate((livery) => {
    const { PhotoStudio: Studio } = (
      window as unknown as {
        PhotoControls: { PhotoStudio: typeof PhotoStudio };
      }
    ).PhotoControls;
    const studio = new Studio(document.body, {
      change() {},
      preview() {},
      async save() {},
      capture() {},
      close() {},
    });
    studio.open(livery, 3, [false, true, true]);
  }, DEFAULT_LIVERY);

  const target = page.locator('#photoTarget'),
    focus = page.locator('#photo-focusSubject');
  await focus.selectOption('2');
  await expect(focus.locator(':checked')).toHaveText('COCKPIT CONTROLS');
  await expect(page.locator('#photoLivery')).toBeVisible();
  await target.selectOption('1');
  await expect(target.locator(':checked')).toHaveText('RIDER 2');
  await expect(focus.locator(':checked')).toHaveText('DASHBOARD');
  await expect(page.locator('#photo-view option[value=pod]')).toHaveText('TAIL CAMERA');
  await expect(page.locator('#photoLivery')).toBeHidden();
  await target.selectOption('2');
  await expect(focus).toHaveValue('2');
  await target.selectOption('0');
  await expect(focus.locator(':checked')).toHaveText('COCKPIT CONTROLS');
  await expect(page.locator('#photo-view option[value=pod]')).toHaveText('POD CAMERA');
  await expect(page.locator('#photoLivery')).toBeVisible();
});
