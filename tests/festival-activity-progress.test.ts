import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import {
  activityProgress,
  type FestivalActivitySample,
} from '../src/simulation/open-world/activity-progress.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';

const sample: FestivalActivitySample = {
  elapsed: 20,
  legalDistance: 500,
  measuredDistance: 1000,
  speedKmh: 120,
  driftScore: 0,
  assisted: false,
  offRoute: false,
};

describe('live festival activity targets', () => {
  it('advances to the next star and retains the three-star threshold as a margin to maintain', () => {
    const spec = { kind: 'speed-trap' as const, stars: [100, 150, 200] as const };
    const first = activityProgress(spec, sample)!;
    expect(first).toMatchObject({
      metric: 'speed',
      value: 120,
      unit: 'KM/H',
      stars: 1,
      targetStars: 2,
      target: 150,
      delta: -30,
      progress: 0.8,
      remainingMeters: 500,
      requiredAverageKmh: null,
      provisional: true,
    });
    expect(activityProgress(spec, { ...sample, speedKmh: 220 })).toMatchObject({
      stars: 3,
      targetStars: 3,
      target: 200,
      delta: 20,
      progress: 1,
    });
    expect(activityProgress(spec, { ...sample, speedKmh: 99 })).toMatchObject({
      stars: 0,
      targetStars: 1,
      target: 100,
      delta: -1,
    });
  });

  it('uses measured net distance and elapsed time for average pace, including a rolling entry', () => {
    const spec = { kind: 'speed-zone' as const, stars: [80, 100, 120] as const };
    const pace = activityProgress(spec, sample)!;
    expect(pace).toMatchObject({
      metric: 'average-speed',
      value: 90,
      target: 100,
      stars: 1,
      targetStars: 2,
      delta: -10,
      remainingMeters: 500,
      targetTimeExpired: false,
    });
    // 1000 m at 100 km/h permits 36 s; 500 m in the 16 s remaining needs 112.5 km/h.
    expect(pace.requiredAverageKmh).toBeCloseTo(112.5, 8);
    const rolling = activityProgress(spec, { ...sample, measuredDistance: 980 })!;
    expect(rolling.remainingMeters).toBe(480);
    expect(rolling.requiredAverageKmh).toBeCloseTo((480 / (35.28 - 20)) * 3.6, 8);
    // Reversing reduces accepted net distance; it cannot improve a speed-zone target.
    const backingUp = activityProgress(spec, { ...sample, legalDistance: 450 })!;
    expect(backingUp.value).toBeLessThan(pace.value);
    expect(backingUp.requiredAverageKmh).toBeGreaterThan(pace.requiredAverageKmh!);
  });

  it('reports an expired timing budget without an infinite required speed', () => {
    const spec = { kind: 'speed-zone' as const, stars: [100, 120, 140] as const };
    const expired = activityProgress(spec, { ...sample, elapsed: 37 })!;
    expect(expired).toMatchObject({
      stars: 0,
      targetStars: 1,
      requiredAverageKmh: null,
      targetTimeExpired: true,
    });
    for (const value of Object.values(expired))
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  });

  it('keeps drift totals provisional, responds to a voided slide and preserves practice/route state', () => {
    const spec = { kind: 'drift-zone' as const, stars: [50, 300, 600] as const };
    expect(activityProgress(spec, { ...sample, driftScore: 69 })).toMatchObject({
      stars: 1,
      targetStars: 2,
      target: 300,
      delta: -231,
    });
    expect(activityProgress(spec, { ...sample, driftScore: 420 })).toMatchObject({
      metric: 'drift',
      value: 420,
      unit: 'PTS',
      stars: 2,
      targetStars: 3,
      target: 600,
      delta: -180,
      provisional: true,
    });
    expect(
      activityProgress(spec, { ...sample, driftScore: 0, assisted: true, offRoute: true }),
    ).toMatchObject({ value: 0, stars: 0, targetStars: 1, assisted: true, offRoute: true });
  });

  it('clips at the finish and never credits the braking run-out', () => {
    const spec = { kind: 'speed-zone' as const, stars: [80, 100, 120] as const };
    expect(activityProgress(spec, { ...sample, legalDistance: 1075, elapsed: 36 })).toMatchObject({
      value: 100,
      remainingMeters: 0,
      requiredAverageKmh: null,
      stars: 2,
    });
    expect(activityProgress(spec, { ...sample, elapsed: 0.1, legalDistance: 2 })).toMatchObject({
      value: 0,
      stars: 0,
    });
  });

  it('rejects malformed targets, non-activity events and invalid measurement samples', () => {
    const spec = { kind: 'speed-zone' as const, stars: [80, 100, 120] as const };
    for (const patch of [
      { elapsed: NaN },
      { elapsed: -1 },
      { speedKmh: Infinity },
      { legalDistance: NaN },
      { measuredDistance: 0 },
      { driftScore: Infinity },
    ])
      expect(activityProgress(spec, { ...sample, ...patch })).toBeNull();
    expect(activityProgress({ kind: 'sprint' }, sample)).toBeNull();
    expect(activityProgress({ kind: 'showcase', stars: [150, 140, 132] }, sample)).toBeNull();
    expect(activityProgress({ ...spec, stars: [80, 120, 100] }, sample)).toBeNull();
    expect(activityProgress({ ...spec, stars: [80, 100, NaN] }, sample)).toBeNull();
    expect(activityProgress({ ...spec, stars: [0, 100, 120] }, sample)).toBeNull();
  });
});

