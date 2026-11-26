/** Non-MX fixed-tick preservation evidence. No browser, build or npm hooks.
 * Capture (exclusive create; never overwrites evidence):
 * node --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --output /path/baseline.json
 * Compare against that immutable capture (nonzero exit on a dynamics mismatch):
 * node --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --compare /path/baseline.json
 * --output /path/current.json may accompany --compare to retain the new evidence.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { endianness } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { recordCategory, sessionIdentity } from '../../src/core/session-identity.ts';
import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, PROTOCOL_VERSION, carBase } from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';

const { values } = parseArgs({
  options: { output: { type: 'string' }, compare: { type: 'string' } },
});
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hz = 120;
const steps = hz * 10;
const vehicles = ['apx01', 'gpr1', 'sbk1000', 'sm450', 'rcx6'] as const;

/** All inputs depend on the integer tick, never wall time or random numbers. */
function inputForTick(tick: number) {
  return {
    ...controls(),
    throttle: tick < 360 ? 0.7 : tick < 600 ? 0.4 : tick < 840 ? 0 : 0.5,
    brake: tick >= 600 && tick < 840 ? 0.35 : 0,
    rearBrake: tick >= 600 && tick < 720 ? 0.15 : 0,
    steer: tick >= 240 && tick < 420 ? 0.018 : tick >= 420 && tick < 600 ? -0.018 : 0,
    riderLean: tick >= 240 && tick < 480 ? 0.25 : tick >= 600 && tick < 840 ? -0.2 : 0,
    manualClutch: tick >= 720 && tick < 780,
    clutch: tick >= 720 && tick < 780 ? 0.25 : 0,
    shift: tick === 480 ? 1 : tick === 900 ? -1 : 0,
  };
}

const inputDigest = createHash('sha256');
for (let tick = 0; tick < steps; tick++)
  inputDigest.update(JSON.stringify(inputForTick(tick)) + '\n');

function run(vehicle: (typeof vehicles)[number]) {
  const simulation = new Simulation({
    ...structuredClone(DEFAULT_OPTIONS),
    circuit: 'aurel',
    mode: 'practice',
    opponents: 1,
    vehicles: [vehicle, vehicle],
    weather: 'clear',
    assist: 'sport',
    seed: 73021,
    aiSkill: 0.9,
  });
  assert.equal(simulation.cars[0].definition.id, vehicle, 'Vehicle must not silently fall back');
  assert.equal(simulation.offroad, null, 'Aurel must use the ordinary circuit session');
  const frame = new Float32Array(HEADER + simulation.cars.length * CAR_STRIDE);
  const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const digest = createHash('sha256');
  const checkpoints: { tick: number; sha256: string }[] = [];
  let peakPlayerSpeed = 0;
  for (let tick = 0; tick <= steps; tick++) {
    if (tick > 0) {
      simulation.setInput(inputForTick(tick - 1));
      simulation.step(1 / hz);
    }
    simulation.writeFrame(frame); // stepMs and dropped are deterministic zero.
    assert(frame.every(Number.isFinite), `${vehicle}: non-finite snapshot at tick ${tick}`);
    digest.update(bytes); // Every raw byte; no field omissions or numeric rounding.
    peakPlayerSpeed = Math.max(peakPlayerSpeed, frame[carBase(0) + F.SPEED]);
    if (tick % hz === 0) checkpoints.push({ tick, sha256: sha(bytes) });
  }
  assert(peakPlayerSpeed > 1, `${vehicle}: the player must move during this workload`);
  return {
    id: `${vehicle}-aurel-clear`,
    options: simulation.options,
    identity: sessionIdentity(simulation.options),
    category: recordCategory(simulation.options),
    snapshotFloats: frame.length,
    snapshotCount: steps + 1,
    rawBytesHashed: frame.byteLength * (steps + 1),
    sha256: digest.digest('hex'),
    checkpoints,
    peakPlayerSpeed,
    finalPlayerSpeed: frame[carBase(0) + F.SPEED],
  };
}

const sourcePaths = [
  'src/core/session-identity.ts',
  'src/simulation/world.ts',
  'src/simulation/protocol.ts',
  'src/simulation/vehicle.ts',
  'src/simulation/bike-vehicle.ts',
  'src/simulation/offroad/dirt-bike-vehicle.ts',
];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  nodeVersion: process.version,
  byteOrder: endianness(),
  runnerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  sourceSha256: Object.fromEntries(
    sourcePaths.map((path) => [path, sha(readFileSync(resolve(root, path)))]),
  ),
  workload: {
    hz,
    dt: 1 / hz,
    seconds: steps / hz,
    steps,
    protocolVersion: PROTOCOL_VERSION,
    inputSha256: inputDigest.digest('hex'),
    description:
      'One scripted player and one seeded AI opponent per vehicle, Aurel, clear, practice. Initial snapshot and every 120 Hz tick; raw native-endian Float32 bytes concatenated into SHA-256.',
  },
  cases: vehicles.map(run), // Serial simulations, never parallel workers.
};

if (values.output) {
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}

if (values.compare) {
  const baseline = JSON.parse(readFileSync(resolve(values.compare), 'utf8')) as typeof report;
  const mismatches: string[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(label);
  };
  check('schemaVersion', report.schemaVersion, baseline.schemaVersion);
  check('byteOrder', report.byteOrder, baseline.byteOrder);
  check('runnerSha256', report.runnerSha256, baseline.runnerSha256);
  check('workload', report.workload, baseline.workload);
  check(
    'case ids',
    report.cases.map((item) => item.id),
    baseline.cases.map((item) => item.id),
  );
  for (const current of report.cases) {
    const previous = baseline.cases.find((item) => item.id === current.id);
    if (!previous) continue;
    // Only the deliberate global physics-version category may differ.
    const identity = {
      ...current.identity,
      simulationVersion: previous.identity.simulationVersion,
    };
    const category = { ...current.category, physics: previous.category.physics };
    check(`${current.id}: identity except simulationVersion`, identity, previous.identity);
    check(`${current.id}: category except physics`, category, previous.category);
    for (const key of [
      'options',
      'snapshotFloats',
      'snapshotCount',
      'rawBytesHashed',
      'sha256',
      'checkpoints',
    ] as const)
      check(`${current.id}: ${key}`, current[key], previous[key]);
  }
  console.log(
    JSON.stringify(
      {
        pass: mismatches.length === 0,
        mismatches,
        cases: report.cases.length,
        baselinePhysics: baseline.cases[0]?.category.physics,
        currentPhysics: report.cases[0]?.category.physics,
        output: values.output ? resolve(values.output) : null,
      },
      null,
      2,
    ),
  );
  if (mismatches.length) process.exitCode = 1;
} else
  console.log(
    JSON.stringify(
      values.output
        ? {
            output: resolve(values.output),
            cases: report.cases.map(({ id, sha256 }) => ({ id, sha256 })),
          }
        : report,
      null,
      2,
    ),
  );
