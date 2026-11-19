import { describe, expect, it } from 'vitest';
import { FLASHBACK, InputLog, Resimulation, applyLoggedInput } from '../src/core/flashback.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import {
  DEFAULT_OPTIONS,
  controls,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';

const checkpoints = [300, 600, 900, 1200];
const thermalFields = [
  'surfaceTemp',
  'carcassTemp',
  'coreTemp',
  'discTemp',
  'pressure',
  'wear',
  'energy',
  'omega',
  'load',
  'fx',
  'fy',
] as const;

/** Compare the full binary presentation frame and unrounded physical state.
 * Continuation below also checks memory that is deliberately absent from the
 * presentation protocol. These are from-start re-simulations, not pose loads. */
function capture(sim: Simulation) {
  const car = sim.cars[0],
    frame = sim.makeFrame(),
    bike = car instanceof BikeVehicle ? car : null,
    gp = bike?.dynamics.motoGP,
    mx = car instanceof DirtBikeVehicle ? car : null;
  return {
    frame: new Uint32Array(frame.buffer.slice(0)),
    input: { ...car.input },
    autoPlayer: sim.autoPlayer,
    engine: { ...car.engine },
    shiftClock: car.shiftClock,
    engineTorque: car.engineOutputTorque,
    jacking: [...car.jacking],
    tyres: car.tires.map((t) => Object.fromEntries(thermalFields.map((key) => [key, t[key]]))),
    road: bike
      ? {
          height: bike.roadSuspension.height,
          velocity: bike.roadSuspension.velocity,
          pitch: bike.roadSuspension.pitch,
          pitchRate: bike.roadSuspension.pitchRate,
          acceleration: bike.roadSuspension.acceleration,
          frontLoad: bike.roadSuspension.frontLoad,
          rearLoad: bike.roadSuspension.rearLoad,
          frontCompression: bike.roadSuspension.frontCompression,
          rearCompression: bike.roadSuspension.rearCompression,
          frontGap: bike.roadSuspension.frontGap,
          rearGap: bike.roadSuspension.rearGap,
          contactLoads: bike.dynamics.contactLoads ? { ...bike.dynamics.contactLoads } : null,
          lean: bike.dynamics.lean,
          leanRate: bike.dynamics.leanRate,
        }
      : null,
    gp: gp
      ? {
          forward: gp.forwardSpeed,
          lateral: gp.lateralSpeed,
          yawRate: gp.yawRate,
          steerTrim: gp.steerTrim,
          leanTarget: gp.leanTarget,
          lateralDemand: gp.lateralDemand,
          frontOmega: gp.frontOmega,
          rearOmega: gp.rearOmega,
          frontSlip: gp.frontSlip,
          rearSlip: gp.rearSlip,
          frontSlidingPower: gp.frontSlidingPower,
          rearSlidingPower: gp.rearSlidingPower,
        }
      : null,
    mx: mx
      ? {
          cgY: mx.cgY,
          vy: mx.vy,
          pitch: mx.pitch,
          pitchRate: mx.pitchRate,
          airborne: mx.airborne,
          airTime: mx.airTime,
          airYaw: mx.airYaw,
          airYawRate: mx.airYawRate,
          frontSpin: mx.frontSpin,
          rearSpin: mx.rearSpin,
          frontCompression: mx.compressionFront,
          rearCompression: mx.compressionRear,
          frontLoad: mx.forceFront,
          rearLoad: mx.forceRear,
          riderBody: mx.riderBody,
          landings: mx.landings,
          terrain: sim.offroad?.terrain.hash(),
        }
      : null,
  };
}

function toggle(sim: Simulation, log: InputLog, value: boolean) {
  log.autopilot(sim.tick, value);
  sim.autoPlayer = value;
}

function drive(sim: Simulation, log: InputLog) {
  const states = new Map<number, ReturnType<typeof capture>>();
  let held = { ...controls(), throttle: 0.18 },
    maxSpeed = 0,
    playerMxSteps = 0,
    aiMxSteps = 0;
  const initialTemperature = sim.cars[0].tires[0].surfaceTemp;
  while (sim.tick < checkpoints.at(-1)!) {
    const tick = sim.tick;
    if (tick === 60 || tick === 600) toggle(sim, log, true);
    if (tick === 180 || tick === 900) toggle(sim, log, false);
    if (tick === 300) held = { ...controls(), throttle: 0.6, steer: 0.02, riderLean: 0.4 };
    if (tick === 420) held = { ...controls(), brake: 0.35, clutch: 0.2, riderLean: -0.4 };
    if (tick === 480) held = { ...controls(), throttle: 0.4 };
    if (tick === 960) held = { ...controls(), brake: 0.2 };
    // Exactly the worker boundary, at a normal 60 Hz message cadence. The
    // first message after each handback is identical to the held payload
    // before it; only the intervening AI changed the live controls.
    if (tick % 2 === 0) applyLoggedInput(sim, log, held);
    sim.step(FLASHBACK.dt);
    const car = sim.cars[0];
    maxSpeed = Math.max(maxSpeed, car.speed);
    if (car instanceof DirtBikeVehicle) {
      if (car.dynamics.p.independentRearBrake) playerMxSteps++;
      else aiMxSteps++;
    }
    if (checkpoints.includes(sim.tick)) states.set(sim.tick, capture(sim));
  }
  return {
    states,
    maxSpeed,
    playerMxSteps,
    aiMxSteps,
    thermalChange: Math.abs(sim.cars[0].tires[0].surfaceTemp - initialTemperature),
  };
}