describe('festival activity physical admission', () => {
  it('does not activate a rolling gate while the car is physically reversing through it', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    const event = sim.events.find((e) => e.spec.id === 'coast-trap')!;
    const p = event.path.at(0, pathPoint());
    const car = sim.player;
    sim.placeAt(car, p.x + p.tx * 12, p.z + p.tz * 12, Math.atan2(p.tx, p.tz), p.y + 0.5);
    sim.setInput({ ...controls(), throttle: 0.2, reverse: true });
    car.body.velocity.set(-p.tx * 15, 0, -p.tz * 15);
    for (const tire of car.tires) tire.omega = -15 / tire.radius;
    for (let i = 0; i < 32; i++) sim.step(1 / 120);
    expect(car.body.velocity.x * p.tx + car.body.velocity.z * p.tz).toBeLessThan(-4);
    expect(sim.status().mode).toBe('free');
    expect(sim.status().event).toBeNull();
  });

  it('publishes actual live zone pace and reaches full measured progress at the real finish', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: 'plateau-zone' });
    const initial = sim.status().event!;
    const length = initial.challenge!.remainingMeters;
    const route = sim.events.find((e) => e.spec.id === 'plateau-zone')!;
    expect(length).toBeLessThan(route.distance); // entry station is excluded
    expect(initial.challenge).toMatchObject({ metric: 'average-speed', assisted: true });
    let observed = false;
    let result = sim.takeResult();
    for (let tick = 0; tick < 120 * 120 && !result; tick++) {
      sim.step(1 / 120);
      result = sim.takeResult();
      if (tick % 60 !== 0 || sim.mode !== 'running') continue;
      const event = sim.status().event!;
      if (event.elapsed < 2 || event.progress < 0.1) continue;
      const challenge = event.challenge!;
      const distance = length - challenge.remainingMeters;
      expect(challenge.value).toBeCloseTo((distance / event.elapsed) * 3.6, 7);
      expect(event.progress).toBeCloseTo(distance / length, 7);
      expect(event.live?.value).toBe(`${Math.round(challenge.value)} KM/H`);
      observed = true;
    }
    expect(observed).toBe(true);
    expect(result?.completed).toBe(true);
    const finished = sim.status().event!;
    expect(finished.progress).toBe(1);
    expect(finished.challenge).toBeNull();
    expect(finished.live?.value).toBe(`${Math.round(result!.averageKmh!)} KM/H`);
    expect(result!.averageKmh).toBeCloseTo((length / result!.time!) * 3.6, 7);
    // A race does not reuse an old skill target after a new start.
    sim.command({ type: 'start', event: 'harbour-welcome' });
    expect(sim.status().event!.challenge).toBeNull();
  });

  it('retries a finished activity with a new run identity and forwards each result only once', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'tc1',
      tileBudget: 12,
      session: 'activity-retry',
    });
    sim.command({ type: 'autopilot', value: true });
    const runIds: string[] = [];
    for (let run = 0; run < 2; run++) {
      sim.command({ type: 'start', event: 'coast-trap' });
      expect(sim.status().event).toMatchObject({ id: 'coast-trap', progress: 0 });
      expect(sim.status().event!.challenge?.stars).toBe(0);
      expect(sim.takeResult()).toBeNull();
      let result = sim.takeResult();
      for (let tick = 0; tick < 120 * 60 && !result; tick++) {
        sim.step(1 / 120);
        result = sim.takeResult();
      }
      expect(result?.completed).toBe(true);
      expect(result?.assisted).toBe(true);
      expect(sim.takeResult()).toBeNull();
      runIds.push(result!.runId);
    }
    expect(runIds).toEqual(['activity-retry:1', 'activity-retry:2']);
    expect(sim.results).toHaveLength(2);
    expect(new Set(sim.results.map((result) => result.runId)).size).toBe(2);
  });
});

