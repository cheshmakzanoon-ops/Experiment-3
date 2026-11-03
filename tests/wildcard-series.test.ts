import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settleRace } from '../src/career/economy.ts';
import {
  disciplineVenues,
  liveRegistry,
  rulesetsFor,
  vehicleDiscipline,
} from '../src/career/registry.ts';
import type { CareerVehicle } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import {
  WILDCARD_EVENTS,
  WILDCARD_SERIES,
  isWildcardEvent,
  wildcardCareerEvent,
  wildcardDiscipline,
  wildcardEntry,
  wildcardKey,
  wildcardMedal,
  wildcardMedalFromRecord,
  wildcardSeries,
  wildcardSession,
  type WildcardEntry,
} from '../src/career/wildcard-series.ts';
import { validateWildcardSeries, wildcardHash } from '../src/career/wildcard-validation.ts';
import { vehicleFamily } from '../src/simulation/bike-definitions.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Quat, Vec3 } from '../src/core/math.ts';
import { AI_BASE_SKILL, DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { PLACE_ALIGN_SLOPE } from '../src/simulation/vehicle.ts';
import { EVENTS, RULESETS, sessionIncompatibilities } from '../src/simulation/events.ts';
import { offroadCourse, venueAdmits } from '../src/simulation/offroad/venues.ts';
import { CROSSOVER_ADMITS, WILDCARD_RULESETS } from '../src/simulation/wildcard-rulesets.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { WEATHER_CATALOGUE } from '../src/simulation/weather-catalogue.ts';
import { Simulation } from '../src/simulation/world.ts';

const BIKE_ROAD = new Set(['gp-bike', 'superbike', 'supersport', 'classic-bike']);
const BIKE_DIRT = new Set(['motocross', 'supermoto']);
const CAR_DIRT = new Set(['rally', 'historic-rally', 'rallycross', 'offroad']);
const classOf = (entry: WildcardEntry) => VEHICLES[[entry.event.vehicles].flat()[0]].classId;
/** The pairing's mismatch, computed from the data the engine reads (not from
 * the entry's own label): why the machine's ordinary rules would refuse or
 * never offer this venue. Null: the machine belongs at the venue. */
function mismatch(entry: WildcardEntry): string | null {
  const cls = classOf(entry),
    circuit = CIRCUITS[entry.event.circuit],
    terrain = offroadCourse(circuit);
  if (terrain && !venueAdmits(circuit, cls))
    return 'machine on a terrain venue built for another discipline';
  if (BIKE_ROAD.has(cls) && !circuit.bikeSafe)
    return 'road motorcycle on a circuit not assessed bike-safe';
  if (BIKE_DIRT.has(cls) && !terrain) return 'dirt motorcycle on a paved circuit';
  if (CAR_DIRT.has(cls) && !terrain) return 'off-road car on a paved circuit';
  return null;
}
const evidence = JSON.parse(readFileSync('docs/wildcard-races.json', 'utf8')) as {
  criteria: Record<string, unknown>;
  events: Record<
    string,
    {
      hash: string;
      passed: boolean;
      failures: string[];
      cars: number;
      mode: string;
      assist: string;
      ruleset: string;
      aiSkill: number | null;
      fastestLapS: number | null;
      ladderCheck: { winnerMedal: string | null };
      classification: {
        finishTimeS: number;
        laps: number;
        retired: boolean;
        crashes: number | null;
      }[];
    }
  >;
};

describe('the wildcard series data', () => {
  it('has at least fourteen events, at least four of them genuinely cross-discipline', () => {
    expect(WILDCARD_SERIES.length).toBeGreaterThanOrEqual(14);
    expect(wildcardSeries()).toBe(WILDCARD_SERIES);
    expect(WILDCARD_EVENTS).toHaveLength(WILDCARD_SERIES.length);
    const crossing = WILDCARD_SERIES.filter((e) => mismatch(e));
    expect(crossing.length).toBeGreaterThanOrEqual(4);
    // The label agrees with the data: a cross-discipline entry is a real
    // discipline crossing, and the other entries are circuit machines on a
    // circuit that is not theirs.
    for (const e of WILDCARD_SERIES)
      expect(e.kind === 'cross-discipline', `${e.id}: ${mismatch(e)}`).toBe(!!mismatch(e));
  });
  it('uses unique ids and seeds, and every referenced machine, venue and ruleset exists', () => {
    expect(new Set(WILDCARD_SERIES.map((e) => e.id)).size).toBe(WILDCARD_SERIES.length);
    expect(new Set(WILDCARD_SERIES.map((e) => e.event.seed)).size).toBe(WILDCARD_SERIES.length);
    expect(new Set(WILDCARD_SERIES.map((e) => e.title)).size).toBe(WILDCARD_SERIES.length);
    for (const e of WILDCARD_SERIES) {
      for (const id of [e.event.vehicles].flat())
        expect(VEHICLES[id], `${e.id}: ${id}`).toBeDefined();
      expect(CIRCUITS[e.event.circuit], `${e.id}: ${e.event.circuit}`).toBeDefined();
      expect(RULESETS[e.event.ruleset], `${e.id}: ${e.event.ruleset}`).toBeDefined();
      expect(wildcardEntry(e.id)).toBe(e);
      expect(isWildcardEvent(e.id)).toBe(true);
    }
    expect(isWildcardEvent('aurel-touring-sprint')).toBe(false);
    expect(wildcardEntry('nope')).toBeUndefined();
  });
  it('does not collide with any built-in event', () => {
    const ids = new Set(EVENTS.map((e) => e.id));
    for (const e of WILDCARD_SERIES) expect(ids.has(e.id), e.id).toBe(false);
  });
  it('passes the series content rules (copy, ladder, pairing)', () => {
    expect(validateWildcardSeries()).toEqual([]);
  });
  it('rejects bad copy, ladders and pairings', () => {
    const [first] = WILDCARD_SERIES;
    const bad = (patch: Partial<WildcardEntry>) =>
      validateWildcardSeries([{ ...first, ...patch } as WildcardEntry]).join('; ');
    expect(bad({ pitch: 'A MotoGP rider on the Monza banking.' })).toMatch(
      /protected real-world name/,
    );
    expect(bad({ title: 'lowercase title' })).toMatch(/uppercase/);
    expect(bad({ pitch: 'x'.repeat(141) })).toMatch(/pitch must be 1-140/);
    expect(bad({ ladder: { metric: first.ladder.metric, gold: 5, silver: 3, bronze: 2 } })).toMatch(
      /ordered/,
    );
    expect(bad({ event: { ...first.event, vehicles: 'no-such-machine' } })).toMatch(
      /unknown vehicle no-such-machine/,
    );
    expect(validateWildcardSeries([first, first]).join()).toMatch(/duplicate id/);
  });
  it('varies the weather, venue and discipline', () => {
    expect(new Set(WILDCARD_SERIES.map((e) => e.event.weather)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(WILDCARD_SERIES.map((e) => e.event.circuit)).size).toBeGreaterThanOrEqual(10);
    const families = new Set(
      WILDCARD_SERIES.map((e) => vehicleFamily(VEHICLES[[e.event.vehicles].flat()[0]])),
    );
    expect(families.size).toBeGreaterThanOrEqual(2);
  });
  it('uses the fog, thunderstorm and dust presets where they fit the venue', () => {
    const weather = (id: string) => wildcardEntry(id)!.event.weather;
    // "In the cloud" is fog; a harbour street takes a thunderstorm; a rallycross
    // gravel circuit takes a dust storm. Each was re-run headlessly after the change.
    expect(weather('descent-in-the-cloud')).toBe('fog');
    expect(weather('hypercars-in-the-harbour')).toBe('storm');
    expect(weather('supermoto-meets-the-joker')).toBe('dust');
    const used = new Set(WILDCARD_SERIES.map((e) => e.event.weather));
    for (const id of ['fog', 'storm', 'dust'] as const) expect(used.has(id), id).toBe(true);
    // The copy describes the weather the data runs (the pitch is read on the board).
    expect(wildcardEntry('descent-in-the-cloud')!.pitch).toMatch(/fog/i);
    expect(wildcardEntry('hypercars-in-the-harbour')!.pitch).toMatch(/thunderstorm/i);
    expect(wildcardEntry('supermoto-meets-the-joker')!.pitch).toMatch(/dust/i);
  });
  it('races on wets in every weather the catalogue asks wets for', () => {
    for (const e of WILDCARD_SERIES) {
      const wanted = WEATHER_CATALOGUE[e.event.weather].suggestedTyre === 'wet';
      const allowed = RULESETS[e.event.ruleset].tires.allowed.includes('wet');
      expect(e.event.compound, e.id).toBe(wanted && allowed ? 'wet' : 'medium');
    }
    expect(wildcardEntry('hypercars-in-the-harbour')!.event.compound).toBe('wet');
  });
});

describe('wildcard pairings in the rules', () => {
  it('resolves every event through eventSession with no incompatibility', () => {
    for (const e of WILDCARD_SERIES) {
      const options = wildcardSession(e, DEFAULT_OPTIONS);
      expect(sessionIncompatibilities(options), e.id).toEqual([]);
      expect(options.vehicles).toHaveLength(e.event.opponents + 1);
      expect(options.aiSkill).toBe(e.event.aiSkill);
      expect(options.assist === 'raw', e.id).toBe(e.rules.includes('no-assists'));
      expect(options.mode, e.id).toBe(e.rules.includes('time-attack') ? 'time-trial' : 'race');
      // The player's own menu choices (setup) survive.
      const setup = { ...DEFAULT_OPTIONS.setup };
      expect(wildcardSession(e, { ...DEFAULT_OPTIONS, setup }).setup).toEqual(setup);
    }
  });
  it('keeps the wildcard rulesets out of the ordinary class lookup and the career ladder', () => {
    const live = liveRegistry();
    const ordinary = (id: string, want: string) =>
      expect(rulesetsFor(live, id, 'race')[0]?.id, id).toBe(want);
    ordinary('gp-bike', 'gp-motorcycle');
    ordinary('superbike', 'gp-motorcycle');
    ordinary('supersport', 'motorcycle-class-sprint');
    ordinary('motocross', 'motocross-moto');
    ordinary('supermoto', 'supermoto-moto');
    ordinary('gt', 'gt-sprint');
    ordinary('formula', 'formula-grand-prix');
    ordinary('rallycross', 'rallycross-heat');
    ordinary('road', 'open-exhibition');
    // And no class's first race ruleset is a wildcard one.
    for (const cls of new Set(Object.values(VEHICLES).map((v) => v.classId)))
      expect(rulesetsFor(live, cls, 'race')[0]?.id ?? '', cls).not.toMatch(/^wildcard-/);
    // The bike career still offers only the assessed circuits.
    const venues = disciplineVenues(live, 'road-bikes').map((v) => v.id);
    for (const e of WILDCARD_SERIES)
      if (BIKE_ROAD.has(classOf(e)) && !CIRCUITS[e.event.circuit].bikeSafe)
        expect(venues, e.id).not.toContain(e.event.circuit);
    // The career registry's event list is untouched.
    for (const e of WILDCARD_SERIES) expect(live.events.some((x) => x.id === e.id)).toBe(false);
    expect(Object.keys(WILDCARD_RULESETS).every((id) => id.startsWith('wildcard-'))).toBe(true);
  });
  it('still refuses the same pairings under the ordinary rules', () => {
    const base = { ...DEFAULT_OPTIONS, mode: 'race' as const, laps: 2, opponents: 1 };
    // A GP bike on the docklands: the bike-safe gate stands.
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'dockyard',
        ruleset: 'gp-motorcycle',
        vehicles: ['gpr1', 'gpr1'],
      }).join(),
    ).toMatch(/bike-safe/);
    // A GT car on a motocross track: the venue's own machines only.
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'valley-ridge-mx',
        ruleset: 'gt-sprint',
        vehicles: ['gt8f', 'gt8f'],
      }).join(),
    ).toMatch(/cannot race at/);
    // The crossover table is an allow-list of evidenced pairings: a GT car
    // stays off the motocross course even under the wildcard ruleset, and a
    // GT car is admitted at the rallycross circuit.
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'valley-ridge-mx',
        ruleset: 'wildcard-machines',
        vehicles: ['gt8f', 'gt8f'],
      }).join(),
    ).toMatch(/cannot race at/);
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'kestrel-rx',
        ruleset: 'wildcard-machines',
        vehicles: ['gt8f', 'gt8f'],
      }),
    ).toEqual([]);
    // A GP bike is not a terrain machine.
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'valley-ridge-mx',
        ruleset: 'wildcard-riders',
        vehicles: ['gpr1', 'gpr1'],
      }).join(),
    ).toMatch(/cannot race at/);
    // Cars and motorcycles still never share a grid.
    expect(
      sessionIncompatibilities({
        ...base,
        circuit: 'speedbowl',
        ruleset: 'wildcard-machines',
        vehicles: ['gt8f', 'mx450'],
      }).join(),
    ).toMatch(/cannot share a grid/);
    for (const [kind, classes] of Object.entries(CROSSOVER_ADMITS))
      for (const cls of classes ?? []) expect(typeof cls, kind).toBe('string');
  });
});

