import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type * as Fixture from './fixtures/motorcycle-presentation.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { SURFACE } from '../src/simulation/track.ts';

declare global {
  interface Window {
    MotorcycleHudFixture: typeof Fixture;
  }
}

async function mountMotorcycleHud(page: Page) {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motorcycle-presentation.ts'),
        name: 'MotorcycleHudFixture',
        formats: ['iife'],
      },
    },
  });
  const bundle = Array.isArray(built) ? built[0] : built;
  if (!('output' in bundle)) throw new Error('Missing motorcycle HUD bundle');
  const chunk = bundle.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing motorcycle HUD script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><title>Motorcycle interface layout verification</title>');
  await page.addStyleTag({
    content: await readFile('src/ui/style.css', 'utf8'),
  });
  for (const variant of ['normal', 'italic']) {
    const data = await readFile(
      `node_modules/@fontsource-variable/saira/files/saira-latin-wdth-${variant}.woff2`,
    );
    await page.addStyleTag({
      content: `@font-face{font-family:'Saira Variable';font-style:${variant};font-weight:100 900;font-stretch:50% 125%;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}`,
    });
  }
  await page.addScriptTag({ content: chunk.code });
  await page.evaluate(() => window.MotorcycleHudFixture.mountMotorcycleHud());
  return errors;
}

