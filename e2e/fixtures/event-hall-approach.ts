import type { Simulation } from '../../src/simulation/world.ts';
import { H } from '../../src/simulation/protocol.ts';

export interface HallApproachSample {
  previous: Float32Array;
  frame: Float32Array;
  station: number;
  time: number;
  delta: number;
}

/** Observe native 120 Hz physics every eighth of a second. Half-second polling
 * skipped alternate 40 m cuts at dry racing speed and produced only three views.
 * These spaced snapshots are not continuous video, human input or a benchmark. */
export function sampleHallApproach(
  sim: Simulation,
  station: number,
  observe?: (sample: HallApproachSample) => void,
) {
  if (!Number.isFinite(station) || station < 100 || station + 110 >= sim.track.length)
    throw new Error('Invalid A71 approach station');
  const entry = station - 100,
    exit = station + 110;
  const samples: HallApproachSample[] = [];
  let previous = sim.makeFrame().slice(),
    last = -Infinity;
  while (previous[H.TIME] < 180) {
    for (let tick = 0; tick < 15; tick++) sim.step(1 / 120);
    const frame = sim.makeFrame().slice(),
      s = sim.cars[0].s;
    if (s >= entry && s <= exit && s - last >= 40) {
      const sample: HallApproachSample = {
        previous,
        frame,
        station: s,
        time: frame[H.TIME],
        delta: frame[H.TIME] - previous[H.TIME],
      };
      samples.push(sample);
      // Draw before stepping again: shared track water and other live scene
      // sources must describe this snapshot, not the end of the whole approach.
      observe?.(sample);
      last = s;
    }
    previous = frame;
    if (samples.length > 0 && s > exit) return { samples, completed: true };
  }
  return { samples, completed: false };
}
