import { describe, expect, it } from 'vitest';
import { recordFestivalBest, validateFestivalSave, type FestivalSave } from '../src/session/festival-save.ts';
import type { FestivalResult } from '../src/simulation/open-world/festival-result.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import type { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  approachPath,
  DT,
  defaultRun,
  newSim,
  Pilot,
  runActivity,
} from '../scripts/studio/tools/festival-qa.ts';

/** Festival edge cases a person causes: leaving the route, driving the wrong
 * way, flipping, quitting, starting one event over another, weather that
 * changes, saving mid-world and playing two sessions in one page. They run
 * the production session headless with the QA pilot (festival-qa.ts) as the
 * player (scripts/studio/tools/festival-qa.ts). */
const VEHICLE = 'rs5';
const make = (extra: { discovered?: readonly string[]; session?: string } = {}, weather = 'clear' as const) =>
  newSim(defaultRun('', { vehicle: VEHICLE, weather }), { session: 'qa-edge', ...extra });
const event = (sim: OpenWorldSimulation, id: string) => sim.events.find((e) => e.spec.id === id)!;
/** Step `seconds` of simulated time, driving with the pilot when given. */
function run(sim: OpenWorldSimulation, seconds: number, pilot?: Pilot, until?: () => boolean) {
  const results: FestivalResult[] = [];
  for (let i = 0; i < seconds * 120; i++) {
    pilot?.step(DT, sim.mode === 'countdown', sim.mode === 'finished');
    sim.step(DT);
    const r = sim.takeResult();
    if (r) results.push(r);
    if (until?.()) break;
  }
  return results;
}
/** Start a race from its marker card exactly as the HUD button does. */
function startRace(sim: OpenWorldSimulation, id: string) {
  sim.command({ type: 'travel', event: id });
  run(sim, 0.5);
  expect(sim.status().card?.id).toBe(id);
  sim.command({ type: 'start', event: id });
  const pilot = new Pilot(sim, event(sim, id).path);
  run(sim, 4, pilot, () => sim.mode === 'running');
  expect(sim.mode).toBe('running');
  return pilot;
}

describe('festival edge cases: leaving the route', () => {
  it('fails a speed trap quickly when the driver leaves the route, with no result and no pay', () => {
    const sim = make();
    const trap = event(sim, 'coast-trap'),
      up = approachPath(trap, 260)!;
    sim.command({ type: 'travel', event: 'coast-trap' });
    const p = pathPoint();
    up.path.at(0, p);
    sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
    const pilot = new Pilot(sim, up.path, 0.9);
    pilot.horizon = up.entry + trap.distance;
    run(sim, 20, pilot, () => sim.mode === 'running');
    expect(sim.status().event?.id).toBe('coast-trap');
    // A shortcut across the verge: 120 m from the road is off every edge.
    trap.path.at(80, p);
    sim.placeAt(sim.player, p.x + p.nx * 120, p.z + p.nz * 120, Math.atan2(p.tx, p.tz), p.y + 1);
    const results = run(sim, 4);
    expect(results).toEqual([]);
    expect(sim.mode).toBe('free');
    expect(sim.results).toHaveLength(0);
    expect(sim.status().message).toMatch(/failed/i);
  }, 60_000);
  it('abandons a race that stays off the route for 25 s, paying nothing', () => {
    const sim = make();
    const pilot = startRace(sim, 'valley-sprint');
    run(sim, 6, pilot);
    const path = event(sim, 'valley-sprint').path,
      p = pathPoint();
    path.at(300, p);
    sim.placeAt(sim.player, p.x + p.nx * 150, p.z + p.nz * 150, Math.atan2(p.tx, p.tz), p.y + 1);
    expect(run(sim, 20)).toEqual([]);
    const [result] = run(sim, 8);
    expect(result).toBeDefined();
    expect(result.abandoned).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.stars).toBe(0);
    expect(result.time).toBeNull();
    expect(result.offRouteSeconds).toBeGreaterThan(20);
    expect(sim.mode).toBe('finished');
    sim.command({ type: 'continue' });
    expect(sim.mode).toBe('free');
    expect(sim.cars).toHaveLength(1);
  }, 90_000);
  it('gives no credit for driving the route the wrong way', () => {
    const sim = make();
    const pilot = startRace(sim, 'valley-sprint');
    run(sim, 14, pilot);
    const before = sim.status().event!.progress;
    expect(before).toBeGreaterThan(0.05);
    const b = sim.player.body.position,
      q = sim.player.body.orientation;
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    sim.placeAt(sim.player, b.x, b.z, heading + Math.PI, b.y);
    sim.setInput({ ...sim.player.input, throttle: 1, brake: 0, steer: 0 });
    for (let i = 0; i < 120 * 8; i++) {
      sim.setInput({ ...sim.player.input, throttle: 1, brake: 0, steer: 0 });
      sim.step(DT);
    }
    expect(sim.status().event!.progress).toBeLessThan(before + 0.01);
  }, 60_000);
});

