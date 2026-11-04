import { DEFAULT_OPTIONS, type SessionOptions, type WeatherPreset } from '../simulation/config.ts';
import type { CircuitId } from '../simulation/circuits.ts';
import { RULESETS, eventSession, type EventDefinition } from '../simulation/events.ts';
import { WEATHER_CATALOGUE } from '../simulation/weather-catalogue.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import type { CareerEvent } from './ladder.ts';
import { MEDALS, type Medal } from './licences.ts';
import { vehicleDiscipline, type CareerVehicle, type DisciplineId } from './registry.ts';

/** THE WILDCARD SERIES: events that put a machine on a venue it was never
 * built for (a formula car down a mountain pass, a dirt bike across a banked
 * oval, a GT car on a rallycross track). Each is ordinary
 * `EventDefinition` data resolved by `eventSession`, run by the same
 * production simulation, AI and race control as every other event; the series
 * adds only what a menu needs around it (title, pitch, flavour, medal ladder)
 * and the rulesets that allow the pairing (simulation/wildcard-rulesets.ts).
 *
 * Evidence: `npm run test:wildcard` runs every event as the player loads it
 * in a seeded AI race and writes docs/wildcard-races.json; the unit tests
 * refuse an event that has no passing race there. See
 * docs/studio/reports/content.md for the integration contract. */
export type WildcardKind =
  /** A machine of one discipline on a venue of another (a car on a stadium
   * floor, a dirt bike on a banked oval, a road bike on a docklands street). */
  | 'cross-discipline'
  /** A circuit machine on the wrong circuit (a formula car on a mountain
   * pass, karts on a night-city street, a hypercar in a harbour tunnel). */
  | 'class-mismatch';
/** Flavour the session applies on top of the event data.
 * `no-assists`: the session runs with the raw handling model (Assist 'raw').
 * `time-attack`: a solo timed session (mode 'time-trial'); the ladder is the
 * best valid lap against the benchmark the AI set in the evidence run. */
export type WildcardRule = 'no-assists' | 'time-attack';
/** Advisory lighting for the front end; the simulation does not read it.
 * Same vocabulary as the renderer's LightingMode (rendering/daylight.ts). */
export type WildcardLighting = 'day' | 'sunset' | 'night';
/** What earns a medal. `position`: the worst finishing place that earns it
 * (gold 1, silver 3, bronze 5 means win / podium / top five). `best-lap`: the
 * slowest valid best lap in seconds that earns it. Limits are strictly
 * ordered gold < silver < bronze. */
export interface WildcardLadder {
  readonly metric: 'position' | 'best-lap';
  readonly gold: number;
  readonly silver: number;
  readonly bronze: number;
}
export interface WildcardEntry {
  /** Same as `event.id`; the career record key is `wildcard.<id>`. */
  readonly id: string;
  /** Uppercase menu title, at most 48 characters. */
  readonly title: string;
  /** One line (at most 140 characters) that sells the mismatch. */
  readonly pitch: string;
  readonly kind: WildcardKind;
  readonly rules: readonly WildcardRule[];
  readonly lighting: WildcardLighting | null;
  readonly ladder: WildcardLadder;
  /** Career pay multiplier (the series loans the machine: no ownership needed). */
  readonly stakes: number;
  readonly event: EventDefinition;
}
interface WildcardSpec {
  id: string;
  title: string;
  pitch: string;
  kind: WildcardKind;
  /** One machine for the whole grid, or a list cycled across it. */
  vehicles: string | readonly string[];
  circuit: CircuitId;
  ruleset: string;
  weather: WeatherPreset;
  laps: number;
  /** Grid size including the player. */
  cars: number;
  aiSkill: number;
  seed: number;
  ladder: WildcardLadder;
  rules?: readonly WildcardRule[];
  lighting?: WildcardLighting;
  stakes?: number;
}
const cycle = (ids: string | readonly string[], count: number) =>
  typeof ids === 'string'
    ? ids
    : Object.freeze(Array.from({ length: count }, (_, i) => ids[i % ids.length]));
/** Weather that asks for full wets (rain, thunderstorm: the catalogue's own
 * suggestion) races on wets where the ruleset allows them, as the career builds them. */
