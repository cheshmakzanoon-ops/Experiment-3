import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clamp, G, Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP, VEHICLE } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { DynamicsTrack, type RigKind } from './dynamics-fixtures.ts';

const DT = 1 / 240;
const hash = createHash('sha256');
function fingerprint(path: string) {
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) fingerprint(name);
    else {
      hash.update(name);
      hash.update(readFileSync(name));
    }
  }
}
fingerprint('src');
const sourceSHA256 = hash.digest('hex');
const cases: { name: string; passed: boolean; measurements: unknown; failure?: string }[] = [];
function check(name: string, run: () => unknown) {
  try {
    cases.push({ name, passed: true, measurements: run() });
  } catch (error) {
    cases.push({ name, passed: false, measurements: null, failure: String(error) });
  }
  console.log(JSON.stringify(cases[cases.length - 1]));
}
function prepared(track: DynamicsTrack, speed: number, wet = false) {
  const car = new Vehicle(0, wet ? 'wet' : 'medium', DEFAULT_SETUP, 'raw');
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(DT, track);
  car.input.brake = 0;
  // Specified initial condition only. No pose/velocity writes during a run.
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
function finite(car: Vehicle) {
  assert(car.body.position.finite() && car.body.velocity.finite(), 'non-finite chassis');
  assert(
    Math.abs(
      Math.hypot(
        car.body.orientation.x,
        car.body.orientation.y,
        car.body.orientation.z,
        car.body.orientation.w,
      ) - 1,
    ) < 1e-8,
    'quaternion drift',
  );
  assert(
    car.tires.every((t) => Number.isFinite(t.load + t.omega + t.surfaceTemp) && t.load >= 0),
    'invalid contact',
  );
}
const stops: number[] = [];
for (const speedKmh of [100, 200, 300])
  check(`braking-${speedKmh}kmh`, () => {
    const track = new DynamicsTrack(),
      car = prepared(track, speedKmh / 3.6);
    const start = car.body.position.z;
    car.input.brake = 1;
    let ticks = 0,
      peakLoadN = 0,
      minimumSlip = 0;
    for (; ticks < 240 * 15 && car.speed > 0.2; ticks++) {
      car.step(DT, track);
      finite(car);
      for (const t of car.tires) {
        peakLoadN = Math.max(peakLoadN, t.load);
        minimumSlip = Math.min(minimumSlip, t.slip);
      }
    }
    const distanceM = car.body.position.z - start;
    const data = {
      distanceM,
      stopSeconds: ticks * DT,
      lateralDriftM: car.body.position.x,
      minimumSlip,
      peakLoadN,
      discTemperaturesC: car.tires.map((t) => t.discTemp),
    };
    stops.push(distanceM);
    assert(car.speed <= 0.2, JSON.stringify(data));
    assert(distanceM > 5 && distanceM < 600, JSON.stringify(data));
    assert(Math.abs(car.body.position.x) < 2, JSON.stringify(data));
    return data;
  });
check('braking-speed-order', () => {
  assert(stops.length === 3 && stops[0] < stops[1] && stops[1] < stops[2]);
  return stops;
});
for (const speed of [15, 25, 35])
  check(`skidpad-${speed}mps`, () => {
    const track = new DynamicsTrack('skidpad'),
      car = prepared(track, speed);
    const target = trackPoint(),
      point = new Vec3(),
      local = new Vec3();
    let errorSquared = 0,
      speedTotal = 0,
      lateralG = 0,
      expectedG = 0,
      samples = 0;
    for (let i = 0; i < 240 * 30; i++) {
      const lookahead = 8 + car.speed * 0.3;
      track.at(car.s + lookahead, target);
      point.set(target.x - car.body.position.x, 0, target.z - car.body.position.z);
      car.body.orientation.inverseRotate(point, local);
      car.input.steer = clamp(
        Math.atan2(2 * VEHICLE.wheelbase * local.x, local.x ** 2 + local.z ** 2) / VEHICLE.maxSteer,
        -1,
        1,
      );
      car.input.throttle = clamp((speed - car.speed) * 0.4 + 0.12, 0, 1);
      car.input.brake = clamp((car.speed - speed) * 0.2, 0, 1);
      car.step(DT, track);
      finite(car);
      if (i > 240 * 20) {
        const radius = Math.hypot(car.body.position.x - track.radius, car.body.position.z);
        errorSquared += (radius - track.radius) ** 2;
        speedTotal += car.speed;
        lateralG += Math.abs(car.gLat);
        expectedG += car.speed ** 2 / radius / G;
        samples++;
      }
    }
    const data = {
      commandedSpeedMps: speed,
      meanSpeedMps: speedTotal / samples,
      radialRmsErrorM: Math.sqrt(errorSquared / samples),
      measuredLateralG: lateralG / samples,
      kinematicLateralG: expectedG / samples,
    };
    assert(
      data.radialRmsErrorM < 5 && Math.abs(data.meanSpeedMps - speed) < 2,
      JSON.stringify(data),
    );
    assert(Math.abs(data.measuredLateralG - data.kinematicLateralG) < 0.2, JSON.stringify(data));
    return data;
  });
check('slalom-repeated-steering', () => {
  const track = new DynamicsTrack(),
    car = prepared(track, 22);
  const peaks = new Float64Array(6);
  let finalYaw = 0;
  for (let i = 0; i < 240 * 30; i++) {
    const time = i * DT;
    car.input.steer = time < 24 ? Math.sin((time * Math.PI) / 2) * 0.085 : 0;
    car.input.throttle = clamp((22 - car.speed) * 0.4 + 0.12, 0, 1);
    car.input.brake = clamp((car.speed - 22) * 0.2, 0, 1);
    car.step(DT, track);
    finite(car);
    if (time < 24)
      peaks[Math.floor(time / 4)] = Math.max(
        peaks[Math.floor(time / 4)],
        Math.abs(car.body.omega.y),
      );
    else if (time > 29) finalYaw = Math.max(finalYaw, Math.abs(car.body.omega.y));
  }
  const data = { cyclePeakYawRadps: [...peaks], recoveredYawRadps: finalYaw };
  assert(peaks[5] < peaks[0] * 1.5 && peaks[5] > 0.05, JSON.stringify(data));
  assert(finalYaw < 0.02, JSON.stringify(data));
  return data;
});
for (const kind of ['low-kerb', 'high-kerb', 'sausage-kerb'] as RigKind[])
  check(kind, () => {
    const track = new DynamicsTrack(kind),
      car = prepared(track, 15);
    let peakCompressionM = 0,
      peakLoadN = 0,
      peakVerticalG = 0,
      skidWorkJ = 0;
    for (let i = 0; i < 240 * 4; i++) {
      car.step(DT, track);
      finite(car);
      peakVerticalG = Math.max(peakVerticalG, Math.abs(car.gVert));
      skidWorkJ += car.bottomEnergy * DT;
      for (const tire of car.tires) {
        peakCompressionM = Math.max(peakCompressionM, tire.compression);
        peakLoadN = Math.max(peakLoadN, tire.load);
      }
    }
    const data = {
      peakCompressionM,
      peakLoadN,
      peakVerticalG,
      skidWorkJ,
      finalHeightM: car.body.position.y,
    };
    assert(
      car.body.position.z > 20 && car.body.position.y > 0.4 && car.body.position.y < 1,
      JSON.stringify(data),
    );
    assert(peakVerticalG < 15 && peakLoadN > (car.body.mass * G) / 4, JSON.stringify(data));
    return data;
  });
const report = {
  sourceSHA256,
  fixedDtSeconds: DT,
  fixture: 'Isolated analytic runway/skidpad/kerbs with the production Vehicle solver',
  passed: cases.every((c) => c.passed),
  cases,
};
writeFileSync('docs/dynamics-benchmark.json', JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
