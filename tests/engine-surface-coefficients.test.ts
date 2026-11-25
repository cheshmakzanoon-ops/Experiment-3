import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SURFACE_THERMAL,
  SurfaceThermalStep,
  type SurfaceThermalParameters,
  type SurfaceWeather,
} from '../src/simulation/surface-thermal.ts';
import { advanceWater, WaterStepCoefficients } from '../src/simulation/weather.ts';
import { CELL_COLS, CELL_ROWS, Track } from '../src/simulation/track.ts';

afterEach(() => vi.restoreAllMocks());

const weather: SurfaceWeather = {
  ambient: 24,
  cloud: 0.3,
  rain: 24,
  windX: 3,
  windZ: -2,
};

const expectColumn = (actual: SurfaceThermalStep, expected: SurfaceThermalStep) => {
  expect(actual.surface).toBe(expected.surface);
  expect(actual.substrate).toBe(expected.substrate);
  expect(actual.water).toBe(expected.water);
  expect(actual.evaporated).toBe(expected.evaporated);
};

describe('fixed surface water coefficient slots', () => {
  it('retains exact arithmetic through tiny drainage, drying, dt and drainage edits', () => {
    const coefficients = new WaterStepCoefficients(3);
    for (const dt of [0, -0, 0.000001, 0.5, 60, 0.5])
      for (const drainage of [0, -0, 1e-15, 0.999e-12, 1e-12, 0.02, 25, 0.02])
        for (const source of [-0.02, 0, 0.007])
          for (const water of [0, 0.0001, 1.7]) {
            const expected = advanceWater(water, source, drainage, dt);
            for (let cell = 0; cell < 3; cell++)
              expect(advanceWater(water, source, drainage, dt, coefficients, cell)).toBe(expected);
          }
  });

  it('reuses gains and invalidates their actual drainage and timestep keys', () => {
    const coefficients = new WaterStepCoefficients(2);
    const expm1 = vi.spyOn(Math, 'expm1');
    for (let tick = 0; tick < 4; tick++) {
      advanceWater(1, 0.001, 0.02, 0.5, coefficients, 0);
      advanceWater(2, -0.001, 0.03, 0.5, coefficients, 1);
    }
    expect(expm1).toHaveBeenCalledTimes(2);
    advanceWater(1, 0.001, 0.025, 0.5, coefficients, 0);
    expect(expm1).toHaveBeenCalledTimes(3);
    advanceWater(1, 0.001, 0.025, 1, coefficients, 0);
    advanceWater(2, -0.001, 0.03, 1, coefficients, 1);
    expect(expm1).toHaveBeenCalledTimes(5);
    advanceWater(1, 0.001, 0, 1, coefficients, 0);
    expect(expm1).toHaveBeenCalledTimes(5);
  });

  it('keeps public input rejection with and without reusable coefficients', () => {
    const coefficients = new WaterStepCoefficients(1);
    const invalid = [
      [-1, 0, 0.02, 0.5],
      [NaN, 0, 0.02, 0.5],
      [1, Infinity, 0.02, 0.5],
      [1, 0, -0.02, 0.5],
      [1, 0, Infinity, 0.5],
      [1, 0, 0.02, -0.5],
      [1, 0, 0.02, NaN],
    ];
    for (const [water, source, drainage, dt] of invalid)
      for (const cache of [undefined, coefficients])
        expect(() => advanceWater(water, source, drainage, dt, cache)).toThrow(
          'Invalid surface water step',
        );
    expect(() => new WaterStepCoefficients(-1)).toThrow();
    expect(() => advanceWater(1, 0, 0.02, 0.5, coefficients, 1)).toThrow();
  });
});

