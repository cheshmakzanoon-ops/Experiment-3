import { describe, expect, it, vi } from 'vitest';
import {
  CircuitPace,
  type CircuitPaceReason,
  type CircuitPaceRecord,
} from '../src/simulation/open-world/circuit-pace.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';

function steadyRun(hz: number, reference: CircuitPaceRecord | null = null, speed = 30) {
  const pace = new CircuitPace(900, reference);
  const duration = 900 / speed;
  for (let i = 1; i <= Math.ceil(duration * hz); i++) {
    const time = Math.min(duration, i / hz);
    pace.sample(time * speed, time);
  }
  return { pace, result: pace.finish(true, duration) };
}

describe('same-car circuit practice sectors', () => {
  it('interpolates physical sector crossings consistently across sample rates', () => {
    for (const hz of [12, 30, 120]) {
      const { pace, result } = steadyRun(hz, null, 31);
      expect(result).toMatchObject({ valid: true, newBest: true, referenceTime: null });
      expect(result.splits).toHaveLength(3);
      for (const split of result.splits) expect(split.time).toBeCloseTo(300 / 31, 8);
      expect(pace.record()?.time).toBeCloseTo(900 / 31, 8);
    }
  });

  it('compares all sectors with one complete best run and only replaces a faster clean run', () => {
    const baseline = steadyRun(30).pace.record()!;
    const faster = steadyRun(30, baseline, 36);
    expect(faster.result).toMatchObject({ newBest: true, referenceTime: 30, delta: -5 });
    for (const split of faster.result.splits) expect(split.delta).toBeCloseTo(-5 / 3, 8);
    const slower = steadyRun(30, baseline, 25);
    expect(slower.result).toMatchObject({ valid: true, newBest: false, delta: 6 });
    expect(slower.pace.record()).toBeNull();
    expect(baseline).toEqual({ time: 30, crossings: [10, 20, 30] });
  });

  it.each<CircuitPaceReason>(['off-road', 'contact', 'reset', 'autopilot'])(
    'keeps a %s run readable without accepting a record',
    (reason) => {
      const pace = new CircuitPace(900, steadyRun(30).pace.record());
      for (let i = 1; i <= 750; i++) {
        if (i === 15) pace.invalidate(reason);
        pace.sample((i / 30) * 36, i / 30);
      }
      expect(pace.finish(true, 25)).toMatchObject({ valid: false, reason, newBest: false });
      expect(pace.record()).toBeNull();
      expect(pace.status().splits).toHaveLength(3);
    },
  );

  it('does not earn another sector by reversing and re-driving the same metres', () => {
    const pace = new CircuitPace(900);
    pace.sample(310, 11);
    pace.sample(200, 15);
    pace.sample(310, 19);
    expect(pace.status().splits).toHaveLength(1);
    pace.sample(610, 30);
    expect(pace.status().splits).toHaveLength(2);
    expect(pace.status().splits[1].time).toBeGreaterThan(18);
    expect(pace.finish(false, 30)).toMatchObject({ valid: false, reason: 'incomplete' });
    expect(pace.record()).toBeNull();
  });

  it('rejects teleports and non-finite clocks and makes finishing idempotent', () => {
    const jumped = new CircuitPace(900);
    jumped.sample(600, 0.1);
    expect(jumped.status()).toMatchObject({ valid: false, reason: 'invalid-progress' });
    const invalid = new CircuitPace(900);
    invalid.sample(NaN, Infinity);
    expect(invalid.status()).toMatchObject({ valid: false, reason: 'invalid-progress' });
    expect(Number.isFinite(invalid.status().sectorElapsed)).toBe(true);
    const complete = steadyRun(30);
    expect(complete.pace.finish(false, 999)).toBe(complete.result);
    complete.pace.invalidate('reset');
    expect(complete.pace.record()?.time).toBe(30);
  });
});

describe('practice session integration', () => {
  it('invalidates a reset or enabled autopilot immediately and excludes multi-rival races', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false });
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    expect(sim.status().event?.practice).toMatchObject({ valid: true, sector: 1 });
    sim.command({ type: 'reset' });
    expect(sim.status().event?.practice).toMatchObject({ valid: false, reason: 'reset' });
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    sim.command({ type: 'autopilot', value: true });
    expect(sim.status().event?.practice).toMatchObject({ valid: false, reason: 'autopilot' });
    sim.command({ type: 'start', event: 'saltmarsh-club-race' });
    expect(sim.status().event?.practice).toBeNull();
  });

  it('closes a legal lap at its real finish gate, reuses the same-car best, and isolates a car change', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false });
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    const event = sim.events.find((candidate) => candidate.spec.id === 'saltmarsh-practice')!;
    const car = sim.player;
    // Analytic route motion isolates real RouteProgress/session timing from
    // tyre dynamics; full physical driving is covered by the club-run script.
    vi.spyOn(car, 'step').mockImplementation(() => {});
    vi.spyOn(sim.collisions, 'solve').mockImplementation(() => {});
    while (sim.mode === 'countdown') sim.step(1 / 120);
    const point = pathPoint();
    for (
      let distance = 14;
      distance < event.path.length + 3 && sim.mode === 'running';
      distance++
    ) {
      event.path.at(distance, point);
      car.body.position.set(point.x, point.y + 0.62, point.z);
      car.impact = 0;
      sim.step(1 / 30);
    }
    const result = sim.takeResult();
    expect(result?.completed).toBe(true);
    expect(result?.practice).toMatchObject({ valid: true, newBest: true });
    expect(result?.practice?.splits).toHaveLength(3);
    expect(result?.practice?.splits.reduce((sum, split) => sum + split.time, 0)).toBeCloseTo(
      result!.time!,
      8,
    );
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    expect(sim.status().event?.practice?.referenceTime).toBe(result!.time);
    sim.command({ type: 'vehicle', id: 'sc7' });
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    expect(sim.status().event?.practice?.referenceTime).toBeNull();
    sim.command({ type: 'vehicle', id: 'rh3' });
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    expect(sim.status().event?.practice?.referenceTime).toBe(result!.time);
    vi.restoreAllMocks();
  });
});
