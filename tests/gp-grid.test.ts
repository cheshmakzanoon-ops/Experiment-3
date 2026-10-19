import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, startingGrid } from '../src/simulation/config.ts';
import {
  GP_GRID,
  gpGridForFrame,
  gpGridForVehicles,
  gpGridSlot,
} from '../src/simulation/gp-grid.ts';
import { H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('GP three-rider starting grid', () => {
  // Entrant placement projects the spline onto the sampled contact ribbon.
  // Retain a 2 cm alignment bound, tighter than the 8 cm painted stroke.
  const aligned = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThan(0.02);
  for (const circuit of ['aurel', 'poggio-alto', 'cape-wrenna', 'haarveld'] as const)
    it(`${circuit}: places a full field in qualifying order with physical clearance`, () => {
      const count = 12,
        grid = startingGrid(count, 'back')!,
        sim = new Simulation({
          ...DEFAULT_OPTIONS,
          circuit,
          mode: 'race',
          ruleset: 'gp-motorcycle',
          opponents: count - 1,
          vehicles: Array.from({ length: count }, (_, i) => (i % 2 ? 'gpr2' : 'gpr1')),
          grid,
        });
      const positions = sim.cars.map((car) => ({ ...car.body.position }));
      expect(gpGridForVehicles(sim.options.vehicles)).toBe(true);
      expect(gpGridForFrame(sim.makeFrame())).toBe(true);
      for (let slot = 0; slot < count; slot++) {
        const car = sim.cars[grid[slot]],
          start = gpGridSlot(sim.track, slot),
          p = sim.track.at(start.s, trackPoint());
        aligned(car.s, start.s);
        aligned(car.lateral, start.lateral);
        expect(Math.abs(start.lateral) + 1.1).toBeLessThan(p.width);
        aligned(car.body.position.x, p.x + p.nx * start.lateral);
        aligned(car.body.position.z, p.z + p.nz * start.lateral);
        if (slot > 0) aligned(sim.cars[grid[slot - 1]].s - car.s, GP_GRID.stagger);
        if (slot >= 3) aligned(sim.cars[grid[slot - 3]].s - car.s, 12);
        for (let j = slot + 1; j < count; j++) {
          const other = sim.cars[grid[j]].body.position;
          expect(
            Math.hypot(car.body.position.x - other.x, car.body.position.z - other.z),
          ).toBeGreaterThan(3.5);
        }
      }
      // The actual collision solver must not have to untangle the initial grid.
      sim.collisions.solve(sim.cars, sim.track);
      expect(sim.cars.map((car) => ({ ...car.body.position }))).toEqual(positions);
      expect(sim.cars.every((car) => car.impact === 0)).toBe(true);
      expect(sim.cars[0].s).toBe(sim.cars[grid[count - 1]].s);
    });

  it('retains the existing mixed, superbike and car placements', () => {
    for (const vehicles of [
      ['gpr1', 'sbk1000', 'gpr2', 'ss600'],
      ['sbk1000', 'sbk1000', 'ss600', 'ss600'],
      ['apx01', 'apx01', 'apx01', 'apx01'],
    ]) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3, vehicles });
      expect(gpGridForVehicles(sim.options.vehicles)).toBe(false);
      expect(gpGridForFrame(sim.makeFrame())).toBe(false);
      for (let i = 0; i < sim.cars.length; i++) {
        const s =
          sim.track.length - sim.track.pit.gridStart - Math.floor(i / 2) * sim.track.pit.gridRow;
        aligned(sim.cars[i].s, s);
        aligned(sim.cars[i].lateral, (i % 2 ? 1 : -1) * sim.track.pit.gridColumn);
      }
    }
  });

  it('retains the spread-out qualifying release and restores a replay field selection', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'qualifying',
      opponents: 3,
      vehicles: Array(4).fill('gpr1'),
    });
    const spacing = Math.min(420, (sim.track.length - 400) / sim.cars.length);
    for (let i = 0; i < sim.cars.length; i++) {
      expect(sim.cars[i].s).toBeCloseTo(
        sim.track.length - sim.track.pit.gridStart - (i + 1) * spacing,
        4,
      );
      expect(sim.cars[i].lateral).toBeCloseTo(0, 8);
    }
    const gp = sim.makeFrame(),
      saved = gp.slice();
    const mixed = new Simulation({
      ...DEFAULT_OPTIONS,
      opponents: 1,
      vehicles: ['gpr1', 'sbk1000'],
    }).makeFrame();
    expect(gpGridForFrame(gp)).toBe(true);
    expect(gpGridForFrame(mixed)).toBe(false);
    expect(gpGridForFrame(gp)).toBe(true);
    expect(gp).toEqual(saved);
    for (const bad of [NaN, Infinity, -1, 1.5]) {
      const frame = gp.slice();
      frame[H.CARS] = bad;
      expect(gpGridForFrame(frame)).toBe(false);
    }
    const corrupt = gp.slice();
    corrupt[carBase(0) + RACE_BASE + R.VEHICLE] = NaN;
    expect(gpGridForFrame(corrupt)).toBe(false);
    expect(gpGridForFrame(new Float32Array())).toBe(false);
    expect(gpGridForFrame(gp.subarray(0, 10))).toBe(false);
    expect(gpGridForVehicles(undefined)).toBe(false);
    expect(gpGridForVehicles([])).toBe(false);
    expect(() => gpGridSlot(sim.track, -1)).toThrow(RangeError);
  });
});
