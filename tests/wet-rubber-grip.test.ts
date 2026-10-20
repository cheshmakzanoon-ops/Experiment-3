import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP, type Compound } from '../src/simulation/config.ts';
import {
  MATERIAL,
  MATERIALS,
  rubberGrip,
  surfaceMaterial,
} from '../src/simulation/surface-material.ts';
import { aquaplaning, makeTire, peakGrip, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample, Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const asphalt = surfaceMaterial(MATERIAL.ASPHALT);

describe('local wet rubber grip', () => {
  it('retains the dry rubber advantage and reverses it when the same pavement becomes wet', () => {
    expect(rubberGrip(asphalt, 1, 0)).toBeCloseTo(1.05, 12);
    expect(rubberGrip(asphalt, 0.5, 0)).toBeCloseTo(1.025, 12);
    for (const water of [0.2, 0.5, 2, 10]) {
      expect(rubberGrip(asphalt, 1, water)).toBeLessThan(rubberGrip(asphalt, 0.5, water));
      expect(rubberGrip(asphalt, 0.5, water)).toBeLessThan(1);
    }
    // Removing the local film restores exactly the dry state, without waiting
    // for a global weather preset or a separate grip-history timer.
    expect(rubberGrip(asphalt, 1, 0)).toBeCloseTo(1.05, 12);
  });

  it('is continuous and bounded through wetting and drying, with no effect on clean pavement', () => {
    for (const material of MATERIALS.filter((m) => m.sealed)) {
      let previous = rubberGrip(material, 1, 0);
      for (let i = 0; i <= 2000; i++) {
        const water = i / 1000,
          grip = rubberGrip(material, 1, water);
        expect(rubberGrip(material, 0, water)).toBe(1);
        expect(grip).toBeLessThanOrEqual(previous);
        expect(previous - grip).toBeLessThan(0.003);
        expect(grip).toBeGreaterThanOrEqual(0.82);
        expect(grip).toBeLessThanOrEqual(1.05);
        previous = grip;
      }
    }
    expect(rubberGrip(asphalt, -1, 1)).toBe(1);
    expect(rubberGrip(asphalt, 4, 1)).toBe(rubberGrip(asphalt, 1, 1));
    expect(rubberGrip(asphalt, 1, -1)).toBe(rubberGrip(asphalt, 1, 0));
  });

  it('responds sooner on smoother pavement and never adds rubber grip to loose or unsealed ground', () => {
    expect(rubberGrip(surfaceMaterial(MATERIAL.PAINT), 1, 0.2)).toBeLessThan(
      rubberGrip(asphalt, 1, 0.2),
    );
    for (const material of MATERIALS.filter((m) => !m.sealed))
      for (const water of [0, 0.1, 1, 10]) expect(rubberGrip(material, 1, water)).toBe(1);
  });

  it('changes all tyre compounds through the same road interface while preserving tread drainage', () => {
    const clean = surfaceSample(),
      covered = surfaceSample();
    clean.water = covered.water = 2;
    covered.rubber = 0.9;
    const ratios: number[] = [];
    const wetGrips: number[] = [];
    for (const compound of ['soft', 'medium', 'hard', 'intermediate', 'wet'] as Compound[]) {
      const tire = makeTire(compound);
      const base = peakGrip(tire, 2200, clean, 50),
        laid = peakGrip(tire, 2200, covered, 50);
      ratios.push(laid / base);
      wetGrips.push(laid);
      expect(laid).toBeLessThan(base);
      const cleanTire = makeTire(compound),
        coveredTire = makeTire(compound);
      cleanTire.omega = coveredTire.omega = 50 / cleanTire.radius;
      solveTire(cleanTire, 50, 0, 2200, 0, 0, clean, 0, 1 / 240);
      solveTire(coveredTire, 50, 0, 2200, 0, 0, covered, 0, 1 / 240);
      expect(coveredTire.aquaplane).toBe(cleanTire.aquaplane);
    }
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-12);
    expect(wetGrips[4]).toBeGreaterThan(wetGrips[1]);
    expect(aquaplaning('wet', 2200, 2, 50)).toBeLessThan(aquaplaning('medium', 2200, 2, 50));
  });

  it('lets a drier racing line regain grip despite having more rubber', () => {
    const tire = makeTire('medium'),
      line = surfaceSample(),
      offLine = surfaceSample();
    line.rubber = 0.8;
    offLine.rubber = 0.05;
    line.water = offLine.water = 0.6;
    expect(peakGrip(tire, 2200, line, 30)).toBeLessThan(peakGrip(tire, 2200, offLine, 30));
    line.water = 0.01;
    expect(peakGrip(tire, 2200, line, 30)).toBeGreaterThan(peakGrip(tire, 2200, offLine, 30));
  });

  it('changes actual tyre braking distance in opposite directions on dry and wet rubber', () => {
    // A controlled quarter-car sled isolates the production implicit wheel
    // and tyre solver from aero, steering, suspension and driver assistance.
    // This is a regression experiment, not a real-car braking calibration.
    const brake = (water: number, rubber: number, hz: number) => {
      const tire = makeTire('medium'),
        road = surfaceSample(),
        mass = 250,
        dt = 1 / hz;
      road.water = water;
      road.rubber = rubber;
      let speed = 100 / 3.6,
        distance = 0;
      tire.omega = speed / tire.radius;
      for (let i = 0; i < 20 * hz && speed > 5 / 3.6; i++) {
        const before = speed;
        solveTire(tire, speed, 0, mass * G, 0, 4000, road, 0, dt);
        speed = Math.max(0, speed + ((tire.fx - tire.groundDrag) / mass) * dt);
        distance += 0.5 * (before + speed) * dt;
        expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
      }
      expect(speed).toBeLessThanOrEqual(5 / 3.6);
      return distance;
    };
    const distances: number[][] = [];
    for (const hz of [240, 480]) {
      const dryClean = brake(0, 0, hz),
        dryRubber = brake(0, 1, hz),
        wetClean = brake(0.6, 0, hz),
        wetRubber = brake(0.6, 1, hz);
      expect(dryRubber).toBeLessThan(dryClean * 0.98);
      expect(wetRubber).toBeGreaterThan(wetClean * 1.05);
      expect(wetClean).toBeGreaterThan(dryClean);
      distances.push([dryClean, dryRubber, wetClean, wetRubber]);
    }
    for (let i = 0; i < 4; i++)
      expect(Math.abs(distances[1][i] - distances[0][i]) / distances[1][i]).toBeLessThan(0.005);
  });

  it('reaches GP front and rear grip separately through the real session adapter', () => {
    const track = new Track('clear'),
      bike = new BikeVehicle(0, 'wet', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
    bike.place(track, 120);
    bike.dynamics.speed = 30;
    bike.input.brake = 0.5;
    for (let i = 0; i < 4; i++) {
      bike.contacts[i].water = 0.6;
      bike.contacts[i].rubber = i < 2 ? 1 : 0;
    }
    bike.step(1 / 240, track);
    expect(bike.dynamics.frontGrip!).toBeLessThan(bike.dynamics.rearGrip! * 0.95);
    expect(bike.dynamics.state).toBe('riding');
    expect(bike.dynamics.frontBrakeForce).toBeGreaterThan(0);
    expect(bike.dynamics.frontUse).toBeLessThanOrEqual(1);
  });
});
