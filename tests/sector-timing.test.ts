import { describe, expect, it } from 'vitest';
import { SectorBoard } from '../src/ui/sector-timing.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

/** A published frame with only the timing fields this board reads. */
function frame(cars: number) {
  const f = new Float32Array(HEADER + cars * CAR_STRIDE);
  f[H.CARS] = cars;
  for (let id = 0; id < cars; id++) f[carBase(id) + F.LAP_VALID] = 1;
  return f;
}
/** Car `id` enters sector `sector` at `time`, carrying the published times. */
function at(
  f: Float32Array,
  time: number,
  id: number,
  sector: number,
  times: [number, number, number] = [0, 0, 0],
  valid = true,
  lastValid = true,
) {
  const o = carBase(id);
  f[H.TIME] = time;
  f[o + F.SECTOR] = sector;
  f[o + F.SECTOR_1] = times[0];
  f[o + F.SECTOR_2] = times[1];
  f[o + F.SECTOR_3] = times[2];
  f[o + F.LAP_VALID] = Number(valid);
  f[o + F.LAST_LAP_VALID] = Number(lastValid);
  return f;
}

describe('SectorBoard', () => {
  it('colours closed sectors purple (session best), green (personal best) and yellow', () => {
    const board = new SectorBoard(2);
    const f = frame(2);
    board.observe(at(f, 0, 0, 0));
    board.observe(at(f, 0, 1, 0));
    expect(board.state(0, 0)).toBe('none');
    // Car 0 closes S1 in 30 s: the first valid time is the session best.
    board.observe(at(f, 30, 0, 1, [30, 0, 0]));
    expect(board.state(0, 0)).toBe('purple');
    expect(board.sessionBest(0)).toBeCloseTo(30, 5);
    // Car 1 is slower: its first time is only a personal best.
    board.observe(at(f, 31, 1, 1, [31, 0, 0]));
    expect(board.state(1, 0)).toBe('green');
    expect(board.personalBest(1, 0)).toBeCloseTo(31, 5);
    expect(board.sessionBest(0)).toBeCloseTo(30, 5);
    // Car 0 closes S2 and then the lap (S3 is the last lap's third sector).
    board.observe(at(f, 55, 0, 2, [30, 25, 0]));
    expect(board.state(0, 1)).toBe('purple');
    board.observe(at(f, 80, 0, 0, [30, 25, 25]));
    // The finished lap moves to lastLap; the new lap starts empty.
    expect([0, 1, 2].map((k) => board.lastLap(0, k))).toEqual(['purple', 'purple', 'purple']);
    expect([0, 1, 2].map((k) => board.state(0, k))).toEqual(['none', 'none', 'none']);
    // A slower S1 on the second lap is yellow; a faster S2 is purple again.
    board.observe(at(f, 112, 0, 1, [32, 25, 25]));
    expect(board.state(0, 0)).toBe('yellow');
    board.observe(at(f, 136, 0, 2, [32, 24, 25]));
    expect(board.state(0, 1)).toBe('purple');
    expect(board.sessionBest(1)).toBeCloseTo(24, 5);
    // Car 1 now beats its own S1 but not car 0's: green.
    board.observe(at(f, 137, 1, 2, [30.5, 26, 0]));
    expect(board.state(1, 0)).toBe('green');
    expect(board.state(1, 1)).toBe('green');
  });

  it('never lets an invalid lap set a best', () => {
    const board = new SectorBoard(1);
    const f = frame(1);
    board.observe(at(f, 0, 0, 0));
    board.observe(at(f, 20, 0, 1, [20, 0, 0], false));
    expect(board.state(0, 0)).toBe('invalid');
    expect(board.sessionBest(0)).toBe(Infinity);
    board.observe(at(f, 40, 0, 2, [20, 20, 0], false));
    // The lap closes invalid: S3 is judged by the finished lap's validity.
    board.observe(at(f, 60, 0, 0, [20, 20, 20], true, false));
    expect(board.lastLap(0, 2)).toBe('invalid');
    expect(board.sessionBest(2)).toBe(Infinity);
    board.observe(at(f, 85, 0, 1, [25, 20, 20], true));
    expect(board.state(0, 0)).toBe('purple');
    expect(board.sessionBest(0)).toBeCloseTo(25, 5);
  });

  it('is idempotent for held frames and restarts on a seek backwards', () => {
    const board = new SectorBoard(1);
    const f = frame(1);
    board.observe(at(f, 0, 0, 0));
    board.observe(at(f, 30, 0, 1, [30, 0, 0]));
    for (let i = 0; i < 5; i++) board.observe(f);
    expect(board.state(0, 0)).toBe('purple');
    expect(board.sessionBest(0)).toBeCloseTo(30, 5);
    // Replay seek to before the sector: nothing is remembered.
    board.observe(at(f, 10, 0, 0, [0, 0, 0]));
    expect(board.state(0, 0)).toBe('none');
    expect(board.sessionBest(0)).toBe(Infinity);
    // A skipped sector (0 → 2) cannot be timed and closes nothing.
    board.observe(at(f, 70, 0, 2, [30, 25, 0]));
    expect([0, 1, 2].map((k) => board.state(0, k))).toEqual(['none', 'none', 'none']);
    expect(board.sessionBest(1)).toBe(Infinity);
  });

  it('ignores frames from a different field and malformed sectors', () => {
    const board = new SectorBoard(2);
    const other = frame(3);
    board.observe(at(other, 5, 0, 1, [5, 0, 0]));
    expect(board.state(0, 0)).toBe('none');
    const f = frame(2);
    board.observe(at(f, 0, 0, 0));
    board.observe(at(f, 1, 0, Number.NaN));
    board.observe(at(f, 30, 0, 1, [Number.NaN, 0, 0]));
    expect(board.state(0, 0)).toBe('none');
    expect(() => new SectorBoard(0)).toThrow();
  });

  it('times the production lap tracker: three sectors sum to the published lap', async () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 7 });
    sim.autoPlayer = true;
    const board = new SectorBoard(1);
    const f = sim.makeFrame();
    const o = carBase(0);
    let laps = 0,
      summed = false;
    for (let tick = 0; tick < 120 * 400 && laps < 2; tick++) {
      sim.step(1 / 120);
      if (tick % 2) continue;
      sim.writeFrame(f);
      board.observe(f);
      if (tick % 4800 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const now = Math.round(f[o + F.LAPS]);
      if (now === laps) continue;
      laps = now;
      const states = [0, 1, 2].map((k) => board.lastLap(0, k));
      // One car: a valid sector is either a new session best or no improvement.
      expect(states).not.toContain('none');
      expect(states).not.toContain('green');
      if (laps === 1 && f[o + F.LAST_LAP_VALID] > 0) {
        expect(states).toEqual(['purple', 'purple', 'purple']);
        const sum = board.sessionBest(0) + board.sessionBest(1) + board.sessionBest(2);
        expect(sum).toBeCloseTo(f[o + F.LAST_LAP], 2);
        summed = true;
      }
    }
    expect(laps).toBe(2);
    expect(summed).toBe(true);
  }, 120000);
});
