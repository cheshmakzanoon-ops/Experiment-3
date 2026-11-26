import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { observePlayerStepIntervals } from '../scripts/bench/motocross-player-dynamics.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { COMPOUNDS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MOTORCYCLE_THERMAL } from '../src/simulation/motorcycle-thermal.ts';
import {
  DirtBikeVehicle,
  type LandingRecord,
} from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { MxMachineMotion } from '../src/simulation/offroad/mx-machine-motion.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import type { Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

/** Analytic level terrain isolates step ownership and work bookkeeping from
 * course sampling. Only the initial chassis state and public controls are
 * prescribed; every observed interval runs the complete production plant. */
class Plane extends DynamicsTrack {
  override readonly circuit = circuitDefinition('valley-ridge-mx');
}

type Internals = {
  stepInterval(dt: number, track: Track, absorb: boolean): void;
  absorbExternal(dt: number): void;
  writeBody(track: Track, dt: number): void;
  judgeLanding(record: LandingRecord): void;
  updateMotorcycleThermals(
    dt: number,
    track: Track,
    supported: boolean,
    frontSlip: number,
    rearSlip: number,
    frontBrake?: number,
    rearBrake?: number,
  ): void;
  aiSteps: number;
  playerMotocross: boolean;
  freeSteps: number;
  flightSpeed: number;
  takeoffSpeed: number;
  mxYawRate: number;
  mxReferenceSpeed: number;
  longitudinal: number;
  mxFrontFx: number;
  mxRearFx: number;
  mxFrontFy: number;
  mxRearFy: number;
  mxFrontSlipPower: number;
  mxRearSlipPower: number;
  mxFrontBrakePower: number | undefined;
  mxRearBrakePower: number | undefined;
  bottomPeak: number;
  pendingLanding: LandingRecord | null;
};

function rig(definition: VehicleDefinition) {
  const track = new Plane(),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.placeFree(track, 0, 0, 0, 0);
  bike.step(1 / 240, track);
  bike.autoShift = false;
  bike.gear = 3;
  return { bike, track, model: bike as unknown as Internals };
}

function flex(motion: MxMachineMotion) {
  return [
    motion.valid,
    motion.chainPull,
    motion.front.position,
    motion.front.rate,
    motion.rear.position,
    motion.rear.rate,
  ];
}

function physicalState(bike: DirtBikeVehicle) {
  const d = bike.dynamics,
    model = bike as unknown as Internals;
  return {
    motion: [
      d.x,
      d.z,
      d.heading,
      d.speed,
      bike.cgY,
      bike.vy,
      bike.pitch,
      bike.pitchRate,
      bike.slide,
      model.mxYawRate,
      model.mxReferenceSpeed,
      bike.frontSpin,
      bike.rearSpin,
    ],
    support: [
      bike.forceFront,
      bike.forceRear,
      bike.compressionFront,
      bike.compressionRear,
      bike.gVert,
      bike.gLat,
      ...bike.tires.map((tire) => tire.load),
    ],
    forceState: [
      model.longitudinal,
      d.longitudinal,
      d.driveForce,
      d.frontBrakeForce,
      d.rearBrakeForce,
      d.engineBrakeForce,
      d.assistedDriveForce,
      model.mxFrontFx,
      model.mxRearFx,
      model.mxFrontFy,
      model.mxRearFy,
      model.mxFrontSlipPower,
      model.mxRearSlipPower,
      model.mxFrontBrakePower,
      model.mxRearBrakePower,
    ],
    reservoirs: bike.tires.flatMap((tire) => [
      tire.surfaceTemp,
      tire.carcassTemp,
      tire.coreTemp,
      tire.discTemp,
      tire.wear,
      tire.pressure,
      tire.omega,
    ]),
    flex: bike.machineMotion ? flex(bike.machineMotion) : [],
    fuel: bike.fuel,
    state: d.state,
  };
}

