/** Same-source ordinary/prepared crossover; W07 evidence remains unchanged.
 * Fixtures and untimed ownership/allocation checks extend measure-network.mjs.
 * The baseline is an actual-tree byte oracle, never a reimplemented encoder. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, hostname, release } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ORIGINAL_BASELINE,
  median,
  prepareModule,
  seeded,
  sha256,
  withTimingLock,
  writeReport,
} from './benchmark-support.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    output: { type: 'string' },
    measure: { type: 'boolean', default: false },
    exclusive: { type: 'boolean', default: false },
    lock: { type: 'string' },
    'expected-current': { type: 'string' },
    iterations: { type: 'string' },
  },
});
for (const key of ['baseline', 'current', 'output'])
  assert(values[key] && isAbsolute(values[key]), `Required: --${key} /absolute/path`);
assert(!existsSync(values.output), 'Refusing to overwrite an existing report');
assert(/^[a-f0-9]{40}$/.test(values['expected-current'] ?? ''), 'Pin --expected-current');
if (values.measure) {
  assert(values.exclusive, 'Use --exclusive only after an explicit compute reservation');
  assert(values.lock && isAbsolute(values.lock), 'Measurement needs an explicit shared --lock');
} else {
  assert(!values.exclusive, 'Untimed smoke must not claim an exclusive reservation');
  assert(!values.iterations, '--iterations is a measurement-only option');
}
const FIXTURES = 32,
  CARS = 12,
  FULL = 1,
  SEED = 0x739e21,
  workloadFile = fileURLToPath(import.meta.url),
  helperFile = fileURLToPath(new URL('./benchmark-support.mjs', import.meta.url)),
  iterations = values.measure ? Number(values.iterations ?? 4096) : FIXTURES,
  warmupPairs = values.measure ? 3 : 0,
  samplePairs = values.measure ? 9 : 2;
assert(
  Number.isSafeInteger(iterations) &&
    iterations >= FIXTURES &&
    iterations <= 262144 &&
    iterations % FIXTURES === 0,
  'Iterations must be a multiple of 32 between 32 and 262144',
);
// Declare every case before measurement: a full field and the smallest field
// capable of each recipient count. No selected-case reruns or dropped samples.
const specifications = [
  ...Array.from({ length: CARS }, (_, index) => ({ cars: CARS, recipients: index + 1 })),
  ...Array.from({ length: CARS - 2 }, (_, index) => ({ cars: index + 2, recipients: index + 2 })),
].map((spec) => ({ ...spec, name: `cars:${spec.cars}/recipients:${spec.recipients}` }));
const variants = ['ordinary', 'prepared'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const byteView = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const capacity = (buffers) => [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);

function snapshotFixture(random, variant, carCount) {
  const cars = Array.from({ length: carCount }, (_, index) => {
    const yaw = random() * Math.PI * 2;
    return {
      id: (index + variant) % carCount,
      flags: (index * 18 + variant * 14) & 254,
      x: index * 9 + random() * 2 - 100,
      y: random() * 8,
      z: variant * 6 + random() * 3,
      qx: 0,
      qy: Math.sin(yaw / 2),
      qz: 0,
      qw: Math.cos(yaw / 2),
      vx: 20 + random() * 60,
      vy: random() * 2 - 1,
      vz: random() * 10 - 5,
      wx: random() * 2 - 1,
      wy: random() * 4 - 2,
      wz: random() * 2 - 1,
      ax: random() * 20 - 10,
      ay: random() * 4 - 2,
      az: random() * 10 - 5,
      steer: random() * 2 - 1,
      throttle: random(),
      brake: random(),
      gear: 1 + ((index + variant) % 8),
      rpm: 3000 + random() * 9000,
      s: index * 20 + variant * 12 + random(),
      laps: variant % 9,
      rank: index + 1,
    };
  });
  const headers = Array.from({ length: carCount }, (_, recipient) => ({
    tick: 1200 + variant * 6,
    phase: variant % 6,
    raceTime: variant * 0.05 + 31.125,
    ackSeq: variant === 0 ? -1 : 400 + variant * 2 + recipient,
    slack: [-135, -3.5, 0, 2.5, 127, 135][(variant + recipient) % 6],
    missing: [0, 1, 3.5, 255, 300][(variant + recipient) % 5],
    echo: (0xfffffff0 + variant * 9 + recipient) >>> 0,
    hold: [0, 0.49, 0.5, 16.75, 65535, 70000][(variant + recipient) % 6],
  }));
  return {
    cars,
    headers,
    snapshots: headers.map((header) => ({ ...header, cars })),
    owners: headers.map((_, recipient) => (recipient + variant) % carCount),
  };
}

/** Encoding-only comparison of both available server paths, using real exports.
 * Fixtures/header objects/world capture/transport are deliberately outside it. */