describe('festival edge cases: flipping and respawn', () => {
  it('puts a flipped car back on the route at its legal progress and the race can still be won', () => {
    const sim = make();
    const pilot = startRace(sim, 'harbour-welcome');
    run(sim, 12, pilot);
    const flipped = sim.player,
      before = sim.status().event!.progress;
    flipped.body.orientation.x = 1;
    flipped.body.orientation.y = 0;
    flipped.body.orientation.z = 0;
    flipped.body.orientation.w = 0;
    flipped.body.velocity.set(0, 0, 0);
    flipped.body.omega.set(0, 0, 0);
    run(sim, 5);
    expect(sim.player).not.toBe(flipped);
    expect(sim.player.up.y).toBeGreaterThan(0.9);
    const status = sim.status();
    expect(status.event!.offRoute).toBe(false);
    // Back at the legal progress, never ahead of it.
    expect(status.event!.progress).toBeLessThan(before + 0.02);
    const [result] = run(sim, 240, pilot, () => sim.mode === 'finished');
    expect(result.completed).toBe(true);
    expect(result.legalDistance).toBeGreaterThan(event(sim, 'harbour-welcome').distance * 0.9);
    expect(sim.results).toHaveLength(1);
  }, 120_000);
});

describe('festival edge cases: quitting and overlapping events', () => {
  it('quitting mid-race emits exactly one abandoned result and the next run gets a new run id', () => {
    const sim = make();
    const pilot = startRace(sim, 'valley-sprint');
    run(sim, 8, pilot);
    sim.command({ type: 'cancel' });
    const first = sim.takeResult();
    expect(first).not.toBeNull();
    expect(first!.abandoned).toBe(true);
    expect(first!.completed).toBe(false);
    expect(first!.runId).toBe('qa-edge:1');
    // Cancel again and Continue from the results card: nothing more is emitted.
    sim.command({ type: 'cancel' });
    sim.command({ type: 'continue' });
    expect(sim.takeResult()).toBeNull();
    expect(sim.mode).toBe('free');
    expect(sim.cars).toHaveLength(1);
    expect(sim.results).toHaveLength(1);
    sim.command({ type: 'start', event: 'valley-sprint' });
    sim.command({ type: 'cancel' });
    expect(sim.takeResult()!.runId).toBe('qa-edge:2');
  }, 60_000);
  it('quitting during the countdown abandons cleanly', () => {
    const sim = make();
    sim.command({ type: 'travel', event: 'valley-sprint' });
    sim.command({ type: 'start', event: 'valley-sprint' });
    run(sim, 1);
    expect(sim.mode).toBe('countdown');
    sim.command({ type: 'cancel' });
    const result = sim.takeResult()!;
    expect(result.abandoned).toBe(true);
    expect(result.time).toBeNull();
    expect(result.legalDistance).toBe(0);
    sim.command({ type: 'continue' });
    expect(sim.mode).toBe('free');
  });
  it('starting an event while another runs abandons the first once, then runs the second', () => {
    const sim = make();
    const pilot = startRace(sim, 'valley-sprint');
    run(sim, 6, pilot);
    sim.command({ type: 'start', event: 'harbour-welcome' });
    const abandoned = sim.takeResult()!;
    expect(abandoned.eventId).toBe('valley-sprint');
    expect(abandoned.abandoned).toBe(true);
    expect(sim.mode).toBe('countdown');
    expect(sim.status().event?.id).toBe('harbour-welcome');
    expect(sim.cars).toHaveLength(3);
    const second = new Pilot(sim, event(sim, 'harbour-welcome').path);
    const results = run(sim, 240, second, () => sim.mode === 'finished');
    expect(results).toHaveLength(1);
    expect(results[0].eventId).toBe('harbour-welcome');
    expect(results[0].completed).toBe(true);
    expect(results[0].runId).toBe('qa-edge:2');
    expect(sim.results.map((r) => r.eventId)).toEqual(['valley-sprint', 'harbour-welcome']);
  }, 120_000);
  it('starting a race over a running skill challenge fails the challenge without a result', () => {
    const sim = make();
    sim.command({ type: 'start', event: 'coast-trap' });
    expect(sim.mode).toBe('running');
    sim.command({ type: 'start', event: 'valley-sprint' });
    expect(sim.takeResult()).toBeNull();
    expect(sim.mode).toBe('countdown');
    expect(sim.status().event?.id).toBe('valley-sprint');
    expect(sim.results).toHaveLength(0);
  });
});

