import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FLASHBACK, InputLog, Resimulation, applyLoggedInput } from '../src/core/flashback.ts';
import { clamp, mod } from '../src/core/math.ts';
import { BikeShells } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { sampleMxFootField } from '../src/rendering/offroad/mx-foot-pose.ts';
import { sampleOffroadField } from '../src/rendering/snapshot-interpolation.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  MX_FOOT,
  MX_FOOT_TRAJECTORY as S,
  MX_POSTURE,
  O,
  OFFROAD_BASE,
  WHEEL_CONTACT_BASE,
  WHEEL_CONTACT_SIZE,
  carBase,
  hasMxRiderPosture,
} from '../src/simulation/protocol.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

const car = carBase(0),
  offroad = car + OFFROAD_BASE,
  bikeBlock = car + BIKE_BASE;
const footFields = Object.values(MX_FOOT);
const postureFields = [O.STANDING, O.DAB, O.BODY] as const;
const rapidShifts = [1, 1, -1, 1, -1, -1, 1, -1, 1, 1, -1, -1];
const scenarios = (['valley-ridge-mx', 'arena-nord-sx'] as const).flatMap((circuit) =>
  (['mx250', 'mx450'] as const).map((vehicle) => ({ circuit, vehicle })),
);
type Scenario = (typeof scenarios)[number];

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

/** A normal practice start, with every command passing the worker's public
 * boundary. The driver reads the course and bike, but never places a bike,
 * writes dynamics, invokes a private solver, or enables the AI adapter. */
function drive(scenario: Scenario) {
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    ...scenario,
    vehicles: [scenario.vehicle],
    opponents: 0,
    mode: 'practice',
    ruleset: 'motocross-moto',
    seed: 292026,
  };
  const sim = new Simulation(options),
    log = new InputLog(),
    bike = sim.cars[0] as DirtBikeVehicle;
  const point = trackPoint(),
    frames = [sim.makeFrame()],
    shifts: number[] = [],
    boundaries: number[] = [];
  let airborne = false,
    gear = bike.gear,
    takeoff = 0,
    touchdown = 0,
    end = 4800;
  while (sim.tick < end) {
    const tick = sim.tick;
    let input: Controls;
    if (tick < 160) {
      input = {
        ...controls(),
        brake: 1,
        steer: tick % 72 < 36 ? 0.6 : -0.6,
        riderLean: tick % 96 < 48 ? 0.8 : -0.8,
        shift: tick >= 8 && tick <= 96 && tick % 8 === 0 ? rapidShifts[tick / 8 - 1] : 0,
      };
    } else {
      sim.track.at(bike.s + Math.max(4, bike.speed * 0.7), point);
      const heading = Math.atan2(point.x - bike.dynamics.x, point.z - bike.dynamics.z);
      const error = mod(heading - bike.heading + Math.PI, Math.PI * 2) - Math.PI;
      const speedError = (scenario.circuit === 'valley-ridge-mx' ? 8 : 6) - bike.speed;
      input = {
        ...controls(),
        throttle: clamp(speedError * 0.5 + 0.25, 0, 1),
        brake: clamp(-speedError * 0.3, 0, 1),
        steer: clamp(error * 1.8 - 0.15 * bike.dynamics.leanRate, -0.65, 0.65),
        riderLean: tick % 180 < 60 ? 0.35 : tick % 180 < 120 ? -0.35 : 0,
      };
      if (tick % 60 === 0 && bike.rpm > bike.spec.shiftRPM * 0.88) input.shift = 1;
      if (bike.airborne) {
        const correction =
          (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
            Math.max(0.12, bike.landingIn) -
          bike.pitchRate;
        input.throttle = clamp(correction * 1.2, 0, 1);
        input.rearBrake = clamp(-correction * 1.2, 0, 1);
        input.brake = input.steer = 0;
      }
    }
    if (tick % 2 === 0) applyLoggedInput(sim, log, input);
    sim.step(FLASHBACK.dt);
    const frame = sim.makeFrame();
    frames.push(frame);
    if (bike.gear !== gear) {
      shifts.push(sim.tick);
      gear = bike.gear;
    }
    if (bike.airborne !== airborne) {
      boundaries.push(sim.tick);
      if (bike.airborne && !touchdown) takeoff = sim.tick;
      if (airborne && !bike.airborne && !touchdown && (bike.lastLanding?.airTime ?? 0) > 0.3) {
        touchdown = sim.tick;
        end = touchdown + 32;
      }
      airborne = bike.airborne;
    }
    if (bike.riding) {
      const posture = bike.postureMotion!;
      expect(frame[car + MX_POSTURE.STANDING_RATE]).toBe(Math.fround(posture.standingRate));
      expect(frame[car + MX_POSTURE.DAB_RATE]).toBe(Math.fround(posture.dabRate));
      expect(frame[car + MX_POSTURE.BODY_RATE]).toBe(Math.fround(bike.riderBodyRate));
    }
  }
  return {
    sim,
    options,
    log,
    frames,
    shifts,
    boundaries,
    takeoff,
    touchdown,
    lastLanding: structuredClone(bike.lastLanding),
  };
}
type Trace = ReturnType<typeof drive>;
const traces = new Map<string, Trace>();
function trace(scenario: Scenario) {
  const key = `${scenario.circuit}/${scenario.vehicle}`;
  if (!traces.has(key)) traces.set(key, drive(scenario));
  return traces.get(key)!;
}

