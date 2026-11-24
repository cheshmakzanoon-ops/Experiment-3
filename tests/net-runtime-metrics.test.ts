import { describe, expect, it } from 'vitest';
import { TickBudgetMonitor, TokenBucket } from '../src/net/guards.ts';

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe('rate-budget numeric ownership', () => {
  const invalidConfigurations: [number, number, number][] = [
    [-1, 5, 0],
    [NaN, 5, 0],
    [Infinity, 5, 0],
    [-Infinity, 5, 0],
    [10, -1, 0],
    [10, NaN, 0],
    [10, Infinity, 0],
    [10, -Infinity, 0],
    [10, 5, NaN],
    [10, 5, Infinity],
    [10, 5, -Infinity],
  ];
  it.each(invalidConfigurations)(
    'rejects invalid rate %s, capacity %s, or clock %s before construction',
    (rate, capacity, now) => {
      expect(() => new TokenBucket(rate, capacity, now)).toThrow();
    },
  );

  const invalidRequests: [number, number][] = [
    [NaN, 1],
    [Infinity, 1],
    [-Infinity, 1],
    [10000, NaN],
    [10000, Infinity],
    [10000, -Infinity],
    [10000, -0.25],
  ];
  it.each(invalidRequests)(
    'rejects clock %s and cost %s without changing later admission',
    (now, cost) => {
      const actual = new TokenBucket(2, 2),
        unchanged = new TokenBucket(2, 2);
      expect(actual.take(0)).toBe(true);
      expect(unchanged.take(0)).toBe(true);
      expect(actual.take(now, cost)).toBe(false);
      const later = [0, 250, 500, 600, 1000, 1100, 1500];
      expect(later.map((time) => actual.take(time))).toEqual(
        later.map((time) => unchanged.take(time)),
      );
    },
  );

  it('does not mint tokens for a zero rate when two finite clock values span overflow', () => {
    const bucket = new TokenBucket(0, 2, -Number.MAX_VALUE);
    expect(bucket.take(-Number.MAX_VALUE, 2)).toBe(true);
    expect(bucket.take(Number.MAX_VALUE)).toBe(false);
    expect(bucket.take(Number.MAX_VALUE)).toBe(false);
    expect(bucket.take(Number.MAX_VALUE, 0)).toBe(true);
    expect(bucket.take(Number.MAX_VALUE)).toBe(false);
  });

  it('supports empty budgets, zero costs and fractional token weights', () => {
    const disabled = new TokenBucket(0, 0, -500);
    expect(disabled.take(-500, 0)).toBe(true);
    expect(disabled.take(100000)).toBe(false);
    const weighted = new TokenBucket(0.5, 1.25, -500);
    expect(weighted.take(-500, 0.75)).toBe(true);
    expect(weighted.take(-500, 0.75)).toBe(false);
    expect(weighted.take(0, 0.75)).toBe(true);
    expect(weighted.take(0, 0.25)).toBe(false);
    expect(weighted.take(500, 0.25)).toBe(true);
  });

  it('does not refill twice after a backward clock, and still charges available tokens', () => {
    const bucket = new TokenBucket(2, 3, -1000);
    expect(bucket.take(-1000, 3)).toBe(true);
    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(-500)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(499)).toBe(false);
    expect(bucket.take(500)).toBe(true);
  });

  it('caps extreme positive refill at a finite capacity', () => {
    const bucket = new TokenBucket(Number.MAX_VALUE, 3, -Number.MAX_VALUE);
    expect(bucket.take(-Number.MAX_VALUE, 3)).toBe(true);
    expect(bucket.take(Number.MAX_VALUE, 3)).toBe(true);
    expect(bucket.take(Number.MAX_VALUE)).toBe(false);
  });

  it('preserves the original admissions across seeded valid request streams', () => {
    // Frozen original arithmetic is a compatibility oracle for valid arguments.
    for (const [rate, capacity] of [
      [0, 0],
      [0, 2],
      [0.125, 0.25],
      [8, 16],
      [75, 40],
    ]) {
      const bucket = new TokenBucket(rate, capacity, -1300),
        next = random(47001 + capacity);
      let tokens = capacity,
        last = -1300,
        now = -1300;
      for (let i = 0; i < 2048; i++) {
        now += Math.floor(next() * 180) - 40;
        const cost = [0, 0.125, 0.5, 1, 2, 5][Math.floor(next() * 6)];
        const elapsed = Math.max(0, now - last);
        last = Math.max(last, now);
        tokens = Math.min(capacity, tokens + (elapsed / 1000) * rate);
        const admitted = tokens >= cost;
        if (admitted) tokens -= cost;
        expect(bucket.take(now, cost)).toBe(admitted);
      }
    }
  });
});

function referenceReport(values: number[], budget: number, degradeAfter: number, warmup: number) {
  const measured = values.slice(warmup).filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...measured].sort((a, b) => a - b);
  let overruns = 0,
    streak = 0,
    longest = 0;
  for (const value of values.slice(warmup)) {
    if (Number.isFinite(value) && value > budget) {
      overruns++;
      streak++;
      longest = Math.max(longest, streak);
    } else streak = 0;
  }
  const percentile = sorted[Math.ceil(sorted.length * 0.99) - 1];
  return {
    budgetMs: budget,
    ticks: values.length,
    meanMs: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : 0,
    // The monitor reports each 0.05 ms bucket's upper edge, capped at its overflow bucket.
    p99Ms: measured.length ? (Math.min(1000, Math.floor(percentile / 0.05)) + 1) * 0.05 : 0,
    worstMs: sorted.at(-1) ?? 0,
    overruns,
    longestOverrunStreak: longest,
    status: longest >= degradeAfter ? 'degraded' : 'ok',
  };
}