test('motorcycle HUD: responsive production layout, real tyre channels and bike/car restoration', async ({
  page,
}, info) => {
  const errors = await mountMotorcycleHud(page);
  await test.step('each presented motorcycle snapshot updates instruments without repeated calls', async () => {
    const samples = [
      { time: 20, speed: 25, gear: 2, rpm: 6100, lean: 0, displayLean: '0°' },
      {
        time: 21,
        speed: 40,
        gear: 3,
        rpm: 8300,
        lean: 0.4,
        displayLean: 'L 26°',
      },
      {
        time: 22,
        speed: 55,
        gear: 5,
        rpm: 11200,
        lean: -0.6,
        displayLean: 'R 39°',
      },
      {
        time: 23,
        speed: 65,
        gear: 6,
        rpm: 12600,
        lean: 0.1,
        displayLean: 'L 7°',
      },
    ];
    for (const sample of samples) {
      const shown = await page.evaluate((sample) => {
        window.MotorcycleHudFixture.showMotorcycleHud('gpr1', 'chase', false, sample);
        const text = (id: string) => document.getElementById(id)!.textContent;
        return {
          bike: document.getElementById('hud')!.dataset.bike,
          speed: text('speed'),
          gear: text('gear'),
          rpm: text('rpm'),
          lean: text('gpLean'),
        };
      }, sample);
      // Read immediately after that one update: no polling, repeated frames
      // or animation loop can bring an out-of-date panel into agreement.
      expect(shown).toEqual({
        bike: 'true',
        speed: String(Math.round(sample.speed * 3.6)),
        gear: String(sample.gear),
        rpm: String(sample.rpm),
        lean: sample.displayLean,
      });
    }
  });
  await test.step('car panels restore immediately, throttle close samples and refresh sparse snapshots', async () => {
    const showCar = (time: number, speed: number) =>
      page.evaluate(
        ({ time, speed }) => {
          window.MotorcycleHudFixture.showMotorcycleHud('apx01', 'chase', false, {
            time,
            speed,
            gear: 3,
          });
          return {
            bike: document.getElementById('hud')!.dataset.bike,
            speed: document.getElementById('speed')!.textContent,
          };
        },
        { time, speed },
      );
    // The four distinct bike frames above leave the next update outside the
    // normal car refresh slot, so the family transition must bypass it.
    expect(await showCar(24, 30)).toEqual({ bike: 'false', speed: '108' });
    // Closely spaced presentations retain the one-in-three DOM cadence.
    // Advancing seconds per sample here would instead represent a slow GPU,
    // which must not leave older telemetry on screen.
    expect(await showCar(24.01, 35)).toEqual({ bike: 'false', speed: '108' });
    expect(await showCar(24.02, 36)).toEqual({ bike: 'false', speed: '108' });
    expect(await showCar(24.03, 38)).toEqual({ bike: 'false', speed: '137' });
    expect(await showCar(24.03, 38)).toEqual({ bike: 'false', speed: '137' });
    expect(await showCar(25, 50)).toEqual({ bike: 'false', speed: '180' });
  });
  const measurements = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 960, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const scale of [1, 1.35]) {
      await page.evaluate((scale) => {
        document.documentElement.style.setProperty('--ui-scale', String(scale));
        window.MotorcycleHudFixture.showMotorcycleHud();
      }, scale);
      await expect(page.locator('#hud')).toHaveAttribute('data-bike', 'true');
      await expect(page.locator('#speed')).toHaveText('162');
      await expect(page.locator('#gear')).toHaveText('4');
      await expect(page.locator('#gpFrontTemp')).toHaveText('83°C');
      await expect(page.locator('#gpRearTemp')).toHaveText('96°C');
      await expect(page.locator('#gpRearBrake')).toHaveText('35%');
      await expect(page.locator('#gpCraft')).toBeVisible();
      await expect(page.locator('#gpAdvice')).not.toBeEmpty();
      await expect(page.locator('#battery')).toBeHidden();
      for (const id of ['speed', 'gear', 'rpm', 'fuel', 'gpLean', 'gpRearBrake'])
        await expect(page.locator(`#${id}`)).toBeVisible();
      const bounds = await page.locator('.instruments').evaluate((node) => {
        const b = node.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          width: b.width,
          scroll: node.scrollWidth,
          client: node.clientWidth,
        };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(viewport.width);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.height - 48);
      expect(bounds.top).toBeGreaterThan(viewport.height * 0.45);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
      measurements.push({ viewport, scale, bounds });
      if (scale === 1) {
        const path = info.outputPath(`motorcycle-hud-${viewport.width}.png`);
        await page.screenshot({ path });
        await info.attach(`motorcycle-hud-${viewport.width}.png`, {
          path,
          contentType: 'image/png',
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-scale', '1');
    window.MotorcycleHudFixture.showMotorcycleHud('gpr1', 'cockpit', true);
  });
  await expect(page.locator('#vehicleAlert')).toContainText('RIDER DOWN');
  await expect(page.locator('#mfdBattery')).toHaveText('—');
  await page.evaluate(() => window.MotorcycleHudFixture.showMotorcycleHud('gpr1', 'chase'));
  await expect(page.locator('#vehicleAlert')).toBeHidden();
  await page.evaluate(() => window.MotorcycleHudFixture.showGpCornerCase());
  await expect(page.locator('#gpCornerDistance')).toHaveText('80 M TO APEX');
  await expect(page.locator('#gpAction')).toHaveText('TRAIL BRAKING');
  await page.evaluate(() => window.MotorcycleHudFixture.showGpCornerCase(true));
  await expect(page.locator('#gpAction')).toHaveText('CORNER EXIT');
  await page.evaluate(() => window.MotorcycleHudFixture.showGpCornerCase());
  await expect(page.locator('#gpAction')).toHaveText('TRAIL BRAKING');
  await test.step('corner phases remain readable through a long exit and restore after a seek', async () => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 960, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [1, 1.35]) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--ui-scale', String(scale));
          window.MotorcycleHudFixture.showGpBendCase(-80);
        }, scale);
        const meter = page.locator('#gpCornerProgress');
        await expect(meter).toBeVisible();
        await expect(meter).toHaveAttribute('data-phase', 'entry');
        const entry = Number(await meter.getAttribute('aria-valuenow'));
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(0));
        await expect(meter).toHaveAttribute('data-phase', 'apex');
        await expect(meter).toHaveAttribute('aria-valuenow', '50');
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(85));
        await expect(page.locator('#gpCorner')).toHaveText('T1 · NORTH HOOK');
        await expect(page.locator('#gpAction')).toHaveText('HOLD YOUR LINE');
        await expect(meter).toHaveAttribute('data-phase', 'exit');
        const exit = await meter.getAttribute('aria-valuenow');
        expect(Number(exit)).toBeGreaterThan(66);
        expect(entry).toBeGreaterThan(0);
        expect(entry).toBeLessThan(34);
        const bounds = await page
          .locator('#gpCornerProgress, #gpAction, .instruments')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                scroll: node.scrollWidth,
                client: node.clientWidth,
              };
            }),
          );
        for (const bound of bounds) {
          expect(bound.left).toBeGreaterThanOrEqual(0);
          expect(bound.right).toBeLessThanOrEqual(viewport.width);
          expect(bound.top).toBeGreaterThan(viewport.height * 0.45);
          expect(bound.bottom).toBeLessThanOrEqual(viewport.height - 48);
          expect(bound.scroll).toBeLessThanOrEqual(bound.client + 1);
        }
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(-80));
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(85));
        await expect(meter).toHaveAttribute('aria-valuenow', exit!);
        await expect(page.locator('#gpAction')).toHaveText('HOLD YOUR LINE');
        const heldMutations = await page.evaluate(async () => {
          let mutations = 0;
          const observer = new MutationObserver((records) => {
            mutations += records.length;
          });
          observer.observe(document.getElementById('gpCornerProgress')!, {
            attributes: true,
            subtree: true,
          });
          window.MotorcycleHudFixture.showGpBendCase(85);
          window.MotorcycleHudFixture.showGpBendCase(85);
          await Promise.resolve();
          observer.disconnect();
          return mutations;
        });
        expect(heldMutations).toBe(0);
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(85, { brake: 0.3 }));
        await expect(page.locator('#gpAction')).toHaveText('TRAIL BRAKING');
        await page.evaluate(() => window.MotorcycleHudFixture.showGpBendCase(85, { lean: 0.15 }));
        await expect(page.locator('#gpAction')).toHaveText('DRIVE OUT');
        if (scale === 1) {
          const path = info.outputPath(`gp-corner-phase-${viewport.width}.png`);
          await page.screenshot({ path });
          await info.attach(`gp-corner-phase-${viewport.width}.png`, {
            path,
            contentType: 'image/png',
          });
        }
      }
    }
  });
  await test.step('wet contacts, thermal fade and corner-exit electronics explain the actual axle', async () => {
    const cases = [
      { sample: { frontSurface: SURFACE.KERB, frontWater: 0.2 }, action: 'FRONT ON WET KERB' },
      { sample: { rearSurface: SURFACE.PAINT, rearWater: 0.2 }, action: 'REAR ON WET PAINT' },
      { sample: { frontDisc: 1050 }, action: 'FRONT BRAKE HOT' },
      { sample: { intervention: 0.6 }, action: 'POWER LIMITED' },
      {
        sample: { frontSurface: SURFACE.GRASS, lateral: 15 },
        action: 'FRONT ON GRASS',
      },
      {
        sample: { frontSurface: SURFACE.KERB, frontWater: 0.2, flag: FLAG.YELLOW },
        action: 'CAUTION',
      },
    ];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 960, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [1, 1.35]) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--ui-scale', String(scale));
        }, scale);
        for (const { sample, action } of cases) {
          await page.evaluate(
            (sample) =>
              window.MotorcycleHudFixture.showMotorcycleHud('gpr1', 'chase', false, sample),
            sample,
          );
          await expect(page.locator('#gpAction')).toHaveText(action);
          await expect(page.locator('#gpCraft')).toHaveAttribute('data-tone', 'caution');
          await expect(page.locator('#gpTow')).toBeHidden();
          if (action === 'FRONT ON GRASS') {
            await expect(page.locator('#gpCorner')).toHaveText('BIKE CONTROL');
            await expect(page.locator('#gpCorner')).toHaveAttribute('aria-label', 'BIKE CONTROL');
            await expect(page.locator('#gpTurnArrow')).toHaveText('·');
            await expect(page.locator('#gpCornerDistance')).toHaveText('');
          }
          const bounds = await page.locator('#gpAction').evaluate((node) => {
            const b = node.getBoundingClientRect();
            return {
              left: b.left,
              right: b.right,
              scroll: node.scrollWidth,
              client: node.clientWidth,
            };
          });
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(viewport.width);
          expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((surface) => {
      document.documentElement.style.setProperty('--ui-scale', '1');
      window.MotorcycleHudFixture.showMotorcycleHud('gpr1', 'chase', false, {
        frontSurface: surface,
        frontWater: 0.2,
      });
    }, SURFACE.KERB);
    const path = info.outputPath('gp-wet-contact-feedback.png');
    await page.screenshot({ path });
    await info.attach('gp-wet-contact-feedback.png', { path, contentType: 'image/png' });
    await page.evaluate(() => window.MotorcycleHudFixture.showGpCornerCase());
    await expect(page.locator('#gpAction')).toHaveText('TRAIL BRAKING');
  });
  await page.locator('.vehicle-toggle').click();
  await expect(page.locator('#tires > div:visible')).toHaveCount(2);
  await expect(page.locator('#vehicleTab1')).toHaveText('FUEL');
  await expect(page.locator('#vehicleTab4')).toHaveText('RIDER');
  await page.locator('#vehicleTab4').click();
  await expect(page.locator('#mfdDiffCoast')).toHaveText('80%');
  const mfdPath = info.outputPath('motorcycle-mfd.png');
  await page.screenshot({ path: mfdPath });
  await info.attach('motorcycle-mfd.png', {
    path: mfdPath,
    contentType: 'image/png',
  });
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.instruments')!.getBoundingClientRect();
    const b = document.querySelector('.car-status')!.getBoundingClientRect();
    return (
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    );
  });
  expect(overlap).toBe(0);
  await page.evaluate(() => window.MotorcycleHudFixture.showMotorcycleHud('apx01'));
  await expect(page.locator('#hud')).toHaveAttribute('data-bike', 'false');
  await expect(page.locator('#battery')).toBeVisible();
  await expect(page.locator('#vehicleTab1')).toHaveText('ENERGY');
  await expect(page.locator('#vehicleTab4')).toHaveText('SETUP');
  await page.locator('#vehicleTab0').click();
  await expect(page.locator('#tires > div:visible')).toHaveCount(4);
  await expect(page.locator('#tires > div > label')).toHaveText(['FR', 'FL', 'RR', 'RL']);
  await page.evaluate(() => window.MotorcycleHudFixture.showMotorcycleMenu());
  await page.selectOption('#vehicle', 'gpr1');
  await expect(page.locator('.car-label')).toContainText('GP-R1');
  await expect(page.locator('#opponents option[value="3"]')).toHaveText('4 riders');
  expect(await page.evaluate(() => window.MotorcycleHudFixture.previewSelection())).toBe('gpr1');
  await page.selectOption('#vehicle', 'ss600');
  await expect(page.locator('.car-label')).toContainText('SUPERSPORT');
  await page.selectOption('#vehicle', 'apx01');
  await expect(page.locator('#opponents option[value="3"]')).toHaveText('4 cars');
  await expect(page.locator('.car-label')).toContainText('APX-01');
  await info.attach('layout-measurements.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('GP personal corner timing: responsive layout, raw-frame cadence and handoffs', async ({
  page,
}, info) => {
  const errors = await mountMotorcycleHud(page);
  const measurements: {
    viewport: { width: number; height: number };
    scale: number;
    bounds: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      scroll: number;
      client: number;
    };
  }[] = [];
  await test.step('personal corner attempts show measured improvements without obscuring the road', async () => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 960, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [1, 1.35]) {
        const length = await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--ui-scale', String(scale));
          return window.MotorcycleHudFixture.beginGpPractice();
        }, scale);
        await page.evaluate(() => window.MotorcycleHudFixture.showGpPracticeRun());
        await expect(page.locator('#gpPractice')).toBeVisible();
        await expect(page.locator('#gpPracticeLabel')).toHaveText('T1 · CORNER TIME');
        await expect(page.locator('#gpPracticeTime')).toHaveText(`${(length / 40).toFixed(2)} s`);
        await expect(page.locator('#gpPracticeDetail')).toHaveText(
          'First clean run · exit 144 km/h · dry',
        );
        await expect(page.locator('#gpPracticeStreak')).toHaveText('CLEAN STREAK 1 · BEST 1');
        if (viewport.height >= 680) await expect(page.locator('#gpPracticeStreak')).toBeVisible();
        else await expect(page.locator('#gpPracticeStreak')).toBeHidden();
        await page.evaluate(() => window.MotorcycleHudFixture.showGpPracticeRun(30, 50, false));
        await expect(page.locator('#gpPracticeLabel')).toHaveText('T1 · PRACTICE');
        await expect(page.locator('#gpPracticeDetail')).toHaveText(
          /^−\d+\.\d{2} s vs best · target \d+\.\d{2} s$/,
        );
        await expect(page.locator('#gpPracticeDetail')).toContainText(
          `target ${(length / 40).toFixed(2)} s`,
        );
        await page.evaluate(() => window.MotorcycleHudFixture.showGpPracticeRun(60, 50));
        await expect(page.locator('#gpPracticeLabel')).toHaveText('T1 · NEW BEST');
        await expect(page.locator('#gpPracticeTime')).toHaveText(`${(length / 50).toFixed(2)} s`);
        await expect(page.locator('#gpPractice')).toHaveAttribute('data-improved', 'true');
        await expect(page.locator('#gpPracticeDetail')).toContainText('exit 180 km/h (+36)');
        const bounds = await page.locator('.instruments').evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            scroll: node.scrollWidth,
            client: node.clientWidth,
          };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(viewport.width);
        expect(bounds.top).toBeGreaterThan(viewport.height * 0.45);
        expect(bounds.bottom).toBeLessThanOrEqual(viewport.height - 48);
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
        measurements.push({ viewport, scale, bounds });
        if (scale === 1) {
          const path = info.outputPath(`gp-corner-practice-${viewport.width}.png`);
          await page.screenshot({ path });
          await info.attach(`gp-corner-practice-${viewport.width}.png`, {
            path,
            contentType: 'image/png',
          });
        }
        for (const control of ['ai', 'replay'] as const) {
          await page.evaluate(
            (control) => window.MotorcycleHudFixture.showGpPracticeRun(90, 40, true, control),
            control,
          );
          await expect(page.locator('#gpPractice')).toBeHidden();
        }
        await page.evaluate(() => {
          window.MotorcycleHudFixture.restartGpPractice();
          window.MotorcycleHudFixture.showGpPracticeRun(1, 40);
        });
        await expect(page.locator('#gpPracticeDetail')).toHaveText(
          'First clean run · exit 144 km/h · dry',
        );
      }
    }
  });
  await test.step('raw corner timing is independent of real PresentedFrame cadence', async () => {
    const length = await page.evaluate(() => window.MotorcycleHudFixture.beginGpPractice());
    const cadences = [30, 48, 60, 90, 120, 144];
    for (let i = 0; i < cadences.length; i++) {
      const result = await page.evaluate(
        ({ hz, start }) => window.MotorcycleHudFixture.showGpPracticeCadence(hz, start),
        { hz: cadences[i], start: 1 + i * 10 },
      );
      expect(result.visible).toBe(true);
      expect(result.time).toBe(`${(length / 40).toFixed(2)} s`);
      expect(result.label).toBe('T1 · CORNER TIME');
      expect(result.detail).toBe(
        `${i === 0 ? 'First clean run' : '±0.00 s'} · exit 144 km/h · dry`,
      );
      if (cadences[i] < 60) expect(result.observations).toBeGreaterThan(result.presentations);
      if (cadences[i] > 60) expect(result.presentations).toBeGreaterThan(result.observations);
    }
  });
  await test.step('manual successive corners display a clean streak and preserve the session best through handoffs', async () => {
    await page.evaluate(() => {
      window.MotorcycleHudFixture.beginGpPractice();
      window.MotorcycleHudFixture.showGpPracticeStreak();
    });
    await expect(page.locator('#gpPracticeStreak')).toBeVisible();
    await expect(page.locator('#gpPracticeStreak')).toHaveText('CLEAN STREAK 3 · BEST 3');
    await page.evaluate(() => window.MotorcycleHudFixture.showGpPracticeRun(200, 40, true, 'ai'));
    await expect(page.locator('#gpPractice')).toBeHidden();
    await page.evaluate(() => window.MotorcycleHudFixture.showGpPracticeRun(300, 40));
    await expect(page.locator('#gpPracticeStreak')).toHaveText('CLEAN STREAK 1 · BEST 3');
    await page.evaluate(() => {
      window.MotorcycleHudFixture.restartGpPractice();
      window.MotorcycleHudFixture.showGpPracticeRun();
    });
    await expect(page.locator('#gpPracticeStreak')).toHaveText('CLEAN STREAK 1 · BEST 1');
  });
  await test.step('between-frame control and replay handoffs cancel partial attempts; pause retains them', async () => {
    for (const kind of ['ai', 'replay', 'pause'] as const) {
      await page.evaluate((kind) => window.MotorcycleHudFixture.showGpPracticeHandoff(kind), kind);
      if (kind === 'pause') {
        await expect(page.locator('#gpPractice')).toBeVisible();
        await expect(page.locator('#gpPracticeDetail')).toHaveText(
          'First clean run · exit 144 km/h · dry',
        );
      } else await expect(page.locator('#gpPractice')).toBeHidden();
    }
  });
  await info.attach('gp-corner-practice-diagnostics.json', {
    body: JSON.stringify({ measurements, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
