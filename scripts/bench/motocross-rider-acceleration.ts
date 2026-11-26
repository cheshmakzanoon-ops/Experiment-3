/** Read-only assignment 35 audit. Candidates are isolated prototype overrides;
 * no production source or asset is written. Run with Node 24:
 * node --experimental-transform-types scripts/bench/motocross-rider-acceleration.ts
 * This measures CPU body commands, not rendered or perceived animation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { controls, DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { DirtBikeVehicle } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../../src/simulation/offroad/dirt-bikes.ts';
import { jumpHoldSpeed } from '../../src/simulation/offroad/jump-target.ts';
import { rideLine, rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { RiderWeight } from '../../src/simulation/offroad/rider-weight.ts';
import { offroadCourse } from '../../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../../src/simulation/vehicles.ts';
import { levelMotocrossTrack } from '../../tests/motocross-test-track.ts';

const R = 0.15,
  variants = ['current-c1', 'bounded-c2', 'narrow-c2'] as const;
type Variant = (typeof variants)[number];
const originalPose = RiderWeight.prototype.pose,
  originalRate = RiderWeight.prototype.poseRate;
const legacyPose = (a: number, p: number) => a + p * (1 - Math.sign(p) * a);

/** Integral g of a C1 derivative q in [-1/3, 1]. Its positive area and
 * negative area both equal 4/27, preserving the old maximum correction. */
function boundedProfile(u: number) {
  if (u < 1 / 3) {
    const t = 3 * u;
    return {
      g: (t - (14 / 9) * t ** 3 + (4 / 3) * t ** 4 - t ** 5 / 3) / 3,
      q: (1 - t) ** 2 * (1 + 2 * t - (5 / 3) * t * t),
    };
  }
  if (u < 5 / 9) {
    const t = (u - 1 / 3) * 4.5;
    return { g: 4 / 27 - (2 / 27) * (t ** 3 - t ** 4 / 2), q: (-t * t * (3 - 2 * t)) / 3 };
  }
  if (u < 7 / 9) return { g: 8 / 27 - u / 3, q: -1 / 3 };
  const t = (1 - u) * 4.5;
  return { g: (2 / 27) * (t ** 3 - t ** 4 / 2), q: (-t * t * (3 - 2 * t)) / 3 };
}

function candidate(variant: Variant, p: number, a: number) {
  const x = Math.abs(p),
    z = Math.sign(p) * a,
    share = 1 - z,
    u = x / R;
  if (p === 0) return { pose: a, manual: 1 - a * a, automatic: 1 };
  if (u >= 1) return { pose: legacyPose(a, p), manual: share, automatic: 1 - x };
  let { g, q } = boundedProfile(u),
    autoCorrection = (1 - 2 * z) * g;
  if (variant === 'narrow-c2') {
    // Preserve the old interior except |p| < .0075 and |p| > .125.
    // k=2, D=.05 was the smallest peak increase in the initial 25-case screen.
    const D = 0.05,
      E = 1 / 6,
      k = 2,
      v = 1 - u;
    let g0 = u * v * v,
      q0 = v * (1 - 3 * u);
    if (v < E) {
      g0 -= v * v * (1 - v / E) ** 3;
      q0 += v * (1 - v / E) ** 2 * (2 - (5 * v) / E);
    }
    const w = u < D ? u * u * (1 - u / D) ** 3 : 0,
      dw = u < D ? u * (1 - u / D) ** 2 * (2 - (5 * u) / D) : 0,
      K = z + k * a * a * (1 + z);
    g = g0 - 2 * K * w;
    q = q0 - 2 * K * dw;
    autoCorrection = (1 - 2 * z) * g0 + (-4 * z + 6 * (1 - k) * a * a + 10 * k * a ** 4) * w;
  }
  return {
    pose: legacyPose(a, p) + a * share * R * g,
    manual: share * (1 + z * q),
    automatic: 1 - x + R * autoCorrection,
  };
}

function withVariant<T>(variant: Variant, run: () => T): T {
  if (variant !== 'current-c1') {
    RiderWeight.prototype.pose = function (a) {
      return candidate(variant, this.position, a).pose;
    };
    RiderWeight.prototype.poseRate = function (a, da = 0) {
      const slopes = candidate(variant, this.position, a);
      return slopes.manual * this.velocity + slopes.automatic * da;
    };
  }
  try {
    return run();
  } finally {
    RiderWeight.prototype.pose = originalPose;
    RiderWeight.prototype.poseRate = originalRate;
  }
}