function broadcast(api, fixture, recipients, preparedPath, outputs, offset = 0, onPrepared = null) {
  if (!recipients) return;
  const shared = preparedPath ? api.prepareSnapshotCars(fixture.cars) : null;
  if (shared && onPrepared) onPrepared(shared);
  for (let recipient = 0; recipient < recipients; recipient++) {
    if (shared) {
      outputs[offset + recipient] = api.encodePreparedSnapshot(
        fixture.headers[recipient],
        shared,
        fixture.owners[recipient],
      );
    } else {
      const own = fixture.cars[fixture.owners[recipient]];
      own.flags |= FULL;
      try {
        outputs[offset + recipient] = api.encodeSnapshot(fixture.snapshots[recipient]);
      } finally {
        own.flags &= ~FULL;
      }
    }
  }
}

function encodeFixture(api, variant, spec, fixture, onPrepared = null) {
  const outputs = new Array(spec.recipients);
  broadcast(api, fixture, spec.recipients, variant === 'prepared', outputs, 0, onPrepared);
  return outputs;
}

function packetDigest(packets) {
  const hash = createHash('sha256');
  let bytes = 0;
  for (const packet of packets) {
    hash.update(`${packet.length}:`);
    hash.update(packet);
    bytes += packet.length;
  }
  return { checksum: hash.digest('hex'), packets: packets.length, bytes };
}

function assertOwned(packets) {
  const buffers = new Set();
  for (const packet of packets) {
    assert(packet instanceof Uint8Array);
    assert.equal(packet.byteOffset, 0);
    assert.equal(packet.buffer.byteLength, packet.byteLength);
    assert(!buffers.has(packet.buffer), 'Each returned packet must own a different backing buffer');
    buffers.add(packet.buffer);
  }
}

function assertPacketsEqual(baseline, current) {
  assert.equal(baseline.length, current.length);
  for (let index = 0; index < baseline.length; index++)
    assert(byteView(baseline[index]).equals(byteView(current[index])), `Packet ${index} differs`);
}

function assertSnapshotRecipient(decoded, fixture, recipient) {
  const header = fixture.headers[recipient],
    { cars, ...actualHeader } = decoded;
  assert.deepEqual(actualHeader, {
    tick: header.tick >>> 0,
    phase: header.phase,
    raceTime: Math.fround(header.raceTime),
    ackSeq: header.ackSeq < 0 ? -1 : header.ackSeq >>> 0,
    slack: clamp(Math.round(header.slack), -128, 127),
    missing: clamp(Math.round(header.missing), 0, 255),
    echo: header.echo >>> 0,
    hold: clamp(Math.round(header.hold), 0, 65535),
  });
  assert.equal(cars.length, fixture.cars.length);
  for (let index = 0; index < cars.length; index++) {
    assert.equal(cars[index].id, fixture.cars[index].id);
    assert.equal(
      cars[index].flags,
      fixture.cars[index].flags | (index === fixture.owners[recipient] ? FULL : 0),
    );
  }
}

/** All instrumentation is synchronous, untimed, and restored before any measured broadcast.
 * Record actual identities; a global ArrayBuffer constructor proxy would miss
 * typed-array-owned storage and species allocations such as finish().slice(). */
