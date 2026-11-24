/** Measure rigid integration without changing authored vehicle data.
 * node --experimental-transform-types scripts/rigid-step-benchmark.mjs \
 *   --baseline /original/checkout --candidate /current/checkout --output report.json
 * Run under the coordinator's shared test lock. Each timing sample runs one
 * checkout in a fresh sequential 512 MiB worker; imports and validation are
 * excluded from integration-driver timers. This is not a complete car or FPS benchmark.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const IDS = ['apx01', 'tc1', 'gpr1', 'mx450'];
const RATES = [120, 240];
const CYCLE = 1024;
const WARM_STEPS = 65536;
const TIMED_STEPS = 262144;
const REPEATS = 5;
const TRACE_STEPS = 4096;
const TRACE_VARIANTS = 4;
const vectorFields = [
  'position',
  'velocity',
  'omega',
  'force',
  'torque',
  'acceleration',
  'angularAcceleration',
  'inertia',
];
const fields = [
  ...vectorFields.flatMap((field) => ['x', 'y', 'z'].map((axis) => `${field}.${axis}`)),
  'orientation.x',
  'orientation.y',
  'orientation.z',
  'orientation.w',
  'mass',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function fingerprint(root) {
  const definitions = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--', 'src/simulation/vehicle-catalogue'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const paths = [
    'src/core/math.ts',
    'src/simulation/rigid.ts',
    'src/simulation/vehicles.ts',
    'src/simulation/bike-definitions.ts',
    'src/simulation/offroad/dirt-bikes.ts',
    ...definitions,
  ];
  return {
    head: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    files: Object.fromEntries(
      paths.map((path) => [path, sha256(readFileSync(resolve(root, path)))]),
    ),
  };
}

async function load(root) {
  const { RigidBody } = await import(pathToFileURL(resolve(root, 'src/simulation/rigid.ts')));
  const { Vec3, Quat } = await import(pathToFileURL(resolve(root, 'src/core/math.ts')));
  const { vehicleDefinition } = await import(
    pathToFileURL(resolve(root, 'src/simulation/vehicles.ts'))
  );
  const profiles = IDS.map((id) => {
    const definition = vehicleDefinition(id);
    assert.equal(definition.id, id);
    const spec = definition.spec;
    // Dry catalogue mass is an explicit benchmark input, not an assertion about
    // the complete race vehicle's changing fuel, rider and damage mass.
    return {
      id,
      mass: spec.dryMass,
      inertia: [...spec.inertia],
      speed: id === 'apx01' ? 65 : id === 'tc1' ? 45 : id === 'gpr1' ? 60 : 25,
      wheelRadius: spec.wheelRadius,
      wheelInertia: spec.wheelInertia,
      wheels: definition.dynamicsKind === 'bike' ? 2 : 4,
    };
  });
  return { RigidBody, Vec3, Quat, profiles };
}

function configure(body, profile, variant = 0) {
  body.mass = profile.mass;
  body.inertia.set(...profile.inertia);
  body.position.set(230 + variant * 37, 1.2 + variant * 0.07, -70 - variant * 19);
  body.velocity.set(0.2 - variant * 0.1, 0.1, profile.speed);
  body.omega.set(0.35 + variant * 0.07, -0.24 + variant * 0.11, 0.16 - variant * 0.04);
  body.orientation.x = 0;
  body.orientation.y = 0;
  body.orientation.z = 0;
  body.orientation.w = 1;
  body.orientation.integrateWorld({ x: 0.2, y: 0.55 + variant * 0.3, z: -0.14 }, 1);
  body.force.set(0, 0, 0);
  body.torque.set(0, 0, 0);
  body.acceleration.set(0, 0, 0);
  body.angularAcceleration.set(0, 0, 0);
}

function inputPlan(profile) {
  const plan = new Float64Array(CYCLE * 12);
  const rotor = (profile.wheels * profile.wheelInertia * profile.speed) / profile.wheelRadius;
  for (let index = 0; index < CYCLE; index++) {
    const a = (index / CYCLE) * Math.PI * 2;
    const next = ((index + 1) / CYCLE) * Math.PI * 2;
    const offset = index * 12;
    plan[offset] = profile.mass * 0.8 * Math.sin(a);
    plan[offset + 1] = profile.mass * 0.25 * Math.cos(a * 3);
    plan[offset + 2] = profile.mass * 2.5 * Math.sin(a * 2);
    plan[offset + 3] = profile.inertia[0] * 0.6 * Math.cos(a * 2);
    plan[offset + 4] = profile.inertia[1] * 0.4 * Math.sin(a * 3);
    plan[offset + 5] = profile.inertia[2] * 0.2 * Math.cos(a);
    plan[offset + 6] = rotor * (1 + 0.08 * Math.sin(a));
    plan[offset + 7] = rotor * 0.015 * Math.sin(a * 2);
    plan[offset + 8] = rotor * 0.01 * Math.cos(a * 3);
    plan[offset + 9] = rotor * (1 + 0.08 * Math.sin(next));
    plan[offset + 10] = rotor * 0.015 * Math.sin(next * 2);
    plan[offset + 11] = rotor * 0.01 * Math.cos(next * 3);
  }
  return plan;
}

function inputs(body, start, end, plan, index) {
  const offset = (index % CYCLE) * 12;
  body.force.set(plan[offset], plan[offset + 1], plan[offset + 2]);
  body.torque.set(plan[offset + 3], plan[offset + 4], plan[offset + 5]);
  start.set(plan[offset + 6], plan[offset + 7], plan[offset + 8]);
  end.set(plan[offset + 9], plan[offset + 10], plan[offset + 11]);
}

function capture(body, out) {
  let cursor = 0;
  for (const field of vectorFields) {
    out[cursor++] = body[field].x;
    out[cursor++] = body[field].y;
    out[cursor++] = body[field].z;
  }
  out[cursor++] = body.orientation.x;
  out[cursor++] = body.orientation.y;
  out[cursor++] = body.orientation.z;
  out[cursor++] = body.orientation.w;
  out[cursor] = body.mass;
  return out;
}

function ownedObjects(body, library) {
  return Object.entries(body).filter(
    ([, value]) => value instanceof library.Vec3 || value instanceof library.Quat,
  );
}

function sameObjects(body, owned) {
  for (const [key, object] of owned) assert.equal(body[key], object, `${key} changed identity`);
}

function timed(library, profile, hz) {
  const body = new library.RigidBody();
  const start = new library.Vec3();
  const end = new library.Vec3();
  const plan = inputPlan(profile);
  const owned = ownedObjects(body, library);
  function run(count) {
    let checksum = 0;
    for (let index = 0; index < count; index++) {
      if (index % CYCLE === 0) configure(body, profile);
      inputs(body, start, end, plan, index);
      body.integrate(1 / hz, start, end);
      checksum += body.position.x + body.orientation.w;
    }
    return checksum;
  }
  run(WARM_STEPS);
  globalThis.gc?.();
  const begin = performance.now();
  const checksum = run(TIMED_STEPS);
  const milliseconds = performance.now() - begin;
  sameObjects(body, owned);
  return {
    id: profile.id,
    hz,
    milliseconds,
    nanosecondsPerStep: (milliseconds * 1e6) / TIMED_STEPS,
    checksum,
    finalStateSHA256: sha256(bytes(capture(body, new Float64Array(fields.length)))),
    inputSHA256: sha256(bytes(plan)),
    ownedVectors: owned.filter(([, value]) => value instanceof library.Vec3).length,
    ownedQuaternions: owned.filter(([, value]) => value instanceof library.Quat).length,
    retainedObjectIdentitiesUnchanged: true,
  };
}

function verifyTrajectories(before, after) {
  const results = [];
  const expected = new Float64Array(fields.length);
  const actual = new Float64Array(fields.length);
  const expectedBytes = bytes(expected);
  const actualBytes = bytes(actual);
  let comparisons = 0;
  for (const profile of before.profiles) {
    const plan = inputPlan(profile);
    for (const hz of RATES) {
      const hash = createHash('sha256');
      for (let variant = 0; variant < TRACE_VARIANTS; variant++) {
        const original = new before.RigidBody();
        const candidate = new after.RigidBody();
        configure(original, profile, variant);
        configure(candidate, profile, variant);
        const objects = ownedObjects(candidate, after);
        const start = new before.Vec3();
        const end = new before.Vec3();
        const rotor = new before.Vec3(120, 15, -4);
        for (let tick = 0; tick < TRACE_STEPS; tick++) {
          inputs(original, start, end, plan, tick + variant * 71);
          candidate.force.copy(original.force);
          candidate.torque.copy(original.torque);
          const h0 = variant === 0 ? undefined : variant === 1 ? rotor : start;
          const h1 = variant < 2 ? h0 : end;
          original.integrate(1 / hz, h0, h1);
          candidate.integrate(1 / hz, h0, h1);
          capture(original, expected);
          capture(candidate, actual);
          assert(expectedBytes.equals(actualBytes), `${profile.id}/${hz}/${variant}/${tick}`);
          hash.update(actualBytes);
          comparisons++;
        }
        sameObjects(candidate, objects);
      }
      results.push({
        id: profile.id,
        hz,
        trajectories: TRACE_VARIANTS,
        stepsPerTrajectory: TRACE_STEPS,
        nativeFloat64StatesExact: true,
        traceSHA256: hash.digest('hex'),
        inputSHA256: sha256(bytes(plan)),
      });
    }
  }
  return { comparisons, scalarComparisons: comparisons * fields.length, fields, results };
}

function verifyRecovery(library) {
  const profile = library.profiles[0];
  const result = [];
  // These are invalid-state probes, deliberately excluded from normal timings.
  const failures = [
    {
      name: 'invalid-position',
      prepare: (body) => (body.position.x = NaN),
      dt: 1 / 120,
    },
    {
      name: 'singular-midpoint',
      prepare(body) {
        body.orientation.yaw(0);
        body.inertia.set(1, 2, 3);
        body.omega.set(1, 2, 0);
        body.torque.set(0, 0, 0);
      },
      dt: 2,
    },
    {
      name: 'translation-overflow',
      prepare(body) {
        body.position.set(Number.MAX_VALUE, 0, 0);
        body.velocity.set(Number.MAX_VALUE, 0, 0);
        body.force.set(0, 0, 0);
      },
      dt: 1,
    },
  ];
  for (const failure of failures) {
    const body = new library.RigidBody();
    configure(body, profile, 3);
    const objects = ownedObjects(body, library);
    const start = new library.Vec3(300, -25, 45);
    const end = new library.Vec3(300.2, -24.9, 44.8);
    let rejections = 0;
    const errors = new Set();
    for (let repeat = 0; repeat < 128; repeat++) {
      body.integrate(1 / 120, start, end);
      const accepted = capture(body, new Float64Array(fields.length));
      failure.prepare(body);
      const rejected = capture(body, new Float64Array(fields.length));
      for (let attempt = 0; attempt < 2; attempt++) {
        let error;
        try {
          body.integrate(failure.dt);
        } catch (caught) {
          error = caught;
        }
        assert(error instanceof Error, `${failure.name} was accepted`);
        errors.add(error.message);
        assert(bytes(capture(body, new Float64Array(fields.length))).equals(bytes(rejected)));
        rejections++;
      }
      // Restore only public state. Dirty private scratch from both failed calls
      // remains, so the next step must match an independently configured body.
      const fresh = new library.RigidBody();
      for (const destination of [body, fresh]) {
        let cursor = 0;
        for (const field of vectorFields) {
          destination[field].set(accepted[cursor], accepted[cursor + 1], accepted[cursor + 2]);
          cursor += 3;
        }
        destination.orientation.x = accepted[cursor++];
        destination.orientation.y = accepted[cursor++];
        destination.orientation.z = accepted[cursor++];
        destination.orientation.w = accepted[cursor++];
        destination.mass = accepted[cursor];
        destination.integrate(1 / 240, end, start);
      }
      assert.deepEqual(
        capture(body, new Float64Array(fields.length)),
        capture(fresh, new Float64Array(fields.length)),
      );
      sameObjects(body, objects);
    }
    result.push({ name: failure.name, rejections, recoveries: 128, errors: [...errors] });
  }
  return result;
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(['--baseline', '--candidate', '--output'].includes(key), `Unknown argument ${key}`);
    assert(argv[index + 1], `Missing value for ${key}`);
    result[key.slice(2)] = resolve(argv[index + 1]);
  }
  assert(result.baseline, '--baseline CHECKOUT is required');
  result.candidate ??= resolve(dirname(script), '..');
  return result;
}

if (process.argv[2] === '--worker') {
  const begin = performance.now();
  const library = await load(resolve(process.argv[3]));
  const importMilliseconds = performance.now() - begin;
  const repetition = Number(process.argv[4]);
  const workloads = library.profiles.flatMap((profile) => RATES.map((hz) => ({ profile, hz })));
  const results = [];
  for (let offset = 0; offset < workloads.length; offset++) {
    const { profile, hz } = workloads[(offset + repetition) % workloads.length];
    results.push(timed(library, profile, hz));
  }
  console.log(
    JSON.stringify({ importMilliseconds, results, maximumRssKiB: process.resourceUsage().maxRSS }),
  );
} else {
  const paths = options(process.argv.slice(2));
  const baseline = fingerprint(paths.baseline);
  const candidate = fingerprint(paths.candidate);
  const changedSources = Object.keys(baseline.files).filter(
    (path) => baseline.files[path] !== candidate.files[path],
  );
  assert.deepEqual(changedSources, ['src/simulation/rigid.ts']);
  const before = await load(paths.baseline);
  const after = await load(paths.candidate);
  assert.deepEqual(after.profiles, before.profiles);
  const exact = verifyTrajectories(before, after);
  const recovery = verifyRecovery(after);
  const samples = { baseline: [], candidate: [] };
  for (let repetition = 0; repetition < REPEATS; repetition++) {
    const order = repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const side of order) {
      const output = execFileSync(
        process.execPath,
        [
          '--experimental-transform-types',
          '--expose-gc',
          '--max-old-space-size=512',
          script,
          '--worker',
          paths[side],
          String(repetition),
        ],
        {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
        },
      );
      samples[side].push(JSON.parse(output));
    }
  }
  const summary = [];
  for (const profile of before.profiles) {
    for (const hz of RATES) {
      const pairs = Object.fromEntries(
        ['baseline', 'candidate'].map((side) => [
          side,
          samples[side].map((sample) =>
            sample.results.find((result) => result.id === profile.id && result.hz === hz),
          ),
        ]),
      );
      for (const side of ['baseline', 'candidate']) {
        for (const sample of pairs[side]) {
          assert.equal(sample.checksum, pairs.baseline[0].checksum);
          assert.equal(sample.finalStateSHA256, pairs.baseline[0].finalStateSHA256);
          assert.equal(sample.inputSHA256, pairs.baseline[0].inputSHA256);
        }
      }
      const distribution = Object.fromEntries(
        ['baseline', 'candidate'].map((side) => {
          const values = pairs[side].map((sample) => sample.milliseconds).sort((a, b) => a - b);
          return [side, { minimum: values[0], median: values[2], maximum: values[4] }];
        }),
      );
      summary.push({
        id: profile.id,
        hz,
        milliseconds: distribution,
        candidateMedianChangePercent:
          (distribution.candidate.median / distribution.baseline.median - 1) * 100,
      });
    }
  }
  // Root may publish unrelated changes during measurement. Files, not a moving
  // HEAD, determine whether the measured implementation stayed unchanged.
  assert.deepEqual(fingerprint(paths.baseline).files, baseline.files);
  assert.deepEqual(fingerprint(paths.candidate).files, candidate.files);
  const report = {
    version: 1,
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      workerOldSpaceMiB: 512,
    },
    methodology: {
      freshWorkersPerSide: REPEATS,
      warmupStepsPerWorkload: WARM_STEPS,
      timedStepsPerWorkload: TIMED_STEPS,
      periodicResetSteps: CYCLE,
      timingIncludes:
        'Input application, periodic public-state reset, actual RigidBody.integrate and checksum accumulation.',
      timingExcludes: 'Imports, input generation, exact comparisons, identity checks and hashes.',
      allocationLimit:
        'Owned vector/quaternion counts and stable identities are measured; this is not a complete transient heap-allocation profiler.',
      scopeLimit:
        'Synthetic force/torque/rotor trajectories on unchanged catalogue mass/inertia; not a full vehicle/world simulation or FPS prediction.',
    },
    baseline,
    candidate,
    changedSources,
    profiles: before.profiles,
    exact,
    recovery,
    samples,
    summary,
  };
  if (paths.output) writeFileSync(paths.output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      { output: paths.output, exactStates: exact.comparisons, recovery, summary },
      null,
      2,
    ),
  );
}