function localAudit() {
  const stroke = new RiderWeight();
  let minSlope = Infinity,
    maxSlope = -Infinity,
    minAutomaticSlope = Infinity,
    maxCorrection = 0,
    maxMixedDerivativeError = 0;
  for (let ai = -100; ai <= 100; ai++) {
    const a = ai / 100;
    let previous = -1;
    for (let pi = -600; pi <= 600; pi++) {
      const p = pi / 600;
      stroke.position = p;
      stroke.velocity = 1;
      stroke.displacement = 0.0123;
      const pose = stroke.pose(a),
        slope = stroke.poseRate(a);
      stroke.velocity = 0;
      const automaticSlope = stroke.poseRate(a, 1);
      assert(pose >= -1 - 1e-14 && pose <= 1 + 1e-14 && pose >= previous - 1e-14);
      assert(slope >= -1e-14 && slope <= 8 / 3 + 1e-14 && automaticSlope >= -1e-14);
      assert.equal(stroke.position, p);
      assert.equal(stroke.velocity, 0);
      assert.equal(stroke.displacement, 0.0123);
      if (Math.abs(p) >= R || p === 0 || a === 0) assert.equal(pose, legacyPose(a, p));
      minSlope = Math.min(minSlope, slope);
      maxSlope = Math.max(maxSlope, slope);
      minAutomaticSlope = Math.min(minAutomaticSlope, automaticSlope);
      maxCorrection = Math.max(maxCorrection, Math.abs(pose - legacyPose(a, p)));
      previous = pose;
    }
  }
  assert(Math.abs(maxCorrection - (8 * R) / 27) < 1e-12);
  for (const a of [-0.95, -0.55, 0, 0.45, 0.95])
    for (const p of [
      -0.8,
      -R,
      -0.125,
      -7 / 60,
      -1 / 12,
      -0.05,
      -0.0075,
      -1e-4,
      0,
      1e-4,
      0.0075,
      0.05,
      1 / 12,
      7 / 60,
      0.125,
      R,
      0.8,
    ])
      for (const velocity of [-4, 0, 3])
        for (const da of [-1.4, 0, 1.4]) {
          const dt = 1e-7;
          stroke.position = p - velocity * dt;
          const before = stroke.pose(a - da * dt);
          stroke.position = p + velocity * dt;
          const after = stroke.pose(a + da * dt);
          stroke.position = p;
          stroke.velocity = velocity;
          maxMixedDerivativeError = Math.max(
            maxMixedDerivativeError,
            Math.abs(stroke.poseRate(a, da) - (after - before) / (2 * dt)),
          );
        }
  assert(maxMixedDerivativeError < 5e-5);
  const secondDerivativeJoins = [0, 0.0075, R / 3, (R * 5) / 9, (R * 7) / 9, 0.125, R]
    .flatMap((p) => (p === 0 ? [0] : [-p, p]))
    .map((p) => {
      stroke.velocity = 1;
      const samples = [1e-5, 1e-7, 1e-9].map((h) => {
        stroke.position = p - h;
        const left = stroke.poseRate(-0.55);
        stroke.position = p;
        const centre = stroke.poseRate(-0.55);
        stroke.position = p + h;
        const right = stroke.poseRate(-0.55);
        return {
          h,
          left: (centre - left) / h,
          right: (right - centre) / h,
          gap: Math.abs((right - 2 * centre + left) / h),
        };
      });
      return { p, samples };
    });
  return {
    minSlope,
    maxSlope,
    minAutomaticSlope,
    maxCorrection,
    maxMixedDerivativeError,
    secondDerivativeJoins,
  };
}

