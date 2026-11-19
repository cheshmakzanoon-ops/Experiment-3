import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G } from '../src/core/math.ts';
import { SBK_1000, SS_600 } from '../src/simulation/bike-definitions.ts';
import { BIKE, Bike, EXPERT } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { COMPOUNDS, DEFAULT_SETUP } from '../src/simulation/config.ts';

const DT = 1 / 120;

describe('road-bike assisted contact reserves', () => {
  it.each([0.02, 0.1, 0.4, 1])(
    'balances a leaned bike at %s of static support without a fictitious crest torque',
    (support) => {
      const p = { ...BIKE, drag: 0, rollDamping: 0 },
        bike = new Bike(EXPERT, p),
        speed = 30,
        lean = 0.6,
        reaction = G * support,
        // A banked contact with Fy/N = tan(phi) produces no roll moment
        // about the CG, at full weight or any partial crest support.
        lateral = reaction * Math.tan(lean),
        steer = Math.atan((lateral * p.wheelbase) / (speed * speed * Math.cos(lean))),
        usable = Math.atan((p.wheelbase * 1.4 * G) / (speed * speed));
      bike.speed = speed;
      bike.lean = lean;
      bike.steer = steer;
      bike.contactLoads = {
        front: (bike.mass * reaction * p.cgToRear) / p.wheelbase,
        rear: (bike.mass * reaction * p.cgToFront) / p.wheelbase,
      };
      bike.step(
        { lean: steer / usable, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 0, drive: 0 },
        DT,
      );
      expect(bike.state).toBe('riding');
      expect(bike.leanRate).toBeCloseTo(0, 10);
      expect(bike.lean).toBeCloseTo(lean, 10);
      expect(bike.speed * bike.speed * bike.curvature).toBeCloseTo(lateral, 10);
    },
  );

  it.each([SBK_1000, SS_600])(
    '$id keeps steering support through a powered turn and hard braking reversal',
    (definition) => {
      const track = new DynamicsTrack(),
        bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
        d = bike.dynamics;
      bike.placeFree(track, 0, 0, 0, 0);
      d.speed = 30;
      for (const tyre of bike.tires)
        tyre.carcassTemp = tyre.surfaceTemp = COMPOUNDS[tyre.compound].ideal;
      let brakingSpeed = 0,
        minimumFrontShare = Infinity,
        minimumRearShare = Infinity,
        maximumLean = 0;
      for (let i = 0; i < 6 / DT; i++) {
        const braking = i >= 1.5 / DT;
        bike.input.throttle = braking ? 0 : 1;
        bike.input.brake = braking ? 0.8 : 0;
        bike.input.steer = braking ? 0.8 : -0.8;
        bike.aiControlled();
        bike.step(DT, track);
        if (i === 1.5 / DT) brakingSpeed = d.speed;
        minimumFrontShare = Math.min(minimumFrontShare, d.frontLoad / (d.mass * G));
        minimumRearShare = Math.min(minimumRearShare, d.rearLoad / (d.mass * G));
        maximumLean = Math.max(maximumLean, Math.abs(d.lean));
        expect(bike.riding).toBe(true);
      }
      // The flat road offers continuous support. Spending all of either
      // contact on drive or braking previously made realised curvature zero;
      // the assist then reserved zero lateral force and sustained that loss.
      // The SS600 fell before three seconds despite every assist being on.
      expect(d.crashes).toBe(0);
      expect(minimumFrontShare).toBeGreaterThan(0.15);
      expect(minimumRearShare).toBeGreaterThan(0.15);
      expect(maximumLean).toBeLessThan(0.95);
      expect(d.lean).toBeGreaterThan(0.4);
      expect(d.speed).toBeLessThan(brakingSpeed - 12);
      expect(d.frontBrakeForce + d.rearBrakeForce).toBeGreaterThan(600);
    },
  );
});
