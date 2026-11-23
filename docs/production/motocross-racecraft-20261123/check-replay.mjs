import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_OPTIONS } from '../../../src/simulation/config.ts';
import { F, carBase } from '../../../src/simulation/protocol.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import { Simulation } from '../../../src/simulation/world.ts';

const receipt = JSON.parse(readFileSync(new URL('./six-lap-verification.json', import.meta.url)));
const [seed, weather, circuit] = process.argv.slice(2);
const cases = receipt.sessions.filter((row) =>
  (!seed || Number(seed) === row.seed) && (!weather || weather === row.weather) && (!circuit || circuit === row.circuit),
);
assert(cases.length, 'No scenario matches the supplied seed, weather and circuit');
const channels = receipt.traceChannels.map((name) => F[name]);
const dt = 1 / receipt.frequencyHz;

function run(row) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, circuit: row.circuit, weather: row.weather, seed: row.seed,
    mode: 'race', ruleset: 'motocross-moto', opponents: receipt.riders - 1, laps: receipt.laps,
    vehicles: Array.from({ length: receipt.riders }, (_, id) => (id + row.seed) % 3 ? 'mx450' : 'mx250'),
  });
  sim.autoPlayer = true;
  const digest = createHash('sha256');
  const sample = Buffer.alloc(receipt.riders * channels.length * 8);
  let ticks = 0;
  while (sim.race.phase !== PHASE.FINISHED && ticks < 1900 * receipt.frequencyHz) {
    sim.step(dt);
    if (ticks % receipt.sampleIntervalTicks === 0) {
      const frame = sim.makeFrame();
      let offset = 0;
      for (let id = 0; id < receipt.riders; id++) {
        const base = carBase(id);
        for (const channel of channels) {
          const value = frame[base + channel];
          assert(Number.isFinite(value), 'Non-finite rider channel at tick ' + ticks);
          sample.writeDoubleLE(value, offset);
          offset += 8;
        }
      }
      digest.update(sample);
    }
    ticks++;
  }
  assert.equal(sim.race.phase, PHASE.FINISHED);
  const terrain = sim.offroad.terrain;
  const stats = terrain.stats();
  return {
    finishTicks: ticks,
    retirements: sim.cars.filter((car) => car.retired).length,
    poseSha256: digest.digest('hex'),
    terrainHash: terrain.hash(),
    terrainCells: stats.cells,
    maxRutDepthM: stats.deepest,
  };
}

for (const row of cases) {
  const first = run(row);
  assert.deepEqual(first, run(row), 'Seeded repeat differed');
  for (const [key, value] of Object.entries(first)) assert.equal(value, row[key], key);
  console.log(row.circuit, row.weather, row.seed, first.finishTicks, first.terrainHash);
}
