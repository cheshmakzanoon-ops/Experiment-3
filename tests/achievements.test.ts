import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  applyEvent,
  emptyProgress,
  matchesCondition,
  progressOf,
  replay,
  validateProgress,
  type AchievementCategory,
  type AchievementProgress,
} from '../src/steam/achievements.ts';
import { GameEventBus, type GameEvent, type RaceFinishedEvent } from '../src/steam/events.ts';

const race = (o: Partial<RaceFinishedEvent> = {}): RaceFinishedEvent => ({
  type: 'race.finished',
  discipline: 'circuit',
  mode: 'race',
  circuitId: 'aurel',
  vehicleId: 'apx01',
  vehicleClass: 'formula',
  position: 5,
  fieldSize: 8,
  gridSlot: 5,
  classified: true,
  laps: 3,
  penaltySeconds: 0,
  clean: false,
  weather: 'clear',
  wet: false,
  wildcard: false,
  demonstration: false,
  ...o,
});
const festival = (
  o: Partial<Extract<GameEvent, { type: 'festival.activity' }>> = {},
): GameEvent => ({
  type: 'festival.activity',
  eventKind: 'sprint',
  completed: true,
  assisted: false,
  stars: 1,
  position: 0,
  entrants: 1,
  trapKmh: 0,
  averageKmh: 0,
  driftScore: 0,
  vehicleId: 'rd2',
  ...o,
});
const licence = (id: string, medal: 'bronze' | 'silver' | 'gold' | null = 'gold'): GameEvent => ({
  type: 'career.licence',
  licence: id,
  medal,
  valid: true,
});
const many = (n: number, make: (i: number) => GameEvent) =>
  Array.from({ length: n }, (_, i) => make(i));
const lap = (i = 0): GameEvent => ({
  type: 'lap.record',
  discipline: 'circuit',
  circuitId: `c${i}`,
  seconds: 90 - i,
  firstOnTrack: i === 0,
});
const photo = (): GameEvent => ({ type: 'photo.taken', context: 'driving' });
const jump = (airSeconds: number): GameEvent => ({
  type: 'festival.jump',
  airSeconds,
  distance: 20,
});
const chain = (points: number): GameEvent => ({
  type: 'festival.chain',
  points,
  bestChain: points,
  sessionTotal: points,
});
const found = (total: number): GameEvent => ({
  type: 'festival.discovered',
  id: `p${total}`,
  total,
});
const gp = (o: Partial<RaceFinishedEvent> = {}) =>
  race({ discipline: 'gp-bike', vehicleClass: 'gp-bike', vehicleId: 'gp1', ...o });
const mx = (o: Partial<RaceFinishedEvent> = {}) =>
  race({ discipline: 'motocross', vehicleClass: 'motocross', vehicleId: 'mx1', ...o });
const sx = (o: Partial<RaceFinishedEvent> = {}) =>
  race({ discipline: 'supercross', vehicleClass: 'motocross', vehicleId: 'mx1', ...o });

/** For every achievement, a small event stream that must unlock it. A new
 * achievement without a witness fails the coverage test below, which keeps
 * every rule satisfiable. */
