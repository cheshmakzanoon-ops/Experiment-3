import { describe, expect, it } from 'vitest';
import {
  PresentationReview,
  REVIEW_LIMIT,
  REVIEW_COLUMNS,
  reviewFrame,
  readPresentationReport,
  reviewBudget,
  matchesReviewWeather,
  type ReviewContext,
} from '../src/rendering/presentation-review.ts';
const context: ReviewContext = {
  source: 'a'.repeat(64),
  machine: 'declared test GPU / plugged in',
  browser: 'test-browser',
  configuration: '{}',
  workload: 'clear-day',
  camera: 'cockpit',
  mode: 'full-lap',
  trackLength: 1000,
  startS: 100,
  startLaps: 0,
  startTime: 0,
  followedCar: 0,
  videoRequested: false,
};
function lap(gpu = false) {
  const review = new PresentationReview(),
    f = reviewFrame();
  review.start(context, 0);
  for (let i = 1; i <= 1000; i++) {
    f.time = i / 50;
    f.s = (100 + i) % 1000;
    f.laps = Math.floor((100 + i) / 1000);
    f.renderCPUms = 3;
    f.drawCalls = 70;
    f.triangles = 40000;
    f.gpuMs = gpu ? 6 : null;
    f.gpuSequence = gpu ? i : 0;
    review.record(i * 20, f);
  }
  return review;
}
describe('Phase 27E full-lap evidence', () => {
  it('requires an entire circuit traversal, not just the finish crossing', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start({ ...context, startS: 995 }, 0);
    f.s = 5;
    f.time = 0.2;
    f.laps = 1;
    r.record(200, f);
    expect(r.progressM).toBe(10);
    expect(r.state).toBe('recording');
    expect(r.report()).toBeNull();
    r.interrupt('Operator stopped');
    expect(r.report()!.state).toBe('interrupted');
  });
  it('completes actual road progress plus the lap counter and exports original intervals', () => {
    const r = lap(),
      report = r.report()!;
    expect(r.state).toBe('complete');
    expect(r.count).toBe(1000);
    expect(r.progressM).toBe(1000);
    expect(report.summary.averageFPS).toBe(50);
    expect(report.summary.p95FrameMs).toBe(20);
    expect(report.summary.visualAccepted).toBe(false);
    expect(report.summary.gpuVRAMBytes).toBeNull();
    expect(report.columns).toEqual(REVIEW_COLUMNS);
    expect(report.rows.every((row) => row[0] === 20)).toBe(true);
  });
  it('does not turn a lap-counter jump into travelled distance', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    f.s = 100;
    f.laps = 1;
    f.time = 1;
    r.record(1000, f);
    expect(r.state).toBe('recording');
    expect(r.progressM).toBe(0);
  });
  it('subtracts reverse movement rather than repeatedly counting the same corner', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    for (let i = 1; i <= 100; i++) {
      f.s = i % 2 ? 110 : 100;
      f.time = i;
      r.record(i * 1000, f);
    }
    expect(r.progressM).toBe(0);
    expect(r.state).toBe('recording');
  });
  it.each([
    'Session paused',
    'Viewport changed',
    'Camera changed',
    'Context lost',
    'Source reloaded',
  ])('marks %s as interrupted and preserves the first reason', (reason) => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    f.s = 101;
    f.time = 0.02;
    r.record(20, f);
    r.interrupt(reason);
    r.interrupt('later');
    r.record(1000, f);
    expect(r.report()!.reason).toBe(reason);
    expect(r.count).toBe(1);
  });
  it('retains a five-second frame stall without clamping or averaging it away', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    f.s = 101;
    f.time = 0.02;
    r.record(20, f);
    f.s = 201;
    f.time = 5.02;
    r.record(5020, f);
    r.interrupt('Review stopped');
    expect(r.report()!.rows.map((row) => row[0])).toEqual([20, 5000]);
    expect(r.report()!.summary.maximumFrameMs).toBe(5000);
  });
  it('deduplicates GPU results and skips queries predating the capture', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0, 5);
    f.s = 100;
    f.gpuMs = 90;
    f.gpuSequence = 5;
    r.record(20, f);
    f.gpuMs = 3;
    f.gpuSequence = 6;
    r.record(40, f);
    r.record(60, f);
    r.interrupt('Review stopped');
    expect(r.report()!.summary.gpuSamples).toBe(1);
    expect(r.report()!.summary.p99GPUms).toBe(3);
  });
  it('never reuses an older GPU query after its sequence regresses', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0, 7);
    f.s = 100;
    f.gpuMs = 4;
    for (const [i, sequence] of [8, 2, 8, 9].entries()) {
      f.gpuSequence = sequence;
      r.record((i + 1) * 20, f);
    }
    r.interrupt('Done');
    expect(r.report()!.summary.gpuSamples).toBe(2);
  });
  it('cannot discard an active capture by starting another', () => {
    const r = new PresentationReview();
    r.start(context, 0);
    expect(() => r.start(context, 1)).toThrow(/already recording/);
    expect(r.context).toEqual(context);
  });
  it('tolerates discrete road-progress fields between higher-rate interpolated frames', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    for (let i = 1; i <= 240; i++) {
      f.time = i / 240;
      f.s = 100 + Math.floor(i / 24) * 10;
      r.record((i * 1000) / 240, f);
    }
    expect(r.state).toBe('recording');
    expect(r.progressM).toBe(100);
  });
  it('rejects rewind, teleport and malformed quaternion observations', () => {
    for (const modify of [
      (f: ReturnType<typeof reviewFrame>) => {
        f.time = -1;
      },
      (f: ReturnType<typeof reviewFrame>) => {
        f.s = 500;
        f.time = 0.01;
      },
      (f: ReturnType<typeof reviewFrame>) => {
        f.qw = 2;
      },
      (f: ReturnType<typeof reviewFrame>) => {
        f.drawCalls = NaN;
      },
      (f: ReturnType<typeof reviewFrame>) => {
        f.laps = 0.1;
      },
    ]) {
      const r = new PresentationReview(),
        f = reviewFrame();
      r.start(context, 0);
      f.s = 100;
      modify(f);
      r.record(20, f);
      expect(r.state).toBe('interrupted');
      expect(r.count).toBe(0);
    }
  });
  it('bounds memory and stops instead of silently discarding old samples', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    f.s = 100;
    for (let i = 1; i <= REVIEW_LIMIT + 1; i++) r.record(i, f);
    expect(r.count).toBe(REVIEW_LIMIT);
    expect(r.reason).toMatch(/capacity/);
  });
  it('a timed grid/pit scene never claims a completed full lap', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start({ ...context, mode: 'timed-scene', workload: 'pit-service' }, 0);
    f.s = 100;
    f.time = 30;
    r.record(30000, f);
    expect(r.state).toBe('complete');
    expect(r.progressM).toBe(0);
    expect(r.report()!.context.mode).toBe('timed-scene');
    expect(reviewBudget(r.report()!).state).toBe('unmeasured');
  });
  it('does not trust imported completion, summaries or progress', () => {
    const report = lap().report()!;
    report.summary.averageFPS = 999999;
    report.progressM = 999999;
    const read = readPresentationReport(report);
    expect(read.summary.averageFPS).toBe(50);
    expect(read.progressM).toBe(1000);
    expect(() => readPresentationReport({ ...report, rows: report.rows.slice(0, 10) })).toThrow(
      /completion/,
    );
    const mutated = structuredClone(report);
    mutated.rows[10][7] += 400;
    expect(() => readPresentationReport(mutated)).toThrow();
    expect(() =>
      readPresentationReport({ ...report, rows: [...report.rows, report.rows[0]] }),
    ).toThrow(/terminal/);
  });
  it('supports an honest interrupted import without pretending it passed a lap', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start(context, 0);
    f.s = 100;
    r.record(20, f);
    r.interrupt('Manual stop');
    expect(readPresentationReport(r.report()).state).toBe('interrupted');
  });
  it('missing GPU observations remain unmeasured, not a passing budget', () => {
    expect(reviewBudget(lap().report()!).state).toBe('unmeasured');
    expect(reviewBudget(lap(true).report()!).state).toBe('pass');
    const slow = lap(true).report()!;
    slow.rows.forEach((row) => {
      row[1] = 30;
    });
    expect(reviewBudget(slow).state).toBe('fail');
  });
  it('workload labels must match the actual starting weather/night state', () => {
    expect(matchesReviewWeather('clear-day', 0, 0.2, false)).toBe(true);
    expect(matchesReviewWeather('clear-day', 1, 0.2, false)).toBe(false);
    expect(matchesReviewWeather('overcast-day', 0, 0.8, false)).toBe(true);
    expect(matchesReviewWeather('wet-day', 5, 0.8, true)).toBe(false);
    expect(matchesReviewWeather('wet-night', 5, 0.8, true)).toBe(true);
    expect(matchesReviewWeather('other', 0, NaN, true)).toBe(false);
  });
  it('clones capture identity and validates sizes, identifiers and time', () => {
    const r = new PresentationReview(),
      c = { ...context };
    r.start(c, 0);
    c.machine = 'edited';
    expect(r.context!.machine).toBe(context.machine);
    const copy = r.context!;
    copy.source = 'bad';
    expect(r.context!.source).toBe(context.source);
    for (const c of [
      { ...context, source: 'bad' },
      { ...context, trackLength: Infinity },
      { ...context, startS: 1000 },
      { ...context, machine: '' },
    ])
      expect(() => r.start(c, 0)).toThrow();
  });
});
