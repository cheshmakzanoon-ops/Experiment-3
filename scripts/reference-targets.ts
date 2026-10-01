// Production-vehicle performance measured against public Formula 1 figures.
// The Vehicle, tyre, aero, drivetrain and brake solvers run unchanged on the
// isolated laboratory surfaces (scripts/dynamics-fixtures.ts). Only inputs are
// scripted: no pose, velocity or grip is written during a measured run.
// Writes docs/reference-targets.json. Exit code 1 only with --strict when a
// measurement falls outside its reference band.
import { writeFileSync } from 'node:fs';
import { clamp, G } from '../src/core/math.ts';
import { DEFAULT_SETUP, VEHICLE, type Compound } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from './dynamics-fixtures.ts';

const DT = 1 / 240;
const strict = process.argv.includes('--strict');

interface Reference {
  low: number;
  high: number;
  unit: string;
  source: string;
}
/** Public, approximate figures for current Formula 1 cars. They are bands,
 * not single values: they vary by season, circuit trim and conditions. */
const REFERENCE: Record<string, Reference> = {
  accel0to100: {
    low: 2.3,
    high: 3.2,
    unit: 's',
    source: 'About 2.5-2.6 s (F1 Academy "The car and engine"; F1 fan references)',
  },
  accel0to200: {
    low: 4.3,
    high: 5.8,
    unit: 's',
    source: 'About 4.5-5 s (F1 fan and technical summaries)',
  },
  topSpeed: {
    low: 320,
    high: 360,
    unit: 'km/h',
    source: 'Race-trim speed traps roughly 320-350 km/h (low-drag circuits)',
  },
  braking200Distance: {
    low: 50,
    high: 70,
    unit: 'm',
    source: 'Brembo: about 2.9 s and 65 m from 200 km/h',
  },
  braking200Time: {
    low: 2.4,
    high: 3.3,
    unit: 's',
    source: 'Brembo: about 2.9 s and 65 m from 200 km/h',
  },
  peakBrakingG: {
    low: 4.0,
    high: 6.0,
    unit: 'g',
    source: 'Brembo corner data: 4.5 g (Mexico T4), 4.8 g (Singapore T14)',
  },
  lateralFastG: {
    low: 4.0,
    high: 6.5,
    unit: 'g',
    source: 'High-speed corners 4-6.5 g (Mercedes-AMG F1 "G-force explained"; Copse ~5.5 g)',
  },
  lateralSlowG: {
    low: 1.8,
    high: 3.2,
    unit: 'g',
    source: 'Engineering estimate for ~80 km/h hairpins (mechanical grip, little downforce)',
  },
};

function standing(track: DynamicsTrack, compound: Compound = 'medium', assist: 'raw' | 'sport' = 'sport') {
  const car = new Vehicle(0, compound, DEFAULT_SETUP, assist);
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(DT, track);
  car.input.brake = 0;
  return car;
}
/** Specified initial condition at speed (as in dynamics-benchmark.ts). */
function rolling(track: DynamicsTrack, speed: number, compound: Compound = 'medium') {
  const car = standing(track, compound, 'raw');
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  car.gear = clamp(Math.ceil(speed / 12), 1, 8);
  car.clutch.engineOmega = Math.max(
    (VEHICLE.idleRPM * Math.PI) / 30,
    (speed / VEHICLE.wheelRadius) * VEHICLE.gearRatios[car.gear + 1] * VEHICLE.finalDrive,
  );
  return car;
}

function acceleration() {
  const track = new DynamicsTrack();
  const car = standing(track);
  car.input.throttle = 1;
  car.input.ers = 2;
  const marks: Record<number, number> = {};
  let peak = 0,
    sinceGain = 0;
  for (let i = 0; i < 240 * 90 && sinceGain < 4; i++) {
    car.step(DT, track);
    const kmh = car.speed * 3.6;
    for (const target of [100, 200, 300]) if (!marks[target] && kmh >= target) marks[target] = i * DT;
    if (car.speed > peak + 0.01) {
      peak = car.speed;
      sinceGain = 0;
    } else sinceGain += DT;
  }
  return {
    to100s: marks[100] ?? null,
    to200s: marks[200] ?? null,
    to300s: marks[300] ?? null,
    topSpeedKmh: peak * 3.6,
    batteryLeftJ: car.battery,
  };
}

