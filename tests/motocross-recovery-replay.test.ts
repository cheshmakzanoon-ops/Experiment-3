import { describe, expect, it } from 'vitest';
import { FLASHBACK, InputLog, Resimulation, applyLoggedInput } from '../src/core/flashback.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';

const scenarios = (['valley-ridge-mx', 'arena-nord-sx'] as const).flatMap((circuit) =>
  (['mx250', 'mx450'] as const).map((vehicle) => ({ circuit, vehicle })),
);

/** Include full binary snapshots and unrounded outputs that intentionally do
 * not belong to the presentation protocol. Reconstruct these from the actual
 * input journal, never by loading a saved pose or writing private state. */
function capture(sim: Simulation) {
  const bike = sim.cars[0] as DirtBikeVehicle,
    d = bike.dynamics,
    frame = sim.makeFrame();
  return {
    frame: new Uint32Array(frame.buffer.slice(0)),
    state: d.state,
    stateClock: d.stateClock,
    commands: [d.assistedDriveForce, d.frontBrakeAssistLimit, d.rearBrakeAssistLimit],
    chassis: [d.x, d.z, d.heading, d.speed, bike.cgY, bike.vy, bike.pitch, bike.pitchRate],
    rider: [bike.rider.x, bike.rider.y, bike.rider.z, bike.riderHeading],
    body: [bike.riderBody, bike.riderBodyRate],
    rotors: [bike.frontSpin, bike.rearSpin],
    budget: bike.remountBudgetSeconds,
    crashes: d.crashes,
    input: { ...bike.input },
  };
}

function naturalRecovery(scenario: (typeof scenarios)[number]) {
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    circuit: scenario.circuit,
    vehicles: [scenario.vehicle],
    opponents: 0,
    mode: 'practice',
    ruleset: 'motocross-moto',
    assist: 'raw',
    seed: 362026,
  };
  const sim = new Simulation(options),
    bike = sim.cars[0] as DirtBikeVehicle,
    log = new InputLog(),
    frames = [capture(sim)],
    transitions: number[] = [];
  let state = bike.dynamics.state,
    crash = 0,
    remount = 0,
    resumed = 0,
    peakDrive = 0;
  // A full throttle launch with backward weight produces a real loop-out.
  // Held drive/brake/body commands during recovery exercise the core's early
  // return and the remount handoff. No fall or remount is injected by the test.
  while (sim.tick < 2400 && (!resumed || sim.tick < resumed + 72)) {
    const elapsed = resumed ? sim.tick - resumed : 0;
    const input = !crash
      ? { ...controls(), throttle: 1, riderLean: -0.8 }
      : !resumed
        ? { ...controls(), throttle: 0.7, brake: 0.8, rearBrake: 0.55, riderLean: 0.8 }
        : elapsed < 24
          ? { ...controls(), throttle: 0.35, riderLean: 0.6 }
          : elapsed < 48
            ? { ...controls(), brake: 0.65, rearBrake: 0.5, riderLean: -0.6 }
            : { ...controls(), throttle: 0.2, riderLean: 0.25 };
    if (sim.tick % 2 === 0) applyLoggedInput(sim, log, input);
    sim.step(FLASHBACK.dt);
    peakDrive = Math.max(peakDrive, bike.dynamics.assistedDriveForce);
    if (bike.dynamics.state !== state) {
      transitions.push(sim.tick);
      if (!crash && state === 'riding') crash = sim.tick;
      if (!remount && bike.dynamics.state === 'remount') remount = sim.tick;
      if (crash && bike.riding && !resumed) resumed = sim.tick;
      state = bike.dynamics.state;
    }
    const saved = capture(sim);
    if (!bike.riding) expect(saved.commands).toEqual([0, 0, 0]);
    frames.push(saved);
  }
  expect(crash).toBeGreaterThan(0);
  expect(remount).toBeGreaterThan(crash);
  expect(resumed).toBeGreaterThan(remount);
  expect(peakDrive).toBeGreaterThan(100);
  expect(bike.dynamics.crashes).toBe(1);
  expect(bike.crashCauses.some(({ cause }) => cause === 'loop-out')).toBe(true);
  expect(bike.riding).toBe(true);
  expect(Number.isFinite(frames[remount].budget)).toBe(true);
  expect((resumed - remount) * FLASHBACK.dt).toBeLessThanOrEqual(
    frames[remount].budget + 2 * FLASHBACK.dt,
  );
  expect(log.entries.every(({ kind }) => kind === 'input')).toBe(true);
  return { options, sim, log, frames, transitions, crash, remount, resumed };
}