describe('seeded AI race evidence (npm run test:wildcard)', () => {
  it('has a passing, current race for every event', () => {
    for (const e of WILDCARD_SERIES) {
      const r = evidence.events[e.id];
      expect(r, `${e.id}: no race evidence (run npm run test:wildcard ${e.id})`).toBeDefined();
      expect(r.hash, `${e.id}: stale evidence, rerun npm run test:wildcard ${e.id}`).toBe(
        wildcardHash(e),
      );
      expect(r.failures, e.id).toEqual([]);
      expect(r.passed, e.id).toBe(true);
      expect(r.cars, e.id).toBe(e.event.opponents + 1);
      expect(r.ruleset, e.id).toBe(e.event.ruleset);
      expect(r.aiSkill, e.id).toBe(e.event.aiSkill ?? null);
      expect(r.assist === 'raw', e.id).toBe(e.rules.includes('no-assists'));
      for (const c of r.classification) {
        expect(c.retired, e.id).toBe(false);
        expect(c.laps, e.id).toBeGreaterThanOrEqual(e.event.laps);
        expect(c.finishTimeS > 0 || e.rules.includes('time-attack'), e.id).toBe(true);
      }
    }
    expect(Object.keys(evidence.events).length).toBe(WILDCARD_SERIES.length);
  });
  it('sets medal ladders the evidence run can meet', () => {
    for (const e of WILDCARD_SERIES) {
      const r = evidence.events[e.id];
      if (e.ladder.metric === 'best-lap') {
        // A time attack's bronze is within reach of the AI benchmark lap, and
        // its gold is not given away: the benchmark does not already beat it.
        expect(r.fastestLapS, e.id).toBeLessThanOrEqual(e.ladder.bronze);
        expect(r.fastestLapS, e.id).toBeGreaterThan(e.ladder.gold * 0.95);
      } else {
        expect(r.ladderCheck.winnerMedal, e.id).toBe('gold');
      }
    }
  });
});

