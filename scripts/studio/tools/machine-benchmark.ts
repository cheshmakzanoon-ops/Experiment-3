// Machine benchmark (Gameplay QA - Handling & Calibration). For EVERY registered machine, on a
// fixed dry day with no weather and the default 'sport' assist, it measures with the production
// vehicle solver and the production Simulation:
//   0-100 and 0-200 km/h, top speed, 100-0 km/h braking distance, steady-state skidpad lateral g
//   at R = 50 m (closed loop: the driver holds the circle while the speed creeps up), a slalom
//   exit speed (coasting through three 60 m waves at 80 km/h, compared with a straight coast),
//   one reference lap by the production AI driver on Aurel (and on a dirt / rallycross venue for
//   off-road machines), mass and power / weight.
// Straight-line, braking, skidpad and slalom runs use the entrant factory the Simulation uses
// (createEntrant: Vehicle, BikeVehicle or DirtBikeVehicle) on the isolated analytic runway /
// skidpad of scripts/dynamics-fixtures.ts (the repository's calibration fixture). Laps run the
// whole production Simulation: AI driver, race control, lap timing, a solo practice session.
//
// Each result is judged against GENERAL-KNOWLEDGE class sanity bands (ARCHETYPE_BANDS below).
// They are rough real-world class ranges written from public, common knowledge for this review.
// They are NOT licensed or measured data for any vehicle, and the machines here are original.
//
//   node --no-warnings --experimental-transform-types scripts/studio/tools/machine-benchmark.ts \
//        [--ids a,b] [--no-laps] [--laps-only] [--out docs/studio/reports/machine-benchmark] \
//        [--baseline path/to/before.json] [--merge]
// Writes <out>.json and <out>.md. --merge keeps the machines not named by --ids from the existing
// <out>.json. --baseline adds a before/after table. A full run is about 10 minutes of one CPU.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { clamp, G } from '../../../src/core/math.ts';
import { SIMULATION_VERSION } from '../../../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../../../src/simulation/config.ts';
import { BikeVehicle } from '../../../src/simulation/bike-vehicle.ts';
import { createEntrant } from '../../../src/simulation/offroad/session.ts';
import { isDirtBike } from '../../../src/simulation/offroad/dirt-bikes.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import { classInfo } from '../../../src/simulation/vehicle-classes.ts';
import { peakPowerKw } from '../../../src/ui/machine-power.ts';
import { VEHICLES, type VehicleDefinition } from '../../../src/simulation/vehicles.ts';
import { Simulation } from '../../../src/simulation/world.ts';
import { DynamicsTrack } from '../../dynamics-fixtures.ts';
import type { Vehicle } from '../../../src/simulation/vehicle.ts';

const argv = process.argv.slice(2);
const flagValue = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = flagValue('--ids')?.split(',');
const OUT = flagValue('--out') ?? 'docs/studio/reports/machine-benchmark';
const BASELINE = flagValue('--baseline');
const skipLaps = argv.includes('--no-laps');
const lapsOnly = argv.includes('--laps-only');
const merge = argv.includes('--merge');
/** --rejudge <json>: re-run the judgement and the report on recorded measurements. */
const REJUDGE = flagValue('--rejudge');

const DT = 1 / 240;
/** Skidpad radius (m) and the slalom course (entry km/h, wave length m, amplitude m, waves). */
const SKID_RADIUS = 50;
/** The second, fast sweeper radius (m): downforce machines show their aero grip here. */
const SKID_FAST_RADIUS = 150;
const SLALOM = { entryKmh: 80, wavelength: 60, amplitude: 1, waves: 3, runUp: 60 } as const;

