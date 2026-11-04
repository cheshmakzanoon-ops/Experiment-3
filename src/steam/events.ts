/**
 * Typed game-event bus (achievements, Steam rich presence).
 *
 * Existing game code emits one-line, already-observable facts ("a race was
 * finished", "a photo was taken"); nothing here reads game state, imports the
 * simulation or touches the DOM. Listeners are isolated: a faulty listener can
 * never break the game code that emitted, and emitting with no listener is free.
 */

/** The four racing disciplines the achievement set covers (festival is separate). */
export type Discipline = 'circuit' | 'gp-bike' | 'motocross' | 'supercross';
export type SessionMode = 'race' | 'practice' | 'time-trial' | 'qualifying' | 'endurance';

/** A circuit / GP / motocross / supercross session reached its results. */
export interface RaceFinishedEvent {
  type: 'race.finished';
  discipline: Discipline;
  mode: SessionMode;
  circuitId: string;
  vehicleId: string;
  vehicleClass: string;
  /** 1-based classification, field size and starting slot. */
  position: number;
  fieldSize: number;
  gridSlot: number;
  classified: boolean;
  laps: number;
  penaltySeconds: number;
  /** Classified, no penalty seconds and no bodywork/aero damage. */
  clean: boolean;
  /** Open string: new weather states can be added without touching this file. */
  weather: string;
  /** It was raining (or worse) when the session finished. */
  wet: boolean;
  /** Vehicle and venue are deliberately mismatched (the Wildcard series). */
  wildcard: boolean;
  /** The AI drove for the player at some point; never counts toward achievements. */
  demonstration: boolean;
}

/** A new personal-best lap time was stored for a circuit/assist/compound/weather. */
export interface LapRecordEvent {
  type: 'lap.record';
  discipline: Discipline;
  circuitId: string;
  seconds: number;
  /** First time any lap was recorded for this key. */
  firstOnTrack: boolean;
}

/** A championship season was scored to its last round. */
export interface ChampionshipCompletedEvent {
  type: 'championship.completed';
  /** Player's final 1-based standing. */
  position: number;
  rounds: number;
  entrants: number;
}

/** A career licence test finished. */
export interface LicenceEvent {
  type: 'career.licence';
  licence: string;
  medal: 'bronze' | 'silver' | 'gold' | null;
  valid: boolean;
}

/** A festival (open world) event produced a typed result. */
export interface FestivalActivityEvent {
  type: 'festival.activity';
  eventKind: string;
  completed: boolean;
  assisted: boolean;
  stars: number;
  /** 1-based finishing position for race kinds, else 0. */
  position: number;
  entrants: number;
  trapKmh: number;
  averageKmh: number;
  driftScore: number;
  vehicleId: string;
}

export interface FestivalDiscoveryEvent {
  type: 'festival.discovered';
  id: string;
  /** Places discovered so far. */
  total: number;
}

/** A jump was landed cleanly in free roam. */
export interface FestivalJumpEvent {
  type: 'festival.jump';
  airSeconds: number;
  distance: number;
}

/** A skill chain was banked. */
export interface FestivalChainEvent {
  type: 'festival.chain';
  points: number;
  bestChain: number;
  sessionTotal: number;
}

/** A clean pass of ambient traffic was scored. */
export interface FestivalCleanPassEvent {
  type: 'festival.cleanPass';
}

export interface PhotoTakenEvent {
  type: 'photo.taken';
  /** Where the photo mode was opened from. */
  context: string;
}

/** Presence only: no achievement uses these. */
export interface SessionStartedEvent {
  type: 'session.started';
  kind: 'circuit' | 'festival';
  discipline: Discipline | 'festival';
  circuitId: string;
  vehicleId: string;
  weather: string;
  /** Session mode (race, practice, time-trial, ...), absent for the festival. */
  mode?: string;
  /** The Wildcard Series event being driven, when the session is one. */
  wildcardEvent?: string;
}
export interface MenuEnteredEvent {
  type: 'menu.entered';
}

/** A valid, player-driven time-trial lap finished (every one, not only personal bests). */
export interface TimeTrialLapEvent {
  type: 'timetrial.lap';
  circuitId: string;
  vehicleId: string;
  /** Physics version the lap was driven under (a record category, session-identity.ts). */
  physics: number;
  seconds: number;
  assist: string;
  compound: string;
  weather: string;
}

/** A Wildcard event was driven and settled by the career (never an AI-driven or unclassified run). */
export interface WildcardResultEvent {
  type: 'wildcard.result';
  eventId: string;
  physics: number;
  /** Best valid lap of the session (s), 0 when none. */
  bestLap: number;
  position: number;
  medal: 'bronze' | 'silver' | 'gold' | null;
  assist: string;
  weather: string;
}

export type GameEvent =
  | RaceFinishedEvent
  | LapRecordEvent
  | ChampionshipCompletedEvent
  | LicenceEvent
  | FestivalActivityEvent
  | FestivalDiscoveryEvent
  | FestivalJumpEvent
  | FestivalChainEvent
  | FestivalCleanPassEvent
  | PhotoTakenEvent
  | SessionStartedEvent
  | MenuEnteredEvent
  | TimeTrialLapEvent
  | WildcardResultEvent;

export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type GameListener = (event: GameEvent) => void;

export class GameEventBus {
  private listeners = new Set<GameListener>();

  /** Subscribe to every event. Returns the unsubscribe function. */
  subscribe(listener: GameListener) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Subscribe to one event type with a narrowed payload. */
  on<T extends GameEventType>(type: T, listener: (event: GameEventOf<T>) => void) {
    return this.subscribe((event) => {
      if (event.type === type) listener(event as GameEventOf<T>);
    });
  }

  emit(event: GameEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        /* achievements must never break the game that emitted */
      }
    }
  }

  get size() {
    return this.listeners.size;
  }
}

/** The single process-wide bus game code emits to. */
export const gameEvents = new GameEventBus();
export const emitGameEvent = (event: GameEvent) => gameEvents.emit(event);
