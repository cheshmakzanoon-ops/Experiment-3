import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SURFACE_THERMAL,
  SurfaceThermalStep,
  type SurfaceThermalParameters,
  type SurfaceWeather,
} from '../src/simulation/surface-thermal.ts';
import { Track } from '../src/simulation/track.ts';
import { WaterStepCoefficients } from '../src/simulation/weather.ts';

afterEach(() => vi.restoreAllMocks());

const expectColumn = (actual: SurfaceThermalStep, expected: SurfaceThermalStep) => {
  expect(actual.surface).toBe(expected.surface);
  expect(actual.substrate).toBe(expected.substrate);
  expect(actual.water).toBe(expected.water);
  expect(actual.evaporated).toBe(expected.evaporated);
};

describe('frozen default pavement matrix signature', () => {
  it('preserves exact columns as weather, timestep, exposure and local rainfall change', () => {
    const cells = 16;
    const solve = new SurfaceThermalStep(SURFACE_THERMAL, cells);
    // A caller-owned copy retains the original per-rainfall signature checks.
    const reference = new SurfaceThermalStep({ ...SURFACE_THERMAL }, cells);
    const waterCoefficients = new WaterStepCoefficients(cells);
    const refresh = vi.spyOn(
      solve as unknown as { refreshMatrixInputs(): void },
      'refreshMatrixInputs',
    );
    expect(Object.isFrozen(SURFACE_THERMAL)).toBe(true);
    for (let tick = 0; tick < 12; tick++) {
      const weather: SurfaceWeather = {
        ambient: tick - 4,
        cloud: (tick % 4) / 4,
        rain: tick % 3 ? 24 : 0,
        windX: 3 + Math.floor(tick / 4),
        windZ: -2,
      };
      const dt = [0.5, 0.5, 0.25, 1, 0.125, 0.5][tick % 6];
      const sheltered = tick === 5 || tick === 6;
      solve.prepare(dt, weather, sheltered);
      reference.prepare(dt, weather, sheltered);
      // Revisit slots before the next prepare to exercise cached matrices too.
      for (let pass = 0; pass < 2; pass++)
        for (let cell = 0; cell < cells; cell++) {
          const rainfall = sheltered ? 0 : (weather.rain / 3600) * (0.65 + cell * 0.02);
          const surface = cell % 3 ? 24 + pass : 60;
          const water = cell % 4 ? 0.4 : 0;
          const drainage = cell % 2 ? 0.02 : 1e-15;
          solve.advanceWet(
            surface,
            26,
            water,
            rainfall,
            drainage,
            cell * 1.7,
            cell,
            waterCoefficients,
          );
          reference.advanceWet(surface, 26, water, rainfall, drainage, cell * 1.7, cell);
          expectColumn(solve, reference);
        }
      solve.advance(29, 21, 57);
      reference.advance(29, 21, 57);
      expectColumn(solve, reference);
    }
    expect(refresh).toHaveBeenCalledTimes(12);
  });

  it.each(['surfaceCapacity', 'substrateCapacity', 'conduction', 'deepConductance'] as const)(
    'retains mid-prepare mutable %s edits and the existing same-rain fast path',
    (key) => {
      const parameters: SurfaceThermalParameters = { ...SURFACE_THERMAL };
      const weather = { ambient: 18, cloud: 0.3, rain: 24, windX: 3, windZ: -2 };
      const solve = new SurfaceThermalStep(parameters, 2).prepare(0.5, weather);
      const advance = (step: SurfaceThermalStep, rainfall: number, cell = -1) =>
        step.advanceWet(42, 26, 0.4, rainfall, 0.02, 125, cell);
      advance(solve, 0.001, 0);
      advance(solve, 0.002, 1);
      parameters[key] *= 1.5;

      // Same rainfall deliberately retains the matrix selected before the edit.
      advance(solve, 0.002, 1);
      const held = new SurfaceThermalStep({ ...SURFACE_THERMAL }).prepare(0.5, weather);
      expectColumn(solve, advance(held, 0.002));

      // Changed rainfall must invalidate both previously populated cell slots.
      const changed = new SurfaceThermalStep({ ...parameters }).prepare(0.5, weather);
      advance(solve, 0.001, 0);
      expectColumn(solve, advance(changed, 0.001));
      advance(solve, 0.002, 1);
      expectColumn(solve, advance(changed, 0.002));
      expect(solve.surface).not.toBe(held.surface);
    },
  );

  it.each(['clear', 'rain', 'storm'] as const)(
    'refreshes only at the two prepare boundaries per default %s Track update',
    (preset) => {
      const track = new Track(preset);
      const refresh = vi.spyOn(
        SurfaceThermalStep.prototype as unknown as { refreshMatrixInputs(): void },
        'refreshMatrixInputs',
      );
      for (let tick = 1; tick <= 4; tick++) track.evolve(0.5, tick * 0.5);
      expect(refresh).toHaveBeenCalledTimes(8);
    },
  );
});
