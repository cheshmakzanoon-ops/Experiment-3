import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

test('berm line practice shows measured comparisons in the production HUD without hiding controls', async ({
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
  if (!('output' in output)) throw new Error('Missing production UI fixture');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing production UI fixture script');
  await page.setContent('<!doctype html><title>Motocross berm practice component review</title>');
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
      const hud = page.locator('.mx-ride-hud');
      for (const attempt of [0, 1]) {
        await page.evaluate((attempt) => {
          const start = 1 + attempt * 20,
            speed = attempt ? 18 : 14,
            line = attempt ? 'inside' : 'outside';
          const { length } = window.MotocrossInterface.sampleMotocrossBermPractice(
            -1,
            start,
            speed,
            { line },
          );
          for (let d = 1; d < length + 2; d += 2)
            window.MotocrossInterface.sampleMotocrossBermPractice(
              d,
              start + (d + 1) / speed,
              speed,
              { line },
            );
        }, attempt);
        await expect(hud).toContainText('BERM PRACTICE');
        await expect(hud).toContainText(attempt ? 'NEW PERSONAL BEST' : 'First timed run');
        await expect(hud).toContainText(attempt ? 'exit 65 km/h' : 'exit 50 km/h');
        const layout = await page.evaluate(() =>
          window.MotocrossInterface.measureMotocrossPractice(),
        );
        expect(layout.panel.x).toBeGreaterThanOrEqual(0);
        expect(layout.panel.right).toBeLessThanOrEqual(width + 1);
        expect(layout.panel.bottom).toBeLessThanOrEqual(801);
        expect(layout.panel.overflowX).toBeLessThanOrEqual(1);
        expect(layout.note.overflowX).toBeLessThanOrEqual(1);
        expect(layout.note.overflowY).toBeLessThanOrEqual(1);
        expect(layout.controls.some((control) => control.label === 'Pause session')).toBe(true);
        for (const control of layout.controls) {
          const a = layout.panel,
            b = control.rect;
          expect(
            a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y,
            `${control.label} is covered`,
          ).toBe(false);
        }
      }
      await info.attach(`${circuit}-berm-lines-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      for (const speed of [24, 10]) {
        await page.evaluate((speed) => {
          const start = speed === 24 ? 40 : 50;
          window.MotocrossInterface.sampleMotocrossBermPractice(-1, start, speed);
          for (let d = 1; d <= 7; d += 2)
            window.MotocrossInterface.sampleMotocrossBermPractice(
              d,
              start + (d + 1) / speed,
              speed,
              { line: 'outside' },
            );
        }, speed);
        await expect(hud).toContainText('LIVE · VS YOUR BEST');
        await expect(hud.locator('.mx-ride-main b')).toHaveText(
          speed === 24 ? '−0.10 S' : '+0.31 S',
        );
        const live = await page.evaluate(() =>
          window.MotocrossInterface.measureMotocrossPractice(),
        );
        expect(live.panel.x).toBeGreaterThanOrEqual(0);
        expect(live.panel.right).toBeLessThanOrEqual(width + 1);
        expect(live.panel.bottom).toBeLessThanOrEqual(801);
        expect(live.panel.overflowX).toBeLessThanOrEqual(1);
        expect(live.note.overflowX).toBeLessThanOrEqual(1);
        expect(live.note.overflowY).toBeLessThanOrEqual(1);
        for (const control of live.controls) {
          const a = live.panel,
            b = control.rect;
          expect(
            a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y,
            `${control.label} is covered by the live comparison`,
          ).toBe(false);
        }
        await info.attach(`${circuit}-live-${speed}-${width}.png`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossBermPractice(10, 51.1, 14, { caution: true }),
      );
      await expect(hud).toContainText('ROLL THE NEXT JUMP');
      await expect(hud).not.toContainText('BERM PRACTICE');
      for (const source of ['automatic', 'replay'] as const) {
        await page.evaluate(
          (source) =>
            window.MotocrossInterface.sampleMotocrossBermPractice(10, 51.2, 14, { [source]: true }),
          source,
        );
        await expect(hud).not.toContainText('BERM PRACTICE');
      }
    }
  }
  expect(errors).toEqual([]);
});