describe('engine flashback state and control ownership', () => {
  it.each([
    ['gpr1', 'aurel'],
    ['sbk1000', 'aurel'],
    ['mx450', 'valley-ridge-mx'],
    ['sc7', 'aurel'],
  ] as const)(
    '%s reconstructs control handback, hidden state, continuation and a new branch',
    (vehicle, circuit) => {
      const options: SessionOptions = {
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        seed: 2121,
        circuit,
        vehicles: [vehicle],
      };
      const live = new Simulation(options),
        log = new InputLog(),
        observed = drive(live, log);
      expect(observed.maxSpeed).toBeGreaterThan(3);
      expect(observed.thermalChange).toBeGreaterThan(0.01);
      expect(log.entries.some((entry) => entry.kind === 'input' && entry.tick === 180)).toBe(true);
      if (vehicle === 'mx450') {
        expect(observed.playerMxSteps).toBeGreaterThan(100);
        expect(observed.aiMxSteps).toBeGreaterThan(100);
      }
      const replay = new Resimulation(options, log.entries, live.tick);
      for (const tick of checkpoints) {
        while (replay.simulation.tick < tick)
          replay.run(Math.min(137, tick - replay.simulation.tick));
        expect(capture(replay.simulation), `tick ${tick}`).toEqual(observed.states.get(tick));
      }
      // Remove only the handback write: a falsely deduplicated journal must
      // visibly diverge. This prevents a no-motion or inactive-AI false pass.
      const missing = new Resimulation(
        options,
        log.entries.filter((entry) => !(entry.kind === 'input' && entry.tick === 180)),
        300,
      );
      while (!missing.run(79)) {
        /* bounded resimulation slices */
      }
      expect(capture(missing.simulation).frame).not.toEqual(observed.states.get(300)!.frame);

      // A matching snapshot alone is insufficient: tyre/controller memory
      // must produce the same subsequent motion at full internal precision.
      for (let step = 0; step < 180; step++) {
        if (step % 30 === 0) {
          const input = { ...controls(), throttle: 0.25 + step / 900, riderLean: -0.2 };
          live.setInput(input);
          replay.simulation.setInput(input);
        }
        live.step(FLASHBACK.dt);
        replay.simulation.step(FLASHBACK.dt);
      }
      expect(capture(replay.simulation)).toEqual(capture(live));

      const branch = new Resimulation(options, log.entries, 900);
      while (!branch.run(113)) {
        /* target-tick inputs belong to the new branch */
      }
      expect(capture(branch.simulation)).toEqual(observed.states.get(900));
      log.truncate(900);
      toggle(branch.simulation, log, false);
      for (let step = 0; step < 180; step++) {
        if (step % 2 === 0)
          applyLoggedInput(branch.simulation, log, {
            ...controls(),
            brake: 0.45,
            clutch: 0.3,
            riderLean: 0.6,
          });
        branch.simulation.step(FLASHBACK.dt);
      }
      const branchedReplay = new Resimulation(options, log.entries, branch.simulation.tick);
      while (!branchedReplay.run(97)) {
        /* reconstructed branch */
      }
      expect(capture(branchedReplay.simulation)).toEqual(capture(branch.simulation));
      expect(
        log.entries
          .filter((entry) => entry.tick >= 900)
          .every((entry) => entry.kind !== 'input' || entry.input.brake === 0.45),
      ).toBe(true);
    },
    60_000,
  );

  it('compresses a held state, but retains a write after another owner changes it', () => {
    const log = new InputLog(),
      held = { ...controls(), throttle: 0.5 },
      applied = { ...held };
    for (let tick = 0; tick < 60; tick++) log.input(tick, held, applied);
    expect(log.entries).toHaveLength(1);
    applied.brake = 1;
    log.input(60, held, applied);
    expect(log.entries.map((entry) => entry.tick)).toEqual([0, 60]);
    expect(held.brake).toBe(0);
    expect(applied.brake).toBe(1);
  });

  it('replays repeated shift edges consumed by the actual motorcycle gearbox', () => {
    const options: SessionOptions = {
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
    };
    const live = new Simulation(options),
      log = new InputLog(),
      input = { ...controls(), throttle: 0.35, shift: 1 };
    for (let tick = 0; tick < 120; tick++) {
      if (tick === 0 || tick === 30) applyLoggedInput(live, log, input);
      live.step(FLASHBACK.dt);
    }
    expect(live.cars[0].input.shift).toBe(0);
    expect(live.cars[0].gear).toBe(3);
    const replay = new Resimulation(options, log.entries, live.tick);
    while (!replay.run(47)) {
      /* each edge is applied exactly once */
    }
    expect(capture(replay.simulation)).toEqual(capture(live));
    const missing = new Resimulation(options, log.entries.slice(0, 1), live.tick);
    while (!missing.run(47)) {
      /* old duplicate suppression lost the second shift */
    }
    expect(missing.simulation.cars[0].gear).toBe(2);
  });

  it.each<Partial<Controls>>([{ shift: 1 }, { shift: -1 }, { drs: true }, { overtake: true }])(
    'retains repeated consumed edge commands %j',
    (edge) => {
      const log = new InputLog(),
        input = { ...controls(), ...edge };
      log.input(0, input, input);
      log.input(30, input, input);
      expect(log.entries.map((entry) => entry.tick)).toEqual([0, 30]);
      expect(log.entries[0]).not.toBe(log.entries[1]);
    },
  );
});
