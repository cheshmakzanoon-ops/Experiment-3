import { F, H, carBase } from '../simulation/protocol.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { circuitDefinition } from '../simulation/circuits.ts';
import { DEFAULT_VEHICLE_ID, vehicleDefinition } from '../simulation/vehicles.ts';
import { VEHICLE_CLASSES } from '../simulation/vehicle-classes.ts';
import { SIMULATION_VERSION, recordCategory } from '../core/session-identity.ts';
import { emitGameEvent } from './events.ts';
import type {
  Discipline,
  FestivalActivityEvent,
  GameEvent,
  LapRecordEvent,
  RaceFinishedEvent,
  SessionStartedEvent,
  TimeTrialLapEvent,
  WildcardResultEvent,
} from './events.ts';

/**
 * Glue between existing game objects and the typed events in events.ts. The
 * game calls ONE function per moment (`emitGameEvent(raceFinishedEvent(...))`);
 * everything that interprets frames, options or results lives here so the
 * call sites in main.ts / career / session stay one-liners.
 */

/** Dirt classes: a vehicle of any other class at a motocross/supercross venue is a mismatch. */
const DIRT_CLASSES = new Set(['motocross', 'supermoto']);
const WET_WEATHER = /rain|drizzle|storm|shower|thunder|wet|downpour/i;

export interface RaceContext {
  discipline: Discipline;
  vehicleId: string;
  vehicleClass: string;
  wildcard: boolean;
}

/**
 * Discipline follows the venue on dirt (motocross / supercross) and the
 * vehicle elsewhere (motorcycle = GP bike, otherwise circuit car). A wildcard
 * is a deliberate mismatch: a non-dirt vehicle at a dirt venue, a motocross
 * bike on tarmac, or any session whose ruleset id names the Wildcard series.
 */
export function raceContext(
  options: Pick<SessionOptions, 'circuit' | 'vehicles' | 'ruleset'>,
): RaceContext {
  const vehicle = vehicleDefinition(options.vehicles?.[0] ?? DEFAULT_VEHICLE_ID);
  const venue = circuitDefinition(options.circuit).offroad?.kind;
  const dirtVenue = venue === 'motocross' || venue === 'supercross';
  const family = VEHICLE_CLASSES[vehicle.classId]?.family;
  let discipline: Discipline;
  if (venue === 'supercross') discipline = 'supercross';
  else if (venue === 'motocross' || vehicle.classId === 'motocross') discipline = 'motocross';
  else discipline = family === 'motorcycle' ? 'gp-bike' : 'circuit';
  const mismatched =
    (dirtVenue && !DIRT_CLASSES.has(vehicle.classId)) ||
    (!dirtVenue && vehicle.classId === 'motocross');
  return {
    discipline,
    vehicleId: vehicle.id,
    vehicleClass: vehicle.classId,
    wildcard: mismatched || /wildcard/i.test(options.ruleset ?? ''),
  };
}

/** The player's result frame -> a race.finished event. Reads, never writes, the frame. */
export function raceFinishedEvent(
  options: SessionOptions,
  frame: Float32Array,
  demonstration: boolean,
): RaceFinishedEvent {
  const o = carBase(0);
  const context = raceContext(options);
  const cars = Math.max(1, Math.round(frame[H.CARS]));
  const grid = options.grid ?? Array.from({ length: cars }, (_, i) => i);
  const penalty = Number(frame[o + F.PENALTY]) || 0;
  const health = Math.min(
    frame[o + F.FRONT_HEALTH],
    frame[o + F.FLOOR_HEALTH],
    frame[o + F.REAR_HEALTH],
  );
  const classified = frame[o + F.FINISH] > 0 && frame[o + F.RETIRED] === 0;
  const weather = String(options.weather);
  return {
    type: 'race.finished',
    ...context,
    mode: options.mode,
    circuitId: circuitDefinition(options.circuit).id,
    position: Math.max(1, Math.round(frame[o + F.RANK])),
    fieldSize: cars,
    gridSlot: Math.max(1, grid.indexOf(0) + 1),
    classified,
    laps: options.laps,
    penaltySeconds: penalty,
    clean: classified && penalty === 0 && health >= 0.97,
    weather,
    wet: frame[H.RAIN] > 0.25 || WET_WEATHER.test(weather),
    demonstration,
  };
}

export function lapRecordEvent(
  options: Pick<SessionOptions, 'circuit' | 'vehicles' | 'ruleset'>,
  seconds: number,
  firstOnTrack: boolean,
): LapRecordEvent {
  return {
    type: 'lap.record',
    discipline: raceContext(options).discipline,
    circuitId: circuitDefinition(options.circuit).id,
    seconds,
    firstOnTrack,
  };
}

export function sessionStartedEvent(
  options: Pick<SessionOptions, 'circuit' | 'vehicles' | 'ruleset' | 'weather'> & {
    mode?: SessionOptions['mode'];
  },
  kind: SessionStartedEvent['kind'] = 'circuit',
  wildcardEvent?: string,
): SessionStartedEvent {
  const context = raceContext(options);
  return {
    type: 'session.started',
    kind,
    discipline: kind === 'festival' ? 'festival' : context.discipline,
    circuitId: circuitDefinition(options.circuit).id,
    vehicleId: context.vehicleId,
    weather: String(options.weather),
    ...(kind === 'circuit' && options.mode ? { mode: options.mode } : {}),
    ...(wildcardEvent ? { wildcardEvent } : {}),
  };
}