const WITNESS: Record<string, GameEvent[]> = {
  circuit_first_finish: [race()],
  circuit_podium: [race({ position: 3 })],
  circuit_win: [race({ position: 1 })],
  circuit_pole_win: [race({ gridSlot: 1, position: 1 })],
  circuit_comeback: [race({ gridSlot: 9, position: 2 })],
  circuit_endurance: [race({ mode: 'endurance' })],
  gp_first_finish: [gp()],
  gp_podium: [gp({ position: 2 })],
  gp_win: [gp({ position: 1 })],
  gp_hat_trick: many(3, () => gp({ position: 1 })),
  mx_first_finish: [mx()],
  mx_podium: [mx({ position: 3 })],
  mx_win: [mx({ position: 1 })],
  sx_first_finish: [sx()],
  sx_win: [sx({ position: 1 })],
  dirt_double: [mx(), sx()],
  festival_first: [festival()],
  festival_stars: [festival({ stars: 3 })],
  festival_race_win: [festival({ eventKind: 'road-race', position: 1, entrants: 5 })],
  festival_drifter: [festival({ eventKind: 'drift-zone', driftScore: 7500 })],
  festival_radar: [festival({ eventKind: 'speed-trap', trapKmh: 255 })],
  festival_wanderer: [found(8)],
  festival_cartographer: [found(16)],
  festival_air: [jump(1.2)],
  festival_big_air: [jump(2.4)],
  festival_flow: [chain(1500)],
  festival_unbroken: [chain(5000)],
  festival_needle: many(25, () => ({ type: 'festival.cleanPass' as const })),
  weather_wet_finish: [race({ wet: true, weather: 'rain' })],
  weather_wet_win: [race({ wet: true, weather: 'rain', position: 1 })],
  weather_three: ['clear', 'changeable', 'rain'].map((weather) => race({ weather })),
  weather_all: ['clear', 'changeable', 'rain', 'fog', 'storm', 'snow'].map((weather) =>
    race({ weather }),
  ),
  clean_race: [race({ clean: true })],
  clean_win: [race({ clean: true, position: 1 })],
  clean_streak: many(5, () => race({ clean: true })),
  venue_five: many(5, (i) => race({ circuitId: `venue-${i}` })),
  venue_fifteen: many(15, (i) => race({ circuitId: `venue-${i}` })),
  vehicle_five: many(5, (i) => race({ vehicleId: `car-${i}` })),
  vehicle_fifteen: many(15, (i) => race({ vehicleId: `car-${i}` })),
  lap_record_first: [lap()],
  lap_record_ten: many(10, lap),
  photo_first: [photo()],
  photo_ten: many(10, photo),
  wildcard_first: [race({ wildcard: true })],
  wildcard_podium: [race({ wildcard: true, position: 3 })],
  wildcard_five: many(5, () => race({ wildcard: true, position: 2 })),
  licence_first: [licence('braking', 'bronze')],
  licence_gold: [licence('braking', 'gold')],
  licence_all_gold: ['braking', 'cornering', 'wet', 'lean', 'jump'].map((id) => licence(id)),
  season_complete: [{ type: 'championship.completed', position: 4, rounds: 6, entrants: 8 }],
  season_title: [{ type: 'championship.completed', position: 1, rounds: 6, entrants: 8 }],
};

const nonMeta = ACHIEVEMENTS.filter((a) => a.rule.kind !== 'meta');
const unlockedBy = (events: readonly GameEvent[]) =>
  Object.keys(replay(events, 1).progress.unlocked).sort();

describe('achievement definitions', () => {
  it('ships at least 30 uniquely identified achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(30);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name.toLowerCase())).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      // The id is the Steamworks API name.
      expect(a.id).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(a.name.length).toBeGreaterThan(2);
      expect(a.name.length).toBeLessThanOrEqual(60);
      expect(a.description.length).toBeGreaterThan(10);
      expect(a.description.length).toBeLessThanOrEqual(140);
    }
  });

  it('covers the four disciplines and the required themes', () => {
    const count = (c: AchievementCategory) => ACHIEVEMENTS.filter((a) => a.category === c).length;
    for (const c of ['circuit', 'gp-bike', 'motocross'] as const)
      expect(count(c)).toBeGreaterThanOrEqual(3);
    const supercross = ACHIEVEMENTS.filter((a) => /supercross/i.test(a.description));
    expect(supercross.length).toBeGreaterThanOrEqual(2);
    for (const c of [
      'festival',
      'weather',
      'clean',
      'wildcard',
      'discovery',
      'career',
      'mastery',
    ] as const)
      expect(count(c), c).toBeGreaterThanOrEqual(2);
    expect(ACHIEVEMENTS.filter((a) => a.hidden).length).toBeGreaterThan(0);
  });

  it('uses no licensed names', () => {
    const forbidden =
      /\b(f1|formula\s*1|formula\s*one|motogp|moto\s*gp|forza|horizon|gran\s*turismo|ferrari|mclaren|red\s*bull|honda|yamaha|ducati|suzuki|kawasaki|ktm|porsche|lamborghini|nurburgring|nürburgring|monza|silverstone|le\s*mans|daytona|supercross\s*live|ama\b|fia\b|fim\b|steam)\b/i;
    for (const a of ACHIEVEMENTS) {
      expect(`${a.name} ${a.description}`, a.id).not.toMatch(forbidden);
    }
  });

  it('has well-formed rules', () => {
    for (const a of ACHIEVEMENTS) {
      const { rule } = a;
      if (rule.kind === 'meta') {
        expect(rule.event).toBeUndefined();
        expect(rule.target === 'all' || (Number.isInteger(rule.target) && rule.target > 0)).toBe(
          true,
        );
        continue;
      }
      expect(rule.event, a.id).toBeTruthy();
      expect(typeof rule.target).toBe('number');
      expect(Number.isInteger(rule.target) && (rule.target as number) >= 1, a.id).toBe(true);
      if (rule.kind === 'distinct' || rule.kind === 'sum') expect(rule.field, a.id).toBeTruthy();
      if (rule.kind === 'streak') expect(rule.scope, a.id).toBeTruthy();
    }
  });

  it('references only fields that exist on the event it listens to', () => {
    const samples: Record<string, GameEvent> = {};
    for (const e of Object.values(WITNESS).flat()) samples[e.type] = e;
    for (const a of nonMeta) {
      const sample = samples[a.rule.event!] as unknown as Record<string, unknown> | undefined;
      expect(sample, `${a.id}: no sample event of type ${a.rule.event}`).toBeTruthy();
      const fields = [
        ...Object.keys(a.rule.where ?? {}),
        ...Object.keys(a.rule.scope ?? {}),
        ...(a.rule.field ? [a.rule.field] : []),
      ];
      for (const f of fields) expect(Object.keys(sample!), `${a.id}.${f}`).toContain(f);
    }
  });

  it('has a witness for every non-mastery achievement, and each witness unlocks it', () => {
    expect(Object.keys(WITNESS).sort()).toEqual(nonMeta.map((a) => a.id).sort());
    for (const a of nonMeta) {
      expect(unlockedBy(WITNESS[a.id]), a.id).toContain(a.id);
      // One event short of the target must not unlock a counted achievement.
      if (WITNESS[a.id].length > 1)
        expect(unlockedBy(WITNESS[a.id].slice(0, -1)), `${a.id} (one short)`).not.toContain(a.id);
    }
  });
});