/** These are the actual recorded machine/rider channels, including every
 * optional derivative and accepted-event seed, not only chassis position. */
function motion(frame: Float32Array) {
  return [
    ...frame.subarray(bikeBlock, offroad + Object.keys(O).length),
    ...frame.subarray(car + WHEEL_CONTACT_BASE, car + WHEEL_CONTACT_BASE + WHEEL_CONTACT_SIZE),
  ];
}

function record(frames: readonly Float32Array[]) {
  const recorder = new ReplayRecorder(1, 64);
  for (const frame of frames) recorder.append(frame);
  return recorder;
}

function sampleTicks(run: Trace) {
  return [
    ...new Set([
      12,
      20,
      28,
      36,
      44,
      52,
      60,
      68,
      76,
      84,
      92,
      100,
      47,
      49,
      71,
      73,
      95,
      97,
      121,
      145,
      ...run.boundaries.flatMap((tick) => [tick - 1, tick, tick + 1]),
      run.takeoff + 12,
      run.takeoff + 36,
      run.touchdown - 12,
      run.touchdown + 12,
    ]),
  ]
    .filter((tick) => tick > 0 && tick < run.frames.length - 8)
    .sort((a, b) => a - b);
}

function branchInput(sim: Simulation, elapsed: number): Controls {
  const bike = sim.cars[0] as DirtBikeVehicle;
  const input = {
    ...controls(),
    throttle: 0.18,
    brake: 0.12,
    riderLean: elapsed < 40 ? -0.8 : elapsed < 96 ? 0.8 : -0.3,
  };
  // The command is accepted/rejected by the normal gearbox; no gear, cut
  // timer or trajectory seed is injected on the resumed timeline.
  if (elapsed < 48 && elapsed % 8 === 0) input.shift = elapsed % 16 === 0 ? 1 : -1;
  if (bike.airborne) input.rearBrake = 0.1;
  return input;
}

