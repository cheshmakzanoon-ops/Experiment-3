import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MAX_SUBSTEP, Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const track = new DynamicsTrack();
const hf86 = VEHICLES.hf86;
const fwd = { ...hf86, drivetrain: 'fwd' as const };
const awd = { ...hf86, drivetrain: 'awd' as const };

describe.each([1 / 240, 1 / 120])(
  'one coupled solve after shift-cut grip recovery, dt=%s',
  (DT) => {
    /** Controller boundary fixture: previous cut solve had recovered longitudinal
     * grip, while the crankshaft still carried the prior gear's engine speed. */
    function cutExit(definition: VehicleDefinition = hf86) {
      const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
      car.place(track, 0);
      car.gear = 2;
      car.input.throttle = 1;
      car.shiftClock = DT / 2;
      car.clutch.engagement = 0;
      car.clutch.engineOmega = (11830 * Math.PI) / 30;
      const omega = (7882 * Math.PI) / (30 * car.spec.gearRatios[3] * car.spec.finalDrive);
      car.body.velocity.set(0, 0, omega * car.spec.wheelRadius);
      for (const tire of car.tires) {
        tire.omega = omega;
        tire.load = 2500;
        tire.slip = 0;
      }
      return car;
    }

    it.each([hf86, fwd, awd])(
      'allows the real clutch to recouple before reversing the shift on $drivetrain',
      (definition) => {
        const car = cutExit(definition);
        car.step(DT, track);
        expect(car.gear).toBe(2);
        expect(car.shiftClock).toBe(0);
        expect(car.clutch.engagement).toBeGreaterThan(0);
        expect(car.clutch.transmittedTorque).toBeGreaterThan(0);
      },
    );
    it.each([hf86, fwd, awd])(
      'retains the old downshift when a driven wheel is still beyond its force peak on $drivetrain',
      (definition) => {
        const car = cutExit(definition);
        const tire = car.tires[definition.drivetrain === 'rwd' ? 3 : 0];
        tire.slip = 2 * tire.peakSlip;
        car.step(DT, track);
        expect(car.gear).toBe(1);
      },
    );
    it.each([hf86, fwd, awd])(
      'retains the old downshift with one unsupported driven contact on $drivetrain',
      (definition) => {
        const car = cutExit(definition);
        car.tires[definition.drivetrain === 'rwd' ? 3 : 0].load = 0;
        car.step(DT, track);
        expect(car.gear).toBe(1);
      },
    );
    it('does not defer outside the cut-exit boundary', () => {
      const car = cutExit();
      car.shiftClock = 0;
      car.step(DT, track);
      expect(car.gear).toBe(1);
    });
    it('does not shorten an unfinished shift or its torque cut', () => {
      const car = cutExit();
      car.shiftClock = 2 * DT;
      car.step(DT, track);
      expect(car.gear).toBe(2);
      let expectedClock = 2 * DT;
      for (let i = 0; i < DT / MAX_SUBSTEP; i++) expectedClock -= MAX_SUBSTEP;
      expect(car.shiftClock).toBe(expectedClock);
      expect(car.clutch.engagement).toBe(0);
    });
    it('does not defer when the actual crankshaft is already below the existing floor', () => {
      const car = cutExit();
      car.clutch.engineOmega = ((car.spec.downshiftRPM - 1) * Math.PI) / 30;
      car.step(DT, track);
      expect(car.gear).toBe(1);
    });
    it.each(['lift', 'brake'] as const)('retains ordinary %s downshifts', (action) => {
      const car = cutExit();
      if (action === 'lift') car.input.throttle = 0;
      else car.input.brake = 0.5;
      car.step(DT, track);
      expect(car.gear).toBe(1);
    });
    it('has no additional timer or latched downshift veto on the following solve', () => {
      const car = cutExit();
      car.step(DT, track);
      expect(car.gear).toBe(2);
      expect(car.shiftClock).toBe(0);
      // A subsequent genuinely low-speed sample must use the ordinary rule.
      for (const tire of car.tires) tire.omega *= 0.5;
      car.step(DT, track);
      expect(car.gear).toBe(1);
    });
    it('never applies the recovery rule to manual gear requests', () => {
      const car = cutExit();
      car.shiftClock = 0;
      car.input.shift = -1;
      car.step(DT, track);
      expect(car.gear).toBe(1);
      expect(car.autoShift).toBe(false);
    });
    it('does not infer a cut from a seamless gearbox', () => {
      const car = cutExit({ ...hf86, dynamics: { gearbox: { shiftTime: 0.09, shiftCut: 0 } } });
      car.step(DT, track);
      expect(car.gear).toBe(1);
    });
    it('does not veto the original upshift at a shift-clock boundary', () => {
      const car = cutExit();
      car.gear = 1;
      const omega =
        ((car.spec.shiftRPM + 1) * Math.PI) / (30 * car.spec.gearRatios[2] * car.spec.finalDrive);
      for (const tire of car.tires) tire.omega = omega;
      car.step(DT, track);
      expect(car.gear).toBe(2);
      let expectedClock = car.physics.gearbox.shiftTime;
      // The upshift occurs in the first internal solve; any second solve decrements it.
      for (let i = 1; i < DT / MAX_SUBSTEP; i++) expectedClock -= MAX_SUBSTEP;
      expect(car.shiftClock).toBe(expectedClock);
    });
  },
);
