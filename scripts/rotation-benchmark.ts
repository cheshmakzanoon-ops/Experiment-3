import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { RigidBody } from '../src/simulation/rigid.ts';
import { Vec3 } from '../src/core/math.ts';

const local = new Vec3(),
  momentum = new Vec3();
function sample(body: RigidBody) {
  body.orientation.inverseRotate(body.omega, local);
  momentum.set(local.x * body.inertia.x, local.y * body.inertia.y, local.z * body.inertia.z);
  const energy = 0.5 * momentum.dot(local);
  body.orientation.rotate(momentum, momentum);
  return energy;
}
const cases = [
  [10, 15, 25],
  [2, 80, -30],
  [0.001, 18, 0.001],
];
const results = cases.map(([x, y, z]) => {
  const body = new RigidBody();
  body.orientation.yaw(0.9);
  body.omega.set(x, y, z);
  const initialEnergyJ = sample(body),
    initialMomentum = new Vec3().copy(momentum);
  let maxRelativeEnergyError = 0,
    maxRelativeWorldMomentumError = 0;
  for (let tick = 0; tick < 14400; tick++) {
    body.integrate(1 / 240);
    const energy = sample(body);
    maxRelativeEnergyError = Math.max(
      maxRelativeEnergyError,
      Math.abs(energy / initialEnergyJ - 1),
    );
    maxRelativeWorldMomentumError = Math.max(
      maxRelativeWorldMomentumError,
      momentum.sub(initialMomentum).length() / initialMomentum.length(),
    );
  }
  return {
    initialOmegaRadPerSec: [x, y, z],
    initialEnergyJ,
    maxRelativeEnergyError,
    maxRelativeWorldMomentumError,
  };
});
const report = {
  method: 'body implicit midpoint + Cayley rotation + world-torque half kicks',
  sources: Object.fromEntries(
    ['src/simulation/rigid.ts', 'src/core/math.ts'].map((path) => [
      path,
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    ]),
  ),
  durationSeconds: 60,
  timestepSeconds: 1 / 240,
  stepsPerCase: 14400,
  passed: results.every(
    (r) => r.maxRelativeEnergyError < 1e-8 && r.maxRelativeWorldMomentumError < 1e-8,
  ),
  results,
};
writeFileSync('docs/rotation-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
