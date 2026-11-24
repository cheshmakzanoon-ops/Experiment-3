import type { RecordedSessionIdentity } from '../core/session-identity.ts';
import { SETUP_LIMITS, type SessionOptions } from '../simulation/config.ts';
import { isWeatherId } from '../simulation/weather-catalogue.ts';
import { LIMITS } from './constants.ts';

/** Reliable control messages. Both directions are untrusted and validated
 * field by field; malformed known fields are rejected, not repaired. */
export type ClientControl =
  | {
      kind: 'join';
      net: number;
      name: string;
      vehicle: string;
      /** Identity the client computed from its own content for the
       * advertised session and its chosen vehicle (WP51). */
      identity: RecordedSessionIdentity;
      /** Rejoin token from an earlier welcome (WP54). */
      token?: string;
      /** Platform account id; authenticated by the platform layer. */
      account?: string;
    }
  | { kind: 'ready'; ready: boolean }
  | { kind: 'leave' }
  | { kind: 'ping'; t: number };

export interface LobbyMemberView {
  player: string;
  name: string;
  vehicle: string;
  ready: boolean;
}
export interface LobbyView {
  id: string;
  name: string;
  phase: SessionPhase;
  capacity: number;
  circuit: string;
  ruleset: string;
  mode: string;
  members: LobbyMemberView[];
}
export type SessionPhase = 'lobby' | 'grid' | 'race' | 'results' | 'teardown';
export interface GridEntry {
  car: number;
  name: string;
  /** Null for a server AI entrant. */
  player: string | null;
  vehicle: string;
}
export type RaceEvent =
  | { type: 'lap'; car: number; lap: number; time: number; valid: boolean; tick: number }
  | { type: 'driver'; car: number; mode: 'human' | 'ai'; reason: string; tick: number }
  | { type: 'finish'; car: number; tick: number };
export interface ResultEntry {
  position: number;
  car: number;
  name: string;
  player: string | null;
  laps: number;
  lapTimes: number[];
  best: number;
  status: 'running' | 'finished' | 'retired' | 'ai' | 'ghost';
}
export interface RaceResults {
  endTick: number;
  reason: 'finished' | 'time-limit' | 'aborted';
  classification: ResultEntry[];
  /** Digest of the verified record the server archived for this race. */
  recordDigest: string;
  /** Legal-progress audit disagreements (RouteProgress vs lap counter). */
  progressDisputes: number[];
  /** Every row's lapTimes is empty here: they were sent ahead in `lapTimes`
   * messages because the whole classification would not fit one message. */
  lapTimesSeparate?: boolean;
}
export type ServerControl =
  | { kind: 'welcome'; player: string; token: string; lobby: LobbyView }
  | { kind: 'reject'; reason: string }
  | { kind: 'lobby'; lobby: LobbyView }
  | {
      kind: 'grid';
      options: SessionOptions;
      identity: RecordedSessionIdentity;
      entries: GridEntry[];
      car: number;
      /** Server tick at which the race clock starts, and the current tick. */
      startTick: number;
      serverTick: number;
      /** Server ms until `startTick` is simulated (countdown). */
      startInMs: number;
      /** Present (empty) on a rejoin while the race runs: resets the
       * client's event history, which follows in `events` messages. */
      events?: RaceEvent[];
    }
  | { kind: 'events'; events: RaceEvent[] }
  /** Lap times of `car` from lap index `from`, ahead of a `results` message
   * with `lapTimesSeparate`. */
  | { kind: 'lapTimes'; car: number; from: number; times: number[] }
  | { kind: 'results'; results: RaceResults }
  | { kind: 'kicked'; reason: string }
  | { kind: 'pong'; t: number; serverTick: number };

const isString = (v: unknown, max = 64): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown, lo = 0, hi = 0xffffffff): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v: unknown, lo = 0): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo;
/** Reasons and caller-supplied lobby ids have no smaller producer limit.
 * The codec still enforces the encoded byte limit for the whole message. */
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.resultBytes;
const isCar = (v: unknown): v is number => isInt(v, 0, LIMITS.carsPerSnapshot - 1);
const isPlayer = (v: unknown): v is string => isString(v);
const isMode = (v: unknown): v is SessionOptions['mode'] =>
  v === 'race' || v === 'practice' || v === 'time-trial' || v === 'qualifying' || v === 'endurance';
/** Match the existing client bound when placing separate lap-time chunks. */
const MAX_RESULT_LAPS = 2160;

function validList<T>(v: unknown, item: (entry: unknown) => entry is T, max: number): v is T[] {
  return Array.isArray(v) && v.length <= max && v.every((entry) => item(entry));
}

function distinct(values: readonly unknown[]) {
  return new Set(values).size === values.length;
}

