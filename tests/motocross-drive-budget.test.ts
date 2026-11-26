import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { Bike, BIKE, NOVICE } from '../src/simulation/bike.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const MICROSTEP = 1 / 720;
const parameters = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345,
  frontInertia: 0.6, rearInertia: 0.62,
  frontLoad: 400, rearLoad: 1400, frontMu: 0.8, rearMu: 0.8,
  steer: 0, driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: true, abs: false,
});
const rolling = (speed = 0): MxGroundState => ({
  speed, lateralSpeed: 0, yawRate: 0, heading: 0,
  frontOmega: speed / 0.355, rearOmega: speed / 0.345,
});

const budgeted = (p: MxGroundParameters): MxGroundParameters => ({ ...p, driveTorqueLimited: true });
const energy = (s: MxGroundState, p: MxGroundParameters) =>
  0.5 * (p.mass * (s.speed ** 2 + s.lateralSpeed ** 2) +
    p.frontInertia * s.frontOmega ** 2 + p.rearInertia * s.rearOmega ** 2);

describe('motocross gross drive budget at the soil actuator', () => {
  it.each([1 / 120, 1 / 240, 1 / 480])(
    'spends an already limited grip budget once and starts a feasible hill at dt=%s', (dt) => {
      const p = parameters(), peak = p.rearLoad * p.rearMu;
      p.driveTorque = 0.92 * peak * p.rearRadius;
      p.slope = G * 0.5;
      // This hill requires 80.6% of rear grip. A 92% budget can climb it;
      // the old second controller settles at only 60.3% at zero speed.
      expect(p.mass * p.slope).toBeLessThan(0.92 * peak);
      let state = rolling(), previousSpeed = 0;
      for (let tick = 0; tick < Math.round(2 / dt); tick++) {
        const next = stepMotocrossGround(state, budgeted(p), dt);
        expect(next.rear.use).toBeLessThanOrEqual(1 + 1e-12);
        expect(next.rear.slipPower).toBeGreaterThanOrEqual(0);
        previousSpeed = state.speed;
        state = next;
      }
      const rollingMass = p.mass + p.frontInertia / p.frontRadius ** 2 + p.rearInertia / p.rearRadius ** 2;
      const availableAcceleration = (0.92 * peak - p.mass * p.slope) / rollingMass;
      expect(state.speed).toBeGreaterThan(availableAcceleration);
      expect(state.speed).toBeGreaterThan(previousSpeed);
      expect(state.rearOmega * p.rearRadius - state.speed).toBeGreaterThan(0);
    },
  );

  it('keeps the standalone slip controller unless its gross command is explicitly budgeted', () => {
    const p = parameters();
    p.driveTorque = 0.92 * p.rearLoad * p.rearMu * p.rearRadius;
    p.slope = G * 0.5;
    let implicit = rolling(), explicit = rolling();
    for (let i = 0; i < 240; i++) {
      implicit = stepMotocrossGround(implicit, p, 1 / 120);
      explicit = stepMotocrossGround(explicit, { ...p, driveTorqueLimited: false }, 1 / 120);
    }
    expect(explicit).toEqual(implicit);
    expect(implicit.speed).toBe(0);
  });

  it.each([0.6, 1.5, 8])('accounts for the full permitted torque and finite wheel work with rim slip %s m/s', (rimSlip) => {
    const p = budgeted({ ...parameters(), frontLoad: 0 });
    p.driveTorque = 0.92 * p.rearLoad * p.rearMu * p.rearRadius;
    const before = rolling(4);
    before.rearOmega += rimSlip / p.rearRadius;
    const after = stepMotocrossGround(before, p, MICROSTEP);
    const observedTorque = p.rearInertia * (after.rearOmega - before.rearOmega) / MICROSTEP +
      after.rear.fx * p.rearRadius;
    expect(observedTorque).toBeCloseTo(p.driveTorque, 9);
    expect(p.mass * (after.speed - before.speed)).toBeCloseTo(after.rear.fx * MICROSTEP, 10);
    const rotorTravel = 0.5 * (before.rearOmega + after.rearOmega) * MICROSTEP;
    const engineWork = p.driveTorque * rotorTravel;
    const contactLoss = after.rear.fx * MICROSTEP *
      (p.rearRadius * 0.5 * (before.rearOmega + after.rearOmega) -
        0.5 * (before.speed + after.speed));
    expect(contactLoss).toBeGreaterThanOrEqual(0);
    expect(energy(after, p) - energy(before, p)).toBeCloseTo(engineWork - contactLoss, 8);
    expect(after.rear.slipPower).toBeGreaterThan(0);
  });

  it('lets existing excessive spin decay under a bounded command without exceeding soil grip', () => {
    const p = budgeted(parameters());
    p.driveTorque = 0.92 * p.rearLoad * p.rearMu * p.rearRadius;
    let state = rolling(4);
    state.rearOmega += 20 / p.rearRadius;
    const initialSlip = state.rearOmega * p.rearRadius - state.speed;
    let maximumSlip = initialSlip;
    for (let i = 0; i < 240; i++) {
      const next = stepMotocrossGround(state, p, 1 / 240);
      expect(Math.hypot(next.rear.fx, next.rear.fy)).toBeLessThanOrEqual(p.rearLoad * p.rearMu + 1e-10);
      maximumSlip = Math.max(maximumSlip, next.rearOmega * p.rearRadius - next.speed);
      state = next;
    }
    expect(maximumSlip).toBe(initialSlip);
    expect(state.rearOmega * p.rearRadius - state.speed).toBeLessThan(initialSlip / 4);
  });

  it('preserves the combined circle while an existing lateral reserve reduces gross drive', () => {
    const p = budgeted({ ...parameters(), frontLoad: 900, rearLoad: 900, lean: 0.35, steer: 0.045 });
    let state = rolling(12);
    state.rearOmega += 1.5 / p.rearRadius;
    for (let i = 0; i < 60; i++) {
      const lateral = p.mass * state.speed ** 2 * Math.tan(p.steer) * Math.cos(p.lean!) /
        (p.frontArm + p.rearArm),
        reserve = lateral * p.frontArm / (p.frontArm + p.rearArm),
        peak = p.rearLoad * p.rearMu;
      p.driveTorque = 0.92 * Math.sqrt(Math.max(0, peak ** 2 - reserve ** 2)) * p.rearRadius;
      const next = stepMotocrossGround(state, p, MICROSTEP);
      const torque = p.rearInertia * (next.rearOmega - state.rearOmega) / MICROSTEP +
        next.rear.fx * p.rearRadius;
      expect(torque).toBeCloseTo(p.driveTorque, 8);
      expect(next.rear.fy).toBeGreaterThan(0);
      expect(Math.hypot(next.rear.fx, next.rear.fy)).toBeLessThanOrEqual(peak + 1e-9);
      expect(Math.hypot(next.front.fx, next.front.fy)).toBeLessThanOrEqual(p.frontLoad * p.frontMu + 1e-9);
      state = next;
    }
  });
});

