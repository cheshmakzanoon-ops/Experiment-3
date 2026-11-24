/**
 * Deterministic work counts against another checkout's actual engine modules.
 * Run with Node's TypeScript transform support; no build or asset hooks run.
 *
 * node --experimental-transform-types scripts/engine-work-benchmark.mjs \
 *   --baseline /path/to/original/checkout [--output /path/to/report.json]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceFiles = [
  'src/core/math.ts',
  'src/simulation/bvh.ts',
  'src/simulation/collision.ts',
  'src/simulation/obb.ts',
  'src/simulation/protocol.ts',
  'src/simulation/rigid.ts',
  'src/storage/recorders.ts',
  'src/storage/telemetry-plots.ts',
  'src/storage/telemetry-schema.ts',
];

function options() {
  const args = process.argv.slice(2),
    result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline', '--output'].includes(args[i]) || !args[i + 1])
      throw new Error(
        'Usage: node --experimental-transform-types scripts/engine-work-benchmark.mjs --baseline CHECKOUT [--output REPORT.json]',
      );
    if (result[args[i]]) throw new Error(`Repeated option: ${args[i]}`);
    result[args[i]] = resolve(args[i + 1]);
  }
  if (!result['--baseline']) throw new Error('A baseline checkout is required');
  return result;
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function metadata(directory) {
  return {
    commit: git(directory, 'rev-parse', 'HEAD'),
    measuredFilesDirty: git(directory, 'status', '--porcelain', '--', ...sourceFiles) !== '',
    sourceSha256: Object.fromEntries(
      sourceFiles.map((file) => [file, sha256(readFileSync(resolve(directory, file)))]),
    ),
  };
}

async function modules(directory) {
  const load = (file) => import(pathToFileURL(resolve(directory, file)).href);
  const [math, bvh, collision, obb, rigid, recorders] = await Promise.all([
    load('src/core/math.ts'),
    load('src/simulation/bvh.ts'),
    load('src/simulation/collision.ts'),
    load('src/simulation/obb.ts'),
    load('src/simulation/rigid.ts'),
    load('src/storage/recorders.ts'),
  ]);
  return { ...math, ...bvh, ...collision, ...obb, ...rigid, ...recorders };
}

function seeded(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function vector(value) {
  return [value.x, value.y, value.z];
}

function bytes(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

// Patch only for synchronous measured work, restoring the original descriptor
// even if the operation or its equality check throws. No engine source is edited.
function instrument(target, key, observe, action) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key),
    original = target[key];
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value: function (...args) {
      observe(args);
      return original.apply(this, args);
    },
  });
  try {
    return action();
  } finally {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  }
}

function bvhWork(api) {
  const vertices = [],
    indices = [];
  for (let x = 1; x <= 512; x++) {
    const index = vertices.length / 3;
    vertices.push(x, -1, -1, x, 1, -1, x, -1, 1, x, 1, 1);
    indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
  }
  const tree = new api.TriangleBVH(Float64Array.from(vertices), Uint32Array.from(indices)),
    out = api.rayHit(),
    random = seeded(0x510e527f),
    trace = [],
    counts = { trianglesTested: 0, pointResolutions: 0, normalizations: 0 };
  instrument(
    out.point,
    'addScaled',
    () => counts.pointResolutions++,
    () =>
      instrument(
        out.normal,
        'normalize',
        () => counts.normalizations++,
        () => {
          for (const side of [1, -1]) {
            for (let ray = 0; ray < 64; ray++) {
              const origin = new api.Vec3(side === 1 ? 0 : 513, random() - 0.5, random() - 0.5),
                direction = new api.Vec3(side, 0, 0),
                found = tree.raycast(origin, direction, 514, out);
              assert(found, 'Every diagnostic ray should hit a layer');
              counts.trianglesTested += tree.trianglesTested;
              trace.push({
                found,
                distance: out.distance,
                triangle: out.triangle,
                point: vector(out.point),
                normal: vector(out.normal),
              });
            }
          }
        },
      ),
  );
  return { counts, trace };
}

function telemetryBatch(first, rows, stride) {
  const values = new Float32Array(rows * stride);
  for (let row = 0; row < rows; row++) {
    values[row * stride] = (first + row) / 60;
    for (let column = 1; column < stride; column++)
      values[row * stride + column] =
        ((first + row) * stride + column) * (column % 2 ? 0.125 : -0.25);
  }
  return values;
}

async function telemetryWork(api) {
  const ring = new api.TelemetryRecorder(1),
    counts = { setCalls: 0, copiedFloat32Elements: 0 };
  ring.appendBatch(telemetryBatch(0, 17, ring.stride), 17);
  const batch = telemetryBatch(17, 6000, ring.stride);
  // TypeScript private fields remain inspectable here. Instrument the actual
  // ring's destination only; snapshot/CSV work lies outside the measured append.
  instrument(
    ring.data,
    'set',
    ([source]) => {
      counts.setCalls++;
      counts.copiedFloat32Elements += source.length;
    },
    () => ring.appendBatch(batch, 6000),
  );
  const snapshot = ring.snapshot(),
    csv = Buffer.from(await ring.csv().arrayBuffer());
  return {
    counts,
    state: { head: ring.head, count: ring.count, capacity: ring.capacity, stride: ring.stride },
    physical: bytes(ring.data),
    logical: bytes(snapshot),
    csv,
  };
}

function vehicle(api, id, position, half = [0.5, 0.5, 0.5]) {
  const body = new api.RigidBody();
  body.position.set(...position);
  return { id, body, definition: { halfExtents: half }, impactAt() {} };
}

function bodyState(cars) {
  return cars.map(({ id, body }) => ({
    id,
    position: vector(body.position),
    orientation: [body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w],
    velocity: vector(body.velocity),
    omega: vector(body.omega),
  }));
}

function collisionWork(api, axis, swept) {
  const half = swept ? [0.37, 0.43, 0.89] : [0.5, 0.5, 0.5],
    cars = Array.from({ length: 64 }, (_, id) =>
      vehicle(api, id, [0, axis === 'y' ? id * 5 : 0, axis === 'z' ? id * 5 : 0], half),
    ),
    solver = new api.CollisionSolver(),
    track = { circuit: { offroad: false }, nearest: () => 0, boundaryAt: () => Infinity },
    counts = { endpointSatCalls: 0, boundingRadiusCalls: 0, sweepQueries: 0 },
    contacts = [],
    initial = bodyState(cars);
  if (swept) solver.beginStep(cars);
  instrument(
    api.BoxContact.prototype,
    'intersect',
    () => counts.endpointSatCalls++,
    () =>
      instrument(
        Math,
        'hypot',
        (args) => {
          if (args.length === 3 && args.every((value, index) => value === half[index]))
            counts.boundingRadiusCalls++;
        },
        () =>
          instrument(
            solver,
            'impulse',
            ([a, b, point, normal, depth]) => {
              contacts.push([a.id, b?.id ?? -1, ...vector(point), ...vector(normal), depth]);
            },
            () => solver.solve(cars, track, swept ? 1 / 240 : 0),
          ),
      ),
  );
  counts.sweepQueries = solver.sweepQueries;
  const final = bodyState(cars);
  assert.deepStrictEqual(final, initial, 'Separated bodies must remain untouched');
  assert.equal(contacts.length, 0, 'Separated bodies must produce no contacts');
  return { counts, state: final, contacts };
}

function box(api, car) {
  const result = new api.ChassisBox();
  result.half = car.definition.halfExtents;
  return result.update(car.body);
}

function sweptContactWork(api) {
  const start = vehicle(api, 0, [0, 0, 0], [0.1, 0.1, 2]),
    end = vehicle(api, 0, [0, 0, 0], [0.1, 0.1, 2]),
    obstacle = vehicle(api, 1, [1.3, 0, 1.3], [0.15, 0.15, 0.15]),
    sweep = new api.SweptBoxContact();
  end.body.orientation.yaw(Math.PI / 2);
  const path = [box(api, start), box(api, end), box(api, obstacle), box(api, obstacle)],
    counts = { supportCalls: 0 };
  const found = instrument(
    api.ChassisBox.prototype,
    'support',
    () => counts.supportCalls++,
    () => sweep.intersect(...path),
  );
  assert(found, 'The rotating diagnostic box should hit its obstacle');
  return {
    counts,
    hit: {
      found,
      fraction: sweep.fraction,
      iterations: sweep.iterations,
      exhausted: sweep.exhausted,
      point: vector(sweep.point),
      normal: vector(sweep.normal),
    },
  };
}

async function main() {
  const args = options(),
    baselineDirectory = args['--baseline'],
    candidateDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.notEqual(baselineDirectory, candidateDirectory, 'Use a separate baseline checkout');
  assert.equal(
    git(
      baselineDirectory,
      'status',
      '--porcelain',
      '--',
      'src/core',
      'src/simulation',
      'src/storage',
    ),
    '',
    'The baseline engine directories must match their commit',
  );
  const baseline = metadata(baselineDirectory),
    candidate = metadata(candidateDirectory),
    before = await modules(baselineDirectory),
    after = await modules(candidateDirectory),
    bvhBefore = bvhWork(before),
    bvhAfter = bvhWork(after);
  assert.deepStrictEqual(bvhAfter.trace, bvhBefore.trace, 'BVH contacts changed');
  const telemetryBefore = await telemetryWork(before),
    telemetryAfter = await telemetryWork(after);
  for (const key of ['state', 'physical', 'logical', 'csv'])
    assert.deepStrictEqual(telemetryAfter[key], telemetryBefore[key], `Telemetry ${key} changed`);
  const collision = [];
  for (const axis of ['y', 'z']) {
    for (const swept of [false, true]) {
      const oldResult = collisionWork(before, axis, swept),
        newResult = collisionWork(after, axis, swept);
      assert.deepStrictEqual(newResult.state, oldResult.state, 'Collision body state changed');
      assert.deepStrictEqual(newResult.contacts, oldResult.contacts, 'Collision contacts changed');
      collision.push({
        separatedAxis: axis,
        swept,
        cars: 64,
        baseline: oldResult.counts,
        candidate: newResult.counts,
        exactBodyStateAndContacts: true,
      });
    }
  }
  const sweepBefore = sweptContactWork(before),
    sweepAfter = sweptContactWork(after);
  assert.deepStrictEqual(sweepAfter.hit, sweepBefore.hit, 'Rotating swept contact changed');
  assert.deepStrictEqual(
    metadata(baselineDirectory),
    baseline,
    'Baseline measured files changed during the run',
  );
  assert.deepStrictEqual(
    metadata(candidateDirectory),
    candidate,
    'Candidate measured files changed during the run',
  );
  const report = {
    schema: 1,
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    platform: `${process.platform}/${process.arch}`,
    scope:
      'Deterministic synthetic operation counts and exact output comparisons of actual baseline/candidate modules. No wall-clock, FPS, GPU, or representative gameplay speed claim.',
    baseline,
    candidate,
    bvh: {
      rays: 128,
      layers: 512,
      baseline: bvhBefore.counts,
      candidate: bvhAfter.counts,
      exactContacts: true,
      contactsSha256: sha256(JSON.stringify(bvhAfter.trace)),
    },
    telemetry: {
      initialHead: 17,
      batchRows: 6000,
      ...telemetryAfter.state,
      baseline: telemetryBefore.counts,
      candidate: telemetryAfter.counts,
      exactPhysicalLogicalAndCsv: true,
      physicalSha256: sha256(telemetryAfter.physical),
      logicalSha256: sha256(telemetryAfter.logical),
      csvSha256: sha256(telemetryAfter.csv),
    },
    collision,
    rotatingSweptContact: {
      baseline: sweepBefore.counts,
      candidate: sweepAfter.counts,
      exactContact: true,
      ...sweepAfter.hit,
    },
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args['--output']) {
    mkdirSync(dirname(args['--output']), { recursive: true });
    writeFileSync(args['--output'], output);
  }
  process.stdout.write(output);
}

await main();