function compoundFor(ruleset: string, weather: WeatherPreset): EventDefinition['compound'] {
  const allowed = RULESETS[ruleset]?.tires.allowed ?? [];
  return WEATHER_CATALOGUE[weather].suggestedTyre === 'wet' && allowed.includes('wet')
    ? 'wet'
    : 'medium';
}
function entry(spec: WildcardSpec): WildcardEntry {
  const timeAttack = spec.rules?.includes('time-attack') ?? false;
  const cars = timeAttack ? 1 : spec.cars;
  const ruleset = timeAttack ? 'wildcard-time-attack' : spec.ruleset;
  const event: EventDefinition = Object.freeze({
    id: spec.id,
    version: 1,
    name: spec.title,
    circuit: spec.circuit,
    mode: timeAttack ? ('time-trial' as const) : ('race' as const),
    ruleset,
    laps: spec.laps,
    opponents: cars - 1,
    weather: spec.weather,
    vehicles: cycle(spec.vehicles, cars),
    compound: compoundFor(ruleset, spec.weather),
    seed: spec.seed,
    aiSkill: spec.aiSkill,
  });
  return Object.freeze({
    id: spec.id,
    title: spec.title,
    pitch: spec.pitch,
    kind: spec.kind,
    rules: Object.freeze([...(spec.rules ?? [])]),
    lighting: spec.lighting ?? null,
    ladder: Object.freeze({ ...spec.ladder }),
    stakes: spec.stakes ?? 1,
    event,
  });
}
/** Win, podium, and every place but the last: gold 1, silver 3, bronze one
 * short of the whole grid (never worse than fourth of four). */
const podium = (cars: number): WildcardLadder => ({
  metric: 'position',
  gold: 1,
  silver: 3,
  bronze: Math.max(4, cars - 1),
});
/** A time-attack ladder from the benchmark lap the AI set in the evidence
 * run (docs/wildcard-races.json): beat it by 1% for gold, within 3% for
 * silver, within 10% for bronze. */
const attack = (benchmark: number): WildcardLadder => ({
  metric: 'best-lap',
  gold: +(benchmark * 0.99).toFixed(2),
  silver: +(benchmark * 1.03).toFixed(2),
  bronze: +(benchmark * 1.1).toFixed(2),
});

