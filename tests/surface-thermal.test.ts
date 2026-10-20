import { describe, expect, it } from 'vitest';
import {
  evaporatedWater,
  SURFACE_THERMAL,
  SurfaceThermalStep,
  WATER_HEAT_CAPACITY,
  WATER_LATENT_HEAT,
  type SurfaceThermalParameters,
  type SurfaceWeather,
} from '../src/simulation/surface-thermal.ts';
import { advanceWater, type WeatherKeyframe } from '../src/simulation/weather.ts';
import {
  CELL_COLS,
  CELL_ROWS,
  SURFACE,
  surfaceSample,
  Track,
  trackPoint,
} from '../src/simulation/track.ts';
import { TYRE_THERMAL } from '../src/simulation/tyre-thermal.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

const weather: SurfaceWeather = { ambient: 24, cloud: 1, rain: 0, windX: 0, windZ: 0 };
const insulated: SurfaceThermalParameters = {
  ...SURFACE_THERMAL,
  airBase: 0,
  airWind: 0,
  solarFlux: 0,
  deepConductance: 0,
};
const columnEnergy = (surface: number, substrate: number, p = SURFACE_THERMAL) =>
  surface * p.surfaceCapacity + substrate * p.substrateCapacity;

describe('pavement surface and substrate energy balance', () => {
  it('conserves insulated heat and approaches the capacity-weighted equilibrium', () => {
    const initial = columnEnergy(70, 15);
    const equilibrium = initial / (insulated.surfaceCapacity + insulated.substrateCapacity);
    for (const dt of [0.001, 0.5, 60, 600, 1e7]) {
      const solve = new SurfaceThermalStep(insulated).prepare(dt, weather).advance(70, 15);
      expect(columnEnergy(solve.surface, solve.substrate)).toBeCloseTo(initial, 7);
      expect(solve.surface).toBeGreaterThanOrEqual(equilibrium - 1e-10);
      expect(solve.surface).toBeLessThanOrEqual(70);
      expect(solve.substrate).toBeGreaterThanOrEqual(15);
      expect(solve.substrate).toBeLessThanOrEqual(equilibrium + 1e-10);
      if (dt === 1e7) {
        expect(solve.surface).toBeCloseTo(equilibrium, 10);
        expect(solve.substrate).toBeCloseTo(equilibrium, 10);
      }
    }
  });

  it('accounts for supplied heat exactly even when the insulated mode has a zero eigenvalue', () => {
    for (const conduction of [0, 0.00001, 45, 400]) {
      const parameters = { ...insulated, conduction };
      const step = new SurfaceThermalStep(parameters).prepare(60, weather).advance(25, 18, 700);
      expect(columnEnergy(step.surface, step.substrate) - columnEnergy(25, 18)).toBeCloseTo(
        42000,
        6,
      );
    }
  });

  it('is invariant to subdivision for a held weather and heat-flux history', () => {
    const conditions = { ...weather, cloud: 0.3, rain: 12, windX: 3, windZ: -2 };
    const exact = new SurfaceThermalStep().prepare(30, conditions).advance(42, 31, -60);
    for (const dt of [0.5, 0.25, 1 / 30, 1 / 240]) {
      const solve = new SurfaceThermalStep().prepare(dt, conditions);
      let surface = 42,
        substrate = 31;
      for (let i = 0; i < Math.round(30 / dt); i++) {
        solve.advance(surface, substrate, -60);
        surface = solve.surface;
        substrate = solve.substrate;
      }
      expect(surface).toBeCloseTo(exact.surface, 8);
      expect(substrate).toBeCloseTo(exact.substrate, 8);
    }
  });

  it('retains a warm substrate after a surface cools and returns that heat to the road', () => {
    const solve = new SurfaceThermalStep().prepare(60, weather);
    solve.advance(24, 42);
    const warm = solve.surface;
    expect(warm).toBeGreaterThan(25);
    expect(solve.substrate).toBeLessThan(42);
    solve.advance(24, 24);
    expect(solve.surface).toBeCloseTo(24, 12);
    expect(warm).toBeGreaterThan(solve.surface);
  });

  it('distinguishes sunlight, sheltered road and sensible cooling by incoming rain', () => {
    const sunny = new SurfaceThermalStep().prepare(120, { ...weather, cloud: 0 }).advance(24, 24);
    const tunnel = new SurfaceThermalStep()
      .prepare(120, { ...weather, cloud: 0 }, true)
      .advance(24, 24);
    expect(sunny.surface).toBeGreaterThan(tunnel.surface + 1);
    expect(tunnel.surface).toBeCloseTo(24, 12);
    const dry = new SurfaceThermalStep().prepare(120, weather).advance(40, 35);
    const rain = new SurfaceThermalStep().prepare(120, { ...weather, rain: 36 }).advance(40, 35);
    expect(rain.surface).toBeLessThan(dry.surface);
  });

  it('rejects invalid inputs and cannot silently run an unprepared thermal step', () => {
    expect(() => new SurfaceThermalStep({ ...insulated, surfaceCapacity: 0 })).toThrow();
    const solve = new SurfaceThermalStep();
    expect(() => solve.advance(20, 20)).toThrow();
    expect(() => solve.prepare(0, weather)).toThrow();
    expect(() => solve.prepare(1, { ...weather, rain: -1 })).toThrow();
    solve.prepare(1, weather);
    expect(() => solve.advance(NaN, 20)).toThrow();
  });

  it('uses the same local rainfall mass for sensible heat as for the water film', () => {
    const parameters = { ...insulated, conduction: 0 };
    const conditions = { ...weather, rain: 36 };
    const rainfall = 0.0065,
      dt = 20;
    const solve = new SurfaceThermalStep(parameters)
      .prepare(dt, conditions, false, rainfall)
      .advance(40, 24);
    const expected =
      24 + (40 - 24) * Math.exp((-4180 * rainfall * dt) / parameters.surfaceCapacity);
    expect(solve.surface).toBeCloseTo(expected, 11);
    expect(solve.substrate).toBeCloseTo(24, 12);
  });
});

