import * as T from 'three';
import { createHash } from 'node:crypto';
import { applyLoggedInput } from '../../src/core/flashback.ts';
import { BikeShells } from '../../src/rendering/bike.ts';
import { PresentedFrame } from '../../src/rendering/frame-state.ts';
import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import type { DirtBikeVehicle } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  MX_FOOT,
  MX_FOOT_TRAJECTORY,
  MX_MOTION,
  MX_POSTURE,
  O,
  OFFROAD_BASE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { PHASE } from '../../src/simulation/race.ts';
import { Simulation } from '../../src/simulation/world.ts';

const joints = [
  'Rider head and helmet',
  'Rider torso',
  'Motocross left hand',
  'Motocross right hand',
  'Motocross left boot',
  'Motocross right boot',
  'Motocross sliding fork lowers',
  'Motocross front spinning wheel',
  'Motocross rear suspension hub',
  'Motocross articulated swingarm',
];
const fields = {
  fork: BIKE_BASE + B.FORK,
  shock: BIKE_BASE + B.SHOCK,
  steer: BIKE_BASE + B.STEER,
  standing: OFFROAD_BASE + O.STANDING,
  dab: OFFROAD_BASE + O.DAB,
  body: OFFROAD_BASE + O.BODY,
  selector: MX_FOOT.ANGLE,
  cover: MX_FOOT.COVER,
  clearance: MX_FOOT.CLEAR,
};
const rates = {
  fork: MX_MOTION.FORK_RATE,
  shock: MX_MOTION.SHOCK_RATE,
  steer: MX_MOTION.STEER_RATE,
  standing: MX_POSTURE.STANDING_RATE,
  dab: MX_POSTURE.DAB_RATE,
  body: MX_POSTURE.BODY_RATE,
};
const rapidShifts = [1, 1, -1, 1, -1, -1, 1, -1, 1, 1, -1, -1];

function requireCheck(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function recordingHash(frames: Float32Array[]) {
  const hash = createHash('sha256');
  for (const frame of frames)
    hash.update(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  return hash.digest('hex');
}

function recordingActivity(frames: Float32Array[]) {
  const slot = carBase(0),
    presented = new PresentedFrame();
  const channels = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      const values = frames.map((frame) => frame[slot + field]);
      let nonlinearSamples = 0,
        largestNonlinearDifference = 0;
      for (let i = 0; i + 1 < frames.length; i++) {
        const a = frames[i],
          b = frames[i + 1],
          alpha = 0.4;
        const difference = Math.abs(
          presented.sample(a, b, alpha)[slot + field] -
            Math.fround(a[slot + field] + (b[slot + field] - a[slot + field]) * alpha),
        );
        if (difference > 1e-7) nonlinearSamples++;
        largestNonlinearDifference = Math.max(largestNonlinearDifference, difference);
      }
      requireCheck(
        values.every(Number.isFinite) && Number.isFinite(largestNonlinearDifference),
        `Nonfinite recorded ${name}`,
      );
      return [
        name,
        {
          minimum: Math.min(...values),
          maximum: Math.max(...values),
          nonlinearSamples,
          largestNonlinearDifference,
        },
      ];
    }),
  );
  const maximumRecordedRates = Object.fromEntries(
    Object.entries(rates).map(([name, field]) => [
      name,
      Math.max(...frames.map((frame) => Math.abs(frame[slot + field]))),
    ]),
  );
  const recordedMarkers = Object.fromEntries(
    Object.entries({
      machine: MX_MOTION.VALID,
      posture: MX_POSTURE.RECORDED,
      foot: MX_FOOT_TRAJECTORY.RECORDED,
    }).map(([name, field]) => [name, frames.filter((frame) => frame[slot + field] === 1).length]),
  );
  let acceptedEventTransitions = 0;
  for (let i = 1; i < frames.length; i++)
    if (
      frames[i][slot + MX_FOOT_TRAJECTORY.EVENT] !==
        frames[i - 1][slot + MX_FOOT_TRAJECTORY.EVENT] &&
      frames[i][slot + MX_FOOT_TRAJECTORY.DIRECTION] !== 0
    )
      acceptedEventTransitions++;
  requireCheck(
    Object.values(recordedMarkers).every((count) => count > 0),
    'Missing live motion marker',
  );
  return {
    frames: frames.length,
    recordedMarkers,
    maximumRecordedRates,
    acceptedEventTransitions,
    channels,
  };
}

