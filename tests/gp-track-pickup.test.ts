import { expect, it, vi } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { SURFACE, type SurfaceSample } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

/** Two successive physical patches can touch different cells during a crossing. */
class PickupTrack extends DynamicsTrack {
  pickup = true;
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.cell = z >= 0 ? 16 : 9;
    out.surface = SURFACE.ASPHALT;
    out.marbles = this.pickup ? this.marbles[out.cell] : 0;
    out.water = this.water[out.cell];
    return out;
  }
}

it.each(['gpr1', 'gpr2'])('%s transfers slip work, water and loose rubber once per supported axle', (id) => {
  const track = new PickupTrack();
  track.marbles.fill(0.7);
  track.water.fill(0.12);
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
  bike.placeFree(track, 0, 0, 0, 0);
  bike.dynamics.speed = 24;
  bike.input.throttle = 0.35;
  const deposits = vi.spyOn(track, 'interact');
  for (let i = 0; i < 120; i++) {
    deposits.mockClear();
    bike.step(1 / 240, track);
    const axles = [bike.tires[0], bike.tires[2]].filter(tyre => tyre.load > 1);
    expect(deposits.mock.calls).toHaveLength(axles.length);
    for (const [index, axle] of axles.entries()) {
      expect(deposits.mock.calls[index][1]).toBeCloseTo(axle.load, 8);
      expect(deposits.mock.calls[index][2]).toBeCloseTo(2 * axle.energy, 8);
    }
  }
  expect(bike.riding).toBe(true);
  for (const index of [0, 2]) {
    const tyre = bike.tires[index], alias = bike.tires[index + 1];
    expect(tyre.marblePickup).toBeGreaterThan(0);
    expect(alias.marblePickup).toBe(tyre.marblePickup);
    expect(alias.dirt).toBe(tyre.dirt);
  }
  expect(track.marbles[16]).toBeLessThan(0.7);
  expect(track.water[16]).toBeLessThan(0.12);
  const dirty = bike.tires[2].dirt;
  const collected = bike.tires[2].marblePickup;
  track.pickup = false;
  for (let i = 0; i < 240; i++) bike.step(1 / 240, track);
  expect(bike.tires[2].dirt).toBeLessThan(dirty);
  expect(bike.tires[2].marblePickup).toBeCloseTo(collected, 2);
  bike.replaceTires('medium');
  expect(bike.tires.every(tyre => tyre.dirt === 0 && tyre.marblePickup === 0)).toBe(true);
  deposits.mockRestore();
});