function validIdentity(v: unknown): v is RecordedSessionIdentity {
  if (!isObject(v)) return false;
  const i = v;
  return (
    isInt(i.formatVersion, 0, 1e6) &&
    isInt(i.simulationVersion, 0, 1e6) &&
    isInt(i.tickHz, 1, 10000) &&
    isString(i.circuit) &&
    isHash(i.circuitHash) &&
    isString(i.ruleset) &&
    isHash(i.rulesetHash) &&
    Array.isArray(i.vehicles) &&
    i.vehicles.length >= 1 &&
    i.vehicles.length <= LIMITS.playersPerLobby &&
    i.vehicles.every((x) => isString(x)) &&
    Array.isArray(i.vehicleHashes) &&
    i.vehicleHashes.length === i.vehicles.length &&
    i.vehicleHashes.every(isHash) &&
    isString(i.assist, 16) &&
    isInt(i.seed)
  );
}
/** Validate an untrusted control message; returns the reason it is invalid. */
export function validateClientControl(v: unknown): ClientControl | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'control message must be an object';
  const m = v as Record<string, unknown>;
  switch (m.kind) {
    case 'join': {
      if (!isInt(m.net, 0, 1e6)) return 'join: invalid protocol version';
      if (
        !isString(m.name, LIMITS.nameLength) ||
        [...m.name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
      )
        return 'join: invalid name';
      if (!isString(m.vehicle, 32)) return 'join: invalid vehicle';
      if (!validIdentity(m.identity)) return 'join: invalid content identity';
      if (
        m.token !== undefined &&
        !(typeof m.token === 'string' && /^[0-9a-f]{16,64}$/.test(m.token))
      )
        return 'join: invalid token';
      if (
        m.account !== undefined &&
        !(typeof m.account === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(m.account))
      )
        return 'join: invalid account';
      return {
        kind: 'join',
        net: m.net,
        name: m.name,
        vehicle: m.vehicle,
        identity: m.identity,
        ...(m.token !== undefined ? { token: m.token as string } : {}),
        ...(m.account !== undefined ? { account: m.account as string } : {}),
      };
    }
    case 'ready':
      if (typeof m.ready !== 'boolean') return 'ready: invalid flag';
      return { kind: 'ready', ready: m.ready };
    case 'leave':
      return { kind: 'leave' };
    case 'ping':
      if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return 'ping: invalid time';
      return { kind: 'ping', t: m.t };
    default:
      return 'unknown control message';
  }
}

function validLobby(v: unknown): v is LobbyView {
  if (!isObject(v)) return false;
  return (
    isText(v.id) &&
    isString(v.name, 48) &&
    (v.phase === 'lobby' ||
      v.phase === 'grid' ||
      v.phase === 'race' ||
      v.phase === 'results' ||
      v.phase === 'teardown') &&
    isInt(v.capacity, 1, LIMITS.playersPerLobby) &&
    isString(v.circuit) &&
    isString(v.ruleset) &&
    isMode(v.mode) &&
    validList(
      v.members,
      (member): member is LobbyMemberView =>
        isObject(member) &&
        isPlayer(member.player) &&
        isString(member.name, LIMITS.nameLength) &&
        isString(member.vehicle, 32) &&
        typeof member.ready === 'boolean',
      v.capacity,
    ) &&
    distinct(v.members.map((member) => member.player))
  );
}

/** Options are checked in place, so optional legacy fields and unknown
 * extension properties survive. validateOptions would silently repair bad
 * values, masking a malformed grid instead of rejecting it. */
function validOptions(v: unknown): v is SessionOptions {
  if (!isObject(v) || !isObject(v.setup)) return false;
  if (
    !isMode(v.mode) ||
    !isInt(v.laps, 1) ||
    !isInt(v.opponents, 0, LIMITS.playersPerLobby - 1) ||
    !isWeatherId(v.weather) ||
    (v.assist !== 'sport' && v.assist !== 'raw') ||
    (v.compound !== 'soft' &&
      v.compound !== 'medium' &&
      v.compound !== 'hard' &&
      v.compound !== 'intermediate' &&
      v.compound !== 'wet') ||
    !isInt(v.seed) ||
    (v.circuit !== undefined && !isString(v.circuit)) ||
    (v.ruleset !== undefined && !isString(v.ruleset)) ||
    (v.durationSeconds !== undefined && !isFiniteNumber(v.durationSeconds)) ||
    (v.aiSkill !== undefined && !isFiniteNumber(v.aiSkill))
  )
    return false;
  // Later setup controls may be absent in older messages, just as in
  // validateSetup. Check every known field that is actually present.
  for (const key of Object.keys(SETUP_LIMITS))
    if (v.setup[key] !== undefined && !isFiniteNumber(v.setup[key], -Infinity)) return false;
  const cars = v.opponents + 1;
  if (
    v.vehicles !== undefined &&
    (!validList(v.vehicles, (id): id is string => isString(id, 32), cars) ||
      v.vehicles.length !== cars)
  )
    return false;
  for (const key of ['grid', 'gates'] as const) {
    const list = v[key];
    if (
      list !== undefined &&
      (!validList(list, (id): id is number => isInt(id, 0, key === 'grid' ? cars - 1 : 31), cars) ||
        list.length !== cars ||
        !distinct(list))
    )
      return false;
  }
  return true;
}

