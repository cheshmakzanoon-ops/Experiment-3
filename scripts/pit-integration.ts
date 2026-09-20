import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

// A request made after the entry line must be carried round to the next legal
// entry. Ten cars then approach, stop, receive service and leave under physics.
const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 9, seed: 4417 });
sim.autoPlayer = true;
for (const car of sim.cars) car.pitRequested = true;
const maximumImpact = new Float64Array(10);
const entered = new Uint8Array(10);
const completed = new Uint8Array(10);
let ticks = 0;
const failures: string[] = [];
try {
  for (; ticks < 220 * 120; ticks++) {
    sim.step(1 / 120);
    for (const car of sim.cars) {
      maximumImpact[car.id] = Math.max(maximumImpact[car.id], car.impact);
      if (car.inPit) entered[car.id] = 1;
      if (car.pitStops === 1 && !car.inPit) completed[car.id] = 1;
      assert(car.body.position.finite(), `Car ${car.id}: non-finite position`);
      assert(!car.retired, `Car ${car.id}: retired`);
    }
    if (completed.every(Boolean)) break;
  }
  assert(entered.every(Boolean), 'Every car must enter the pit lane');
  assert(completed.every(Boolean), 'Every car must service and exit within the scenario');
  assert(
    sim.cars.every((c) => c.pitStops === 1),
    'Exactly one service per requested stop',
  );
  assert(
    maximumImpact.every((v) => v < 0.05),
    'Pit sequence must not depend on collision impulses',
  );
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}
const report = {
  passed: failures.length === 0,
  failures,
  simulatedSeconds: ticks / 120,
  cars: sim.cars.map((car) => ({
    id: car.id,
    entered: !!entered[car.id],
    exited: !!completed[car.id],
    stops: car.pitStops,
    phase: car.pitPhase,
    maximumImpact: maximumImpact[car.id],
    frontHealth: car.frontHealth,
    rearHealth: car.rearHealth,
  })),
};
writeFileSync('docs/pit-integration.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
