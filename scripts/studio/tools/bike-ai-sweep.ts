// Headless AI-only bike race sweep with fall diagnostics (QA Bikes & Dirt). Every rider, the
// player's slot included, is driven by the production bike AI on the production Simulation at
// 120 Hz, so any fall is the AI's own. A browser is not needed: a 4-bike, 3-lap race takes
// 5 to 12 s. Prints one JSON line per race (falls per bike, race time, best lap) and, with
// --trace, one line per fall (lap time, station, speed, lean, tyre use, grip, pedals, and the
// line of bike.ts / bike-vehicle.ts that raised it).
//
//   node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts \
//        <circuit,circuit,...> <vehicle[,vehicle...]> [cars=4] [laps=3] [firstSeed=1000] \
//        [seeds=10] [--trace] [--ruleset=<id>]
//
// Seeds are firstSeed + 37 * k. Comparing two source trees (before/after a fix): run the same
// command from each checkout.
import { Bike } from '../../../src/simulation/bike.ts';
import type { BikeVehicle } from '../../../src/simulation/bike-vehicle.ts';
import { circuitDefinition } from '../../../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../../../src/simulation/config.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import { Simulation } from '../../../src/simulation/world.ts';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [circuitsCsv, vehicle, cars = '4', laps = '3', firstSeed = '1000', seedCount = '10'] =
  args.filter((a) => !a.startsWith('--'));
if (!circuitsCsv || !vehicle) {
  console.error(
    'usage: bike-ai-sweep.ts <circuit,...> <vehicle[,...]> [cars] [laps] [firstSeed] [seeds] [--trace]',
  );
  process.exit(2);
}
const ruleset = flags.find((f) => f.startsWith('--ruleset='))?.slice(10);
const trace = flags.includes('--trace');
const field = vehicle.includes(',') ? vehicle.split(',') : Array(Number(cars)).fill(vehicle);

let sim: Simulation | null = null;
let falls: Record<string, unknown>[] = [];
const raise = Bike.prototype.fall;
Bike.prototype.fall = function (this: Bike, kind: 'lowside' | 'highside') {
  if (this.state === 'riding' && sim) {
    const car = (sim.cars as BikeVehicle[]).find((c) => c.dynamics === this)!;
    const where = (new Error().stack ?? '').split('\n')[2]?.trim().replace(/.*\//, '') ?? '';
    falls.push({
      t: +sim.race.raceTime.toFixed(1),
      car: sim.cars.indexOf(car),
      kind,
      afterFlag: car.finishTime > 0,
      s: Math.round(car.s),
      lat: +car.lateral.toFixed(1),
      kph: Math.round(this.speed * 3.6),
      lean: +this.lean.toFixed(2),
      frontUse: +this.frontUse.toFixed(2),
      rearUse: +this.rearUse.toFixed(2),
      grip: +this.grip.toFixed(2),
      brake: +car.input.brake.toFixed(2),
      throttle: +car.input.throttle.toFixed(2),
      raisedAt: where,
    });
  }
  return raise.call(this, kind);
};

const DT = 1 / 120;
let total = 0,
  clean = 0,
  races = 0;
for (const circuit of circuitsCsv.split(',')) {
  for (let k = 0; k < Number(seedCount); k++) {
    const seed = Number(firstSeed) + k * 37;
    sim = new Simulation(
      {
        ...DEFAULT_OPTIONS,
        mode: 'race',
        circuit: circuit as never,
        laps: Number(laps),
        opponents: field.length - 1,
        seed,
        vehicles: field,
        ...(ruleset ? { ruleset } : {}),
      },
      circuitDefinition(circuit as never),
    );
    sim.autoPlayer = true;
    falls = [];
    const started = performance.now();
    for (let tick = 0; tick < 120 * 900 && sim.race.phase !== PHASE.FINISHED; tick++) sim.step(DT);
    const perBike = (sim.cars as BikeVehicle[]).map((c) => c.dynamics.crashes);
    const bests = sim.race.laps.map((l) => l.best).filter((b) => b > 0);
    const count = perBike.reduce((a, b) => a + b, 0);
    races++;
    total += count;
    if (count === 0) clean++;
    console.log(
      JSON.stringify({
        circuit,
        seed,
        finished: sim.race.phase === PHASE.FINISHED,
        raceSeconds: +sim.race.raceTime.toFixed(1),
        bestLapSeconds: bests.length ? +Math.min(...bests).toFixed(2) : null,
        falls: count,
        perBike,
        wallSeconds: +((performance.now() - started) / 1000).toFixed(1),
      }),
    );
    if (trace)
      for (const f of falls) console.log('  FALL ' + JSON.stringify({ circuit, seed, ...f }));
  }
}
console.log(`SUMMARY races=${races} falls=${total} cleanRaces=${clean}/${races}`);