const SPECS: readonly WildcardSpec[] = [
  // ---- A machine on a circuit that is not its own ------------------------
  {
    id: 'descent-in-the-cloud',
    title: 'THE DESCENT IN THE CLOUD',
    pitch:
      'A formula car runs a mountain pass downhill in cold fog: stacked switchbacks, rock on one side and a long drop on the other.',
    kind: 'class-mismatch',
    vehicles: 'apx01',
    circuit: 'alpine-pass-reverse',
    ruleset: 'formula-grand-prix',
    weather: 'fog',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50101,
    ladder: podium(6),
  },
  {
    id: 'formula-on-the-wall',
    title: 'FORMULA ON THE WALL',
    pitch:
      'Downforce cars on a 31-degree banked oval: three laps near 300 km/h with a safety wall at the mirrors.',
    kind: 'class-mismatch',
    vehicles: 'fx26',
    circuit: 'speedbowl',
    ruleset: 'formula-grand-prix',
    weather: 'clear',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50102,
    ladder: podium(6),
  },
  {
    id: 'hypercars-in-the-harbour',
    title: 'HYPERCARS IN THE HARBOUR TUNNEL',
    pitch:
      'Prototype hypercars race a harbour street circuit in a thunderstorm: a curving tunnel, 2.6 m walls and gusts off the water.',
    kind: 'class-mismatch',
    vehicles: 'hy9',
    circuit: 'riviera',
    ruleset: 'prototype-sprint',
    weather: 'storm',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50103,
    ladder: podium(6),
  },
  {
    id: 'karts-after-dark',
    title: 'KARTS AFTER DARK',
    pitch:
      'Shifter karts take a floodlit city circuit in the rain: two tunnels that stay dry, a riverside blast and a plaza corner.',
    kind: 'class-mismatch',
    vehicles: 'sk125',
    circuit: 'neon-city',
    ruleset: 'kart-sprint',
    weather: 'rain',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50104,
    lighting: 'night',
    ladder: podium(6),
  },
  // ---- A machine of one discipline on a venue of another ------------------
  {
    id: 'knobblies-on-the-banking',
    title: 'KNOBBLIES ON THE BANKING',
    pitch:
      'Motocross bikes on a 31-degree banked tri-oval: knobbly tyres, safety walls and 110 km/h of pure nerve.',
    kind: 'cross-discipline',
    vehicles: 'mx450',
    circuit: 'speedbowl',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50201,
    ladder: podium(6),
  },
  {
    id: 'prototypes-and-the-flyover',
    title: 'PROTOTYPES AND THE FLYOVER',
    pitch:
      'Prototype grand-prix bikes thread a docklands street circuit: concrete walls, a 9.9 m flyover and no bike-safe run-off.',
    kind: 'cross-discipline',
    vehicles: ['gpr1', 'gpr2'],
    circuit: 'dockyard',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50202,
    ladder: podium(6),
  },
  {
    id: 'red-canyon-scramble',
    title: 'RED CANYON SCRAMBLE',
    pitch:
      'Two-stroke motocross bikes on a tarmac circuit through a slot canyon, with rain due mid-race: 100 km/h dry, 70 wet.',
    kind: 'cross-discipline',
    vehicles: 'mx250',
    circuit: 'desert-canyon',
    ruleset: 'wildcard-riders',
    weather: 'changeable',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50203,
    ladder: podium(6),
  },
  {
    id: 'supermoto-after-dark',
    title: 'SUPERMOTO AFTER DARK',
    pitch:
      'Supermotos under the cranes of a floodlit container terminal, with rain due: a figure-eight with a flyover, built for cars.',
    kind: 'cross-discipline',
    vehicles: 'sm450',
    circuit: 'gantry-point',
    ruleset: 'wildcard-riders',
    weather: 'changeable',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50204,
    lighting: 'night',
    ladder: podium(6),
  },
  {
    id: 'supermoto-meets-the-joker',
    title: 'SUPERMOTO MEETS THE JOKER',
    pitch:
      'Supermotos on a rallycross circuit in a dust storm: tarmac, rolled gravel and a crest jump; the joker road is for cars.',
    kind: 'cross-discipline',
    vehicles: 'sm450',
    circuit: 'kestrel-rx',
    ruleset: 'wildcard-riders',
    weather: 'dust',
    laps: 4,
    cars: 6,
    aiSkill: 0.92,
    seed: 50205,
    ladder: podium(6),
  },
  {
    id: 'forest-stage-on-slicks',
    title: 'THE FOREST STAGE ON SLICKS',
    pitch:
      'A full lap of a gravel rally stage in the rain on supermoto tyres: crests over the ridge, a hairpin and a watersplash.',
    kind: 'cross-discipline',
    vehicles: 'sm450',
    circuit: 'pinewood-stage',
    ruleset: 'wildcard-riders',
    weather: 'rain',
    laps: 2,
    cars: 5,
    aiSkill: 0.92,
    seed: 50206,
    ladder: podium(5),
  },
  {
    id: 'the-long-way-round',
    title: 'THE LONG WAY ROUND',
    pitch:
      'One lap of a 20.8 km forest ring on a motocross bike: twelve minutes, 33 corners, blind crests and a banked hairpin.',
    kind: 'cross-discipline',
    vehicles: 'mx450',
    circuit: 'hochwald',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 1,
    cars: 4,
    aiSkill: 0.92,
    seed: 50207,
    lighting: 'sunset',
    ladder: podium(4),
  },
  {
    id: 'grand-tourers-on-gravel',
    title: 'GRAND TOURERS ON GRAVEL',
    pitch:
      'Front-engine GT cars on a wet rallycross circuit: tarmac, mud, a crest and a hairpin they were never tuned for.',
    kind: 'cross-discipline',
    vehicles: 'gt8f',
    circuit: 'kestrel-rx',
    ruleset: 'wildcard-machines',
    weather: 'rain',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50208,
    ladder: podium(6),
  },
  {
    id: 'rallycross-on-the-grid',
    title: 'RALLYCROSS ON THE GRAND PRIX GRID',
    pitch:
      'Rallycross cars on a full grand-prix circuit: built to slide, they now face two long tarmac straights.',
    kind: 'cross-discipline',
    vehicles: 'rcx6',
    circuit: 'parco-reale',
    ruleset: 'rallycross-heat',
    weather: 'clear',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50209,
    ladder: podium(6),
  },
  {
    id: 'trophy-trucks-on-neon-streets',
    title: 'TROPHY TRUCKS ON NEON STREETS',
    pitch:
      'Desert trucks on a floodlit city circuit: long-travel suspension, concrete walls and two tunnels.',
    kind: 'cross-discipline',
    vehicles: 'dx8',
    circuit: 'neon-city',
    ruleset: 'rallycross-heat',
    weather: 'clear',
    laps: 2,
    cars: 5,
    aiSkill: 0.92,
    seed: 50210,
    lighting: 'night',
    ladder: podium(5),
  },
  // ---- The weather states, put to work ----------------------------------
  {
    id: 'desert-trucks-on-the-iced-col',
    title: 'DESERT TRUCKS ON THE ICED COL',
    pitch:
      'Trophy trucks climb a mountain pass in a snowfall: loose snow on the climb, polished wheel tracks, 400 m of view in the squall.',
    kind: 'cross-discipline',
    vehicles: 'dx8',
    circuit: 'alpine-pass',
    ruleset: 'rallycross-heat',
    weather: 'snow',
    laps: 1,
    cars: 5,
    aiSkill: 0.92,
    seed: 50601,
    ladder: podium(5),
  },
  {
    id: 'haboob-in-the-canyon',
    title: 'HABOOB IN THE RED CANYON',
    pitch:
      'Trophy trucks race a slot-canyon circuit inside a dust storm: 170 m of amber haze and a loose film over the tarmac, thinnest on the line.',
    kind: 'cross-discipline',
    vehicles: 'dx8',
    circuit: 'desert-canyon',
    ruleset: 'rallycross-heat',
    weather: 'dust',
    laps: 2,
    cars: 5,
    aiSkill: 0.92,
    seed: 50602,
    ladder: podium(5),
  },
  // ---- Level Nine: a multi-storey car park ------------------------------
  {
    id: 'roof-deck-hatchbacks',
    title: 'ROOF DECK HATCHBACKS',
    pitch:
      'Hot-hatch racers in a multi-storey car park: roofed ramps, pillar slaloms and two tight hairpins. It never rains inside.',
    kind: 'class-mismatch',
    vehicles: 'hh2',
    circuit: 'level-nine',
    ruleset: 'club-sprint',
    weather: 'clear',
    laps: 4,
    cars: 6,
    aiSkill: 0.92,
    seed: 50301,
    ladder: podium(6),
  },
  {
    id: 'supermoto-on-the-roof',
    title: 'SUPERMOTO ON THE ROOF DECK',
    pitch:
      'Supermotos take a car park flat out: 4% ramps, pillar slaloms and a 1.4 km lap done in under a minute.',
    kind: 'cross-discipline',
    vehicles: 'sm450',
    circuit: 'level-nine',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 4,
    cars: 6,
    aiSkill: 0.92,
    seed: 50302,
    ladder: podium(6),
  },
  // ---- More of the unexpected -------------------------------------------
  {
    id: 'grand-prix-bikes-on-the-runway',
    title: 'GRAND PRIX BIKES ON THE RUNWAY',
    pitch:
      'Prototype grand-prix bikes on a salt-flat airbase: a two-kilometre runway, sweepers across the salt and a 230 km/h lap average.',
    kind: 'cross-discipline',
    vehicles: ['gpr1', 'gpr2'],
    circuit: 'salt-flat',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50401,
    ladder: podium(6),
  },
  {
    id: 'hypercar-roof-deck-attack',
    title: 'HYPERCAR ROOF DECK ATTACK',
    pitch:
      'A solo hot lap of a multi-storey car park in a hypercar with no ABS and no traction control, and walls 1.4 m off the asphalt.',
    kind: 'class-mismatch',
    vehicles: 'hy11',
    circuit: 'level-nine',
    ruleset: 'wildcard-time-attack',
    weather: 'clear',
    laps: 3,
    cars: 1,
    aiSkill: 0.92,
    seed: 50402,
    rules: ['time-attack', 'no-assists'],
    // Benchmark: the AI's best of three laps (docs/wildcard-races.json).
    ladder: attack(41.37),
  },
  {
    id: 'road-machines-on-the-forest-ring',
    title: 'ROAD MACHINES ON THE FOREST RING',
    pitch:
      'A rally-bred road car, a muscle coupe, a supercar and a roadster take one lap of a 20.8 km forest ring as the light goes.',
    kind: 'class-mismatch',
    vehicles: ['rr4', 'rm8', 'sc7', 'rd2'],
    circuit: 'hochwald',
    ruleset: 'open-exhibition',
    weather: 'clear',
    laps: 1,
    cars: 4,
    aiSkill: 0.92,
    seed: 50501,
    lighting: 'sunset',
    ladder: podium(4),
  },
  // ---- Wave 2: unexpected places (Haut-Givre, Marram Field, Kalder Dam, Saffron Lane) ----
  {
    id: 'supercars-in-the-ski-resort',
    title: 'SUPERCARS IN THE SKI RESORT',
    pitch:
      'A supercar, a muscle coupe, a roadster and a rally-bred road car share a snowed-in resort road: six hairpins and a polished wheel track.',
    kind: 'class-mismatch',
    vehicles: ['sc7', 'rm8', 'rd2', 'rr4'],
    circuit: 'haut-givre',
    ruleset: 'open-exhibition',
    weather: 'snow',
    laps: 1,
    cars: 4,
    aiSkill: 0.92,
    seed: 50702,
    ladder: podium(4),
  },
  {
    id: 'trucks-on-the-ski-road',
    title: 'TROPHY TRUCKS ON THE SKI ROAD',
    pitch:
      'Desert trucks take a ski-resort road in a snowfall: six hairpins, a ridge run and a roofed gallery where the snow stops.',
    kind: 'cross-discipline',
    vehicles: 'dx8',
    circuit: 'haut-givre',
    ruleset: 'rallycross-heat',
    weather: 'snow',
    laps: 1,
    cars: 5,
    aiSkill: 0.92,
    seed: 50717,
    ladder: podium(5),
  },
  {
    id: 'trophy-trucks-on-the-taxiway',
    title: 'TROPHY TRUCKS ON THE TAXIWAY',
    pitch:
      'Desert trucks race an airport at dawn in fog: a runway sprint, a blast-pad turn, taxiway chicanes and a slalom between the gates.',
    kind: 'cross-discipline',
    vehicles: 'dx8',
    circuit: 'marram-field',
    ruleset: 'rallycross-heat',
    weather: 'fog',
    laps: 2,
    cars: 5,
    aiSkill: 0.92,
    seed: 50704,
    lighting: 'sunset',
    ladder: podium(5),
  },
  {
    id: 'hypercars-on-the-runway',
    title: 'HYPERCARS ON THE RUNWAY',
    pitch:
      'Prototype hypercars take an airport in a dust storm: a 1.6 km runway, taxiway chicanes and 170 m of amber haze on the apron slalom.',
    kind: 'class-mismatch',
    vehicles: ['hy9', 'hy11'],
    circuit: 'marram-field',
    ruleset: 'prototype-sprint',
    weather: 'dust',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50705,
    ladder: podium(6),
  },
  {
    id: 'karts-on-the-dam-road',
    title: 'KARTS ON THE DAM ROAD',
    pitch:
      'Shifter karts race a dam crest in a thunderstorm: concrete parapets, water 20 m below on both sides and gusts off the reservoir.',
    kind: 'class-mismatch',
    vehicles: 'sk125',
    circuit: 'kalder-dam',
    ruleset: 'kart-sprint',
    weather: 'storm',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50708,
    ladder: podium(6),
  },
  {
    id: 'formula-gale-on-the-dam',
    title: 'FORMULA CARS IN A GALE ON THE DAM',
    pitch:
      'Formula cars cross a dam crest in a thunderstorm on wet tyres: a kilometre of concrete, 20 m of water either side and gusts off the lake.',
    kind: 'class-mismatch',
    vehicles: 'fx26',
    circuit: 'kalder-dam',
    ruleset: 'formula-grand-prix',
    weather: 'storm',
    laps: 2,
    cars: 6,
    aiSkill: 0.92,
    seed: 50709,
    ladder: podium(6),
  },
  {
    id: 'karts-in-the-night-market',
    title: 'KARTS IN THE NIGHT MARKET',
    pitch:
      'Shifter karts race a night market in the rain: the covered halls stay dry, the open lanes do not.',
    kind: 'class-mismatch',
    vehicles: 'sk125',
    circuit: 'saffron-lane',
    ruleset: 'kart-sprint',
    weather: 'rain',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50711,
    lighting: 'night',
    ladder: podium(6),
  },
  {
    id: 'supermoto-in-the-night-market',
    title: 'SUPERMOTO IN THE NIGHT MARKET',
    pitch:
      'Supermotos weave a night market: three hairpins, covered halls and a spice-row slalom, under the lamps.',
    kind: 'cross-discipline',
    vehicles: 'sm450',
    circuit: 'saffron-lane',
    ruleset: 'wildcard-riders',
    weather: 'clear',
    laps: 3,
    cars: 6,
    aiSkill: 0.92,
    seed: 50713,
    lighting: 'night',
    ladder: podium(6),
  },
];

