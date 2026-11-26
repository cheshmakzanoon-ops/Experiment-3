import { describe, expect, it, vi } from 'vitest';
import { Bike, BIKE, EXPERT, NOVICE } from '../src/simulation/bike.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import {
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';
import { levelMotocrossTrack } from './motocross-test-track.ts';

const DT = 1 / 720;
const parameters = (): MxGroundParameters => ({
  mass: 184,
  frontArm: 0.75,
  rearArm: 0.73,
  frontRadius: 0.355,
  rearRadius: 0.345,
  frontInertia: 0.6,
  rearInertia: 0.62,
  frontLoad: 900,
  rearLoad: 900,
  frontMu: 0.8,
  rearMu: 0.8,
  steer: 0,
  driveTorque: 0,
  frontBrakeTorque: 0,
  rearBrakeTorque: 0,
  drag: 0,
  slope: 0,
  tractionControl: false,
  abs: true,
});
const rolling = (speed = 20): MxGroundState => ({
  speed,
  lateralSpeed: 0,
  yawRate: 0,
  heading: 0,
  frontOmega: speed / 0.355,
  rearOmega: speed / 0.345,
});
const frontTorque = (
  before: MxGroundState,
  after: ReturnType<typeof stepMotocrossGround>,
  p: MxGroundParameters,
) =>
  (p.frontInertia * (before.frontOmega - after.frontOmega)) / DT - after.front.fx * p.frontRadius;
const rearTorque = (
  before: MxGroundState,
  after: ReturnType<typeof stepMotocrossGround>,
  p: MxGroundParameters,
) =>
  p.driveTorque -
  (p.rearInertia * (after.rearOmega - before.rearOmega)) / DT -
  after.rear.fx * p.rearRadius;