/** A valid player-driven time-trial lap, in the record category it was driven in. */
export function timeTrialLapEvent(
  options: Pick<SessionOptions, 'circuit' | 'vehicles' | 'assist' | 'compound' | 'weather'>,
  seconds: number,
): TimeTrialLapEvent {
  const category = recordCategory(options);
  return {
    type: 'timetrial.lap',
    circuitId: category.circuit,
    vehicleId: category.vehicle,
    physics: category.physics,
    seconds,
    assist: String(options.assist),
    compound: String(options.compound),
    weather: String(options.weather),
  };
}

const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A FestivalResult (the `festival-result` window event's detail) -> festival.activity. Defensive. */
export function festivalActivityEvent(detail: unknown): FestivalActivityEvent | null {
  if (!detail || typeof detail !== 'object') return null;
  const r = detail as Record<string, unknown>;
  if (r.kind !== 'festival-result' || typeof r.eventKind !== 'string') return null;
  return {
    type: 'festival.activity',
    eventKind: r.eventKind,
    completed: r.completed === true && r.abandoned !== true,
    assisted: r.assisted === true,
    stars: Math.max(0, Math.min(3, Math.round(finite(r.stars)))),
    position: Math.max(0, Math.round(finite(r.position))),
    entrants: Math.max(0, Math.round(finite(r.entrants))),
    trapKmh: finite(r.trapKmh),
    averageKmh: finite(r.averageKmh),
    driftScore: finite(r.driftScore),
    vehicleId: typeof r.vehicleId === 'string' ? r.vehicleId : '',
  };
}

/** The slice of FestivalStatus the observer reads (structural, so tests need no session). */
export interface FestivalStatusLike {
  discovered: readonly string[];
  skills: {
    phase: string;
    label: string;
    sequence: number;
    lastBank: number;
    bestChain: number;
    sessionTotal: number;
    air?: { seconds: number; distance: number } | null;
  };
}

/**
 * Turns the festival's 10 Hz status stream into discrete events: new places
 * discovered, clean landings, banked skill chains, clean traffic passes. The
 * first status only seeds the baseline, so a returning player's old progress
 * is never replayed as new activity.
 */
export class FestivalStatusObserver {
  private seeded = false;
  private discovered = 0;
  private sequence = 0;
  private landing = false;
  private pass = false;
  private lastAir = { seconds: 0, distance: 0 };

  constructor(private readonly emit: (event: GameEvent) => void) {}

  observe(status: FestivalStatusLike) {
    const skills = status.skills;
    const places = status.discovered.length;
    if (skills.air) this.lastAir = { seconds: skills.air.seconds, distance: skills.air.distance };
    const landing = /CLEAN LANDING/.test(skills.label);
    const pass = skills.label === 'CLEAN PASS';
    if (!this.seeded) {
      this.seeded = true;
    } else {
      if (places > this.discovered)
        this.emit({
          type: 'festival.discovered',
          id: status.discovered[places - 1] ?? '',
          total: places,
        });
      if (landing && !this.landing) {
        this.emit({
          type: 'festival.jump',
          airSeconds: this.lastAir.seconds,
          distance: this.lastAir.distance,
        });
        this.lastAir = { seconds: 0, distance: 0 };
      }
      if (pass && !this.pass) this.emit({ type: 'festival.cleanPass' });
      if (skills.sequence !== this.sequence && skills.phase === 'banked' && skills.lastBank > 0)
        this.emit({
          type: 'festival.chain',
          points: skills.lastBank,
          bestChain: skills.bestChain,
          sessionTotal: skills.sessionTotal,
        });
    }
    this.discovered = places;
    this.sequence = skills.sequence;
    this.landing = landing;
    this.pass = pass;
  }

  /** A new festival session: forget the baseline (the next status re-seeds it). */
  reset() {
    this.seeded = false;
    this.landing = false;
    this.pass = false;
    this.lastAir = { seconds: 0, distance: 0 };
  }
}

/** Build-and-emit that can never throw into the caller: a hook must not break the game. */
function emitSafely(make: () => GameEvent | null) {
  try {
    const event = make();
    if (event) emitGameEvent(event);
  } catch {
    /* achievements are best effort */
  }
}
export const emitRaceFinished = (
  options: SessionOptions,
  frame: Float32Array,
  demonstration: boolean,
) => emitSafely(() => raceFinishedEvent(options, frame, demonstration));
export const emitLapRecord = (
  options: Parameters<typeof lapRecordEvent>[0],
  seconds: number,
  firstOnTrack: boolean,
) => emitSafely(() => lapRecordEvent(options, seconds, firstOnTrack));
export const emitSessionStarted = (
  options: Parameters<typeof sessionStartedEvent>[0],
  kind: SessionStartedEvent['kind'] = 'circuit',
  wildcardEvent?: string,
) => emitSafely(() => sessionStartedEvent(options, kind, wildcardEvent));
export const emitTimeTrialLap = (
  options: Parameters<typeof timeTrialLapEvent>[0],
  seconds: number,
) => emitSafely(() => timeTrialLapEvent(options, seconds));
export const emitWildcardResult = (event: Omit<WildcardResultEvent, 'type' | 'physics'>) =>
  emitSafely(() => ({ ...event, type: 'wildcard.result', physics: SIMULATION_VERSION }));
