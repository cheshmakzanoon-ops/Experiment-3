import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
const reports = [];
for (const weather of ['clear', 'changeable', 'rain'] as const) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 3,
    mode: 'practice',
    weather,
    compound: weather === 'rain' ? 'wet' : 'medium',
  });
  sim.autoPlayer = true;
  let maxSpeed = 0,
    maxLateral = 0;
  const started = performance.now();
  const failures: string[] = [];
  let tick = 0;
  try {
    for (; tick < 120 * 320; tick++) {
      if (weather === 'clear' && tick === 120 * 15) sim.requestPit();
      sim.step(1 / 120);
      for (const car of sim.cars) {
        assert(car.body.position.finite());
        assert(car.body.velocity.finite());
        assert(car.battery >= 0 && car.battery <= 4e6);
        assert(car.fuel >= 0);
        maxSpeed = Math.max(maxSpeed, car.speed);
        if (!car.inPit) maxLateral = Math.max(maxLateral, Math.abs(car.lateral));
      }
    }
    assert(
      sim.race.laps.every((lap) => lap.completed >= 2),
      `${weather}: an AI car failed to complete two laps`,
    );
    if (weather !== 'rain')
      assert(
        sim.cars.every((c) =>
          weather === 'clear' ? c.id > 0 || c.pitStops >= 1 : c.pitStops >= 1,
        ),
        `${weather}: required pit stop was missed`,
      );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const report = {
    passed: failures.length === 0,
    failures,
    weather,
    simulatedSeconds: tick / 120,
    cars: 4,
    elapsedSeconds: (performance.now() - started) / 1000,
    maxSpeedKmh: maxSpeed * 3.6,
    maxLateral,
    laps: sim.race.laps.map((l) => l.completed),
    bestLaps: sim.race.laps.map((l) => l.best),
    pitStops: sim.cars.map((c) => c.pitStops),
    frontHealth: sim.cars.map((c) => c.frontHealth),
    compounds: sim.cars.map((c) => c.tires[0].compound),
    waterMm: sim.track.meanWater(),
  };
  reports.push(report);
  console.log(JSON.stringify(report));
  // Persist this execution even on failure; never upload an older passing file.
  writeFileSync('docs/scenario-results.json', JSON.stringify(reports, null, 2) + '\n');
}
writeFileSync('docs/scenario-results.json', JSON.stringify(reports, null, 2) + '\n');

if (reports.some((report) => !report.passed)) process.exitCode = 1;
