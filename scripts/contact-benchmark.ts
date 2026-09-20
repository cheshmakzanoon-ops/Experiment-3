import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, K, SKID_BASE, carBase } from '../src/simulation/protocol.ts';
import { Vec3 } from '../src/core/math.ts';

const fingerprint = createHash('sha256');
for (const directory of ['src/core', 'src/simulation'])
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .sort()) {
    const path = `${directory}/${name}`;
    fingerprint
      .update(path + '\0')
      .update(readFileSync(path))
      .update('\0');
  }
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 9, seed: 4417 });
sim.autoPlayer = true;
for (let tick = 0; tick < 1200; tick++) sim.step(1 / 120);
const times: number[] = [];
for (let tick = 0; tick < 3600; tick++) {
  const start = performance.now();
  sim.step(1 / 120);
  times.push(performance.now() - start);
  assert(sim.cars.every((car) => car.body.position.finite() && car.body.velocity.finite()));
}
times.sort((a, b) => a - b);
// Independent actual production strike, controlled only at initial conditions.
const strike = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
const car = strike.cars[0],
  frames: number[][] = [];
car.body.position.y -= 0.17;
car.body.orientation.rotate(new Vec3(0, 0, 30), car.body.velocity);
let maximumLoadN = 0;
for (let tick = 0; tick < 120; tick++) {
  strike.step(1 / 120);
  const f = strike.makeFrame(),
    k = carBase(0) + SKID_BASE;
  maximumLoadN = Math.max(maximumLoadN, f[k + K.LOAD]);
  if (tick < 16) frames.push([f[H.TIME], ...f.slice(k, k + 17)]);
}
assert(car.skid.sparkWorkJ > 0 && car.floorHealth < 1);
const report = {
  baseline: '318a170a32cbd5aad0848e204472ad258785f420',
  simulationSHA256: fingerprint.digest('hex'),
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  scope:
    'Local CPU simulation only; concurrent verification load. Not GPU, frame pacing or representative player hardware certification.',
  cars: 10,
  warmupTicks: 1200,
  measuredTicks: times.length,
  fixedDt: 1 / 120,
  meanMs: times.reduce((a, b) => a + b, 0) / times.length,
  p50Ms: times[Math.floor(times.length * 0.5)],
  p95Ms: times[Math.floor(times.length * 0.95)],
  p99Ms: times[Math.floor(times.length * 0.99)],
  maximumMs: times[times.length - 1],
  strike: {
    maximumLoadN,
    workJ: car.skid.sparkWorkJ,
    floorHealth: car.floorHealth,
    traceLayout: 'simulation time, then the 17 K skid channels in protocol order',
    firstFrames: frames,
  },
};
writeFileSync('docs/contact-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
