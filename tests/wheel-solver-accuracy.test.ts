import { describe, expect, it } from 'vitest';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';

describe('converged wheel torque and physical work', () => {
  it('closes torque and whole-wheel work across stiff, reversing and unloaded contacts', () => {
    let seed = 123456789;
    const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
    let locked = 0,
      rolling = 0,
      unloaded = 0;
    // The small rotor exposes wide slip-root brackets; high loads and the
    // 1/60 s case deliberately exceed a kart's normal production envelope.
    // These are conditioning stress cases, not real-vehicle calibration.
    for (const inertia of [0.06, 1.35, 5]) {
      const tire = makeTire('medium', 155, inertia === 0.06 ? 0.137 : 0.335, inertia),
        road = surfaceSample();
      for (let i = 0; i < 4000; i++) {
        const oldOmega = tire.omega,
          before = 0.5 * inertia * oldOmega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
          dt = [1 / 960, 1 / 240, 1 / 60][i % 3],
          drive = (random() - 0.5) * 6000,
          brake = random() * 4000,
          speed = (random() - 0.5) * 140,
          sideways = (random() - 0.5) * 20,
          load = random() * 10000;
        road.grip = 0.1 + 0.9 * random();
        solveTire(tire, speed, sideways, i % 41 === 0 ? 0 : load, drive, brake, road, 0, dt);
        const withoutBrake =
          (inertia * (tire.omega - oldOmega)) / dt -
          drive +
          tire.fx * tire.radius -
          tire.rollingTorque;
        if (tire.omega === 0) {
          locked++;
          expect(Math.abs(withoutBrake)).toBeLessThanOrEqual(brake + 1e-6);
        } else {
          rolling++;
          expect(Math.abs(withoutBrake + brake * Math.sign(tire.omega))).toBeLessThan(1e-6);
        }
        if (tire.load === 0) {
          unloaded++;
          expect(tire.fx).toBe(0);
          expect(tire.fy).toBe(0);
        }
        const after =
            0.5 * inertia * tire.omega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
          driveWork = drive * tire.omega * dt,
          boundaryWork = (tire.fx * speed + tire.fy * sideways) * dt,
          frictionBrakeWork = brake * Math.abs(tire.omega) * dt,
          physicalHeat =
            (tire.energy +
              tire.longitudinalRelaxationHeat +
              tire.lateralRelaxationHeat +
              tire.rollingDissipation) *
            dt,
          numericalLoss =
            (tire.longitudinalNumericalDissipation + tire.lateralNumericalDissipation) * dt +
            0.5 * inertia * (tire.omega - oldOmega) ** 2;
        // Independent discrete first-law oracle. Numerical integration loss
        // stays separate from the heat that can change pressure and grip.
        expect(
          Math.abs(
            before +
              driveWork -
              after -
              boundaryWork -
              frictionBrakeWork -
              physicalHeat -
              numericalLoss,
          ),
        ).toBeLessThan(2e-5);
        expect(physicalHeat).toBeGreaterThanOrEqual(0);
        expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
    expect(locked).toBeGreaterThan(100);
    expect(rolling).toBeGreaterThan(100);
    expect(unloaded).toBeGreaterThan(100);
  });

  it('resolves tiny driven torque continuously on an unloaded rotor without a fixed bracket bias', () => {
    for (const direction of [-1, 1])
      for (const inertia of [0.06, 1.35, 5])
        for (const dt of [1 / 960, 1 / 240, 1 / 60]) {
          const tire = makeTire('medium', 155, 0.335, inertia),
            road = surfaceSample(),
            drive = direction * 0.00001;
          solveTire(tire, 0, 0, 0, drive, 0, road, 0, dt);
          expect(tire.omega).toBeCloseTo((drive * dt) / inertia, 12);
          expect(Math.sign(tire.omega)).toBe(direction);
        }
  });
});
