import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { BIKE, Bike, EXPERT, NOVICE } from '../src/simulation/bike.ts';

const geometry = {
  frontArm: BIKE.cgToFront,
  rearArm: BIKE.cgToRear,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
};

/** Isolate the roll equation from tyre relaxation: an analytically balanced
 * contact force Fy/N = tan(phi) has zero moment about the CG. Both the plant
 * and its inverse rider controller must agree as a crest unloads the tyres. */
describe('GP roll reaction at partial support', () => {
  it.each([0.02, 0.1, 0.4, 1, 1.5])(
    'preserves roll balance and demands the matching force at %s static load',
    (support) => {
      for (const assists of [EXPERT, NOVICE]) {
        const p = { ...BIKE, drag: 0, rolling: 0, rollDamping: 0 },
          bike = new Bike(assists, p),
          lean = 0.4,
          reaction = G * support,
          lateral = reaction * Math.tan(lean);
        bike.speed = 30;
        bike.lean = lean;
        bike.enableMotoGPPhysics(geometry);
        bike.contactLoads = {
          front: (bike.mass * reaction * p.cgToRear) / p.wheelbase,
          rear: (bike.mass * reaction * p.cgToFront) / p.wheelbase,
        };
        const gp = bike.motoGP!;
        // No wheel-spin or yaw gyroscopic moment in this isolated balance.
        gp.frontOmega = gp.rearOmega = 0;
        gp.frontFy = (bike.mass * lateral * p.cgToRear) / p.wheelbase;
        gp.rearFy = (bike.mass * lateral * p.cgToFront) / p.wheelbase;
        gp.lateralAcceleration = lateral;
        const force = vi.spyOn(gp, 'step').mockImplementation(() => gp);
        bike.step(
          {
            lean: assists.lean ? lean / bike.leanLimit : 0,
            throttle: 0,
            frontBrake: 0,
            rearBrake: 0,
            rider: 0,
            drive: 0,
          },
          1 / 240,
        );
        expect(bike.state).toBe('riding');
        expect(bike.leanRate).toBeCloseTo(0, 10);
        expect(bike.lean).toBeCloseTo(lean, 10);
        if (assists.lean) {
          expect(gp.leanTarget).toBeCloseTo(lean, 10);
          expect(gp.lateralDemand).toBeCloseTo(lateral, 10);
        }
        force.mockRestore();
      }
    },
  );
});
