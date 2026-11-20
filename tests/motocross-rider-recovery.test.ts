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
    let previous: number = MX_RECOVERY.slideHeight;
    let travel = 0,
      previousPhase = 0;
    for (let i = 0; i < 440; i++) {
      const { x, z } = bike.rider;
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
