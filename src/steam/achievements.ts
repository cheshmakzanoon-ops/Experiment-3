import type { GameEvent, GameEventOf, GameEventType, RaceFinishedEvent } from './events.ts';

/**
 * MOTOBOUND achievements as DATA plus a small pure rule engine.
 *
 * - Every definition is original (no licensed names, no copied wording).
 * - A rule is declarative (event type + field conditions), so it can be listed
 *   in the Steamworks partner site, rendered in a menu and unit-tested without
 *   running the game.
 * - The engine is deterministic and side-effect free: `applyEvent` takes the
 *   previous progress, an event and an explicit `now`, and returns new
 *   progress plus the ids that unlocked. It never reads a clock, the DOM or
 *   Steam. Persistence and the Steam call live in runtime.ts.
 * - A definition's `id` is also its Steam "API Name" (a-z, 0-9, underscore).
 * - Thresholds marked "tuning" come from authored content targets (see the
 *   comments) and may be retuned after playtests; the ids must stay stable.
 */

// ---- Condition language ---------------------------------------------------------------------
export interface NumberOps {
  eq?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}
export interface StringOps<S extends string = string> {
  in?: readonly S[];
  not?: S;
  prefix?: string;
}
type Match<T> = [T] extends [boolean]
  ? boolean
  : [T] extends [number]
    ? number | NumberOps
    : [Exclude<T, null>] extends [string]
      ? Exclude<T, null> | StringOps<Exclude<T, null>>
      : never;
export type Where<E extends GameEvent> = {
  [K in Exclude<keyof E, 'type'>]?: Match<E[K]>;
};
type Condition = boolean | string | number | NumberOps | StringOps;
type Conditions = Record<string, Condition>;

export type RuleKind = 'once' | 'count' | 'streak' | 'distinct' | 'sum' | 'meta';
export interface Rule {
  kind: RuleKind;
  /** The event type this rule listens to (absent for `meta`). */
  event?: GameEventType;
  /** Fields that must all match for an event to count. */
  where?: Conditions;
  /** `streak` only: events outside this scope neither extend nor reset the streak. */
  scope?: Conditions;
  /** `distinct` / `sum`: the event field that is collected or added up. */
  field?: string;
  /** Count, set size, running total, streak length, or (meta) number of other
   * achievements; `'all'` for meta means every other achievement. */
  target: number | 'all';
}

export type AchievementCategory =
  | 'circuit'
  | 'gp-bike'
  | 'motocross'
  | 'supercross'
  | 'festival'
  | 'weather'
  | 'clean'
  | 'wildcard'
  | 'discovery'
  | 'career'
  | 'mastery';

export interface AchievementDef {
  /** Stable forever; also the Steamworks API name. */
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  /** Hidden until unlocked (Steam "hidden" flag). */
  hidden?: boolean;
  rule: Rule;
}

// ---- Typed rule builders --------------------------------------------------------------------
type Ev<T extends GameEventType> = GameEventOf<T>;
type FieldOf<T extends GameEventType> = Exclude<keyof Ev<T>, 'type'> & string;
const cond = (value: unknown) => value as Conditions | undefined;

const once = <T extends GameEventType>(event: T, where?: Where<Ev<T>>): Rule => ({
  kind: 'once',
  event,
  where: cond(where),
  target: 1,
});
const count = <T extends GameEventType>(event: T, target: number, where?: Where<Ev<T>>): Rule => ({
  kind: 'count',
  event,
  where: cond(where),
  target,
});
const streak = <T extends GameEventType>(
  event: T,
  target: number,
  scope: Where<Ev<T>>,
  where: Where<Ev<T>>,
): Rule => ({ kind: 'streak', event, scope: cond(scope), where: cond(where), target });
const distinct = <T extends GameEventType>(
  event: T,
  field: FieldOf<T>,
  target: number,
  where?: Where<Ev<T>>,
): Rule => ({ kind: 'distinct', event, field, where: cond(where), target });
const meta = (target: number | 'all'): Rule => ({ kind: 'meta', target });

/** A competitive, human-driven, classified finish (no AI demonstration). */
const finished = (extra: Where<RaceFinishedEvent> = {}): Where<RaceFinishedEvent> => ({
  mode: { in: ['race', 'endurance'] },
  classified: true,
  demonstration: false,
  ...extra,
});
const RACE_KINDS = ['road-race', 'circuit', 'sprint', 'showcase'];