describe('motocross recovery through the real input journal', () => {
  it.each(scenarios)(
    '$vehicle/$circuit reconstructs a natural crash, remount and fresh actuator commands',
    (scenario) => {
      const run = naturalRecovery(scenario),
        end = run.sim.tick,
        checkpoints = new Set<number>([0, end]);
      for (let tick = 16; tick < end; tick += 16) checkpoints.add(tick);
      for (const tick of [...run.transitions, run.resumed + 24, run.resumed + 48])
        for (const offset of [-1, 0, 1]) checkpoints.add(tick + offset);
      let wall = 0,
        slice = 0;
      const replay = new Resimulation(run.options, run.log.entries, end, {
        now: () => (wall += 0.31),
        maxWorkMs: 1,
      });
      const caps = [1, 137, 3, 61];
      for (const tick of [...checkpoints].sort((a, b) => a - b)) {
        while (replay.simulation.tick < tick)
          replay.run(Math.min(caps[slice++ % caps.length], tick - replay.simulation.tick));
        expect(capture(replay.simulation), `tick ${tick}`).toEqual(run.frames[tick]);
      }
      expect(replay.done).toBe(true);
      expect(replay.simulation.offroad!.terrain.hash()).toBe(run.sim.offroad!.terrain.hash());

      // A flashback may end while the rider is still walking beside the bike.
      // The resumed journal must reconstruct the gather/push/seat state and
      // discard the original future controls. Presentation queries while
      // paused cannot advance that trajectory or its new actuator budgets.
      const target = run.remount + Math.floor((run.resumed - run.remount) / 2),
        branch = new Resimulation(run.options, run.log.entries, target, { now: () => 0 });
      while (!branch.run(53)) {
        /* reconstruct the actual recovery */
      }
      expect(capture(branch.simulation)).toEqual(run.frames[target]);
      expect((branch.simulation.cars[0] as DirtBikeVehicle).dynamics.state).toBe('remount');
      const paused = branch.simulation.makeFrame(),
        display = new PresentedFrame();
      for (const alpha of [0.5, 0, 1, 0.125, 0.5])
        expect(display.sample(paused, paused, alpha)).toEqual(paused);
      expect(capture(branch.simulation)).toEqual(run.frames[target]);

      const log = new InputLog();
      log.entries.push(...run.log.entries);
      log.truncate(target);
      const resumed = branch.simulation;
      let changedRiddenMotion = false;
      for (let step = 0; step < 240; step++) {
        if (step % 2 === 0)
          applyLoggedInput(resumed, log, {
            ...controls(),
            throttle: step < 120 ? 0.15 : 0.3,
            brake: step >= 60 && step < 120 ? 0.6 : 0,
            rearBrake: step >= 60 && step < 120 ? 0.4 : 0,
            riderLean: step < 60 || step >= 120 ? -0.6 : 0.7,
          });
        resumed.step(FLASHBACK.dt);
        if (resumed.tick === run.resumed + 24) {
          expect((resumed.cars[0] as DirtBikeVehicle).riding).toBe(true);
          expect(capture(resumed).frame).not.toEqual(run.frames[resumed.tick].frame);
          changedRiddenMotion = true;
        }
      }
      expect(changedRiddenMotion).toBe(true);
      expect((resumed.cars[0] as DirtBikeVehicle).riding).toBe(true);
      const repeated = new Resimulation(run.options, log.entries, resumed.tick, { now: () => 0 });
      while (!repeated.run(79)) {
        /* reconstruct the changed recovery branch */
      }
      expect(capture(repeated.simulation)).toEqual(capture(resumed));
      // Advancing both reconstructed engines catches latent state that is
      // absent from the snapshot and from the deliberately small capture.
      for (let step = 0; step < 48; step++) {
        const input = {
          ...controls(),
          brake: step < 24 ? 0.8 : 0,
          throttle: step >= 24 ? 0.2 : 0,
          riderLean: step < 24 ? 0.8 : -0.8,
        };
        resumed.setInput(input);
        repeated.simulation.setInput(input);
        resumed.step(FLASHBACK.dt);
        repeated.simulation.step(FLASHBACK.dt);
      }
      expect(capture(repeated.simulation)).toEqual(capture(resumed));
      expect(repeated.simulation.offroad!.terrain.hash()).toBe(resumed.offroad!.terrain.hash());
    },
  );
});
