import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { B, BIKE_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;

function flatBike(definition: VehicleDefinition, raw = false) {
  const track = rigTrack('valley-ridge-mx'),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, raw ? 'raw' : 'sport', definition);
  bike.place(track, 35);
  return { bike, track };
}

describe('motocross suspension contact traction', () => {
  it.each([MX_250, MX_450])(
    '$id starts and replaces the machine on loaded static sag',
    (definition) => {
      const { bike, track } = flatBike(definition);
      const assertSag = () => {
        expect(bike.forceFront + bike.forceRear).toBeCloseTo(bike.dynamics.mass * G, 9);
        expect(bike.forceFront).toBeGreaterThan(0);
        expect(bike.forceRear).toBeGreaterThan(0);
        expect(bike.tires[0].load).toBe(bike.forceFront);
        expect(bike.tires[2].load).toBe(bike.forceRear);
        expect(bike.compressionFront).toBeGreaterThan(0);
        expect(bike.compressionRear).toBeGreaterThan(0);
      };
      assertSag();
      bike.input.throttle = 1;
      bike.step(DT, track);
      expect(bike.dynamics.driveForce).toBeGreaterThan(100);
      bike.place(track, 35);
      assertSag();
    },
  );

  it.each([MX_250, MX_450])(
    '$id lets Sport trim the rear without pulling the front lever or its full fork dive',
    (definition) => {
      const stop = (pedal: 'coast' | 'front' | 'rear') => {
        const { bike, track } = flatBike(definition);
        for (let n = 0; n < 480; n++) bike.step(DT, track);
        bike.dynamics.speed = 15;
        bike.gear = 3;
        bike.input.brake = pedal === 'front' ? 0.5 : 0;
        bike.input.clutch = pedal === 'rear' ? 0.5 : 0;
        let peakFront = 0,
          peakRear = 0;
        for (let n = 0; n < 84; n++) {
          bike.step(DT, track);
          peakFront = Math.max(peakFront, bike.dynamics.frontBrakeForce);
          peakRear = Math.max(peakRear, bike.dynamics.rearBrakeForce);
        }
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.dynamics.crashes).toBe(0);
        return { bike, peakFront, peakRear };
      };
      const coast = stop('coast'),
        front = stop('front'),
        rear = stop('rear');
      expect(rear.peakFront).toBe(0);
      expect(rear.peakRear).toBeGreaterThan(300);
      expect(rear.bike.dynamics.speed).toBeLessThan(coast.bike.dynamics.speed - 0.5);
      expect(front.peakFront).toBeGreaterThan(700);
      expect(front.peakRear).toBeGreaterThan(0);
      expect(front.bike.dynamics.speed).toBeLessThan(rear.bike.dynamics.speed - 0.5);
      expect(front.bike.fork).toBeGreaterThan(rear.bike.fork + 0.01);
    },
  );

  it.each([MX_250, MX_450])(
    '$id can cover a real wheelie with the rear pedal while its lifted front cannot brake the ground',
    (definition) => {
      const sample = (pedal: 'coast' | 'front' | 'rear') => {
        const { bike, track } = flatBike(definition, true);
        bike.input.throttle = 1;
        // The production springs lift the front under acceleration. Only
        // controls have been written; no wheel load or pitch is fabricated.
        for (let n = 0; n < 84; n++) bike.step(DT, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.forceFront).toBe(0);
        expect(bike.forceRear).toBeGreaterThan(0);
        expect(bike.pitch).toBeGreaterThan(0.1);
        Object.assign(bike.input, controls());
        bike.input.brake = Number(pedal === 'front');
        bike.input.clutch = Number(pedal === 'rear');
        bike.step(DT, track);
        expect(bike.dynamics.crashes).toBe(0);
        return bike;
      };
      const coast = sample('coast'),
        front = sample('front'),
        rear = sample('rear');
      expect(front.dynamics.frontBrakeForce).toBe(0);
      expect(front.dynamics.speed).toBe(coast.dynamics.speed);
      expect(front.dynamics.x).toBe(coast.dynamics.x);
      expect(front.dynamics.z).toBe(coast.dynamics.z);
      expect(rear.dynamics.frontBrakeForce).toBe(0);
      expect(rear.dynamics.rearBrakeForce).toBeGreaterThan(300);
      expect(rear.dynamics.speed).toBeLessThan(coast.dynamics.speed);
      expect(rear.pitchRate).toBeLessThan(coast.pitchRate);
    },
  );

  it('makes a real forward body stroke support front-brake grip before the fork settles', () => {
    const sample = (lean: number) => {
      const { bike, track } = flatBike(MX_450, true);
      bike.input.riderLean = lean;
      for (let n = 0; n < 480; n++) bike.step(DT, track);
      const supported = bike.forceFront;
      bike.dynamics.speed = 15;
      bike.gear = 3;
      bike.input.brake = 1;
      bike.step(DT, track);
      expect(bike.dynamics.frontBrakeForce).toBeLessThanOrEqual(
        supported * bike.dynamics.p.mu * bike.dynamics.grip + 1e-8,
      );
      return bike.dynamics.frontBrakeForce;
    };
    const back = sample(-1),
      neutral = sample(0),
      forward = sample(1);
    expect(forward).toBeGreaterThan(neutral + 100);
    expect(neutral).toBeGreaterThan(back + 100);
  });

  it.each([MX_250, MX_450])(
    '$id unloads drive over real braking bumps and lands the surveyed table without phantom traction',
    (definition) => {
      const sim = new Simulation({
          ...DEFAULT_OPTIONS,
          mode: 'race',
          circuit: 'valley-ridge-mx',
          ruleset: 'motocross-moto',
          opponents: 0,
          vehicles: [definition.id],
        }),
        track = sim.track,
        jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
        speed = jumpHoldSpeed(jump),
        bike = sim.cars[0] as DirtBikeVehicle;
      bike.place(track, jump.start - 12);
      bike.dynamics.speed = speed;
      bike.gear = 3;
      let frontFree = 0,
        rearFreeWithThrottle = 0,
        frontFreeFrames = 0,
        rearFreeFrames = 0,
        realLanding = false;
      for (let n = 0; n < 6 / DT; n++) {
        if (!bike.airborne)
          rideLine(
            bike,
            track,
            bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
              ? Math.max(speed, bike.dynamics.speed)
              : speed,
          );
        const wasGrounded = !bike.airborne,
          frontLoad = bike.forceFront,
          rearLoad = bike.forceRear;
        bike.step(DT, track);
        if (wasGrounded) {
          const mu = bike.dynamics.p.mu * bike.dynamics.grip;
          expect(bike.dynamics.frontBrakeForce).toBeLessThanOrEqual(mu * frontLoad + 1e-8);
          expect(
            Math.abs(bike.dynamics.driveForce - bike.dynamics.rearBrakeForce),
          ).toBeLessThanOrEqual(mu * rearLoad + 1e-8);
          if (frontLoad === 0) {
            frontFree++;
            expect(bike.dynamics.frontBrakeForce).toBe(0);
          }
          if (rearLoad === 0 && bike.input.throttle > 0.15) {
            rearFreeWithThrottle++;
            expect(bike.dynamics.driveForce).toBe(0);
            expect(bike.dynamics.rearBrakeForce).toBe(0);
            expect(bike.dynamics.rearSlip).toBe(0);
          }
        }
        if (!bike.airborne && (bike.forceFront === 0 || bike.forceRear === 0)) {
          const frame = sim.makeFrame(),
            block = carBase(0) + BIKE_BASE,
            frontWheel = carBase(0) + WHEEL_BASE,
            rearWheel = frontWheel + 2 * WHEEL_STRIDE;
          // These are complete production snapshots of the real spring
          // trajectory; the bike readout and wheel/roost channels agree.
          expect(frame[block + B.FRONT_LOAD]).toBe(frame[frontWheel + W.LOAD]);
          expect(frame[block + B.REAR_LOAD]).toBe(frame[rearWheel + W.LOAD]);
          expect(frame[block + B.FRONT_LOAD]).toBe(Math.fround(bike.forceFront));
          expect(frame[block + B.REAR_LOAD]).toBe(Math.fround(bike.forceRear));
          frontFreeFrames += Number(bike.forceFront === 0);
          rearFreeFrames += Number(bike.forceRear === 0);
        }
        realLanding ||= (bike.lastLanding?.airTime ?? 0) > 0.8;
        expect(Number.isFinite(bike.body.position.y + bike.pitchRate + bike.dynamics.speed)).toBe(
          true,
        );
        expect(bike.dynamics.crashes).toBe(0);
      }
      expect(frontFree).toBeGreaterThan(5);
      expect(rearFreeWithThrottle).toBeGreaterThan(0);
      expect(frontFreeFrames).toBeGreaterThan(0);
      expect(rearFreeFrames).toBeGreaterThan(0);
      expect(realLanding).toBe(true);
      expect(bike.riding).toBe(true);
    },
  );

  it('preserves the surveyed AI and supermoto force solver through the same adapter', () => {
    for (const definition of [MX_450, SM_450]) {
      const sample = (reference: boolean) => {
        const { bike, track } = flatBike(
          reference ? { ...definition, id: 'original-force-control' } : definition,
        );
        if (definition === MX_450) bike.aiControlled(1e6);
        bike.dynamics.speed = 12;
        bike.gear = 3;
        bike.input.clutch = 0.4;
        for (let n = 0; n < 84; n++) bike.step(DT, track);
        return {
          speed: bike.dynamics.speed,
          pitch: bike.pitch,
          front: bike.dynamics.frontBrakeForce,
          rear: bike.dynamics.rearBrakeForce,
          x: bike.dynamics.x,
          z: bike.dynamics.z,
        };
      };
      const baseline = sample(true),
        actual = sample(false);
      expect(actual).toEqual(baseline);
      expect(actual.front).toBeGreaterThan(0);
    }
  });
});
