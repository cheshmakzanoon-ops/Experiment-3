import { describe, expect, it } from 'vitest';
import {
  SubmissionObservation,
  type SubmissionCapture,
} from '../src/engine/babylon/submission-observation.ts';
import type { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { readFileSync } from 'node:fs';
const capture = (): SubmissionCapture => ({
  rendererNowMs: 100,
  timeOriginMs: 1000,
  componentEpoch: 1,
  sceneEpoch: 1,
  paused: true,
  tick: 30,
  throttle: 0,
  speed: 2,
  readyBefore: true,
  readyAfter: true,
  preparationStage: 'surface',
  requested: false,
  preparationCount: 1,
  wheelPhase: null,
});
const graphics = (sequence = 1) =>
  ({
    submitted: sequence,
    phase: 'waiting',
    lost: false,
    disposed: false,
    losses: 0,
    queue: { pending: true, failure: null },
  }) as ReturnType<BabylonPresentationGpu['diagnostics']>;
describe('opt-in CPU submission observations', () => {
  it('does not record until explicitly enabled', () => {
    const log = new SubmissionObservation();
    log.record(capture(), 0, graphics());
    expect(log.snapshot(1, 1, 0).records).toEqual([]);
    expect(log.snapshot(1, 1, 0).enabled).toBe(false);
  });
  it('retains only eight actual submissions as detached scalars', () => {
    const log = new SubmissionObservation();
    log.enabled = true;
    const sample = capture();
    for (let i = 1; i <= 12; i++) log.record(sample, i - 1, graphics(i));
    sample.tick = 999;
    const snapshot = log.snapshot(1, 1, 0);
    expect(snapshot.records.map((r) => r.sequence)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(snapshot.records.every((r) => r.tick === 30)).toBe(true);
    snapshot.records[0].tick = 777;
    expect(log.snapshot(1, 1, 0).records[0].tick).toBe(30);
  });
  it('rejects skipped callbacks, stale sequences and unhealthy/non-submissions', () => {
    const log = new SubmissionObservation();
    log.enabled = true;
    log.record(null, 0, graphics());
    log.record(capture(), 1, graphics());
    for (const change of [
      { phase: 'idle' },
      { phase: 'failed' },
      { lost: true },
      { disposed: true },
      { queue: { pending: false, failure: null } },
      { queue: { pending: true, failure: '' } },
    ]) {
      log.record(capture(), 0, { ...graphics(), ...change } as ReturnType<
        BabylonPresentationGpu['diagnostics']
      >);
    }
    expect(log.snapshot(1, 1, 0).records).toEqual([]);
    log.record(capture(), 0, graphics());
    log.record(capture(), 0, graphics());
    expect(log.snapshot(1, 1, 0).records).toHaveLength(1);
  });
  it('labels component replacement independently of scene replacement and keeps pre-loss facts', () => {
    const log = new SubmissionObservation();
    log.enabled = true;
    log.record(capture(), 0, graphics());
    expect(log.snapshot(1, 1, 0).records[0].provenance).toBe('current');
    expect(log.snapshot(2, 1, 0).records[0].provenance).toBe('previous-generation');
    expect(log.snapshot(1, 2, 0).records[0].provenance).toBe('previous-generation');
    const loss = log.snapshot(2, 2, 1).records[0];
    expect(loss.provenance).toBe('pre-loss');
    expect(loss).toMatchObject({
      sequence: 1,
      componentEpoch: 1,
      sceneEpoch: 1,
      tick: 30,
      lossesAtSubmission: 0,
    });
    log.record({ ...capture(), componentEpoch: 2, sceneEpoch: 2 }, 1, {
      ...graphics(2),
      losses: 1,
    });
    expect(log.snapshot(2, 2, 1).records.map((r) => r.provenance)).toEqual(['pre-loss', 'current']);
  });
  it('does not accept nonfinite snapshot facts', () => {
    const log = new SubmissionObservation();
    log.enabled = true;
    log.record({ ...capture(), speed: NaN }, 0, graphics());
    expect(log.snapshot(1, 1, 0).records).toEqual([]);
  });
  it('keeps original GPU errors outside observation isolation and captures only in draw callback', () => {
    const main = readFileSync(new URL('../src/engine/babylon/main.ts', import.meta.url), 'utf8');
    expect(main.indexOf('const graphics = gpu?.diagnostics();')).toBeLessThan(
      main.indexOf('let submissionSnapshot = null;'),
    );
    expect(main.indexOf('gpu!.frame(presentation, paused')).toBeLessThan(
      main.indexOf('submissionCapture = {'),
    );
    expect(main).toContain(
      'submissionObservation.record(submissionCapture, renderedFrames, graphics)',
    );
    expect(main).toContain('options: boolean | { submissionObservation?: boolean } = false');
  });
});
