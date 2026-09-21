import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/phase27g.ts';
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/phase27g.ts'), name: 'Phase27G', formats: ['iife'] },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) =>
      'output' in r ? r.output : [],
    ),
    chunk = chunks.find((c) => c.type === 'chunk' && c.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('No 27G component bundle');
  await page.setContent(
    '<!doctype html><title>Phase 27G production component evidence, not a full application</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  await page.addStyleTag({ path: resolve('src/ui/style.css') });
  return errors;
}
async function image(info: TestInfo, name: string, png: string) {
  await info.attach(name + '.png', {
    body: Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'),
    contentType: 'image/png',
  });
}
test('27G: original media uses real save captions, stable held poses, seek controls and explicit disposal', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.mountMedia(),
  );
  for (const time of [0, 8, 17, 24]) {
    const r = await page.evaluate(
      (t) => (window as unknown as { Phase27G: typeof Fixture }).Phase27G.mediaCapture(t),
      time,
    );
    expect(r.exact).toBe(true);
    expect(r.glError).toBe(0);
    expect(r.png.length).toBeGreaterThan(20000);
    expect(r.playing).toBe(false);
    await image(info, `original-briefing-${time}`, r.png);
  }
  for (const width of [320, 390, 720, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.team-media')).toBeVisible();
    expect(
      await page.locator('.team-media').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  }
  await page.locator('[data-media="play"]').click();
  await expect(page.locator('[data-media="play"]')).toHaveText('PAUSE');
  await page.locator('[data-media="play"]').click();
  await info.attach('briefing-ui.png', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => (window as unknown as { Phase27G: typeof Fixture }).Phase27G.cleanup());
  expect(await page.locator('canvas').count()).toBe(0);
  expect(errors).toEqual([]);
});
test('27G: UV guide pointer and keyboard controls change actual car texture without saving or moving other slots', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.mountPhoto(),
  );
  const before = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.photoState(),
  );
  const item = page.locator('[data-decal-id="1"]');
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  if (!box) throw new Error('No UV guide');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 5, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.photoState(),
  );
  expect(moved.livery.decals!.find((d) => d.id === 1)!.x).toBeGreaterThan(
    before.livery.decals![0].x,
  );
  expect(moved.livery.decals!.find((d) => d.id === 2)).toEqual(
    before.livery.decals!.find((d) => d.id === 2),
  );
  expect(moved.paintChanges).toBeGreaterThan(0);
  expect(moved.texture).not.toBe(before.texture);
  await page.locator('[data-decal-id="1"]').focus();
  await page.keyboard.press('ArrowRight');
  const key = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.photoState(),
  );
  expect(key.livery.decals!.find((d) => d.id === 1)!.x).toBeCloseTo(
    moved.livery.decals!.find((d) => d.id === 1)!.x + 0.01,
    8,
  );
  const second = await page.locator('[data-decal-id="1"]').boundingBox();
  if (!second) throw new Error('No selected decal');
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2 + 40, second.y + second.height / 2, {
    steps: 4,
  });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const cancelled = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.photoState(),
  );
  expect(cancelled.livery).toEqual(key.livery);
  await info.attach('direct-decal-ui.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => (window as unknown as { Phase27G: typeof Fixture }).Phase27G.cleanup());
  expect(errors).toEqual([]);
});
test('27G: day, sunset, overcast, rain and night are real distinct shader states with exact sunset restoration', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.skyModes(),
  );
  for (let i = 0; i < r.shots.length; i++) {
    const s = r.shots[i];
    await image(info, `sky-${i}-${s.mode}`, s.png);
    expect(s.opaque).toBe(480 * 270);
    expect(s.sum.every((n) => n > 0)).toBe(true);
  }
  expect(r.restored).toBe(true);
  expect(r.glError).toBe(0);
  expect(new Set(r.shots.slice(0, 5).map((s) => s.sum.join(','))).size).toBe(5);
  expect(errors).toEqual([]);
});
test('27G: live reference instructions stay readable without narrowing the hash/mobile gate', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.mountEvent(),
  );
  for (const width of [320, 390, 720, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('#modal').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
  }
  await expect(page.locator('#modal')).toContainText('does not move cars');
  await expect(page.locator('#modal')).toContainText('cockpit', { ignoreCase: true });
  await info.attach('wet-cockpit-event-ui.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});

test('27G: event evidence rejects real empty PNGs and wrong dimensions rather than hashing a blank approval', async ({
  page,
}) => {
  const errors = await load(page);
  const result = await page.evaluate(() =>
    (window as unknown as { Phase27G: typeof Fixture }).Phase27G.validatePNGEvidence(),
  );
  expect(result.rejected).toHaveLength(3);
  expect(result.rejected[0]).toContain('transparent');
  expect(result.rejected[1]).toContain('black');
  expect(result.rejected[2]).toContain('dimensions');
  expect(result.visible.opaque).toBe(576);
  expect(result.visible.nonblack).toBeGreaterThan(100);
  expect(result.visible.visualAccepted).toBe(false);
  expect(errors).toEqual([]);
});