describe('festival edge cases: weather', () => {
  it('a changeable sky changes during a session and events still finish with finite results', () => {
    const sim = newSim(defaultRun('', { vehicle: VEHICLE, weather: 'changeable' }), { session: 'qa-edge' });
    const rain: number[] = [];
    const sample = () => rain.push(sim.track.rain);
    sample();
    for (let t = 0; t < 8; t++) {
      run(sim, 30);
      sample();
    }
    expect(Math.max(...rain) - Math.min(...rain)).toBeGreaterThan(0.01);
    const trap = runActivity(defaultRun('coast-trap', { vehicle: VEHICLE, weather: 'changeable' }), { sim });
    expect(trap.outcome).toBe('completed');
    expect(trap.nan).toEqual([]);
    expect(trap.checks.filter((c) => !c.ok)).toEqual([]);
  }, 120_000);
});

describe('festival edge cases: saving and sessions', () => {
  it('a save made mid-world reloads with the same discoveries, and junk best entries are dropped', () => {
    const first = make();
    for (const id of ['pass-zone', 'quarry-drift', 'coast-trap']) first.command({ type: 'travel', event: id });
    run(first, 1);
    const save: FestivalSave = {
      version: 1,
      discovered: [...first.discovered],
      best: { 'coast-trap': { stars: 2, time: null, value: 251.5 } },
      vehicle: VEHICLE,
      traffic: true,
    };
    const back = validateFestivalSave(JSON.parse(JSON.stringify(save)))!;
    expect(back).toEqual(save);
    const second = make({ discovered: back.discovered });
    expect([...second.discovered].sort()).toEqual([...first.discovered].sort());
    expect(second.status().discovered.sort()).toEqual([...first.discovered].sort());
    // A damaged file keeps what is readable and nothing else.
    const damaged = validateFestivalSave({
      version: 1,
      discovered: ['coast-trap', 7, null],
      vehicle: VEHICLE,
      best: {
        'coast-trap': { stars: 9, time: Number.NaN, value: 'fast' },
        'pass-zone': { stars: 1, time: 20.5, value: 150 },
        '<script>': { stars: 1, time: 1, value: 1 },
      },
    })!;
    expect(damaged.discovered).toEqual(['coast-trap']);
    expect(Object.keys(damaged.best)).toEqual(['pass-zone']);
    expect(validateFestivalSave({ version: 1, discovered: [], vehicle: VEHICLE, best: [1, 2] })!.best).toEqual({});
  });
  it('records the best of two runs and ignores assisted or unfinished ones', () => {
    const save: FestivalSave = { version: 1, discovered: [], best: {}, vehicle: VEHICLE };
    const run1 = { eventId: 'e', completed: true, assisted: false, stars: 1, time: 50, trapKmh: null, averageKmh: null, driftScore: null } as unknown as FestivalResult;
    expect(recordFestivalBest(save, run1)).toBe(true);
    expect(recordFestivalBest(save, { ...run1, stars: 3, time: 60 })).toBe(true);
    expect(save.best.e).toEqual({ stars: 3, time: 50, value: null });
    expect(recordFestivalBest(save, { ...run1, assisted: true, stars: 3, time: 1 })).toBe(false);
    expect(recordFestivalBest(save, { ...run1, completed: false, stars: 0, time: null })).toBe(false);
    expect(save.best.e.time).toBe(50);
  });
  it('two sessions in one page share the world but not state, and play identically', () => {
    const a = runActivity(defaultRun('coast-trap', { vehicle: VEHICLE }));
    const second = make();
    expect(second.discovered.size).toBe(0);
    expect(second.results).toHaveLength(0);
    expect(second.time).toBe(0);
    const b = runActivity(defaultRun('coast-trap', { vehicle: VEHICLE }));
    expect(a.outcome).toBe('completed');
    expect([b.time, b.score, b.stars]).toEqual([a.time, a.score, a.stars]);
    expect(b.checks.filter((c) => !c.ok)).toEqual([]);
    // The world is shared per thread (a deliberate cache), so a session must
    // not leave anything mutable behind: residency stays within its budget.
    const sim = make();
    run(sim, 20, new Pilot(sim, event(sim, 'valley-sprint').path));
    expect(sim.status().streaming.resident).toBeLessThanOrEqual(24);
    expect(make().world).toBe(sim.world);
  }, 120_000);
});
