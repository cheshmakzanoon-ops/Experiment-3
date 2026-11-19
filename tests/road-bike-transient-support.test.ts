import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { BIKE, Bike, NOVICE, type BikeInput } from '../src/simulation/bike.ts';
import { SBK_1000 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';

const neutral: BikeInput = {
  lean: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  rider: 0,
  drive: 0,
};
const turning = { ...neutral, lean: 1, rider: 1 };
const admitted = (bike: Bike): number => Reflect.get(bike, 'roadAdmittedCapacity');

function machine() {
  const bike = new Bike(NOVICE, {
    ...BIKE,
    mu: 1.3,
    drag: 0,
    rolling: 0,
    cgHeight: 0.66,
    cgToFront: 0.68,
    cgToRear: 0.75,
    wheelbase: 1.43,
    riderOffsetMax: 0.2,
  });
  bike.speed = 30;
  return bike;
}

function state(bike: Bike) {
  return [
    bike.x,
    bike.z,
    bike.heading,
    bike.speed,
    bike.lean,
    bike.leanRate,
    bike.steer,
    bike.frontLoad,
    bike.rearLoad,
    bike.frontUse,
    bike.rearUse,
    admitted(bike),
  ];
}

describe('road rider admits returning support over its finite response', () => {
  it.each([1 / 240, 1 / 120].flatMap((dt) => [0.1, 0.2, 0.3].map((period) => ({ dt, period }))))(
    'survives repeated $period s contact transients at dt=$dt',
    ({ dt, period }) => {
      const bike = machine(),
        front = bike.frontLoad,
        rear = bike.rearLoad,
        nominal = bike.leanLimit;
      // Arroyo's measured failure mechanism: a brief missing contact followed
      // by a load peak, within the roll tracker's response. This independent
      // periodic fixture removes AI, road geometry and race interactions.
      // The previous instantaneous-admission controller falls in all six
      // cases after 1.61–1.83 s despite respecting the instantaneous circles.
      for (let i = 0; i < 8 / dt; i++) {
        const load = (i * dt) % period < period / 5 ? 0 : 1.5 * front;
        bike.contactLoads = { front: load, rear };
        bike.step(turning, dt);
        expect(bike.state).toBe('riding');
        expect(bike.frontLoad).toBe(load);
        expect(bike.rearLoad).toBe(rear);
        expect(bike.frontUse).toBeLessThanOrEqual(1);
        expect(bike.rearUse).toBeLessThanOrEqual(1);
        expect(bike.leanLimit).toBe(nominal);
        if (load === 0) {
          expect(admitted(bike)).toBe(0);
          expect(bike.curvature).toBe(0);
        }
      }
      // Real steady support restores the same authored target; admission is
      // neither a permanent grip loss nor a new lower full-stick lean limit.
      bike.contactLoads = { front, rear };
      for (let i = 0; i < 4 / dt; i++) bike.step(turning, dt);
      expect(bike.state).toBe('riding');
      expect(bike.lean).toBeCloseTo(nominal, 5);
      expect(Math.abs(bike.leanRate)).toBeLessThan(1e-5);
    },
  );

  it('drops admission immediately, preserves flight, and retains full arrest authority on landing', () => {
    const bike = machine(),
      front = bike.frontLoad,
      rear = bike.rearLoad,
      dt = 1 / 240;
    bike.contactLoads = { front, rear };
    bike.step(neutral, dt);
    const supported = admitted(bike);
    bike.contactLoads = { front: 0.1 * front, rear };
    bike.step(neutral, dt);
    expect(admitted(bike)).toBeCloseTo(0.1 * supported, 12);
    bike.contactLoads = { front: 0, rear: 0 };
    bike.step({ ...turning, throttle: 1, drive: 3000, frontBrake: 1, rearBrake: 1 }, dt);
    expect(admitted(bike)).toBe(0);
    expect(bike.frontLoad + bike.rearLoad).toBe(0);
    expect(bike.driveForce + bike.frontBrakeForce + bike.rearBrakeForce).toBe(0);
    expect(bike.curvature).toBe(0);

    // An existing outward roll needs real force now. The newly admitted
    // capacity must constrain starting a manoeuvre, never its arrest force.
    bike.lean = 0.4;
    bike.leanRate = 0.6;
    bike.contactLoads = { front, rear };
    bike.step(neutral, dt);
    expect(bike.frontLoad).toBe(front);
    expect(bike.rearLoad).toBe(rear);
    expect(admitted(bike)).toBeGreaterThan(0);
    expect(admitted(bike)).toBeLessThan(supported / 10);
    expect(Math.abs(bike.curvature * bike.speed ** 2)).toBeGreaterThan(admitted(bike));
    expect(bike.frontUse).toBeLessThanOrEqual(1);
    expect(bike.rearUse).toBeLessThanOrEqual(1);
  });

  it('reconstructs the same controller history from the same fixed-step contact/input history', () => {
    const first = machine(),
      second = machine(),
      front = first.frontLoad,
      rear = first.rearLoad,
      dt = 1 / 240;
    for (let i = 0; i < 1920; i++) {
      const contact = { front: i % 48 < 10 ? 0 : 1.5 * front, rear },
        input = { ...turning, lean: Math.sin(i / 240), rider: Math.sin(i / 240) };
      first.contactLoads = { ...contact };
      second.contactLoads = { ...contact };
      first.step(input, dt);
      second.step(input, dt);
      expect(state(first)).toEqual(state(second));
      expect(first.state).toBe('riding');
    }
  });

  it.each(['place', 'placeFree'] as const)('clears old admission at explicit %s', (placement) => {
    const track = new DynamicsTrack(),
      used = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', SBK_1000),
      fresh = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', SBK_1000),
      dt = 1 / 240;
    used.dynamics.contactLoads = { front: 0, rear: 0 };
    used.dynamics.step(neutral, dt);
    expect(admitted(used.dynamics)).toBe(0);
    for (const bike of [used, fresh]) {
      if (placement === 'place') bike.place(track, 0);
      else bike.placeFree(track, 0, 0, 0, 0);
    }
    expect(admitted(used.dynamics)).toBe(Infinity);
    used.step(dt, track);
    fresh.step(dt, track);
    expect(state(used.dynamics)).toEqual(state(fresh.dynamics));
  });

  it('clears old admission on remount and when leaving the optional road-contact path', () => {
    const bike = machine(),
      dt = 1 / 240;
    bike.contactLoads = { front: 0, rear: 0 };
    bike.step(neutral, dt);
    bike.state = 'remount';
    bike.stateClock = 1.5;
    bike.speed = 0;
    bike.riderReady = true;
    bike.step(neutral, dt);
    expect(bike.state).toBe('riding');
    expect(admitted(bike)).toBe(Infinity);
    bike.step(neutral, dt);
    expect(admitted(bike)).toBe(0);
    bike.contactLoads = undefined;
    bike.step(neutral, dt);
    expect(admitted(bike)).toBe(Infinity);
  });
});