describe('festival race retry handoff', () => {
  it('travels from a real completed race into a new run without replacing the pending result', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'tc1',
      tileBudget: 12,
      session: 'race-retry',
    });
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: 'valley-sprint' });
    for (let tick = 0; tick < 120 * 150 && sim.mode !== 'finished'; tick++) sim.step(1 / 120);
    expect(sim.mode).toBe('finished');
    const completed = sim.results[0];
    expect(completed).toMatchObject({ runId: 'race-retry:1', completed: true, abandoned: false });
    // The worker may receive travel/start before its next result drain. The
    // finalized result must survive, with no second abandonment for that run.
    sim.command({ type: 'travel', event: 'valley-sprint' });
    expect(sim.status().event).toBeNull();
    expect(sim.mode).toBe('free');
    expect(sim.cars).toHaveLength(1);
    const marker = sim.events.find((event) => event.spec.id === 'valley-sprint')!.marker;
    expect(
      Math.hypot(sim.player.body.position.x - marker.x, sim.player.body.position.z - marker.z),
    ).toBeLessThan(12);
    sim.command({ type: 'start', event: 'valley-sprint' });
    sim.step(1 / 120);
    expect(sim.mode).toBe('countdown');
    expect(sim.takeResult()).toBe(completed);
    expect(sim.takeResult()).toBeNull();
    expect(sim.results).toHaveLength(1);
    let retry = sim.takeResult();
    for (let tick = 0; tick < 120 * 150 && !retry; tick++) {
      sim.step(1 / 120);
      retry = sim.takeResult();
    }
    expect(retry).toMatchObject({ runId: 'race-retry:2', completed: true, abandoned: false });
    expect(sim.results.map((result) => result.runId)).toEqual(['race-retry:1', 'race-retry:2']);
    expect(sim.takeResult()).toBeNull();
  });

  it('abandons an active race once and makes finalized cancel/garage exits idempotent', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', session: 'race-exit' });
    sim.command({ type: 'start', event: 'valley-sprint' });
    sim.command({ type: 'travel', event: 'valley-sprint' });
    expect(sim.mode).toBe('free');
    expect(sim.cars).toHaveLength(1);
    const travelled = sim.takeResult();
    expect(travelled).toMatchObject({ runId: 'race-exit:1', completed: false, abandoned: true });
    sim.command({ type: 'cancel' });
    expect(sim.takeResult()).toBeNull();
    for (const action of ['cancel', 'vehicle'] as const) {
      sim.command({ type: 'start', event: 'valley-sprint' });
      sim.command({ type: 'cancel' });
      expect(sim.mode).toBe('finished');
      const pending = sim.results.at(-1);
      const count = sim.results.length;
      // Cancel/garage can be activated while an abandoned result is still
      // pending. They must not replace it or create another reward event.
      sim.command(action === 'vehicle' ? { type: 'vehicle', id: 'rd2' } : { type: 'cancel' });
      expect(sim.mode).toBe('free');
      expect(sim.results).toHaveLength(count);
      expect(sim.takeResult()).toBe(pending);
      expect(sim.takeResult()).toBeNull();
    }
    expect(sim.results.map((result) => result.runId)).toEqual([
      'race-exit:1',
      'race-exit:2',
      'race-exit:3',
    ]);
  });
});
