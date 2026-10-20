import { describe, expect, it } from 'vitest';
import { aquaplaning, makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceMaterial } from '../src/simulation/surface-material.ts';
import { surfaceSample } from '../src/simulation/track.ts';

describe('tire translation and travel direction', () => {
  it('cools airborne tires and rotors equally at equal planar speed through a spin', () => {
    const temperatures = ([longitudinal, lateral]: readonly [number, number]) => {
      const tire = makeTire('medium'),
        road = surfaceSample();
      tire.surfaceTemp = tire.carcassTemp = tire.coreTemp = 100;
      tire.discTemp = 600;
      for (let i = 0; i < 240; i++)
        solveTire(tire, longitudinal, lateral, 0, 0, 0, road, 0, 1 / 240, 0, 15);
      return [tire.surfaceTemp, tire.carcassTemp, tire.coreTemp, tire.discTemp, tire.pressure];
    };
    const forward = temperatures([60, 0]);
    for (const velocity of [
      [0, 60],
      [-48, -36],
      [36, -48],
    ] as const)
      expect(temperatures(velocity)).toEqual(forward);
    const stationary = temperatures([0, 0]);
    expect(forward[0]).toBeLessThan(stationary[0]);
    expect(forward[3]).toBeLessThan(stationary[3]);
  });

  it('uses the complete road-plane velocity for the bounded water-film grip model', () => {
    const road = surfaceSample(),
      load = 2200,
      speed = 60;
    road.water = 2;
    const expected = aquaplaning(
      'medium',
      load,
      road.water,
      speed,
      0,
      155,
      surfaceMaterial(road.surface).textureMm,
    );
    expect(expected).toBeGreaterThan(0.1);
    for (const [longitudinal, lateral] of [
      [60, 0],
      [0, 60],
      [-48, -36],
      [36, -48],
    ]) {
      const tire = makeTire('medium');
      solveTire(tire, longitudinal, lateral, load, 0, 0, road, 0, 1 / 240);
      expect(tire.aquaplane).toBe(expected);
      expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('does not mistake stationary wheelspin for vehicle translation through a water film', () => {
    const tire = makeTire('medium'),
      road = surfaceSample();
    road.water = 2;
    tire.omega = 100 / tire.radius;
    solveTire(tire, 0, 0, 2200, 1500, 0, road, 0, 1 / 240);
    expect(tire.omega * tire.radius).toBeGreaterThan(90);
    expect(tire.aquaplane).toBe(0);
  });

  it('reduces actual lateral force during a fast sideways aquaplane, not just its diagnostic', () => {
    const lateralForce = (speed: number, water: number) => {
      const tire = makeTire('medium'),
        road = surfaceSample();
      road.water = water;
      for (let i = 0; i < 10; i++) solveTire(tire, 0, speed, 2200, 0, 0, road, 0, 1 / 240);
      return Math.abs(tire.fy);
    };
    // On dry pavement both contacts reach the sliding branch. A deep film
    // removes a substantial additional share at high planar speed even when
    // the chassis is exactly sideways to the wheel's rolling direction.
    expect(lateralForce(90, 0)).toBeGreaterThan(lateralForce(10, 0) * 0.95);
    expect(lateralForce(90, 2)).toBeLessThan(lateralForce(10, 2) * 0.5);
  });

  it('accumulates the same flat spot when locked while travelling forward or backward', () => {
    const forward = makeTire('medium'),
      reverse = makeTire('medium'),
      road = surfaceSample();
    for (let i = 0; i < 240; i++) {
      solveTire(forward, 30, 0, 2200, 0, 4000, road, 0, 1 / 240);
      solveTire(reverse, -30, 0, 2200, 0, 4000, road, 0, 1 / 240);
      expect(forward.omega).toBe(0);
      expect(reverse.omega).toBe(0);
    }
    expect(forward.flatSpot).toBeGreaterThan(0.001);
    expect(reverse.flatSpot).toBeCloseTo(forward.flatSpot, 13);
    expect(reverse.wear).toBeCloseTo(forward.wear, 13);
    expect(reverse.surfaceTemp).toBeCloseTo(forward.surfaceTemp, 12);
  });

  it.each([-1, 1])(
    'does not create a single flat spot during rapid counter-rotation, direction %s',
    (direction) => {
      const tire = makeTire('medium'),
        road = surfaceSample();
      tire.omega = (-direction * 60) / tire.radius;
      for (let i = 0; i < 60; i++) {
        solveTire(tire, direction * 30, 0, 2200, -direction * 1800, 0, road, 0, 1 / 240);
        expect(direction * tire.omega * tire.radius).toBeLessThan(-30);
      }
      expect(tire.flatSpot).toBe(0);
      expect(tire.wear).toBeGreaterThan(0);
    },
  );
});
