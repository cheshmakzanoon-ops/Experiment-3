import { describe, expect, it } from 'vitest';
import { CameraClock } from '../src/rendering/camera-dynamics.ts';
import {
  MotocrossChaseCamera,
  type MotocrossCameraFrame,
} from '../src/rendering/offroad/chase-camera.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { H, O, OFFROAD_BASE, carBase } from '../src/simulation/protocol.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const flat: Pick<Track, 'at' | 'sample'> = {
  at(s, out) {
    Object.assign(out, { x: 0, y: 0, z: s, s, tx: 0, tz: 1, nx: 1, nz: 0, width: 5 });
    return out;
  },
  sample(x, z, out) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.s = z;
    out.lateral = x;
    return out;
  },
};

function frame(over: Partial<MotocrossCameraFrame> = {}): MotocrossCameraFrame {
  return {
    anchor: { x: 0, y: 0.86, z: 0 },
    heading: 0,
    s: 0,
    speed: 15,
    cgHeight: 0.86,
    lean: 0.2,
    airborne: true,
    airTime: 0,
    velocityX: 0,
    velocityZ: 15,
    landingSpeed: 0,
    bottom: 0,
    motion: 1,
    ...over,
  };
}

const pose = (camera: MotocrossChaseCamera) => [
  camera.eye.toArray(),
  camera.gaze.toArray(),
  camera.up.toArray(),
  camera.fov,
];

describe('motocross camera flight origins across unobserved ground intervals', () => {
  it.each([0, 0.02])(
    'does not borrow a preceding flight duration after the timer restarts at %f',
    (airTime) => {
      const prior = new MotocrossChaseCamera().update(0, flat, frame({ airTime: 0.7 }));
      const fresh = new MotocrossChaseCamera().update(0, flat, frame());
      const relaunched = frame({ airTime });
      for (const camera of [prior, fresh]) camera.update(1 / 30, flat, relaunched);
      // A newly observed flight clock changes the event origin, without a
      // camera cut or an invented impact at the unobserved earlier landing.
      expect(pose(prior)).toEqual(pose(fresh));
      const touchdown = frame({
        airborne: false,
        airTime: airTime + 1 / 240,
        landingSpeed: 5,
        bottom: 0.4,
      });
      for (const camera of [prior, fresh]) camera.update(1 / 30, flat, touchdown);
      expect(pose(prior)).toEqual(pose(fresh));
      for (let i = 0; i < 60; i++) {
        for (const camera of [prior, fresh]) camera.update(1 / 60, flat, touchdown);
        expect(pose(prior)).toEqual(pose(fresh));
      }
    },
  );

  it('retains natural 30 Hz recording origins through an Arena MX450 rebound', () => {
    const simulation = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 60724,
    });
    simulation.autoPlayer = true;
    const bike = simulation.cars[0] as DirtBikeVehicle;
    const camera = new MotocrossChaseCamera(),
      clock = new CameraClock();
    // Observe the spring state without modifying it. The independent
    // critically damped continuation distinguishes old recoil settling
    // from a new kick incorrectly attributed to the following tiny hop.
    const spring = camera as unknown as { landingOffset: number; landingVelocity: number };
    const block = carBase(0) + OFFROAD_BASE;
    let previous: { airborne: boolean; airTime: number } | undefined;
    let restarted = false,
      shortLandings = 0;
    for (let tick = 0; tick <= 30 * 120; tick++) {
      if (tick) simulation.step(1 / 120);
      if (tick % 4) continue;
      const recorded = simulation.makeFrame();
      const airborne = recorded[block + O.AIRBORNE] > 0.5;
      const airTime = recorded[block + O.AIR_TIME],
        dt = clock.step(recorded[H.TIME]);
      if (clock.discontinuous) camera.reset();
      if (previous?.airborne && airborne && airTime < previous.airTime) restarted = true;
      const coefficient = spring.landingVelocity + 14 * spring.landingOffset;
      const expectedOffset = (spring.landingOffset + coefficient * dt) * Math.exp(-14 * dt);
      const expectedVelocity =
        (spring.landingVelocity - 14 * coefficient * dt) * Math.exp(-14 * dt);
      camera.update(dt, simulation.track, {
        anchor: bike.body.position,
        heading: Math.atan2(bike.forward.x, bike.forward.z),
        velocityX: bike.body.velocity.x,
        velocityZ: bike.body.velocity.z,
        s: bike.s,
        speed: bike.speed,
        cgHeight: bike.bikeSpec.cgHeight,
        lean: bike.dynamics.lean,
        airborne,
        airTime,
        landingSpeed: recorded[block + O.LANDING_SPEED],
        bottom: recorded[block + O.BOTTOM],
        motion: 1,
      });
      if (restarted && !airborne) {
        expect(airTime).toBeLessThan(0.16);
        expect(spring.landingOffset).toBeCloseTo(expectedOffset, 12);
        expect(spring.landingVelocity).toBeCloseTo(expectedVelocity, 12);
        shortLandings++;
        restarted = false;
      }
      previous = { airborne, airTime };
    }
    expect(shortLandings).toBeGreaterThan(0);
  });
});
