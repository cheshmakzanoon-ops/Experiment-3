import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';

async function loadPracticeFixture(page: Page) {
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
  if (!('output' in output)) throw new Error('Missing motocross UI fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing motocross UI fixture script');
  await page.setContent('<!doctype html><title>Motocross solo practice HUD review</title>');
  // Vite emits imported CSS separately from the IIFE. Use the production
  // stylesheet and embedded fonts so the layout assertion measures the game.
  for (const asset of output.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  await page.addScriptTag({ content: script.code });
}

test('solo landing targets, held-brake guidance and autopilot exclusion use the visible production HUD', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadPracticeFixture(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const total = circuit === 'valley-ridge-mx' ? 5 : 4;
      await page.evaluate(
        (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
        circuit,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.MotocrossInterface.remapMotocrossBodyControls());
      expect(
        await page.evaluate(() =>
          [...document.fonts].some(
            (font) => font.family.includes('Saira Variable') && font.status === 'loaded',
          ),
        ),
      ).toBe(true);
      const hud = page.locator('.mx-ride-hud');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('ground'));
      await expect(hud).toContainText(`TARGETS 0/${total}`);
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('air'));
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossPractice('flight', false, true),
      );
      await expect(hud).toContainText('RELEASE THE BRAKE');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('flight'));
      await expect(hud).not.toContainText('RELEASE THE BRAKE');
      await expect(hud).toContainText('U / J: shift weight');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('contact'));
      await expect(hud).toContainText('SETTLING');
      await expect(hud).not.toContainText('CLEAN LANDING');
      await expect(hud).not.toContainText('TARGET LANDED');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      await expect(hud).toContainText('TARGET LANDED');
      await expect(hud).toContainText(`1/${total} LANDING TARGETS`);
      const text = await hud.textContent();
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      expect(await hud.textContent()).toBe(text);
      // Watching earlier footage must not erase the live practice checklist.
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossPractice('ground', false, false, true),
      );
      await expect(hud).not.toContainText('LANDING TARGETS');
      await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('settled'));
      await expect(hud).toContainText(`TARGETS 1/${total}`);
      const layout = await hud.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, right: box.right, overflow: node.scrollWidth - node.clientWidth };
      });
      expect(layout.x).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      await info.attach(`${circuit}-practice-targets-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      for (const source of ['automatic', 'replay'] as const) {
        await page.evaluate(
          (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
          circuit,
        );
        for (const stage of ['ground', 'air', 'flight', 'contact', 'settled'] as const) {
          await page.evaluate(
            ({ stage, source }) =>
              window.MotocrossInterface.sampleMotocrossPractice(
                stage,
                source === 'automatic',
                true,
                source === 'replay',
              ),
            { stage, source },
          );
          await expect(hud).not.toContainText('RELEASE THE BRAKE');
          await expect(hud).not.toContainText('CLEAN IN A ROW');
        }
        await expect(hud).not.toContainText('TARGET LANDED');
        // The ordinary last-jump card temporarily replaces the approach
        // heading. Inspect the retained checklist after that card expires.
        await page.evaluate(() => window.MotocrossInterface.sampleMotocrossPractice('riding'));
        await expect(hud).toContainText(`TARGETS 0/${total}`);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('synthetic retry snapshots show measured placement and keep the longest practice note clear of controls', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadPracticeFixture(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      await page.evaluate(
        (circuit) => window.MotocrossInterface.mountMotocrossHud(circuit, 1, 'practice'),
        circuit,
      );
      await page.evaluate(() => document.fonts.ready);
      const hud = page.locator('.mx-ride-hud');
      const attempt = async (details: { timeOffset: number; miss: number; rough?: boolean }) => {
        // These explicit component samples isolate UI behavior. Real flight
        // trajectories and measured outcomes belong to the production rig.
        for (const stage of ['ground', 'air', 'flight', 'contact', 'settled'] as const)
          await page.evaluate(
            ({ stage, details }) =>
              window.MotocrossInterface.sampleMotocrossPractice(stage, false, false, false, {
                ...details,
                takeoffSpeed: 20,
                exitSpeed: 24,
              }),
            { stage, details },
          );
      };
      const checkLayout = async () => {
        const layout = await page.evaluate(() =>
          window.MotocrossInterface.measureMotocrossPractice(),
        );
        expect(layout.panel.x).toBeGreaterThanOrEqual(0);
        expect(layout.panel.right).toBeLessThanOrEqual(width + 1);
        expect(layout.panel.y).toBeGreaterThanOrEqual(0);
        expect(layout.panel.bottom).toBeLessThanOrEqual(801);
        expect(layout.panel.overflowX).toBeLessThanOrEqual(1);
        expect(layout.note.overflowX, layout.note.text).toBeLessThanOrEqual(1);
        expect(layout.note.overflowY, layout.note.text).toBeLessThanOrEqual(1);
        expect(layout.documentOverflowX).toBeLessThanOrEqual(1);
        expect(layout.note.lines.length).toBeGreaterThan(0);
        for (const line of layout.note.lines) {
          expect(line.x).toBeGreaterThanOrEqual(layout.note.x - 1);
          expect(line.right).toBeLessThanOrEqual(layout.note.right + 1);
          expect(line.y).toBeGreaterThanOrEqual(layout.note.y - 1);
          expect(line.bottom).toBeLessThanOrEqual(layout.note.bottom + 1);
        }
        expect(layout.controls.some((control) => control.label === 'Pause session')).toBe(true);
        if (width === 390)
          expect(
            layout.controls.some((control) => control.label === 'Move rider weight forward'),
          ).toBe(true);
        for (const control of layout.controls) {
          const a = layout.panel,
            b = control.rect;
          const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
          expect(overlaps, `${circuit} ${width}: retry note covers ${control.label}`).toBe(false);
        }
        return layout;
      };
      await attempt({ timeOffset: 0, miss: -4 });
      await expect(hud).toContainText('SHORT OF TARGET');
      await expect(hud).toContainText('4.0 M');
      await expect(hud).toContainText('Takeoff 72 km/h');
      await expect(hud).not.toContainText('Takeoff 86');
      await expect(hud).not.toContainText('CLOSER THIS TIME');
      await attempt({ timeOffset: 4, miss: -1.5 });
      await expect(hud).toContainText('CLOSER THIS TIME');
      await expect(hud).toContainText('1.5 M');
      await expect(hud).toContainText('2.5 m closer');
      await expect(hud).not.toContainText('TARGET LANDED');
      await checkLayout();
      await attempt({ timeOffset: 8, miss: 2.5 });
      await expect(hud).toContainText('PAST THE TARGET');
      await expect(hud).toContainText('2.5 M');
      await expect(hud).not.toContainText('CLOSER THIS TIME');
      await attempt({ timeOffset: 12, miss: -0.05, rough: true });
      await expect(hud).toContainText('<0.1 m short · rough contact');
      await expect(hud).toContainText('HARD LANDING');
      await expect(hud).not.toContainText('CLOSER THIS TIME');

      // Exercise every early-approach cue with the longer rough-contact
      // recall. Measure actual font line boxes and keep the longest production
      // note for a screenshot; no fixture-only padding, clipping or text.
      const recalls = [];
      for (const wet of [false, true])
        for (const approachPace of ['build', 'hold', 'ease'] as const) {
          await page.evaluate(
            (details) =>
              window.MotocrossInterface.sampleMotocrossPractice(
                'approach',
                false,
                false,
                false,
                details,
              ),
            { timeOffset: 12, wet, approachPace },
          );
          await expect(hud).toContainText('Last takeoff 72 km/h · <0.1 m short · rough contact');
          await expect(hud).toContainText('LIP ~');
          recalls.push({ wet, approachPace, layout: await checkLayout() });
        }
      const longest = recalls.reduce((a, b) =>
        b.layout.note.text.length > a.layout.note.text.length ? b : a,
      );
      await page.evaluate(
        (details) =>
          window.MotocrossInterface.sampleMotocrossPractice(
            'approach',
            false,
            false,
            false,
            details,
          ),
        { timeOffset: 12, wet: longest.wet, approachPace: longest.approachPace },
      );
      await expect(page.locator('.mx-ride-note')).toHaveText(longest.layout.note.text);
      await info.attach(`${circuit}-retry-longest-note-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.evaluate(() =>
        window.MotocrossInterface.sampleMotocrossPractice('approach', false, false, false, {
          timeOffset: 12.1,
          caution: true,
          wet: true,
          approachPace: 'build',
        }),
      );
      await expect(hud).toContainText('TRACK CAUTION');
      await expect(hud).toContainText('ROLL THE NEXT JUMP');
      await expect(hud).not.toContainText('Last takeoff');
      await expect(hud).not.toContainText('LIP ~');
      const caution = await checkLayout();
      await info.attach(`${circuit}-retry-layout-${width}.json`, {
        body: Buffer.from(
          JSON.stringify(
            { boundary: 'Synthetic DOM component samples', recalls, caution },
            null,
            2,
          ),
        ),
        contentType: 'application/json',
      });
    }
  }
  expect(errors).toEqual([]);
});
