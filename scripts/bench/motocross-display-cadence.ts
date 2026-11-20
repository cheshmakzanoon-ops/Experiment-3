import * as T from 'three';
import { BikeShells } from '../../src/rendering/bike.ts';
import { PresentedFrame } from '../../src/rendering/frame-state.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, O, OFFROAD_BASE, carBase } from '../../src/simulation/protocol.ts';
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

/** Compare the ten rider and bike transforms at the six observation times
 * per second common to every refresh rate. Repeat 0.4 of a snapshot later
 * to include fractional interpolation along with exact snapshot times. */
function comparePlayback(frames: Float32Array[]) {
  const slot = carBase(0),
    reference: T.Matrix4[] = [];
  let comparisons = 0,
    largestDifference = 0;
  for (const phase of [0, 1 / 75]) {
    reference.length = 0;
    for (const hz of [30, 60, 120, 144, 240]) {
      const shells = new BikeShells(),
        host = { root: new T.Object3D() };
      const camera = new T.PerspectiveCamera(58, 16 / 9),
        presented = new PresentedFrame();
      let cursor = 0;
      try {
        for (let step = 0; step <= 3 * hz; step++) {
          const seconds = step / hz + phase;
          const frame = (step * 30) / hz + phase * 30,
            i = Math.floor(frame + 1e-9);
          const alpha = Math.max(0, frame - i),
            a = frames[i],
            b = frames[i + 1];
          const shown = presented.sample(a, b, alpha);
          host.root.position.fromArray(shown, slot + F.X);
          host.root.quaternion.fromArray(shown, slot + F.QX);
          camera.position.copy(host.root.position);
          // Exercise the near, middle and distant cameras, then return to near.
          camera.position.z += seconds < 1 ? 6 : seconds < 1.5 ? 66 : seconds < 2 ? 225 : 6;
          shells.update(a, b, alpha, [host], camera, 'high', -1);
          if (step % (hz / 6)) continue;
          const model = shells.drawnRoot(0)!;
          model.updateMatrixWorld(true);
          for (const name of joints) {
            const joint = model.getObjectByName(name);
            if (!joint) throw new Error(`${model.name} lacks ${name}`);
            if (hz === 30) reference.push(joint.matrixWorld.clone());
            else {
              const earlier = reference[cursor].elements,
                now = joint.matrixWorld.elements;
              for (let e = 0; e < 16; e++)
                largestDifference = Math.max(largestDifference, Math.abs(earlier[e] - now[e]));
              comparisons++;
            }
            cursor++;
          }
        }
      } finally {
        shells.disposeAll();
      }
    }
  }
  if (!(largestDifference <= 1e-8))
    throw new Error(`Cadence changed a transform by ${largestDifference}`);
  return {
    firstRaceSecond: frames[0][H.TIME],
    comparisons,
    largestMatrixElementDifference: largestDifference,
  };
}

export function runMotocrossDisplayCadence() {
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const)
    for (const machine of ['mx450', 'mx250'] as const)
      console.log(
        'Race-camera playback',
        circuit,
        machine,
        comparePlayback(jumpRecording(circuit, machine)),
      );
}
