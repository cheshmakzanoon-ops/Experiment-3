// AI-only control race for the journey tool's findings: every car (player included)
// is driven by the production AI, so any crash/stall is the AI's own.
//   node --no-warnings --experimental-transform-types scripts/studio/tools/ai-only-race.mjs \
//        <circuit> <vehicle> [cars=4] [laps=3] [seed=73021]
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const [circuit = 'kansai-east', vehicle = 'gpr1', cars = '4', laps = '3', seed = '73021'] = process.argv.slice(2);
const { Simulation } = await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await load('src/simulation/config.ts');
const { circuitDefinition } = await load('src/simulation/circuits.ts');
const { PHASE } = await load('src/simulation/race.ts');
const n = Number(cars);
const sim = new Simulation(
  { ...DEFAULT_OPTIONS, mode: 'race', circuit, laps: Number(laps), opponents: n - 1, seed: Number(seed), vehicles: Array(n).fill(vehicle) },
  circuitDefinition(circuit),
);
sim.autoPlayer = true;
const dt = 1 / 120;
let still = 0;
for (let tick = 0; tick < 120 * 900 && sim.race.phase !== PHASE.FINISHED; tick++) {
  sim.step(dt);
  if (tick % 120 === 0 && sim.race.phase === PHASE.RACING)
    for (const c of sim.cars) if (c.speed < 0.5 && c.finishTime === 0) still++;
}
const crashes = sim.cars.map((c) => c.dynamics?.crashes ?? null);
console.log(
  JSON.stringify({
    circuit,
    vehicle,
    cars: n,
    laps: Number(laps),
    seed: Number(seed),
    finished: sim.race.phase === PHASE.FINISHED,
    raceTime: Number(sim.race.raceTime.toFixed(1)),
    crashesPerCar: crashes,
    crashesTotal: crashes.reduce((a, b) => a + (b ?? 0), 0),
    carSecondsStationaryWhileRacing: still,
  }),
);
