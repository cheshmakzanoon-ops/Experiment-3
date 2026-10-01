import { describe, it, expect } from 'vitest';
import { GapTimer, driverCode, formatInterval } from '../src/ui/gap-timer.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

const L = 1000;
const wrap = (d: number) => ((d % L) + L) % L;

describe('timing-loop race intervals', () => {
  it('reads the time since the car ahead passed the follower, across the line', () => {
    const timer = new GapTimer(L, 2);
    // A starts 30 m ahead at 60 m/s; B follows at 50 m/s from just behind the line.
    const a0 = -20,
      b0 = -50;
    for (let i = 0; i <= 60 * 30; i++) {
      const t = i / 60;
      timer.observe(t, [wrap(a0 + 60 * t), wrap(b0 + 50 * t)]);
    }
    const t = 30,
      b = b0 + 50 * t;
    // A reached B's distance at (b - a0) / 60.
    expect(timer.interval(0, 1)).toBeCloseTo(t - (b - a0) / 60, 3);
    expect(timer.raceDistance(0)).toBeCloseTo(a0 + 60 * t, 6);
    expect(timer.lapsBetween(0, 1)).toBe(0);
  });
  it('reports laps rather than seconds for a lapped car, and nothing before timing', () => {
    const timer = new GapTimer(L, 2);
    timer.observe(0, [wrap(-10), wrap(-20)]);
    // Nothing is known until the leader has passed the follower's distance.
    expect(timer.interval(0, 1)).toBeNull();
    for (let i = 1; i <= 60 * 40; i++) {
      const t = i / 60;
      timer.observe(t, [wrap(-10 + 80 * t), wrap(-20 + 50 * t)]);
    }
    expect(timer.lapsBetween(0, 1)).toBe(1);
    expect(formatInterval(timer.interval(0, 1), timer.lapsBetween(0, 1))).toBe('+1 LAP');
  });
  it('restarts its loops on replay seeks, not on jitter or slow frames', () => {
    const timer = new GapTimer(L, 2);
    for (let i = 0; i <= 600; i++) timer.observe(i / 60, [wrap(-10 + i), wrap(-40 + i)]);
    expect(timer.interval(0, 1)).not.toBeNull();
    // Jitter of a few milliseconds is not a seek.
    const before = timer.interval(0, 1);
    timer.observe(10 - 0.01, [wrap(589), wrap(559)]);
    expect(timer.interval(0, 1)).toBe(before);
    // A slow (software-rendered) frame of several seconds keeps the loops.
    timer.observe(13.5, [wrap(-10 + 600 + 210), wrap(-40 + 600 + 210)]);
    expect(timer.interval(0, 1)).toBeCloseTo(0.5, 2);
    timer.observe(2, [wrap(100), wrap(70)]);
    expect(timer.interval(0, 1)).toBeNull();
    timer.observe(30, [wrap(400), wrap(370)]);
    expect(timer.interval(0, 1)).toBeNull();
  });
  it('formats codes and intervals as a timing tower does', () => {
    expect(['K. SATO', 'ALEX RIVER', 'J. COLE', 'A. MOREAU'].map(driverCode)).toEqual([
      'SAT',
      'RIV',
      'COL',
      'MOR',
    ]);
    expect(formatInterval(1.2345, 0)).toBe('+1.234');
    expect(formatInterval(75.5, 0)).toBe('+1:15.500');
    expect(formatInterval(null, 0)).toBe('—');
    expect(formatInterval(3, 2)).toBe('+2 LAPS');
  });
  it('matches the race timing at the line in a production simulation', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 3, laps: 2 });
    sim.autoPlayer = true;
    const cars = 4;
    const frame = new Float32Array(HEADER + CAR_STRIDE * cars);
    const timer = new GapTimer(sim.track.length, cars);
    const s = new Float64Array(cars);
    const crossings: number[][] = Array.from({ length: cars }, () => []);
    const checked: number[] = [];
    for (let tick = 0; tick < 120 * 140 && checked.length < 3; tick++) {
      sim.step(1 / 120);
      if (tick % 2) continue;
      sim.writeFrame(frame);
      for (let id = 0; id < cars; id++) s[id] = frame[carBase(id) + F.S];
      timer.observe(frame[H.TIME], s);
      for (let id = 0; id < cars; id++) {
        const lap = sim.race.laps[id];
        if (lap.completed > crossings[id].length) crossings[id].push(lap.lastCrossingTime);
      }
      // When a car completes lap 1, the car ahead on the road crossed earlier;
      // the race's interpolated crossing times give the true interval there.
      for (let id = 0; id < cars; id++) {
        if (crossings[id].length !== 1 || checked.includes(id)) continue;
        const ahead = Array.from({ length: cars }, (_, k) => k).find(
          (k) =>
            k !== id &&
            frame[carBase(k) + F.RANK] === frame[carBase(id) + F.RANK] - 1 &&
            crossings[k].length >= 1,
        );
        if (ahead === undefined) continue;
        const truth = crossings[id][0] - crossings[ahead][0];
        // Sampled at 60 Hz just after the crossing: the follower has moved on
        // by at most one frame, during which the interval barely changes.
        expect(timer.interval(ahead, id)!).toBeCloseTo(truth, 1);
        expect(Math.abs(timer.interval(ahead, id)! - truth)).toBeLessThan(0.03);
        checked.push(id);
      }
    }
    expect(checked.length).toBe(3);
  });
});
