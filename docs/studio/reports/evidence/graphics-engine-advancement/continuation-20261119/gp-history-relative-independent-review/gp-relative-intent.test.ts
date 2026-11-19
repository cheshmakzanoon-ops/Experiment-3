import { afterEach, expect, it, vi } from 'vitest';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

class RelativeIntentProbe extends BikeAIDriver {
  sampledTraffic() {
    return this.trafficRefreshed;
  }
}

afterEach(() => vi.restoreAllMocks());

it.each([0, 0.01, -0.01])(
  'retains a stationary authored lane between native traffic samples (slope %s)',
  (slope) => {
    const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        vehicles: ['gpr1'],
        circuit: 'montejaral',
        seed: 5111,
      }),
      bike = sim.cars[0] as BikeVehicle,
      track = sim.track,
      line = racingLineFor(track),
      driver = new RelativeIntentProbe(bike),
      native = driver as unknown as {
        steeringTarget: number;
        steeringCorrection: number;
        tactical: number;
        launch: number;
      },
      origin = 100,
      alongSpeed = 30,
      speed = alongSpeed * Math.hypot(1, slope),
      dt = 1 / 120;
    // Only prescribe geometry. Native TrafficPlanner and the complete GP
    // update choose and consume the lane; neither is mocked or overridden.
    vi.spyOn(line, 'offsetAt').mockImplementation((s) => slope * (s - origin));
    vi.spyOn(line, 'curvatureAt').mockReturnValue(0);
    vi.spyOn(track, 'at').mockImplementation((s, out = trackPoint()) =>
      Object.assign(out, {
        s,
        x: 0,
        y: 0,
        z: s,
        tx: 0,
        tz: 1,
        nx: 1,
        nz: 0,
        width: 20,
        curvature: 0,
        gradient: 0,
        bank: 0,
      }),
    );
    sim.race.phase = PHASE.RACING;
    let samples = 0,
      heldUpdates = 0,
      maxLane = 0,
      maxLaneRate = 0,
      maxTargetError = 0,
      maxCorrection = 0,
      previousLane = 0;
    for (let frame = 0; frame < 120; frame++) {
      // Prescribe motion on the stationary world path x=slope*(s-origin),
      // z=s. No vehicle integration is required to test reference ownership.
      const station = origin + alongSpeed * frame * dt,
        lateral = slope * (station - origin);
      sim.race.time = sim.race.greenAt + 2 + frame * dt;
      bike.s = station;
      bike.lateral = lateral;
      bike.speed = bike.dynamics.speed = speed;
      bike.dynamics.heading = Math.atan(slope);
      bike.dynamics.x = lateral;
      bike.dynamics.z = station;
      bike.dynamics.motoGP!.lateralSpeed = 0;
      bike.body.position.set(lateral, bike.body.position.y, station);
      bike.body.orientation.yaw(bike.dynamics.heading);
      track.at(station, bike.trackPosition);
      driver.update(dt, track, sim.cars, sim.race);
      const lane = native.tactical + native.launch;
      expect(driver.decision).toBe('RACING LINE');
      if (driver.sampledTraffic()) samples++;
      else if (samples > 0) heldUpdates++;
      maxLane = Math.max(maxLane, Math.abs(lane));
      if (frame > 0) maxLaneRate = Math.max(maxLaneRate, Math.abs((lane - previousLane) / dt));
      previousLane = lane;
      maxTargetError = Math.max(maxTargetError, Math.abs(native.steeringTarget - lateral));
      maxCorrection = Math.max(maxCorrection, Math.abs(native.steeringCorrection));
    }
    // Exercise multiple native tactical refreshes and the held frames between
    // them. A per-frame planner or an unsampled fixture must not satisfy this.
    expect(samples).toBeGreaterThanOrEqual(8);
    expect(samples).toBeLessThanOrEqual(12);
    expect(heldUpdates).toBeGreaterThan(80);
    expect(maxLane).toBeLessThan(1e-12);
    expect(maxLaneRate).toBeLessThan(1e-10);
    expect(maxTargetError).toBeLessThan(1e-12);
    expect(maxCorrection).toBeLessThan(1e-10);
  },
);
