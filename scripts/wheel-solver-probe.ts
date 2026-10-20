/** Reproducible numerical probe for the production wheel solve.
 *
 * node --experimental-transform-types scripts/wheel-solver-probe.ts
 * An optional absolute path to a historical tire module adds an alternating
 * warmed timing comparison. That module's relative imports must be resolved
 * against its original source tree. Timings describe isolated tyre work,
 * not full-game frame rates or measured real-car accuracy. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';

type Solver = Pick<typeof current, 'makeTire' | 'solveTire'>;

function seededProbe(solver: Solver) {
  let seed = 123456789;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  let maxResidualNm = 0,
    maxRootWorkMismatchJ = 0,
    maxWholeWheelWorkMismatchJ = 0;
  for (const inertia of [0.06, 1.35, 5]) {
    const tire = solver.makeTire('medium', 155, inertia === 0.06 ? 0.137 : 0.335, inertia),
      road = surfaceSample();
    for (let i = 0; i < 4000; i++) {
      const oldOmega = tire.omega,
        before = 0.5 * inertia * oldOmega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
        dt = [1 / 960, 1 / 240, 1 / 60][i % 3],
        drive = (random() - 0.5) * 6000,
        brake = random() * 4000,
        speed = (random() - 0.5) * 140,
        sideways = (random() - 0.5) * 20,
        load = random() * 10000;
      road.grip = 0.1 + 0.9 * random();
      solver.solveTire(tire, speed, sideways, load, drive, brake, road, 0, dt);
      const residual =
          (inertia * (tire.omega - oldOmega)) / dt -
          drive +
          tire.fx * tire.radius -
          tire.rollingTorque +
          brake * Math.sign(tire.omega),
        error = tire.omega === 0 ? Math.max(0, Math.abs(residual) - brake) : Math.abs(residual),
        after = 0.5 * inertia * tire.omega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
        boundaryWork = (tire.fx * speed + tire.fy * sideways) * dt,
        physicalHeat =
          (tire.energy +
            tire.longitudinalRelaxationHeat +
            tire.lateralRelaxationHeat +
            tire.rollingDissipation) *
          dt,
        numericalLoss =
          (tire.longitudinalNumericalDissipation + tire.lateralNumericalDissipation) * dt +
          0.5 * inertia * (tire.omega - oldOmega) ** 2,
        balance =
          before +
          drive * tire.omega * dt -
          after -
          boundaryWork -
          brake * Math.abs(tire.omega) * dt -
          physicalHeat -
          numericalLoss;
      maxResidualNm = Math.max(maxResidualNm, error);
      maxRootWorkMismatchJ = Math.max(maxRootWorkMismatchJ, error * Math.abs(tire.omega) * dt);
      maxWholeWheelWorkMismatchJ = Math.max(maxWholeWheelWorkMismatchJ, Math.abs(balance));
    }
  }
  return { updates: 12000, maxResidualNm, maxRootWorkMismatchJ, maxWholeWheelWorkMismatchJ };
}

function gridProbe(solver: Solver) {
  const tires = Array.from({ length: 80 }, () => solver.makeTire('medium')),
    road = surfaceSample();
  for (let step = 0; step < 480; step++)
    for (let car = 0; car < 20; car++)
      for (let wheel = 0; wheel < 4; wheel++) {
        const phase = step / 480,
          speed = 25 + 15 * Math.sin(phase * 3 + car * 0.1),
          drive = wheel >= 2 && phase < 0.6 ? 300 : 0,
          brake = phase > 0.6 ? 1200 : 0;
        solver.solveTire(
          tires[car * 4 + wheel],
          speed,
          1.2 * Math.sin(phase * 7 + car * 0.2),
          2200 + wheel * 300,
          drive,
          brake,
          road,
          0,
          1 / 240,
        );
      }
}

function compareTiming(baseline: Solver, run: (solver: Solver) => unknown) {
  for (let i = 0; i < 3; i++) {
    run(baseline);
    run(current);
  }
  const times = [[], []] as [number[], number[]],
    versions = [baseline, current];
  for (let sample = 0; sample < 9; sample++)
    for (const variant of sample % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      run(versions[variant]);
      times[variant].push(performance.now() - start);
    }
  const median = (samples: number[]) => samples.sort((a, b) => a - b)[4];
  return { beforeMedianMs: median(times[0]), afterMedianMs: median(times[1]) };
}

const result = seededProbe(current),
  baselinePath = process.argv[2];
if (result.maxResidualNm > 1e-6 || result.maxWholeWheelWorkMismatchJ > 2e-5)
  throw new Error(`Wheel solver accuracy regression: ${JSON.stringify(result)}`);
if (baselinePath) {
  const baseline = (await import(pathToFileURL(resolve(baselinePath)).href)) as Solver;
  console.log(
    JSON.stringify(
      {
        current: result,
        baseline: seededProbe(baseline),
        timing: {
          seeded12000: compareTiming(baseline, seededProbe),
          twentyCarGrid38400: compareTiming(baseline, gridProbe),
        },
      },
      null,
      2,
    ),
  );
} else console.log(JSON.stringify(result, null, 2));
