import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';

const reports = [];
for (const weather of ['clear', 'changeable'] as const) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    laps: 3,
    opponents: 9,
    weather,
    seed: 4417,
  });
  sim.autoPlayer = true;
  let firstFinish = 0,
    playerFinish = 0;
  let maximumImpact = 0;
  const failures: string[] = [];
  try {
    for (let tick = 0; tick < 540 * 120 && sim.race.phase !== PHASE.FINISHED; tick++) {
      sim.step(1 / 120);
      for (const car of sim.cars) {
        assert(car.body.position.finite() && car.body.omega.finite(), 'Finite rigid state');
        maximumImpact = Math.max(maximumImpact, car.impact);
        if (car.finishTime && !firstFinish) firstFinish = sim.race.raceTime;
        if (car.id === 0 && car.finishTime && !playerFinish) playerFinish = sim.race.raceTime;
      }
    }
    assert.equal(sim.race.phase, PHASE.FINISHED, 'Whole field must resolve');
    assert(
      sim.cars.every((c) => c.finishTime > 0 && !c.retired),
      'Every car must finish without a timeout DNF',
    );
    assert(
      sim.race.laps.every((l) => l.completed > 0 && l.lastSectors.every((s) => s > 0)),
      'All three actual sectors',
    );
    assert(
      sim.race.laps.every((l) => Math.abs(l.lastSectors.reduce((a, b) => a + b) - l.last) < 1e-6),
      'Sector sum equals completed lap',
    );
    assert(sim.race.raceTime > firstFinish, 'First finisher does not freeze the field');
    if (weather === 'changeable')
      assert(
        sim.cars.every((c) => c.pitStops >= 1),
        'Every car must physically fit wet-weather tires',
      );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  reports.push({
    weather,
    passed: failures.length === 0,
    failures,
    firstFinish,
    playerFinish,
    sessionEnd: sim.race.raceTime,
    maximumImpact,
    classification: sim.race.order.map((id) => ({
      id,
      laps: sim.race.laps[id].completed,
      finishTime: sim.cars[id].finishTime,
      penalty: sim.race.laps[id].penalty,
      retired: sim.cars[id].retired,
      pitStops: sim.cars[id].pitStops,
      sectors: sim.race.laps[id].lastSectors,
    })),
  });
}
const report = {
  sources: Object.fromEntries(
    ['src/simulation/race.ts', 'src/simulation/world.ts', 'src/simulation/ai.ts'].map((p) => [
      p,
      createHash('sha256').update(readFileSync(p)).digest('hex'),
    ]),
  ),
  reports,
};
writeFileSync('docs/race-classification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (reports.some((r) => !r.passed)) process.exitCode = 1;