describe('medals and the career adapter', () => {
  const race = WILDCARD_SERIES.find((e) => e.ladder.metric === 'position')!;
  it('awards position medals from the finishing place', () => {
    const ladder = race.ladder;
    const at = (position: number, classified = true) =>
      wildcardMedal(race, { position, classified, bestLap: 0 });
    expect(at(1)).toBe('gold');
    expect(at(ladder.silver)).toBe('silver');
    expect(at(ladder.silver + 1)).toBe('bronze');
    expect(at(ladder.bronze)).toBe('bronze');
    expect(at(ladder.bronze + 1)).toBeNull();
    expect(at(1, false)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(Number.NaN)).toBeNull();
  });
  it('awards time-attack medals from the best lap', () => {
    const attack = WILDCARD_SERIES.find((e) => e.ladder.metric === 'best-lap');
    if (!attack) return;
    const lap = (bestLap: number) =>
      wildcardMedal(attack, { position: 1, classified: true, bestLap });
    expect(lap(attack.ladder.gold)).toBe('gold');
    expect(lap(attack.ladder.silver)).toBe('silver');
    expect(lap(attack.ladder.bronze)).toBe('bronze');
    expect(lap(attack.ladder.bronze + 0.01)).toBeNull();
    expect(lap(0)).toBeNull();
  });
  it('is paid, recorded and given reputation by the career’s own settleRace', () => {
    for (const e of WILDCARD_SERIES) {
      const career = wildcardCareerEvent(e);
      expect(career.key).toBe(wildcardKey(e));
      expect(career.discipline).toBe(wildcardDiscipline(e));
      expect(career.discipline).toBe(
        vehicleDiscipline(VEHICLES[[e.event.vehicles].flat()[0]] as unknown as CareerVehicle),
      );
    }
    const career = wildcardCareerEvent(race),
      save = newCareer(),
      { save: next, payout } = settleRace(save, career, {
        session: 'wildcard-test-1',
        position: 1,
        cars: race.event.opponents + 1,
        classified: true,
        demonstration: false,
        penalties: 0,
        contactEnergy: 0,
        gridSlot: 3,
        bestLap: 91.234,
      });
    expect(payout.paid).toBe(true);
    expect(payout.total).toBeGreaterThan(0);
    expect(next.credits).toBeGreaterThan(save.credits);
    const record = next.results[wildcardKey(race)];
    expect(record).toMatchObject({ bestPosition: 1, starts: 1 });
    expect(wildcardMedalFromRecord(race, record)).toBe('gold');
    expect(wildcardMedalFromRecord(race, undefined)).toBeNull();
    expect(wildcardMedalFromRecord(race, { bestPosition: 99, bestLap: 0, starts: 1 })).toBeNull();
    // A session is paid once.
    const again = settleRace(next, career, {
      session: 'wildcard-test-1',
      position: 1,
      cars: 8,
      classified: true,
      demonstration: false,
      penalties: 0,
      contactEnergy: 0,
      gridSlot: 3,
      bestLap: 90,
    });
    expect(again.payout.paid).toBe(false);
  });
});