function validEntry(v: unknown): v is GridEntry {
  return (
    isObject(v) &&
    isCar(v.car) &&
    isString(v.name, LIMITS.nameLength) &&
    (v.player === null || isPlayer(v.player)) &&
    isString(v.vehicle, 32)
  );
}

function validEvent(v: unknown): v is RaceEvent {
  if (!isObject(v) || !isCar(v.car) || !isInt(v.tick)) return false;
  switch (v.type) {
    case 'lap':
      return isInt(v.lap, 1) && isFiniteNumber(v.time) && typeof v.valid === 'boolean';
    case 'driver':
      return (v.mode === 'human' || v.mode === 'ai') && isText(v.reason);
    case 'finish':
      return true;
    default:
      return false;
  }
}

function validEvents(v: unknown): v is RaceEvent[] {
  // The encoded message limit is the tighter bound for real event objects.
  return validList(v, validEvent, LIMITS.resultBytes);
}

function validResultEntry(v: unknown): v is ResultEntry {
  return (
    isObject(v) &&
    isInt(v.position, 1, LIMITS.carsPerSnapshot) &&
    isCar(v.car) &&
    isString(v.name, LIMITS.nameLength) &&
    (v.player === null || isPlayer(v.player)) &&
    isInt(v.laps) &&
    validList(v.lapTimes, isFiniteNumber, MAX_RESULT_LAPS) &&
    // LapTracker uses zero for "no valid best lap", not an infinite time.
    isFiniteNumber(v.best) &&
    (v.status === 'running' ||
      v.status === 'finished' ||
      v.status === 'retired' ||
      v.status === 'ai' ||
      v.status === 'ghost')
  );
}

function validResults(v: unknown): v is RaceResults {
  if (!isObject(v) || !validList(v.classification, validResultEntry, LIMITS.carsPerSnapshot))
    return false;
  const rows = v.classification;
  return (
    isInt(v.endTick) &&
    (v.reason === 'finished' || v.reason === 'time-limit' || v.reason === 'aborted') &&
    isHash(v.recordDigest) &&
    validList(v.progressDisputes, isCar, LIMITS.carsPerSnapshot) &&
    distinct(v.progressDisputes) &&
    (v.lapTimesSeparate === undefined || typeof v.lapTimesSeparate === 'boolean') &&
    rows.length > 0 &&
    distinct(rows.map((row) => row.car)) &&
    distinct(rows.map((row) => row.position)) &&
    rows.every(
      (row) => row.position <= rows.length && (!v.lapTimesSeparate || row.lapTimes.length === 0),
    )
  );
}

/** Validate the known server controls before the client consumes nested
 * fields. Extra properties are retained for compatible protocol extensions. */
export function validateServerControl(v: unknown): ServerControl | string {
  if (!isObject(v)) return 'control message must be an object';
  switch (v.kind) {
    case 'welcome':
      if (!isPlayer(v.player)) return 'welcome: invalid player';
      if (typeof v.token !== 'string' || !/^[0-9a-f]{16,64}$/.test(v.token))
        return 'welcome: invalid token';
      if (!validLobby(v.lobby)) return 'welcome: invalid lobby';
      break;
    case 'reject':
    case 'kicked':
      if (!isText(v.reason)) return `${v.kind}: invalid reason`;
      break;
    case 'lobby':
      if (!validLobby(v.lobby)) return 'lobby: invalid lobby';
      break;
    case 'grid': {
      if (!validOptions(v.options)) return 'grid: invalid options';
      if (!validIdentity(v.identity)) return 'grid: invalid content identity';
      const cars = v.options.opponents + 1;
      if (
        !validList(v.entries, validEntry, LIMITS.playersPerLobby) ||
        v.entries.length !== cars ||
        v.identity.vehicles.length !== cars ||
        !distinct(v.entries.map((entry) => entry.car)) ||
        !v.entries.every((entry) => entry.car < cars)
      )
        return 'grid: invalid entries';
      // -1 is the existing grid template's "no local car" sentinel.
      if (!isInt(v.car, -1, cars - 1)) return 'grid: invalid local car';
      if (!isInt(v.startTick) || !isInt(v.serverTick) || !isFiniteNumber(v.startInMs))
        return 'grid: invalid timing';
      if (v.events !== undefined && !validEvents(v.events)) return 'grid: invalid events';
      break;
    }
    case 'events':
      if (!validEvents(v.events)) return 'events: invalid events';
      break;
    case 'lapTimes':
      if (
        !isCar(v.car) ||
        !isInt(v.from, 0, MAX_RESULT_LAPS) ||
        !validList(v.times, isFiniteNumber, MAX_RESULT_LAPS - v.from)
      )
        return 'lapTimes: invalid lap times';
      break;
    case 'results':
      if (!validResults(v.results)) return 'results: invalid results';
      break;
    case 'pong':
      if (!isFiniteNumber(v.t, -Infinity) || !isInt(v.serverTick)) return 'pong: invalid timing';
      break;
    default:
      return 'unknown control message';
  }
  return v as ServerControl;
}