describe('motocross independent brake aid ceilings', () => {
  it('uses the tighter pressure ceiling once, without multiplying it by slip ABS', () => {
    const p = { ...parameters(), frontBrakeTorque: 1000, frontBrakeTorqueLimit: 300 };
    const before = rolling();
    // This slip gives a live ABS request of 500 Nm; the separate 300 Nm
    // corner/lift ceiling therefore wins. Their product would be 150 Nm.
    before.frontOmega = (before.speed * (1 - 0.21)) / p.frontRadius;
    const after = stepMotocrossGround(before, p, DT);
    expect(frontTorque(before, after, p)).toBeCloseTo(300, 9);
    const travel = 0.5 * (before.frontOmega + after.frontOmega) * DT;
    expect(after.frontBrakePower * DT).toBeCloseTo(300 * travel, 10);
    const kinetic = (state: MxGroundState) =>
      0.5 *
      (p.mass * state.speed ** 2 +
        p.frontInertia * state.frontOmega ** 2 +
        p.rearInertia * state.rearOmega ** 2);
    const contactLoss =
      after.front.fx *
      DT *
      (p.frontRadius * 0.5 * (before.frontOmega + after.frontOmega) -
        0.5 * (before.speed + after.speed));
    expect(contactLoss).toBeGreaterThan(0);
    expect(kinetic(after) - kinetic(before)).toBeCloseTo(-300 * travel - contactLoss, 8);
    expect(after.front.use).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('retains the existing slip controller when it is tighter than the aid ceiling', () => {
    const p = { ...parameters(), frontBrakeTorque: 400, rearBrakeTorque: 350 };
    const before = rolling();
    before.frontOmega *= 0.75;
    before.rearOmega *= 0.73;
    const ordinary = stepMotocrossGround(before, p, DT);
    const limited = stepMotocrossGround(
      before,
      {
        ...p,
        frontBrakeTorqueLimit: 300,
        rearBrakeTorqueLimit: 280,
      },
      DT,
    );
    expect(limited).toEqual(ordinary);
    expect(frontTorque(before, limited, p)).toBeLessThan(300);
    expect(rearTorque(before, limited, p)).toBeLessThan(280);
  });

  it('shares one rear ceiling between service and engine braking while retaining opposing drive', () => {
    const p = {
      ...parameters(),
      driveTorque: 100,
      rearBrakeTorque: 500,
      rearEngineBrakeTorque: 200,
      rearBrakeTorqueLimit: 150,
    };
    const before = rolling(),
      after = stepMotocrossGround(before, p, DT);
    expect(rearTorque(before, after, p)).toBeCloseTo(150, 9);
    const travel = 0.5 * (before.rearOmega + after.rearOmega) * DT;
    // The brake disc receives 60%; pumping losses receive the other 40%.
    expect(after.rearBrakePower * DT).toBeCloseTo(150 * 0.6 * travel, 10);
    const mechanical = 0.5 * p.rearInertia * (after.rearOmega ** 2 - before.rearOmega ** 2);
    expect(mechanical).toBeCloseTo((p.driveTorque - 150) * travel, 8);
  });

  it.each([0, 20])(
    'does not turn a contact-force ceiling into a free-front rotor lockout at speed %s',
    (speed) => {
      const p = { ...parameters(), frontLoad: 0, frontBrakeTorque: 240 };
      const before = { ...rolling(speed), frontOmega: 100 };
      const ordinary = stepMotocrossGround(before, p, DT);
      const limited = stepMotocrossGround(before, { ...p, frontBrakeTorqueLimit: 0 }, DT);
      expect(limited).toEqual(ordinary);
      expect(limited.frontOmega).toBeLessThan(before.frontOmega);
      expect(limited.front.fx).toBe(0);
      expect(limited.front.fy).toBe(0);
      expect(limited.frontBrakePower).toBeGreaterThan(0);
    },
  );

  it('retains free-rear engine/service work and drive despite a zero contact ceiling', () => {
    const p = {
      ...parameters(),
      rearLoad: 0,
      driveTorque: 90,
      rearBrakeTorque: 300,
      rearEngineBrakeTorque: 100,
    };
    const before = { ...rolling(0), rearOmega: 100 };
    const ordinary = stepMotocrossGround(before, p, DT);
    const limited = stepMotocrossGround(before, { ...p, rearBrakeTorqueLimit: 0 }, DT);
    expect(limited).toEqual(ordinary);
    expect(rearTorque(before, limited, p)).toBeCloseTo(300, 9);
    expect(limited.rear.fx).toBe(0);
    expect(limited.rearBrakePower).toBeGreaterThan(0);
  });

  it('preserves exact default and unlimited behavior', () => {
    const p = { ...parameters(), frontBrakeTorque: 400, rearBrakeTorque: 300 };
    const before = rolling();
    before.frontOmega *= 0.84;
    before.rearOmega *= 0.77;
    expect(
      stepMotocrossGround(
        before,
        {
          ...p,
          frontBrakeTorqueLimit: Infinity,
          rearBrakeTorqueLimit: Infinity,
        },
        DT,
      ),
    ).toEqual(stepMotocrossGround(before, p, DT));
  });

  it.each(['frontBrakeTorqueLimit', 'rearBrakeTorqueLimit'] as const)(
    'rejects invalid %s',
    (field) => {
      for (const value of [-1, NaN, -Infinity]) {
        expect(() =>
          stepMotocrossGround(rolling(), { ...parameters(), [field]: value }, DT),
        ).toThrow();
      }
    },
  );
});

describe('core brake aid intent stays distinct from applied contact force', () => {
  const input = { lean: 0, rider: 0, throttle: 0, frontBrake: 1, rearBrake: 0, drive: 0 };

  it('publishes the lift ceiling before passive clipping by a weak front contact', () => {
    const bike = new Bike({ ...EXPERT, wheelie: true });
    bike.speed = 10;
    bike.frontLoad = 0.25;
    bike.step(input, 1e-6);
    expect(bike.frontBrakeForce).toBeCloseTo(0.25 * bike.p.mu, 12);
    expect(bike.frontBrakeAssistLimit).toBeGreaterThan(100);
    expect(bike.frontBrakeAssistLimit).toBeGreaterThan(bike.frontBrakeForce);
    expect(bike.rearBrakeAssistLimit).toBe(Infinity);
  });

  it('does not let the core stationary-contact gate zero a gross rotor ceiling', () => {
    const bike = new Bike();
    bike.step(input, 1e-6);
    expect(bike.frontBrakeForce).toBe(0);
    expect(bike.frontBrakeAssistLimit).toBeGreaterThan(100);
  });

  it('keeps opposing drive in the gross rear brake ceiling', () => {
    const bike = new Bike({ ...NOVICE, combinedBrakes: false });
    bike.speed = 10;
    bike.step({ ...input, frontBrake: 0, rearBrake: 1, throttle: 0.2, drive: 200 }, 1e-6);
    expect(bike.assistedDriveForce).toBe(200);
    expect(bike.rearBrakeForce).toBeGreaterThan(0);
    expect(bike.rearBrakeAssistLimit).toBeCloseTo(
      bike.assistedDriveForce + bike.rearBrakeForce,
      10,
    );
    expect(bike.rearBrakeAssistLimit).toBeGreaterThan(bike.rearBrakeForce);
  });

  it('budgets the same total rear command whether supplied by service braking or the engine', () => {
    const make = (service: number, engine: number) => {
      const bike = new Bike({ ...NOVICE, combinedBrakes: false }, { ...BIKE, rearBrake: 1000 });
      bike.speed = 10;
      bike.step({ ...input, frontBrake: 0.5, rearBrake: service, engineBrake: engine }, 1e-6);
      return bike;
    };
    const service = make(0.5, 0),
      mixed = make(0.2, 300);
    expect(mixed.frontBrakeAssistLimit).toBe(service.frontBrakeAssistLimit);
    expect(mixed.rearBrakeAssistLimit).toBe(service.rearBrakeAssistLimit);
    expect(mixed.rearBrakeForce).toBe(service.rearBrakeForce);
    expect(mixed.engineBrakeForce).toBeGreaterThan(0);
  });

  it('clears both derived limits on fall and recovery, and republishes unlimited Raw intent', () => {
    const bike = new Bike(EXPERT);
    bike.speed = 10;
    bike.step(input, 1e-6);
    expect(bike.frontBrakeAssistLimit).toBe(Infinity);
    expect(bike.rearBrakeAssistLimit).toBe(Infinity);
    bike.fall('lowside');
    expect(bike.frontBrakeAssistLimit).toBe(0);
    expect(bike.rearBrakeAssistLimit).toBe(0);
    bike.step(input, 1e-6);
    expect(bike.frontBrakeAssistLimit).toBe(0);
    expect(bike.rearBrakeAssistLimit).toBe(0);
  });
});

describe('public ridden MX brake actuator boundary', () => {
  it.each([MX_250, MX_450])(
    '$id preserves the cornering ceiling at the actual front rotor',
    (definition) => {
      const track = levelMotocrossTrack();
      const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
      bike.place(track, 35);
      bike.dynamics.speed = 20;
      bike.dynamics.steer = 0.03;
      bike.dynamics.lean = 0.65;
      bike.gear = 3;
      bike.input.brake = 1;
      bike.input.steer = 0.6;
      bike.input.throttle = 0.05;
      const d = bike.dynamics,
        original = d.step.bind(d);
      let incomingOmega = NaN,
        limit = NaN,
        coreFront = NaN;
      const spy = vi.spyOn(d, 'step').mockImplementation((controls, dt) => {
        incomingOmega = bike.frontSpin;
        const result = original(controls, dt);
        limit = d.frontBrakeAssistLimit;
        coreFront = d.frontBrakeForce;
        return result;
      });
      const dt = 1e-6;
      try {
        bike.step(dt, track);
      } finally {
        spy.mockRestore();
      }
      const spec = definition.bike!;
      const torque =
        (bike.tires[0].inertia * (incomingOmega - bike.frontSpin)) / dt -
        bike.tires[0].fx * spec.frontWheelRadius;
      const raw = 0.78 * d.p.frontBrake;
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThan(raw * 0.5);
      expect(limit).toBeCloseTo(coreFront, 10);
      expect(torque).toBeCloseTo(limit * spec.frontWheelRadius, 6);
      expect(d.assists.abs).toBe(true);
      expect(bike.riding).toBe(true);
    },
  );

  it.each([MX_250, MX_450])(
    '$id keeps an explicit engine-drag actuator fixture inside the rear pedal budget',
    (definition) => {
      const track = levelMotocrossTrack();
      // Catalogue MX setup does not expose an engine-brake map. Exercise
      // the inherited actuator boundary explicitly without changing a
      // shipped bike specification or claiming its controls enable a map.
      class EngineBrakeFixture extends DirtBikeVehicle {
        protected override requestedEngineBraking(throttle: number) {
          return throttle <= 0.02 ? 300 : 0;
        }
      }
      const bike = new EngineBrakeFixture(0, 'medium', DEFAULT_SETUP, 'sport', definition);
      bike.place(track, 35);
      bike.dynamics.speed = 15;
      bike.gear = 3;
      bike.autoShift = false;
      bike.input.clutch = 1;
      bike.input.brake = 0.4;
      const d = bike.dynamics,
        original = d.step.bind(d);
      let incomingOmega = NaN,
        limit = NaN,
        engine = NaN,
        drive = NaN;
      const spy = vi.spyOn(d, 'step').mockImplementation((controls, dt) => {
        incomingOmega = bike.rearSpin;
        engine = controls.engineBrake ?? 0;
        const result = original(controls, dt);
        limit = d.rearBrakeAssistLimit;
        drive = d.assistedDriveForce;
        return result;
      });
      const dt = 1e-6;
      try {
        bike.step(dt, track);
      } finally {
        spy.mockRestore();
      }
      const spec = definition.bike!;
      const torque =
        drive * spec.rearWheelRadius -
        (spec.offroad!.spinInertia * (bike.rearSpin - incomingOmega)) / dt -
        bike.tires[2].fx * spec.rearWheelRadius;
      expect(engine).toBeGreaterThan(0);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThan(d.p.rearBrake + engine);
      expect(torque).toBeCloseTo(limit * spec.rearWheelRadius, 6);
      expect(bike.riding).toBe(true);
    },
  );
});
