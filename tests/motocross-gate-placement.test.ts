import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { OffroadSession, gateSlots } from '../src/simulation/offroad/session.ts';
import { O, OFFROAD_BASE, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
const GRID = [2, 0, 3, 1];
const CHOSEN = [9, 0, 7, 3];

function field(options: Partial<SessionOptions> = {}) {
  return new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: 'valley-ridge-mx',
    mode: 'race',
    ruleset: 'motocross-moto',
    opponents: 3,
    vehicles: ['mx450', 'mx250', 'mx450', 'mx250'],
    grid: [...GRID],
    ...options,
  });
}

function expectPlacement(sim: Simulation, expected: readonly number[], session = sim.offroad!) {
  const slots = gateSlots(sim.track, session.course, sim.cars.length);
  const point = trackPoint();
  for (const car of sim.cars) {
    const slot = expected[car.id];
    const lateral = slots.lateral[slot];
    expect(session.entrants[car.id]).toMatchObject({ slot, slotS: car.s, slotLateral: lateral });
    expect(car.lateral).toBeCloseTo(lateral, 8);
    // Check the physical body as well as its track-coordinate metadata.
    sim.track.at(car.s, point);
    expect(car.body.position.x).toBeCloseTo(point.x + point.nx * lateral, 8);
    expect(car.body.position.z).toBeCloseTo(point.z + point.nz * lateral, 8);
  }
}

function defaultPicks(sim: Simulation) {
  const slots = gateSlots(sim.track, sim.offroad!.course, sim.cars.length);
  const order = sim.options.grid ?? sim.cars.map((car) => car.id);
  return sim.cars.map((car) => slots.preference[order.indexOf(car.id)]);
}

describe('motocross gate placement', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'places explicit per-rider choices independently of grid order on %s',
    (circuit) => {
      const sim = field({ circuit, gates: [...CHOSEN] });
      expectPlacement(sim, CHOSEN);
      const frame = sim.makeFrame();
      for (const car of sim.cars)
        expect(frame[carBase(car.id) + OFFROAD_BASE + O.SLOT]).toBe(CHOSEN[car.id] + 1);
    },
  );

  it('accepts choices across an expanded twelve-rider gate in endurance', () => {
    const gates = [11, 2, 9, 0, 7, 4, 10, 1, 8, 3, 6, 5];
    const sim = field({
      mode: 'endurance',
      opponents: 11,
      vehicles: Array(12).fill('mx450'),
      grid: [8, 3, 1, 10, 0, 11, 9, 4, 7, 2, 5, 6],
      gates,
    });
    expectPlacement(sim, gates);
  });

  it.each([
    { name: 'entrant order', grid: undefined },
    { name: 'qualifying order', grid: GRID },
  ])('keeps the preferred slots in $name without explicit choices', ({ grid }) => {
    const sim = field({ grid });
    expectPlacement(sim, defaultPicks(sim));
  });

  it('holds a selected gate through physics and a closed-gate correction without crossing lanes', () => {
    const sim = field({ gates: [...CHOSEN] });
    const start = sim.cars.map((car) => ({ s: car.s, lateral: car.lateral }));
    const player = sim.cars[0];
    // Put the front contact through the closed gate along the same lane,
    // then run the real substeps and gate wall correction.
    player.place(sim.track, start[0].s + 0.65, start[0].lateral);
    sim.step(DT);
    expect(sim.race.phase).toBe(PHASE.LIGHTS);
    expect(player.s).toBeCloseTo(start[0].s, 8);
    expect(player.lateral).toBeCloseTo(start[0].lateral, 8);
    for (let tick = 0; tick < 60; tick++) {
      sim.step(DT);
      for (const car of sim.cars)
        expect(Math.abs(car.lateral - start[car.id].lateral)).toBeLessThan(0.05);
    }
    expect(sim.offroad!.entrants.map((entrant) => entrant.slot)).toEqual(CHOSEN);
  });

  const invalid: { name: string; gates: number[] }[] = [
    { name: 'a slot beyond this venue', gates: [9, 0, 7, 10] },
    { name: 'a slot at the global limit', gates: [9, 0, 7, 31] },
    { name: 'duplicate slots', gates: [9, 0, 7, 7] },
    { name: 'a negative slot', gates: [9, 0, -1, 3] },
    { name: 'a fractional slot', gates: [9, 0, 7.5, 3] },
    { name: 'a NaN slot', gates: [9, 0, Number.NaN, 3] },
    { name: 'an infinite slot', gates: [9, 0, Infinity, 3] },
    { name: 'a partial choice', gates: [9, 0, 7] },
    { name: 'too many choices', gates: [9, 0, 7, 3, 5] },
    { name: 'a sparse choice', gates: new Array<number>(4) },
  ];
  it.each(invalid)('falls back as a complete field for $name', ({ gates }) => {
    const sim = field({ gates });
    const expected = defaultPicks(sim);
    expectPlacement(sim, expected);
    // These entry points also serve callers outside Simulation's option
    // validation, and must apply the same all-or-nothing assignment policy.
    const raw = { ...sim.options, gates };
    OffroadSession.place(sim.track, sim.cars, raw);
    const session = new OffroadSession(sim.track, sim.cars, sim.race, raw);
    expectPlacement(sim, expected, session);
  });

  it('preserves supermoto gate choices through the same assignment', () => {
    const sim = field({
      ruleset: 'supermoto-moto',
      vehicles: Array(4).fill('sm450'),
      gates: [...CHOSEN],
    });
    expectPlacement(sim, CHOSEN);
  });

  it.each([
    { circuit: 'valley-ridge-mx', mode: 'practice', ruleset: 'motocross-moto', machine: 'mx450' },
    { circuit: 'kestrel-rx', mode: 'race', ruleset: 'rallycross-joker', machine: 'rcx6' },
    { circuit: 'pinewood-stage', mode: 'race', ruleset: 'rally-stage', machine: 'rl2' },
  ] as const)('keeps $ruleset $mode placement independent of gate choices', (options) => {
    const sim = field({ ...options, vehicles: Array(4).fill(options.machine) });
    const before = sim.cars.map((car) => [car.s, car.lateral]);
    OffroadSession.place(sim.track, sim.cars, { ...sim.options, gates: [...CHOSEN] });
    expect(sim.cars.map((car) => [car.s, car.lateral])).toEqual(before);
  });
});