/** The series in menu order. */
export const WILDCARD_SERIES: readonly WildcardEntry[] = Object.freeze(SPECS.map(entry));
/** Just the events, for tools that walk `EventDefinition`s. */
export const WILDCARD_EVENTS: readonly EventDefinition[] = Object.freeze(
  WILDCARD_SERIES.map((e) => e.event),
);
/** The series, in menu order. The UI lists this. */
export function wildcardSeries(): readonly WildcardEntry[] {
  return WILDCARD_SERIES;
}
export function wildcardEntry(id: string): WildcardEntry | undefined {
  return WILDCARD_SERIES.find((e) => e.id === id);
}
/** Is this event a wildcard (so a results screen can offer the medal)? */
export function isWildcardEvent(eventId: string): boolean {
  return WILDCARD_SERIES.some((e) => e.id === eventId);
}
/** The session the simulation loads for an entry: the event resolved through
 * `eventSession` over `base` (the player's setup and other menu choices), with
 * the entry's flavour rules applied. Throws exactly as `eventSession` does if
 * the pairing is not allowed. */
export function wildcardSession(
  entry: WildcardEntry,
  base: SessionOptions = DEFAULT_OPTIONS,
): SessionOptions {
  return eventSession(
    entry.event,
    entry.rules.includes('no-assists') ? { ...base, assist: 'raw' } : base,
  );
}
/** Career record key of an entry (`CareerSave.results[key]`). */
export const wildcardKey = (entry: Pick<WildcardEntry, 'id'>) => `wildcard.${entry.id}`;