describe('bounded exact wet pavement matrices', () => {
  it('matches fresh columns after every matrix, exposure and forcing input changes', () => {
    const parameters: SurfaceThermalParameters = { ...SURFACE_THERMAL };
    const cached = new SurfaceThermalStep(parameters, 4);
    const waterCoefficients = new WaterStepCoefficients(4);
    const conditions = { ...weather };
    let dt = 0.5;
    let sheltered = false;
    let localRain = weather.rain / 3600;
    const changes = [
      () => {},
      () => {},
      () => (conditions.ambient = -2),
      () => (conditions.cloud = 0.95),
      () => (conditions.windX = 6),
      () => (dt = 0.25),
      () => (dt = 0.5),
      () => (parameters.surfaceCapacity *= 1.25),
      () => (parameters.substrateCapacity *= 0.75),
      () => (parameters.conduction *= 2),
      () => (parameters.deepConductance = 0),
      () => (parameters.airBase = 0),
      () => (parameters.airWind = 0),
      () => (parameters.solarFlux = 45),
      () => (localRain = 0),
      () => (parameters.conduction = 0),
      () => (sheltered = true),
      () => (sheltered = false),
      () => (localRain = 0.0002),
      () => (dt = 60),
    ];
    for (const change of changes) {
      change();
      cached.prepare(dt, conditions, sheltered);
      for (let cell = 0; cell < 4; cell++) {
        const rainfall = sheltered ? 0 : localRain * (0.65 + cell * 0.07);
        const drainage = cell === 0 ? 1e-15 : 0.01 + cell * 0.005;
        const surface = cell === 0 ? 60 : 18 + cell;
        const water = cell === 0 ? 0.000001 : cell * 0.15;
        const qTraffic = cell * 125;
        const reference = new SurfaceThermalStep({ ...parameters })
          .prepare(dt, conditions, sheltered)
          .advanceWet(surface, 26, water, rainfall, drainage, qTraffic);
        cached.advanceWet(
          surface,
          26,
          water,
          rainfall,
          drainage,
          qTraffic,
          cell,
          waterCoefficients,
        );
        expectColumn(cached, reference);
      }
      const prepared = new SurfaceThermalStep({ ...parameters })
        .prepare(dt, conditions, sheltered)
        .advance(29, 21, 57);
      cached.advance(29, 21, 57);
      expect(cached.surface).toBe(prepared.surface);
      expect(cached.substrate).toBe(prepared.substrate);
    }
  });

  it('keeps fixed storage through changing rainfall and slot revisits', () => {
    const cached = new SurfaceThermalStep(SURFACE_THERMAL, 4);
    const rainfallSlots = Reflect.get(cached, 'cellRainfall') as Float64Array;
    const matrices = Reflect.get(cached, 'cellMatrices') as Float64Array;
    expect(rainfallSlots).toBeInstanceOf(Float64Array);
    expect(matrices).toBeInstanceOf(Float64Array);
    expect(rainfallSlots.byteLength + matrices.byteLength).toBe(4 * 7 * 8);
    for (let tick = 0; tick < 40; tick++) {
      const conditions = { ...weather, windX: 3 + Math.floor(tick / 4) * 0.01 };
      cached.prepare(0.5, conditions);
      for (let cell = 0; cell < 4; cell++) {
        const rainfall = 0.001 + tick * 0.00001 + cell * 0.0001;
        cached.advanceWet(23, 20, 0.4, rainfall, 0.02, 0, cell);
        const reference = new SurfaceThermalStep()
          .prepare(0.5, conditions)
          .advanceWet(23, 20, 0.4, rainfall, 0.02);
        expectColumn(cached, reference);
      }
    }
    expect(Reflect.get(cached, 'cellRainfall')).toBe(rainfallSlots);
    expect(Reflect.get(cached, 'cellMatrices')).toBe(matrices);
    expect(() => new SurfaceThermalStep(SURFACE_THERMAL, 1.5)).toThrow();
  });

  it('preserves validation on cached and unprepared wet columns', () => {
    const cached = new SurfaceThermalStep(SURFACE_THERMAL, 1);
    expect(() => cached.advanceWet(20, 20, 0.2, 0, 0.02, 0, 0)).toThrow();
    cached.prepare(0.5, weather).advanceWet(20, 20, 0.2, 0.001, 0.02, 0, 0);
    expect(() => cached.advanceWet(20, 20, -0.2, 0.001, 0.02, 0, 0)).toThrow();
    expect(() => cached.advanceWet(20, 20, 0.2, -0.001, 0.02, 0, 0)).toThrow();
    expect(() => cached.advanceWet(20, 20, 0.2, 0.001, -0.02, 0, 0)).toThrow();
    expect(() => cached.advanceWet(NaN, 20, 0.2, 0.001, 0.02, 0, 0)).toThrow();
    expect(() => cached.advanceWet(20, 20, 0.2, 0.001, 0.02, Infinity, 0)).toThrow();
  });
});

describe('production surface coefficient reuse', () => {
  it('eliminates repeated depression, water gains and per-cell constant-rain matrices', () => {
    const track = new Track('rain');
    track.sheltered[0] = 1;
    track.evolve(0.5, 0.5);
    const expm1 = vi.spyOn(Math, 'expm1');
    const sin = vi.spyOn(Math, 'sin');
    track.evolve(0.5, 1);
    // Only the prepared (undepressed) rainfall matrix needs two integrals.
    expect(expm1).toHaveBeenCalledTimes(2);
    // The unchanged weather sampler still runs at both endpoints.
    expect(sin.mock.calls.length).toBeLessThan(10);
    expm1.mockClear();
    track.drainage[0] *= 1.5;
    track.drainage[CELL_COLS] *= 1.5;
    track.evolve(0.5, 1.5);
    expect(expm1).toHaveBeenCalledTimes(4);
    expm1.mockClear();
    track.sheltered[0] = 0;
    track.evolve(0.5, 2);
    expect(expm1).toHaveBeenCalledTimes(2 + CELL_COLS * 2);
    expm1.mockClear();
    track.evolve(0.5, 2.5);
    expect(expm1).toHaveBeenCalledTimes(2);
    expect(track.water.length).toBe(CELL_ROWS * CELL_COLS);
  });
});