function allocationProbe(Writer, action) {
  const prototype = Writer.prototype,
    methods = ['u8', 'i8', 'u16', 'i16', 'u32', 'f32', 'f64', 'bytes'],
    original = Object.fromEntries(
      ['reserve', 'finish', ...methods].map((name) => [name, prototype[name]]),
    ),
    typedOriginal = Object.fromEntries(
      ['subarray', 'slice', 'set'].map((name) => [name, Uint8Array.prototype[name]]),
    ),
    writers = new Map(),
    writerBuffers = new Set(),
    dataViews = new Set(),
    finishBuffers = new Set(),
    allBuffers = new Set(),
    compactBuffers = new Set(),
    fullBuffers = new Set(),
    scalarCalls = Object.fromEntries(methods.map((name) => [name, 0]));
  let growthEvents = 0,
    growthCopyBytes = 0,
    subarrayViews = 0,
    sliceCopies = 0,
    sliceCopiedBytes = 0,
    bulkSets = 0,
    bulkSetBytes = 0,
    preparedObjects = 0;
  function record(writer) {
    if (!writers.has(writer))
      writers.set(writer, { initial: writer.buffer.length, final: writer.buffer.length });
    writers.get(writer).final = writer.buffer.length;
    writerBuffers.add(writer.buffer.buffer);
    dataViews.add(writer.view);
    allBuffers.add(writer.buffer.buffer);
    assert.equal(writer.view.buffer, writer.buffer.buffer);
  }
  prototype.reserve = function (bytes) {
    record(this);
    const before = this.buffer,
      copied = this.length;
    original.reserve.call(this, bytes);
    if (this.buffer !== before) {
      growthEvents++;
      growthCopyBytes += copied;
    }
    record(this);
  };
  prototype.finish = function () {
    record(this);
    const output = original.finish.call(this);
    assert.notEqual(output.buffer, this.buffer.buffer);
    finishBuffers.add(output.buffer);
    allBuffers.add(output.buffer);
    return output;
  };
  for (const name of methods)
    prototype[name] = function (...args) {
      scalarCalls[name]++;
      return original[name].apply(this, args);
    };
  Uint8Array.prototype.subarray = function (...args) {
    subarrayViews++;
    return typedOriginal.subarray.apply(this, args);
  };
  Uint8Array.prototype.slice = function (...args) {
    const output = typedOriginal.slice.apply(this, args);
    sliceCopies++;
    sliceCopiedBytes += output.byteLength;
    return output;
  };
  Uint8Array.prototype.set = function (source, ...args) {
    bulkSets++;
    bulkSetBytes += source.byteLength;
    return typedOriginal.set.call(this, source, ...args);
  };
  let packets;
  try {
    packets = action((prepared) => {
      preparedObjects++;
      for (const field of ['full', 'compact']) {
        const array = prepared[field];
        assert.equal(array.byteOffset, 0);
        assert.equal(array.buffer.byteLength, array.byteLength);
        allBuffers.add(array.buffer);
        (field === 'full' ? fullBuffers : compactBuffers).add(array.buffer);
      }
      assert.notEqual(prepared.full.buffer, prepared.compact.buffer);
    });
  } finally {
    for (const [name, method] of Object.entries(original)) prototype[name] = method;
    for (const [name, method] of Object.entries(typedOriginal)) Uint8Array.prototype[name] = method;
  }
  assertOwned(packets);
  for (const packet of packets) assert(finishBuffers.has(packet.buffer));
  for (const buffer of fullBuffers)
    assert(finishBuffers.has(buffer), 'Prepared FULL is a finish output, not another allocation');
  assert.equal(sliceCopies, finishBuffers.size);
  const carSerializations = (scalarCalls.f32 - packets.length) / 4;
  assert(Number.isSafeInteger(carSerializations));
  return {
    packets,
    observations: {
      writerInstances: writers.size,
      writerInitialCapacityBytes: [...writers.values()].reduce(
        (sum, item) => sum + item.initial,
        0,
      ),
      writerFinalCapacityBytes: [...writers.values()].reduce((sum, item) => sum + item.final, 0),
      writerBackingBuffers: writerBuffers.size,
      writerBackingCapacityBytes: capacity(writerBuffers),
      writerDataViews: dataViews.size,
      finishBuffers: finishBuffers.size,
      finishCapacityBytes: capacity(finishBuffers),
      preparedObjects,
      preparedFullCapacityBytes: capacity(fullBuffers),
      preparedCompactCapacityBytes: capacity(compactBuffers),
      preparedCompactBuffers: compactBuffers.size,
      totalBackingBuffers: allBuffers.size,
      totalBackingCapacityBytes: capacity(allBuffers),
      finalPacketBytes: packets.reduce((sum, packet) => sum + packet.byteLength, 0),
      growthEvents,
      growthCopyBytes,
      subarrayViews,
      sliceCopies,
      sliceCopiedBytes,
      bulkSets,
      bulkSetBytes,
      knownUint8ArrayObjects:
        writerBuffers.size + finishBuffers.size + compactBuffers.size + subarrayViews,
      scalarCalls,
      carSerializations,
    },
  };
}