describe('motocross dynamics through the real input journal', () => {
  it.each(scenarios)(
    '$vehicle/$circuit restores interior motion across sliced flashback and a flight branch',
    (scenario) => {
      const run = trace(scenario),
        end = run.frames.length - 1;
      expect(run.sim.autoPlayer).toBe(false);
      expect(run.log.entries.every((entry) => entry.kind === 'input')).toBe(true);
      expect(run.shifts.slice(0, rapidShifts.length)).toEqual(
        rapidShifts.map((_, index) => 9 + index * 8),
      );
      expect(8 * FLASHBACK.dt).toBeGreaterThanOrEqual(0.06);
      expect(run.takeoff).toBeGreaterThan(160);
      expect(run.touchdown - run.takeoff).toBeGreaterThan(36);
      expect(run.frames[run.takeoff][offroad + O.AIRBORNE]).toBe(1);
      expect(run.frames[run.touchdown][offroad + O.AIRBORNE]).toBe(0);
      for (const field of [O.DAB, O.BODY]) {
        const values = run.frames.map((frame) => frame[offroad + field]);
        expect(Math.min(...values)).toBeLessThan(-0.5);
        expect(Math.max(...values)).toBeGreaterThan(0.5);
      }
      expect(Math.max(...run.frames.map((frame) => frame[offroad + O.STANDING]))).toBeGreaterThan(
        0.9,
      );
      const checkpoints = [...new Set([...sampleTicks(run), end])].sort((a, b) => a - b);
      for (const budgeted of [false, true]) {
        let wall = 0,
          slice = 0;
        const replay = new Resimulation(run.options, run.log.entries, end, {
          now: () => (budgeted ? (wall += 0.31) : 0),
          maxWorkMs: 1,
        });
        const caps = budgeted ? [97, 2, 211, 13] : [1, 61, 7, 137];
        for (const tick of checkpoints) {
          while (replay.simulation.tick < tick)
            replay.run(Math.min(caps[slice++ % caps.length], tick - replay.simulation.tick));
          expect(motion(replay.simulation.makeFrame()), `budget=${budgeted}, tick=${tick}`).toEqual(
            motion(run.frames[tick]),
          );
        }
        expect(replay.done).toBe(true);
        expect((replay.simulation.cars[0] as DirtBikeVehicle).lastLanding).toEqual(run.lastLanding);
      }

      const target = run.takeoff + 12,
        log = new InputLog();
      log.entries.push(...run.log.entries);
      const rewind = new Resimulation(run.options, log.entries, target, { now: () => 0 });
      while (!rewind.run(53)) {
        /* reconstruct the actual flight, not a pose load */
      }
      expect(motion(rewind.simulation.makeFrame())).toEqual(motion(run.frames[target]));
      log.truncate(target);
      const resumed = rewind.simulation,
        frames = [resumed.makeFrame()];
      for (let step = 0; step < 160; step++) {
        if (step % 2 === 0) applyLoggedInput(resumed, log, branchInput(resumed, step));
        resumed.step(FLASHBACK.dt);
        frames.push(resumed.makeFrame());
      }
      expect(
        log.entries.filter(
          (entry) => entry.tick >= target && entry.kind === 'input' && entry.input.shift,
        ),
      ).toHaveLength(6);
      expect(frames[32][offroad + O.BODY]).not.toBe(run.frames[target + 32][offroad + O.BODY]);
      const repeated = new Resimulation(run.options, log.entries, resumed.tick, { now: () => 0 });
      const display = new PresentedFrame();
      while (repeated.simulation.tick < target)
        repeated.run(Math.min(89, target - repeated.simulation.tick));
      let previous = repeated.simulation.makeFrame();
      for (let step = 4; step <= 160; step += 4) {
        repeated.run(4);
        const current = repeated.simulation.makeFrame();
        expect(motion(current)).toEqual(motion(frames[step]));
        for (const alpha of [0.125, 0.5, 0.875]) {
          const expected = motion(display.sample(frames[step - 4], frames[step], alpha));
          expect(motion(display.sample(previous, current, alpha))).toEqual(expected);
        }
        previous = current;
      }
      expect((repeated.simulation.cars[0] as DirtBikeVehicle).lastLanding).toEqual(
        (resumed.cars[0] as DirtBikeVehicle).lastLanding,
      );
    },
  );

  it.each(scenarios)(
    '$vehicle/$circuit preserves measured interior poses through compact recording and seeks',
    (scenario) => {
      const run = trace(scenario),
        recorder = record(run.frames);
      const left = recorder.makeFrame(),
        right = recorder.makeFrame(),
        display = new PresentedFrame();
      let footError = 0,
        footLinearError = 0,
        footSamples = 0;
      const postureError = [0, 0, 0],
        linearError = [0, 0, 0],
        postureSamples = [0, 0, 0];
      for (let tick = 9; tick < run.frames.length - 8; tick++) {
        if (tick % 2 === 0 || tick % 8 === 0) continue;
        const alpha = recorder.sample(run.frames[tick][H.TIME] - recorder.start, left, right);
        const a = run.frames[left[H.TICK]],
          b = run.frames[right[H.TICK]];
        expect(motion(left)).toEqual(motion(a));
        expect(motion(right)).toEqual(motion(b));
        const shown = display.sample(left, right, alpha);
        for (const field of footFields) {
          expect(shown[car + field]).toBe(Math.fround(sampleMxFootField(a, b, car, field, alpha)));
          if (
            left[car + S.RECORDED] &&
            right[car + S.RECORDED] &&
            left[bikeBlock + B.STATE] === 0 &&
            right[bikeBlock + B.STATE] === 0
          ) {
            const truth = run.frames[tick][car + field];
            footError = Math.max(footError, Math.abs(shown[car + field] - truth));
            footLinearError = Math.max(
              footLinearError,
              Math.abs(a[car + field] + (b[car + field] - a[car + field]) * alpha - truth),
            );
            footSamples++;
          }
        }
        for (const [channel, field] of postureFields.entries()) {
          expect(shown[offroad + field]).toBe(
            Math.fround(sampleOffroadField(a, b, car, field, alpha)),
          );
          // Compare the published curve to independent intervening physics
          // observations while both endpoints retain the ridden contract.
          if (!hasMxRiderPosture(left, car) || !hasMxRiderPosture(right, car)) continue;
          const truth = run.frames[tick][offroad + field];
          postureError[channel] += Math.abs(shown[offroad + field] - truth);
          linearError[channel] += Math.abs(
            a[offroad + field] + (b[offroad + field] - a[offroad + field]) * alpha - truth,
          );
          postureSamples[channel]++;
        }
      }
      expect(footSamples).toBeGreaterThan(3000);
      expect(footError).toBeLessThan(3e-4);
      expect(footLinearError).toBeGreaterThan(0.1);
      for (let channel = 0; channel < postureFields.length; channel++) {
        expect(postureSamples[channel]).toBeGreaterThan(1000);
        expect(postureError[channel]).toBeLessThan(linearError[channel]);
      }

      const probes = sampleTicks(run),
        expected = new Map<number, number[]>();
      const sources = probes.map((tick) => run.frames[tick].slice());
      const shells = new BikeShells(),
        host = { root: new T.Object3D() };
      const camera = new T.PerspectiveCamera(58, 16 / 9),
        posed = vi.spyOn(DirtBikeModel.prototype, 'pose');
      let wall = 0;
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => wall);
      const render = (tick: number) => {
        const alpha = recorder.sample(run.frames[tick][H.TIME] - recorder.start, left, right);
        const before = left.slice(),
          after = right.slice();
        expect(display.sample(left, right, 0)).toEqual(left);
        expect(display.sample(left, right, 1)).toEqual(right);
        const shown = display.sample(left, right, alpha);
        host.root.position.fromArray(shown, car + F.X);
        host.root.quaternion.fromArray(shown, car + F.QX);
        camera.position.copy(host.root.position);
        camera.position.z -= 2;
        shells.update(left, right, alpha, [host], camera, 'low', 0);
        const drawn = posed.mock.lastCall![0];
        for (const [field, value] of [
          [O.STANDING, drawn.standing],
          [O.DAB, drawn.dab],
          [O.BODY, drawn.body],
        ])
          expect(shown[offroad + field!]).toBe(Math.fround(value!));
        [drawn.shiftAngle, drawn.shiftCover, drawn.shiftClear].forEach((value, channel) =>
          expect(shown[car + footFields[channel]]).toBe(Math.fround(value!)),
        );
        shells.root.updateMatrixWorld(true);
        const matrices = [
          'Rider torso',
          'Rider head and helmet',
          'Motocross lumbar spine',
          'Motocross upper chest',
          'Motocross left boot',
          'Motocross right boot',
          'Motocross gear selector',
        ].flatMap((name) => {
          const joint = shells.root.getObjectByName(name);
          expect(joint, name).toBeDefined();
          return joint!.matrixWorld.elements.slice();
        });
        expect(left).toEqual(before);
        expect(right).toEqual(after);
        return matrices;
      };
      try {
        for (const tick of probes) expected.set(tick, render(tick));
        const liveBike = run.sim.cars[0] as DirtBikeVehicle,
          liveClock = liveBike.clock;
        for (let step = 0; step < 96; step++) {
          if (step % 2 === 0)
            applyLoggedInput(run.sim, null, {
              ...controls(),
              brake: 0.6,
              riderLean: step < 48 ? 1 : -1,
              shift: step < 32 && step % 8 === 0 ? 1 : 0,
            });
          run.sim.step(FLASHBACK.dt);
          run.sim.makeFrame();
        }
        expect(liveBike.clock).toBeGreaterThan(liveClock + 0.5);
        // Wall time, a different seek order, and repeated pause samples must
        // never advance a spring or borrow the current live adapter clock.
        for (const tick of [...probes].reverse().concat(probes.slice(0, 8))) {
          wall += 86400_000;
          expect(render(tick)).toEqual(expected.get(tick));
          expect(render(tick)).toEqual(expected.get(tick));
        }
        expect(display.sample(left, left, 0.37)).toEqual(left);
        for (const [index, tick] of probes.entries())
          expect(run.frames[tick]).toEqual(sources[index]);
      } finally {
        clock.mockRestore();
        posed.mockRestore();
        shells.disposeAll();
      }
      if (process.env.MX_REPLAY_METRICS)
        console.info({
          ...scenario,
          ticks: run.frames.length - 1,
          takeoff: run.takeoff,
          touchdown: run.touchdown,
          footError,
          footLinearError,
          postureMean: postureError.map((error, channel) => error / postureSamples[channel]),
          linearMean: linearError.map((error, channel) => error / postureSamples[channel]),
          poseSeeks: probes.length * 3 + 16,
        });
    },
  );

  it('detects a missing repeated shift edge in an otherwise identical real MX input journal', () => {
    const run = trace(scenarios[0]),
      target = 24;
    const log = run.log.entries.filter((entry) => entry.tick !== 16);
    const replay = new Resimulation(run.options, log, target, { now: () => 0 });
    while (!replay.run(7)) {
      /* the second identical upshift was deliberately omitted */
    }
    const frame = replay.simulation.makeFrame();
    expect(run.frames[target][car + F.GEAR]).toBe(3);
    expect(frame[car + F.GEAR]).toBe(2);
    expect(frame[car + S.EVENT]).not.toBe(run.frames[target][car + S.EVENT]);
    expect(motion(frame)).not.toEqual(motion(run.frames[target]));
  });

  it('keeps the valid unmarked recording contract for actual moving rider and boot endpoints', () => {
    const run = trace(scenarios[0]),
      a = run.frames[40].slice(),
      b = run.frames[48].slice();
    for (const frame of [a, b]) {
      frame.fill(0, car + MX_POSTURE.RECORDED, car + MX_POSTURE.BODY_RATE + 1);
      frame.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
    }
    const recorder = record([a, b]),
      left = recorder.makeFrame(),
      right = recorder.makeFrame();
    const display = new PresentedFrame();
    expect(recorder.count).toBe(2);
    for (const fraction of [0.125, 0.875, 0.5, 0, 1, 0.125]) {
      const alpha = recorder.sample(recorder.duration * fraction, left, right);
      expect(hasMxRiderPosture(left, car)).toBe(false);
      expect(left[car + S.RECORDED]).toBe(0);
      const shown = display.sample(left, right, alpha);
      for (const field of [...footFields, ...postureFields.map((field) => OFFROAD_BASE + field)]) {
        const linear = a[car + field] + (b[car + field] - a[car + field]) * alpha;
        expect(shown[car + field]).toBe(Math.fround(linear));
      }
    }
  });
});
