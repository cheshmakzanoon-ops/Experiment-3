import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type * as Fixture from './fixtures/engine-native-input.ts';

type NativeWindow = Window & { EngineNativeInput: typeof Fixture };
let fixture: string;
let worker: string;
let host: string;

function productionHost() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(resolve('src/main.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  );
  if (!owner) throw new Error('Missing production GameApp');
  const methods = ['pause', 'resume'].map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing GameApp.${name}`);
    return member.getText(source);
  });
  const assignments: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(source) === 'this.inputPump' &&
      ts.isNewExpression(node.right)
    )
      assignments.push(node);
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (assignments.length !== 1) throw new Error('Expected one production InputPump assignment');
  return ts.transpileModule(
    `class Host { ${methods.join('\n')} install() { ${assignments[0].getText(source)}; } }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
}

test.beforeAll(async () => {
  async function bundle(path: string, globalName?: string) {
    const result = await build({
      entryPoints: [resolve(path)],
      bundle: true,
      write: false,
      format: 'iife',
      globalName,
      platform: 'browser',
      target: 'es2022',
    });
    return result.outputFiles[0].text;
  }
  fixture = await bundle('e2e/fixtures/engine-native-input.ts', 'EngineNativeInput');
  worker = await bundle('e2e/fixtures/engine-native-input.worker.ts');
  host = productionHost();
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_input__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine keyboard</title><div id="drive" tabindex="0">Driving focus</div><input id="widget" aria-label="Settings field"><iframe id="focus-target" title="Separate native focus" srcdoc="<input aria-label=\'Child field\'>"></iframe>',
    }),
  );
  await page.goto('/__engine_native_input__');
  await page.addScriptTag({ content: fixture });
  const boot = await page.evaluate(
    ({ worker, host }) => (window as unknown as NativeWindow).EngineNativeInput.open(worker, host),
    { worker, host },
  );
  await page.locator('#drive').click();
  expect(boot.automaticSamples).toBe(0);
  return { errors, bindings: boot.bindings };
}
const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as NativeWindow).EngineNativeInput.snapshot());
const poll = (page: Page, count: number) =>
  page.evaluate(
    (count) => (window as unknown as NativeWindow).EngineNativeInput.poll(count),
    count,
  );
const advance = (page: Page, count: number) =>
  page.evaluate(
    (count) => (window as unknown as NativeWindow).EngineNativeInput.advance(count),
    count,
  );

test.afterEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as NativeWindow).EngineNativeInput?.close());
});

