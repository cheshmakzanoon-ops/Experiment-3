import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

test('linked MX sections display real practice-judge results and keep mobile controls clear', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-interface.ts'),
        name: 'MotocrossInterface',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing flow HUD fixture bundle');
  const script = output.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing flow HUD fixture script');
  await page.setContent('<!doctype html><title>Motocross linked-section component check</title>');
  for (const asset of output.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  await page.addScriptTag({ content: script.code });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      await page.evaluate(
        (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
        circuit,
      );
      await page.evaluate(() => document.fonts.ready);
      for (const section of [0, 1]) {
        for (const attempt of [0, 1]) {
          const result = await page.evaluate(
            ({ section, attempt }) => {
              const speed = attempt ? 20 : 16;
              const start = 1 + section * 120 + attempt * 50;
              const measure = window.MotocrossInterface.sampleMotocrossFlowPractice(
                section,
                -1,
                start,
                speed,
              );
              let linked = '';
              for (let distance = -0.5; distance <= measure.length + 1.5; distance += 0.5) {
                window.MotocrossInterface.sampleMotocrossFlowPractice(
                  section,
                  distance,
                  start + (distance + 1) / speed,
                  speed,
                );
                if (distance >= measure.firstSettled && !linked)
                  linked = document.querySelector('.mx-ride-hud')!.textContent ?? '';
              }
              return { ...measure, seconds: (measure.length / speed).toFixed(2), linked };
            },
            { section, attempt },
          );
          const panel = page.locator('.mx-ride-hud');
          expect(result.linked).toContain(`1/${result.count} LINKED`);
          await expect(panel).toContainText(result.name);
          await expect(panel).toContainText(attempt ? 'NEW PERSONAL BEST' : 'SECTION LINKED');
          await expect(panel).toContainText(`${result.count} CLEAN TARGETS`);
          await expect(panel).toContainText(`${result.seconds} S`);
          const boxes = await page.evaluate(() =>
            window.MotocrossInterface.measureMotocrossPractice(),
          );
          expect(boxes.panel.x).toBeGreaterThanOrEqual(0);
          expect(boxes.panel.right).toBeLessThanOrEqual(width + 1);
          expect(boxes.panel.overflowX).toBeLessThanOrEqual(1);
          expect(boxes.note.overflowY).toBeLessThanOrEqual(1);
          expect(boxes.note.overflowX).toBeLessThanOrEqual(1);
          for (const control of boxes.controls) {
            const a = boxes.panel,
              b = control.rect;
            expect(
              a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y,
              `${control.label} is covered`,
            ).toBe(false);
          }
          const name = `${circuit}-flow-${section + 1}-${attempt ? 'best' : 'first'}-${width}`;
          const imagePath = info.outputPath(`${name}.png`);
          await page.screenshot({ path: imagePath });
          await writeFile(
            info.outputPath(`${name}.json`),
            JSON.stringify({ result, boxes }, null, 2),
          );
          await info.attach(`${name}.png`, { path: imagePath, contentType: 'image/png' });
        }
      }
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossFlowPractice(1, 4, 200, 16, { caution: true }),
      );
      await expect(page.locator('.mx-ride-hud')).toContainText('ROLL THE NEXT JUMP');
      await expect(page.locator('.mx-ride-hud')).not.toContainText('SECTION LINKED');
    }
  }
  expect(errors).toEqual([]);
});
