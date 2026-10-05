import type { Simulation } from '../../src/simulation/world.ts';
import { H } from '../../src/simulation/protocol.ts';
import { AUREL_VENUE } from '../../src/rendering/venue-plan.ts';

export interface SecondaryStandSample {
  site: number;
  station: number;
  time: number;
  delta: number;
  previous: Float32Array;
  frame: Float32Array;
}
/** One ordinary AI-driven lap: observe all six existing stands at 120 Hz / 15
 * ticks, without teleporting or editing car, camera, weather or replay channels.
 * The callback executes before the next tick so live water matches its frame. */
export async function sampleSecondaryStandLap(
  sim: Simulation,
  observe?: (sample: SecondaryStandSample) => void,
) {
  if (sim.track.circuit.id !== 'aurel' || !sim.autoPlayer)
    throw new Error('A12 traversal requires an ordinary AI-driven Aurel session');
  const sites = AUREL_VENUE.grandstands.slice(2).map((s) => s.s);
  const samples: SecondaryStandSample[] = [];
  let previous = sim.makeFrame().slice(),
    cursor = 0,
    last = -Infinity;
  let armed = sim.cars[0].s < sites[0] - 100;
  if (!armed && sim.cars[0].s < sim.track.length - 150)
    throw new Error('A12 traversal must begin before the first approach');
  let polls = 0;
  while (previous[H.TIME] < 180 && cursor < sites.length) {
    // Yield the observer event loop without changing the fixed simulation step.
    // A whole lap must not starve browser rendering or the native test reporter.
    if (++polls % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let tick = 0; tick < 15; tick++) sim.step(1 / 120);
    const frame = sim.makeFrame().slice(),
      station = sim.cars[0].s;
    // Grid positions are wrapped just before station zero. Do not treat that
    // pre-start position as having already driven past the six stands.
    if (!armed && station < sites[0] - 100) armed = true;
    if (!armed) {
      previous = frame;
      continue;
    }
    if (station > sites[cursor] + 110 && last !== -Infinity) {
      cursor++;
      last = -Infinity;
    }
    if (
      cursor < sites.length &&
      station >= sites[cursor] - 100 &&
      station <= sites[cursor] + 110 &&
      station - last >= 40
    ) {
      const sample = {
        site: sites[cursor],
        station,
        time: frame[H.TIME],
        delta: frame[H.TIME] - previous[H.TIME],
        previous,
        frame,
      };
      samples.push(sample);
      observe?.(sample);
      last = station;
    }
    previous = frame;
  }
  return { samples, completed: cursor === sites.length };
}
