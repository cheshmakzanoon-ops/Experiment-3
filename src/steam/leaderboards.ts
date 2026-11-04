import { SIMULATION_VERSION } from '../core/session-identity.ts';

/**
 * Steam leaderboards: the pure part (names, scores, the persisted outbox, the submit loop).
 *
 * Two families of board, both "lowest time wins", both per physics version (a physics change
 * starts a fresh board, exactly like the local records, `recordCategory`):
 *  - time trial: one board per circuit x machine, scored on the best valid lap;
 *  - Wildcard: one board per Wildcard event, scored on the best valid lap of a started,
 *    classified, player-driven session (the medal itself is local; the board ranks the time).
 *
 * Nothing here touches Steam, the DOM or the game: `submitPending` takes the send function, the
 * runtime (leaderboard-runtime.ts) supplies the bridge and the shell (desktop/src/steam.cjs)
 * does the call. The whole feature is optional and fails closed: with no Steam, no leaderboard
 * API in the loaded binding, or any error, scores stay in the outbox and the game is unchanged.
 */

/** Save-store key of the outbox (mirrored and Steam-Cloud synced like every other save). */
export const LEADERBOARD_STORE_KEY = 'steam-leaderboards';
/** A lap outside this range is not a lap (a glitch or a corrupt record), never a score. */
export const MIN_LAP_SECONDS = 3;
export const MAX_LAP_SECONDS = 1800;
/** Outbox size bound (a board is ~120 bytes; 46 circuits x a few machines + the event series). */
export const MAX_BOARDS = 600;
/** Failed sends of one board before it waits for the next launch or a better score. */
export const MAX_TRIES = 3;
/** Steam allows 128 bytes per leaderboard name; ours stay far below. */
export const MAX_NAME_LENGTH = 100;

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type BoardKind = 'time-trial' | 'wildcard';
export interface BoardIdentity {
  kind: BoardKind;
  physics: number;
  /** time trial */
  circuit?: string;
  vehicle?: string;
  /** Wildcard */
  event?: string;
}

/** `tt.<circuit>.<machine>.p<physics>`, or null when an id is not a plain slug. */
export function timeTrialBoardName(circuit: string, vehicle: string, physics = SIMULATION_VERSION) {
  if (!SLUG.test(circuit) || !SLUG.test(vehicle) || !Number.isInteger(physics) || physics < 1)
    return null;
  return `tt.${circuit}.${vehicle}.p${physics}`;
}
/** `wc.<event>.p<physics>`, or null when the id is not a plain slug. */
export function wildcardBoardName(event: string, physics = SIMULATION_VERSION) {
  if (!SLUG.test(event) || !Number.isInteger(physics) || physics < 1) return null;
  return `wc.${event}.p${physics}`;
}
/** The identity a board name encodes, or null for anything the game did not make. */
export function parseBoardName(name: unknown): BoardIdentity | null {
  if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) return null;
  const parts = name.split('.');
  const physics = /^p([1-9][0-9]{0,3})$/.exec(parts.at(-1) ?? '');
  if (!physics) return null;
  if (parts[0] === 'tt' && parts.length === 4 && SLUG.test(parts[1]) && SLUG.test(parts[2]))
    return {
      kind: 'time-trial',
      circuit: parts[1],
      vehicle: parts[2],
      physics: Number(physics[1]),
    };
  if (parts[0] === 'wc' && parts.length === 3 && SLUG.test(parts[1]))
    return { kind: 'wildcard', event: parts[1], physics: Number(physics[1]) };
  return null;
}

/** A lap in seconds as the integer milliseconds Steam stores, or null when it is not a valid lap. */
export function lapScore(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < MIN_LAP_SECONDS || seconds > MAX_LAP_SECONDS)
    return null;
  return Math.round(seconds * 1000);
}
export const scoreSeconds = (score: number) => score / 1000;
/** "1:23.456" for a score in milliseconds. */
export function formatScore(score: number): string {
  const total = Math.max(0, Math.round(score));
  const minutes = Math.floor(total / 60000);
  const rest = total - minutes * 60000;
  return `${minutes}:${(rest / 1000).toFixed(3).padStart(6, '0')}`;
}

/** What rides along with a score (Steam "details", a small int array). Stable codes, never indexes. */
const ASSIST = { sport: 0, raw: 1 } as const;
const COMPOUND = { soft: 0, medium: 1, hard: 2, intermediate: 3, wet: 4 } as const;
const WEATHER = { clear: 0, changeable: 1, rain: 2, fog: 3, storm: 4, dust: 5, snow: 6 } as const;
const code = (table: Record<string, number>, key: string) => table[key] ?? 255;
export interface ScoreContext {
  assist: string;
  compound: string;
  weather: string;
}
export function encodeDetails(context: ScoreContext): number[] {
  return [
    code(ASSIST, context.assist),
    code(COMPOUND, context.compound),
    code(WEATHER, context.weather),
  ];
}
const nameOf = (table: Record<string, number>, value: number | undefined) =>
  Object.entries(table).find(([, v]) => v === value)?.[0] ?? 'unknown';
export function decodeDetails(details: readonly number[]): ScoreContext {
  return {
    assist: nameOf(ASSIST, details[0]),
    compound: nameOf(COMPOUND, details[1]),
    weather: nameOf(WEATHER, details[2]),
  };
}

