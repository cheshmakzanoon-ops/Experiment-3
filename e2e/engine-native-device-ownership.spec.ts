import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-device-ownership.ts';

type NativeWindow = Window & { EngineNativeDeviceOwnership: typeof Fixture };
let fixture: string;
test.beforeAll(async () => {
  const bundled = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-device-ownership.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeDeviceOwnership',
    platform: 'browser',
    target: 'es2022',
    loader: { '.css': 'text', '.woff': 'dataurl', '.woff2': 'dataurl' },
  });
  fixture = bundled.outputFiles[0].text;
});
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_device_ownership__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Native device ownership</title>
    <style>body{margin:24px;font:16px sans-serif}button{padding:8px;margin:6px}
      #menuFocus,#creditFocus{padding:12px}dialog{width:520px;max-height:85vh}
      .credits-list{height:140px;overflow:auto;scroll-behavior:auto;border:1px solid black}
      .scroll-space{height:700px}iframe{display:block;width:360px;height:70px;margin:12px}
    </style><main id="root" data-mode="menu"><section id="menu"><div class="menu-body">
      <div id="menuFocus" tabindex="0">Menu focus</div>
      <form id="sessionForm"><input aria-label="Valid entry" required value="ready">
        <button id="launch" class="enter primary" type="submit">Launch entry</button></form>
      <button id="openCredits" data-action="openCredits">Open credits fixture</button>
    </div></section><dialog id="modal"><div id="modalContent"></div></dialog></main>
    <iframe id="outside-focus" title="Outside child focus" srcdoc="<input aria-label='Outside field'>"></iframe>`,
    }),
  );
  await page.goto('/__engine_native_device_ownership__');
  await page.locator('#menuFocus').click();
  await page.addScriptTag({ content: fixture });
  const boot = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeDeviceOwnership.open(),
  );
  expect(boot.focused).toBe(true);
  expect(boot.pendingRafs).toBe(1);
  expect(boot.ownedListeners).toBe(8);
  return errors;
}
const checkpoint = (page: Page, label: string) =>
  page.evaluate(
    (label) => (window as unknown as NativeWindow).EngineNativeDeviceOwnership.checkpoint(label),
    label,
  );
const sample = (page: Page, value: Fixture.PadSample) =>
  page.evaluate(
    (value) => (window as unknown as NativeWindow).EngineNativeDeviceOwnership.sample(value),
    value,
  );
async function attach(page: Page, info: TestInfo, name: string, errors: string[]) {
  const report = await page
    .evaluate(() => (window as unknown as NativeWindow).EngineNativeDeviceOwnership?.report())
    .catch((error) => ({ captureError: String(error) }));
  await info.attach(name, {
    body: JSON.stringify({ report, errors }, null, 2),
    contentType: 'application/json',
  });
}
test.afterEach(async ({ page }) => {
  await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeDeviceOwnership?.close(),
  );
});

test('native focus and controller replacement suppress held credits input, then hand fresh Start to the menu', async ({
  page,
}, info) => {
  const errors = await load(page);
  try {
    await page.locator('#openCredits').click();
    const opened = await checkpoint(page, 'credits opened through native button');
    expect(opened.modalOpen).toBe(true);
    expect(opened.pendingRafs).toBe(2);
    expect(opened.ownedListeners).toBe(14);
    expect(opened.scrollTop).toBe(0);

    await page.frameLocator('#focus-target').getByRole('textbox').click();
    const blurred = await sample(page, {
      buttons: [0, 1, 9, 13],
      axisY: 0.8,
      label: 'held input while child owns focus',
    });
    expect(blurred.focusEvents.some((event) => event.type === 'blur' && event.trusted)).toBe(true);
    expect(blurred).toMatchObject({
      modalOpen: true,
      closeRequests: 0,
      creditActions: 0,
      scrollTop: 0,
    });
    await page.locator('#creditFocus').click();
    await page.locator('#creditAction').focus();
    const returned = await checkpoint(page, 'same held input after native focus return');
    expect(returned.focusEvents.some((event) => event.type === 'focus' && event.trusted)).toBe(
      true,
    );
    expect(returned).toMatchObject({
      modalOpen: true,
      closeRequests: 0,
      creditActions: 0,
      scrollTop: 0,
    });

    await sample(page, { buttons: [], label: 'neutral after focus return' });
    const activated = await sample(page, { buttons: [0], label: 'fresh credits A' });
    expect(activated.creditActions).toBe(1);
    expect(activated.clicks.filter((event) => event.target === 'creditAction')).toEqual([
      { target: 'creditAction', trusted: false, owner: 'credits-1' },
    ]);
    await sample(page, { buttons: [], label: 'neutral before scrolling' });
    const scrolling = await sample(page, { buttons: [13], label: 'fresh down scroll' });
    expect(scrolling.scrollTop).toBeGreaterThan(0);
    const stationary = await sample(page, { buttons: [], label: 'neutral after scrolling' });
    const replacement = await sample(page, {
      id: 'scripted controller B',
      buttons: [0, 1, 9, 13],
      axisY: 0.8,
      label: 'replacement controller with held actions and navigation',
    });
    expect(replacement).toMatchObject({
      modalOpen: true,
      closeRequests: 0,
      creditActions: 1,
      scrollTop: stationary.scrollTop,
    });
    expect(replacement.submits).toEqual([]);

    await sample(page, { buttons: [], label: 'replacement controller neutral' });
    const closedCredits = await sample(page, { buttons: [9], label: 'fresh Start closes credits' });
    expect(closedCredits).toMatchObject({
      modalOpen: false,
      closeRequests: 1,
      pendingRafs: 1,
      ownedListeners: 8,
    });
    expect(closedCredits.owners['credits-1']).toMatchObject({ pending: 0, listeners: 0 });
    const heldMenu = await sample(page, { buttons: [9], label: 'held Start on restored menu' });
    expect(heldMenu.submits).toEqual([]);
    await sample(page, { buttons: [], label: 'menu neutral' });
    const submitted = await sample(page, { buttons: [9], label: 'fresh menu Start' });
    expect(submitted.submits).toEqual([
      { submitter: 'launch', constructor: 'SubmitEvent', prevented: true },
    ]);

    const disposed = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.disposeOwners(),
    );
    expect(disposed).toMatchObject({ disposed: true, pendingRafs: 0, ownedListeners: 0 });
    await page.frameLocator('#outside-focus').getByRole('textbox').click();
    await page.locator('#menuFocus').click();
    await page.keyboard.press('ArrowDown');
    const late = await sample(page, {
      buttons: [0, 1, 9, 13],
      axisY: 1,
      label: 'late input and focus after disposal',
    });
    expect(late).toMatchObject({
      pendingRafs: 0,
      ownedListeners: 0,
      closeRequests: 1,
      creditActions: 1,
      padMarker: 'retained-after-dispose',
    });
    expect(late.submits).toEqual(submitted.submits);
    expect(late.gamepadReads).toBe(disposed.gamepadReads);
    for (const owner of Object.values(late.owners))
      expect(owner).toMatchObject({
        maxPending: 1,
        duplicateTimestamps: 0,
        scheduledAfterRelease: 0,
        deliveredAfterRelease: 0,
        released: true,
        pending: 0,
        listeners: 0,
      });
    expect(errors).toEqual([]);
    const cleaned = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.close(),
    );
    expect(cleaned).toMatchObject({
      restored: true,
      nativeApisRestored: true,
      pendingRafs: 0,
      ownedListeners: 0,
    });
  } finally {
    await attach(page, info, 'native-device-focus-ownership.json', errors);
  }
});

test('native modal replacement and reentrant credits replacement establish separate input and RAF owners', async ({
  page,
}, info) => {
  const errors = await load(page);
  try {
    await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.showReplacementSheet(),
    );
    const changed = await sample(page, {
      buttons: [0, 1, 9],
      label: 'A replaces content while B and Start are also pressed',
    });
    expect(changed).toMatchObject({
      modalOpen: true,
      contentReplacements: 1,
      secondActions: 0,
      closeRequests: 0,
      activeElement: 'secondAction',
      pendingRafs: 1,
      ownedListeners: 8,
    });
    const retained = await sample(page, {
      buttons: [0, 1, 9],
      label: 'held actions in replacement content',
    });
    expect(retained).toMatchObject({ secondActions: 0, closeRequests: 0, modalOpen: true });
    await sample(page, { buttons: [], label: 'replacement content neutral' });
    const fresh = await sample(page, { buttons: [0], label: 'fresh A reaches second content' });
    expect(fresh.secondActions).toBe(1);
    await sample(page, { buttons: [], label: 'neutral before credits owner' });

    await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.showCredits(true),
    );
    await page.locator('#creditAction').focus();
    const replaced = await sample(page, {
      buttons: [0],
      label: 'A replaces its own credits owner',
    });
    expect(replaced).toMatchObject({
      modalOpen: true,
      creditActions: 1,
      creditGeneration: 2,
      closeRequests: 0,
      pendingRafs: 2,
      ownedListeners: 14,
    });
    expect(replaced.owners['credits-1']).toMatchObject({ pending: 0, listeners: 0 });
    expect(replaced.owners['credits-2']).toMatchObject({ pending: 1, listeners: 6 });
    const held = await sample(page, {
      buttons: [0],
      label: 'held A belongs to neither old nor replacement activation',
    });
    expect(held.creditActions).toBe(1);
    await sample(page, { buttons: [], label: 'replacement credits neutral' });
    const deliberate = await sample(page, {
      buttons: [0],
      label: 'fresh A reaches replacement credits',
    });
    expect(deliberate.creditActions).toBe(2);
    await sample(page, { buttons: [], label: 'neutral before B close' });
    const closed = await sample(page, {
      buttons: [1],
      label: 'fresh B closes replacement credits',
    });
    expect(closed).toMatchObject({
      modalOpen: false,
      closeRequests: 1,
      pendingRafs: 1,
      ownedListeners: 8,
    });
    const first = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.disposeOwners(),
    );
    const second = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.disposeOwners(),
    );
    expect(second).toEqual(first);
    const later = await checkpoint(page, 'native frames after all owners are disposed');
    expect(later.gamepadReads).toBe(first.gamepadReads);
    expect(later).toMatchObject({ pendingRafs: 0, ownedListeners: 0 });
    for (const owner of Object.values(later.owners))
      expect(owner).toMatchObject({
        maxPending: 1,
        duplicateTimestamps: 0,
        scheduledAfterRelease: 0,
        deliveredAfterRelease: 0,
        released: true,
        pending: 0,
        listeners: 0,
      });
    expect(errors).toEqual([]);
    const cleaned = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeDeviceOwnership.close(),
    );
    expect(cleaned).toMatchObject({
      restored: true,
      nativeApisRestored: true,
      pendingRafs: 0,
      ownedListeners: 0,
    });
  } finally {
    await attach(page, info, 'native-device-content-ownership.json', errors);
  }
});