describe('tick-budget observation accounting', () => {
  it.each([0, 1, 120])('reports no percentile before %i observed warmup ticks end', (warmup) => {
    const monitor = new TickBudgetMonitor(8.33, 3, warmup);
    const empty = {
      budgetMs: 8.33,
      meanMs: 0,
      p99Ms: 0,
      worstMs: 0,
      overruns: 0,
      longestOverrunStreak: 0,
      status: 'ok',
    };
    expect(monitor.report()).toEqual({ ...empty, ticks: 0 });
    for (let i = 0; i < warmup; i++) monitor.record(200);
    expect(monitor.report()).toEqual({ ...empty, ticks: warmup });
  });

  it.each([NaN, Infinity, -Infinity, -1, -0.001])(
    'counts a tick with invalid measurement %s without adding a timing sample',
    (invalid) => {
      const monitor = new TickBudgetMonitor(8.33, 3, 0);
      monitor.record(invalid);
      expect(monitor.report()).toEqual({
        budgetMs: 8.33,
        ticks: 1,
        meanMs: 0,
        p99Ms: 0,
        worstMs: 0,
        overruns: 0,
        longestOverrunStreak: 0,
        status: 'ok',
      });
    },
  );

  it('does not dilute the mean or lose the percentile after rejected samples', () => {
    const monitor = new TickBudgetMonitor(8.33, 3, 0);
    const values = [2, 4, NaN, Infinity, -Infinity, -4, 6];
    values.forEach((value) => monitor.record(value));
    expect(monitor.report()).toMatchObject({
      budgetMs: 8.33,
      ticks: 7,
      meanMs: 4,
      worstMs: 6,
      overruns: 0,
      longestOverrunStreak: 0,
      status: 'ok',
    });
    expect(monitor.report().p99Ms).toBeCloseTo(6.05, 12);
  });

  it('counts warmup by real ticks, including unusable measurements', () => {
    const monitor = new TickBudgetMonitor(8, 3, 3);
    const values = [NaN, -1, 400, 10, 20];
    values.forEach((value) => monitor.record(value));
    expect(monitor.report()).toEqual(referenceReport(values, 8, 3, 3));
    expect(monitor.report().meanMs).toBe(15);
  });

  it.each([NaN, Infinity, -Infinity, -1])(
    'does not claim consecutive observed overruns across measurement %s',
    (invalid) => {
      const monitor = new TickBudgetMonitor(8, 3, 0);
      [12, 12, invalid, 12].forEach((value) => monitor.record(value));
      expect(monitor.report()).toMatchObject({
        overruns: 3,
        longestOverrunStreak: 2,
        status: 'ok',
      });
      monitor.record(12);
      monitor.record(12);
      expect(monitor.report()).toMatchObject({
        overruns: 5,
        longestOverrunStreak: 3,
        status: 'degraded',
      });
      monitor.record(invalid);
      monitor.record(1);
      expect(monitor.report().status).toBe('degraded');
    },
  );

  it('keeps the original bucket convention for valid zero, exact-edge and overflow samples', () => {
    for (const [value, percentile] of [
      [0, 0.05],
      [0.05, 0.1],
      [8.35, 8.35],
      [50, 50.05],
      [500, 50.05],
    ]) {
      const monitor = new TickBudgetMonitor(1000, 3, 0);
      monitor.record(value);
      expect(monitor.report()).toMatchObject({ meanMs: value, worstMs: value });
      expect(monitor.report().p99Ms).toBeCloseTo(percentile, 12);
    }
    const zeroBudget = new TickBudgetMonitor(0, 1, 0);
    zeroBudget.record(0);
    expect(zeroBudget.report().overruns).toBe(0);
    zeroBudget.record(0.001);
    expect(zeroBudget.report()).toMatchObject({ overruns: 1, status: 'degraded' });
  });

  const invalidConfigurations: [number, number, number][] = [
    [-1, 12, 120],
    [NaN, 12, 120],
    [Infinity, 12, 120],
    [8.33, 0, 120],
    [8.33, -1, 120],
    [8.33, 0.5, 120],
    [8.33, NaN, 120],
    [8.33, Infinity, 120],
    [8.33, 12, -1],
    [8.33, 12, 0.5],
    [8.33, 12, NaN],
    [8.33, 12, Infinity],
  ];
  it.each(invalidConfigurations)(
    'rejects unusable monitor configuration %s/%s/%s',
    (budget, degradeAfter, warmup) => {
      expect(() => new TickBudgetMonitor(budget, degradeAfter, warmup)).toThrow();
    },
  );

  it('matches independently sorted reports over seeded mixed observations', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const next = random(47000 + seed),
        warmup = seed * 3,
        budget = 8.33,
        degradeAfter = 4,
        monitor = new TickBudgetMonitor(budget, degradeAfter, warmup),
        values: number[] = [];
      for (let i = 0; i < 512; i++) {
        const selector = Math.floor(next() * 16);
        const value =
          selector === 0
            ? NaN
            : selector === 1
              ? Infinity
              : selector === 2
                ? -1
                : (Math.floor(next() * 1400) + 0.25) * 0.05;
        values.push(value);
        monitor.record(value);
        if (i % 31 === 0 || i === 511) {
          const report = monitor.report();
          expect(report).toEqual(referenceReport(values, budget, degradeAfter, warmup));
          expect(monitor.report()).toEqual(report);
        }
      }
    }
  });
});