function jumpRecording(circuit: 'valley-ridge-mx' | 'arena-nord-sx', machine: 'mx250' | 'mx450') {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'race',
    weather: 'clear',
    ruleset: 'motocross-moto',
    laps: 4,
    opponents: 0,
    vehicles: [machine],
    seed: 61007,
  });
  sim.autoPlayer = true;
  const frames: Float32Array[] = [];
  let airborneFrames = 0,
    start = -1;
  for (let tick = 0; tick < 120 * 140; tick++) {
    sim.step(1 / 120);
    if (tick % 4 || sim.race.phase !== PHASE.RACING) continue;
    const frame = sim.makeFrame().slice();
    frames.push(frame);
    airborneFrames = frame[carBase(0) + OFFROAD_BASE + O.AIRBORNE] ? airborneFrames + 1 : 0;
    // A three-second 30 Hz recording starts 0.3 s before a real flight.
    if (start < 0 && airborneFrames === 9 && frames.length >= 22) start = frames.length - 18;
    if (start >= 0 && frames.length >= start + 92) return frames.slice(start);
  }
  throw new Error(`Missing a sustained jump for ${machine} at ${circuit}`);
}

/** The natural race window need not contain a shift or dab. This separate
 * short recording uses ordinary, braked practice-gate inputs at 60 Hz and
 * real 120 Hz simulation. No pose, gear, event seed or dynamics are injected. */
function controllerRecording(
  circuit: 'valley-ridge-mx' | 'arena-nord-sx',
  machine: 'mx250' | 'mx450',
) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    vehicles: [machine],
    opponents: 0,
    mode: 'practice',
    ruleset: 'motocross-moto',
    seed: 292026,
  });
  const bike = sim.cars[0] as DirtBikeVehicle,
    slot = carBase(0),
    frames: Float32Array[] = [];
  const acceptedShifts: number[] = [];
  let previousGear = bike.gear;
  for (let tick = 0; tick < 368; tick++) {
    if (tick % 2 === 0)
      applyLoggedInput(sim, null, {
        ...controls(),
        brake: 1,
        steer: tick % 72 < 36 ? 0.6 : -0.6,
        riderLean: tick % 96 < 48 ? 0.8 : -0.8,
        shift: tick >= 8 && tick <= 96 && tick % 8 === 0 ? rapidShifts[tick / 8 - 1] : 0,
      });
    sim.step(1 / 120);
    requireCheck(bike.riding, `Controller recording separated rider at tick ${sim.tick}`);
    if (bike.gear !== previousGear) acceptedShifts.push(bike.gear - previousGear);
    previousGear = bike.gear;
    if ((tick + 1) % 4) continue;
    const frame = sim.makeFrame(),
      posture = bike.postureMotion!;
    for (const [field, expected] of [
      [MX_POSTURE.STANDING_RATE, posture.standingRate],
      [MX_POSTURE.DAB_RATE, posture.dabRate],
      [MX_POSTURE.BODY_RATE, bike.riderBodyRate],
      [MX_FOOT.ANGLE, bike.gearStroke.angle],
      [MX_FOOT.COVER, bike.gearStroke.cover],
      [MX_FOOT.CLEAR, bike.gearStroke.clear],
    ])
      requireCheck(
        frame[slot + field] === Math.fround(expected),
        `Controller field ${field} was not recorded`,
      );
    frames.push(frame);
  }
  requireCheck(
    acceptedShifts.join(',') === rapidShifts.join(','),
    'Requested shifts were not all accepted',
  );
  return { frames, acceptedShifts: acceptedShifts.length };
}

/** Compare the ten rider and bike transforms at the six observation times
 * per second common to every refresh rate. Repeat 0.4 of a snapshot later
 * to include fractional interpolation along with exact snapshot times. */
