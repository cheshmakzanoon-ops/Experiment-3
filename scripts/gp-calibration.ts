// MotoGP prototype calibration (W4, docs/motogp-physics-model.md). The
// production BikeVehicle adapter, its Bike core and the MotoGP chassis run
// unchanged; only the rider's inputs are scripted, on the analytic runway of
// the vehicle laboratory. Tyres start at their operating temperature (the
// published figures are mid-race data), rider aids are the default 'sport'
// set the AI also rides with. Every number is deterministic at a fixed step.
//
//   node --experimental-transform-types scripts/gp-calibration.ts [--lap] [--json]
//
// --lap adds an AI flying-lap measurement at Poggio Alto (slower, ~1 min).
import { clamp, G } from '../src/core/math.ts';
import { chassisLean } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { COMPOUNDS, DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DynamicsTrack } from './dynamics-fixtures.ts';

const DEG = 180 / Math.PI;

function rider(def: VehicleDefinition, track: DynamicsTrack) {
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  bike.place(track, 0);
  for (const t of bike.tires) {
    const ideal = COMPOUNDS[t.compound].ideal;
    t.carcassTemp = t.surfaceTemp = ideal;
  }
  return bike;
}

/** Standing start at full throttle: launch, wheelie-limited first gears, top speed. */
export function gpAcceleration(def: VehicleDefinition, dt = 1 / 120) {
  const track = new DynamicsTrack();
  const bike = rider(def, track);
  bike.input.throttle = 1;
  let to100: number | null = null,
    to200: number | null = null,
    to300: number | null = null,
    peak = 0,
    sinceGain = 0,
    peakPitch = 0,
    peakShock = 0,
    minFork = Infinity,
    peakG = 0,
    t = 0;
  for (; t < 90 && sinceGain < 4; t += dt) {
    bike.step(dt, track);
    const kmh = bike.speed * 3.6;
    if (to100 === null && kmh >= 100) to100 = t + dt;
    if (to200 === null && kmh >= 200) to200 = t + dt;
    if (to300 === null && kmh >= 300) to300 = t + dt;
    if (kmh < 150) {
      peakPitch = Math.max(peakPitch, bike.dynamics.pitch);
      peakShock = Math.max(peakShock, bike.shock);
      minFork = Math.min(minFork, bike.fork);
      peakG = Math.max(peakG, bike.dynamics.longitudinal / G);
    }
    if (bike.speed > peak + 0.01) {
      peak = bike.speed;
      sinceGain = 0;
    } else sinceGain += dt;
  }
  return {
    to100s: to100,
    to200s: to200,
    to300s: to300,
    topSpeedKmh: peak * 3.6,
    launchPeakG: peakG,
    wheeliePitchDeg: peakPitch * DEG,
    launchShockTravel: peakShock / bike.bikeSpec.shockTravel,
    launchForkTravel: minFork / bike.bikeSpec.forkTravel,
    crashes: bike.dynamics.crashes,
  };
}

/** Straight-line stop from `fromKmh` with both levers, to `toKmh`. */
export function gpBraking(def: VehicleDefinition, fromKmh: number, toKmh: number, dt = 1 / 120) {
  const track = new DynamicsTrack();
  const bike = rider(def, track);
  bike.input.throttle = 1;
  for (let t = 0; t < 60 && bike.speed * 3.6 < fromKmh; t += dt) bike.step(dt, track);
  const start = bike.dynamics.z,
    entry = bike.speed * 3.6;
  bike.input.throttle = 0;
  bike.input.brake = 1;
  bike.input.clutch = 0.25;
  let peakG = 0,
    previous = bike.speed,
    t = 0,
    peakFork = 0,
    minRear = Infinity,
    minPitch = 0,
    window = 0;
  for (; t < 20 && bike.speed * 3.6 > toKmh; t += dt) {
    bike.step(dt, track);
    // 50 ms finite differences: the published peak is a filtered logger value.
    if (++window === Math.round(0.05 / dt)) {
      peakG = Math.max(peakG, (previous - bike.speed) / (window * dt) / G);
      previous = bike.speed;
      window = 0;
    }
    peakFork = Math.max(peakFork, bike.fork);
    minRear = Math.min(minRear, bike.dynamics.rearLoad);
    minPitch = Math.min(minPitch, bike.dynamics.pitch);
  }
  const lost = (entry - toKmh) / 3.6;
  return {
    entryKmh: entry,
    distanceM: bike.dynamics.z - start,
    timeS: t,
    meanG: lost / Math.max(t, 1e-6) / G,
    peakG,
    peakForkTravel: peakFork / bike.bikeSpec.forkTravel,
    minRearLoadN: minRear,
    stoppiePitchDeg: minPitch * DEG,
    crashes: bike.dynamics.crashes,
  };
}

function cruise(bike: BikeVehicle, track: DynamicsTrack, speed: number, dt: number) {
  bike.input.throttle = clamp((speed - bike.speed) * 0.6 + 0.25, 0, 1);
  bike.input.brake = bike.speed > speed + 1.5 ? clamp((bike.speed - speed) * 0.1, 0, 0.4) : 0;
  bike.step(dt, track);
}

