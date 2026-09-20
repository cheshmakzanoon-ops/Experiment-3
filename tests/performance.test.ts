import { describe, expect, it } from 'vitest';
import {
  PerformanceCapture, summarizePerformance, readPerformanceReport, comparePerformance,
  PROFILE_COLUMNS, PROFILE_LIMIT, type FrameMetrics,
} from '../src/core/performance.ts';
const context = {
  machine: 'test-machine', workload: 'seeded-practice', configuration: '{}',
  browser: 'test-browser', source: 'a'.repeat(64),
};
const metrics: FrameMetrics = {
  renderCPUms: 3, physicsMs: 1, drawCalls: 60, triangles: 40000, gpuMs: null, gpuSequence: 0,
};
function complete(frameMs = 20, cpu = 3) {
  const capture = new PerformanceCapture(0, 10000);
  capture.start(context, 0);
  capture.record(1, metrics);
  let now = 1;
  while (capture.active) {
    now += frameMs;
    capture.record(now, { ...metrics, renderCPUms: cpu });
  }
  return capture.report()!;
}
describe('honest timing evidence', () => {
  it('uses total frames / total time, not the mean of instantaneous FPS', () => {
    const summary = summarizePerformance([[10, 1, 2, 5, 20, -1], [30, 3, 4, 7, 40, 6]]);
    expect(summary.averageFPS).toBe(50);
    expect(summary.onePercentLowFPS).toBeCloseTo(1000 / 30);
    expect(summary.averageRenderCPUms).toBe(2);
    expect(summary.averageReportedPhysicsTickMs).toBe(3);
    expect(summary.averageDrawCalls).toBe(6);
    expect(summary.averageTriangles).toBe(30);
    expect(summary.gpuSamples).toBe(1);
    expect(summary.medianGPUms).toBe(6);
  });
  it('distinguishes p99 from the mean of the slowest 1 percent', () => {
    const rows = Array.from({ length: 200 }, () => [10, 1, 1, 20, 2000, -1]);
    rows[198][0] = 40; rows[199][0] = 60;
    const summary = summarizePerformance(rows);
    expect(summary.p99FrameMs).toBe(10);
    expect(summary.onePercentLowFPS).toBe(20);
    expect(summary.maximumFrameMs).toBe(60);
  });
  it('does not assign a fictional zero to unavailable GPU time', () => {
    const s = summarizePerformance([[20, 1, 1, 1, 1, -1]]);
    expect(s.medianGPUms).toBeNull(); expect(s.p99GPUms).toBeNull();
    expect(s.gpuSamples).toBe(0);
  });
  it('rejects nonfinite, zero-duration, negative and nonintegral draw samples', () => {
    for (const row of [
      [0, 1, 1, 1, 1, -1], [NaN, 1, 1, 1, 1, -1], [10, -1, 1, 1, 1, -1],
      [10, 1, 1, 1.5, 1, -1], [10, 1, 1, 1, Infinity, -1], [10, 1, 1, 1, 1, -2],
    ]) expect(() => summarizePerformance([row])).toThrow();
  });
  it('rejects finite rows whose accumulated duration overflows', () => {
    expect(() => summarizePerformance([[1e308, 1, 1, 1, 1, -1], [1e308, 1, 1, 1, 1, -1]])).toThrow(/overflow/);
  });
  it('bounds imported sample counts before processing', () => {
    expect(() => summarizePerformance(new Array(PROFILE_LIMIT + 1))).toThrow(/limit/);
  });
  it('excludes the warm-up crossing and retains a 5 second hitch unchanged', () => {
    const c = new PerformanceCapture(1000, 10000);
    c.start(context, 0);
    c.record(500, metrics); c.record(1200, metrics);
    expect(c.state).toBe('recording'); expect(c.count).toBe(0);
    c.record(1220, metrics); c.record(6220, metrics); c.record(11220, metrics);
    const r = c.report()!;
    expect(r.state).toBe('complete'); expect(r.summary.elapsedMs).toBe(10020);
    expect(r.rows.map((row) => row[0])).toEqual([20, 5000, 5000]);
  });
  it('counts an asynchronous GPU result once and skips pre-capture queries', () => {
    const c = new PerformanceCapture(0, 1000);
    c.start(context, 0);
    c.record(1, { ...metrics, gpuMs: 12, gpuSequence: 5 });
    c.record(21, { ...metrics, gpuMs: 12, gpuSequence: 5 });
    c.record(41, { ...metrics, gpuMs: 2, gpuSequence: 6 });
    c.record(61, { ...metrics, gpuMs: 2, gpuSequence: 6 });
    c.record(1001, { ...metrics, gpuMs: null, gpuSequence: 6 });
    expect(c.report()!.summary.gpuSamples).toBe(1);
    expect(c.report()!.summary.medianGPUms).toBe(2);
  });
  it('a pause is an interrupted report, never a completed benchmark', () => {
    const c = new PerformanceCapture(0, 1000);
    c.start(context, 0); c.record(1, metrics); c.record(21, metrics);
    c.interrupt('Pause'); c.record(20000, metrics); c.interrupt('Later error');
    expect(c.count).toBe(1); expect(c.report()!.reason).toBe('Pause');
    expect(c.report()!.state).toBe('interrupted');
  });
  it('rejects backward clocks and invalid current-frame measurements', () => {
    const c = new PerformanceCapture(0, 1000);
    c.start(context, 0); c.record(1, metrics); c.record(1, metrics);
    expect(c.reason).toContain('clock');
    c.start(context, 2); c.record(3, metrics); c.record(4, { ...metrics, renderCPUms: NaN });
    expect(c.reason).toContain('Invalid measured');
  });
  it('exhausting capacity fails rather than overwriting an inconvenient history', () => {
    const c = new PerformanceCapture(0, 120000);
    c.start(context, 0); c.record(1, metrics);
    for (let i = 0; i <= PROFILE_LIMIT; i++) c.record(i + 2, metrics);
    expect(c.state).toBe('interrupted'); expect(c.count).toBe(PROFILE_LIMIT);
  });
  it('new captures reset counters and snapshot their identity', () => {
    const identity = { ...context };
    const c = new PerformanceCapture(0, 1000);
    c.start(identity, 0); identity.machine = 'mutated';
    c.record(1, metrics); c.record(1001, metrics);
    expect(c.report()!.context.machine).toBe(context.machine);
    c.start(context, 2000);
    expect(c.count).toBe(0); expect(c.report()).toBeNull();
  });
  it('validates identity and durations', () => {
    expect(() => new PerformanceCapture(NaN)).toThrow();
    expect(() => new PerformanceCapture(0, Infinity)).toThrow();
    const c = new PerformanceCapture();
    expect(() => c.start({ ...context, source: 'not-a-hash' }, 0)).toThrow();
    expect(() => c.start({ ...context, machine: '' }, 0)).toThrow();
  });
  it('recomputes imported summaries and rejects missing duration and short completion', () => {
    const r = complete(); r.summary.averageFPS = 9999;
    expect(readPerformanceReport(r).summary.averageFPS).toBe(50);
    expect(() => readPerformanceReport({ ...r, warmupMs: undefined })).toThrow();
    expect(() => readPerformanceReport({ ...r, rows: r.rows.slice(0, 1) })).toThrow();
    expect(() => readPerformanceReport({ ...r, columns: [...PROFILE_COLUMNS].reverse() })).toThrow();
  });
  it('only compares matching machines, configurations, browsers, workloads and durations', () => {
    const before = complete(), after = complete();
    after.context.source = 'b'.repeat(64);
    expect(comparePerformance(before, after).passed).toBe(true);
    for (const key of ['machine', 'configuration', 'browser', 'workload'] as const) {
      const changed = { ...after, context: { ...after.context, [key]: 'different' } };
      expect(comparePerformance(before, changed).comparable).toBe(false);
    }
    expect(comparePerformance(before, { ...after, warmupMs: 5 }).comparable).toBe(false);
  });
  it('rejects significant FPS, CPU and draw regressions and insufficient evidence', () => {
    const before = complete(), slow = complete(30, 5);
    expect(comparePerformance(before, slow).passed).toBe(false);
    const moreDraws = structuredClone(before);
    moreDraws.rows.forEach((row) => { row[3] *= 2; row[4] *= 2; });
    const result = comparePerformance(before, moreDraws);
    expect(result.checks.filter((c) => !c.passed).map((c) => c.metric)).toEqual([
      'averageDrawCalls', 'averageTriangles',
    ]);
    const few = complete(100);
    expect(comparePerformance(few, few).comparable).toBe(false);
  });
});