function observe(bike: DirtBikeVehicle) {
  const model = bike as unknown as Internals,
    run = model.stepInterval.bind(bike);
  const phases: {
    dt: number;
    absorb: boolean;
    beforeAir: boolean;
    airborne: boolean;
    beforeFrontSpin: number;
    frontSpin: number;
    frontBrakePower: number | undefined;
    clock: number;
    aiSteps: number;
    player: boolean;
    freeSteps: number;
    gear: number;
    cut: number;
    torque: number;
    motorJ: number;
    gLong: number;
    input: typeof bike.input;
    state: ReturnType<typeof physicalState>;
    wheel: { fx: number; fy: number; power: number }[];
    bottom: number;
    landing: LandingRecord | null;
  }[] = [];
  const spy = vi.spyOn(model, 'stepInterval').mockImplementation((dt, track, absorb) => {
    const beforeAir = bike.airborne,
      beforeFrontSpin = bike.frontSpin;
    run(dt, track, absorb);
    phases.push({
      dt,
      absorb,
      beforeAir,
      airborne: bike.airborne,
      beforeFrontSpin,
      frontSpin: bike.frontSpin,
      frontBrakePower: model.mxFrontBrakePower,
      clock: bike.clock,
      aiSteps: model.aiSteps,
      player: model.playerMotocross,
      freeSteps: model.freeSteps,
      gear: bike.gear,
      cut: bike.shiftClock,
      torque: bike.engineOutputTorque,
      motorJ: Math.max(0, bike.engineOutputTorque * bike.clutch.engineOmega) * dt,
      gLong: bike.gLong,
      input: { ...bike.input },
      state: physicalState(bike),
      wheel: bike.tires.map((tire) => ({ fx: tire.fx, fy: tire.fy, power: tire.energy })),
      bottom: model.bottomPeak,
      landing: bike.lastLanding ? { ...bike.lastLanding } : null,
    });
  });
  return { phases, restore: () => spy.mockRestore() };
}

/** Independent first-law observer. The production implicit thermal solve
 * uses each interval's final temperatures in its boundary fluxes. Summing
 * those fluxes recovers the source work even when the public endpoint alone
 * cannot reconstruct a varying-temperature, varying-speed interval. */
function observeHeat(bike: DirtBikeVehicle) {
  const model = bike as unknown as Internals,
    advance = model.updateMotorcycleThermals.bind(bike);
  const balances: {
    dt: number;
    source: number[];
    storedAndLost: number[];
    rotorSource: number[];
    rotorStoredAndLost: number[];
    slip: number[];
  }[] = [];
  const spy = vi
    .spyOn(model, 'updateMotorcycleThermals')
    .mockImplementation((dt, track, supported, frontSlip, rearSlip, frontBrake, rearBrake) => {
      const speed = Math.hypot(bike.dynamics.speed, bike.slide),
        total = supported ? bike.tires[0].load + bike.tires[2].load : 0,
        before = [0, 2].map((i) => ({ ...bike.tires[i] })),
        slip = [frontSlip, rearSlip].map((power, end) =>
          supported && before[end].load > 1e-6 ? Math.max(0, power) : 0,
        ),
        brakes = [frontBrake ?? 0, rearBrake ?? 0];
      // These cases select the explicit MX rotor-work ports, never a
      // legacy force-times-speed fallback reconstructed by the observer.
      expect(frontBrake).toBeDefined();
      expect(rearBrake).toBeDefined();
      expect(brakes.every(Number.isFinite)).toBe(true);
      advance(dt, track, supported, frontSlip, rearSlip, frontBrake, rearBrake);
      const source: number[] = [],
        storedAndLost: number[] = [],
        rotorStoredAndLost: number[] = [];
      for (let end = 0; end < 2; end++) {
        const i = 2 * end,
          old = before[end],
          tire = bike.tires[i],
          contact = bike.contacts[i],
          { tyre: p, brake: b } = end ? MOTORCYCLE_THERMAL.rear : MOTORCYCLE_THERMAL.front,
          load = supported ? old.load : 0,
          loaded = load > 1 ? 1 : 0,
          ambient = Number.isFinite(track.ambient) ? track.ambient : contact.temp,
          rolling =
            load > 1e-6 && total > 1e-6 && Math.abs(bike.dynamics.speed) > 0.05
              ? Math.max(0, bike.dynamics.p.rolling ?? 0) *
                bike.dynamics.mass *
                G *
                Math.abs(bike.dynamics.speed) *
                Math.min(1, load / total)
              : 0,
          surfaceCapacity = p.surfaceCapacity * (1 - p.wearCapacityLoss * old.wear),
          stored =
            surfaceCapacity * (tire.surfaceTemp - old.surfaceTemp) +
            p.carcassCapacity * (tire.carcassTemp - old.carcassTemp) +
            p.coreCapacity * (tire.coreTemp - old.coreTemp) +
            b.capacity * (tire.discTemp - old.discTemp),
          losses =
            (p.airBase + p.airSpeed * speed) * (tire.surfaceTemp - ambient) +
            p.trackContact * loaded * (tire.surfaceTemp - contact.temp) +
            Math.max(0, contact.water) *
              (p.waterBase + p.waterSpeed * speed) *
              loaded *
              (tire.surfaceTemp - ambient) +
            (p.sidewallBase + p.sidewallSpeed * speed) * (tire.carcassTemp - ambient) +
            (p.rimBase + p.rimSpeed * speed) * (tire.coreTemp - ambient) +
            (b.airBase + b.airSpeed * speed) * (tire.discTemp - ambient),
          rotorLoss =
            (b.airBase + b.airSpeed * speed) * (tire.discTemp - ambient) +
            p.discToCore * (tire.discTemp - tire.coreTemp);
        source.push((p.slipShare * slip[end] + rolling + brakes[end]) * dt);
        storedAndLost.push(stored + losses * dt);
        rotorStoredAndLost.push(b.capacity * (tire.discTemp - old.discTemp) + rotorLoss * dt);
      }
      balances.push({
        dt,
        source,
        storedAndLost,
        rotorSource: brakes.map((power) => power * dt),
        rotorStoredAndLost,
        slip: slip.map((power) => power * dt),
      });
    });
  return { balances, restore: () => spy.mockRestore() };
}