function rollingAt(def: VehicleDefinition, track: DynamicsTrack, kmh: number, dt: number) {
  const bike = rider(def, track);
  bike.input.throttle = 1;
  for (let t = 0; t < 40 && bike.speed * 3.6 < kmh; t += dt) bike.step(dt, track);
  return bike;
}

/** Full stick at constant speed: the steady lean and lateral acceleration
 * the assisted rider holds, with hang-off. */
export function gpCornering(def: VehicleDefinition, kmh: number, dt = 1 / 120) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const bike = rollingAt(def, track, kmh, dt);
  let lean = 0,
    lateral = 0,
    offset = 0,
    peakLean = 0,
    samples = 0;
  for (let t = 0; t < 8 && bike.riding; t += dt) {
    bike.input.steer = clamp(t / 0.6, 0, 1);
    cruise(bike, track, speed, dt);
    peakLean = Math.max(peakLean, Math.abs(bike.dynamics.lean));
    if (t > 5) {
      lean += Math.abs(bike.dynamics.lean);
      lateral += Math.abs(bike.gLat);
      offset += Math.abs(bike.dynamics.riderOffset);
      samples++;
    }
  }
  const n = Math.max(1, samples),
    dynamic = lean / n;
  return {
    speedKmh: bike.speed * 3.6,
    contactLeanDeg: dynamic * DEG,
    chassisLeanDeg: chassisLean(dynamic, bike.bikeSpec) * DEG,
    overshootDeg: (peakLean - dynamic) * DEG,
    lateralG: lateral / n,
    riderOffsetM: offset / n,
    crashes: bike.dynamics.crashes,
  };
}

/** Full-lean left to full-lean right at constant speed (a chicane flick). */
export function gpFlick(def: VehicleDefinition, kmh: number, dt = 1 / 120) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const bike = rollingAt(def, track, kmh, dt);
  for (let t = 0; t < 4 && bike.riding; t += dt) {
    bike.input.steer = clamp(t / 0.4, 0, 1);
    cruise(bike, track, speed, dt);
  }
  const held = bike.dynamics.lean;
  let peakRate = 0,
    crossing: number | null = null,
    reached: number | null = null,
    peakSteer = 0;
  for (let t = 0; t < 4 && bike.riding; t += dt) {
    bike.input.steer = -1;
    cruise(bike, track, speed, dt);
    const d = bike.dynamics;
    peakRate = Math.max(peakRate, Math.abs(d.leanRate));
    peakSteer = Math.max(peakSteer, Math.abs(d.steer));
    if (crossing === null && d.lean < 0) crossing = t + dt;
    if (reached === null && d.lean < -0.9 * held) reached = t + dt;
  }
  return {
    heldLeanDeg: held * DEG,
    peakRollRateDegS: peakRate * DEG,
    uprightS: crossing,
    flickS: reached,
    peakSteerDeg: peakSteer * DEG,
    crashes: bike.dynamics.crashes,
  };
}

/** AI flying laps at Poggio Alto (5.245 km), practice, dry. */
export function gpLap(vehicle = 'gpr1', laps = 3, dt = 1 / 120) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    circuit: 'poggio-alto',
    ruleset: 'gp-motorcycle',
    opponents: 0,
    vehicles: [vehicle],
    seed: 5245,
  });
  sim.autoPlayer = true;
  const bike = sim.cars[0] as BikeVehicle;
  let peakLean = 0,
    peakKmh = 0;
  for (let i = 0; i < (laps * 140) / dt && sim.race.laps[0].completed < laps; i++) {
    sim.step(dt);
    peakLean = Math.max(peakLean, Math.abs(bike.dynamics.lean));
    peakKmh = Math.max(peakKmh, bike.speed * 3.6);
  }
  const lap = sim.race.laps[0];
  return {
    completed: lap.completed,
    bestS: lap.best,
    peakKmh,
    peakChassisLeanDeg: chassisLean(peakLean, bike.bikeSpec) * DEG,
    crashes: bike.dynamics.crashes,
  };
}

export function measureGP(def: VehicleDefinition, dt = 1 / 120) {
  return {
    acceleration: gpAcceleration(def, dt),
    braking330to100: gpBraking(def, 330, 100, dt),
    braking100to0: gpBraking(def, 100, 1, dt),
    cornering100: gpCornering(def, 100, dt),
    cornering160: gpCornering(def, 160, dt),
    flick100: gpFlick(def, 100, dt),
    flick200: gpFlick(def, 200, dt),
  };
}

if (process.argv[1]?.endsWith('gp-calibration.ts')) {
  const json = process.argv.includes('--json');
  const out: Record<string, unknown> = {};
  for (const id of ['gpr1', 'gpr2']) {
    const result: Record<string, unknown> = measureGP(VEHICLES[id]);
    if (process.argv.includes('--lap')) result.lap = gpLap(id);
    out[id] = result;
    if (!json) {
      console.log(`== ${id}`);
      for (const [k, v] of Object.entries(result))
        console.log(
          `  ${k}: ${Object.entries(v as Record<string, number | null>)
            .map(([a, b]) => `${a}=${typeof b === 'number' ? +b.toFixed(3) : b}`)
            .join(' ')}`,
        );
    }
  }
  if (json) console.log(JSON.stringify(out, null, 2));
}