export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  // ---- Circuit cars (single-seaters, GT, touring, prototypes) -------------------------------
  {
    id: 'circuit_first_finish',
    name: 'Flag to Flag',
    description: 'Finish a circuit race in a car.',
    category: 'circuit',
    rule: once('race.finished', finished({ discipline: 'circuit' })),
  },
  {
    id: 'circuit_podium',
    name: 'Rostrum Regular',
    description: 'Finish a circuit car race on the podium.',
    category: 'circuit',
    rule: once('race.finished', finished({ discipline: 'circuit', position: { lte: 3 } })),
  },
  {
    id: 'circuit_win',
    name: 'First Chequered',
    description: 'Win a circuit car race.',
    category: 'circuit',
    rule: once('race.finished', finished({ discipline: 'circuit', position: 1 })),
  },
  {
    id: 'circuit_pole_win',
    name: 'Lights to Flag',
    description: 'Start from pole in a field of at least four and win the circuit race.',
    category: 'circuit',
    rule: once(
      'race.finished',
      finished({ discipline: 'circuit', gridSlot: 1, position: 1, fieldSize: { gte: 4 } }),
    ),
  },
  {
    id: 'circuit_comeback',
    name: 'Back of the Grid Hero',
    description: 'Start the circuit race 8th or lower and finish on the podium.',
    category: 'circuit',
    rule: once(
      'race.finished',
      finished({ discipline: 'circuit', gridSlot: { gte: 8 }, position: { lte: 3 } }),
    ),
  },
  {
    id: 'circuit_endurance',
    name: 'Long Haul',
    description: 'Finish an endurance race.',
    category: 'circuit',
    rule: once('race.finished', finished({ mode: 'endurance' })),
  },

  // ---- GP motorcycles -----------------------------------------------------------------------
  {
    id: 'gp_first_finish',
    name: 'First Lean Angle',
    description: 'Finish a GP motorcycle race.',
    category: 'gp-bike',
    rule: once('race.finished', finished({ discipline: 'gp-bike' })),
  },
  {
    id: 'gp_podium',
    name: 'Knee Down, Hands Up',
    description: 'Finish a GP motorcycle race on the podium.',
    category: 'gp-bike',
    rule: once('race.finished', finished({ discipline: 'gp-bike', position: { lte: 3 } })),
  },
  {
    id: 'gp_win',
    name: 'Chequered Handlebars',
    description: 'Win a GP motorcycle race.',
    category: 'gp-bike',
    rule: once('race.finished', finished({ discipline: 'gp-bike', position: 1 })),
  },
  {
    id: 'gp_hat_trick',
    name: 'Three in a Row',
    description: 'Win three GP motorcycle races in a row.',
    category: 'gp-bike',
    rule: streak('race.finished', 3, finished({ discipline: 'gp-bike' }), { position: 1 }),
  },

  // ---- Motocross and supercross -------------------------------------------------------------
  {
    id: 'mx_first_finish',
    name: 'Gate Drop',
    description: 'Finish a motocross moto.',
    category: 'motocross',
    rule: once('race.finished', finished({ discipline: 'motocross' })),
  },
  {
    id: 'mx_podium',
    name: 'Mud on the Podium',
    description: 'Finish a motocross moto on the podium.',
    category: 'motocross',
    rule: once('race.finished', finished({ discipline: 'motocross', position: { lte: 3 } })),
  },
  {
    id: 'mx_win',
    name: 'King of the Hill',
    description: 'Win a motocross moto.',
    category: 'motocross',
    rule: once('race.finished', finished({ discipline: 'motocross', position: 1 })),
  },
  {
    id: 'sx_first_finish',
    name: 'Under the Floodlights',
    description: 'Finish a supercross race.',
    category: 'supercross',
    rule: once('race.finished', finished({ discipline: 'supercross' })),
  },
  {
    id: 'sx_win',
    name: 'Rhythm Section',
    description: 'Win a supercross race.',
    category: 'supercross',
    rule: once('race.finished', finished({ discipline: 'supercross', position: 1 })),
  },
  {
    id: 'dirt_double',
    name: 'Dirt Double',
    description: 'Finish both a motocross moto and a supercross race.',
    category: 'supercross',
    rule: distinct(
      'race.finished',
      'discipline',
      2,
      finished({ discipline: { in: ['motocross', 'supercross'] } }),
    ),
  },

  // ---- Festival (open world) ----------------------------------------------------------------
  {
    id: 'festival_first',
    name: 'Off the Map',
    description: 'Complete an open-world festival event.',
    category: 'festival',
    rule: once('festival.activity', { completed: true, assisted: false }),
  },
  {
    id: 'festival_stars',
    name: 'Three-Star Day',
    description: 'Earn three stars in a festival event.',
    category: 'festival',
    rule: once('festival.activity', { completed: true, assisted: false, stars: { gte: 3 } }),
  },
  {
    id: 'festival_race_win',
    name: 'Street Legal Winner',
    description: 'Win a festival race against rivals.',
    category: 'festival',
    rule: once('festival.activity', {
      completed: true,
      assisted: false,
      eventKind: { in: RACE_KINDS },
      position: 1,
      entrants: { gte: 2 },
    }),
  },
  {
    id: 'festival_drifter',
    name: 'Sideways Savant',
    description: 'Score 7,000 points in a drift zone.',
    category: 'festival',
    // Authored three-star targets for drift zones run 10,000 to 12,000 (region-data.ts).
    rule: once('festival.activity', {
      completed: true,
      assisted: false,
      eventKind: 'drift-zone',
      driftScore: { gte: 7000 },
    }),
  },
  {
    id: 'festival_radar',
    name: 'Radar Magnet',
    description: 'Break 250 km/h through a speed trap.',
    category: 'festival',
    // Authored three-star speed-trap targets are 260 to 270 km/h (region-data.ts).
    rule: once('festival.activity', {
      completed: true,
      assisted: false,
      eventKind: 'speed-trap',
      trapKmh: { gte: 250 },
    }),
  },
  {
    id: 'festival_wanderer',
    name: 'Wanderer',
    description: 'Discover 8 places in the festival world.',
    category: 'discovery',
    rule: once('festival.discovered', { total: { gte: 8 } }),
  },
  {
    id: 'festival_cartographer',
    name: 'Cartographer',
    description: 'Discover 16 places in the festival world.',
    category: 'discovery',
    rule: once('festival.discovered', { total: { gte: 16 } }),
  },
  {
    id: 'festival_air',
    name: 'Hang Time',
    description: 'Land a jump after a full second in the air.',
    category: 'festival',
    rule: once('festival.jump', { airSeconds: { gte: 1 } }),
  },
  {
    id: 'festival_big_air',
    name: 'Long Way Down',
    description: 'Land a jump after two seconds in the air.',
    category: 'festival',
    hidden: true,
    rule: once('festival.jump', { airSeconds: { gte: 2 } }),
  },
  {
    id: 'festival_flow',
    name: 'Flow State',
    description: 'Bank a skill chain worth 1,500 points.',
    category: 'festival',
    // tuning: a chain is a few hundred points per ten seconds at a 5x multiplier cap.
    rule: once('festival.chain', { points: { gte: 1500 } }),
  },
  {
    id: 'festival_unbroken',
    name: 'Unbroken',
    description: 'Bank a skill chain worth 5,000 points.',
    category: 'festival',
    rule: once('festival.chain', { points: { gte: 5000 } }),
  },
  {
    id: 'festival_needle',
    name: 'Needle Thread',
    description: 'Make 25 clean passes of ambient traffic.',
    category: 'festival',
    rule: count('festival.cleanPass', 25),
  },

  // ---- Weather ------------------------------------------------------------------------------
  {
    id: 'weather_wet_finish',
    name: 'Wet Wheels',
    description: 'Finish a race while it is raining.',
    category: 'weather',
    rule: once('race.finished', finished({ wet: true })),
  },
  {
    id: 'weather_wet_win',
    name: 'Rain Maker',
    description: 'Win a race while it is raining.',
    category: 'weather',
    rule: once('race.finished', finished({ wet: true, position: 1 })),
  },
  {
    id: 'weather_three',
    name: 'Three Skies',
    description: 'Finish races in three different weather conditions.',
    category: 'weather',
    rule: distinct('race.finished', 'weather', 3, finished()),
  },
  {
    id: 'weather_all',
    name: 'Whole Forecast',
    description: 'Finish races in six different weather conditions.',
    category: 'weather',
    rule: distinct('race.finished', 'weather', 6, finished()),
  },

  // ---- Clean racing -------------------------------------------------------------------------
  {
    id: 'clean_race',
    name: 'Spotless',
    description: 'Finish a race with no penalties and no damage.',
    category: 'clean',
    rule: once('race.finished', finished({ clean: true })),
  },
  {
    id: 'clean_win',
    name: 'Not a Mark on It',
    description: 'Win a race with no penalties and no damage.',
    category: 'clean',
    rule: once('race.finished', finished({ clean: true, position: 1 })),
  },
  {
    id: 'clean_streak',
    name: 'Hands Off the Paint',
    description: 'Finish five races in a row without a penalty or damage.',
    category: 'clean',
    rule: streak(
      'race.finished',
      5,
      { mode: { in: ['race', 'endurance'] }, demonstration: false },
      { classified: true, clean: true },
    ),
  },

  // ---- Discovery and collection -------------------------------------------------------------
  {
    id: 'venue_five',
    name: 'Passport Stamp',
    description: 'Finish races at five different venues.',
    category: 'discovery',
    rule: distinct('race.finished', 'circuitId', 5, finished()),
  },
  {
    id: 'venue_fifteen',
    name: 'Grand Tour',
    description: 'Finish races at fifteen different venues.',
    category: 'discovery',
    rule: distinct('race.finished', 'circuitId', 15, finished()),
  },
  {
    id: 'vehicle_five',
    name: 'Test Pilot',
    description: 'Finish races in five different vehicles.',
    category: 'discovery',
    rule: distinct('race.finished', 'vehicleId', 5, finished()),
  },
  {
    id: 'vehicle_fifteen',
    name: 'Whole Garage',
    description: 'Finish races in fifteen different vehicles.',
    category: 'discovery',
    rule: distinct('race.finished', 'vehicleId', 15, finished()),
  },
  {
    id: 'lap_record_first',
    name: 'Faster Than Before',
    description: 'Set a personal-best lap time.',
    category: 'discovery',
    rule: once('lap.record'),
  },
  {
    id: 'lap_record_ten',
    name: 'Chasing Hundredths',
    description: 'Set ten personal-best lap times.',
    category: 'discovery',
    rule: count('lap.record', 10),
  },
  {
    id: 'photo_first',
    name: 'Shutter Click',
    description: 'Take a photo in photo mode.',
    category: 'discovery',
    rule: once('photo.taken'),
  },
  {
    id: 'photo_ten',
    name: 'Contact Sheet',
    description: 'Take ten photos in photo mode.',
    category: 'discovery',
    rule: count('photo.taken', 10),
  },

  // ---- Wildcard series (vehicle and venue deliberately mismatched) --------------------------
  {
    id: 'wildcard_first',
    name: 'Wrong Tool, Right Job',
    description: 'Finish a Wildcard race in a vehicle that does not belong at the venue.',
    category: 'wildcard',
    rule: once('race.finished', finished({ wildcard: true })),
  },
  {
    id: 'wildcard_podium',
    name: 'Odd Couple',
    description: 'Finish a Wildcard race on the podium.',
    category: 'wildcard',
    rule: once('race.finished', finished({ wildcard: true, position: { lte: 3 } })),
  },
  {
    id: 'wildcard_five',
    name: 'Misfit Maestro',
    description: 'Finish five Wildcard races on the podium.',
    category: 'wildcard',
    hidden: true,
    rule: count('race.finished', 5, finished({ wildcard: true, position: { lte: 3 } })),
  },

  // ---- Career -------------------------------------------------------------------------------
  {
    id: 'licence_first',
    name: "Learner's Badge",
    description: 'Earn any medal in a licence test.',
    category: 'career',
    rule: once('career.licence', { valid: true, medal: { in: ['bronze', 'silver', 'gold'] } }),
  },
  {
    id: 'licence_gold',
    name: 'Gold Standard',
    description: 'Earn a gold medal in a licence test.',
    category: 'career',
    rule: once('career.licence', { valid: true, medal: 'gold' }),
  },
  {
    id: 'licence_all_gold',
    name: 'Full Marks',
    description: 'Earn gold in every licence test.',
    category: 'career',
    rule: distinct('career.licence', 'licence', 5, { valid: true, medal: 'gold' }),
  },
  {
    id: 'season_complete',
    name: 'Season Done',
    description: 'Complete a championship season.',
    category: 'career',
    rule: once('championship.completed'),
  },
  {
    id: 'season_title',
    name: 'Title Fight Won',
    description: 'Win a championship.',
    category: 'career',
    rule: once('championship.completed', { position: 1 }),
  },

  // ---- Mastery (counts the other achievements) ----------------------------------------------
  {
    id: 'mastery_ten',
    name: 'Rising Star',
    description: 'Unlock 10 other achievements.',
    category: 'mastery',
    rule: meta(10),
  },
  {
    id: 'mastery_twenty_five',
    name: 'Seasoned Racer',
    description: 'Unlock 25 other achievements.',
    category: 'mastery',
    rule: meta(25),
  },
  {
    id: 'mastery_all',
    name: 'Motobound',
    description: 'Unlock every other achievement.',
    category: 'mastery',
    rule: meta('all'),
  },
]);