test('trusted keyboard edges retain order through the production pump and actual circuit worker', async ({
  page,
}, info) => {
  const { errors, bindings } = await load(page);
  await page.keyboard.press(bindings.shiftUp);
  await page.keyboard.press(bindings.shiftUp);
  await page.keyboard.press(bindings.shiftDown);
  await page.keyboard.down(bindings.throttle);
  expect((await snapshot(page)).samples).toBe(0);
  const first = await poll(page, 1);
  expect(first.sent).toHaveLength(1);
  expect(first.sent[0]).toMatchObject({ shift: 1, throttle: 1, brake: 0 });
  expect(first.staged.shift).toBe(0);
  await page.keyboard.press(bindings.shiftDown);
  await page.keyboard.press(bindings.shiftUp);
  await page.keyboard.up(bindings.throttle);
  await page.keyboard.down(bindings.brake);
  const delivered = await poll(page, 5);
  expect(delivered.sent.map((input) => input.shift)).toEqual([1, 1, -1, -1, 1, 0]);
  expect(delivered.sent.slice(1).every((input) => input.throttle === 0 && input.brake === 1)).toBe(
    true,
  );
  const applied = await advance(page, 8);
  expect(applied.map((entry) => entry.input.shift)).toEqual([1, 1, -1, -1, 1, 0, 0, 0]);
  expect(applied.every((entry) => entry.input.throttle === 0 && entry.input.brake === 1)).toBe(
    true,
  );
  expect(applied.map((entry) => entry.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(delivered.keys.every((key) => key.trusted)).toBe(true);
  expect(
    delivered.keys
      .filter(
        (key) =>
          key.type === 'keydown' && [bindings.shiftUp, bindings.shiftDown].includes(key.code),
      )
      .every((key) => key.prevented),
  ).toBe(true);
  expect((await snapshot(page)).errors).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('native-input-order.json', {
    body: JSON.stringify({ delivered, applied }, null, 2),
    contentType: 'application/json',
  });
});

test('native focus loss clears both queued owners and a held repeat cannot create a resumed shift', async ({
  page,
}, info) => {
  const { errors, bindings } = await load(page);
  await page.keyboard.press(bindings.shiftUp);
  await page.keyboard.press(bindings.shiftDown);
  await poll(page, 2); // Both messages are queued in the native worker, before any tick.
  await page.keyboard.down(bindings.shiftUp);
  await page.keyboard.down(bindings.throttle);
  await page.frameLocator('#focus-target').getByRole('textbox').click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('paused');
  const paused = await poll(page, 2);
  expect(paused.actions).toContain('blur');
  expect(paused.blurTrust).toEqual([true]);
  expect(paused.staged).toMatchObject({ shift: 0, throttle: 0, brake: 0 });
  expect(paused.sent).toHaveLength(2);
  expect(await advance(page, 12)).toEqual([]);
  await page.locator('#drive').click();
  await page.evaluate(() => (window as unknown as NativeWindow).EngineNativeInput.resume());
  await page.keyboard.down(bindings.shiftUp); // Chromium reports a held-key repeat.
  await page.keyboard.down(bindings.throttle);
  const held = await poll(page, 1);
  expect(held.sent.at(-1)).toMatchObject({ shift: 0, throttle: 0 });
  const repeats = held.keys.filter((key) => key.type === 'keydown' && key.repeat);
  expect(repeats.map((key) => key.code)).toEqual([bindings.shiftUp, bindings.throttle]);
  expect(repeats.every((key) => key.trusted)).toBe(true);
  expect((await advance(page, 2)).map((entry) => entry.input.shift)).toEqual([0, 0]);
  await page.keyboard.up(bindings.shiftUp);
  await page.keyboard.up(bindings.throttle);
  await page.keyboard.press(bindings.shiftDown);
  await page.keyboard.down(bindings.throttle);
  const fresh = await poll(page, 1);
  expect(fresh.sent.at(-1)).toMatchObject({ shift: -1, throttle: 1 });
  const applied = await advance(page, 2);
  expect(applied.map((entry) => entry.input.shift)).toEqual([0, 0, -1, 0]);
  expect(applied.slice(2).every((entry) => entry.input.throttle === 1)).toBe(true);
  expect(fresh.errors).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('native-input-focus.json', {
    body: JSON.stringify({ paused, held, fresh, applied }, null, 2),
    contentType: 'application/json',
  });
});

test('native widget ownership and repeated keydowns do not manufacture shift intent', async ({
  page,
}, info) => {
  const { errors, bindings } = await load(page);
  await page.locator('#widget').click();
  await page.keyboard.press(bindings.shiftUp);
  await page.keyboard.press(bindings.shiftDown);
  await expect(page.locator('#widget')).toHaveValue('][');
  const widget = await poll(page, 1);
  expect(widget.sent[0].shift).toBe(0);
  expect(
    widget.keys
      .filter((key) => key.type === 'keydown')
      .every((key) => !key.prevented && key.trusted),
  ).toBe(true);
  await page.locator('#drive').click();
  await page.keyboard.down(bindings.shiftUp);
  await page.keyboard.down(bindings.shiftUp);
  await page.keyboard.down(bindings.shiftUp);
  await page.keyboard.up(bindings.shiftUp);
  await page.keyboard.press(bindings.shiftDown);
  const delivered = await poll(page, 4);
  expect(delivered.sent.map((input) => input.shift)).toEqual([0, 1, -1, 0, 0]);
  expect(delivered.keys.filter((key) => key.repeat)).toHaveLength(2);
  const applied = await advance(page, 4);
  expect(applied.map((entry) => entry.input.shift)).toEqual([1, -1, 0, 0]);
  expect(delivered.errors).toEqual([]);
  expect(errors).toEqual([]);
  const closed = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeInput.close(),
  );
  await page.keyboard.press(bindings.shiftUp);
  expect(await snapshot(page)).toEqual(closed);
  expect(closed?.closed).toBe(true);
  await info.attach('native-input-widget-repeat.json', {
    body: JSON.stringify({ delivered, applied, closed }, null, 2),
    contentType: 'application/json',
  });
});
