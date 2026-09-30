import { describe, it, expect } from 'vitest';
import {
  CHAMPIONSHIP_KEY,
  DEFAULT_CALENDAR,
  POINTS,
  complete,
  newChampionship,
  nextRound,
  qualifyingGrid,
  raceResult,
  recordRound,
  standings,
  validateChampionship,
  type RoundResult,
} from '../src/core/championship.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

function frame(cars: number, set: (id: number, o: number, f: Float32Array) => void) {
  const f = new Float32Array(HEADER + cars * CAR_STRIDE);
  f[H.CARS] = cars;
  for (let id = 0; id < cars; id++) set(id, carBase(id), f);
  return f;
}
const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
const result = (order: number[], retired: number[] = []): RoundResult => ({
  order,
  retired,
  grid: identity(order.length),
  demonstration: false,
  session: 's',
});

describe('championship', () => {
  it('awards 25-18-15-12-10-8-6-4-2-1 and nothing to retirements', () => {
    let c = newChampionship(12);
    c = recordRound(c, result([5, 3, 0, 1, 2, 4, 6, 7, 8, 9, 10, 11]));
    c = recordRound(c, result([3, 5, 0, 1, 2, 4, 6, 7, 8, 9, 11, 10], [10]));
    const table = standings(c);
    // Level on points, wins and count-back (1st and 2nd each): car order.
    expect(table[0]).toMatchObject({ id: 3, points: 43, wins: 1, podiums: 2 });
    expect(table[1]).toMatchObject({ id: 5, points: 43, wins: 1, podiums: 2 });
    expect(table.find((s) => s.id === 0)!.points).toBe(30);
    expect(table.find((s) => s.id === 10)!.finishes).toEqual([11, 0]);
    expect(table.find((s) => s.id === 10)!.points).toBe(0);
    expect(table.find((s) => s.id === 9)!.points).toBe(2);
    expect(POINTS.reduce((a, b) => a + b)).toBe(101);
    // Level on points and wins, separated by count-back: car 1 (1st, 2nd, 4th)
    // beats car 0 (1st, 3rd, 3rd) on its second-best finish.
    let d = newChampionship(4);
    d = recordRound(d, result([0, 1, 2, 3]));
    d = recordRound(d, result([1, 2, 0, 3]));
    d = recordRound(d, result([2, 3, 0, 1]));
    expect(standings(d).map((s) => [s.id, s.points, s.wins])).toEqual([
      [2, 58, 1],
      [1, 55, 1],
      [0, 55, 1],
      [3, 42, 0],
    ]);
  });
  it('follows the calendar and refuses results beyond it', () => {
    let c = newChampionship(8);
    expect(nextRound(c)).toEqual(DEFAULT_CALENDAR[0]);
    for (let i = 0; i < DEFAULT_CALENDAR.length; i++) c = recordRound(c, result(identity(8)));
    expect(complete(c)).toBe(true);
    expect(nextRound(c)).toBeNull();
    expect(() => recordRound(c, result(identity(8)))).toThrow('complete');
    expect(() => recordRound(newChampionship(8), result(identity(7)))).toThrow('field');
    expect(CHAMPIONSHIP_KEY).toBe('championship:v1');
  });
  it('round-trips saved data and rejects malformed saves', () => {
    const c = recordRound(newChampionship(8), result([2, 1, 0, 3, 4, 5, 6, 7], [7]));
    const loaded = validateChampionship(structuredClone(c));
    expect(loaded).toEqual(c);
    expect(loaded).not.toBe(c);
    expect(validateChampionship({ ...c, version: 2 })).toBeNull();
    expect(validateChampionship({ ...c, cars: 13 })).toBeNull();
    expect(validateChampionship({ ...c, rounds: [{ circuit: 'monza', weather: 'clear', laps: 3 }] })).toBeNull();
    expect(
      validateChampionship({ ...c, results: [{ ...c.results[0], order: [0, 0, 1, 2, 3, 4, 5, 6] }] }),
    ).toBeNull();
    expect(validateChampionship({ ...c, results: [{ ...c.results[0], retired: [9] }] })).toBeNull();
    expect(validateChampionship(null)).toBeNull();
  });
  it('classifies a race from the final snapshot without inventing finishes', () => {
    const f = frame(4, (id, o, x) => {
      x[o + F.RANK] = [3, 1, 4, 2][id];
      x[o + F.FINISH] = id === 2 ? 0 : 100 + id;
      x[o + F.RETIRED] = id === 2 ? 1 : 0;
      x[o + F.LAPS] = id === 2 ? 1 : 3;
    });
    const r = raceResult(f, [0, 1, 2, 3], true, 'abc');
    expect(r.order).toEqual([1, 3, 0, 2]);
    expect(r.retired).toEqual([2]);
    expect(r.demonstration).toBe(true);
  });
  it('builds the grid from the fastest valid qualifying laps', () => {
    const f = frame(5, (id, o, x) => {
      x[o + F.BEST_LAP] = [81.2, 0, 80.4, 81.2, 79.9][id];
    });
    expect(qualifyingGrid(f)).toEqual([4, 2, 0, 3, 1]);
  });
});