// ---- Engine ---------------------------------------------------------------------------------
export interface AchievementProgress {
  version: 1;
  /** Achievement id -> time it unlocked (ms since epoch, caller supplied). */
  unlocked: Record<string, number>;
  /** count / sum / streak accumulators by achievement id. */
  counters: Record<string, number>;
  /** distinct-value sets by achievement id (bounded). */
  seen: Record<string, string[]>;
}

export const emptyProgress = (): AchievementProgress => ({
  version: 1,
  unlocked: {},
  counters: {},
  seen: {},
});

export const ACHIEVEMENTS_SAVE_KEY = 'achievements:v1';

const isNumberOps = (c: Condition): c is NumberOps =>
  typeof c === 'object' && c !== null && !('in' in c) && !('prefix' in c) && !('not' in c);

/** Does one event field satisfy one condition? Pure and total. */
export function matchesCondition(value: unknown, condition: Condition): boolean {
  if (typeof condition !== 'object' || condition === null) return value === condition;
  if (isNumberOps(condition)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    return (
      (condition.eq === undefined || value === condition.eq) &&
      (condition.gt === undefined || value > condition.gt) &&
      (condition.gte === undefined || value >= condition.gte) &&
      (condition.lt === undefined || value < condition.lt) &&
      (condition.lte === undefined || value <= condition.lte)
    );
  }
  if (typeof value !== 'string') return false;
  const ops = condition as StringOps;
  return (
    (ops.in === undefined || ops.in.includes(value)) &&
    (ops.not === undefined || value !== ops.not) &&
    (ops.prefix === undefined || value.startsWith(ops.prefix))
  );
}

