// Print a digest over a complete fixed-step wet race. Pass a digest from
// another revision as the first argument to require identical replay data.
import { createHash } from 'node:crypto';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const expected = process.argv[2];
if (expected && !/^[0-9a-f]{64}$/i.test(expected)) throw new Error('Expected a SHA-256 hex digest');
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  ruleset: 'gp-motorcycle',
  circuit: 'poggio-alto',
  weather: 'rain',
  seed: 30101,
  laps: 2,
  opponents: 7,
  vehicles: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'gpr2' : 'gpr1')),
});
sim.autoPlayer = true;
const frame = sim.makeFrame();
const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
const surfaces = [
  'water',
  'rubber',
  'temperature',
  'substrateTemperature',
  'marbles',
  'frozen',
] as const;
const replay = createHash('sha256');
const cpuStart = process.cpuUsage();
let ticks = 0;
const blockTicks = 360;
while (sim.race.phase !== PHASE.FINISHED && ticks < 700 * 120) {
  const block = createHash('sha256');
  for (let i = 0; i < blockTicks && sim.race.phase !== PHASE.FINISHED; i++) {
    sim.step(1 / 120);
    sim.writeFrame(frame);
    block.update(bytes);
    ticks++;
  }
  for (const field of surfaces) {
    const data = sim.track[field];
    block.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  replay.update(block.digest());
}
const { system, user } = process.cpuUsage(cpuStart);
const digest = replay.digest('hex');
const finishTimes = sim.cars.map((bike) => bike.finishTime);
const falls = sim.cars.map((bike) => (bike as BikeVehicle).dynamics.crashes);
const classified = sim.cars.filter((bike) => !bike.retired && bike.finishTime > 0).length;
console.log(
  JSON.stringify(
    {
      ticks,
      blockTicks,
      digest,
      cpuSeconds: (system + user) / 1e6,
      classified,
      falls,
      finishTimes,
    },
    null,
    2,
  ),
);
if (sim.race.phase !== PHASE.FINISHED || classified !== 8 || falls.some(Boolean)) {
  throw new Error('The reference race requires eight classified riders and zero falls');
}
if (expected && digest !== expected.toLowerCase()) throw new Error('Reference race digest differs');