describe('water-limited evaporation and latent heat', () => {
  it('does not cool a dry cell with rainfall absent from its water budget', () => {
    const parameters = { ...insulated, conduction: 0 };
    const conditions = { ...weather, rain: 36 };
    const dt = 20;
    const solve = new SurfaceThermalStep(parameters).prepare(dt, conditions);
    const rainySurface =
      weather.ambient +
      (40 - weather.ambient) *
        Math.exp(
          (-WATER_HEAT_CAPACITY * (conditions.rain / 3600) * dt) / parameters.surfaceCapacity,
        );
    for (let i = 0; i < 2; i++) {
      solve.advanceWet(40, 24, 0, 0, 0);
      expect(solve.water).toBe(0);
      expect(solve.evaporated).toBe(0);
      expect(solve.surface).toBeCloseTo(40, 12);
      expect(solve.substrate).toBeCloseTo(24, 12);
      // A cell-specific override must not change the standalone prepared step.
      solve.advance(40, 24);
      expect(solve.surface).toBeCloseTo(rainySurface, 11);
    }
  });

  it('accounts for the dry-out event while drainage competes with evaporation', () => {
    expect(evaporatedWater(0, 0, 1, 0.2, 60)).toBe(0);
    expect(evaporatedWater(1, 0, 0.1, 0, 20)).toBeCloseTo(1, 12);
    expect(evaporatedWater(0, 0.1, 0.2, 0, 10)).toBeCloseTo(1, 12);
    const evaporated = evaporatedWater(0.2, 0, 0.01, 0.05, 100);
    expect(evaporated).toBeCloseTo((0.01 * Math.log(2)) / 0.05, 12);
    expect(evaporated).toBeLessThan(0.2);
    expect(advanceWater(0.2, -0.01, 0.05, 100)).toBe(0);
    expect(() => evaporatedWater(-1, 0, 0, 0, 1)).toThrow();
  });

  it('removes exactly the latent heat of water evaporated, with no cooling from a dry film', () => {
    const solve = new SurfaceThermalStep(insulated).prepare(0.5, weather);
    const initial = columnEnergy(34, 28);
    solve.advanceWet(34, 28, 0, 0, 0);
    expect(solve.evaporated).toBe(0);
    expect(columnEnergy(solve.surface, solve.substrate)).toBeCloseTo(initial, 7);
    solve.advanceWet(34, 28, 0.01, 0, 0);
    expect(solve.evaporated).toBeGreaterThan(0);
    expect(solve.water + solve.evaporated).toBeCloseTo(0.01, 12);
    expect(initial - columnEnergy(solve.surface, solve.substrate)).toBeCloseTo(
      solve.evaporated * WATER_LATENT_HEAT,
      7,
    );
  });

  it('gives identical evaporated mass for a held flux split around film dry-out', () => {
    const initial = 0.03,
      rain = 0.0001,
      demand = 0.001,
      drainage = 0.02;
    const total = evaporatedWater(initial, rain, demand, drainage, 120);
    let water = initial,
      evaporated = 0;
    for (let i = 0; i < 240; i++) {
      evaporated += evaporatedWater(water, rain, demand, drainage, 0.5);
      water = advanceWater(water, rain - demand, drainage, 0.5);
    }
    expect(evaporated).toBeCloseTo(total, 12);
    expect(water).toBe(0);
  });
});

