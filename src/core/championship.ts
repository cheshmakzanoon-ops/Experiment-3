import { CIRCUIT_IDS, type CircuitId } from '../simulation/circuits.ts';
import type { WeatherPreset } from '../simulation/config.ts';
import { F, H, carBase } from '../simulation/protocol.ts';

/** A persistent championship: a calendar of race weekends (qualifying sets
 * the grid, then the race), with points awarded from the actual classified
 * results of each race. Stored as plain data in the local save store. */
export const CHAMPIONSHIP_VERSION = 1;
export const CHAMPIONSHIP_KEY = `championship:v${CHAMPIONSHIP_VERSION}`;
/** Points for the first ten classified finishers. */
export const POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
export interface RoundSpec {
  circuit: CircuitId;
  weather: WeatherPreset;
  laps: number;
}
export interface RoundResult {
  /** Car ids by finishing position; retired cars follow, in retirement order. */
  order: number[];
  retired: number[];
  grid: number[];
  /** True when the AI demonstration drove any part of the player's weekend. */
  demonstration: boolean;
  session: string;
}
export interface Championship {
  version: typeof CHAMPIONSHIP_VERSION;
  cars: number;
  rounds: RoundSpec[];
  results: RoundResult[];
}
export const DEFAULT_CALENDAR: readonly RoundSpec[] = Object.freeze([
  { circuit: 'aurel', weather: 'clear', laps: 5 },
  { circuit: 'vellamar', weather: 'clear', laps: 5 },
  { circuit: 'aurel', weather: 'changeable', laps: 5 },
  { circuit: 'vellamar', weather: 'changeable', laps: 5 },
]);

export function newChampionship(cars = 8, rounds: readonly RoundSpec[] = DEFAULT_CALENDAR): Championship {
  if (!Number.isInteger(cars) || cars < 2 || cars > 12) throw new Error('Invalid championship field');
  return { version: CHAMPIONSHIP_VERSION, cars, rounds: rounds.map((r) => ({ ...r })), results: [] };
}

const permutation = (value: unknown, cars: number): value is number[] =>
  Array.isArray(value) &&
  value.length === cars &&
  new Set(value).size === cars &&
  value.every((id) => Number.isInteger(id) && id >= 0 && id < cars);

export function validateChampionship(value: unknown): Championship | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<Championship>;
  if (c.version !== CHAMPIONSHIP_VERSION || !Number.isInteger(c.cars)) return null;
  const cars = c.cars as number;
  if (cars < 2 || cars > 12 || !Array.isArray(c.rounds) || !Array.isArray(c.results)) return null;
  if (c.rounds.length < 1 || c.rounds.length > 24 || c.results.length > c.rounds.length) return null;
  for (const r of c.rounds)
    if (
      !r ||
      !CIRCUIT_IDS.includes(r.circuit) ||
      !['clear', 'changeable', 'rain'].includes(r.weather) ||
      !Number.isInteger(r.laps) ||
      r.laps < 1 ||
      r.laps > 10
    )
      return null;
  for (const r of c.results) {
    if (!r || !permutation(r.order, cars) || !permutation(r.grid, cars)) return null;
    if (!Array.isArray(r.retired) || !r.retired.every((id) => r.order.includes(id))) return null;
    if (typeof r.demonstration !== 'boolean' || typeof r.session !== 'string') return null;
  }
  return structuredClone(c as Championship);
}

export function nextRound(c: Championship): RoundSpec | null {
  return c.rounds[c.results.length] ?? null;
}
export function complete(c: Championship) {
  return c.results.length >= c.rounds.length;
}

/** Classification from the final race snapshot: finishers by penalty-adjusted
 * time (the worker's rank), then retirements. Never invents a finish. */
export function raceResult(frame: Float32Array, grid: readonly number[], demonstration: boolean, session: string): RoundResult {
  const cars = Math.round(frame[H.CARS]);
  const ids = Array.from({ length: cars }, (_, i) => i);
  const finished = ids
    .filter((id) => frame[carBase(id) + F.FINISH] > 0 && frame[carBase(id) + F.RETIRED] === 0)
    .sort((a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK] || a - b);
  const retired = ids
    .filter((id) => !finished.includes(id))
    .sort(
      (a, b) =>
        frame[carBase(b) + F.LAPS] - frame[carBase(a) + F.LAPS] ||
        frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK] ||
        a - b,
    );
  return { order: [...finished, ...retired], retired, grid: [...grid], demonstration, session };
}

export function recordRound(c: Championship, result: RoundResult): Championship {
  if (complete(c)) throw new Error('Championship already complete');
  if (!permutation(result.order, c.cars) || !permutation(result.grid, c.cars))
    throw new Error('Round result does not match the championship field');
  return { ...c, results: [...c.results, structuredClone(result)] };
}

export interface Standing {
  id: number;
  points: number;
  wins: number;
  podiums: number;
  /** Finishing positions, 1-based; 0 for a retirement. */
  finishes: number[];
}
export function standings(c: Championship): Standing[] {
  const table: Standing[] = Array.from({ length: c.cars }, (_, id) => ({
    id,
    points: 0,
    wins: 0,
    podiums: 0,
    finishes: [],
  }));
  for (const r of c.results)
    r.order.forEach((id, index) => {
      const s = table[id],
        out = r.retired.includes(id);
      s.finishes.push(out ? 0 : index + 1);
      if (out) return;
      s.points += POINTS[index] ?? 0;
      if (index === 0) s.wins++;
      if (index < 3) s.podiums++;
    });
  // Ties: points, then wins, then the count-back of best finishes.
  const countBack = (s: Standing) =>
    s.finishes.filter((p) => p > 0).sort((a, b) => a - b);
  return table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    const ca = countBack(a),
      cb = countBack(b);
    for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
      const pa = ca[i] ?? Infinity,
        pb = cb[i] ?? Infinity;
      if (pa !== pb) return pa - pb;
    }
    return a.id - b.id;
  });
}

/** Qualifying order from the final qualifying snapshot: fastest valid lap
 * first; cars without a timed lap start behind, in car order. */
export function qualifyingGrid(frame: Float32Array): number[] {
  const cars = Math.round(frame[H.CARS]);
  const ids = Array.from({ length: cars }, (_, i) => i);
  const best = (id: number) => frame[carBase(id) + F.BEST_LAP];
  const timed = ids.filter((id) => best(id) > 0).sort((a, b) => best(a) - best(b) || a - b);
  return [...timed, ...ids.filter((id) => !(best(id) > 0))];
}
