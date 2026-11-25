import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type * as Fixture from './fixtures/engine-native-preview.ts';

type NativeWindow = Window & { EngineNativePreview: typeof Fixture };
let fixture: string;
let hostSource: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-preview.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativePreview',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
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
  if (!owner) throw new Error('GameApp declaration missing');
  const members = ['suspendOnBlur', 'suspendPlayback'].map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`GameApp.${name} missing`);
    return member.getText(source);
  });
  const blurCall = (name: 'addEventListener' | 'removeEventListener') => {
    let found: ts.CallExpression | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(source) === 'window' &&
        node.expression.name.text === name &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === 'blur'
      )
        found = node;
      ts.forEachChild(node, visit);
    };
    visit(owner);
    if (!found) throw new Error(`GameApp blur ${name} missing`);
    return found.getText(source);
  };
  hostSource = ts.transpileModule(
    `class PreviewHost {
      ${members.join('\n')}
      rumbleStops = 0;
      rumble = { stop: () => this.rumbleStops++ };
      interruptions = [];
      referenceSession = { interrupt: (reason) => this.interruptions.push(reason) };
      constructor(audio, state) {
        this.audio = audio;
        this.state = state;
        ${blurCall('addEventListener')};
      }
      releaseListener() { ${blurCall('removeEventListener')}; }
    }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_preview__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine preview audio</title>',
    }),
  );
  await page.goto('/__engine_native_preview__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native preview remains audible through the stopped race master', async ({ page }, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativePreview.freshPreview(),
  );
  expect(report.sampleRate).toBe(48000);
  expect(report.raceMasterGain).toBe(0);
  expect(report.signal.finite).toBe(true);
  expect(report.signal.peak).toBeLessThan(1);
  for (const tone of report.tones) expect(tone.rms).toBeGreaterThan(0.001);
  expect(report.tones[0].channelRms[0]).toBeGreaterThan(report.tones[0].channelRms[1] * 2);
  expect(report.tones[2].channelRms[1]).toBeGreaterThan(report.tones[2].channelRms[0] * 2);
  expect(report.tail.peak).toBeLessThan(1e-8);
  expect(errors).toEqual([]);
  await info.attach('native-preview-fresh.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

const cancellations = [
  { action: 'mute', state: 'menu' },
  { action: 'stop', state: 'menu' },
  { action: 'blur', state: 'menu' },
  { action: 'blur', state: 'paused' },
] as const;
for (const { action, state } of cancellations) {
  test(`native ${action} cancels future ${state} preview tones and permits a fresh preview`, async ({
    page,
  }, info) => {
    const errors = await load(page);
    const report = await page.evaluate(
      ({ action, state, source }) =>
        (window as unknown as NativeWindow).EngineNativePreview.cancelScheduled(
          action,
          state,
          source,
        ),
      { action, state, source: hostSource },
    );
    expect(report.cancelledAt).toBeGreaterThan(0.09);
    expect(report.cancelledAt).toBeLessThan(0.11);
    expect(report.freshAt).toBeGreaterThan(0.99);
    expect(report.freshAt).toBeLessThan(1.01);
    expect(report.signal.finite).toBe(true);
    expect(report.signal.peak).toBeLessThan(1);
    expect(report.beforeCancellation.rms).toBeGreaterThan(0.001);
    for (const future of report.cancelledFuture) expect(future.peak).toBeLessThan(1e-8);
    for (const fresh of report.freshTones) expect(fresh.rms).toBeGreaterThan(0.001);
    expect(report.tail.peak).toBeLessThan(1e-8);
    expect(report.raceMasterGain).toBe(0);
    if (action === 'blur') {
      expect(report.hostState).toBe(state);
      expect(report.rumbleStops).toBe(1);
      expect(report.interruptions).toEqual(['Playback suspended.']);
    }
    expect(errors).toEqual([]);
    await info.attach(`native-preview-${action}-${state}.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
  });
}

test('native pending preview cancellation renders silence and fresh replacement is byte-identical', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(
    (source) =>
      (window as unknown as NativeWindow).EngineNativePreview.pendingContinuations(source),
    hostSource,
  );
  expect(report.reference.rms).toBeGreaterThan(0.001);
  expect(report.results).toHaveLength(3);
  for (const result of report.results) {
    expect(result.staleScheduled).toBe(false);
    expect(result.cancelled.finite).toBe(true);
    expect(result.cancelled.peak).toBe(0);
    expect(result.replaced.finite).toBe(true);
    expect(result.replaced.rms).toBeGreaterThan(0.001);
    expect(result.differingSamples).toBe(0);
    expect(result.maxDifference).toBe(0);
  }
  expect(errors).toEqual([]);
  await info.attach('native-preview-pending-replacement.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native suspended-context resume cannot revive a muted then unmuted old request', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativePreview.pendingNativeResume(),
  );
  expect(report.before).toBe('suspended');
  expect(report.sampleRate).toBe(48000);
  expect(report.staleScheduled).toBe(false);
  expect(report.freshScheduled).toBe(true);
  expect(errors).toEqual([]);
  await info.attach('native-preview-live-resume.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});