function ownershipProbe(api, variant, spec) {
  const fixture = snapshotFixture(seeded(SEED), 7, spec.cars),
    originalFixture = sha256(JSON.stringify(fixture));
  let prepared;
  const first = encodeFixture(api, variant, spec, fixture, (value) => {
      prepared = value;
    }),
    second = encodeFixture(api, variant, spec, fixture),
    expected = first.map((packet) => packet.slice());
  assert.equal(sha256(JSON.stringify(fixture)), originalFixture);
  assertPacketsEqual(first, second);
  assertOwned([...first, ...second]);
  fixture.cars[0].x += 500;
  fixture.cars[0].vx -= 20;
  fixture.headers[0].ackSeq++;
  if (prepared) {
    prepared.full.fill(0);
    prepared.compact.fill(0);
  }
  encodeFixture(api, variant, spec, fixture);
  assertPacketsEqual(first, expected);
  assertPacketsEqual(second, expected);
  first[0].fill(0);
  assertPacketsEqual(second, expected);
  return {
    independentOutputs: true,
    retainedAfterLaterCalls: true,
    sourceMutationIsolated: true,
    preparedMutationIsolated: !!prepared,
  };
}

async function preflight(sources, api) {
  const writers = {};
  for (const side of ['baseline', 'current']) {
    const root = sources[side].identity.root,
      constants = await import(pathToFileURL(resolve(root, 'src/net/constants.ts')).href);
    writers[side] = (
      await import(pathToFileURL(resolve(root, 'src/net/bytes.ts')).href)
    ).ByteWriter;
    assert.equal(constants.LIMITS.playersPerLobby, CARS);
    for (const name of ['src/net/bytes.ts', 'src/net/constants.ts'])
      assert(sources[side].identity.files[name]);
  }
  const results = [];
  for (const spec of specifications) {
    const packets = { baseline: [], ordinary: [], prepared: [] },
      random = seeded(SEED);
    for (let variant = 0; variant < FIXTURES; variant++) {
      const fixture = snapshotFixture(random, variant, spec.cars),
        before = sha256(JSON.stringify(fixture)),
        decoded = {};
      for (const path of ['baseline', ...variants]) {
        const encoder = path === 'baseline' ? api.baseline : api.current,
          outputs = encodeFixture(
            encoder,
            path === 'prepared' ? 'prepared' : 'ordinary',
            spec,
            fixture,
          );
        assert.equal(sha256(JSON.stringify(fixture)), before);
        decoded[path] = outputs.map((packet, recipient) => {
          const result = encoder.decodeServerMessage(packet, 'unreliable');
          assert.equal(result.ok, true);
          assertSnapshotRecipient(result.value.snapshot, fixture, recipient);
          return result.value;
        });
        packets[path].push(...outputs);
      }
      assert.deepEqual(decoded.baseline, decoded.ordinary);
      assert.deepEqual(decoded.baseline, decoded.prepared);
    }
    assertPacketsEqual(packets.baseline, packets.ordinary);
    assertPacketsEqual(packets.baseline, packets.prepared);
    assertOwned([...packets.baseline, ...packets.ordinary, ...packets.prepared]);
    const allocation = {},
      ownership = {};
    for (const path of ['baseline', ...variants]) {
      const side = path === 'baseline' ? 'baseline' : 'current',
        variant = path === 'prepared' ? 'prepared' : 'ordinary',
        fixture = snapshotFixture(seeded(SEED), 3, spec.cars),
        probe = allocationProbe(writers[side], (onPrepared) =>
          encodeFixture(api[side], variant, spec, fixture, onPrepared),
        );
      allocation[path] = probe.observations;
      ownership[path] = ownershipProbe(api[side], variant, spec);
    }
    assert.deepEqual(allocation.baseline, allocation.ordinary);
    const packetBytes = 35 + 39 * spec.cars;
    for (const variant of variants) {
      const prepared = variant === 'prepared',
        observed = allocation[variant];
      assert.equal(observed.finalPacketBytes, packetBytes * spec.recipients);
      assert.equal(observed.carSerializations, spec.cars * (prepared ? 1 : spec.recipients));
      assert.equal(
        observed.totalBackingCapacityBytes,
        prepared
          ? 141 * spec.cars + 2 * packetBytes * spec.recipients
          : (67 + 91 * spec.cars) * spec.recipients,
      );
      assert.equal(observed.totalBackingBuffers, 2 * spec.recipients + (prepared ? 3 : 0));
      assert.equal(observed.preparedObjects, Number(prepared));
      assert.equal(observed.growthEvents, 0);
    }
    results.push({
      specification: spec,
      actualBaselineWireAndDecodeEquality: true,
      ...packetDigest(packets.ordinary),
      allocation,
      ownership,
    });
  }
  return {
    purpose: 'Untimed actual-baseline equality, ownership and allocation observation',
    fixturesPerCase: FIXTURES,
    method:
      'Actual writer methods and backing buffer identities; same W07 observations extended to intermediate recipient counts and minimal fields. All prototype instrumentation is restored before workloads.',
    allocationLimits:
      'Cumulative capacities of observed backing buffers, not peak memory, all JS heap, allocator overhead or GC cost. Prepared FULL is already a finish buffer and is counted only once. Header/fixture objects are outside measurement. Every production encoder allocation and once-per-broadcast preparation stays inside timing.',
    cases: results,
  };
}