function comparePlayback(frames: Float32Array[]) {
  const slot = carBase(0),
    reference: T.Matrix4[] = [];
  const before = recordingHash(frames),
    referenceFields: number[][] = [],
    selectorReference: T.Matrix4[] = [];
  let comparisons = 0,
    largestDifference = 0,
    probeComparisons = 0,
    selectorComparisons = 0,
    scalarComparisons = 0,
    largestProbeDifference = 0,
    largestSelectorDifference = 0,
    largestScalarDifference = 0,
    poses = 0;
  const difference = (a: T.Matrix4, b: T.Matrix4) =>
    Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])));
  for (const phase of [0, 1 / 75]) {
    reference.length = 0;
    referenceFields.length = selectorReference.length = 0;
    for (const hz of [30, 60, 120, 144, 240]) {
      const shells = new BikeShells(),
        host = { root: new T.Object3D() };
      const camera = new T.PerspectiveCamera(58, 16 / 9),
        presented = new PresentedFrame();
      const render = (frame: number, distance: number) => {
        const i = Math.floor(frame + 1e-9),
          alpha = Math.max(0, frame - i),
          a = frames[i],
          b = frames[i + 1],
          shown = presented.sample(a, b, alpha);
        host.root.position.fromArray(shown, slot + F.X);
        host.root.quaternion.fromArray(shown, slot + F.QX);
        camera.position.copy(host.root.position);
        camera.position.z += distance;
        shells.update(a, b, alpha, [host], camera, 'high', -1);
        poses++;
        return shown;
      };
      const readMatrices = () => {
        const model = shells.drawnRoot(0)!;
        model.updateMatrixWorld(true);
        return joints.map((name) => {
          const joint = model.getObjectByName(name);
          if (!joint) throw new Error(`${model.name} lacks ${name}`);
          return joint.matrixWorld;
        });
      };
      const compareFields = (shown: Float32Array, expected: number[]) => {
        Object.values(fields).forEach((field, index) => {
          largestScalarDifference = Math.max(
            largestScalarDifference,
            Math.abs(shown[slot + field] - expected[index]),
          );
          scalarComparisons++;
        });
      };
      let cursor = 0;
      try {
        for (let step = 0; step <= 3 * hz; step++) {
          const seconds = step / hz + phase;
          // Exercise the near, middle and distant cameras, then return to near.
          const shown = render(
            (step * 30) / hz + phase * 30,
            seconds < 1 ? 6 : seconds < 1.5 ? 66 : seconds < 2 ? 225 : 6,
          );
          if (step % (hz / 6)) continue;
          const observation = step / (hz / 6);
          if (hz === 30)
            referenceFields.push(Object.values(fields).map((field) => shown[slot + field]));
          else compareFields(shown, referenceFields[observation]);
          for (const matrix of readMatrices()) {
            if (hz === 30) reference.push(matrix.clone());
            else {
              largestDifference = Math.max(
                largestDifference,
                difference(reference[cursor], matrix),
              );
              comparisons++;
            }
            cursor++;
          }
        }
        // Revisit the same requested poses in reverse order, cross every LOD,
        // return to near, and repeat a paused near sample. These comparisons
        // use the original 30 Hz forward matrices, not a newly sampled oracle.
        for (let observation = 18; observation >= 0; observation--) {
          for (const [cut, distance] of [6, 66, 225, 6, 6].entries()) {
            const shown = render(observation * 5 + phase * 30, distance);
            compareFields(shown, referenceFields[observation]);
            readMatrices().forEach((matrix, joint) => {
              largestProbeDifference = Math.max(
                largestProbeDifference,
                difference(reference[observation * joints.length + joint], matrix),
              );
              probeComparisons++;
            });
            const model = shells.drawnRoot(0)!;
            const detail = distance === 225 ? 'far' : distance === 66 ? 'mid' : 'high';
            requireCheck(
              model.name.endsWith(`(${detail})`),
              `Requested ${detail}, drew ${model.name}`,
            );
            const selector = model.getObjectByName('Motocross gear selector');
            if (detail === 'far')
              requireCheck(!selector, 'Far detail unexpectedly contains a selector');
            else {
              requireCheck(!!selector, `${model.name} lacks a gear selector`);
              if (hz === 30 && cut === 0)
                selectorReference[observation] = selector!.matrixWorld.clone();
              else {
                largestSelectorDifference = Math.max(
                  largestSelectorDifference,
                  difference(selectorReference[observation], selector!.matrixWorld),
                );
                selectorComparisons++;
              }
            }
          }
        }
      } finally {
        shells.disposeAll();
      }
    }
  }
  if (!(largestDifference <= 1e-8))
    throw new Error(`Cadence changed a transform by ${largestDifference}`);
  requireCheck(
    largestProbeDifference <= 1e-8,
    `Order/pause/LOD changed a transform by ${largestProbeDifference}`,
  );
  requireCheck(
    largestSelectorDifference <= 1e-8,
    `Order/pause/LOD changed selector by ${largestSelectorDifference}`,
  );
  requireCheck(
    largestScalarDifference === 0,
    `Cadence/order changed a presented field by ${largestScalarDifference}`,
  );
  requireCheck(before === recordingHash(frames), 'Playback mutated recorded source frames');
  return {
    firstRaceSecond: frames[0][H.TIME],
    comparisons,
    largestMatrixElementDifference: largestDifference,
    probeComparisons,
    largestProbeMatrixElementDifference: largestProbeDifference,
    selectorComparisons,
    largestSelectorMatrixElementDifference: largestSelectorDifference,
    scalarComparisons,
    largestPresentedFieldDifference: largestScalarDifference,
    actualRigPoses: poses,
    recordingSha256: before,
  };
}

export function runMotocrossDisplayCadence() {
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const)
    for (const machine of ['mx450', 'mx250'] as const) {
      const race = jumpRecording(circuit, machine),
        controller = controllerRecording(circuit, machine);
      for (const [kind, frames] of [
        ['race-jump', race],
        ['controller-input-supplement', controller.frames],
      ] as const) {
        const activity = recordingActivity(frames);
        if (kind === 'race-jump')
          for (const channel of ['fork', 'shock', 'standing'])
            requireCheck(activity.maximumRecordedRates[channel] > 1e-6, `Inactive race ${channel}`);
        else {
          requireCheck(
            activity.acceptedEventTransitions === controller.acceptedShifts,
            'Accepted shifts missing from snapshots',
          );
          for (const channel of ['dab', 'body', 'selector', 'cover', 'clearance'])
            requireCheck(
              activity.channels[channel].nonlinearSamples > 0,
              `Inactive reconstructed ${channel}`,
            );
        }
        console.log(
          JSON.stringify({ kind, circuit, machine, ...comparePlayback(frames), activity }),
        );
      }
    }
}
