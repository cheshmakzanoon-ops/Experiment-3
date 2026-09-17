import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
const requested = Number(process.argv[2] ?? 100);
assert(Number.isInteger(requested) && requested > 0 && requested <= 100);
const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
sim.autoPlayer = true;
// Explicit endurance fixture: extra initial fuel changes actual mass. No teleports,
// infinite fuel, tire resets, lap edits or force overrides are used during the run.
sim.cars[0].fuel = requested * 1.05 + 8;
let maxOffset = 0,
  maxSpeed = 0,
  lastLap = 0;
const start = performance.now();
for (let tick = 0; tick < 120 * requested * 160; tick++) {
  sim.step(1 / 120);
  const c = sim.cars[0],
    lap = sim.race.laps[0];
  assert(c.body.position.finite() && c.body.velocity.finite());
  assert(c.fuel > 0, 'Fuel exhausted');
  assert(c.battery >= 0 && c.battery <= 4e6);
  if (!c.inPit) maxOffset = Math.max(maxOffset, Math.abs(c.lateral));
  maxSpeed = Math.max(maxSpeed, c.speed);
  if (lap.completed !== lastLap) {
    lastLap = lap.completed;
    if (lastLap % 10 === 0)
      console.log(
        `${lastLap} laps, ${c.fuel.toFixed(2)} kg fuel, ${(c.tires[0].wear * 100).toFixed(1)}% tire wear`,
      );
  }
  if (lap.completed >= requested) break;
}
assert(sim.race.laps[0].completed === requested, 'Endurance fixture timed out');
assert(maxOffset < 15, 'Car left the usable circuit during endurance');
const c = sim.cars[0];
const result = {
  requestedLaps: requested,
  completedLaps: sim.race.laps[0].completed,
  simulatedSeconds: sim.race.raceTime,
  wallSeconds: (performance.now() - start) / 1000,
  initialFuelKg: requested * 1.05 + 8,
  fuelRemainingKg: c.fuel,
  maxOffsetM: maxOffset,
  maxSpeedKmh: maxSpeed * 3.6,
  frontHealth: c.frontHealth,
  floorHealth: c.floorHealth,
  pitStops: c.pitStops,
  tireWear: c.tires.map((t) => t.wear),
  seed: DEFAULT_OPTIONS.seed,
};
writeFileSync('docs/endurance-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