function braking(kmh: number, waterMm = 0, compound: Compound = 'medium') {
  const track = new DynamicsTrack('runway', waterMm);
  const car = rolling(track, kmh / 3.6, compound);
  const start = car.body.position.z;
  car.input.brake = 1;
  let ticks = 0,
    peakG = 0,
    previous = car.speed;
  for (; ticks < 240 * 20 && car.speed > 0.2; ticks++) {
    car.step(DT, track);
    // Speed-derivative deceleration, averaged over 1/24 s against noise.
    if (ticks % 10 === 9) {
      peakG = Math.max(peakG, (previous - car.speed) / (10 * DT) / G);
      previous = car.speed;
    }
  }
  return { distanceM: car.body.position.z - start, timeS: ticks * DT, peakG };
}

/** Constant-speed ramp-steer (ISO 4138 style): hold speed with the throttle
 * while the steering input rises slowly; the peak filtered lateral
 * acceleration before it falls away is the car's limit at that speed. */
function lateralLimit(kmh: number) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const car = rolling(track, speed);
  let steer = 0,
    filtered = 0,
    peak = 0,
    peakSpeed = speed,
    peakSteer = 0;
  for (let i = 0; i < 240 * 60; i++) {
    steer += 0.012 * DT;
    car.input.steer = steer;
    car.input.throttle = clamp((speed - car.speed) * 0.6 + 0.2, 0, 1);
    car.input.brake = 0;
    car.step(DT, track);
    filtered += (Math.abs(car.gLat) - filtered) * Math.min(1, DT / 0.25);
    if (filtered > peak) {
      peak = filtered;
      peakSpeed = car.speed;
      peakSteer = steer;
    }
    // Past the limit: lateral acceleration has fallen well below the peak.
    if (i > 240 * 2 && filtered < peak * 0.85) break;
    if (car.speed < speed * 0.8) break;
  }
  return { targetKmh: kmh, lateralG: peak, speedAtPeakKmh: peakSpeed * 3.6, steerInput: peakSteer };
}

const accel = acceleration();
const brake100 = braking(100),
  brake200 = braking(200),
  brake300 = braking(300);
const wetSlick = braking(200, 1.2, 'medium'),
  wetFull = braking(200, 1.2, 'wet'),
  wetInter = braking(200, 1.2, 'intermediate');
// A slow hairpin, a medium corner and fast (Copse-like) sweepers.
const slow = lateralLimit(80),
  medium = lateralLimit(160),
  fast = lateralLimit(240),
  veryFast = lateralLimit(290);

const measured: Record<string, number | null> = {
  accel0to100: accel.to100s,
  accel0to200: accel.to200s,
  topSpeed: accel.topSpeedKmh,
  braking200Distance: brake200.distanceM,
  braking200Time: brake200.timeS,
  peakBrakingG: Math.max(brake100.peakG, brake200.peakG, brake300.peakG),
  lateralFastG: Math.max(fast.lateralG, veryFast.lateralG),
  lateralSlowG: slow.lateralG,
};
const comparison = Object.entries(REFERENCE).map(([key, ref]) => {
  const value = measured[key];
  return {
    metric: key,
    measured: value,
    unit: ref.unit,
    reference: [ref.low, ref.high],
    within: value !== null && value >= ref.low && value <= ref.high,
    source: ref.source,
  };
});
const report = {
  fixture: 'Production Vehicle on isolated analytic runway and constant-radius skidpads',
  fixedDtSeconds: DT,
  comparison,
  detail: {
    acceleration: accel,
    braking: { from100: brake100, from200: brake200, from300: brake300 },
    wetBraking200: {
      standingWaterMm: 1.2,
      slick: wetSlick,
      intermediate: wetInter,
      wet: wetFull,
      dryReference: brake200,
    },
    lateral: { slow, medium, fast, veryFast },
  },
};
writeFileSync('docs/reference-targets.json', JSON.stringify(report, null, 2) + '\n');
for (const c of comparison)
  console.log(
    `${c.within ? 'OK  ' : 'OUT '} ${c.metric.padEnd(20)} ${c.measured === null ? 'n/a' : c.measured.toFixed(2)} ${c.unit}  [${c.reference.join(', ')}]`,
  );
console.log('wet 200 km/h stop (m): slick', wetSlick.distanceM.toFixed(1), 'inter', wetInter.distanceM.toFixed(1), 'wet', wetFull.distanceM.toFixed(1), 'dry', brake200.distanceM.toFixed(1));
console.log('lateral', JSON.stringify(report.detail.lateral));
if (strict && comparison.some((c) => !c.within)) process.exitCode = 1;