interface ActuatorObservation {
  requested: number;
  budget: number;
  intervention: number;
  coreNetDrive: number;
}
function observeCore(bike: DirtBikeVehicle) {
  const original = bike.dynamics.step.bind(bike.dynamics);
  const observed: ActuatorObservation = { requested: NaN, budget: NaN, intervention: NaN, coreNetDrive: NaN };
  const spy = vi.spyOn(bike.dynamics, 'step').mockImplementation((input, dt) => {
    const result = original(input, dt);
    observed.requested = input.drive!;
    observed.budget = bike.dynamics.assistedDriveForce;
    observed.intervention = bike.dynamics.intervention;
    observed.coreNetDrive = bike.dynamics.driveForce;
    return result;
  });
  return { observed, restore: () => spy.mockRestore() };
}

function actualBike(definition: VehicleDefinition, mode: 'sport' | 'raw' = 'sport') {
  const track = rigTrack('valley-ridge-mx');
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, mode, definition);
  bike.place(track, 35);
  bike.autoShift = false;
  return { track, bike };
}

describe('ridden motocross exact assisted engine command', () => {
  it('publishes a nonzero assisted command inside the unchanged intervention telemetry deadband', () => {
    const bike = new Bike();
    bike.speed = 10;
    bike.rearLoad = 0.25 / bike.p.mu;
    bike.step({ lean: 0, rider: 0, throttle: 0.5, frontBrake: 0, rearBrake: 0, drive: 0.5 }, 1e-6);
    expect(bike.intervention).toBe(0);
    expect(bike.assistedDriveForce).toBeCloseTo(0.25 * 0.92, 12);
    expect(bike.assistedDriveForce).toBeCloseTo(bike.driveForce, 12);
  });

  it('publishes the final current-load drive reduction after simultaneous front braking', () => {
    const run = (currentDriveTraction: boolean) => {
      const bike = new Bike({ ...NOVICE, combinedBrakes: false }, { ...BIKE, currentDriveTraction });
      bike.speed = 10;
      bike.step({ lean: 0, rider: 0, throttle: 1, frontBrake: 1, rearBrake: 0, drive: 3000 }, 1e-6);
      expect(bike.state).toBe('riding');
      return bike;
    };
    const firstPass = run(false), final = run(true);
    expect(final.frontBrakeForce).toBe(firstPass.frontBrakeForce);
    expect(final.assistedDriveForce).toBeLessThan(firstPass.assistedDriveForce);
    // No rear brake is requested, so the final active positive force bound
    // is also an independent observation of this final gross aid command.
    expect(final.assistedDriveForce).toBeCloseTo(final.driveForce, 10);
  });

  it('clears the gross engine command on a fall and throughout recovery', () => {
    const bike = new Bike();
    bike.step({ lean: 0, rider: 0, throttle: 1, frontBrake: 0, rearBrake: 0, drive: 500 }, 1e-6);
    expect(bike.assistedDriveForce).toBeGreaterThan(0);
    bike.fall('lowside');
    expect(bike.assistedDriveForce).toBe(0);
    bike.step({ lean: 0, rider: 0, throttle: 1, frontBrake: 0, rearBrake: 0, drive: 500 }, 1 / 120);
    expect(bike.assistedDriveForce).toBe(0);
    expect(bike.state).toBe('lowside');
  });

  it.each([MX_250, MX_450])('$id delivers the existing Sport budget even when the soil needs appreciable launch slip', (definition) => {
    const { bike, track } = actualBike(definition), d = bike.dynamics, spec = definition.bike!;
    bike.input.throttle = 1;
    bike.rearSpin = 1.5 / spec.rearWheelRadius;
    const omega = bike.rearSpin, probe = observeCore(bike);
    try {
      bike.step(1e-6, track);
      const observedTorque = spec.offroad!.spinInertia * (bike.rearSpin - omega) / 1e-6 +
        d.driveForce * spec.rearWheelRadius;
      expect(probe.observed.intervention).toBeGreaterThan(0);
      expect(probe.observed.budget).toBeGreaterThan(0);
      expect(observedTorque).toBeCloseTo(probe.observed.budget * spec.rearWheelRadius, 7);
      expect(d.assists.traction).toBe(true);
      expect(d.driveForce).toBeGreaterThan(0);
      expect(d.crashes).toBe(0);
    } finally { probe.restore(); }
  });

  it.each([MX_250, MX_450])('$id transmits an exact sub-newton budget with a free rear despite the intervention deadband', (definition) => {
    const { bike, track } = actualBike(definition), d = bike.dynamics, spec = definition.bike!;
    bike.forceFront += bike.forceRear;
    bike.forceRear = 0;
    bike.input.throttle = 0.5;
    bike.rearSpin = 4 / spec.rearWheelRadius;
    const omega = bike.rearSpin, probe = observeCore(bike);
    const drive = vi.spyOn(bike as unknown as { drive(dt: number, throttle: number): number }, 'drive')
      .mockReturnValue(0.5);
    try {
      bike.step(1e-6, track);
      expect(probe.observed.requested).toBe(0.5);
      expect(probe.observed.intervention).toBe(0);
      expect(probe.observed.budget).toBe(0);
      expect(bike.rearSpin).toBe(omega);
      expect(d.driveForce).toBe(0);
    } finally { drive.mockRestore(); probe.restore(); }
  });

  it.each([MX_250, MX_450])('$id keeps current rear unloading authoritative for its full Sport engine request', (definition) => {
    const { bike, track } = actualBike(definition), d = bike.dynamics, spec = definition.bike!;
    bike.forceFront += bike.forceRear;
    bike.forceRear = 0;
    bike.input.throttle = 1;
    bike.rearSpin = 6 / spec.rearWheelRadius;
    const omega = bike.rearSpin, probe = observeCore(bike);
    try {
      bike.step(1e-6, track);
      expect(probe.observed.requested).toBeGreaterThan(100);
      expect(probe.observed.budget).toBe(0);
      expect(probe.observed.intervention).toBe(1);
      expect(bike.rearSpin).toBe(omega);
      expect(d.driveForce).toBe(0);
    } finally { probe.restore(); }
  });

  it.each([MX_250, MX_450])('$id retains the actual Sport cornering reserve with an already spinning loaded rear', (definition) => {
    const { bike, track } = actualBike(definition), d = bike.dynamics, spec = definition.bike!;
    d.speed = 12;
    bike.step(1e-6, track);
    d.lean = 0.35;
    d.steer = 0.045;
    bike.input.steer = 0.25;
    bike.input.throttle = 1;
    bike.rearSpin += 2 / spec.rearWheelRadius;
    const omega = bike.rearSpin, probe = observeCore(bike);
    try {
      bike.step(1e-6, track);
      const observedTorque = spec.offroad!.spinInertia * (bike.rearSpin - omega) / 1e-6 +
        d.driveForce * spec.rearWheelRadius;
      expect(probe.observed.budget).toBeGreaterThan(0);
      expect(probe.observed.budget).toBeLessThan(probe.observed.requested);
      expect(observedTorque).toBeCloseTo(probe.observed.budget * spec.rearWheelRadius, 7);
      expect(d.frontUse).toBeLessThanOrEqual(1 + 1e-9);
      expect(d.rearUse).toBeLessThanOrEqual(1 + 1e-9);
      expect(bike.forceFront).toBeGreaterThan(0);
      expect(bike.forceRear).toBeGreaterThan(0);
      expect(d.crashes).toBe(0);
    } finally { probe.restore(); }
  });

  it.each([MX_250, MX_450])('$id retains gross engine torque during a stronger simultaneous rear-pedal request', (definition) => {
    const { bike, track } = actualBike(definition), d = bike.dynamics, spec = definition.bike!;
    d.speed = 8;
    bike.frontSpin = 8 / spec.frontWheelRadius;
    bike.rearSpin = 8 / spec.rearWheelRadius;
    bike.gear = 3;
    bike.input.throttle = 0.2;
    bike.input.clutch = 0.6;
    const omega = bike.rearSpin, probe = observeCore(bike);
    try {
      bike.step(1e-6, track);
      const brake = bike.input.clutch * d.p.rearBrake * spec.rearWheelRadius;
      const actual = spec.offroad!.spinInertia * (bike.rearSpin - omega) / 1e-6 +
        (d.driveForce - d.rearBrakeForce) * spec.rearWheelRadius + brake;
      expect(probe.observed.coreNetDrive).toBe(0);
      expect(probe.observed.budget).toBeGreaterThan(0);
      expect(actual).toBeCloseTo(probe.observed.budget * spec.rearWheelRadius, 7);
    } finally { probe.restore(); }
  });

  it.each([MX_250, MX_450])('$id preserves Raw torque and free-rotor angular momentum', (definition) => {
    const { bike, track } = actualBike(definition, 'raw'), d = bike.dynamics, spec = definition.bike!;
    bike.forceFront += bike.forceRear;
    bike.forceRear = 0;
    bike.input.throttle = 1;
    bike.rearSpin = 6 / spec.rearWheelRadius;
    const omega = bike.rearSpin, probe = observeCore(bike);
    try {
      bike.step(1e-6, track);
      const actual = spec.offroad!.spinInertia * (bike.rearSpin - omega) / 1e-6;
      expect(probe.observed.intervention).toBe(0);
      expect(probe.observed.budget).toBe(probe.observed.requested);
      expect(actual).toBeCloseTo(probe.observed.requested * spec.rearWheelRadius, 7);
      expect(d.driveForce).toBe(0);
      expect(d.assists.traction).toBe(false);
    } finally { probe.restore(); }
  });

  it.each([MX_250, MX_450].flatMap(definition => ([
    { venue: 'arena-nord-sx', s: 153.85, lateral: -2.5979 },
    { venue: 'valley-ridge-mx', s: 593.7997, lateral: -1.3447 },
  ] as const).map(face => ({ ...face, definition, id: definition.id }))))(
    '$id starts from rest on the unchanged $venue face with Sport still active', ({ definition, venue, s, lateral }) => {
      for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
        const track = rigTrack(venue),
          bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        bike.place(track, s, lateral);
        bike.gear = 1;
        bike.autoShift = false;
        const x = bike.dynamics.x, z = bike.dynamics.z, heading = bike.heading;
        bike.input.throttle = 1;
        for (let i = 0; i < Math.round(1 / dt); i++) bike.step(dt, track);
        const forward = (bike.dynamics.x - x) * Math.sin(heading) + (bike.dynamics.z - z) * Math.cos(heading);
        expect(forward, JSON.stringify({ dt, speed: bike.speed, pitch: bike.groundPitch, front: bike.forceFront, rear: bike.forceRear })).toBeGreaterThan(0.1);
        expect(bike.dynamics.speed).toBeGreaterThan(0.2);
        expect(bike.dynamics.assists.traction).toBe(true);
        expect(bike.dynamics.crashes).toBe(0);
      }
    },
  );
});
