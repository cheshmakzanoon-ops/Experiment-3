import { describe, expect, it } from 'vitest';
import { recordedPitMoment } from '../e2e/fixtures/pit-replay-selection.ts';
import { serviceWheelOffset } from '../src/rendering/pit-crew.ts';

describe('recorded service inspection requests', () => {
  it('does not mistake the failed loaded phase-three sample for displaced wheels', () => {
    const observed = { time: 116.86666870117188, phase: 3, clock: 1.399999976158142 };
    const loads = Array.from(new Float32Array([692.3609, 697.46924, 840.8365, 838.6876]));
    expect(loads.map((load) => serviceWheelOffset(3, observed.clock, load))).toEqual([0, 0, 0, 0]);
    const before = { ...observed };
    expect(recordedPitMoment(observed, 'removal')).toBeCloseTo(117.46666872501373, 8);
    expect(recordedPitMoment(observed, 'installation')).toBeCloseTo(118.06666872501373, 8);
    expect(observed).toEqual(before);
    // Choosing a later inspection time does not authorize a loaded hub to move.
    expect(loads.map((load) => serviceWheelOffset(3, 2, load))).toEqual([0, 0, 0, 0]);
    expect(serviceWheelOffset(3, 2, 0)).toBeGreaterThan(0.4);
    expect(serviceWheelOffset(4, 2.6, 0)).toBeGreaterThan(0.2);
  });

  it('uses the recorded clock rather than phase-row sampling cadence or wall time', () => {
    for (const clock of [0.8, 1.05, 1.4, 1.9, 2.19]) {
      const observed = { time: 310.25 + clock, phase: 3, clock };
      expect(recordedPitMoment(observed, 'removal')).toBeCloseTo(312.25, 8);
      expect(recordedPitMoment(observed, 'installation')).toBeCloseTo(312.85, 8);
    }
  });

  it('rejects nonservice, corrupt, or impossible anchors instead of inventing a stop', () => {
    for (const observed of [
      { time: 10, phase: 1, clock: 0 },
      { time: 10, phase: 6, clock: 5.2 },
      { time: 10, phase: 3.5, clock: 1 },
      { time: NaN, phase: 3, clock: 1 },
      { time: 10, phase: 3, clock: Infinity },
      { time: 10, phase: 3, clock: -1 },
      { time: 10, phase: 3, clock: 6 },
      { time: 0.5, phase: 3, clock: 1.4 },
    ])
      expect(() => recordedPitMoment(observed, 'removal')).toThrow(
        'Invalid recorded service anchor',
      );
  });
});