describe('rule engine', () => {
  it('is deterministic and does not mutate its input', () => {
    const events = Object.values(WITNESS).flat();
    const a = replay(events, 12345);
    const b = replay(events, 12345);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Every unlock carries the supplied time, never a clock reading.
    expect(new Set(Object.values(a.progress.unlocked))).toEqual(new Set([12345]));

    const frozen = Object.freeze({
      version: 1 as const,
      unlocked: Object.freeze({}),
      counters: Object.freeze({}),
      seen: Object.freeze({}),
    }) as AchievementProgress;
    const result = applyEvent(frozen, race({ position: 1 }), 7);
    expect(result.unlocked).toContain('circuit_win');
    expect(frozen.unlocked).toEqual({});
    expect(applyEvent(result.progress, { type: 'menu.entered' }, 8).progress).toBe(result.progress);
  });

  it('counts only human, classified, competitive finishes', () => {
    expect(unlockedBy([race({ demonstration: true, position: 1 })])).toEqual([]);
    expect(unlockedBy([race({ mode: 'practice', position: 1 })])).toEqual([]);
    expect(unlockedBy([race({ mode: 'time-trial', position: 1 })])).toEqual([]);
    expect(unlockedBy([race({ classified: false, position: 1 })])).toEqual([]);
    expect(unlockedBy([festival({ assisted: true, stars: 3 })])).toEqual([]);
    expect(unlockedBy([festival({ completed: false, stars: 3 })])).toEqual([]);
    expect(unlockedBy([licence('braking', null)])).toEqual([]);
  });

  it('unlocks the right set for a pole-to-flag circuit win', () => {
    expect(unlockedBy([race({ gridSlot: 1, position: 1 })])).toEqual([
      'circuit_first_finish',
      'circuit_podium',
      'circuit_pole_win',
      'circuit_win',
    ]);
  });

  it('keeps disciplines apart', () => {
    const ids = unlockedBy([gp({ position: 1 })]);
    expect(ids).toEqual(['gp_first_finish', 'gp_podium', 'gp_win']);
    expect(unlockedBy([mx({ position: 1 })])).toEqual(['mx_first_finish', 'mx_podium', 'mx_win']);
  });

  it('streaks reset on a non-matching in-scope event and ignore out-of-scope ones', () => {
    const clean = () => race({ clean: true });
    const dirty = () => race({ clean: false });
    const practice = () => race({ mode: 'practice', clean: false });
    const base = [clean(), clean(), clean(), clean()];
    expect(unlockedBy([...base, clean()])).toContain('clean_streak');
    expect(unlockedBy([...base, dirty(), clean(), clean(), clean(), clean()])).not.toContain(
      'clean_streak',
    );
    expect(unlockedBy([...base, practice(), clean()])).toContain('clean_streak');
    const hat = () => gp({ position: 1 });
    expect(unlockedBy([hat(), hat(), gp({ position: 2 }), hat()])).not.toContain('gp_hat_trick');
    // A car win between motorcycle wins is out of scope for the GP streak.
    expect(unlockedBy([hat(), hat(), race({ position: 1 }), hat()])).toContain('gp_hat_trick');
  });

  it('counts distinct values once', () => {
    expect(unlockedBy(many(8, () => race({ circuitId: 'same' })))).not.toContain('venue_five');
    const { progress } = replay(many(3, (i) => race({ weather: i % 2 ? 'rain' : 'clear' })));
    expect(progress.seen.weather_three).toEqual(['clear', 'rain']);
  });

  it('awards mastery only once enough other achievements are unlocked', () => {
    const events = Object.values(WITNESS).flat();
    const { order, progress } = replay(events);
    expect(Object.keys(progress.unlocked)).toHaveLength(ACHIEVEMENTS.length);
    expect(order.at(-1)).toBe('mastery_all');
    let state = emptyProgress();
    let awarded = false;
    for (const event of events) {
      const before = Object.keys(state.unlocked).filter((id) => !id.startsWith('mastery_')).length;
      const next = applyEvent(state, event, 1);
      const after = Object.keys(next.progress.unlocked).filter(
        (id) => !id.startsWith('mastery_'),
      ).length;
      if (next.unlocked.includes('mastery_ten')) {
        expect(before).toBeLessThan(10);
        expect(after).toBeGreaterThanOrEqual(10);
        awarded = true;
      }
      state = next.progress;
    }
    expect(awarded).toBe(true);
  });

  it('matches conditions without surprises', () => {
    expect(matchesCondition(3, { lte: 3 })).toBe(true);
    expect(matchesCondition(4, { lte: 3 })).toBe(false);
    expect(matchesCondition(NaN, { gte: 0 })).toBe(false);
    expect(matchesCondition('a', 'a')).toBe(true);
    expect(matchesCondition('a', { in: ['a', 'b'] })).toBe(true);
    expect(matchesCondition('c', { in: ['a', 'b'] })).toBe(false);
    expect(matchesCondition(null, { in: ['gold'] })).toBe(false);
    expect(matchesCondition('rain-heavy', { prefix: 'rain' })).toBe(true);
    expect(matchesCondition(true, true)).toBe(true);
    expect(matchesCondition(1, true)).toBe(false);
  });

  it('reports progress for a progress bar and survives corrupt saves', () => {
    const photoTen = ACHIEVEMENTS.find((a) => a.id === 'photo_ten')!;
    const { progress } = replay(many(4, photo));
    expect(progressOf(photoTen, progress)).toEqual({ current: 4, target: 10 });
    const venues = ACHIEVEMENTS.find((a) => a.id === 'venue_five')!;
    expect(
      progressOf(venues, replay(many(2, (i) => race({ circuitId: `v${i}` }))).progress),
    ).toEqual({
      current: 2,
      target: 5,
    });
    expect(progressOf(photoTen, replay(WITNESS.photo_ten).progress)).toEqual({
      current: 10,
      target: 10,
    });

    expect(validateProgress(null)).toEqual(emptyProgress());
    expect(validateProgress('nonsense')).toEqual(emptyProgress());
    const cleaned = validateProgress({
      unlocked: { circuit_win: 5, not_an_achievement: 6, photo_first: 'x' },
      counters: { photo_ten: 3, circuit_win: -1, venue_five: Infinity },
      seen: { weather_three: ['clear', 7, 'rain'], bogus: ['x'] },
    });
    expect(cleaned).toEqual({
      version: 1,
      unlocked: { circuit_win: 5 },
      counters: { photo_ten: 3 },
      seen: { weather_three: ['clear', 'rain'] },
    });
  });
});

describe('event bus', () => {
  it('delivers typed events, isolates faulty listeners and unsubscribes', () => {
    const bus = new GameEventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('listener bug');
    });
    const off = bus.on('photo.taken', (event) => seen.push(`photo:${event.context}`));
    bus.on('lap.record', () => seen.push('lap'));
    expect(() => bus.emit(photo())).not.toThrow();
    bus.emit(lap());
    off();
    bus.emit(photo());
    expect(seen).toEqual(['photo:driving', 'lap']);
    expect(bus.size).toBe(2);
  });
});
