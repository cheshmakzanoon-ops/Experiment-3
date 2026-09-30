// Full-field race acceptance on the Vellamar coastal-mountain circuit, through
// the same production simulation, AI, pit service and race control as Aurel.
// No teleport, grip bonus or pose override is used. Writes docs/vellamar-race.json.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';

const weathers = (process.argv[2] ?? 'clear,changeable').split(',') as ('clear' | 'changeable')[];
const reports = [];
for (const weather of weathers) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: 'vellamar',
    mode: 'race',
    laps: 3,
    opponents: 9,
    weather,
    seed: 4417,
  });
  sim.autoPlayer = true;
  let maximumImpact = 0,
    maximumSpeed = 0,
    firstFinish = 0;
  const failures: string[] = [];
  const started = performance.now();
  try {
    for (let tick = 0; tick < 900 * 120 && sim.race.phase !== PHASE.FINISHED; tick++) {
      sim.step(1 / 120);
      for (const car of sim.cars) {
        assert(car.body.position.finite() && car.body.omega.finite(), 'Finite rigid state');
        maximumImpact = Math.max(maximumImpact, car.impact);
        maximumSpeed = Math.max(maximumSpeed, car.speed);
        if (car.finishTime && !firstFinish) firstFinish = sim.race.raceTime;
      }
    }
    assert.equal(sim.race.phase, PHASE.FINISHED, 'Whole field must resolve');
    assert(
      sim.cars.every((c) => c.finishTime > 0 && !c.retired),
      'Every car must finish without a timeout DNF',
    );
    assert(
      sim.race.laps.every((l) => Math.abs(l.lastSectors.reduce((a, b) => a + b) - l.last) < 1e-6),
      'Sector sum equals completed lap',
    );
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
    circuitLength: sim.track.length,
    firstFinish,
    sessionEnd: sim.race.raceTime,
    maximumSpeedKmh: maximumSpeed * 3.6,
    maximumImpact,
    wallSeconds: (performance.now() - started) / 1000,
    classification: sim.race.order.map((id) => ({
      id,
      laps: sim.race.laps[id].completed,
      best: sim.race.laps[id].best,
      finishTime: sim.cars[id].finishTime,
      penalty: sim.race.laps[id].penalty,
      retired: sim.cars[id].retired,
      pitStops: sim.cars[id].pitStops,
      sectors: sim.race.laps[id].lastSectors,
    })),
  });
  console.log(JSON.stringify(reports.at(-1), null, 1));
}
const report = {
  sources: Object.fromEntries(
    ['src/simulation/circuits.ts', 'src/simulation/track.ts', 'src/simulation/ai.ts'].map((p) => [
      p,
      createHash('sha256').update(readFileSync(p)).digest('hex'),
    ]),
  ),
  reports,
};
writeFileSync('docs/vellamar-race.json', JSON.stringify(report, null, 2) + '\n');
if (reports.some((r) => !r.passed)) process.exit(1);