/** A finished session as the medal reads it (a subset of economy.RaceOutcome). */
export interface WildcardResult {
  position: number;
  classified: boolean;
  /** Best valid lap (s); 0 when none. */
  bestLap: number;
}
/** The medal a result earns, or null: an unclassified result never medals; a
 * position ladder reads the finishing place, a best-lap ladder the best lap. */
export function wildcardMedal(
  entry: Pick<WildcardEntry, 'ladder'>,
  result: WildcardResult,
): Medal | null {
  const { ladder } = entry;
  if (!result.classified) return null;
  const value = ladder.metric === 'position' ? result.position : result.bestLap;
  if (!Number.isFinite(value) || value <= 0) return null;
  for (const medal of [...MEDALS].reverse() as Medal[]) if (value <= ladder[medal]) return medal;
  return null;
}
/** The best medal recorded in a career record (`save.results[wildcardKey]`:
 * best position and best lap). The record cannot show classification, so a
 * stored start counts as classified. */
export function wildcardMedalFromRecord(
  entry: Pick<WildcardEntry, 'ladder'>,
  record: { bestPosition: number; bestLap: number; starts: number } | undefined,
): Medal | null {
  if (!record || record.starts < 1) return null;
  return wildcardMedal(entry, {
    position: record.bestPosition,
    classified: true,
    bestLap: record.bestLap,
  });
}
/** The discipline whose reputation an entry's machine earns. */
export function wildcardDiscipline(entry: Pick<WildcardEntry, 'event'>): DisciplineId {
  const first = [entry.event.vehicles].flat()[0];
  return vehicleDiscipline(VEHICLES[first] as unknown as CareerVehicle);
}
/** The slice of `CareerEvent` that `economy.settleRace` reads, so a wildcard
 * result is paid, recorded and given reputation by the career's own code:
 * `settleRace(save, wildcardCareerEvent(entry), outcome)`. */
export function wildcardCareerEvent(
  entry: WildcardEntry,
): Pick<CareerEvent, 'key' | 'kind' | 'discipline' | 'name' | 'stakes' | 'objectives'> {
  const timeAttack = entry.rules.includes('time-attack');
  return {
    key: wildcardKey(entry),
    kind: 'invitational',
    discipline: wildcardDiscipline(entry),
    name: entry.title,
    stakes: entry.stakes,
    objectives: timeAttack
      ? [{ id: 'clean-lap', label: 'Set a valid timed lap', amount: 2500, value: 1 }]
      : [
          { id: 'top', label: 'Finish on the podium', amount: 2500, value: 3 },
          { id: 'gain', label: 'Gain two places from your grid slot', amount: 1500, value: 2 },
        ],
  };
}