export function matchesAll(event: GameEvent, where: Conditions | undefined): boolean {
  if (!where) return true;
  const record = event as unknown as Record<string, unknown>;
  return Object.entries(where).every(([field, c]) => matchesCondition(record[field], c));
}

const SEEN_CAP = 64;

/** Fold one event into the progress. Returns the same object when nothing changed. */
export function applyEvent(
  progress: AchievementProgress,
  event: GameEvent,
  now: number,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): { progress: AchievementProgress; unlocked: string[] } {
  const next: AchievementProgress = {
    version: 1,
    unlocked: { ...progress.unlocked },
    counters: { ...progress.counters },
    seen: { ...progress.seen },
  };
  const unlocked: string[] = [];
  let changed = false;
  const unlock = (id: string) => {
    next.unlocked[id] = now;
    unlocked.push(id);
    changed = true;
  };
  const bump = (id: string, value: number) => {
    if (next.counters[id] === value) return;
    next.counters[id] = value;
    changed = true;
  };

  for (const def of defs) {
    const { rule } = def;
    if (rule.kind === 'meta' || rule.event !== event.type || next.unlocked[def.id] !== undefined)
      continue;
    const target = typeof rule.target === 'number' ? rule.target : 1;
    const record = event as unknown as Record<string, unknown>;
    switch (rule.kind) {
      case 'once':
        if (matchesAll(event, rule.where)) unlock(def.id);
        break;
      case 'count':
        if (matchesAll(event, rule.where)) {
          const value = (next.counters[def.id] ?? 0) + 1;
          bump(def.id, value);
          if (value >= target) unlock(def.id);
        }
        break;
      case 'streak':
        if (matchesAll(event, rule.scope)) {
          const value = matchesAll(event, rule.where) ? (next.counters[def.id] ?? 0) + 1 : 0;
          bump(def.id, value);
          if (value >= target) unlock(def.id);
        }
        break;
      case 'distinct':
        if (rule.field && matchesAll(event, rule.where)) {
          const raw = record[rule.field];
          if (typeof raw !== 'string' && typeof raw !== 'number') break;
          const set = next.seen[def.id] ?? [];
          const value = String(raw);
          if (!set.includes(value) && set.length < SEEN_CAP) {
            next.seen[def.id] = [...set, value];
            changed = true;
            if (set.length + 1 >= target) unlock(def.id);
          }
        }
        break;
      case 'sum':
        if (rule.field && matchesAll(event, rule.where)) {
          const raw = record[rule.field];
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            const value = (next.counters[def.id] ?? 0) + raw;
            bump(def.id, value);
            if (value >= target) unlock(def.id);
          }
        }
        break;
    }
  }

  // Mastery counts what is unlocked, including unlocks made a moment ago: repeat to a fixed point.
  for (let progressMade = true; progressMade; ) {
    progressMade = false;
    for (const def of defs) {
      if (def.rule.kind !== 'meta' || next.unlocked[def.id] !== undefined) continue;
      const others = defs.filter((d) => d.id !== def.id);
      const done = others.filter((d) => next.unlocked[d.id] !== undefined).length;
      const need = def.rule.target === 'all' ? others.length : def.rule.target;
      if (done >= need) {
        unlock(def.id);
        progressMade = true;
      }
    }
  }
  return changed ? { progress: next, unlocked } : { progress, unlocked };
}

