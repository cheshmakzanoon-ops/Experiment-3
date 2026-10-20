import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_PACE_TRACE,
  CircuitPace,
  type CircuitPaceReason,
  type CircuitPaceRecord,
} from '../src/simulation/open-world/circuit-pace.ts';

function reference(hz = 30) {
  const pace = new CircuitPace(900);
  // Three distinct speeds make same-position comparison distinguishable
  // from a percentage of the final lap time or the last sector delta.
  for (let tick = 1; tick <= 40 * hz; tick++) {
    const time = tick / hz;
    const distance =
      time <= 10 ? time * 30 : time <= 30 ? 300 + (time - 10) * 15 : 600 + (time - 30) * 30;
    pace.sample(distance, time);
  }
  pace.finish(true, 40);
  return pace.record()!;
}

function complete(duration: number, baseline: CircuitPaceRecord | null = null) {
  const pace = new CircuitPace(900, baseline);
  for (let i = 1; i <= 90; i++) pace.sample(i * 10, (i / 90) * duration);
  pace.finish(true, duration);
  return pace;
}

describe('live circuit comparison at measured route positions', () => {
  it('records complete clean first-arrival times at approximately ten metre spacing', () => {
    const pace = complete(30);
    expect(pace.status().liveDelta).toBeNull();
    const record = pace.record()!;
    expect(record.trace?.length).toBe(900);
    expect(record.trace?.times).toHaveLength(91);
    for (const [i, time] of record.trace!.times.entries()) expect(time).toBeCloseTo(i / 3, 10);
    expect(record.trace?.times[0]).toBe(0);
    expect(record.trace?.times.at(-1)).toBe(record.time);
  });

  it('uses elapsed time at the same station instead of overall lap percentage', () => {
    const pace = new CircuitPace(900, reference());
    pace.sample(375, 14);
    expect(pace.status().liveDelta).toBeCloseTo(-1, 10);
    expect(pace.status().splits[0].delta).not.toBeCloseTo(-1, 3);
    expect(pace.status().liveDelta).not.toBeCloseTo(14 - (40 * 375) / 900, 3);
  });

  it('interpolates between measured stations without snapping the live readout', () => {
    const pace = new CircuitPace(900, reference());
    pace.sample(378, 14.25);
    expect(pace.status().liveDelta).toBeCloseTo(-0.95, 10);
    pace.sample(379, 14.3);
    expect(pace.status().liveDelta).toBeCloseTo(14.3 - (10 + 79 / 15), 10);
  });

  it('charges stopped time even when no new route station is reached', () => {
    const pace = new CircuitPace(900, reference());
    pace.sample(375, 14);
    expect(pace.status(17).liveDelta).toBeCloseTo(2, 10);
    pace.sample(375, 18.5);
    expect(pace.status().liveDelta).toBeCloseTo(3.5, 10);
  });

  it('preserves first arrivals while reversing and charges the repeated distance time', () => {
    const pace = new CircuitPace(900);
    pace.sample(300, 10);
    pace.sample(200, 15);
    pace.sample(300, 20);
    pace.sample(600, 30);
    pace.sample(900, 40);
    pace.finish(true, 40);
    const saved = pace.record()!;
    expect(saved.trace!.times[30]).toBeCloseTo(10, 10);
    expect(saved.trace!.times[31]).toBeCloseTo(20 + 1 / 3, 10);
    const retry = new CircuitPace(900, reference());
    retry.sample(375, 14);
    retry.sample(300, 17);
    retry.sample(375, 22);
    expect(retry.status().liveDelta).toBeCloseTo(7, 10);
    expect(retry.status().splits).toHaveLength(1);
  });

  it('bounds comparison at the start and finish instead of extrapolating outside the course', () => {
    const pace = new CircuitPace(900, reference());
    pace.sample(-10, 1);
    expect(pace.status().liveDelta).toBe(1);
    pace.sample(1000, 41);
    expect(pace.status().liveDelta).toBeCloseTo(1, 10);
  });

  it('cannot save a lap that has sectors but never physically reaches the finish distance', () => {
    const pace = new CircuitPace(900);
    pace.sample(600, 20);
    expect(pace.finish(true, 30)).toMatchObject({
      valid: false,
      reason: 'incomplete',
      newBest: false,
    });
    expect(pace.record()).toBeNull();
  });

  it('freezes the completed comparison against later status clocks and samples', () => {
    const pace = complete(36, reference());
    expect(pace.status().liveDelta).toBeCloseTo(-4, 10);
    pace.sample(450, 900);
    expect(pace.status(999).liveDelta).toBeCloseTo(-4, 10);
    expect(pace.status(999).sectorElapsed).toBe(0);
    expect(pace.finish(false, 999).time).toBe(36);
  });

  it('rejects movement with no elapsed time even below the teleport tolerance', () => {
    const pace = new CircuitPace(900, reference());
    pace.sample(1, 0);
    expect(pace.status()).toMatchObject({
      valid: false,
      reason: 'invalid-progress',
      liveDelta: null,
    });
    expect(pace.record()).toBeNull();
  });

  it('bounds trace memory on exceptionally long courses while retaining the finish', () => {
    const pace = new CircuitPace(100000);
    pace.sample(100000, 1000);
    pace.finish(true, 1000);
    const times = pace.record()!.trace!.times;
    expect(times).toHaveLength(CIRCUIT_PACE_TRACE.maxSamples);
    expect(times[1024]).toBeCloseTo(500, 10);
    expect(times.at(-1)).toBe(1000);
  });

  it('supports a very short course with a start and finish sample', () => {
    const first = new CircuitPace(0.5);
    first.sample(0.5, 1);
    first.finish(true, 1);
    expect(first.record()!.trace!.times).toEqual([0, 1]);
    const retry = new CircuitPace(0.5, first.record());
    retry.sample(0.25, 0.4);
    expect(retry.status().liveDelta).toBeCloseTo(-0.1, 10);
  });

  it('replaces a reference only with a faster complete clean trace', () => {
    const best = reference();
    for (const duration of [40, 44]) expect(complete(duration, best).record()).toBeNull();
    const faster = complete(36, best).record()!;
    expect(faster.time).toBe(36);
    expect(faster.trace!.times.at(-1)).toBe(36);
    expect(best.time).toBe(40);
    expect(best.trace!.times.at(-1)).toBe(40);
  });

  it('gives the same measured comparison at different input sampling rates', () => {
    for (const hz of [12, 30, 120]) {
      const pace = new CircuitPace(900, reference(hz));
      pace.sample(375, 14);
      expect(pace.status().liveDelta).toBeCloseTo(-1, 9);
    }
  });

  it('isolates and freezes the accepted reference against caller mutation', () => {
    const original = reference();
    const pace = new CircuitPace(900, original);
    original.time = 500;
    (original.crossings as unknown as number[])[0] = 500;
    (original.trace!.times as number[])[37] = 500;
    original.trace!.length = 500;
    pace.sample(375, 14);
    expect(pace.status().liveDelta).toBeCloseTo(-1, 10);
    expect(Object.isFrozen(pace.reference)).toBe(true);
    expect(Object.isFrozen(pace.reference!.crossings)).toBe(true);
    expect(Object.isFrozen(pace.reference!.trace)).toBe(true);
    expect(Object.isFrozen(pace.reference!.trace!.times)).toBe(true);
  });

  it('returns detached record arrays instead of exposing the completed internal trace', () => {
    const pace = complete(30);
    const copy = pace.record()!;
    (copy.crossings as unknown as number[])[0] = 500;
    (copy.trace!.times as number[])[10] = 500;
    copy.trace!.length = 10;
    const again = pace.record()!;
    expect(again.crossings).toEqual([10, 20, 30]);
    expect(again.trace!.length).toBe(900);
    expect(again.trace!.times[10]).toBeCloseTo(10 / 3, 10);
  });

  it('retains legacy sector comparisons until a new clean best provides a live trace', () => {
    const legacy: CircuitPaceRecord = { time: 40, crossings: [10, 30, 40] };
    const pace = new CircuitPace(900, legacy);
    pace.sample(375, 14);
    expect(pace.status()).toMatchObject({ referenceTime: 40, liveDelta: null });
    expect(pace.status().splits[0].delta).not.toBeNull();
    const upgraded = complete(36, legacy).record()!;
    expect(upgraded.trace!.times).toHaveLength(91);
    expect(new CircuitPace(900, upgraded).status().liveDelta).toBe(0);
  });

  it('rejects malformed trace data while preserving a separately valid sector record', () => {
    const cases: ((record: CircuitPaceRecord) => void)[] = [
      (record) => {
        record.trace!.length = 901;
      },
      (record) => {
        record.trace!.length = Infinity;
      },
      (record) => {
        record.trace!.times = [0, 40];
      },
      (record) => {
        delete (record.trace!.times as number[])[20];
      },
      (record) => {
        (record.trace!.times as number[])[20] = NaN;
      },
      (record) => {
        (record.trace!.times as number[])[20] = 0;
      },
      (record) => {
        (record.trace!.times as number[])[0] = 1;
      },
      (record) => {
        (record.trace!.times as number[])[90] = 41;
      },
    ];
    for (const corrupt of cases) {
      const candidate = reference();
      corrupt(candidate);
      const pace = new CircuitPace(900, candidate);
      pace.sample(375, 14);
      expect(pace.status()).toMatchObject({ valid: true, referenceTime: 40, liveDelta: null });
      expect(pace.status().splits[0].delta).not.toBeNull();
    }
  });

  it('rejects malformed best records rather than displaying untrusted comparison values', () => {
    const cases: unknown[] = [
      { time: NaN, crossings: [10, 30, 40] },
      { time: -40, crossings: [10, 30, 40] },
      { time: 40, crossings: [10, 5, 40] },
      { time: 40, crossings: [10, 30, 41] },
      { time: 40, crossings: [10, undefined, 40] },
      { time: 40, crossings: Array(3) },
      { time: 40, crossings: null },
    ];
    for (const candidate of cases) {
      const pace = new CircuitPace(900, candidate as CircuitPaceRecord);
      pace.sample(375, 14);
      expect(pace.reference).toBeNull();
      expect(pace.status()).toMatchObject({ valid: true, referenceTime: null, liveDelta: null });
    }
  });

  it.each<CircuitPaceReason>(['off-road', 'contact', 'reset', 'autopilot'])(
    'suppresses the live comparison and record after %s invalidation',
    (reason) => {
      const pace = new CircuitPace(900, reference());
      pace.sample(375, 14);
      expect(pace.status().liveDelta).toBeCloseTo(-1, 10);
      pace.invalidate(reason);
      pace.sample(900, 36);
      expect(pace.status(36)).toMatchObject({ valid: false, reason, liveDelta: null });
      expect(pace.finish(true, 36)).toMatchObject({
        valid: false,
        reason,
        liveDelta: null,
        newBest: false,
      });
      expect(pace.record()).toBeNull();
    },
  );
});
