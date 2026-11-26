import { describe, expect, it } from 'vitest';
import { observePlayerStepIntervals } from '../scripts/bench/motocross-player-dynamics.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MOTORCYCLE_THERMAL } from '../src/simulation/motorcycle-thermal.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

class Plane extends DynamicsTrack {
  override readonly circuit = circuitDefinition('valley-ridge-mx');
}

type Internals = {
  airTorque: number;
  automaticBody: number;
  riderAirRate: number;
  flightSpeed: number;
  mxReferenceSpeed: number;
  writeBody(track: DynamicsTrack, dt: number): void;
};

/** An isolated freely rotating front wheel. Initial state is prescribed,
 * while the public production step owns controls, rotors and every thermal
 * update. The plane is an in-memory fixture, never authored venue data. */
function freeWheel(definition: VehicleDefinition, omega: number, inertia: number) {
  const track = new Plane(),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    model = bike as unknown as Internals;
  bike.placeFree(track, 0, 0, 0, 0);
  bike.step(1 / 240, track);
  bike.autoShift = false;
  bike.gear = 3;
  bike.cgY = 10;
  bike.pitch = bike.pitchRate = bike.vy = 0;
  bike.forceFront = bike.forceRear = 0;
  bike.airborne = true;
  bike.airTime = 0.2;
  model.flightSpeed = bike.dynamics.speed = 8;
  bike.frontSpin = omega;
  bike.rearSpin = 0;
  bike.tires[0].inertia = bike.tires[1].inertia = inertia;
  Object.assign(bike.input, controls(), { brake: 1 });
  model.writeBody(track, 0);
  return { bike, track, model };
}

/** Disc energy plus its implicit boundary flux reconstructs actual heat
 * supplied by the rotor. It does not read the adapter's brake-power output. */
function rotorHeat(
  bike: DirtBikeVehicle,
  track: Pick<DynamicsTrack, 'ambient'>,
  before: number,
  dt: number,
) {
  const wheel = bike.tires[0],
    p = MOTORCYCLE_THERMAL.front,
    air =
      (p.brake.airBase + p.brake.airSpeed * Math.hypot(bike.dynamics.speed, bike.slide)) *
      (wheel.discTemp - track.ambient),
    core = p.tyre.discToCore * (wheel.discTemp - wheel.coreTemp);
  return p.brake.capacity * (wheel.discTemp - before) + (air + core) * dt;
}

