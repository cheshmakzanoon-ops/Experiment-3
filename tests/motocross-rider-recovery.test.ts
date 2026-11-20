import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { MX_RECOVERY } from '../src/simulation/offroad/rider-recovery.ts';
import { writeOffroadBlock } from '../src/simulation/offroad/session.ts';
import { O, OFFROAD_STRIDE } from '../src/simulation/protocol.ts';
import { surfaceSample, trackPoint, type Track } from '../src/simulation/track.ts';

class RecoveringBike extends DirtBikeVehicle {
  advanceBody(dt: number, track: Track) {
    this.dynamics.stateClock += dt;
    this.updateRider(dt, track);
  }
}

describe('motocross crash recovery on dirt', () => {
  it.each([
    ['valley-ridge-mx', MX_450, 560],
    ['arena-nord-sx', MX_250, 210],
  ] as const)('rises once on %s and walks along the terrain back to the bike', (venue, def, s) => {
    const track = rigTrack(venue),
      bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', def);
    bike.place(track, s);
    const at = track.at(s - 13, trackPoint());
    const soil = surfaceSample(),
      block = new Float32Array(OFFROAD_STRIDE);
    track.sample(at.x, at.z, soil, at.y);
    bike.dynamics.state = 'separated';
    bike.dynamics.stateClock = 1.21;
    bike.rider.set(at.x, soil.height + MX_RECOVERY.slideHeight, at.z);
    // Recover from a fall facing directly away from the motorcycle.
    bike.riderHeading = Math.atan2(
      bike.rider.x - bike.body.position.x,
      bike.rider.z - bike.body.position.z,
    );
    let previous: number = MX_RECOVERY.slideHeight;
    let travel = 0,
      previousPhase = 0;
    for (let i = 0; i < 440; i++) {
      const { x, z } = bike.rider;
      const previousHeading = bike.riderHeading;
      const previousDistance = Math.hypot(x - bike.body.position.x, z - bike.body.position.z);
      bike.advanceBody(1 / 120, track);
      track.sample(bike.rider.x, bike.rider.z, soil, bike.rider.y);
      const height = bike.rider.y - soil.height,
        step = Math.hypot(bike.rider.x - x, bike.rider.z - z);
      writeOffroadBlock(block, 0, bike, null);
      expect(block[O.STANDING]).toBeCloseTo(bike.mxRecoveryStanding, 6);
      expect(height).toBeCloseTo(
        MX_RECOVERY.slideHeight +
          (MX_RECOVERY.uprightHeight - MX_RECOVERY.slideHeight) * bike.mxRecoveryStanding,
        8,
      );
      expect(height - previous).toBeGreaterThanOrEqual(-1e-8);
      expect(height - previous).toBeLessThan(0.015);
      expect(step).toBeLessThanOrEqual(4 / 120 + 1e-8);
      expect(Math.abs(bike.riderHeading - previousHeading)).toBeLessThanOrEqual(4 / 120 + 1e-8);
      const dx = bike.rider.x - x,
        dz = bike.rider.z - z;
      const forwardX = Math.sin(bike.riderHeading),
        forwardZ = Math.cos(bike.riderHeading);
      expect(dx * forwardZ - dz * forwardX).toBeCloseTo(0, 10);
      expect(dx * forwardX + dz * forwardZ).toBeGreaterThanOrEqual(-1e-10);
      expect(
        Math.hypot(bike.rider.x - bike.body.position.x, bike.rider.z - bike.body.position.z),
      ).toBeLessThanOrEqual(previousDistance + 1e-8);
      if (i > 90) {
        expect(
          ((bike.riderTumble - previousPhase) * MX_RECOVERY.strideLength) / (Math.PI * 2),
        ).toBeCloseTo(step, 9);
      }
      previous = height;
      previousPhase = bike.riderTumble;
      travel += step;
    }
    expect(previous).toBeCloseTo(MX_RECOVERY.uprightHeight, 8);
    expect(travel).toBeGreaterThan(10);
    bike.dynamics.state = 'highside';
    bike.advanceBody(1 / 120, track);
    expect(bike.mxRecoveryStanding).toBe(0);
  });
});