function prepareState(api, variant, spec, seed) {
  const random = seeded(seed),
    fixtures = Array.from({ length: FIXTURES }, (_, index) =>
      snapshotFixture(random, index, spec.cars),
    ),
    retained = encodeFixture(api, variant, spec, fixtures[0]);
  return {
    api,
    variant,
    fixtures,
    fixtureHash: sha256(JSON.stringify(fixtures)),
    outputs: new Array(FIXTURES * spec.recipients),
    retained,
    retainedBytes: retained.map((packet) => packet.slice()),
  };
}
function run(state, spec) {
  for (let index = 0; index < iterations; index++) {
    const slot = index % FIXTURES;
    broadcast(
      state.api,
      state.fixtures[slot],
      spec.recipients,
      state.variant === 'prepared',
      state.outputs,
      slot * spec.recipients,
    );
  }
  return state.outputs;
}
function observe(state, spec) {
  assertPacketsEqual(state.retained, state.retainedBytes);
  assertOwned([...state.retained, ...state.outputs]);
  assert.equal(sha256(JSON.stringify(state.fixtures)), state.fixtureHash);
  for (let index = 0; index < state.outputs.length; index++) {
    const decoded = state.api.decodeServerMessage(state.outputs[index], 'unreliable');
    assert.equal(decoded.ok, true);
    assertSnapshotRecipient(
      decoded.value.snapshot,
      state.fixtures[Math.floor(index / spec.recipients)],
      index % spec.recipients,
    );
  }
  return { outputs: state.outputs, fixtureHash: state.fixtureHash, ...packetDigest(state.outputs) };
}
function shuffledIndices(length, random) {
  const result = Array.from({ length }, (_, index) => index);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function timingSummary(samples) {
  if (!values.measure)
    return {
      validForComparison: false,
      medianUsPerBroadcast: null,
      pairedPercentChange: null,
      preparedFasterPairs: null,
    };
  const changes = samples.map((row) => 100 * (row.prepared.elapsedMs / row.ordinary.elapsedMs - 1)),
    speedups = samples.map((row) => row.ordinary.elapsedMs / row.prepared.elapsedMs);
  return {
    validForComparison: samples.every((row) => row.equivalence.passed),
    medianUsPerBroadcast: Object.fromEntries(
      variants.map((variant) => [
        variant,
        (1000 * median(samples.map((row) => row[variant].elapsedMs))) / iterations,
      ]),
    ),
    pairedPercentChange: {
      median: median(changes),
      min: Math.min(...changes),
      max: Math.max(...changes),
      raw: changes,
    },
    pairedSpeedup: {
      median: median(speedups),
      min: Math.min(...speedups),
      max: Math.max(...speedups),
    },
    preparedFasterPairs: changes.filter((value) => value < 0).length,
    samplePairs: samples.length,
  };
}

async function execute(lock) {
  const sources = {},
    api = {},
    evidenceFiles = Object.fromEntries(
      [workloadFile, helperFile].map((path) => [
        path,
        { bytes: readFileSync(path).length, sha256: sha256(readFileSync(path)) },
      ]),
    );
  for (const side of ['baseline', 'current']) {
    sources[side] = await prepareModule({
      root: values[side],
      entry: 'src/net/codec.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : values['expected-current'],
      extraFiles: ['src/net/server.ts'],
    });
    api[side] = await sources[side].load();
  }
  assert.notEqual(sources.baseline.identity.root, sources.current.identity.root);
  assert.equal(
    sources.baseline.identity.files['package-lock.json'].sha256,
    sources.current.identity.files['package-lock.json'].sha256,
  );
  assert.equal(typeof api.baseline.prepareSnapshotCars, 'undefined');
  assert.equal(typeof api.current.prepareSnapshotCars, 'function');
  const stable = () => {
    for (const source of Object.values(sources)) source.assertStable();
    for (const [path, identity] of Object.entries(evidenceFiles))
      assert.deepEqual(
        { bytes: readFileSync(path).length, sha256: sha256(readFileSync(path)) },
        identity,
      );
  };
  stable();
  const checked = await preflight(sources, api),
    cases = specifications.map((specification) => ({ specification, warmups: [], samples: [] })),
    rounds = [];
  let allEqual = true;
  for (const [phase, count] of [
    ['warmup', warmupPairs],
    ['sample', samplePairs],
  ]) {
    for (let pair = 0; pair < count; pair++) {
      const round = pair + (phase === 'sample' ? warmupPairs : 0),
        roundSeed = (SEED + Math.imul(0x9e3779b9, round + 1)) >>> 0,
        order = shuffledIndices(cases.length, seeded(roundSeed));
      rounds.push({ phase, pair, roundSeed, caseOrder: order });
      for (const caseIndex of order) {
        const item = cases[caseIndex],
          spec = item.specification,
          seed = (roundSeed + Math.imul(0x85ebca6b, caseIndex + 1)) >>> 0,
          armOrder = (round + caseIndex) % 2 ? ['prepared', 'ordinary'] : ['ordinary', 'prepared'],
          row = { pair, seed, order: armOrder },
          observations = {};
        for (const variant of armOrder) {
          const state = prepareState(api.current, variant, spec, seed),
            start = values.measure ? performance.now() : 0;
          run(state, spec);
          const elapsedMs = values.measure ? performance.now() - start : null;
          observations[variant] = observe(state, spec);
          row[variant] = {
            elapsedMs,
            usPerBroadcast: values.measure ? (elapsedMs * 1000) / iterations : null,
          };
        }
        const ordinary = observations.ordinary,
          prepared = observations.prepared;
        const equal =
          ordinary.fixtureHash === prepared.fixtureHash &&
          ordinary.outputs.length === prepared.outputs.length &&
          ordinary.outputs.every((packet, index) =>
            byteView(packet).equals(byteView(prepared.outputs[index])),
          );
        allEqual &&= equal;
        row.equivalence = {
          passed: equal,
          fixtureSha256: ordinary.fixtureHash,
          checksums: { ordinary: ordinary.checksum, prepared: prepared.checksum },
          comparedPackets: ordinary.packets,
          comparedBytes: ordinary.bytes,
          retainedUnchanged: true,
          outputOwnership: true,
          recipientHeadersAndFullFlags: true,
        };
        item[phase === 'warmup' ? 'warmups' : 'samples'].push(row);
      }
    }
  }
  stable();
  for (const item of cases) item.timing = timingSummary(item.samples);
  const report = {
    schema: 'engine-snapshot-crossover/1',
    createdAt: new Date().toISOString(),
    purpose: values.measure ? 'measurement' : 'smoke',
    sources: Object.fromEntries(
      Object.entries(sources).map(([side, source]) => [side, source.identity]),
    ),
    evidenceFiles,
    runtime: {
      node: process.version,
      versions: process.versions,
      execArgv: process.execArgv,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      cpu: cpus()[0]?.model ?? null,
      logicalCpus: cpus().length,
      host: hostname(),
      pid: process.pid,
    },
    concurrency: {
      exclusiveCompute: values.measure,
      cooperativeLock: lock,
      limitation:
        'Cooperative lock records a reservation; it cannot detect uncoordinated external work.',
    },
    configuration: {
      seed: SEED,
      generator: 'mulberry32',
      warmupPairs,
      samplePairs,
      iterations,
      fixtures: FIXTURES,
      unit: 'complete broadcast',
      moduleLifetime: 'reuse',
      variantSources: { ordinary: '$.sources.current', prepared: '$.sources.current' },
      baselineRole:
        'Untimed complete-wire/decode/allocation oracle only; not one of the two measured arms.',
      order:
        'Seeded shuffled case order each round; alternating arm order by round+case index; same independent fixtures per pair.',
    },
    scope: {
      timedWork:
        'Actual current encodeSnapshot for each recipient, or actual current prepareSnapshotCars once per broadcast followed by actual encodePreparedSnapshot for each recipient. All encoder allocations, scalar conversion, compact/full construction and owned packet copies are inside; output reference ring writes are inside.',
      setupWork:
        'Imports, manifests, fixtures/header objects, reference ring allocation, retained reference packets, all decoding/byte/hash/ownership checks and report I/O outside timing.',
      allocationScope:
        'Separate untimed instrumentation observes actual ByteWriter buffers/finish outputs and compact buffers. Production allocations stay inside timing, while no instrumentation runs there.',
      limitations:
        'Local Node encoder comparison. No world capture, server queue/latch/event execution, transport, browser/physical-network latency, FPS, heap or GC result. Bounded ring retains final outputs for 32 fixtures, not every historical packet. Intermediate field sizes between the minimum and 12 cars are not all measured; a recipient threshold is a scoped engineering choice, not a universal crossover.',
    },
    preflight: checked,
    rounds,
    cases,
    stableSources: true,
    equivalence: { passed: allEqual, checkedPairs: cases.length * (warmupPairs + samplePairs) },
    timing: {
      validForComparison: values.measure && allEqual,
      note: values.measure
        ? 'Every declared case, raw pair and warmup retained. Read paired variation and capacities separately. No automatic threshold selection.'
        : 'Untimed smoke; all workload elapsed durations and medians are null.',
    },
  };
  writeReport(values.output, report);
  assert(allEqual, 'Encoding variants diverged; measurement is invalid');
  process.stdout.write(
    JSON.stringify({
      output: values.output,
      purpose: report.purpose,
      cases: cases.length,
      checkedPairs: report.equivalence.checkedPairs,
      oraclePacketsPerVariant: checked.cases.reduce((sum, item) => sum + item.packets, 0),
      oracleBytesPerVariant: checked.cases.reduce((sum, item) => sum + item.bytes, 0),
      equivalence: allEqual,
      workloadTimingsCollected: values.measure,
    }) + '\n',
  );
}
if (values.measure) await withTimingLock(values.lock, execute);
else await execute(null);
