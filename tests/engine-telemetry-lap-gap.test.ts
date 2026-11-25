import { describe, expect, it } from 'vitest';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import { completeLaps, type PlotData } from '../src/storage/telemetry-plots.ts';

const LENGTH = 100;
const ROWS_PER_LAP = 100;

function recording({
  gapBefore = Infinity,
  invalidLap = -1,
  seconds = 6,
}: { gapBefore?: number; invalidLap?: number; seconds?: number } = {}) {
  const recorder = new TelemetryRecorder(seconds);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const base = carBase(0);
  for (let row = 0; row <= 3 * ROWS_PER_LAP; row++) {
    const gap = row >= gapBefore ? 1 : 0;
    const lap = Math.floor(row / ROWS_PER_LAP);
    frame[H.TIME] = frame[H.RACE_TIME] = (row + 1) / 60 + gap;
    frame[H.TICK] = (row + 1) * 2 + gap * 120;
    frame[base + F.S] = row % ROWS_PER_LAP;
    frame[base + F.LAPS] = lap;
    frame[base + F.LAP_TIME] = ((row % ROWS_PER_LAP) + 1) / 60;
    frame[base + F.LAP_VALID] = lap === invalidLap ? 0 : 1;
    recorder.append(frame);
  }
  return recorder;
}

describe('completed telemetry lap capture boundaries', () => {
  it('keeps distance endpoints and excludes the unfinished lap after ordinary transitions', () => {
    const recorder = recording();
    const laps = completeLaps(recorder, LENGTH);
    expect(laps).toEqual([
      { lap: 0, start: 0, end: 99, valid: true },
      { lap: 1, start: 100, end: 199, valid: true },
      { lap: 2, start: 200, end: 299, valid: true },
    ]);
    for (const lap of laps) {
      expect(recorder.at(lap.start, 1)).toBe(0);
      expect(recorder.at(lap.end, 1)).toBe(99);
    }
  });

  it.each([
    { where: 'just before the finish', gapBefore: 99, complete: [1, 2] },
    { where: 'at the lap-counter transition', gapBefore: 100, complete: [1, 2] },
    { where: 'just after the transition', gapBefore: 101, complete: [0, 2] },
  ])(
    'rejects a one-second capture gap $where without losing other laps',
    ({ gapBefore, complete }) => {
      const recorder = recording({ gapBefore });
      expect(recorder.at(gapBefore, 0) - recorder.at(gapBefore - 1, 0)).toBeGreaterThan(1);
      expect(completeLaps(recorder, LENGTH).map((lap) => lap.lap)).toEqual(complete);
    },
  );

  it.each([
    { closingTime: 0.249, complete: [0, 1, 2] },
    { closingTime: 0.25, complete: [0, 1, 2] },
    { closingTime: 0.251, complete: [1, 2] },
  ])(
    'keeps the strict 0.15-second threshold when the closing time is $closingTime',
    ({ closingTime, complete }) => {
      const recorder = recording();
      // Preserve the recorded channels, but use a double-precision PlotData clock:
      // 0.25 - 0.1 is exactly the threshold, unlike Float32-packed 0.15 seconds.
      const data: PlotData = {
        count: recorder.count,
        at: (row, column) =>
          column !== 0
            ? recorder.at(row, column)
            : row < ROWS_PER_LAP
              ? (row + 1) / 1000
              : closingTime + (row - ROWS_PER_LAP) / 60,
      };
      if (closingTime === 0.25) expect(data.at(100, 0) - data.at(99, 0)).toBe(0.15);
      expect(completeLaps(data, LENGTH).map((lap) => lap.lap)).toEqual(complete);
    },
  );

  it('keeps an invalid next lap from changing the previous lap validity', () => {
    expect(completeLaps(recording({ invalidLap: 1 }), LENGTH)).toEqual([
      { lap: 0, start: 0, end: 99, valid: true },
      { lap: 1, start: 100, end: 199, valid: false },
      { lap: 2, start: 200, end: 299, valid: true },
    ]);
  });

  it('excludes the partial oldest lap after ring wrap and retains complete later laps', () => {
    const recorder = recording({ seconds: 4 });
    expect(recorder.count).toBe(240);
    expect(recorder.at(0, 1)).toBe(61);
    expect(completeLaps(recorder, LENGTH)).toEqual([
      { lap: 1, start: 39, end: 138, valid: true },
      { lap: 2, start: 139, end: 238, valid: true },
    ]);
  });
});