/** Replay a stream of events from nothing (used by tests and by recovery tools). */
export function replay(
  events: readonly GameEvent[],
  now = 0,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
) {
  let progress = emptyProgress();
  const order: string[] = [];
  for (const event of events) {
    const result = applyEvent(progress, event, now, defs);
    progress = result.progress;
    order.push(...result.unlocked);
  }
  return { progress, order };
}

/** Current/target for a progress bar. `unlocked` always reports the full target. */
export function progressOf(
  def: AchievementDef,
  progress: AchievementProgress,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
) {
  const { rule } = def;
  const target =
    rule.target === 'all' ? defs.length - 1 : rule.kind === 'once' ? 1 : (rule.target as number);
  if (progress.unlocked[def.id] !== undefined) return { current: target, target };
  let current = 0;
  if (rule.kind === 'distinct') current = progress.seen[def.id]?.length ?? 0;
  else if (rule.kind === 'meta')
    current = defs.filter((d) => d.id !== def.id && progress.unlocked[d.id] !== undefined).length;
  else current = progress.counters[def.id] ?? 0;
  return { current: Math.min(current, target), target };
}

/** Tolerant loader for persisted progress: unknown ids and malformed fields are dropped. */
export function validateProgress(
  value: unknown,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): AchievementProgress {
  const out = emptyProgress();
  if (!value || typeof value !== 'object') return out;
  const source = value as Partial<AchievementProgress>;
  const known = new Set(defs.map((d) => d.id));
  const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  for (const [id, at] of Object.entries(record(source.unlocked)))
    if (known.has(id) && typeof at === 'number' && Number.isFinite(at)) out.unlocked[id] = at;
  for (const [id, n] of Object.entries(record(source.counters)))
    if (known.has(id) && typeof n === 'number' && Number.isFinite(n) && n >= 0)
      out.counters[id] = n;
  for (const [id, list] of Object.entries(record(source.seen)))
    if (known.has(id) && Array.isArray(list))
      out.seen[id] = list.filter((v): v is string => typeof v === 'string').slice(0, SEEN_CAP);
  return out;
}

export const achievementById = (id: string) => ACHIEVEMENTS.find((d) => d.id === id);