describe('the AI skill option', () => {
  it('leaves every session without one exactly as it was', () => {
    expect(validateOptions(DEFAULT_OPTIONS).aiSkill).toBeUndefined();
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3 });
    expect(sim.ai.map((d) => (d as unknown as { skill: number }).skill)).toEqual(
      [0, 1, 2, 3].map((i) => AI_BASE_SKILL + i * 0.014),
    );
  });
  it('clamps a named skill and hands it to every AI driver', () => {
    expect(validateOptions({ ...DEFAULT_OPTIONS, aiSkill: 5 }).aiSkill).toBe(1);
    expect(validateOptions({ ...DEFAULT_OPTIONS, aiSkill: 0.1 }).aiSkill).toBe(0.8);
    expect(validateOptions({ ...DEFAULT_OPTIONS, aiSkill: Number.NaN }).aiSkill).toBeUndefined();
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, aiSkill: 0.85 });
    expect((sim.ai[1] as unknown as { skill: number }).skill).toBeCloseTo(0.864, 6);
  });
});

describe('banked and sloping grids', () => {
  it('builds a rotation from a basis', () => {
    const x = new Vec3(0, 0, -1),
      y = new Vec3(0, 1, 0),
      z = new Vec3(1, 0, 0),
      q = new Quat().fromBasis(x, y, z),
      out = new Vec3();
    q.rotate(new Vec3(1, 0, 0), out);
    expect([out.x, out.y, out.z].map((v) => +v.toFixed(9))).toEqual([0, 0, -1]);
    q.rotate(new Vec3(0, 0, 1), out);
    expect([out.x, out.y, out.z].map((v) => +v.toFixed(9))).toEqual([1, 0, 0]);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });
  it('rests the Mesa Speedbowl grid on its banking without a jump-start penalty', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'speedbowl',
      mode: 'race',
      opponents: 3,
      vehicles: Array(4).fill('fx26'),
    });
    sim.autoPlayer = true;
    // The grid is on a 7-13 degree bank: the chassis starts on the road plane.
    const normal = new Vec3();
    for (const car of sim.cars) {
      car.body.orientation.rotate(new Vec3(0, 1, 0), normal);
      expect(normal.y).toBeLessThan(0.995);
      expect(normal.y).toBeGreaterThan(0.95);
    }
    for (let i = 0; i < 120 * 8; i++) sim.step(1 / 120);
    expect(sim.race.time).toBeGreaterThan(sim.race.greenAt);
    for (const lap of sim.race.laps) {
      expect(lap.jumped).toBe(false);
      expect(lap.penalty).toBe(0);
    }
  });
  it('leaves a flat grid exactly as it was (yaw only)', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'aurel', opponents: 1 });
    const p = sim.cars[0].trackPosition,
      q = sim.cars[0].body.orientation;
    expect(Math.hypot(p.bank, p.gradient)).toBeLessThan(PLACE_ALIGN_SLOPE);
    const yaw = new Quat().yaw(Math.atan2(p.tx, p.tz));
    expect([q.x, q.y, q.z, q.w]).toEqual([yaw.x, yaw.y, yaw.z, yaw.w]);
  });
});

describe('every wildcard event loads and runs', () => {
  it.each(WILDCARD_SERIES.map((e) => [e.id, e] as const))(
    '%s steps two seconds with finite state',
    (_id, entry) => {
      const sim = new Simulation(wildcardSession(entry, DEFAULT_OPTIONS));
      sim.autoPlayer = true;
      expect(sim.cars).toHaveLength(entry.event.opponents + 1);
      for (let i = 0; i < 240; i++) sim.step(1 / 120);
      for (const car of sim.cars) {
        expect(
          car.body.position.finite() && car.body.omega.finite(),
          `${entry.id} car ${car.id}`,
        ).toBe(true);
        expect(car.retired).toBe(false);
      }
    },
    60000,
  );
});