// ---------------------------------------------------------------------------------------------
// General-knowledge sanity bands per archetype. lo/hi pairs: [0-100 s], [0-200 s | null],
// [top km/h], [100-0 m], [skidpad g at R = 50 m].
// ---------------------------------------------------------------------------------------------
type Range = readonly [number, number];
interface Band {
  label: string;
  a100: Range;
  a200?: Range;
  top: Range;
  brake: Range;
  skid: Range;
  /** Expected pace tier on a car circuit (1 = quickest); used for the lap ordering check. */
  tier: number;
}
const B = (
  label: string,
  tier: number,
  a100: Range,
  top: Range,
  brake: Range,
  skid: Range,
  a200?: Range,
): Band => ({ label, tier, a100, top, brake, skid, ...(a200 ? { a200 } : {}) });
export const ARCHETYPE_BANDS: Readonly<Record<string, Band>> = {
  'formula-top': B(
    'top-tier formula car',
    1,
    [2.2, 2.6],
    [320, 360],
    [14, 30],
    [2.2, 3.8],
    [4.2, 7],
  ),
  'formula-top-lowdf': B(
    'top-tier formula car with a quarter less downforce',
    1,
    [2.2, 2.6],
    [320, 360],
    [14, 30],
    [2.2, 3.8],
    [4.2, 7],
  ),
  'formula-feeder-high': B(
    'feeder formula, turbo V6',
    2,
    [2.5, 3.4],
    [270, 340],
    [16, 32],
    [2, 3.6],
  ),
  'formula-feeder-mid': B('third-rung formula', 3, [2.8, 3.8], [250, 295], [18, 34], [1.8, 3.2]),
  'formula-entry': B('entry formula (halo era)', 5, [3.4, 4.7], [190, 240], [20, 34], [1.4, 2.4]),
  'historic-60s': B('1960s cigar-tube formula', 5, [3.4, 5], [250, 310], [30, 50], [0.95, 1.5]),
  'historic-70s': B('1970s winged formula', 3, [2.9, 4], [265, 315], [24, 40], [1.3, 2.2]),
  'historic-80s-turbo': B('1980s turbo formula', 2, [2.5, 3.6], [300, 350], [20, 36], [1.5, 2.6]),
  'hypercar-lmp': B(
    'top-class endurance prototype',
    2,
    [2.4, 3.4],
    [310, 350],
    [18, 32],
    [1.8, 3.2],
  ),
  'prototype-lmp2': B('second-tier prototype', 3, [2.7, 3.8], [280, 335], [18, 34], [1.7, 3]),
  'prototype-70s': B('1970s long-tail prototype', 6, [3, 4.6], [320, 365], [28, 44], [1, 1.6]),
  gt3: B('GT3-style racing GT', 4, [3, 3.6], [260, 300], [24, 36], [1.4, 1.8]),
  'gt-entry': B('entry GT (GT4-style)', 5, [3.4, 4.6], [240, 285], [27, 40], [1.15, 1.65]),
  touring: B('touring car', 6, [3.2, 5.6], [210, 270], [24, 40], [1.1, 1.65]),
  'club-roadster': B('lightweight club roadster', 6, [3.8, 5.2], [180, 230], [26, 40], [1.1, 1.6]),
  'club-hatch': B('hot-hatch club racer', 7, [4.6, 6.2], [210, 250], [28, 42], [1, 1.45]),
  'hot-hatch-road': B('road hot hatch', 8, [5, 7], [230, 270], [32, 44], [0.85, 1.15]),
  'vintage-club': B('1960s vintage club roadster', 9, [6, 9], [170, 210], [34, 52], [0.8, 1.1]),
  'rally-modern': B(
    'modern rally car (on asphalt)',
    7,
    [3.4, 5.2],
    [170, 215],
    [30, 46],
    [0.9, 1.3],
  ),
  'rally-70s': B('1970s rally saloon', 8, [4.6, 6.6], [165, 205], [32, 50], [0.85, 1.25]),
  'rally-group-b': B(
    '1980s group-supercar rally',
    7,
    [2.6, 3.9],
    [195, 240],
    [30, 46],
    [0.95, 1.35],
  ),
  rallycross: B('rallycross supercar', 6, [1.9, 3], [200, 250], [28, 44], [1, 1.5]),
  'rallycross-electric': B('electric rallycross', 6, [1.9, 3], [200, 245], [28, 46], [1, 1.5]),
  'trophy-truck': B('desert trophy truck', 10, [4.2, 6.8], [170, 230], [38, 62], [0.6, 1]),
  'desert-buggy': B('desert buggy', 9, [3.8, 6], [170, 215], [36, 56], [0.7, 1.1]),
  'kart-shifter': B('gearbox kart', 7, [3, 4.8], [110, 170], [14, 30], [1.5, 2.4]),
  // A rear-axle brake only: stops in about 1 g less than a four-wheel-braked kart.
  'kart-direct': B('direct-drive sprint kart', 10, [5.5, 10], [95, 125], [28, 45], [1.3, 2.2]),
  'hypercar-electric-road': B(
    'electric road hypercar',
    4,
    [2, 2.5],
    [300, 420],
    [28, 40],
    [1, 1.5],
    [4.5, 7.5],
  ),
  'supercar-road': B('road supercar', 5, [2.6, 3.4], [310, 350], [30, 38], [1.05, 1.4]),
  'sports-sedan': B('four-door sports sedan', 7, [3.3, 4.4], [250, 310], [32, 42], [0.95, 1.25]),
  muscle: B('muscle coupe', 8, [3.8, 5], [250, 300], [33, 44], [0.9, 1.2]),
  'classic-gt': B('1960s grand tourer', 9, [5.5, 7.5], [230, 280], [36, 52], [0.8, 1.1]),
  pickup: B('performance pickup', 10, [4.8, 7.2], [160, 200], [38, 56], [0.7, 1]),
  'rally-road': B('rally-bred road car', 8, [4.2, 5.8], [230, 270], [32, 44], [0.95, 1.25]),
  'luxury-gt': B('luxury grand tourer', 7, [3.2, 4.3], [290, 345], [34, 44], [0.9, 1.2]),
  roadster: B('light road roadster', 9, [5.5, 7.5], [200, 245], [32, 44], [0.95, 1.25]),
  'experimental-fan': B('fan-assisted prototype', 1, [2.4, 3.4], [290, 335], [13, 26], [2, 3.4]),
  'experimental-electric-ta': B(
    'electric time-attack prototype',
    2,
    [1.9, 2.8],
    [240, 290],
    [16, 28],
    [1.8, 3],
  ),
  'experimental-hydrogen': B('hydrogen prototype', 3, [2.4, 3.4], [290, 340], [20, 34], [1.5, 2.6]),
  'experimental-v12': B('track-only V12 hypercar', 2, [2.3, 3.2], [330, 370], [18, 32], [1.6, 2.6]),
  'gp-bike': B('GP prototype motorcycle', 2, [2.6, 3], [330, 360], [26, 42], [1.3, 1.8]),
  superbike: B('production-based superbike', 4, [2.7, 3.5], [285, 320], [30, 45], [1.1, 1.5]),
  supersport: B('600 cc supersport', 5, [3, 4.2], [235, 275], [32, 48], [1, 1.4]),
  naked: B('naked roadster', 6, [3, 4], [200, 245], [34, 52], [0.9, 1.25]),
  'classic-bike': B('1970s two-stroke racer', 7, [3.6, 5.2], [200, 260], [40, 60], [0.8, 1.15]),
  'motocross-450': B(
    '450 cc four-stroke motocross',
    11,
    [4, 6.5],
    [130, 150],
    [35, 55],
    [0.7, 1.1],
  ),
  'motocross-250-2t': B(
    '250 cc two-stroke motocross',
    11,
    [4, 6.5],
    [115, 150],
    [35, 55],
    [0.7, 1.1],
  ),
  supermoto: B('450 cc supermoto', 8, [3.6, 5], [140, 175], [28, 42], [0.95, 1.3]),
};
/** Lateral g on the 150 m circle, only for machines whose grip is mostly aerodynamic. */
export const FAST_SKID: Readonly<Record<string, Range>> = {
  'formula-top': [3, 5.5],
  'formula-top-lowdf': [2.4, 4.5],
  'formula-feeder-high': [2, 3.6],
  'formula-feeder-mid': [2, 3.6],
  'formula-entry': [1.5, 2.6],
  'historic-70s': [1.4, 2.6],
  'historic-80s-turbo': [1.8, 3.4],
  'hypercar-lmp': [2.2, 4],
  'prototype-lmp2': [2, 3.6],
  gt3: [1.4, 2.2],
  'experimental-fan': [2.8, 4.5],
  'experimental-electric-ta': [2.4, 3.8],
  'experimental-hydrogen': [1.8, 3.2],
  'experimental-v12': [2, 3.4],
  'gp-bike': [1.3, 1.9],
};
/** Archetype of every machine id (this review's judgement of what each one is meant to be). */
export const ARCHETYPE: Readonly<Record<string, string>> = {
  apx01: 'formula-top',
  fx26: 'formula-top-lowdf',
  jf2: 'formula-feeder-high',
  fr3: 'formula-feeder-mid',
  fe4: 'formula-entry',
  hf67: 'historic-60s',
  hf76: 'historic-70s',
  hf86: 'historic-80s-turbo',
  hy9: 'hypercar-lmp',
  hy11: 'hypercar-lmp',
  pr2: 'prototype-lmp2',
  pr3: 'prototype-lmp2',
  sp71: 'prototype-70s',
  gt8f: 'gt3',
  gt10m: 'gt3',
  gt6r: 'gt3',
  gt6s: 'gt3',
  gs4: 'gt-entry',
  gs6m: 'gt-entry',
  tc1: 'touring',
  tc2: 'touring',
  tc3: 'touring',
  cr1: 'club-roadster',
  hh2: 'club-hatch',
  rh3: 'hot-hatch-road',
  vc62: 'vintage-club',
  rl2: 'rally-modern',
  rl7: 'rally-70s',
  gb4: 'rally-group-b',
  rcx6: 'rallycross',
  rxe: 'rallycross-electric',
  dx8: 'trophy-truck',
  bg2: 'desert-buggy',
  sk125: 'kart-shifter',
  dk100: 'kart-direct',
  eh3: 'hypercar-electric-road',
  sc7: 'supercar-road',
  rs5: 'sports-sedan',
  rm8: 'muscle',
  rg63: 'classic-gt',
  rp6: 'pickup',
  rr4: 'rally-road',
  lx12: 'luxury-gt',
  rd2: 'roadster',
  xf2: 'experimental-fan',
  xe1: 'experimental-electric-ta',
  xh3: 'experimental-hydrogen',
  xt1: 'experimental-v12',
  gpr1: 'gp-bike',
  gpr2: 'gp-bike',
  sbk1000: 'superbike',
  ss600: 'supersport',
  nr900: 'naked',
  cr750: 'classic-bike',
  mx450: 'motocross-450',
  mx250: 'motocross-250-2t',
  sm450: 'supermoto',
};