describe('ridden motocross front rotor energy across physical phases', () => {
  it.each([MX_250, MX_450])(
    '$id uses the same angular inertia for ground impulse and free brake reaction',
    (definition) => {
      for (const inertia of [0.6, 0.83]) {
        const track = new Plane(),
          bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
          model = bike as unknown as Internals;
        bike.placeFree(track, 0, 0, 0, 0);
        bike.step(1 / 240, track);
        bike.autoShift = false;
        bike.gear = 3;
        bike.tires[0].inertia = bike.tires[1].inertia = inertia;
        model.mxReferenceSpeed = bike.dynamics.speed = 12;
        bike.frontSpin = 8;
        bike.rearSpin = 12 / bike.bikeSpec.rearWheelRadius;
        Object.assign(bike.input, controls());
        const before = bike.frontSpin,
          dt = 1 / 10000;
        bike.step(dt, track);
        const groundImpulse = -bike.tires[0].fx * bike.tires[0].radius * dt,
          groundDelta = bike.frontSpin - before;
        expect(bike.forceFront).toBeGreaterThan(0);
        expect(groundDelta).toBeGreaterThan(0);
        expect(Math.abs(inertia * groundDelta - groundImpulse)).toBeLessThan(1e-11);

        const free = freeWheel(definition, bike.frontSpin, inertia),
          front = free.bike.frontSpin,
          rear = free.bike.rearSpin,
          pitchRate = free.bike.pitchRate;
        expect(Math.abs(free.model.riderAirRate)).toBe(0);
        free.bike.step(dt, free.track);
        expect(free.bike.airborne).toBe(true);
        const coast = front * Math.exp(-0.4 * dt),
          frontDelta = free.bike.frontSpin - coast,
          // Rear rotor and prescribed body action are separate known ports.
          measuredFrontImpulse =
            (free.model.airTorque + free.model.automaticBody * free.bike.air.bodyTorque) * dt -
            free.bike.air.spinInertia * (free.bike.rearSpin - rear);
        expect(frontDelta).toBeLessThan(0);
        expect(Math.abs(measuredFrontImpulse - inertia * frontDelta)).toBeLessThan(1e-11);
        expect(measuredFrontImpulse / frontDelta).toBeCloseTo(groundImpulse / groundDelta, 10);
        // Independently observe the chassis response rather than accepting
        // the published torque port alone. Undo the existing free pitch
        // damping, then account for the known rear rotor and body action.
        expect(Math.abs(free.model.riderAirRate)).toBe(0);
        const decay = Math.exp(-(0.3 + 0.5 * free.bike.standing) * dt),
          actualFrontImpulse =
            free.bike.air.pitchInertia * (free.bike.pitchRate / decay - pitchRate) +
            free.model.automaticBody * free.bike.air.bodyTorque * dt -
            free.bike.air.spinInertia * (free.bike.rearSpin - rear);
        expect(Math.abs(actualFrontImpulse - inertia * frontDelta)).toBeLessThan(1e-11);
      }
    },
  );

  it.each(
    [MX_250, MX_450].flatMap((definition) => [120, 240, 480].map((hz) => ({ definition, hz }))),
  )(
    '$definition.id at $hz Hz cannot brake more energy out of its front wheel than the grounded rotor stores',
    ({ definition, hz }) => {
      for (const initial of [0.2, 30, 65]) {
        const inertia = 0.6,
          { bike, track } = freeWheel(definition, initial, inertia),
          startingEnergy = 0.5 * inertia * initial * initial;
        let heat = 0,
          bearing = 0,
          intervals = 0;
        for (let tick = 0; tick < hz && bike.frontSpin > 0; tick++) {
          observePlayerStepIntervals(bike, track, 1 / hz, ({ before, dt }) => {
            expect(before.airborne && bike.airborne && before.riding && bike.riding).toBe(true);
            expect(bike.landings).toBe(0);
            expect(bike.forceFront).toBe(0);
            const coast = before.frontSpin * Math.exp(-0.4 * dt),
              loss = 0.5 * inertia * (before.frontSpin ** 2 - coast ** 2),
              source = rotorHeat(bike, track, before.discs[0], dt),
              brakeWork = 0.5 * inertia * (coast ** 2 - bike.frontSpin ** 2);
            expect(source).toBeGreaterThanOrEqual(-1e-7);
            expect(Math.abs(source - brakeWork)).toBeLessThan(1e-7);
            heat += source;
            bearing += loss;
            intervals++;
          });
        }
        expect(intervals).toBeGreaterThan(0);
        expect(bike.frontSpin).toBe(0);
        const finalEnergy = 0.5 * inertia * bike.frontSpin ** 2;
        expect(Math.abs(finalEnergy + bearing + heat - startingEnergy)).toBeLessThan(1e-7);
        expect(heat).toBeLessThanOrEqual(startingEnergy + 1e-7);
        expect(bike.tires[0].discTemp).toBe(bike.tires[1].discTemp);
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id carries a real front-brake tap through takeoff, first contact and pickup',
    (definition) => {
      const track = rigTrack('arena-nord-sx'),
        jump = offroadCourse(track.circuit)!.jumps.find((item) => item.name === 'TABLETOP')!,
        bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
        dt = 1 / 240,
        speed = 13;
      bike.place(track, jump.start - 12);
      bike.dynamics.speed = speed;
      bike.gear = 3;
      let departed = false,
        touched = false,
        airBrakes = 0,
        pickups = 0;
      for (let tick = 0; tick < 7 / dt && bike.riding; tick++) {
        if (bike.airborne)
          Object.assign(bike.input, controls(), {
            brake: bike.airTime > 0.15 && bike.airTime < 0.19 ? 0.25 : 0,
          });
        else
          rideLine(
            bike,
            track,
            bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
              ? Math.max(speed, bike.dynamics.speed)
              : speed,
          );
        observePlayerStepIntervals(bike, track, dt, ({ before, contacts, dt: h }) => {
          if (!before.airborne && bike.airborne) {
            departed = true;
            // No phase-entry reset adds spin when the front wheel is free.
            if (before.frontLoad === 0) expect(bike.frontSpin).toBe(before.frontSpin);
          }
          if (contacts.length) {
            touched = true;
            // First contact changes the contact law, not the rotor's state.
            for (const event of contacts) expect(event.frontSpin).toBe(bike.frontSpin);
          }
          if (before.airborne && bike.airborne && bike.brake > 0) {
            const coast = before.frontSpin * Math.exp(-0.4 * h),
              work = 0.5 * bike.tires[0].inertia * (coast ** 2 - bike.frontSpin ** 2),
              heat = rotorHeat(bike, track, before.discs[0], h);
            expect(Math.abs(heat - work)).toBeLessThan(1e-7);
            airBrakes++;
          }
          if (
            touched &&
            !before.airborne &&
            before.frontLoad > 0 &&
            bike.brake === 0 &&
            Math.abs(bike.frontSpin - before.frontSpin) > 1e-5
          ) {
            const impulse = -bike.tires[0].fx * bike.tires[0].radius * h;
            expect(
              Math.abs(bike.tires[0].inertia * (bike.frontSpin - before.frontSpin) - impulse),
            ).toBeLessThan(1e-9);
            pickups++;
          }
        });
        if (touched && pickups >= 10) break;
      }
      expect(departed && touched && bike.riding).toBe(true);
      expect(airBrakes).toBeGreaterThan(5);
      expect(pickups).toBeGreaterThan(0);
      expect(bike.dynamics.crashes).toBe(0);
    },
  );
});
