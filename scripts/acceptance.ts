import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, type WeatherPreset } from '../src/simulation/config.ts';

const laps = Number(process.argv[2] ?? 50),
  cars = Number(process.argv[3] ?? 10);
const seed = Number(process.argv[4] ?? 4417);
const weather = (process.argv[5] ?? 'clear') as WeatherPreset;
if (
  !Number.isInteger(laps) ||
  laps < 1 ||
  laps > 100 ||
  !Number.isInteger(cars) ||
  cars < 1 ||
  cars > 12 ||
  !['clear', 'rain', 'changeable'].includes(weather)
)
  throw new Error('Usage: acceptance.ts [1..100 laps] [1..12 cars] [seed] [clear|rain|changeable]');
const hash = createHash('sha256');
function fingerprint(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) fingerprint(path);
    else {
      hash.update(path);
      hash.update(readFileSync(path));
    }
  }
}
fingerprint('src');
const sourceSHA256 = hash.digest('hex');
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  opponents: cars - 1,
  seed,
  weather,
  compound: weather === 'rain' ? 'wet' : 'medium',
});
sim.autoPlayer = true;
const initialFuelKg = laps * 1.05 + 8;
for (const car of sim.cars) car.fuel = initialFuelKg;
const records = sim.cars.map((car) => ({
  id: car.id,
  completed: 0,
  maxOffsetM: 0,
  offTrackSeconds: 0,
  maximumImpact: 0,
  stalledSeconds: 0,
  maximumStall: 0,
  pitSeconds: 0,
  maximumPitSeconds: 0,
  frontHealth: 1,
  rearHealth: 1,
  floorHealth: 1,
  pitStops: 0,
  fuelRemainingKg: initialFuelKg,
}));
const failures: string[] = [],
  started = performance.now();
let ticks = 0,
  announced = 0;
try {
  for (; ticks < laps * 200 * 120; ticks++) {
    sim.step(1 / 120);
    for (const car of sim.cars) {
      const r = records[car.id];
      r.completed = sim.race.laps[car.id].completed;
      if (
        !car.body.position.finite() ||
        !car.body.velocity.finite() ||
        !Number.isFinite(car.body.orientation.w)
      )
        throw new Error(`Non-finite vehicle ${car.id}`);
      if (car.retired) throw new Error(`Vehicle ${car.id} retired`);
      if (car.fuel <= 0) throw new Error(`Vehicle ${car.id} exhausted fuel`);
      if (car.battery < 0 || car.battery > 4e6)
        throw new Error(`Vehicle ${car.id} violated battery bounds`);
      r.maximumImpact = Math.max(r.maximumImpact, car.impact);
      if (!car.inPit) {
        r.maxOffsetM = Math.max(r.maxOffsetM, Math.abs(car.lateral));
        if (Math.abs(car.lateral) > car.trackPosition.width + 1.1) r.offTrackSeconds += 1 / 120;
        r.stalledSeconds = car.speed < 0.5 ? r.stalledSeconds + 1 / 120 : 0;
        r.maximumStall = Math.max(r.maximumStall, r.stalledSeconds);
        if (r.stalledSeconds > 30)
          throw new Error(`Vehicle ${car.id} stopped on track for 30 seconds`);
      }
      if (car.inPit) r.pitSeconds += 1 / 120;
      else {
        r.maximumPitSeconds = Math.max(r.maximumPitSeconds, r.pitSeconds);
        r.pitSeconds = 0;
      }
      if (r.pitSeconds > 100)
        throw new Error(`Vehicle ${car.id} stuck in pit phase ${car.pitPhase}`);
      r.frontHealth = car.frontHealth;
      r.rearHealth = car.rearHealth;
      r.floorHealth = car.floorHealth;
      r.fuelRemainingKg = car.fuel;
      r.pitStops = car.pitStops;
    }
    const minimum = Math.min(...records.map((r) => r.completed));
    if (minimum >= announced + 10) {
      announced = minimum;
      console.log(
        JSON.stringify({
          minimumLap: minimum,
          simulatedSeconds: sim.race.raceTime,
          wallSeconds: (performance.now() - started) / 1000,
        }),
      );
    }
    if (minimum >= laps) break;
  }
  for (const r of records) {
    if (r.completed < laps) failures.push(`Car ${r.id}: incomplete endurance`);
    if (Math.min(r.frontHealth, r.rearHealth, r.floorHealth) < 0.9)
      failures.push(`Car ${r.id}: material collision/underfloor damage`);
    if (r.offTrackSeconds > laps * 0.5) failures.push(`Car ${r.id}: systematic off-track running`);
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}
const report = {
  sourceSHA256,
  scenario: { laps, cars, seed, weather, initialFuelKg },
  simulatedSeconds: sim.race.raceTime,
  wallSeconds: (performance.now() - started) / 1000,
  ticks,
  passed: failures.length === 0,
  zeroImpact: records.every((r) => r.maximumImpact === 0),
  failures,
  failureState: failures.length
    ? sim.cars.map((c) => ({
        id: c.id,
        s: c.s,
        lateral: c.lateral,
        speed: c.speed,
        pitPhase: c.pitPhase,
        pitClock: c.pitClock,
        target: c.aiTarget,
        input: { ...c.input },
        position: { ...c.body.position },
        orientation: { ...c.body.orientation },
        tires: c.tires.map((t) => ({ wear: t.wear, omega: t.omega, load: t.load })),
        decision: sim.ai[c.id].decision,
      }))
    : undefined,
  cars: records,
};
writeFileSync(
  `docs/acceptance-${cars}cars-${laps}laps-${weather}-${seed}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