// ---------------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------------
const isBikeDef = (def: VehicleDefinition) => def.dynamicsKind === 'bike';
function make(def: VehicleDefinition, track: DynamicsTrack): Vehicle {
  const v = createEntrant(0, DEFAULT_OPTIONS.compound, DEFAULT_SETUP, DEFAULT_OPTIONS.assist, def);
  v.place(track, 0);
  return v;
}
function settle(v: Vehicle, track: DynamicsTrack) {
  // Four-wheel machines are held on the brake for 2 s so the springs settle (as the calibration lab).
  if (v instanceof BikeVehicle) return;
  v.input.brake = 1;
  for (let t = 0; t < 2; t += DT) v.step(DT, track);
  v.input.brake = 0;
}
interface Pose {
  x: number;
  z: number;
  heading: number;
}
function pose(v: Vehicle): Pose {
  if (v instanceof BikeVehicle)
    return { x: v.dynamics.x, z: v.dynamics.z, heading: v.dynamics.heading };
  return {
    x: v.body.position.x,
    z: v.body.position.z,
    heading: Math.atan2(v.forward.x, v.forward.z),
  };
}
const crashesOf = (v: Vehicle) => (v instanceof BikeVehicle ? v.dynamics.crashes : 0);
const ridingOk = (v: Vehicle) => !(v instanceof BikeVehicle) || v.riding;
/** Gears a car at the highest ratio that keeps the engine above its downshift point. */
function rolling(def: VehicleDefinition, track: DynamicsTrack, speed: number): Vehicle {
  const car = make(def, track);
  settle(car, track);
  if (car instanceof BikeVehicle) {
    car.input.throttle = 1;
    for (let t = 0; t < 40 && car.speed < speed; t += DT) car.step(DT, track);
    return car;
  }
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  const spec = def.spec;
  let gear = spec.gearRatios.length - 2;
  while (
    gear > 1 &&
    ((speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) / Math.PI <
      spec.downshiftRPM
  )
    gear--;
  car.gear = gear;
  car.clutch.engineOmega = Math.max(
    (spec.idleRPM * Math.PI) / 30,
    (speed / spec.wheelRadius) * spec.gearRatios[car.gear + 1] * spec.finalDrive,
  );
  return car;
}

// ---------------------------------------------------------------------------------------------
// Straight line: 0-100, 0-200, top speed
// ---------------------------------------------------------------------------------------------
function straightLine(def: VehicleDef) {
  const track = new DynamicsTrack();
  const v = make(def, track);
  settle(v, track);
  v.input.throttle = 1;
  v.input.ers = 2;
  let to100: number | null = null,
    to200: number | null = null,
    peak = 0,
    sinceGain = 0,
    t = 0,
    gear = v.gear;
  const shifts: number[] = [];
  for (; t < 150 && sinceGain < 4; t += DT) {
    v.step(DT, track);
    if (v.gear !== gear) {
      gear = v.gear;
      shifts.push(t);
    }
    if (to100 === null && v.speed * 3.6 >= 100) to100 = t;
    if (to200 === null && v.speed * 3.6 >= 200) to200 = t;
    if (v.speed > peak + 0.01) {
      peak = v.speed;
      sinceGain = 0;
    } else sinceGain += DT;
  }
  // Gear changes in the last 10 s of the run: a clean top-speed run has none (hunting has dozens).
  const late = shifts.filter((x) => x > t - 10).length;
  return {
    to100,
    to200,
    topKmh: peak * 3.6,
    crashes: crashesOf(v),
    shiftsLast10s: late,
    runSeconds: t,
  };
}
type VehicleDef = VehicleDefinition;

// ---------------------------------------------------------------------------------------------
// Braking 100 -> 0
// ---------------------------------------------------------------------------------------------
function braking(def: VehicleDef, kmh = 100) {
  const track = new DynamicsTrack('runway');
  const v = rolling(def, track, kmh / 3.6);
  const start = pose(v).z;
  v.input.throttle = 0;
  v.input.brake = 1;
  v.input.clutch = isBikeDef(def) ? 1 : 0; // a bike's rear brake rides on the clutch input
  let peakG = 0,
    previous = v.speed,
    ticks = 0;
  for (; ticks * DT < 20 && v.speed > 0.2; ticks++) {
    v.step(DT, track);
    if (ticks % 10 === 9) {
      peakG = Math.max(peakG, (previous - v.speed) / (10 * DT) / G);
      previous = v.speed;
    }
  }
  return { distanceM: pose(v).z - start, peakG, stopped: v.speed <= 0.2, crashes: crashesOf(v) };
}

// ---------------------------------------------------------------------------------------------
// Closed-loop path following (shared by the skidpad and the slalom)
// ---------------------------------------------------------------------------------------------
/** Steering command for a wanted path curvature (1/m, + toward +x, the car's left). */
function steerFor(v: Vehicle, kappa: number) {
  if (v instanceof BikeVehicle) {
    // A held positive lean input turns left, like a car's positive steer (the first instant
    // counter-steers the other way, which is why bikes need a long preview below).
    const lean = Math.atan((v.speed * v.speed * kappa) / G);
    return clamp(lean / Math.max(0.2, v.dynamics.leanLimit), -1, 1);
  }
  const spec = v.spec;
  const speedSteer = v.assist === 'sport' ? 1 / (1 + v.speed * 0.018) : 1;
  return clamp(Math.atan(spec.wheelbase * kappa) / (spec.maxSteer * speedSteer), -1, 1);
}
/** Steering preview (s): a bike's lean lags its command, so it needs a long preview to stay stable. */
const previewSeconds = (v: Vehicle) => (v instanceof BikeVehicle ? 1.2 : 0.4);
/** Pure-pursuit curvature toward (tx, tz) from the vehicle's pose. */
function pursuit(p: Pose, tx: number, tz: number) {
  const dx = tx - p.x,
    dz = tz - p.z,
    forward = dx * Math.sin(p.heading) + dz * Math.cos(p.heading),
    left = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
  return (2 * left) / Math.max(1, forward * forward + left * left);
}
class Follower {
  trim = 0;
  private last: number | null = null;
  rate = 0;
  constructor(
    private readonly v: Vehicle,
    private readonly gain = 0,
  ) {}
  /** Steer toward the wanted curvature with an integral trim on the curvature actually made. */
  steer(kappa: number) {
    const h = pose(this.v).heading;
    if (this.last !== null) {
      let d = h - this.last;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.rate += (d / DT - this.rate) * Math.min(1, DT / 0.1);
    }
    this.last = h;
    if (this.gain && this.v.speed > 3) {
      const made = this.rate / this.v.speed;
      this.trim = clamp(this.trim + this.gain * (kappa - made) * DT, -0.5, 0.5);
    }
    this.v.input.steer = clamp(steerFor(this.v, kappa) + this.trim, -1, 1);
  }
}
/** Throttle / brake that hold `target` m/s. */
function holdSpeed(v: Vehicle, target: number, brakeAbove = 1.5) {
  const error = target - v.speed;
  v.input.throttle = clamp(0.35 + 0.9 * error, 0, 1);
  v.input.brake = error < -brakeAbove ? clamp((-error - brakeAbove) * 0.2, 0, 0.5) : 0;
}

// ---------------------------------------------------------------------------------------------
// Skidpad: closed loop on a circle of radius R, speed creeping up until the circle is lost
// ---------------------------------------------------------------------------------------------
function skidpad(def: VehicleDef, R: number, rate: number) {
  const track = new DynamicsTrack('skidpad', 0, R);
  const v = make(def, track);
  settle(v, track);
  const bike = v instanceof BikeVehicle;
  // Cars trim their steering on the curvature actually made; a bike's lean lag makes that unstable.
  const follower = new Follower(v, bike ? 0 : 25);
  // A bike launches on the circle's own curvature (feed-forward) until it can balance.
  let target = bike ? 9 : 6,
    filtered = 0,
    peak = 0,
    peakSpeed = 0,
    off = 0,
    t = 0,
    rel = 0,
    ended = '';
  v.input.ers = 2;
  for (; t < 300; t += DT) {
    const p = pose(v);
    const radial = Math.hypot(p.x - R, p.z),
      theta = Math.atan2(p.z, R - p.x),
      look = Math.max(5, previewSeconds(v) * v.speed),
      ahead = theta + look / R;
    follower.steer(
      bike && v.speed < 7 ? 1 / R : pursuit(p, R * (1 - Math.cos(ahead)), R * Math.sin(ahead)),
    );
    target += rate * DT;
    holdSpeed(v, target, 3);
    v.step(DT, track);
    // The circle's tangent heading at angle theta is theta itself.
    const err = radial - R,
      misalign = Math.abs(Math.atan2(Math.sin(p.heading - theta), Math.cos(p.heading - theta)));
    // Steady-state lateral acceleration on the circle is v^2 / R, counted only while the machine
    // is on the circle and pointing along it (not while it settles or once it slides off).
    const signed = Math.atan2(Math.sin(p.heading - theta), Math.cos(p.heading - theta));
    rel += (signed - rel) * Math.min(1, DT / 0.3);
    const onCircle = Math.abs(err) < 2 && misalign < 0.2 && v.speed > 4;
    if (onCircle) filtered += ((v.speed * v.speed) / (R * G) - filtered) * Math.min(1, DT / 0.6);
    if (t > 3 && onCircle && filtered > peak) {
      peak = filtered;
      peakSpeed = v.speed;
    }
    off = Math.abs(err) > 6 ? off + DT : 0;
    if (off > 0.8) {
      ended = 'left the circle';
      break;
    }
    if (!ridingOk(v)) {
      ended = 'fell';
      break;
    }
    if (target > 105) {
      ended = 'speed cap';
      break;
    }
  }
  return {
    g: peak,
    speedKmh: peakSpeed * 3.6,
    ended: ended || 'time',
    crashes: crashesOf(v),
    limitRelDeg: (rel * 180) / Math.PI,
  };
}

// ---------------------------------------------------------------------------------------------
// Balance on the 50 m circle at 90 % of the machine's limit speed (cars): understeer gradient,
// then the same steady state pushed open-loop by a throttle lift and by full throttle
// ---------------------------------------------------------------------------------------------
function onCircle(def: VehicleDef, speed: number) {
  const R = SKID_RADIUS,
    track = new DynamicsTrack('skidpad', 0, R),
    v = make(def, track);
  settle(v, track);
  const follower = new Follower(v, 25);
  let target = 6,
    held = 0,
    steerSum = 0,
    n = 0;
  v.input.ers = 2;
  for (let t = 0; t < 120 && held < 5; t += DT) {
    const p = pose(v),
      theta = Math.atan2(p.z, R - p.x),
      ahead = theta + Math.max(5, previewSeconds(v) * v.speed) / R;
    follower.steer(pursuit(p, R * (1 - Math.cos(ahead)), R * Math.sin(ahead)));
    if (target < speed) target = Math.min(speed, target + DT);
    else held += DT;
    holdSpeed(v, target, 3);
    v.step(DT, track);
    if (held > 2.5) {
      steerSum += v.steer;
      n++;
    }
  }
  return { v, track, R, steer: n ? steerSum / n : 0 };
}
function relative(v: Vehicle, R: number) {
  const p = pose(v);
  return p.heading - Math.atan2(p.z, R - p.x);
}
/** Hold the steering fixed for 1.5 s with the throttle given; the rotation (deg, + toward the
 * centre of the circle) and the drift (m, + outward) it causes. */
function push(state: ReturnType<typeof onCircle>, throttle: number) {
  const { v, track, R } = state,
    hold = v.input.steer,
    rel0 = relative(v, R),
    r0 = Math.hypot(pose(v).x - R, pose(v).z);
  for (let t = 0; t < 1.5; t += DT) {
    v.input.steer = hold;
    v.input.throttle = throttle;
    v.input.brake = 0;
    v.step(DT, track);
  }
  const d = relative(v, R) - rel0;
  return {
    rotDeg: (Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI,
    driftM: Math.hypot(pose(v).x - R, pose(v).z) - r0,
  };
}
function balance(def: VehicleDef, limitKmh: number) {
  const speed = (0.9 * limitKmh) / 3.6;
  const a = onCircle(def, speed),
    ay = (a.v.speed * a.v.speed) / (a.R * G);
  const gradient =
    ((a.steer - Math.atan(def.spec.wheelbase / a.R)) / Math.max(0.2, ay)) * (180 / Math.PI);
  const lift = push(onCircle(def, speed), 0),
    power = push(onCircle(def, speed), 1);
  return {
    understeerDegPerG: gradient,
    liftRotDeg: lift.rotDeg,
    powerRotDeg: power.rotDeg,
    powerDriftM: power.driftM,
    atG: ay,
  };
}

// ---------------------------------------------------------------------------------------------
// Slalom: 80 km/h, coasting, three 60 m waves of 1 m amplitude
// ---------------------------------------------------------------------------------------------
function slalom(def: VehicleDef, weave: boolean) {
  const track = new DynamicsTrack('runway');
  const entry = SLALOM.entryKmh / 3.6;
  const v = rolling(def, track, entry);
  const follower = new Follower(v, 0);
  const length = SLALOM.wavelength * SLALOM.waves;
  const z0 = pose(v).z + SLALOM.runUp;
  const path = (z: number) =>
    z <= z0 || z >= z0 + length
      ? 0
      : SLALOM.amplitude * Math.sin(((2 * Math.PI) / SLALOM.wavelength) * (z - z0));
  let maxDev = 0,
    t = 0;
  let coasting = false;
  for (; t < 40; t += DT) {
    const p = pose(v);
    if (p.z < z0) holdSpeed(v, entry);
    else if (!coasting) {
      coasting = true;
      v.input.throttle = 0;
      v.input.brake = 0;
      v.input.clutch = 0;
    }
    const look = Math.max(5, previewSeconds(v) * v.speed),
      tz = p.z + look;
    follower.steer(weave ? pursuit(p, path(tz), tz) : 0);
    v.step(DT, track);
    if (p.z >= z0 && p.z <= z0 + length) maxDev = Math.max(maxDev, Math.abs(p.x - path(p.z)));
    if (p.z >= z0 + length) break;
    if (!ridingOk(v)) return { exitKmh: null, maxDev, ok: false };
  }
  return { exitKmh: v.speed * 3.6, maxDev, ok: ridingOk(v) && pose(v).z >= z0 + length };
}

// ---------------------------------------------------------------------------------------------
// Reference lap by the production AI driver
// ---------------------------------------------------------------------------------------------
interface LapSetup {
  circuit: string;
  ruleset?: string;
  mode: 'practice' | 'race';
}
function referenceLap(def: VehicleDef, where: LapSetup, laps = 3) {
  const started = performance.now();
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: where.circuit as never,
    mode: where.mode,
    laps,
    opponents: 0,
    weather: 'clear',
    vehicles: [def.id],
    seed: 90210,
    ...(where.ruleset ? { ruleset: where.ruleset } : {}),
  });
  sim.autoPlayer = true;
  const times: number[] = [],
    valid: boolean[] = [];
  let seen = 0,
    stuck = 0,
    worstStuck = 0,
    crashes = 0;
  const limit = 120 * Math.max(300, (sim.track.length / 6) * (laps + 1));
  const lap = sim.race.laps[0];
  for (let tick = 0; tick < limit; tick++) {
    sim.step(1 / 120);
    const car = sim.cars[0];
    if (lap.completed !== seen) {
      seen = lap.completed;
      times.push(lap.last);
      valid.push(lap.lastValid);
    }
    if (sim.race.phase === PHASE.RACING && !car.finishTime && !car.inPit && car.speed < 1) {
      stuck += 1 / 120;
      worstStuck = Math.max(worstStuck, stuck);
    } else stuck = 0;
    if (sim.race.phase === PHASE.FINISHED || lap.completed >= laps + 1) break;
  }
  crashes = crashesOf(sim.cars[0]);
  const good = times.filter((_, i) => valid[i] && times[i] > 0);
  const best = good.length ? Math.min(...good) : times.length ? Math.min(...times) : null;
  return {
    circuit: where.circuit,
    lengthM: Math.round(sim.track.length),
    lapTimes: times.map((x) => +x.toFixed(2)),
    validLaps: good.length,
    bestS: best === null ? null : +best.toFixed(2),
    averageKmh: best ? +((sim.track.length / best) * 3.6).toFixed(1) : null,
    completed: lap.completed,
    worstStuckS: +worstStuck.toFixed(1),
    crashes,
    wallS: +((performance.now() - started) / 1000).toFixed(1),
  };
}
/** The venue a machine's second reference lap runs on, when it is not an Aurel machine. */
function dirtVenue(def: VehicleDef): LapSetup | null {
  if (isDirtBike(def))
    return def.id === 'sm450'
      ? null
      : { circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', mode: 'race' };
  if (['rallycross', 'rally', 'offroad', 'historic-rally'].includes(def.classId) && !isBikeDef(def))
    return { circuit: 'kestrel-rx', ruleset: 'rallycross-joker', mode: 'race' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Static numbers
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// One machine
// ---------------------------------------------------------------------------------------------
export interface MachineRow {
  id: string;
  name: string;
  classId: string;
  className: string;
  archetype: string;
  kind: 'car' | 'bike' | 'dirt-bike';
  drivetrain: string;
  massKg: number;
  powerKw: number;
  powerToWeightKwT: number;
  a100: number | null;
  a200: number | null;
  topKmh: number;
  brake100M: number;
  brake100PeakG: number;
  skidG: number;
  skidKmh: number;
  skidEnded: string;
  skidFastG: number;
  skidFastKmh: number;
  /** The fast circle was left at (nearly) top speed: power, not grip, ended it. */
  skidFastPowerLimited: boolean;
  /** Heading relative to the circle's tangent as the circle was lost (deg, + inward = spinning in). */
  limitRelDeg: number;
  shiftsLast10s: number;
  /** Steady-state understeer gradient at 90 % of the limit speed (deg/g, + understeer). */
  understeerDegPerG: number | null;
  /** Rotation caused by lifting off, and by full throttle (deg in 1.5 s, + inward). */
  liftRotDeg: number | null;
  powerRotDeg: number | null;
  powerDriftM: number | null;
  slalomExitKmh: number | null;
  slalomScrubKmh: number | null;
  slalomMaxDevM: number | null;
  slalomOk: boolean;
  falls: number;
  lap: ReturnType<typeof referenceLap> | null;
  dirtLap: ReturnType<typeof referenceLap> | null;
}
function measureMachine(def: VehicleDef, withLaps: boolean): MachineRow {
  const line = straightLine(def),
    stop = braking(def),
    skid = skidpad(def, SKID_RADIUS, 0.3),
    fastSkid = skidpad(def, SKID_FAST_RADIUS, 0.6),
    weave = slalom(def, true),
    straight = slalom(def, false);
  const dirt = dirtVenue(def);
  const feel = isBikeDef(def) ? null : balance(def, skid.speedKmh);
  return {
    id: def.id,
    name: def.name,
    classId: def.classId,
    className: classInfo(def.classId).name,
    archetype: ARCHETYPE[def.id] ?? 'unassigned',
    kind: isDirtBike(def) ? 'dirt-bike' : isBikeDef(def) ? 'bike' : 'car',
    drivetrain: isBikeDef(def) ? 'rwd' : def.drivetrain,
    massKg: def.spec.dryMass,
    powerKw: +peakPowerKw(def).toFixed(0),
    powerToWeightKwT: +((peakPowerKw(def) / def.spec.dryMass) * 1000).toFixed(0),
    a100: line.to100 === null ? null : +line.to100.toFixed(2),
    a200: line.to200 === null ? null : +line.to200.toFixed(2),
    topKmh: +line.topKmh.toFixed(0),
    brake100M: +stop.distanceM.toFixed(1),
    brake100PeakG: +stop.peakG.toFixed(2),
    skidG: +skid.g.toFixed(2),
    skidKmh: +skid.speedKmh.toFixed(0),
    skidEnded: skid.ended,
    skidFastG: +fastSkid.g.toFixed(2),
    skidFastKmh: +fastSkid.speedKmh.toFixed(0),
    skidFastPowerLimited: fastSkid.speedKmh >= 0.92 * line.topKmh,
    limitRelDeg: +skid.limitRelDeg.toFixed(1),
    shiftsLast10s: line.shiftsLast10s,
    understeerDegPerG: feel ? +feel.understeerDegPerG.toFixed(2) : null,
    liftRotDeg: feel ? +feel.liftRotDeg.toFixed(1) : null,
    powerRotDeg: feel ? +feel.powerRotDeg.toFixed(1) : null,
    powerDriftM: feel ? +feel.powerDriftM.toFixed(2) : null,
    slalomExitKmh: weave.exitKmh === null ? null : +weave.exitKmh.toFixed(1),
    slalomScrubKmh:
      weave.exitKmh === null || straight.exitKmh === null
        ? null
        : +(straight.exitKmh - weave.exitKmh).toFixed(1),
    slalomMaxDevM: +weave.maxDev.toFixed(2),
    slalomOk: weave.ok,
    falls: line.crashes + stop.crashes + skid.crashes + fastSkid.crashes,
    lap: withLaps ? referenceLap(def, { circuit: 'aurel', mode: 'practice' }) : null,
    dirtLap: withLaps && dirt ? referenceLap(def, dirt) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Judgement
/** Largest relative metric difference under which two machines have twin performance. */
const NEAR_IDENTICAL = 0.1;
// ---------------------------------------------------------------------------------------------
interface PairReport {
  a: string;
  b: string;
  scope: string;
  maxRelDiff: number;
  feelDistance: number | null;
  verdict: string;
}
export interface Flag {
  id: string;
  metric: string;
  value: number | string | null;
  band: string;
  message: string;
}
function judge(recorded: MachineRow[]) {
  // The archetype is this review's current judgement, so a re-judged old run uses today's table.
  const rows = recorded.map((r) => ({ ...r, archetype: ARCHETYPE[r.id] ?? r.archetype }));
  const flags: Flag[] = [];
  const check = (r: MachineRow, metric: string, value: number | null, band: Range | undefined) => {
    if (!band) return;
    if (value === null) {
      flags.push({
        id: r.id,
        metric,
        value,
        band: band.join('-'),
        message: `${metric}: not reached`,
      });
      return;
    }
    if (value < band[0] || value > band[1])
      flags.push({
        id: r.id,
        metric,
        value,
        band: band.join('-'),
        message: `${metric} ${value} is ${value < band[0] ? 'below' : 'above'} ${band[0]}-${band[1]}`,
      });
  };
  for (const r of rows) {
    const band = ARCHETYPE_BANDS[r.archetype];
    if (!band) {
      flags.push({
        id: r.id,
        metric: 'archetype',
        value: r.archetype,
        band: '-',
        message: 'no archetype',
      });
      continue;
    }
    check(r, '0-100 s', r.a100, band.a100);
    check(r, 'top km/h', r.topKmh, band.top);
    check(r, '100-0 m', r.brake100M, band.brake);
    check(r, 'skid g', r.skidG, band.skid);
    if (!r.skidFastPowerLimited) check(r, 'fast skid g', r.skidFastG, FAST_SKID[r.archetype]);
    if (band.a200) check(r, '0-200 s', r.a200, band.a200);
    if (r.shiftsLast10s > 8)
      flags.push({
        id: r.id,
        metric: 'shift hunting',
        value: r.shiftsLast10s,
        band: '<=8',
        message: `${r.shiftsLast10s} gear changes in the last 10 s of the top-speed run (gearbox hunting)`,
      });
    if (r.falls)
      flags.push({
        id: r.id,
        metric: 'falls',
        value: r.falls,
        band: '0',
        message: `${r.falls} fall(s) in the rig runs`,
      });
    if (!r.slalomOk)
      flags.push({
        id: r.id,
        metric: 'slalom',
        value: null,
        band: 'completes',
        message: 'slalom not completed',
      });
    if (r.lap) {
      if (r.lap.completed < 3 || r.lap.bestS === null)
        flags.push({
          id: r.id,
          metric: 'lap',
          value: r.lap.completed,
          band: '>=3 laps',
          message: `AI completed ${r.lap.completed} laps on Aurel`,
        });
      else if (r.lap.validLaps < 2)
        flags.push({
          id: r.id,
          metric: 'lap',
          value: r.lap.validLaps,
          band: '>=2 valid',
          message: `only ${r.lap.validLaps} valid AI lap(s) on Aurel`,
        });
      else if (r.lap.worstStuckS > 4)
        flags.push({
          id: r.id,
          metric: 'lap',
          value: r.lap.worstStuckS,
          band: '<4 s stuck',
          message: `AI stood still ${r.lap.worstStuckS} s`,
        });
    }
  }
  // Lap ordering: a machine slower than the best lap of a machine two or more pace tiers below.
  const timed = rows.filter((r) => r.lap?.bestS && r.kind !== 'dirt-bike');
  const tierOf = (r: MachineRow) => ARCHETYPE_BANDS[r.archetype]?.tier ?? 99;
  const orderFlags: Flag[] = [];
  for (const r of timed) {
    const slower = timed.filter(
      (o) => tierOf(o) >= tierOf(r) + 2 && o.kind === r.kind && o.lap!.bestS! < r.lap!.bestS!,
    );
    if (slower.length) {
      const best = slower.reduce((a, b) => (a.lap!.bestS! < b.lap!.bestS! ? a : b));
      orderFlags.push({
        id: r.id,
        metric: 'lap order',
        value: r.lap!.bestS,
        band: `tier ${tierOf(r)}`,
        message: `Aurel AI lap ${r.lap!.bestS} s (tier ${tierOf(r)}) is slower than ${best.id} (tier ${tierOf(best)}, ${best.lap!.bestS} s)`,
      });
    }
  }
  flags.push(...orderFlags);
  // Near-identical pairs within a game class (and within an archetype). Performance numbers can
  // legitimately match inside a balanced class, so a pair is only a copy-paste when the handling
  // feel matches too: understeer gradient, lift-off rotation, full-throttle rotation, snap or push.
  const pairs: PairReport[] = [];
  const key = (r: MachineRow) =>
    [
      r.a100,
      r.topKmh,
      r.brake100M,
      r.skidG,
      r.skidFastPowerLimited ? null : r.skidFastG,
      r.massKg,
      r.powerToWeightKwT,
      r.lap?.bestS ?? null,
    ] as const;
  const snap = (r: MachineRow) => (Math.abs(r.limitRelDeg) >= 25 ? 1 : 0);
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i],
        b = rows[j];
      const sameClass = a.classId === b.classId,
        sameArch = a.archetype === b.archetype;
      if (!sameClass && !sameArch) continue;
      const ka = key(a),
        kb = key(b);
      let worst = 0;
      for (let m = 0; m < ka.length; m++) {
        if (ka[m] === null || kb[m] === null) continue;
        const x = ka[m] as number,
          y = kb[m] as number;
        worst = Math.max(worst, Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-9));
      }
      let feel: number | null = null;
      if (a.understeerDegPerG !== null && b.understeerDegPerG !== null) {
        const cap = (x: number | null) => Math.max(-60, Math.min(60, x ?? 0));
        feel = Math.max(
          Math.abs(a.understeerDegPerG - b.understeerDegPerG) / 0.8,
          Math.abs((a.liftRotDeg ?? 0) - (b.liftRotDeg ?? 0)) / 3,
          Math.abs(cap(a.powerRotDeg) - cap(b.powerRotDeg)) / 15,
          Math.abs(snap(a) - snap(b)),
        );
      }
      pairs.push({
        a: a.id,
        b: b.id,
        scope: sameClass ? 'class' : 'archetype',
        maxRelDiff: +worst.toFixed(3),
        feelDistance: feel === null ? null : +feel.toFixed(2),
        verdict:
          worst >= NEAR_IDENTICAL
            ? 'distinct'
            : feel === null
              ? 'twin performance (bike feel not measured)'
              : feel < 1
                ? 'COPY-PASTE'
                : 'twin performance, distinct feel',
      });
    }
  pairs.sort((p, q) => p.maxRelDiff - q.maxRelDiff);
  return { flags, pairs };
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
function markdown(
  rows: MachineRow[],
  judged: ReturnType<typeof judge>,
  base: MachineRow[] | null,
  version: number,
) {
  const out: string[] = [];
  const f = (x: number | null | undefined, d = 1) =>
    x === null || x === undefined ? '-' : x.toFixed(d);
  const flagged = new Map<string, Set<string>>();
  for (const fl of judged.flags)
    (flagged.get(fl.id) ?? flagged.set(fl.id, new Set()).get(fl.id)!).add(fl.metric);
  const mark = (id: string, metric: string, text: string) =>
    flagged.get(id)?.has(metric) ? `**${text}!**` : text;
  out.push('# Machine benchmark');
  out.push('');
  out.push(
    `Generated by \`scripts/studio/tools/machine-benchmark.ts\` at physics v${version}. Dry day, no weather, default 'sport' assist, medium compound, default setup. Numbers only: no human has driven these machines.`,
  );
  out.push('');
  out.push(
    "Method: straight-line, braking, skidpad and slalom use the production entrant (Vehicle / BikeVehicle / DirtBikeVehicle via `createEntrant`) on the analytic runway and skidpad of `scripts/dynamics-fixtures.ts`. Skidpad = closed-loop lateral g held on a 50 m circle (speed creeps up 0.3 m/s per s; v squared over R, best 0.6 s-filtered value while within 2 m of the circle and pointing along it). Slalom = 80 km/h, then coast (no throttle, no brake) through three 60 m waves of 1 m amplitude; scrub = speed lost against a straight coast over the same distance. Lap = production `Simulation` (AI driver, race control, lap timing), solo practice, 3 laps, best valid lap, seed 90210. **Bold with !** marks a value outside the general-knowledge band for the machine's archetype (sanity bands, not licensed data). Fast skid = the same closed loop on a 150 m circle (speed creeps 0.6 m/s per s), where downforce machines show their aero grip; a `*` means the machine ran out of speed before it ran out of grip, so the figure is not judged.",
  );
  out.push('');
  const byClass = new Map<string, MachineRow[]>();
  for (const r of rows)
    (byClass.get(r.className) ?? byClass.set(r.className, []).get(r.className)!).push(r);
  const classOrder = (r: MachineRow) => classInfo(r.classId as never).order;
  const classes = [...byClass.entries()].sort((a, b) => classOrder(a[1][0]) - classOrder(b[1][0]));
  out.push(
    '| id | machine | drive | kg | kW | kW/t | 0-100 s | 0-200 s | top km/h | 100-0 m | skid g | skid km/h | fast skid g | slalom exit km/h | scrub | Aurel lap s | dirt lap s |',
  );
  out.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, list] of classes) {
    out.push(`| | **${name}** | | | | | | | | | | | | | | | |`);
    for (const r of list.sort((a, b) => (a.lap?.bestS ?? 999) - (b.lap?.bestS ?? 999))) {
      out.push(
        `| ${r.id} | ${r.name} | ${r.drivetrain} | ${r.massKg} | ${r.powerKw} | ${r.powerToWeightKwT} | ${mark(r.id, '0-100 s', f(r.a100, 2))} | ${mark(r.id, '0-200 s', f(r.a200, 1))} | ${mark(r.id, 'top km/h', String(r.topKmh))} | ${mark(r.id, '100-0 m', f(r.brake100M))} | ${mark(r.id, 'skid g', f(r.skidG, 2))} | ${r.skidKmh} | ${mark(r.id, 'fast skid g', f(r.skidFastG, 2) + (r.skidFastPowerLimited ? '*' : ''))} | ${mark(r.id, 'slalom', f(r.slalomExitKmh))} | ${f(r.slalomScrubKmh)} | ${mark(r.id, 'lap', f(r.lap?.bestS ?? null, 2))} | ${f(r.dirtLap?.bestS ?? null, 2)} |`,
      );
    }
  }
  out.push('');
  out.push('## General-knowledge sanity bands used');
  out.push('');
  out.push(
    'Rough real-world class ranges written from public, common knowledge for this review. They are NOT licensed or measured data for any vehicle (every machine here is original) and they are wide on purpose: a value outside one is a question, not a verdict. Skid g is on the 50 m circle; fast skid g on the 150 m circle, judged only for machines whose grip is mostly aerodynamic.',
  );
  out.push('');
  out.push(
    '| archetype | machines | 0-100 s | 0-200 s | top km/h | 100-0 m | skid g | fast skid g | expected pace tier |',
  );
  out.push('|---|---|---|---|---|---|---|---|---:|');
  const range = (r: Range | undefined) => (r ? `${r[0]}-${r[1]}` : '-');
  for (const [key, band] of Object.entries(ARCHETYPE_BANDS)) {
    const members = rows.filter((r) => r.archetype === key).map((r) => r.id);
    if (members.length)
      out.push(
        `| ${band.label} | ${members.join(', ')} | ${range(band.a100)} | ${range(band.a200)} | ${range(band.top)} | ${range(band.brake)} | ${range(band.skid)} | ${range(FAST_SKID[key])} | ${band.tier} |`,
      );
  }
  out.push('');
  out.push(`## Flags (${judged.flags.length})`);
  out.push('');
  out.push('| id | metric | value | band | note |');
  out.push('|---|---|---:|---|---|');
  for (const fl of judged.flags)
    out.push(`| ${fl.id} | ${fl.metric} | ${fl.value ?? '-'} | ${fl.band} | ${fl.message} |`);
  out.push('');
  out.push('## Handling feel (four-wheel machines)');
  out.push('');
  out.push(
    "Steady state on the 50 m circle at 90 % of each machine's limit speed. Understeer gradient = (road-wheel angle - Ackermann angle) per g of lateral acceleration, + understeer. Lift / full throttle = rotation in 1.5 s with the steering held (deg, + turning into the circle; about 50 or more is a spin). Limit = how the circle was lost: push (heading stays near the tangent) or snap (rotated 25 deg or more).",
  );
  out.push('');
  out.push(
    '| id | machine | understeer deg/g | lift-off deg | full-throttle deg | full-throttle drift m | limit | gear changes in last 10 s of top speed run |',
  );
  out.push('|---|---|---:|---:|---:|---:|---|---:|');
  for (const [, list] of classes)
    for (const r of list)
      if (r.understeerDegPerG !== null)
        out.push(
          `| ${r.id} | ${r.name} | ${f(r.understeerDegPerG, 2)} | ${f(r.liftRotDeg)} | ${f(r.powerRotDeg)} | ${f(r.powerDriftM, 2)} | ${Math.abs(r.limitRelDeg) >= 25 ? 'snap' : 'push'} | ${mark(r.id, 'shift hunting', String(r.shiftsLast10s))} |`,
        );
  out.push('');
  out.push(
    `## Near-identical performance in one class or archetype (largest metric difference under ${NEAR_IDENTICAL * 100} %)`,
  );
  out.push('');
  out.push(
    'Metrics compared: 0-100, top speed, 100-0, skid g, fast skid g, mass, power to weight, Aurel lap (largest relative difference of any). Feel distance: largest of understeer gradient / 0.8 deg/g, lift-off / 3 deg, full-throttle / 15 deg and push-vs-snap; under 1 means the handling feel matches too, and the pair is a COPY-PASTE.',
  );
  out.push('');
  out.push('| a | b | scope | largest difference | feel distance | verdict |');
  out.push('|---|---|---|---:|---:|---|');
  for (const p of judged.pairs.filter((p) => p.maxRelDiff < NEAR_IDENTICAL))
    out.push(
      `| ${p.a} | ${p.b} | ${p.scope} | ${(p.maxRelDiff * 100).toFixed(1)} % | ${p.feelDistance ?? 'n/a (bikes)'} | ${p.verdict} |`,
    );
  if (base) {
    out.push('');
    out.push('## Change against the baseline run');
    out.push('');
    out.push('| id | 0-100 s | top km/h | 100-0 m | skid g | fast skid g | Aurel lap s |');
    out.push('|---|---|---|---|---|---|---|');
    const was = new Map(base.map((r) => [r.id, r]));
    const diff = (a: number | null | undefined, b: number | null | undefined, d = 1) =>
      a === b ? '=' : `${f(b, d)} -> ${f(a, d)}`;
    for (const r of rows) {
      const b = was.get(r.id);
      if (!b) continue;
      const cells = [
        diff(r.a100, b.a100, 2),
        diff(r.topKmh, b.topKmh, 0),
        diff(r.brake100M, b.brake100M),
        diff(r.skidG, b.skidG, 2),
        diff(r.skidFastG, b.skidFastG, 2),
        diff(r.lap?.bestS, b.lap?.bestS, 2),
      ];
      if (cells.some((c) => c !== '=')) out.push(`| ${r.id} | ${cells.join(' | ')} |`);
    }
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
function main() {
  if (REJUDGE) {
    const recorded: { machines: MachineRow[]; physicsVersion: number } = JSON.parse(
      readFileSync(REJUDGE, 'utf8'),
    );
    writeReport(recorded.machines, true, recorded.physicsVersion);
    return;
  }
  const existing: { machines: MachineRow[] } | null = existsSync(`${OUT}.json`)
    ? JSON.parse(readFileSync(`${OUT}.json`, 'utf8'))
    : null;
  const ids = Object.keys(VEHICLES).filter((id) => !only || only.includes(id));
  const rows: MachineRow[] = [];
  for (const id of ids) {
    const def = VEHICLES[id];
    const started = performance.now();
    let row: MachineRow;
    if (lapsOnly && existing) {
      const was = existing.machines.find((m) => m.id === id);
      if (!was) throw new Error(`--laps-only needs ${id} in ${OUT}.json`);
      row = {
        ...was,
        lap: referenceLap(def, { circuit: 'aurel', mode: 'practice' }),
        dirtLap: dirtVenue(def) ? referenceLap(def, dirtVenue(def)!) : null,
      };
    } else row = measureMachine(def, !skipLaps);
    rows.push(row);
    console.log(
      `${id.padEnd(8)} 0-100 ${String(row.a100).padStart(5)}  0-200 ${String(row.a200).padStart(5)}  top ${String(row.topKmh).padStart(3)}  100-0 ${String(row.brake100M).padStart(5)}  skid ${row.skidG.toFixed(2)}@${row.skidKmh} (${row.skidEnded}) fast ${row.skidFastG.toFixed(2)}@${row.skidFastKmh}  slalom ${row.slalomExitKmh ?? '-'} (-${row.slalomScrubKmh ?? '-'}) dev ${row.slalomMaxDevM}  lap ${row.lap?.bestS ?? '-'}${row.dirtLap ? ' dirt ' + row.dirtLap.bestS : ''}  US ${row.understeerDegPerG ?? '-'} lift ${row.liftRotDeg ?? '-'} pwr ${row.powerRotDeg ?? '-'}/${row.powerDriftM ?? '-'} limit ${row.limitRelDeg} shifts ${row.shiftsLast10s}  falls ${row.falls}  ${((performance.now() - started) / 1000).toFixed(0)}s`,
    );
  }
  // --merge: the machines this run did not measure keep their recorded rows.
  const all =
    merge && existing
      ? Object.keys(VEHICLES)
          .map((id) => rows.find((r) => r.id === id) ?? existing.machines.find((m) => m.id === id)!)
          .filter(Boolean)
      : rows;
  writeReport(all, !only || merge);
}
function writeReport(recorded: MachineRow[], write: boolean, version = SIMULATION_VERSION) {
  const all = recorded.map((r) => ({ ...r, archetype: ARCHETYPE[r.id] ?? r.archetype }));
  const judged = judge(all);
  const base: MachineRow[] | null = BASELINE
    ? JSON.parse(readFileSync(BASELINE, 'utf8')).machines
    : null;
  if (write) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      `${OUT}.json`,
      JSON.stringify(
        {
          generatedBy: 'scripts/studio/tools/machine-benchmark.ts',
          physicsVersion: version,
          fixture: {
            skidpadRadiusM: SKID_RADIUS,
            slalom: SLALOM,
            lap: 'solo practice on Aurel, 3 laps, seed 90210; dirt venue for off-road machines',
            bands:
              'general-knowledge class sanity bands (ARCHETYPE_BANDS in the tool); not licensed data',
          },
          machines: all,
          flags: judged.flags,
          nearIdenticalPairs: judged.pairs.filter((p) => p.maxRelDiff < NEAR_IDENTICAL),
        },
        null,
        2,
      ) + '\n',
    );
    writeFileSync(`${OUT}.md`, markdown(all, judged, base, version));
    console.log(`wrote ${OUT}.json and ${OUT}.md (${judged.flags.length} flags)`);
  } else console.log(`${judged.flags.length} flags (partial run: nothing written)`);
}
main();
