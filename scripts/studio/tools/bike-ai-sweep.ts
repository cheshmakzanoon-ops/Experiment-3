// Headless AI-only bike race sweep with fall diagnostics (QA Bikes & Dirt). Every rider, the
// player's slot included, is driven by the production bike AI on the production Simulation at
// 120 Hz, so any fall is the AI's own. A browser is not needed: a 4-bike, 3-lap race takes
// 5 to 12 s. Prints one JSON line per race (falls per bike, race time, best lap) and, with
// --trace, one line per fall (lap time, station, speed, lean, tyre use, grip, pedals, and the
// line of bike.ts / bike-vehicle.ts that raised it). Mixed fields (a comma list of vehicles) also
// report the traffic planner's completed passes / aborts (with the abort reasons) per rider,
// the best lap of each vehicle type and the net on-track position swaps between types
// (`swaps["gpr1>sbk1000"]`: times a gpr1 took a place from an sbk1000, racing phase only).
//
//   node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts \
//        <circuit,circuit,...> <vehicle[,vehicle...]> [cars=4] [laps=3] [firstSeed=1000] \
//        [seeds=10] [--trace] [--ruleset=<id>] [--seeds=<seed,seed,...>]
//
// Seeds are firstSeed + 37 * k. Comparing two source trees (before/after a fix): run the same
// command from each checkout.
import { Bike } from '../../../src/simulation/bike.ts';
import type { BikeVehicle } from '../../../src/simulation/bike-vehicle.ts';
import { circuitDefinition } from '../../../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../../../src/simulation/config.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import type { TrafficPlanner } from '../../../src/simulation/traffic.ts';
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
// --seeds=5074,5185 replaces firstSeed + 37 k with an explicit list (to re-run the races that fell).
const seedList = flags
  .find((f) => f.startsWith('--seeds='))
  ?.slice(8)
  .split(',')
  .map(Number);
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
const plannerOf = (i: number) => (sim!.ai[i] as unknown as { planner: TrafficPlanner }).planner;
let total = 0,
  clean = 0,
  races = 0;
for (const circuit of circuitsCsv.split(',')) {
  for (let k = 0; k < (seedList?.length ?? Number(seedCount)); k++) {
    const seed = seedList ? seedList[k] : Number(firstSeed) + k * 37;
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
    const reasons: Record<string, number>[] = field.map(() => ({}));
    const seenAborts = field.map(() => 0);
    const swaps: Record<string, number> = {};
    let rank = sim.cars.map(() => 0);
    const started = performance.now();
    for (let tick = 0; tick < 120 * 900 && sim.race.phase !== PHASE.FINISHED; tick++) {
      sim.step(DT);
      if (sim.race.phase !== PHASE.RACING) continue;
      const now = sim.race.order.map((id, place) => [id, place] as const);
      const place: number[] = [];
      for (const [id, p] of now) place[id] = p;
      for (let i = 0; i < field.length; i++) {
        const planner = plannerOf(i);
        if (planner.aborts > seenAborts[i]) {
          const reason = planner.lastAbort || '?';
          reasons[i][reason] = (reasons[i][reason] ?? 0) + planner.aborts - seenAborts[i];
          seenAborts[i] = planner.aborts;
        }
        for (let j = 0; j < field.length; j++)
          if (field[i] !== field[j] && rank[i] > rank[j] && place[i] < place[j])
            swaps[`${field[i]}>${field[j]}`] = (swaps[`${field[i]}>${field[j]}`] ?? 0) + 1;
      }
      rank = place;
    }
    const perBike = (sim.cars as BikeVehicle[]).map((c) => c.dynamics.crashes);
    const bests = sim.race.laps.map((l) => l.best).filter((b) => b > 0);
    const count = perBike.reduce((a, b) => a + b, 0);
    const bestByVehicle: Record<string, number> = {};
    sim.race.laps.forEach((l, i) => {
      if (l.best > 0)
        bestByVehicle[field[i]] = +Math.min(bestByVehicle[field[i]] ?? Infinity, l.best).toFixed(2);
    });
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
        passes: field.map((_, i) => plannerOf(i).passes),
        abortReasons: reasons,
        swaps,
        incidents: sim.race.control.events.filter((e) => e.kind === 'incident').length,
        bestByVehicle,
        wallSeconds: +((performance.now() - started) / 1000).toFixed(1),
      }),
    );
    if (trace)
      for (const f of falls) console.log('  FALL ' + JSON.stringify({ circuit, seed, ...f }));
  }
}
console.log(`SUMMARY races=${races} falls=${total} cleanRaces=${clean}/${races}`);
