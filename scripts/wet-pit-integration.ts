import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

// Same service/impact oracle as the dry integration, including the deliberately
// wrong-tire case. Only initial conditions and pit requests are injected. No
// pose, speed, grip, tire state or timing is overwritten while the cars drive.
const identity = createHash('sha256');
for (const directory of ['src/core', 'src/simulation']) {
  for (const name of readdirSync(directory).filter((n) => n.endsWith('.ts')).sort()) {
    const path = `${directory}/${name}`;
    identity.update(path + '\0').update(readFileSync(path)).update('\0');
  }
}
const reports = [];
for (const compound of ['wet', 'medium'] as const) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 9,
    weather: 'rain', compound, seed: 4417 });
  sim.autoPlayer = true;
  const originalTires = sim.cars.map((c) => [...c.tires]);
  const entered = new Uint8Array(10), exited = new Uint8Array(10);
  const maximumImpact = new Float64Array(10), minimumHealth = new Float64Array(10).fill(1);
  for (const car of sim.cars) { car.pitRequested = true; car.nextCompound = 'wet'; }
  let ticks = 0;
  const failures: string[] = [];
  try {
    for (; ticks < 420 * 120; ticks++) {
      sim.step(1 / 120);
      for (const c of sim.cars) {
        assert(c.body.position.finite() && c.body.velocity.finite() && c.body.omega.finite(), 'Finite chassis');
        assert(!c.retired && c.fuel > 0, 'No retirement or fuel exhaustion');
        assert(c.battery >= 0 && c.battery <= 4e6, 'Battery remains bounded');
        maximumImpact[c.id] = Math.max(maximumImpact[c.id], c.impact);
        minimumHealth[c.id] = Math.min(minimumHealth[c.id], c.frontHealth, c.rearHealth, c.floorHealth);
        if (c.inPit) entered[c.id] = 1;
        if (c.pitStops === 1 && !c.inPit) exited[c.id] = 1;
      }
      if (exited.every(Boolean)) break;
    }
    assert(entered.every(Boolean) && exited.every(Boolean), 'All ten physically service and exit in 420 simulated seconds');
    assert(sim.cars.every((c) => c.pitStops === 1), 'Exactly one completed service');
    assert(maximumImpact.every((v) => v < 0.05), 'Stops cannot depend on collision impulses');
    for (const c of sim.cars) for (let i = 0; i < 4; i++) {
      assert(c.tires[i] !== originalTires[c.id][i], 'Actual new tire object');
      assert.equal(c.tires[i].compound, 'wet', 'Actual wet compound');
    }
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  reports.push({ compound, passed: failures.length === 0, failures, simulatedSeconds: ticks / 120,
    zeroImpact: maximumImpact.every((v) => v === 0),
    cars: sim.cars.map((c) => ({ id: c.id, entered: !!entered[c.id], exited: !!exited[c.id],
      stops: c.pitStops, maximumImpact: maximumImpact[c.id], minimumHealth: minimumHealth[c.id] })) });
}
const evidence = { sourceSHA256: identity.digest('hex'),
  scenario: { seed: 4417, cars: 10, rainMmHr: 24, maximumSeconds: 420 }, reports };
writeFileSync('docs/wet-pit-results.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
if (reports.some((r) => !r.passed)) process.exitCode = 1;
