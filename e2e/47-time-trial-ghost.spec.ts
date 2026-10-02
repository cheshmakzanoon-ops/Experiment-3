import { finishRaceEntry } from './race-entry.ts';
import { test, expect, type Page } from '@playwright/test';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { GHOST_FIELDS, GhostRecorder, ghostKey, type GhostLap } from '../src/core/ghost-lap.ts';

async function diag(page: Page) {
  return page.evaluate(() => window.apexDiagnostics());
}

/** A personal best driven through the production simulation by an external
 * controller writing player inputs (not the flagged AI demonstration). */
function recordPersonalBest(): GhostLap {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'time-trial', opponents: 0 });
  const recorder = new GhostRecorder({
    circuit: 'aurel',
    trackLength: sim.track.length,
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
  });
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  for (let tick = 0; tick < 120 * 240; tick++) {
    sim.ai[0].update(1 / 120, sim.track, sim.cars, sim.race);
    sim.step(1 / 120);
    if (tick % 2) continue;
    sim.writeFrame(frame);
    const lap = recorder.observe(frame, true);
    if (lap) return lap;
  }
  throw new Error('No valid lap recorded');
}

test('Time Trial: saved personal-best ghost is loaded, drawn and timed against the live lap', async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // A personal best 3% faster than the demonstration: the ghost pulls ahead.
  const recorded = recordPersonalBest();
  const ghost = { ...recorded, samples: recorded.samples.slice() };
  for (let i = 0; i < ghost.samples.length; i += GHOST_FIELDS) ghost.samples[i] *= 0.97;
  ghost.lapTime *= 0.97;
  ghost.sectors = [ghost.sectors[0] * 0.97, ghost.sectors[1] * 0.97, ghost.sectors[2] * 0.97];
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  // Store it exactly as the application does (IndexedDB structured clone).
  await page.evaluate(
    async ({ key, lap, samples }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('apex-formula', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saved');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('saved', 'readwrite');
        tx.objectStore('saved').put({ ...lap, samples: new Float32Array(samples) }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { key: ghostKey('aurel'), lap: { ...ghost, samples: [] }, samples: Array.from(ghost.samples) },
  );
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.selectOption('#circuit', 'aurel');
  await page.selectOption('#mode', 'time-trial');
  await expect(page.locator('#opponents')).toBeDisabled();
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await diag(page)).state, { timeout: 240000 }).toBe('driving');
  const start = await diag(page);
  expect(start.options.mode).toBe('time-trial');
  expect(start.options.opponents).toBe(0);
  expect(start.frame!.length).toBe(HEADER + CAR_STRIDE);
  expect(start.timeTrial.ghostLap).toBeCloseTo(ghost.lapTime, 3);
  await page.keyboard.press('g');
  // Across the line the ghost starts its lap, draws clear of the player's car
  // and the HUD times against it.
  await expect
    .poll(
      async () => {
        const d = await diag(page);
        return d.timeTrial.ghostVisible && d.frame![carBase(0) + F.LAP_TIME] > 12;
      },
      { timeout: 240000, intervals: [500] },
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('time-trial-ghost.png') });
  await expect(page.locator('#lapDeltaLabel')).toHaveText('DELTA TO PB');
  await expect(page.locator('#lapDelta')).toHaveText(/^[+-]\d+\.\d{3} S$/);
  await expect(page.locator('#lapLabel')).toContainText('TIME TRIAL');
  const minutes = Math.floor(ghost.lapTime / 60);
  await expect(page.locator('#bestLap')).toContainText(`${minutes}:`);
  const d = await diag(page);
  // Same line, 3% slower than the ghost: the player is behind by a few tenths
  // to a few seconds, never ahead.
  expect(d.timeTrial.delta).toBeGreaterThan(0.1);
  expect(d.timeTrial.delta).toBeLessThan(5);
  expect(errors).toEqual([]);
});
