import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { headingGuardLimit } from '../src/simulation/offroad/ai.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

// Run 41879845721 (CI, main 0b8ec67): scripts/offroad-races.ts parked car 0 of the built-in
// arena-nord-supercross event for 21.1 s against its 20 s limit. The trace put every one of the
// ten riders into the 7 m hairpin that opens the stadium (turn one, 100 m from the gate) and the
// heading guard on all of them there: its 0.5 rad limit is inside the yaw lag a leaning bike has
// in a corner that tight, so the guard capped them at 2.8-4.5 m/s with a 0.6 steering clamp
// while the field was still racing the corner, the pack stopped nose to tail behind the slowest,
// and the riders released one at a time ran wide into the wall (about 4 s each to be pushed out).
describe('heading guard of the off-road riders', () => {
  const HAIRPIN = 1 / 7.6;
  it('keeps its plain 0.5 rad limit on a straight and for a heading that is ahead of the course', () => {
    for (const speed of [0, 3, 12, 30]) {
      expect(headingGuardLimit(0.9, 0, speed)).toBe(0.5);
      expect(headingGuardLimit(-0.9, 0, speed)).toBe(0.5);
    }
    // Course turning one way, rider already turned further the other way round.
    expect(headingGuardLimit(-0.8, HAIRPIN, 7)).toBe(0.5);
    expect(headingGuardLimit(0.8, -HAIRPIN, 7)).toBe(0.5);
  });

  it('allows a rider trailing a corner the yaw lag the course asks of it, up to 0.5 rad', () => {
    // Error and curvature with the same sign: the heading trails the turn (both hands).
    expect(headingGuardLimit(-0.6, -HAIRPIN, 3)).toBeCloseTo(0.5 + 3 * HAIRPIN, 9);
    expect(headingGuardLimit(0.6, HAIRPIN, 3)).toBeCloseTo(0.5 + 3 * HAIRPIN, 9);
    // The lag grows with speed and saturates: the hairpin at racing speed is 0.5 + 0.5.
    expect(headingGuardLimit(-0.6, -HAIRPIN, 2)).toBeLessThan(headingGuardLimit(-0.6, -HAIRPIN, 5));
    expect(headingGuardLimit(-0.6, -HAIRPIN, 7)).toBeCloseTo(1, 9);
    expect(headingGuardLimit(-0.6, -HAIRPIN, 30)).toBeCloseTo(1, 9);
  });

  it('still takes over from a rider facing across the lane, in a corner too', () => {
    // motocross-ai.test.ts places a rider 0.9 rad across a straight; across a corner it takes more
    // than the corner's lag (at most 0.5 rad) on top of the plain limit to count as facing across.
    expect(0.9).toBeGreaterThan(headingGuardLimit(0.9, 0, 9));
    expect(1.2).toBeGreaterThan(headingGuardLimit(-1.2, -HAIRPIN, 30));
    expect(1.2).toBeGreaterThan(headingGuardLimit(1.2, HAIRPIN, 7));
  });

  it('does not park the field in turn one of the arena-nord-supercross event', () => {
    const event = EVENTS.find((e) => e.id === 'arena-nord-supercross')!;
    const sim = new Simulation(eventSession(event, DEFAULT_OPTIONS));
    sim.autoPlayer = true;
    const session = sim.offroad!;
    const stopped = new Float64Array(sim.cars.length);
    let longest = 0;
    const dt = 1 / 120;
    // The seeded pile-up ran from 10 s to 40 s of race time (21.1 s for car 0 at s=108 m).
    for (
      let i = 0;
      i < 120 * 90 && sim.race.raceTime < 50 && sim.race.phase !== PHASE.FINISHED;
      i++
    ) {
      sim.step(dt);
      if (sim.race.phase !== PHASE.RACING) continue;
      sim.cars.forEach((c, id) => {
        const e = session.entrants[id];
        const waiting = e.start <= 1 || e.parked || c.finishTime > 0 || c.inPit;
        stopped[id] = c.speed < 1 && !waiting ? stopped[id] + dt : 0;
        longest = Math.max(longest, stopped[id]);
      });
    }
    expect(sim.race.raceTime).toBeGreaterThan(49);
    // scripts/offroad-races.ts PARKED_LIMIT is 20 s; a crash and its remount alone take 9-10 s.
    expect(longest).toBeLessThan(18);
  }, 120_000);
});