// ---- The outbox ------------------------------------------------------------------------------------
export interface BoardRecord {
  /** The player's best score for this board (ms). */
  score: number;
  details: number[];
  /** Epoch ms of the best. */
  at: number;
  /** The best score Steam has acknowledged (null: never sent). */
  sent: number | null;
  /** Failed sends since the score last improved or the game last started. */
  tries: number;
}
export interface BoardStore {
  version: 1;
  boards: Record<string, BoardRecord>;
}
export const emptyBoards = (): BoardStore => ({ version: 1, boards: {} });

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
/** Read a stored outbox; anything malformed is dropped entry by entry, never thrown. */
export function validateBoards(value: unknown): BoardStore {
  const store = emptyBoards();
  if (!value || typeof value !== 'object' || (value as BoardStore).version !== 1) return store;
  const boards = (value as BoardStore).boards;
  if (!boards || typeof boards !== 'object') return store;
  for (const [name, raw] of Object.entries(boards)) {
    if (Object.keys(store.boards).length >= MAX_BOARDS) break;
    const r = raw as Partial<BoardRecord> | null;
    if (!parseBoardName(name) || !r || typeof r !== 'object') continue;
    if (!isInt(r.score) || lapScore(r.score / 1000) !== r.score) continue;
    const details = Array.isArray(r.details)
      ? r.details.filter((n) => isInt(n) && n >= 0 && n <= 255).slice(0, 8)
      : [];
    store.boards[name] = {
      score: r.score,
      details,
      at: isInt(r.at) && r.at > 0 ? r.at : 0,
      sent: isInt(r.sent) && r.sent > 0 ? r.sent : null,
      tries: isInt(r.tries) && r.tries >= 0 ? Math.min(r.tries, MAX_TRIES) : 0,
    };
  }
  return store;
}

/** Keep the lower score. Returns the new outbox and whether this score is a new best for the board. */
export function recordScore(
  store: BoardStore,
  name: string,
  score: number,
  details: number[],
  at: number,
): { store: BoardStore; improved: boolean } {
  if (!parseBoardName(name) || lapScore(score / 1000) !== score) return { store, improved: false };
  const previous = store.boards[name];
  if (previous && previous.score <= score) return { store, improved: false };
  if (!previous && Object.keys(store.boards).length >= MAX_BOARDS)
    return { store, improved: false };
  return {
    store: {
      ...store,
      boards: {
        ...store.boards,
        [name]: { score, details: details.slice(0, 8), at, sent: previous?.sent ?? null, tries: 0 },
      },
    },
    improved: true,
  };
}
/** A board is pending when Steam has not been told its best yet (and it has not given up for now). */
export const isPending = (record: BoardRecord) =>
  (record.sent === null || record.score < record.sent) && record.tries < MAX_TRIES;
/** Names to send, the oldest best first (so a long offline spell drains in the order it happened). */
export function pendingBoards(store: BoardStore): string[] {
  return Object.entries(store.boards)
    .filter(([, record]) => isPending(record))
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([name]) => name);
}
/** A new launch gives every board another chance. */
export function thaw(store: BoardStore): BoardStore {
  if (!Object.values(store.boards).some((r) => r.tries > 0)) return store;
  return {
    ...store,
    boards: Object.fromEntries(
      Object.entries(store.boards).map(([name, r]) => [name, { ...r, tries: 0 }]),
    ),
  };
}

export type SubmitResult =
  | { ok: true; changed?: boolean; rank?: number }
  | { ok: false; unavailable?: boolean; reason?: string };
export type SubmitFn = (name: string, score: number, details: number[]) => Promise<SubmitResult>;
export interface FlushReport {
  store: BoardStore;
  sent: number;
  failed: number;
  /** Why the run stopped early (Steam or the binding is not available), else null. */
  unavailable: string | null;
}

/**
 * Send every pending board through `submit`, one at a time. A reply of `unavailable` (no Steam
 * client, no leaderboard API in the binding) stops the run and leaves everything pending without
 * counting a failure; a refusal or a thrown error counts a try against that board only.
 */
export async function submitPending(store: BoardStore, submit: SubmitFn): Promise<FlushReport> {
  let current = store;
  let sent = 0;
  let failed = 0;
  for (const name of pendingBoards(store)) {
    const record = current.boards[name];
    let result: SubmitResult;
    try {
      result = await submit(name, record.score, record.details);
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      sent++;
      current = {
        ...current,
        boards: { ...current.boards, [name]: { ...record, sent: record.score, tries: 0 } },
      };
    } else if (result.unavailable) {
      return { store: current, sent, failed, unavailable: result.reason ?? 'unavailable' };
    } else {
      failed++;
      current = {
        ...current,
        boards: { ...current.boards, [name]: { ...record, tries: record.tries + 1 } },
      };
    }
  }
  return { store: current, sent, failed, unavailable: null };
}

/** `leaderboard:<circuit>` (legacy: APX-01, physics 1) or `leaderboard:<circuit>:<machine>:p<physics>`. */
export function parseLeaderboardKey(
  key: string,
): { circuit: string; vehicle: string; physics: number } | null {
  const match = /^leaderboard:([a-z0-9-]+)(?::([a-z0-9-]+):p([0-9]+))?$/.exec(key);
  if (!match) return null;
  return match[2]
    ? { circuit: match[1], vehicle: match[2], physics: Number(match[3]) }
    : { circuit: match[1], vehicle: 'apx01', physics: 1 };
}
