// Headless weather matrix: for every weather preset, drive the production
// simulation (AI driver, no browser) and report lap time against the dry
// baseline, finite-state checks and the physical state of the road.
//
// Usage:
//   node --experimental-transform-types scripts/weather-matrix.ts \
//     [--circuit aurel] [--laps 3] [--weathers clear,fog,storm,dust] \
//     [--tyres medium,intermediate,wet] [--field 8] [--json out.json]
//
// Two parts: (1) a solo practice stint per weather x tyre (clean lap times,
// 1/120 s steps), (2) a populated race per weather on its suggested tyre
// (finishers, retirements, contact, wet/dry pit calls). Everything is the
// shipped Simulation; nothing here re-implements physics.
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import {
  DEFAULT_OPTIONS,
  type Compound,
  type SessionOptions,
  type WeatherPreset,
} from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { WEATHER_CATALOGUE, WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import { trackVisibilityM } from '../src/simulation/weather.ts';
import { peakGrip } from '../src/simulation/tire.ts';

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const circuit = arg('circuit', 'aurel') as NonNullable<SessionOptions['circuit']>;
const laps = Number(arg('laps', '3'));
const field = Number(arg('field', '8'));
const weathers = arg('weathers', WEATHER_IDS.join(',')).split(',') as WeatherPreset[];
const tyres = arg('tyres', 'medium,intermediate,wet').split(',') as Compound[];
const jsonPath = arg('json', '');
const doRaces = arg('races', '1') === '1';
const DT = 1 / 120;

interface StintRow {
  weather: WeatherPreset;
  tyre: Compound;
  lapTimes: number[];
  meanLap: number;
  finite: boolean;
  minVisibilityM: number;
  meanWaterMm: number;
  gripFrontLeft: number;
  surfaceTempC: number;
  tyreTempC: number;
  maxLateralOffsetM: number;
}
function stint(weather: WeatherPreset, tyre: Compound): StintRow {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'practice',
    opponents: 0,
    laps: 10,
    weather,
    compound: tyre,
    seed: 4417,
  });
  sim.autoPlayer = true;
  const car = sim.cars[0],
    lap = sim.race.laps[0];
  const times: number[] = [];
  let seen = 0,
    finite = true,
    minVis = Infinity,
    maxOff = 0,
    waterSum = 0,
    waterN = 0;
  for (let tick = 0; tick < 900 * 120 && lap.completed < laps + 1; tick++) {
    sim.step(DT);
    if (tick % 60 === 0) {
      minVis = Math.min(minVis, trackVisibilityM(sim.track));
      waterSum += sim.track.meanWater();
      waterN++;
      maxOff = Math.max(maxOff, Math.abs(car.lateral));
    }
    if (!car.body.position.finite() || !car.body.omega.finite() || !Number.isFinite(car.speed))
      finite = false;
    if (lap.completed !== seen) {
      seen = lap.completed;
      // Lap 1 is the standing-start/out lap through the line.
      if (seen >= 2) times.push(lap.last);
    }
  }
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
  const t = car.tires[0];
  return {
    weather,
    tyre,
    lapTimes: times,
    meanLap: mean,
    finite,
    minVisibilityM: minVis,
    meanWaterMm: waterN ? waterSum / waterN : 0,
    gripFrontLeft: peakGrip(t, 2500, car.contacts[0], 60) / 1.82,
    surfaceTempC: sim.track.temperature[Math.floor(sim.track.temperature.length / 2)],
    tyreTempC: t.surfaceTemp,
    maxLateralOffsetM: maxOff,
  };
}

interface RaceRow {
  weather: WeatherPreset;
  tyre: Compound;
  finished: number;
  retired: number;
  pitStops: number;
  maxImpact: number;
  finite: boolean;
  winnerS: number;
  playerClass: number;
  raceTimeS: number;
}
function race(weather: WeatherPreset, tyre: Compound): RaceRow {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    mode: 'race',
    laps,
    opponents: field - 1,
    weather,
    compound: tyre,
    seed: 4417,
  });
  sim.autoPlayer = true;
  let finite = true,
    maxImpact = 0,
    firstFinish = 0;
  for (let tick = 0; tick < 1500 * 120 && sim.race.phase !== PHASE.FINISHED; tick++) {
    sim.step(DT);
    for (const c of sim.cars) {
      if (!c.body.position.finite() || !c.body.omega.finite()) finite = false;
      maxImpact = Math.max(maxImpact, c.impact);
      if (c.finishTime && !firstFinish) firstFinish = sim.race.raceTime;
    }
  }
  return {
    weather,
    tyre,
    finished: sim.cars.filter((c) => c.finishTime > 0 && !c.retired).length,
    retired: sim.cars.filter((c) => c.retired).length,
    pitStops: sim.cars.reduce((a, c) => a + c.pitStops, 0),
    maxImpact,
    finite,
    winnerS: firstFinish,
    playerClass: sim.race.order.indexOf(0) + 1,
    raceTimeS: sim.race.raceTime,
  };
}

const started = Date.now();
const stints: StintRow[] = [];
for (const weather of weathers)
  for (const tyre of tyres) {
    const row = stint(weather, tyre);
    stints.push(row);
    console.log(
      `stint ${weather.padEnd(10)} ${tyre.padEnd(13)} mean ${row.meanLap.toFixed(2)} s  laps [${row.lapTimes.map((x) => x.toFixed(1)).join(', ')}]  finite=${row.finite}`,
    );
  }
const races: RaceRow[] = [];
for (const weather of doRaces ? weathers : []) {
  const tyre = (WEATHER_CATALOGUE[weather].suggestedTyre ?? 'medium') as Compound;
  const row = race(weather, tyre);
  races.push(row);
  console.log(
    `race  ${weather.padEnd(10)} ${tyre.padEnd(13)} finished ${row.finished}/${field} retired ${row.retired} pits ${row.pitStops} impact ${row.maxImpact.toFixed(2)} finite=${row.finite} time ${row.raceTimeS.toFixed(0)} s`,
  );
}

const dry = (tyre: Compound) => stints.find((s) => s.weather === 'clear' && s.tyre === tyre)?.meanLap;
const best = (weather: WeatherPreset) =>
  Math.min(...stints.filter((s) => s.weather === weather).map((s) => s.meanLap));
const base = dry('medium') ?? best('clear');
console.log('\n| weather | tyre | mean lap (s) | vs dry medium | min vis (m) | mean water (mm) | front-left grip | tyre T (C) |');
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const s of stints)
  console.log(
    `| ${s.weather} | ${s.tyre} | ${s.meanLap.toFixed(2)} | ${(((s.meanLap - base) / base) * 100).toFixed(1)} % | ${s.minVisibilityM.toFixed(0)} | ${s.meanWaterMm.toFixed(3)} | ${s.gripFrontLeft.toFixed(2)} | ${s.tyreTempC.toFixed(0)} |`,
  );
console.log(`\ncompleted in ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ circuit, laps, field, stints, races }, null, 2));
const bad = [...stints, ...races].filter((r) => !r.finite);
if (bad.length) {
  console.error(`non-finite state in ${bad.length} run(s)`);
  process.exitCode = 1;
}
