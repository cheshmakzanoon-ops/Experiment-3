import { describe, expect, it } from 'vitest';
import type { Bike, BikeInput } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
const idle: BikeInput = {
  lean: 0,
  rider: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  drive: 0,
};

/** The GP dynamics core exactly as a session builds it (road-racing physics
 * enabled), on a surface with the given grip multiplier (wet tarmac ~0.42). */
function gpCore(id: string, grip: number) {
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]).dynamics;
  bike.grip = bike.frontGrip = bike.rearGrip = grip;
  return bike;
}

/** A GP machine that crosses the lean assist's 3 m/s hand-over speed with the
 * stick held hard over (a rider swerving back onto the track, or a player
 * waiting on the grid with the bars turned) and rolls to a stop with the
 * stick still held. */
function stoppedWithStickHeld(id: string, grip: number, stick: number) {
  const bike = gpCore(id, grip);
  bike.speed = 4;
  for (let i = 0; i < 30 / DT && bike.speed > 0.02; i++)
    bike.step({ ...idle, lean: stick, frontBrake: 0.15, rearBrake: 0.1 }, DT);
  expect(bike.state).toBe('riding');
  expect(bike.speed).toBeLessThan(0.05);
  return bike;
}

/** Seconds a stopped bike needs to reach `target` m/s while the rider asks for
 * full throttle, or Infinity within `limit`. */
function timeToSpeed(bike: Bike, stick: number, request: number, target: number, limit: number) {
  for (let i = 0; i < limit / DT; i++) {
    bike.step({ ...idle, lean: stick, throttle: 1, drive: request }, DT);
    if (bike.speed >= target) return (i + 1) * DT;
  }
  return Infinity;
}

describe('GP launch from a standstill after the lean assist handed over', () => {
  it.each(['gpr1', 'gpr2'])('%s pulls away on wet tarmac with the stick still held', (id) => {
    const wet = stoppedWithStickHeld(id, 0.42, 0.9);
    // The lean assist only runs above 3 m/s. A roll demand left over from the
    // last time it ran must not be read as a roll the stopped bike still has to
    // recover: no tyre force can answer it, so it would only hold the drive at
    // zero for as long as the bike stays slow.
    const time = timeToSpeed(wet, 0, 3000, 6, 12);
    expect(Number.isFinite(time)).toBe(true);
    expect(time).toBeLessThan(8);
    expect(wet.state).toBe('riding');
  });
  it('limits a stopped bike by the rear friction circle, not by an idle assist reserve', () => {
    const bike = stoppedWithStickHeld('gpr1', 0.42, 0.9);
    bike.step({ ...idle, lean: 0.9, throttle: 1, drive: 3000 }, DT);
    const capacity = bike.p.mu * 0.42 * bike.rearLoad * (bike.p.tractionMargin ?? 0.92);
    expect(bike.driveForce).toBeGreaterThan(0.5 * Math.min(3000, capacity));
  });
  it('still reserves lean recovery above the hand-over speed', () => {
    // The reserve is real while the assist runs: a bike at speed with the stick
    // far from its lean gives up drive to keep tyre force for the roll.
    const fast = gpCore('gpr1', 0.42);
    fast.speed = 12;
    for (let i = 0; i < 0.5 / DT; i++)
      fast.step({ ...idle, lean: 0.9, throttle: 1, drive: 3000 }, DT);
    expect(fast.intervention).toBeGreaterThan(0.2);
  });
});