function brakeReversal(definition: VehicleDefinition, hz: number, direction: number) {
  const dt = 1 / hz,
    track = levelMotocrossTrack(),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    stroke = new RiderWeight();
  bike.place(track, 35);
  bike.input.brake = 1;
  bike.input.riderLean = direction;
  for (let n = 0; n < 5 * hz; n++) {
    bike.step(dt, track);
    stroke.step(direction, dt);
  }
  bike.input.riderLean = -direction;
  const trace = [];
  for (let n = 0; n < Math.round(0.6 * hz); n++) {
    bike.step(dt, track);
    stroke.step(-direction, dt);
    const a = bike.postureMotion!.automaticBody;
    assert(Math.abs(a + 0.55) < 1e-12);
    assert(bike.riding && !bike.airborne);
    assert.equal(bike.speed, 0);
    assert.equal(bike.riderBody, stroke.pose(a));
    assert.equal(bike.riderBodyRate, stroke.poseRate(a, bike.postureMotion!.bodyRate));
    trace.push({
      p: stroke.position,
      v: stroke.velocity,
      displacement: stroke.displacement,
      pose: bike.riderBody,
      rate: bike.riderBodyRate,
      legacy: legacyPose(a, stroke.position),
    });
  }
  assert.equal(bike.dynamics.crashes, 0);
  const k = trace.findIndex((row, i) => i > 0 && row.p * trace[i - 1].p <= 0);
  assert(k > 1 && k < trace.length - 1);
  const maxPoseCorrection = Math.max(...trace.map((row) => Math.abs(row.pose - row.legacy)));
  assert(maxPoseCorrection < 0.019);
  return {
    bike: definition.id,
    hz,
    direction,
    maxPoseCorrection,
    crossingAccelerationGap: Math.abs(
      (trace[k + 1].rate - trace[k].rate - trace[k - 1].rate + trace[k - 2].rate) / dt,
    ),
    peakSampledAcceleration: Math.max(
      ...trace.slice(1).map((row, i) => Math.abs((row.rate - trace[i].rate) / dt)),
    ),
    strokeHash: createHash('sha256')
      .update(JSON.stringify(trace.map(({ p, v, displacement }) => [p, v, displacement])))
      .digest('hex'),
  };
}

function airborneReversal(definition: VehicleDefinition) {
  const dt = 1 / 240,
    track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((item) => item.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let gear = 1; gear < definition.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm =
      ((speed / definition.spec.wheelRadius) *
        definition.spec.gearRatios[gear + 1] *
        definition.spec.finalDrive *
        30) /
      Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  let launched = false;
  for (let n = 0; n < 6 / dt; n++) {
    if (!bike.airborne)
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      launched = true;
      break;
    }
  }
  assert(launched);
  bike.aiControlled(0);
  Object.assign(bike.input, controls(), { throttle: 0.1, brake: 0.35, clutch: 0.05 });
  const physics = [],
    poses = [];
  for (let n = 0; n < 0.8 / dt; n++) {
    bike.input.riderLean = n < 60 ? 1 : n < 144 ? -1 : 0;
    bike.step(dt, track);
    assert(bike.airborne && bike.riding);
    assert.equal(bike.forceFront + bike.forceRear, 0);
    physics.push([
      bike.s,
      bike.dynamics.x,
      bike.dynamics.z,
      bike.cgY,
      bike.vy,
      bike.pitch,
      bike.pitchRate,
      bike.frontSpin,
      bike.rearSpin,
    ]);
    poses.push(bike.riderBody);
  }
  return {
    bike: definition.id,
    samples: physics.length,
    physicsHash: createHash('sha256').update(JSON.stringify(physics)).digest('hex'),
    poses,
  };
}

const sources = Object.fromEntries(
  [
    'src/simulation/offroad/rider-weight.ts',
    'src/simulation/offroad/dirt-bike-vehicle.ts',
    'src/simulation/offroad/mx-ground-physics.ts',
    'tests/motocross-rider-blending.test.ts',
    'scripts/bench/motocross-rider-acceleration.ts',
  ].map((path) => [
    path,
    createHash('sha256')
      .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
      .digest('hex'),
  ]),
);
const results = variants.map((variant) =>
  withVariant(variant, () => ({
    variant,
    local: localAudit(),
    reversals: [MX_250, MX_450].flatMap((definition) =>
      [120, 240, 480].flatMap((hz) =>
        [-1, 1].map((direction) => brakeReversal(definition, hz, direction)),
      ),
    ),
    flight: [MX_250, MX_450].map(airborneReversal),
  })),
);
for (const result of results.slice(1)) {
  for (const join of result.local.secondDerivativeJoins) assert(join.samples.at(-1)!.gap < 1e-4);
  for (const [i, reversal] of result.reversals.entries())
    assert.equal(reversal.strokeHash, results[0].reversals[i].strokeHash);
  for (const [i, flight] of result.flight.entries())
    assert.equal(flight.physicsHash, results[0].flight[i].physicsHash);
}
const output = results.map((result) => ({
  ...result,
  flight: result.flight.map(({ poses, ...flight }, i) => ({
    ...flight,
    maximumPoseDifferenceFromCurrent: Math.max(
      ...poses.map((pose, j) => Math.abs(pose - results[0].flight[i].poses[j])),
    ),
  })),
}));
process.stdout.write(
  JSON.stringify(
    {
      scope: 'CPU body commands; no rendered/perceptual claim; no production changes',
      sources,
      results: output,
    },
    null,
    2,
  ) + '\n',
);
