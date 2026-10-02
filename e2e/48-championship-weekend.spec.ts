import { finishRaceEntry } from './race-entry.ts';
import { test, expect, type Page } from '@playwright/test';
import { CHAMPIONSHIP_KEY, type Championship } from '../src/core/championship.ts';

async function diag(page: Page) {
  return page.evaluate(() => window.apexDiagnostics());
}
async function readSaved(page: Page, key: string) {
  return page.evaluate(async (k) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('apex-formula', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction('saved').objectStore('saved').get(k);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  }, key);
}

/** A complete championship weekend in the production build: qualifying sets
 * the grid, the race starts from it, and the classified result is scored and
 * saved. A two-car, one-lap calendar keeps the real-time sessions short. */
test('Championship weekend: qualifying grid, race and saved standings', async ({ page }, info) => {
  test.setTimeout(900000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const season: Championship = {
    version: 1,
    cars: 2,
    rounds: [
      { circuit: 'aurel', weather: 'clear', laps: 1 },
      { circuit: 'vellamar', weather: 'clear', laps: 1 },
    ],
    results: [],
  };
  await page.evaluate(
    async ({ key, value }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('apex-formula', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saved');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('saved', 'readwrite');
        tx.objectStore('saved').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { key: CHAMPIONSHIP_KEY, value: season },
  );
  // The application reads the save at boot.
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.getByRole('button', { name: 'CHAMPIONSHIP', exact: true }).click();
  await expect(page.locator('.championship-calendar li.next')).toContainText('AUREL');
  await page.getByRole('button', { name: 'START ROUND 1 · QUALIFYING', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 240000 }).toBe('driving');
  let d = await diag(page);
  expect(d.options).toMatchObject({ mode: 'qualifying', opponents: 1, circuit: 'aurel' });
  await expect(page.locator('#lapLabel')).toContainText('QUALIFYING');
  await page.keyboard.press('g');
  await expect.poll(async () => (await diag(page)).state, { timeout: 420000, intervals: [2000] }).toBe(
    'results',
  );
  await expect(page.locator('#modal')).toContainText('QUALIFYING / CLASSIFICATION');
  await page.screenshot({ path: info.outputPath('qualifying-classification.png') });
  await page.getByRole('button', { name: 'START RACE FROM THIS GRID', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await diag(page)).state, { timeout: 240000 }).toBe('driving');
  d = await diag(page);
  expect(d.options.mode).toBe('race');
  expect(d.options.grid).toHaveLength(2);
  expect([...d.options.grid!].sort()).toEqual([0, 1]);
  await page.keyboard.press('g');
  await expect.poll(async () => (await diag(page)).state, { timeout: 420000, intervals: [2000] }).toBe(
    'results',
  );
  await expect(page.locator('.championship-note')).toContainText('ROUND 1 OF 2');
  await expect(page.locator('.championship-note')).toContainText('PTS');
  await page.screenshot({ path: info.outputPath('race-classification.png') });
  const saved = (await readSaved(page, CHAMPIONSHIP_KEY)) as Championship;
  expect(saved.results).toHaveLength(1);
  expect(saved.results[0].grid).toEqual(d.options.grid);
  // The AI demonstration drove: the round is recorded as such, not hidden.
  expect(saved.results[0].demonstration).toBe(true);
  await page.getByRole('button', { name: 'STANDINGS', exact: true }).click();
  await expect(page.locator('.championship-calendar li.next')).toContainText('VELLAMAR');
  expect(errors).toEqual([]);
});

test('Session form: endurance distances, solo time trial and race limits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.selectOption('#mode', 'endurance');
  await expect(page.locator('#laps')).toHaveValue('15');
  await page.selectOption('#laps', '25');
  await page.selectOption('#mode', 'race');
  await expect(page.locator('#laps')).toHaveValue('10');
  await page.selectOption('#mode', 'time-trial');
  await expect(page.locator('#opponents')).toBeDisabled();
  await expect(page.locator('#laps')).toBeDisabled();
  await page.selectOption('#mode', 'qualifying');
  await expect(page.locator('#opponents')).toBeEnabled();
});