/** Put both fully extended tyres the same distance above the analytic plane. */
function freePose(bike: DirtBikeVehicle, track: Track, gap: number) {
  const spec = bike.bikeSpec,
    sag = factoryBikeSag(bike.definition),
    frontHeight = spec.cgHeight + sag.fork,
    rearHeight = spec.cgHeight + sag.shock;
  bike.pitch = Math.atan2(frontHeight - rearHeight, spec.cgToFront + spec.cgToRear);
  bike.cgY = frontHeight * Math.cos(bike.pitch) - spec.cgToFront * Math.sin(bike.pitch) + gap;
  (bike as unknown as Internals).writeBody(track, 0);
}

describe('complete motocross step lifecycle and publication', () => {
  it.each([MX_250, MX_450])(
    '$id publishes whole-step work while keeping final physical state',
    (definition) => {
      const { bike, track } = rig(definition),
        dt = 1 / 120;
      bike.dynamics.speed = 18;
      bike.vy = -8;
      Object.assign(bike.input, { throttle: 0.45, brake: 0.55, clutch: 0.35, steer: 0.15 });
      const input = { ...bike.input },
        fuel = bike.fuel,
        clock = bike.clock,
        wear = bike.tires.map((tire) => tire.wear),
        pose = [bike.fork, bike.shock, bike.steer],
        phases = observe(bike),
        heat = observeHeat(bike);
      try {
        bike.step(dt, track);
      } finally {
        phases.restore();
        heat.restore();
      }
      expect(phases.phases.length).toBeGreaterThan(1);
      expect(phases.phases.length).toBeLessThanOrEqual(8);
      expect(phases.phases.reduce((sum, phase) => sum + phase.dt, 0)).toBeCloseTo(dt, 15);
      expect(bike.clock - clock).toBeCloseTo(dt, 15);
      expect(phases.phases.every((phase) => phase.player && !phase.airborne)).toBe(true);
      expect(phases.phases.map((phase) => phase.input)).toEqual(phases.phases.map(() => input));
      const last = phases.phases.at(-1)!;
      expect(physicalState(bike)).toEqual(last.state);
      for (const [axis, old, rate] of [
        [bike.fork, pose[0], bike.machineMotion!.forkRate],
        [bike.shock, pose[1], bike.machineMotion!.shockRate],
        [bike.steer, pose[2], bike.machineMotion!.steerRate],
      ])
        expect(rate).toBeCloseTo((axis - old) / dt, 12);
      let differentForce = false,
        differentPower = false;
      for (let i = 0; i < 4; i++) {
        const mean = (key: 'fx' | 'fy' | 'power') =>
          phases.phases.reduce((sum, phase) => sum + phase.wheel[i][key] * phase.dt, 0) / dt;
        expect(bike.tires[i].fx).toBeCloseTo(mean('fx'), 10);
        expect(bike.tires[i].fy).toBeCloseTo(mean('fy'), 10);
        expect(bike.tires[i].energy).toBeCloseTo(mean('power'), 10);
        differentForce ||= Math.abs(last.wheel[i].fx - mean('fx')) > 10;
        differentPower ||= Math.abs(last.wheel[i].power - mean('power')) > 1;
      }
      expect(differentForce && differentPower).toBe(true);
      expect(bike.gLong).toBeCloseTo(
        phases.phases.reduce((sum, phase) => sum + phase.gLong * phase.dt, 0) / dt,
        12,
      );
      const motorWork = phases.phases.reduce((sum, phase) => sum + phase.motorJ, 0);
      expect(motorWork).toBeGreaterThan(1);
      expect(fuel - bike.fuel).toBeCloseTo(motorWork / (0.3 * 43e6) + 0.0002 * dt, 12);
      expect(heat.balances).toHaveLength(phases.phases.length);
      for (const balance of heat.balances)
        for (let end = 0; end < 2; end++) {
          expect(balance.storedAndLost[end]).toBeCloseTo(balance.source[end], 7);
          expect(balance.rotorStoredAndLost[end]).toBeCloseTo(balance.rotorSource[end], 7);
        }
      for (let end = 0; end < 2; end++) {
        const work = heat.balances.reduce((sum, balance) => sum + balance.slip[end], 0),
          tire = bike.tires[2 * end];
        expect(work).toBeGreaterThan(0);
        expect(2 * tire.energy * dt).toBeCloseTo(work, 10);
        expect((tire.wear - wear[2 * end]) * COMPOUNDS[tire.compound].lifeJ).toBeCloseTo(work, 9);
        expect(bike.tires[2 * end + 1].energy).toBe(tire.energy);
        expect(bike.tires[2 * end + 1].discTemp).toBe(tire.discTemp);
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id consumes one manual shift and ages one cut over all intervals',
    (definition) => {
      const { bike, track } = rig(definition),
        dt = 1 / 120;
      bike.dynamics.speed = 18;
      bike.vy = -8;
      bike.input.throttle = 1;
      bike.input.shift = 1;
      const gear = bike.gear,
        event = bike.gearStroke.seed.event,
        clock = bike.clock,
        phases = observe(bike);
      try {
        bike.step(dt, track);
      } finally {
        phases.restore();
      }
      expect(phases.phases.length).toBeGreaterThan(1);
      expect(bike.gear).toBe(gear + 1);
      expect(bike.gearStroke.seed.event).toBe(event + 1);
      expect(bike.input.shift).toBe(0);
      expect(bike.autoShift).toBe(false);
      expect(phases.phases.every((phase) => phase.gear === gear + 1 && phase.torque === 0)).toBe(
        true,
      );
      expect(bike.shiftClock).toBeCloseTo(bike.bikeSpec.shiftCut - dt, 14);
      expect(bike.gearStroke.ageAt(bike.clock)).toBeCloseTo(
        bike.clock - clock - phases.phases[0].dt,
        14,
      );
      // A new, rejected edge during the same cut is consumed, not queued for
      // a later inner interval or replayed once per integration subdivision.
      bike.vy = -8;
      bike.input.shift = 1;
      bike.step(dt, track);
      expect(bike.gear).toBe(gear + 1);
      expect(bike.gearStroke.seed.event).toBe(event + 1);
      expect(bike.input.shift).toBe(0);
      expect(bike.shiftClock).toBeCloseTo(bike.bikeSpec.shiftCut - 2 * dt, 14);
    },
  );

  it.each([MX_250, MX_450])(
    '$id respects the automatic cut without repeating its engagement',
    (definition) => {
      const { bike, track } = rig(definition),
        dt = 1 / 120;
      bike.dynamics.speed = 45;
      bike.gear = 1;
      bike.autoShift = true;
      bike.vy = -8;
      bike.input.throttle = 1;
      const event = bike.gearStroke.seed.event,
        phases = observe(bike);
      try {
        bike.step(dt, track);
      } finally {
        phases.restore();
      }
      expect(phases.phases.length).toBeGreaterThan(1);
      expect(bike.gear).toBe(2);
      expect(bike.gearStroke.seed.event).toBe(event + 1);
      expect(phases.phases.every((phase) => phase.gear === 2 && phase.torque === 0)).toBe(true);
      // Automatic selection follows the first interval's timer decrement;
      // only the remaining elapsed time can age that newly accepted cut.
      expect(bike.shiftClock).toBeCloseTo(bike.bikeSpec.shiftCut - dt + phases.phases[0].dt, 14);
      expect(bike.autoShift).toBe(true);
    },
  );

  it.each([MX_250, MX_450])(
    '$id waits for the next public decision when rotor braking crosses the automatic downshift point',
    (definition) => {
      const { bike, track } = rig(definition),
        dt = 1 / 120,
        spec = bike.spec,
        currentRatio = spec.gearRatios[bike.gear + 1] * spec.finalDrive * bike.gearing;
      bike.dynamics.speed =
        ((0.95 * spec.downshiftRPM * Math.PI) / 30 / currentRatio) * spec.wheelRadius;
      bike.step(1 / 240, track); // Establish moving contact, without a harness rotor reseed later.
      // Road speed already asks for a lower ratio. The actual shaft must
      // also fall below the existing downshift point before the automatic
      // rider requests it; manual next-ratio over-rev protection is separate.
      const automaticThreshold = (spec.downshiftRPM * Math.PI) / 30 / currentRatio;
      bike.rearSpin = automaticThreshold + 0.1;
      bike.autoShift = true;
      bike.input.clutch = 0.8;
      bike.vy = -8;
      const gear = bike.gear,
        event = bike.gearStroke.seed.event,
        shifts = vi.spyOn(bike, 'shift'),
        phases = observe(bike);
      try {
        bike.step(dt, track);
        expect(phases.phases.length).toBeGreaterThan(1);
        expect(shifts).not.toHaveBeenCalled();
        expect(bike.rearSpin).toBeLessThan(automaticThreshold);
        expect(bike.gear).toBe(gear);
        expect(bike.gearStroke.seed.event).toBe(event);
        expect(phases.phases.every((phase) => phase.gear === gear)).toBe(true);
        bike.vy = -8;
        bike.step(dt, track);
        expect(shifts).toHaveBeenCalledTimes(1);
        expect(shifts).toHaveBeenCalledWith(-1);
        expect(bike.gear).toBe(gear - 1);
        expect(bike.gearStroke.seed.event).toBe(event + 1);
        expect(bike.shiftClock).toBeGreaterThan(0);
      } finally {
        shifts.mockRestore();
        phases.restore();
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id advances flexible modes internally while publishing outer pose derivatives',
    (definition) => {
      const { bike, track } = rig(definition),
        dt = 1 / 120,
        actual = bike.machineMotion!,
        reference = new MxMachineMotion();
      expect([
        actual.front.position,
        actual.front.rate,
        actual.rear.position,
        actual.rear.rate,
        actual.chainPull,
      ]).toEqual([0, 0, 0, 0, 0]);
      reference.reset(bike.fork, bike.shock, bike.steer);
      const advance = actual.step.bind(actual);
      let calls = 0;
      const spy = vi.spyOn(actual, 'step').mockImplementation((...args) => {
        advance(...args);
        reference.step(...args);
        expect(flex(actual)).toEqual(flex(reference));
        calls++;
      });
      bike.dynamics.speed = 18;
      bike.input.throttle = 0.4;
      try {
        for (const steering of [0.2, -0.2]) {
          bike.vy = -8;
          bike.input.steer = steering;
          const pose = [bike.fork, bike.shock, bike.steer],
            start = calls;
          bike.step(dt, track);
          expect(calls - start).toBeGreaterThan(1);
          expect(flex(actual)).toEqual(flex(reference));
          expect(actual.forkRate).toBeCloseTo((bike.fork - pose[0]) / dt, 12);
          expect(actual.shockRate).toBeCloseTo((bike.shock - pose[1]) / dt, 12);
          expect(actual.steerRate).toBeCloseTo((bike.steer - pose[2]) / dt, 12);
        }
      } finally {
        spy.mockRestore();
      }
      expect(Math.abs(actual.front.position) + Math.abs(actual.rear.position)).toBeGreaterThan(
        0.001,
      );
    },
  );

  it.each([MX_250, MX_450])(
    '$id absorbs a world collision once before the refined force solve',
    (definition) => {
      const { bike, track, model } = rig(definition),
        dt = 1 / 120;
      bike.dynamics.speed = 12;
      bike.vy = -8;
      bike.body.position.x += 0.125;
      bike.body.position.z += 0.2;
      bike.body.velocity.x += 0.75;
      bike.body.velocity.z += 1.5;
      bike.body.omega.y += 0.3;
      bike.body.omega.z += 0.2;
      const before = [
          bike.dynamics.x,
          bike.dynamics.z,
          bike.dynamics.speed,
          bike.slide,
          bike.dynamics.leanRate,
        ],
        absorb = model.absorbExternal.bind(bike),
        transfers: number[][] = [],
        spy = vi.spyOn(model, 'absorbExternal').mockImplementation((h) => {
          absorb(h);
          transfers.push([
            bike.dynamics.x,
            bike.dynamics.z,
            bike.dynamics.speed,
            bike.slide,
            bike.dynamics.leanRate,
          ]);
        }),
        phases = observe(bike);
      try {
        bike.step(dt, track);
      } finally {
        spy.mockRestore();
        phases.restore();
      }
      expect(phases.phases.length).toBeGreaterThan(1);
      expect(phases.phases.map((phase) => phase.absorb)).toEqual(
        phases.phases.map((_, i) => i === 0),
      );
      expect(transfers).toHaveLength(1);
      for (const [i, impulse] of [0.125, 0.2, 1.5, 0.75, -0.2].entries())
        expect(transfers[0][i] - before[i]).toBeCloseTo(impulse, 12);
      expect(physicalState(bike).motion.every(Number.isFinite)).toBe(true);
    },
  );

  it.each([MX_250, MX_450])(
    '$id expires AI ownership once per public call before player refinement',
    (definition) => {
      const { bike, track, model } = rig(definition),
        phases = observe(bike);
      bike.aiControlled(2);
      try {
        for (let call = 0; call < 3; call++) {
          bike.vy = -8;
          const start = phases.phases.length;
          bike.step(1 / 120, track);
          const current = phases.phases.slice(start);
          if (call < 2) {
            expect(current).toHaveLength(1);
            expect(current[0].player).toBe(false);
            expect(model.aiSteps).toBe(1 - call);
          } else {
            expect(current.length).toBeGreaterThan(1);
            expect(current.every((phase) => phase.player && phase.aiSteps === 0)).toBe(true);
          }
        }
      } finally {
        phases.restore();
      }
    },
  );

  it('keeps supermoto on one unchanged interval even under a rapid stroke', () => {
    const { bike, track } = rig(SM_450),
      phases = observe(bike);
    bike.vy = -25;
    try {
      bike.step(1 / 120, track);
    } finally {
      phases.restore();
    }
    expect(phases.phases).toHaveLength(1);
    expect(phases.phases[0].player).toBe(false);
  });

  it.each([MX_250, MX_450])(
    '$id keeps unsupported launch debounce on public calls and resets on contact',
    (definition) => {
      const { bike, track, model } = rig(definition),
        phases = observe(bike),
        dt = 1 / 120;
      freePose(bike, track, 1);
      bike.vy = 8;
      try {
        for (let call = 0; call < 2; call++) {
          const start = phases.phases.length;
          bike.step(dt, track);
          expect(phases.phases.length - start).toBeGreaterThan(1);
          expect(model.freeSteps).toBe(call + 1);
          expect(bike.airborne).toBe(false);
        }
        bike.step(dt, track);
        expect(bike.airborne).toBe(true);
      } finally {
        phases.restore();
      }
      const again = rig(definition),
        observed = observe(again.bike);
      freePose(again.bike, again.track, 1);
      again.bike.vy = 8;
      again.bike.step(dt, again.track);
      expect(again.model.freeSteps).toBe(1);
      // Contact returns after the first inner interval: immediate support
      // reset is required even though only the first interval owns counting.
      freePose(again.bike, again.track, 0.01);
      again.bike.vy = -8;
      const start = observed.phases.length;
      try {
        again.bike.step(dt, again.track);
      } finally {
        observed.restore();
      }
      const phasesAfter = observed.phases.slice(start);
      expect(phasesAfter[0].freeSteps).toBe(2);
      expect(phasesAfter.some((phase) => phase.freeSteps === 0)).toBe(true);
      expect(again.model.freeSteps).toBe(0);
      expect(again.bike.airborne).toBe(false);
    },
  );

  it.each([MX_250, MX_450])(
    '$id defers one new landing verdict until its complete public contact interval',
    (definition) => {
      const { bike, track, model } = rig(definition),
        dt = 0.04;
      freePose(bike, track, 0.015);
      bike.airborne = true;
      bike.airTime = 0.5;
      bike.vy = -12;
      model.flightSpeed = bike.dynamics.speed = 12;
      model.takeoffSpeed = 12;
      bike.frontSpin = 12 / bike.bikeSpec.frontWheelRadius;
      bike.rearSpin = 12 / bike.bikeSpec.rearWheelRadius;
      const phases = observe(bike),
        judge = vi.spyOn(model, 'judgeLanding');
      try {
        bike.step(dt, track);
        expect(phases.phases).toHaveLength(8);
        expect(bike.lastLanding).not.toBeNull();
        expect(bike.landings).toBe(1);
        expect(judge).not.toHaveBeenCalled();
        expect(bike.riding).toBe(true);
        const record = bike.lastLanding!;
        expect(record.bottomSpeed).toBeGreaterThan(bike.air.bottomOutSpeed);
        expect(record.bottomSpeed).toBe(Math.max(...phases.phases.map((phase) => phase.bottom)));
        const event = { ...record },
          start = phases.phases.length;
        bike.step(1 / 120, track);
        expect(judge).toHaveBeenCalledTimes(1);
        expect(bike.dynamics.crashes).toBe(1);
        expect(bike.crashCauses).toHaveLength(1);
        expect(record.outcome).toBe('crash-flat');
        expect(record.time).toBe(event.time);
        expect(record.normalSpeed).toBe(event.normalSpeed);
        expect(record.bottomSpeed).toBe(event.bottomSpeed);
        expect(model.pendingLanding).toBeNull();
        expect(phases.phases.slice(start).every((phase) => phase.state.state !== 'riding')).toBe(
          true,
        );
        bike.step(1 / 120, track);
        expect(judge).toHaveBeenCalledTimes(1);
        expect(bike.dynamics.crashes).toBe(1);
      } finally {
        phases.restore();
        judge.mockRestore();
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id conserves free rotor work when a near-contact forecast refines flight',
    (definition) => {
      const { bike, track, model } = rig(definition),
        dt = 1 / 120;
      freePose(bike, track, 0.05);
      bike.airborne = true;
      bike.airTime = 0.5;
      bike.pitchRate = -8;
      model.flightSpeed = bike.dynamics.speed = 12;
      bike.frontSpin = 60;
      bike.input.brake = 0.4;
      const phases = observe(bike),
        heat = observeHeat(bike),
        before = bike.frontSpin;
      try {
        bike.step(dt, track);
      } finally {
        phases.restore();
        heat.restore();
      }
      expect(phases.phases.length).toBeGreaterThan(1);
      expect(phases.phases.every((phase) => phase.beforeAir && phase.airborne)).toBe(true);
      expect(bike.landings).toBe(0);
      let expected = before,
        work = 0;
      for (const phase of phases.phases) {
        const coast = expected * Math.exp(-0.4 * phase.dt),
          next = Math.max(0, coast - bike.brake * bike.air.spinBrake * 0.7 * phase.dt),
          joules = 0.5 * bike.tires[0].inertia * (coast * coast - next * next);
        expect(phase.frontSpin).toBeCloseTo(next, 12);
        expect(phase.frontBrakePower! * phase.dt).toBeCloseTo(joules, 10);
        expected = next;
        work += joules;
      }
      expect(bike.frontSpin).toBeCloseTo(expected, 12);
      expect(
        heat.balances.reduce((sum, balance) => sum + balance.rotorStoredAndLost[0], 0),
      ).toBeCloseTo(work, 7);
      expect(bike.tires.every((tire) => tire.energy === 0 && tire.fx === 0 && tire.fy === 0)).toBe(
        true,
      );
      // Drag then brake is a finite-interval splitting rule, not a semigroup.
      // The old outer-only recurrence is therefore not a work-conservation
      // oracle when an independently verified free flight is subdivided.
      const single = Math.max(
        0,
        before * Math.exp(-0.4 * dt) - bike.brake * bike.air.spinBrake * 0.7 * dt,
      );
      expect(Math.abs(bike.frontSpin - single)).toBeGreaterThan(1e-5);
    },
  );
});

describe('diagnostic interval observation does not alter production state', () => {
  it.each([MX_250, MX_450])(
    '$id retains identical unrounded hashes through free flight, contact and recovery',
    (definition) => {
      const observed = rig(definition),
        ordinary = rig(definition),
        dt = 1 / 120,
        observedHash = createHash('sha256'),
        ordinaryHash = createHash('sha256'),
        states = new Set<string>();
      for (const { bike, track, model } of [observed, ordinary]) {
        freePose(bike, track, 0.15);
        bike.airborne = true;
        bike.airTime = 0.5;
        bike.vy = -12;
        model.flightSpeed = bike.dynamics.speed = 12;
        model.takeoffSpeed = 12;
        bike.frontSpin = 12 / bike.bikeSpec.frontWheelRadius;
        bike.rearSpin = 12 / bike.bikeSpec.rearWheelRadius;
      }
      const capture = (bike: DirtBikeVehicle) =>
        JSON.stringify({
          physical: physicalState(bike),
          clock: bike.clock,
          input: bike.input,
          body: [bike.body.position, bike.body.velocity, bike.body.orientation, bike.body.omega],
          publication: [
            bike.gLong,
            bike.fork,
            bike.shock,
            bike.steer,
            bike.riderBody,
            bike.riderBodyRate,
            bike.machineMotion?.forkRate,
            bike.machineMotion?.shockRate,
            bike.machineMotion?.steerRate,
          ],
          tyres: bike.tires.map((tire) => [
            tire.fx,
            tire.fy,
            tire.energy,
            tire.rotation,
            tire.omega,
          ]),
          gear: [bike.gear, bike.shiftClock, bike.rpm, bike.gearStroke.seed],
          events: [bike.landings, bike.lastLanding, bike.dynamics.crashes, bike.crashCauses],
          rider: [
            bike.rider,
            bike.riderHeading,
            bike.remountBudgetSeconds,
            bike.dynamics.stateClock,
          ],
        });
      let crashed = false,
        resumed = -1,
        ticks = 0;
      for (; ticks < 2400 && (resumed < 0 || ticks < resumed + 32); ticks++) {
        const controls = crashed
          ? { throttle: 0.5, brake: 0.6, clutch: 0.4, riderLean: 0.6 }
          : { throttle: 0, brake: 0, clutch: 0, riderLean: 0 };
        Object.assign(observed.bike.input, controls);
        Object.assign(ordinary.bike.input, controls);
        observePlayerStepIntervals(observed.bike, observed.track, dt, (interval) => {
          if (
            interval.before.airborne &&
            interval.after.airborne &&
            interval.before.landings === interval.after.landings
          )
            states.add('free');
          if (!interval.after.airborne && interval.after.riding) states.add('contact');
          if (!interval.before.riding && !interval.after.riding) states.add('recovery');
        });
        ordinary.bike.step(dt, ordinary.track);
        observedHash.update(capture(observed.bike));
        ordinaryHash.update(capture(ordinary.bike));
        crashed ||= observed.bike.dynamics.crashes > 0;
        if (crashed && observed.bike.riding && resumed < 0) resumed = ticks;
        expect(Object.hasOwn(observed.bike, 'stepInterval')).toBe(false);
        expect(Object.hasOwn(observed.bike, 'vertical')).toBe(false);
      }
      expect(states).toEqual(new Set(['free', 'contact', 'recovery']));
      expect(crashed).toBe(true);
      expect(resumed).toBeGreaterThan(0);
      expect(ticks).toBe(resumed + 32);
      expect(observedHash.digest('hex')).toBe(ordinaryHash.digest('hex'));
      expect(physicalState(observed.bike)).toEqual(physicalState(ordinary.bike));
    },
  );

  it('restores the original entry point if a diagnostic callback throws', () => {
    const { bike, track, model } = rig(MX_250),
      original = model.stepInterval;
    bike.vy = -8;
    expect(() =>
      observePlayerStepIntervals(bike, track, 1 / 120, () => {
        throw new Error('diagnostic failed');
      }),
    ).toThrow('diagnostic failed');
    expect(model.stepInterval).toBe(original);
    expect(Object.hasOwn(bike, 'stepInterval')).toBe(false);
    expect(Object.hasOwn(bike, 'vertical')).toBe(false);
  });
});
