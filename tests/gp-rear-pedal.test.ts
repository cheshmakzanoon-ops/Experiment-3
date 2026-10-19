import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { Bike, NOVICE } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

function braking(id: string, front: number, rear: number, assist: Assist = 'sport', map = 0) {
  const track = new Track();
  const bike = new BikeVehicle(
    0,
    'medium',
    { ...DEFAULT_SETUP, engineBrakeMap: map },
    assist,
    VEHICLES[id],
  );
  bike.place(track, 120);
  bike.dynamics.speed = 35;
  bike.gear = 3;
  bike.rpm = 12000;
  bike.autoShift = false;
  bike.input.brake = front;
  bike.input.clutch = rear;
  for (const tire of bike.tires) tire.discTemp = 80;
  return { track, bike };
}

describe('GP rear pedal acts independently of the front lever', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s rear-only Sport braking keeps the front hydraulics and disc released',
    (id) => {
      const { bike, track } = braking(id, 0, 0.5);
      for (let i = 0; i < 24; i++) {
        const before = bike.dynamics.speed;
        bike.step(DT, track);
        const d = bike.dynamics;
        expect(d.frontBrakeForce).toBe(0);
        expect(d.rearBrakeForce).toBeGreaterThan(300);
        expect(d.engineBrakeForce).toBe(0);
        expect(d.frontUse).toBeLessThanOrEqual(1);
        expect(d.rearUse).toBeLessThanOrEqual(1);
        expect(d.state).toBe('riding');
        expect(d.speed).toBeCloseTo(before + d.longitudinal * DT, 10);
        expect(Math.abs(bike.tires[0].fx)).toBe(0);
        expect(bike.tires[2].fx).toBe(-d.rearBrakeForce);
      }
      expect(bike.brake).toBe(0);
      expect(bike.rearBrake).toBe(0.5);
      expect(bike.speed).toBeLessThan(35);
      expect(bike.tires[0].discTemp).toBeLessThan(80);
      expect(bike.tires[2].discTemp).toBeGreaterThan(80);
      expect(bike.tires[0].discTemp).toBe(bike.tires[1].discTemp);
      expect(bike.tires[2].discTemp).toBe(bike.tires[3].discTemp);
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s retains front-lever brake assistance while a stronger rear pedal cannot pull the lever',
    (id) => {
      const frontOnly = braking(id, 0.12, 0);
      const rearAdded = braking(id, 0.12, 0.5);
      for (let i = 0; i < 24; i++) {
        frontOnly.bike.step(DT, frontOnly.track);
        rearAdded.bike.step(DT, rearAdded.track);
        // The existing Sport front lever retains its 78%/30% proportioning.
        // Rear pressure may change load transfer and ABS, but never create
        // front pressure above what that held lever actually requested.
        expect(rearAdded.bike.dynamics.frontBrakeForce).toBeLessThanOrEqual(
          rearAdded.bike.dynamics.p.frontBrake * 0.12 * 0.78,
        );
        expect(rearAdded.bike.dynamics.rearBrakeForce).toBeGreaterThan(
          frontOnly.bike.dynamics.rearBrakeForce,
        );
        expect(rearAdded.bike.dynamics.state).toBe('riding');
      }
      expect(frontOnly.bike.dynamics.frontBrakeForce).toBeGreaterThan(500);
      expect(frontOnly.bike.dynamics.rearBrakeForce).toBeGreaterThan(0);
      expect(rearAdded.bike.speed).toBeLessThan(frontOnly.bike.speed);
      expect(frontOnly.bike.tires[0].discTemp).toBeGreaterThan(80);
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s preserves the exact original front-led Sport trajectory and combined brake response',
    (id) => {
      const { bike } = braking(id, 0, 0);
      const independent = new Bike(NOVICE, bike.dynamics.p);
      const original = new Bike(NOVICE, { ...independent.p, independentRearBrake: false });
      independent.speed = original.speed = 35;
      for (let i = 0; i < 720; i++) {
        const t = i * DT;
        const front = t < 1 ? 0 : 0.35;
        const input = {
          lean: 0.35 * Math.sin(t),
          rider: 0.4 * Math.sin(t),
          throttle: t < 1 ? 0.2 : 0,
          drive: t < 1 ? 900 : 0,
          frontBrake: front,
          rearBrake: i % 80 < 40 ? 0 : front,
          engineBrake: t < 1 ? 0 : 220,
        };
        independent.step(input, DT);
        original.step(input, DT);
        if (i % 30 === 0)
          expect({ ...independent, p: undefined }).toEqual({ ...original, p: undefined });
      }
      expect(independent.state).toBe('riding');
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s shares the rear-pedal and engine-braking budget through reduced-grip trail braking',
    (id) => {
      for (const dt of [1 / 120, DT]) {
        for (const [frontGrip, rearGrip] of [
          [1, 0.35],
          [0.35, 1],
          [0.4, 0.4],
        ]) {
          const { bike, track } = braking(id, 0.08, 0.7, 'sport', 3);
          const d = bike.dynamics;
          d.lean = 0.18;
          d.riderOffset = 0.08;
          d.steer = Math.atan(
            (d.p.wheelbase * G * (Math.tan(d.lean) + d.riderGain())) /
              (d.speed ** 2 * Math.cos(d.lean)),
          );
          // Hold a cornering demand on the reduced-grip lean range; a
          // quarter-stick request would instead stand the bike up here.
          bike.input.steer = 0.5;
          for (let i = 0; i < 0.2 / dt; i++) {
            bike.contacts[0].grip = bike.contacts[1].grip = frontGrip;
            bike.contacts[2].grip = bike.contacts[3].grip = rearGrip;
            bike.step(dt, track);
            expect(d.state).toBe('riding');
            expect(d.frontUse).toBeLessThanOrEqual(1);
            expect(d.rearUse).toBeLessThanOrEqual(1);
            expect(d.rearSlip).toBe(0);
            expect(d.frontBrakeForce).toBeLessThanOrEqual(d.p.frontBrake * 0.08 * 0.78);
            expect(d.engineBrakeForce).toBeGreaterThan(50);
            expect(d.rearBrakeForce).toBeGreaterThan(d.engineBrakeForce);
          }
          expect(d.speed).toBeLessThan(34.5);
          expect(d.lean).toBeGreaterThan(0.15);
          expect(Math.abs(bike.tires[2].fy)).toBeGreaterThan(250);
        }
      }
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s keeps rear-only input separate during AI handover and after returning to Raw',
    (id) => {
      const { bike, track } = braking(id, 0, 1, 'raw');
      bike.aiControlled(2);
      for (let i = 0; i < 3; i++) {
        bike.contacts[2].grip = bike.contacts[3].grip = 0.35;
        bike.step(DT, track);
        expect(bike.dynamics.frontBrakeForce).toBe(0);
        expect(bike.dynamics.assists.abs).toBe(i < 2);
        expect(bike.dynamics.assists.traction).toBe(i < 2);
        expect(bike.dynamics.rearBrakeForce).toBeGreaterThan(0);
        if (i < 2) expect(bike.dynamics.rearSlip).toBe(0);
      }
      expect(bike.dynamics.rearSlip).toBeGreaterThan(0);
      expect(bike.dynamics.frontBrakeForce).toBe(0);
    },
  );

  it.each(['sbk1000', 'ss600', 'nr900', 'cr750', 'mx450'])(
    '%s retains its original linked Sport brakes and independent Raw brakes',
    (id) => {
      for (const assist of ['sport', 'raw'] as const) {
        const { bike, track } = braking(id, 0, 0.4, assist);
        bike.step(DT, track);
        expect(bike.dynamics.p.independentRearBrake).toBeUndefined();
        if (assist === 'sport') expect(bike.dynamics.frontBrakeForce).toBeGreaterThan(0);
        else expect(bike.dynamics.frontBrakeForce).toBe(0);
      }
    },
  );
});
