import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

function coast(id: string, map = 3, throttle = 0) {
  const track = new Track();
  const bike = new BikeVehicle(
    0,
    'medium',
    { ...DEFAULT_SETUP, engineBrakeMap: map },
    'sport',
    VEHICLES[id],
  );
  bike.place(track, 120);
  bike.dynamics.speed = 40;
  bike.gear = 4;
  bike.autoShift = false;
  bike.input.throttle = throttle;
  bike.rpm =
    ((bike.dynamics.speed / bike.spec.wheelRadius) *
      bike.spec.gearRatios[bike.gear + 1] *
      bike.spec.finalDrive *
      bike.gearing *
      30) /
    Math.PI;
  for (const tire of bike.tires) tire.discTemp = 80;
  for (let i = 0; i < 12; i++) bike.step(DT, track);
  return { bike, track };
}

describe('GP seamless coast engagement', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s carries rear coast torque through both edges of an actual downshift',
    (id) => {
      const { bike, track } = coast(id);
      const d = bike.dynamics;
      let previousAx = d.longitudinal;
      let previousFrontLoad = d.frontLoad;
      let shiftSamples = 0;
      let engagedSamples = 0;
      bike.input.shift = -1;
      for (let i = 0; i < 12; i++) {
        const previousSpeed = d.speed;
        bike.step(DT, track);
        expect(bike.gear).toBe(3);
        // The sequential lockout is still active, but the seamless drive
        // connection no longer opens for four 240 Hz samples. The old model
        // jumped from >300 N to zero and back, unloading/reloading the fork.
        if (bike.shiftClock > 0) {
          shiftSamples++;
          bike.shift(-1);
          expect(bike.gear).toBe(3);
        } else engagedSamples++;
        expect(d.engineBrakeForce).toBeGreaterThan(300);
        expect(Math.abs(d.longitudinal - previousAx)).toBeLessThan(0.5);
        expect(Math.abs(d.frontLoad - previousFrontLoad)).toBeLessThan(60);
        expect(d.speed).toBeCloseTo(previousSpeed + d.longitudinal * DT, 10);
        expect(d.engineBrakeForce).toBeCloseTo(d.rearBrakeForce, 10);
        expect(d.state).toBe('riding');
        previousAx = d.longitudinal;
        previousFrontLoad = d.frontLoad;
      }
      expect(shiftSamples).toBeGreaterThan(0);
      expect(engagedSamples).toBeGreaterThan(0);
      // Pumping work still cannot heat the hydraulic rear brake disc.
      expect(bike.tires[2].discTemp).toBeLessThan(80);
    },
  );

  it.each([
    ['gpr1', 1],
    ['gpr2', 1],
    ['gpr1', 0.5],
    ['gpr2', 0.5],
    ['gpr1', 0.3],
    ['gpr2', 0.3],
  ] as const)(
    '%s shares its rear circle during a downshift with pedal, lean and rear grip %s',
    (id, rearGrip) => {
      const { bike, track } = coast(id);
      const d = bike.dynamics;
      // A controlled loaded corner, using the real adapter and solver. The
      // low-grip rear sample is refreshed before each step; production track
      // weather and full corner approaches have their own integration tests.
      d.lean = 0.22;
      d.riderOffset = 0.1;
      d.steer = Math.atan(
        (d.p.wheelbase * G * (Math.tan(d.lean) + d.riderGain())) /
          (d.speed * d.speed * Math.cos(d.lean)),
      );
      bike.input.steer = 0.25;
      bike.input.brake = 0.3;
      bike.input.clutch = 0.1;
      for (let i = 0; i < 12; i++) {
        if (i === 4) bike.input.shift = -1;
        bike.contacts[2].grip = bike.contacts[3].grip = rearGrip;
        const beforeSpeed = d.speed;
        bike.step(DT, track);
        expect(d.engineBrakeForce).toBeGreaterThan(50);
        expect(d.frontUse).toBeLessThanOrEqual(1);
        expect(d.rearUse).toBeLessThanOrEqual(1);
        expect(d.rearUse).toBeGreaterThan(0.8);
        expect(d.lean).toBeGreaterThan(0.2);
        const pedalForce = d.rearBrakeForce - d.engineBrakeForce;
        expect(pedalForce).toBeGreaterThan(0);
        expect(pedalForce).toBeLessThan(d.p.rearBrake * 0.1);
        expect(d.state).toBe('riding');
        expect(d.speed).toBeCloseTo(beforeSpeed + d.longitudinal * DT, 10);
      }
      expect(bike.gear).toBe(3);
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s respects map off and throttle-on shifts without suppressing positive drive',
    (id) => {
      for (const [map, throttle] of [
        [0, 0],
        [3, 0.3],
      ]) {
        const { bike, track } = coast(id, map, throttle);
        bike.input.shift = -1;
        for (let i = 0; i < 12; i++) {
          bike.step(DT, track);
          expect(bike.gear).toBe(3);
          expect(bike.dynamics.engineBrakeForce).toBe(0);
          if (throttle > 0) expect(bike.dynamics.driveForce).toBeGreaterThan(300);
          expect(bike.dynamics.state).toBe('riding');
        }
      }
    },
  );

  it.each(['sbk1000', 'ss600', 'nr900', 'cr750'])(
    '%s retains its interrupted coast/shift behavior',
    (id) => {
      const { bike, track } = coast(id);
      const enabled = bike.engineBrake > 0;
      if (enabled) expect(bike.dynamics.engineBrakeForce).toBeGreaterThan(0);
      else expect(bike.dynamics.engineBrakeForce).toBe(0);
      bike.input.shift = -1;
      let interrupted = 0;
      let engaged = 0;
      for (let i = 0; i < 32; i++) {
        bike.step(DT, track);
        expect(bike.gear).toBe(3);
        if (bike.shiftClock > 0) {
          interrupted++;
          expect(bike.dynamics.engineBrakeForce).toBe(0);
        } else {
          engaged++;
          if (enabled) expect(bike.dynamics.engineBrakeForce).toBeGreaterThan(0);
          else expect(bike.dynamics.engineBrakeForce).toBe(0);
        }
      }
      expect(interrupted).toBeGreaterThan(0);
      expect(engaged).toBeGreaterThan(0);
    },
  );
});