const changingWeather: WeatherKeyframe[] = [
  {
    timeSec: 0,
    cloudCover01: 0.1,
    rainRateMmHr: 0,
    ambientTempC: 24,
    windSpeedMS: 2,
    windDirection: 0,
  },
  {
    timeSec: 10,
    cloudCover01: 1,
    rainRateMmHr: 24,
    ambientTempC: 20,
    windSpeedMS: 4,
    windDirection: 1,
  },
];

describe('production circuit and festival surface evolution', () => {
  it('keeps the same thermal/water history across differently scheduled surface calls', () => {
    const many = new Track('clear', true, changingWeather);
    const delayed = new Track('clear', true, changingWeather);
    for (let tick = 1; tick <= 40; tick++) many.evolve(0.1, tick * 0.1);
    delayed.evolve(4, 4);
    expect(many.temperature).toEqual(delayed.temperature);
    expect(many.substrateTemperature).toEqual(delayed.substrateTemperature);
    expect(many.water).toEqual(delayed.water);
    expect(many.rubber).toEqual(delayed.rubber);
    expect(many.surfaceClock).toBeCloseTo(0, 12);
  });

  it('deposits only the road share of tire slip work, once, in the contacted cell', () => {
    const warm = new Track('clear', true),
      cold = new Track('clear', true);
    const cell = 101 * CELL_COLS + 3;
    const power = 1e6,
      dt = 0.5;
    warm.interact(cell, 3000, power, 0, dt, SURFACE.ASPHALT);
    // No road work may be deposited by an airborne wheel or an off-grid surface.
    warm.interact(cell + 1, 0, power, 40, dt, SURFACE.ASPHALT);
    warm.interact(cell + 2, 3000, power, 40, dt, SURFACE.GRASS);
    warm.evolve(dt, dt);
    cold.evolve(dt, dt);
    expect(warm.temperature[cell]).toBeGreaterThan(cold.temperature[cell]);
    expect(warm.substrateTemperature[cell]).toBeGreaterThan(cold.substrateTemperature[cell]);
    expect(warm.temperature[cell + 1]).toBe(cold.temperature[cell + 1]);
    expect(warm.temperature[cell + 2]).toBe(cold.temperature[cell + 2]);
    const p = warm.at(((101 + 0.5) / CELL_ROWS) * warm.length, trackPoint());
    const area = (warm.length / CELL_ROWS) * ((2 * p.width) / CELL_COLS);
    const excess = () =>
      area *
      (columnEnergy(warm.temperature[cell], warm.substrateTemperature[cell]) -
        columnEnergy(cold.temperature[cell], cold.substrateTemperature[cell]));
    const deposited = power * dt * (1 - TYRE_THERMAL.slipShare);
    // Tiny convection/deep losses and Float32 storage explain the tolerance.
    expect(excess()).toBeGreaterThan(deposited * 0.995);
    expect(excess()).toBeLessThan(deposited * 1.001);
    const afterDeposit = excess();
    warm.evolve(0.5, 1);
    cold.evolve(0.5, 1);
    expect(excess()).toBeLessThanOrEqual(afterDeposit * 1.001);
  });

  it('shelters the road from both rainfall and direct solar heating', () => {
    const track = new Track('clear', true);
    track.sheltered[0] = 1;
    track.temperature.fill(24);
    track.substrateTemperature.fill(24);
    track.evolve(60, 60);
    expect(track.temperature[0]).toBeCloseTo(24, 5);
    expect(track.temperature[CELL_COLS]).toBeGreaterThan(24.5);
    expect(track.water[0]).toBe(0);
  });

  it('gives festival tire contacts thermal memory and permits actual evaporation after rain', () => {
    const track = new OpenWorldTrack(openWorld(), 'clear', changingWeather);
    const p = track.at(200, trackPoint()),
      sample = surfaceSample();
    track.sample(p.x, p.z, sample, p.y);
    const initial = sample.temp;
    track.evolve(0.5, 10);
    track.sample(p.x, p.z, sample, p.y);
    expect(sample.temp).toBeGreaterThan(initial - 1);
    expect(sample.temp).toBeGreaterThan(track.ambient + 5);
    const sunny = new OpenWorldTrack(openWorld(), 'clear');
    sunny.wetness = 0.001;
    sunny.evolve(60, 60);
    // Drainage alone leaves a positive exponential tail. Evaporation dries it.
    expect(sunny.wetness).toBe(0);
  });
});
