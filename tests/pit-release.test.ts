import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Track } from '../src/simulation/track.ts';
import { safePitRelease } from '../src/simulation/pit-safety.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

describe('pit-release circular-wait regression', () => {
  const track = new Track();
  it('gives a serviced car priority over its stopped, safely separated follower', () => {
    const serviced = new Vehicle(0),
      follower = new Vehicle(3);
    serviced.inPit = follower.inPit = true;
    serviced.pitPhase = 5;
    serviced.s = 100.2;
    serviced.lateral = 24.1;
    follower.pitPhase = 1;
    follower.s = 93.2;
    follower.lateral = 22.55;
    expect(safePitRelease(serviced, [serviced, follower], track)).toBe(true);
    follower.speed = 8;
    expect(safePitRelease(serviced, [serviced, follower], track)).toBe(false);
    follower.speed = 0;
    follower.s = 96;
    expect(safePitRelease(serviced, [serviced, follower], track)).toBe(false);
  });
  it('physically releases the blocked pair and services both without contact', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 3 });
    sim.autoPlayer = true;
    for (const car of sim.cars) car.place(sim.track, 1200 + car.id * 50);
    const serviced = sim.cars[0],
      follower = sim.cars[3];
    serviced.place(sim.track, 100.2, 24.1);
    follower.place(sim.track, 93.2, 22.55);
    serviced.inPit = follower.inPit = true;
    serviced.pitRequested = follower.pitRequested = true;
    serviced.pitPhase = 5;
    serviced.pitClock = 5.3;
    follower.pitPhase = 1;
    let maximumImpact = 0;
    for (let i = 0; i < 120 * 55; i++) {
      sim.step(1 / 120);
      maximumImpact = Math.max(maximumImpact, serviced.impact, follower.impact);
    }
    expect(serviced.pitStops).toBe(1);
    expect(follower.pitStops).toBe(1);
    expect(serviced.inPit || follower.inPit).toBe(false);
    expect(maximumImpact).toBe(0);
  }, 30000);
});
