/** Reproduce the physics-v17 wet-rubber braking diagnostic.
 * Usage: node --experimental-transform-types scripts/physics-v17-grip-probe.ts
 *
 * A 250 kg longitudinal sled uses the production tyre/wheel solver with a
 * constant normal load and brake torque. It starts at pure rolling and stops
 * the measurement at the first step at or below 5 km/h. Tyre heat and wear
 * evolve normally; local water and rubber coverage stay fixed. There is no
 * vehicle aero, suspension, steering, load transfer or driver assistance.
 * These are deterministic model regressions, not measured full-car braking
 * calibration or a claim of iRacing-equivalent accuracy. JSON goes to stdout.
 */
import assert from 'node:assert/strict';
import { G } from '../src/core/math.ts';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';

const MASS_KG = 250,
  BRAKE_TORQUE_NM = 4000,
  START_KPH = 100,
  END_KPH = 5;

function brake(hz: number, waterMm: number, rubber: number) {
  const tire = makeTire('medium'),
    road = surfaceSample(),
    dt = 1 / hz;
  road.water = waterMm;
  road.rubber = rubber;
  let speed = START_KPH / 3.6,
    distanceM = 0,
    maximumUsage = 0,
    steps = 0;
  tire.omega = speed / tire.radius;
  for (; steps < 20 * hz && speed > END_KPH / 3.6; steps++) {
    const before = speed;
    solveTire(tire, speed, 0, MASS_KG * G, 0, BRAKE_TORQUE_NM, road, 0, dt);
    speed = Math.max(0, speed + ((tire.fx - tire.groundDrag) / MASS_KG) * dt);
    distanceM += 0.5 * (before + speed) * dt;
    maximumUsage = Math.max(maximumUsage, tire.usage);
  }
  assert(Number.isFinite(distanceM + speed + maximumUsage), 'Non-finite sled state');
  assert(speed <= END_KPH / 3.6, 'Sled did not reach the measurement cutoff in 20 seconds');
  assert(maximumUsage <= 1 + 1e-12, 'Tyre force exceeded its friction envelope');
  return { hz, waterMm, rubber, distanceM, finalSpeedKph: speed * 3.6, seconds: steps / hz };
}

const runs = [240, 480].flatMap((hz) => [
  brake(hz, 0, 0),
  brake(hz, 0, 1),
  brake(hz, 0.6, 0),
  brake(hz, 0.6, 1),
]);
const comparisons = [0, 4].map((offset) => {
  const [dryClean, dryRubber, wetClean, wetRubber] = runs.slice(offset, offset + 4);
  assert(dryRubber.distanceM < dryClean.distanceM * 0.98, 'Dry rubber did not improve braking');
  assert(wetRubber.distanceM > wetClean.distanceM * 1.05, 'Wet rubber did not reduce braking grip');
  assert(wetClean.distanceM > dryClean.distanceM, 'Water did not reduce braking grip');
  return {
    hz: dryClean.hz,
    dryRubberDistanceChangePercent: 100 * (dryRubber.distanceM / dryClean.distanceM - 1),
    wetRubberDistanceChangePercent: 100 * (wetRubber.distanceM / wetClean.distanceM - 1),
  };
});
const maximumTimestepDifferencePercent =
  100 *
  Math.max(
    ...runs
      .slice(0, 4)
      .map((run, i) => Math.abs(run.distanceM - runs[i + 4].distanceM) / runs[i + 4].distanceM),
  );
assert(
  maximumTimestepDifferencePercent < 0.5,
  '240/480 Hz braking distance differed by 0.5% or more',
);
console.log(
  JSON.stringify(
    {
      diagnostic: 'Production-tyre 250 kg sled; not full-car or real-world calibration',
      conditions: {
        massKg: MASS_KG,
        normalLoadN: MASS_KG * G,
        brakeTorqueNm: BRAKE_TORQUE_NM,
        startSpeedKph: START_KPH,
        cutoffSpeedKph: END_KPH,
        tire: 'makeTire(medium) defaults; initially pure rolling',
        surface: 'surfaceSample() asphalt defaults; fixed water and rubber per run',
        distanceIntegration: 'trapezoidal integration through the cutoff step',
      },
      runs,
      comparisons,
      maximumTimestepDifferencePercent,
      assertionsPassed: true,
    },
    null,
    2,
  ),
);
