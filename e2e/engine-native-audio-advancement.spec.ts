import { expect, test, type Page } from '@playwright/test';
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-audio-advancement.ts';
import {
  ORIGINAL_AUDIO_SOURCE,
  ORIGINAL_LOUDNESS_SOURCE,
} from './fixtures/engine-native-audio-advancement-original.ts';

type NativeWindow = Window & {
  EngineNativeAudioAdvancement: typeof Fixture;
  OriginalEngineAudio: Fixture.OriginalAudio;
};
let fixture: string, original: string;
let provenance: Record<string, unknown>;
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const gitBlob = (bytes: string | Uint8Array) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(bytes)}\0`)
    .update(bytes)
    .digest('hex');

test.beforeAll(async () => {
  expect(sha256(ORIGINAL_LOUDNESS_SOURCE)).toBe(ORIGINAL_AUDIO_SOURCE.sha256);
  expect(gitBlob(ORIGINAL_LOUDNESS_SOURCE)).toBe(ORIGINAL_AUDIO_SOURCE.gitBlob);
  for (const input of ORIGINAL_AUDIO_SOURCE.unchanged) {
    const bytes = readFileSync(resolve(input.path));
    expect(sha256(bytes), `Original audio input changed: ${input.path}`).toBe(input.sha256);
    expect(gitBlob(bytes), `Original audio input changed: ${input.path}`).toBe(input.gitBlob);
  }
  const reference = await build({
    stdin: {
      contents: "export { EngineVoices } from './engine-voices.ts';",
      resolveDir: resolve('src/audio'),
      sourcefile: 'original-engine-voices-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    globalName: 'OriginalEngineAudio',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'actual-original-loudness-source',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/engine-loudness\.ts$/ }, () => ({
            path: ORIGINAL_AUDIO_SOURCE.path,
            namespace: 'original-audio',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'original-audio' }, () => ({
            contents: ORIGINAL_LOUDNESS_SOURCE,
            // Preserve the original text and resolve its imports at their
            // unchanged production location, without rewriting its arithmetic.
            resolveDir: resolve('src/audio'),
            loader: 'ts',
          }));
        },
      },
    ],
  });
  const sharedInputs = Object.keys(reference.metafile.inputs)
    .filter((path) => path.startsWith('src/') && !path.endsWith('/original-engine-voices-entry.ts'))
    .sort();
  expect(sharedInputs).toEqual(ORIGINAL_AUDIO_SOURCE.unchanged.map((input) => input.path));
  const current = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-audio-advancement.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeAudioAdvancement',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = current.outputFiles[0].text;
  original = reference.outputFiles[0].text;
  provenance = {
    original: ORIGINAL_AUDIO_SOURCE,
    currentLoudnessSha256: sha256(readFileSync(resolve('src/audio/engine-loudness.ts'))),
    esbuildVersion,
    sharedInputCount: sharedInputs.length,
    originalBundle: { bytes: Buffer.byteLength(original), sha256: sha256(original) },
    fixtureBundle: { bytes: Buffer.byteLength(fixture), sha256: sha256(fixture) },
  };
});

async function load(page: Page, reference = false) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_audio_advancement__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine audio advancement</title><button>Enable test audio</button>',
    }),
  );
  await page.goto('/__engine_native_audio_advancement__');
  await page.addScriptTag({ content: fixture });
  if (reference) await page.addScriptTag({ content: original });
  return errors;
}

type PcmComparison = Pick<
  Awaited<ReturnType<typeof Fixture.offlineParity>>['cases'][number],
  'withinContract' | 'perChannel' | 'suppliedInputs'
>;

function expectNativeContract(comparison: PcmComparison) {
  expect(comparison.suppliedInputs.events).toBeGreaterThan(0);
  expect(comparison.suppliedInputs.differences).toBe(0);
  expect(comparison.suppliedInputs.exact).toBe(true);
  expect(comparison.withinContract).toBe(true);
  expect(comparison.perChannel).toHaveLength(2);
  for (const channel of comparison.perChannel) {
    expect(channel.baseline.finite).toBe(true);
    expect(channel.current.finite).toBe(true);
    expect(channel.baseline.rms).toBeGreaterThan(0.001);
    expect(channel.current.rms).toBeGreaterThan(0.001);
    expect(channel.maxDifference).toBeLessThanOrEqual(channel.absoluteLimit);
    expect(channel.rmsDifference).toBeLessThanOrEqual(channel.rmsLimit);
    expect(channel.energyDifference).toBeLessThanOrEqual(channel.energyLimit);
  }
}

test('native engine inputs remain exact and mixed PCM meets its Float32 contract against original source', async ({
  page,
}, info) => {
  const errors = await load(page, true);
  const report = await page.evaluate(() => {
    const native = window as unknown as NativeWindow;
    return native.EngineNativeAudioAdvancement.offlineParity(native.OriginalEngineAudio);
  });
  await info.attach('native-audio-advancement-pcm.json', {
    body: JSON.stringify({ provenance, report }, null, 2),
    contentType: 'application/json',
  });
  expect(report.vehicles).toEqual(['apx01', 'tc1', 'eh3', 'gpr1']);
  expect(new Set(report.families).size).toBe(4);
  expect(report.cases).toHaveLength(4);
  expect(report.samplesPerImplementation).toBe(297216);
  expect(report.renders).toBe(13);
  expect(report.renderedSamples).toBe(1019520);
  expect(report.contract).toEqual({
    unitRoundoff: 2 ** -24,
    mixAdditions: 11,
    relativeBudget: (2 * 11 * 2 ** -24) / (1 - 11 * 2 ** -24),
  });
  expect(report.cases.map((item) => item.current.sampleRate)).toEqual([44100, 44100, 48000, 96000]);
  expect(report.cases.map((item) => item.numericCache)).toEqual([
    'cold module',
    'warm module',
    'warm module',
    'warm module',
  ]);
  for (const item of report.cases) {
    expectNativeContract(item);
    expect(item.current.suppliedInputs).toEqual(item.baseline.suppliedInputs);
    expect(item.current.trace).toEqual(item.baseline.trace);
    for (const render of [item.baseline, item.current]) {
      expect(render.state).toBe('closed');
      expect(render.channels).toBe(2);
      expect(render.frames).toBe(Math.round(report.seconds * render.sampleRate));
      expect(render.periodicWaves).toBe(13);
      expect(render.oscillators).toBe(13);
      expect(render.stopCounts).toEqual(Array(13).fill(1));
      expect(render.retainedVoices).toBe(0);
      expect(render.reusedWaveObjects).toBe(0);
      expect(render.signal.finite).toBe(true);
      expect(render.signal.peak).toBeGreaterThan(0.001);
      expect(render.signal.rms).toBeGreaterThan(0.001);
      expect(render.signal.stereoDifferences).toBeGreaterThan(0);
      expect(render.suppliedInputs.parameterValues).toBeGreaterThan(0);
      expect(render.suppliedInputs.automationEvents).toBeGreaterThan(0);
      expect(render.suppliedInputs.waveSelections).toBe(22);
      expect(render.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(render.trace).toHaveLength(4);
      expect(
        render.trace.every(
          (entry) => entry.spatial.map((voice) => voice.id).join(',') === '0,1,2,3',
        ),
      ).toBe(true);
    }
  }
  expect(report.cases[0].sameRateRepeat).toBeNull();
  for (const item of report.cases.slice(1)) {
    expect(item.sameRateRepeat).not.toBeNull();
    expectNativeContract(item.sameRateRepeat!.baseline);
    expectNativeContract(item.sameRateRepeat!.current);
  }
  expect(report.sensitivity.factor).toBe(1 + 2 ** -10);
  expect(report.sensitivity.sampleRate).toBe(44100);
  expect(report.sensitivity.suppliedInputs.exact).toBe(true);
  expect(report.sensitivity.withinContract).toBe(false);
  for (const channel of report.sensitivity.perChannel) {
    expect(channel.current.finite).toBe(true);
    expect(channel.maxDifference).toBeGreaterThan(channel.absoluteLimit * 100);
    expect(channel.relativeRmsDifference).toBeGreaterThan(report.contract.relativeBudget * 100);
  }
  expect(errors).toEqual([]);
});

test('native menu contexts release old cues across an abandoned resume and preserve their replacement', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.getByRole('button', { name: 'Enable test audio' }).click();
  const report = await page
    .evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeAudioAdvancement.cueSuspension(),
    )
    .catch(async (error: unknown) => {
      const diagnostic = await page.evaluate(() =>
        (window as unknown as NativeWindow).EngineNativeAudioAdvancement.cueSuspensionDiagnostics(),
      );
      await info.attach('native-audio-advancement-suspension.json', {
        body: JSON.stringify({ provenance, diagnostic, errors }, null, 2),
        contentType: 'application/json',
      });
      throw error;
    });
  const diagnostic = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeAudioAdvancement.cueSuspensionDiagnostics(),
  );
  await info.attach('native-audio-advancement-suspension.json', {
    body: JSON.stringify({ provenance, report, diagnostic }, null, 2),
    contentType: 'application/json',
  });
  expect(diagnostic?.failure).toBeNull();
  expect(diagnostic?.cleanupFailure).toBeNull();
  expect(report.activation).toBe(true);
  expect(report.sampleRates).toEqual([48000, 48000, 48000]);
  expect(report.created).toBe(3);
  expect(report.firstOwned).toBe(1);
  expect(report.secondOwned).toBe(1);
  expect(report.afterFirstSuspend.cues).toBe(0);
  expect(report.afterFirstSuspend.graph.closeRequests).toBe(1);
  expect(report.afterFirstSuspend.graph.disconnected).toBe(report.afterFirstSuspend.graph.nodes);
  expect(report.afterFirstSuspend.graph.sourceHandlers).toBe(0);
  expect(report.suspendedState).toBe('suspended');
  expect(report.afterPendingCue).toEqual(report.beforePendingCue);
  expect(report.pendingCueAccepted).toBe(false);
  expect(report.resumeWasPending).toBe(true);
  expect(report.ownerAfterSecondSuspend).toBe(-1);
  expect(report.controlledOldCallbacks).toBe(6);
  expect(report.controlledLateOldCallbacks).toBe(6);
  expect(report.replacementBefore.cues).toBe(1);
  expect(report.replacementBefore.graph.state).toBe('running');
  expect(report.replacementBefore.graph.sources).toBe(3);
  expect(report.replacementAfter).toEqual(report.replacementBefore);
  expect(report.afterOldCloses.map((context) => context.state)).toEqual([
    'closed',
    'closed',
    'running',
  ]);
  expect(report.afterOldCloses.map((context) => context.sources)).toEqual([3, 3, 3]);
  expect(report.ownerAfterOldCloses).toBe(2);
  expect(report.playedAfterOldCloses).toBe(3);
  expect(report.replacementDrained).toMatchObject({
    cues: 0,
    played: 3,
    owner: 2,
    nativeEnded: 3,
    graph: { state: 'running', sources: 3, closeRequests: 0, resumeRequests: 0, sourceHandlers: 0 },
  });
  expect(report.replacementAfterLateCallbacks).toEqual(report.replacementDrained);
  expect(report.replacementDrained.graph.disconnected).toBe(
    report.replacementDrained.graph.nodes - 3,
  );
  expect(report.afterReplacementEnded.map((context) => context.state)).toEqual([
    'closed',
    'closed',
    'running',
  ]);
  expect(report.afterReplacementEnded.map((context) => context.sources)).toEqual([3, 3, 3]);
  for (const snapshot of [report.afterOldCloses, report.afterReplacementEnded]) {
    expect(snapshot[1].resumeRequests).toBe(1);
    expect(snapshot[1].resumeOutcomes.length).toBeLessThanOrEqual(1);
    for (const context of snapshot.slice(0, 2)) {
      expect(context.closeRequests).toBe(1);
      expect(context.closeOutcomes).toEqual(['fulfilled']);
      expect(context.disconnected).toBe(context.nodes);
      expect(context.sourceHandlers).toBe(0);
    }
  }
  for (const status of Object.values(report.abandonedResume)) {
    expect(['pending', 'fulfilled', 'rejected']).toContain(status);
  }
  expect(report.deliberateFreshCue).toBe(true);
  expect(report.playedBeforeDispose).toBe(4);
  expect(report.playedAfterDispose).toBe(4);
  expect(report.finalCues).toBe(0);
  expect(report.finalOwner).toBe(-1);
  expect(report.final.map((context) => context.sources)).toEqual([3, 3, 5]);
  expect(report.final.map((context) => context.resumeRequests)).toEqual([0, 1, 0]);
  for (const context of report.final) {
    expect(context.state).toBe('closed');
    expect(context.closeRequests).toBe(1);
    expect(context.closeOutcomes).toEqual(['fulfilled']);
    expect(context.disconnected).toBe(context.nodes);
    expect(context.sourceHandlers).toBe(0);
  }
  expect(errors).toEqual([]);
});
