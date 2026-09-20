import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { FLAG } from '../src/simulation/marshal.ts';

// Initial-condition fixture only. After placement, all motion comes from normal
// AI controls, wheel forces and the production collision/surface solvers.
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 2 });
sim.autoPlayer = true;
sim.race.time = sim.race.greenAt + 10;
const driver = sim.cars[0],
  obstruction = sim.cars[1],
  distant = sim.cars[2];
driver.place(sim.track, 900, 0);
obstruction.place(sim.track, 980, 0);
distant.place(sim.track, 1900, 0);
obstruction.retired = true;
const maximumImpact = new Float64Array(3);
let sawDouble = false,
  sawClear = false,
  distantInitiallyGreen = false;
let seconds = 0;
for (let tick = 0; tick < 50 * 120; tick++) {
  sim.step(1 / 120);
  seconds = (tick + 1) / 120;
  sawDouble ||= sim.race.control.flags[0] === FLAG.DOUBLE_YELLOW;
  if (sawDouble && driver.s > 1050) sawClear ||= sim.race.control.flags[0] === FLAG.GREEN;
  if (tick === 120) distantInitiallyGreen = sim.race.control.flags[2] === FLAG.GREEN;
  sim.cars.forEach((car) => {
    maximumImpact[car.id] = Math.max(maximumImpact[car.id], car.impact);
  });
  if (sawClear && driver.s > 1100) break;
}
const failures: string[] = [];
for (const [passed, reason] of [
  [sawDouble, 'Approaching driver must receive double yellow'],
  [distantInitiallyGreen, 'Distant driver must not receive a circuit-wide yellow'],
  [sawClear, 'Driver must pass the obstruction and leave the local zone'],
  [maximumImpact[0] === 0, 'Safety path must avoid contact'],
  [sim.race.laps[0].penalty === 0, 'Passing a stationary obstruction is exempt'],
  [driver.body.position.finite(), 'All motion must remain finite'],
] as const)
  if (!passed) failures.push(reason);
const report = {
  sourceSHA256: createHash('sha256')
    .update(
      ['marshal', 'ai', 'traffic', 'race', 'world']
        .map((file) => readFileSync(`src/simulation/${file}.ts`, 'utf8'))
        .join('\n'),
    )
    .digest('hex'),
  passed: !failures.length,
  failures,
  seconds,
  sawDouble,
  sawClear,
  distantInitiallyGreen,
  driverStationM: driver.s,
  driverSpeedMps: driver.speed,
  maximumImpact: [...maximumImpact],
  events: sim.race.control.events,
};
writeFileSync('docs/marshal-integration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
assert(report.passed, failures.join('; '));
