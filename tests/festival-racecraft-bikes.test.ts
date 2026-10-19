import { describe, expect, it } from 'vitest';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { controls } from '../src/simulation/config.ts';
import type { Participant } from '../src/simulation/open-world/festival-events.ts';
import type { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { RouteProgress } from '../src/simulation/route-graph.ts';

function bikeRace(leaderLane = 0) {
  const sim = new OpenWorldSimulation({ vehicle: 'sbk1000', tileBudget: 12 });
  sim.command({ type: 'start', event: 'valley-sprint' });
  sim.time = 3.01;
  sim.step(1 / 120);
  const path = sim.events.find((e) => e.spec.id === 'valley-sprint')!.path;
  const run = (
    sim as unknown as {
      run: { participants: Participant[]; drivers: (RouteDriver | null)[] };
    }
  ).run;
  for (let i = 0; i < sim.cars.length; i++) {
    const bike = sim.cars[i] as BikeVehicle,
      station = i < 2 ? 200 + i * 25 : 350 + i * 100,
      p = path.at(station, pathPoint()),
      lane = i === 1 ? leaderLane : 0;
    sim.placeAt(bike, p.x + p.nx * lane, p.z + p.nz * lane, Math.atan2(p.tx, p.tz), p.y + 0.5);
    bike.dynamics.speed = 40;
    bike.gear = 4;
    // Let the real adapter write the body from its authoritative dynamics;
    // setting body velocity too would be interpreted as an external impulse.
    bike.step(1 / 240, sim.asTrack);
    const progress = new RouteProgress(run.participants[i].progress.graph);
    progress.update(bike.body.position, 1000);
    run.participants[i].progress = progress;
    run.drivers[i]?.relocate(station);
  }
  sim.setInput({ ...controls(), throttle: 0.35 });
  return sim;
}

describe('festival race aero preserves motorcycle integration', () => {
  it('feeds real tow into bike acceleration while keeping car racecraft hidden and clearing on exit', () => {
    const towed = bikeRace(),
      clear = bikeRace(10);
    for (let i = 0; i < 8; i++) {
      towed.step(1 / 120);
      clear.step(1 / 120);
    }
    const bike = towed.player as BikeVehicle,
      solo = clear.player as BikeVehicle;
    expect(towed.cars.every((car) => car instanceof BikeVehicle)).toBe(true);
    expect(towed.status()).toMatchObject({
      mode: 'running',
      autopilot: false,
      event: { offRoute: false, racecraft: null },
    });
    expect(bike.slipstream).toBeGreaterThan(0.08);
    expect(solo.slipstream).toBe(0);
    expect(bike.dynamics.dragScale).toBeLessThan(solo.dynamics.dragScale);
    expect(bike.aero.drag).toBeLessThan(solo.aero.drag * 0.98);
    expect(bike.dynamics.longitudinal).toBeGreaterThan(solo.dynamics.longitudinal);
    expect(bike.speed).toBeGreaterThan(solo.speed);
    expect(bike.riding).toBe(true);
    expect(solo.riding).toBe(true);
    towed.command({ type: 'cancel' });
    expect(bike.slipstream).toBe(0);
    expect(bike.wake).toBe(0);
    expect(towed.status().event?.racecraft).toBeNull();
    towed.command({ type: 'continue' });
    towed.step(1 / 120);
    expect(towed.status().event).toBeNull();
    expect(towed.player.slipstream).toBe(0);
  });
});
