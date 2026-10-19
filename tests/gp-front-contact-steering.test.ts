import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { FLASHBACK, InputLog, Resimulation } from '../src/core/flashback.ts';
import { Bike, EXPERT, NOVICE, type BikeInput } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, controls } from '../src/simulation/config.ts';
import {
  GP_FRONT_TOUCHDOWN_CLEARANCE,
  gpFrontSteeringContact,
  gpFrontWheelClearance,
} from '../src/simulation/gp-front-contact.ts';
import { B, BIKE_BASE, F, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const GP = ['gpr1', 'gpr2'] as const;
const RAW = { ...EXPERT, lean: true };
const control: BikeInput = {
  lean: 0.15,
  rider: 0.15,
  throttle: 1,
  drive: 6000,
  frontBrake: 0,
  rearBrake: 0,
};
const parameters = (id: string, wheelieMap = 3) =>
  new BikeVehicle(0, 'medium', { ...DEFAULT_SETUP, wheelieMap }, 'sport', VEHICLES[id]).dynamics.p;

describe('GP front-contact steering', () => {
  it('opts in only the two GP prototypes and retains steering through a fully supported front', () => {
    for (const id of GP) {
      const bike = new Bike(RAW, parameters(id));
      expect(bike.p.frontContactSteering).toBe(true);
      bike.speed = 30;
      bike.steer = 0.02;
      bike.lean = 0.2;
      const grounded = bike.curvature;
      const staticLoad = (bike.mass * G * bike.p.cgToRear) / bike.p.wheelbase;
      // No aero in this contact-ramp fixture; the complete launch below
      // exercises the prototype's real speed-dependent wing contribution.
      const bare = new Bike(RAW, { ...bike.p, downforce: 0 });
      bare.speed = bike.speed;
      bare.steer = bike.steer;
      bare.lean = bike.lean;
      const curvatures = [0, 0.01, 0.025, 0.05, 0.08, 1].map((fraction) => {
        bare.frontLoad = staticLoad * fraction;
        return bare.curvature;
      });
      expect(curvatures[0]).toBe(0);
      expect(curvatures[1]).toBeGreaterThan(0);
      expect(curvatures[2]).toBeGreaterThan(curvatures[1]);
      expect(curvatures[3]).toBe(grounded);
      expect(curvatures[4]).toBe(grounded);
      expect(curvatures[5]).toBe(grounded);
      // A restored quasi-static load does not put the still-raised wheel
      // on the road. The last 2 mm blend to exactly full contact at zero.
      bare.pitch = 0.2;
      expect(bare.curvature).toBe(0);
      expect(gpFrontWheelClearance(bare.pitch, bare.p.wheelbase)).toBeGreaterThan(0.25);
      bare.pitch = Math.asin(GP_FRONT_TOUCHDOWN_CLEARANCE / 2 / bare.p.wheelbase);
      expect(bare.curvature).toBeCloseTo(grounded / 2, 12);
      bare.pitch = 0;
      expect(bare.curvature).toBe(grounded);
      bare.pitch = -0.2;
      expect(bare.curvature).toBe(grounded);
    }
    for (const id of ['sbk1000', 'ss600', 'nr900', 'cr750', 'mx450', 'mx250', 'sm450']) {
      const bike = new Bike(RAW, parameters(id));
      expect(bike.p.frontContactSteering).toBeUndefined();
      bike.steer = 0.02;
      const preceding = bike.curvature;
      bike.frontLoad = 0;
      expect(bike.curvature).toBe(preceding);
    }
  });

  it.each([
    ['gpr1', 1 / 120],
    ['gpr1', 1 / 240],
    ['gpr2', 1 / 120],
    ['gpr2', 1 / 240],
  ] as const)('%s stops road steering with no front support and regains it at dt %s', (id, dt) => {
    const p = parameters(id);
    const bike = new Bike(RAW, p);
    const preceding = new Bike(RAW, { ...p, frontContactSteering: false });
    bike.speed = preceding.speed = 14;
    let lifted = 0;
    let precedingLiftYaw = 0;
    let peakSlip = 0;
    for (let i = 0; i < 0.25 / dt; i++) {
      const heading = bike.heading;
      const precedingHeading = preceding.heading;
      bike.step(control, dt);
      preceding.step(control, dt);
      expect(bike.state).toBe('riding');
      expect(bike.speed).toBe(preceding.speed);
      expect(bike.pitch).toBe(preceding.pitch);
      expect(bike.rearSlip).toBe(preceding.rearSlip);
      peakSlip = Math.max(peakSlip, bike.rearSlip);
      if (bike.frontLoad === 0) {
        lifted++;
        expect(bike.heading).toBe(heading);
        expect(Math.abs(bike.curvature)).toBe(0);
        expect(bike.frontUse).toBe(0);
        expect(Math.abs(bike.steer)).toBeGreaterThan(0);
      }
      if (preceding.frontLoad === 0)
        precedingLiftYaw += Math.abs(preceding.heading - precedingHeading);
    }
    expect(lifted).toBeGreaterThan(20);
    expect(precedingLiftYaw).toBeGreaterThan(0.005);
    expect(bike.pitch).toBeGreaterThan(0.3);
    // The contact gate does not cut power, erase wheelspin or balance the
    // chassis. The rider must reduce torque to bring the front load back.
    expect(bike.intervention).toBe(0);
    expect(peakSlip).toBeGreaterThan(0);
    let recoveredYaw = 0;
    let descendingWithLoad = 0;
    let touchdown = 0;
    for (let i = 0; i < 1.25 / dt; i++) {
      const heading = bike.heading;
      bike.step({ ...control, throttle: 0, drive: 0 }, dt);
      recoveredYaw += Math.abs(bike.heading - heading);
      expect(bike.frontLoad).toBeGreaterThan(100);
      expect(bike.state).toBe('riding');
      if (gpFrontWheelClearance(bike.pitch, bike.p.wheelbase) >= GP_FRONT_TOUCHDOWN_CLEARANCE) {
        descendingWithLoad++;
        expect(bike.heading).toBe(heading);
        expect(Math.abs(bike.curvature)).toBe(0);
      }
      if (bike.pitch === 0 && touchdown === 0) touchdown = (i + 1) * dt;
    }
    expect(descendingWithLoad * dt).toBeGreaterThan(0.6);
    expect(touchdown).toBeGreaterThan(0.65);
    expect(touchdown).toBeLessThan(0.85);
    expect(recoveredYaw).toBeGreaterThan(0.02);
    expect(bike.pitch).toBe(0);
    expect(bike.curvature).toBe((Math.tan(bike.steer) / bike.p.wheelbase) * Math.cos(bike.lean));
  });

  it.each(GP)('%s preserves exact supported Sport and Raw trajectories', (id) => {
    for (const aids of [NOVICE, RAW])
      for (const wheelieMap of [1, 3, 5])
        for (const grip of [1, 0.4])
          for (const dt of [1 / 120, 1 / 240]) {
            const p = parameters(id, wheelieMap);
            const bike = new Bike(aids, p);
            const preceding = new Bike(aids, { ...p, frontContactSteering: false });
            bike.speed = preceding.speed = 35;
            bike.grip = preceding.grip = grip;
            for (let i = 0; i < 3 / dt; i++) {
              const t = i * dt;
              const braking = t > 1 && t < 2;
              const input = {
                ...control,
                lean: 0.35 * Math.sin(t * 2),
                rider: 0.35 * Math.sin(t * 2),
                throttle: braking ? 0 : 0.4,
                drive: braking ? 0 : aids === NOVICE ? 6000 : 500,
                frontBrake: braking ? (aids === NOVICE ? 0.4 : 0.03) : 0,
              };
              bike.step(input, dt);
              preceding.step(input, dt);
              expect(bike.frontLoad).toBeGreaterThan(0);
              if (i % 30 === 0) expect({ ...bike, p: null }).toEqual({ ...preceding, p: null });
            }
            expect(bike.state).toBe('riding');
            expect({ ...bike, p: null }).toEqual({ ...preceding, p: null });
          }
  });

  it.each(GP)('%s still loops under an uncontrolled raw launch', (id) => {
    const bike = new Bike(RAW, parameters(id));
    bike.speed = 14;
    for (let i = 0; i < 240 && bike.state === 'riding'; i++)
      bike.step({ ...control, lean: 0, rider: 0 }, 1 / 240);
    expect(bike.state).toBe('highside');
    expect(bike.crashes).toBe(1);
    expect(bike.intervention).toBe(0);
  });

  it('publishes actual lift forces and reproduces a GP launch and release through flashback', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      mode: 'practice' as const,
      ruleset: 'gp-motorcycle' as const,
      opponents: 0,
      vehicles: ['gpr1'],
      assist: 'raw' as const,
      seed: 4417,
    };
    const sim = new Simulation(options);
    const log = new InputLog();
    const bike = sim.cars[0] as BikeVehicle;
    const base = carBase(0);
    let liftTick = 0;
    let releaseTick = 0;
    let descendingFrames = 0;
    const frames = new Map<number, Float32Array>();
    const input = (throttle: number, steer: number) => {
      const value = { ...controls(), throttle, steer };
      log.input(sim.tick, value);
      sim.setInput(value);
    };
    input(1, 0);
    for (let i = 0; i < 1200; i++) {
      if (!liftTick && bike.dynamics.frontLoad === 0 && bike.dynamics.pitch > 0.02) {
        liftTick = sim.tick;
        input(1, 0.15);
      }
      if (liftTick && !releaseTick && sim.tick >= liftTick + 12) {
        releaseTick = sim.tick;
        input(0, 0.15);
      }
      sim.step(FLASHBACK.dt);
      if (liftTick && !releaseTick) {
        const frame = sim.makeFrame();
        expect(bike.dynamics.frontLoad).toBe(0);
        expect(frame[base + BIKE_BASE + B.FRONT_LOAD]).toBe(0);
        expect(Math.abs(frame[base + F.WY])).toBe(0);
        expect(Math.abs(frame[base + WHEEL_BASE + W.FY])).toBe(0);
        expect(Math.abs(bike.body.omega.y)).toBe(0);
        frames.set(sim.tick, frame);
      }
      if (
        releaseTick &&
        gpFrontWheelClearance(bike.dynamics.pitch, bike.dynamics.p.wheelbase) >=
          GP_FRONT_TOUCHDOWN_CLEARANCE
      ) {
        const frame = sim.makeFrame();
        descendingFrames++;
        expect(bike.dynamics.frontLoad).toBeGreaterThan(100);
        expect(Math.abs(frame[base + F.WY])).toBe(0);
        expect(Math.abs(frame[base + WHEEL_BASE + W.FY])).toBe(0);
        expect(gpFrontSteeringContact(frame[base + BIKE_BASE + B.PITCH], bike.spec.wheelbase)).toBe(
          0,
        );
        frames.set(sim.tick, frame);
      }
      if (releaseTick && sim.tick >= releaseTick + 90) {
        frames.set(sim.tick, sim.makeFrame());
        break;
      }
    }
    expect(liftTick).toBeGreaterThan(0);
    expect(releaseTick).toBe(liftTick + 12);
    expect(descendingFrames).toBeGreaterThan(5);
    expect(bike.riding).toBe(true);
    expect(bike.dynamics.pitch).toBe(0);
    expect(bike.dynamics.frontLoad).toBeGreaterThan(100);
    expect(Math.abs(bike.dynamics.curvature)).toBeGreaterThan(0.001);
    const replay = new Resimulation(options, log.entries, sim.tick);
    let checked = 0;
    while (!replay.done) {
      replay.run(1);
      const expected = frames.get(replay.simulation.tick);
      if (expected) {
        expect(replay.simulation.makeFrame()).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(frames.size);
    expect(checked).toBeGreaterThan(10);
  });
});
