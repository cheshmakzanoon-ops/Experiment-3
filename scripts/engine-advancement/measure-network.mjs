/** Actual original/current encoders. Smoke is untimed; measurement needs a reservation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ORIGINAL_BASELINE,
  prepareModule,
  runPaired,
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
if (values.measure) {
  assert(values.exclusive, 'Use --exclusive only after an explicit compute reservation');
  assert(values.lock && isAbsolute(values.lock), 'Measurement requires an explicit shared --lock');
  assert(
    /^[a-f0-9]{40}$/.test(values['expected-current'] ?? ''),
    'Pin --expected-current to a full commit',
  );
} else {
  assert(!values.exclusive, 'An untimed smoke must not claim an exclusive reservation');
  assert(!values.iterations, '--iterations is a measurement-only option');
}
const FIXTURES = 32,
  CARS = 12,
  FULL = 1,
  SEED = 0x739e21,
  workloadFile = fileURLToPath(import.meta.url),
  iterations = values.measure ? Number(values.iterations ?? 8192) : FIXTURES;
assert(
  Number.isSafeInteger(iterations) &&
    iterations >= FIXTURES &&
    iterations <= 262144 &&
    iterations % FIXTURES === 0,
  'Iterations must be a multiple of 32 between 32 and 262144',
);
const specifications = [
  ...[0, 1, 2, 4, 12].map((recipients) => ({
    name: `snapshot:${recipients}`,
    kind: 'snapshot',
    recipients,
  })),
  ...[0, 1, 4, 12, 16].map((commands) => ({ name: `input:${commands}`, kind: 'input', commands })),
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const byteView = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const capacity = (buffers) => [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);

function snapshotFixture(random, variant) {
  const cars = Array.from({ length: CARS }, (_, index) => {
    const yaw = random() * Math.PI * 2;
    return {
      id: (index * 5 + variant) % CARS,
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
  const headers = Array.from({ length: CARS }, (_, recipient) => ({
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
    owners: headers.map((_, recipient) => (recipient + variant) % CARS),
  };
}

function inputFixture(random, variant, count) {
  const firstSequence = Math.floor(random() * 0x10000000),
    commands = [];
  let tick = Math.floor(random() * 0x10000000);
  for (let index = 0; index < count; index++) {
    const k = index + variant,
      ticks = variant % 4 ? 2 : 1 + (k % 8);
    commands.push({
      seq: firstSequence + index,
      tick,
      ticks,
      controls: {
        throttle: random(),
        brake: random(),
        clutch: random(),
        rearBrake: random(),
        steer: random() * 2 - 1,
        riderLean: random() * 2 - 1,
        shift: (k % 3) - 1,
        ers: (k + 1) % 3,
        manualClutch: !!(k & 1),
        reverse: !!(k & 2),
        drs: !!(k & 4),
        overtake: !!(k & 8),
        pit: !!(k & 16),
      },
    });
    tick += ticks;
  }
  return { sentAt: (0xfffffff0 + variant * 31) >>> 0, ackTick: variant * 6, commands };
}

function fixtureFor(spec, random, variant) {
  return spec.kind === 'snapshot'
    ? snapshotFixture(random, variant)
    : inputFixture(random, variant, spec.commands);
}

/** Encoding-only counterpart of the reviewed server policy, using real exports.
 * Fixtures/header objects/world capture/transport are deliberately outside it. */
function broadcast(api, fixture, recipients, preparedPath, outputs, offset = 0, onPrepared = null) {
  if (!recipients) return;
  const shared = preparedPath && recipients > 1 ? api.prepareSnapshotCars(fixture.cars) : null;
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

function encodeFixture(api, side, spec, fixture, onPrepared = null) {
  if (spec.kind === 'input') return [api.encodeInput(fixture)];
  const outputs = new Array(spec.recipients);
  broadcast(api, fixture, spec.recipients, side === 'current', outputs, 0, onPrepared);
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
  assert.equal(cars.length, CARS);
  for (let index = 0; index < cars.length; index++) {
    assert.equal(cars[index].id, fixture.cars[index].id);
    assert.equal(
      cars[index].flags,
      fixture.cars[index].flags | (index === fixture.owners[recipient] ? FULL : 0),
    );
  }
}

/** All instrumentation is synchronous, untimed, and restored before runPaired.
 * Record actual identities; a global ArrayBuffer constructor proxy would miss
 * typed-array-owned storage and species allocations such as finish().slice(). */
function allocationProbe(Writer, action, spec) {
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
  const carSerializations =
    spec.kind === 'snapshot' ? (scalarCalls.f32 - packets.length) / 4 : null;
  assert(carSerializations === null || Number.isSafeInteger(carSerializations));
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

function ownershipProbe(api, side, spec) {
  const fixture = fixtureFor(spec, seeded(SEED), 7),
    originalFixture = sha256(JSON.stringify(fixture));
  let prepared;
  const first = encodeFixture(api, side, spec, fixture, (value) => {
      prepared = value;
    }),
    second = encodeFixture(api, side, spec, fixture),
    expected = first.map((packet) => packet.slice());
  assert.equal(
    sha256(JSON.stringify(fixture)),
    originalFixture,
    'Encoding must preserve captured input',
  );
  assertPacketsEqual(first, second);
  assertOwned([...first, ...second]);
  if (spec.kind === 'snapshot') {
    fixture.cars[0].x += 500;
    fixture.cars[0].vx -= 20;
    fixture.headers[0].ackSeq++;
    if (prepared) {
      prepared.full.fill(0);
      prepared.compact.fill(0);
    }
  } else {
    fixture.sentAt++;
    if (fixture.commands[0]) fixture.commands[0].controls.throttle = 0;
    fixture.commands.length = 0;
  }
  encodeFixture(api, side, spec, fixture);
  assertPacketsEqual(first, expected);
  assertPacketsEqual(second, expected);
  if (first[0]) first[0].fill(0);
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
    assert.equal(constants.LIMITS.commandsPerPacket, 16);
    assert.equal(constants.LIMITS.inputRedundancy, 12);
    assert.equal(constants.LIMITS.playersPerLobby, CARS);
    for (const name of ['src/net/bytes.ts', 'src/net/constants.ts'])
      assert(sources[side].identity.files[name]);
  }
  const results = [];
  for (const spec of specifications) {
    const packets = { baseline: [], current: [] },
      random = { baseline: seeded(SEED), current: seeded(SEED) };
    for (let variant = 0; variant < FIXTURES; variant++) {
      const decoded = {};
      for (const side of ['baseline', 'current']) {
        const fixture = fixtureFor(spec, random[side], variant),
          before = sha256(JSON.stringify(fixture)),
          outputs = encodeFixture(api[side], side, spec, fixture);
        assert.equal(sha256(JSON.stringify(fixture)), before);
        decoded[side] = outputs.map((packet, recipient) => {
          const result =
            spec.kind === 'snapshot'
              ? api[side].decodeServerMessage(packet, 'unreliable')
              : api[side].decodeClientMessage(packet, 'unreliable');
          assert.equal(result.ok, true);
          if (spec.kind === 'snapshot')
            assertSnapshotRecipient(result.value.snapshot, fixture, recipient);
          return result.value;
        });
        packets[side].push(...outputs);
      }
      assert.deepEqual(decoded.baseline, decoded.current);
    }
    assertPacketsEqual(packets.baseline, packets.current);
    assertOwned(packets.baseline);
    assertOwned(packets.current);
    const allocation = {},
      ownership = {};
    for (const side of ['baseline', 'current']) {
      const fixture = fixtureFor(spec, seeded(SEED), 3),
        probe = allocationProbe(
          writers[side],
          (onPrepared) => encodeFixture(api[side], side, spec, fixture, onPrepared),
          spec,
        );
      allocation[side] = probe.observations;
      ownership[side] = ownershipProbe(api[side], side, spec);
    }
    if (spec.kind === 'snapshot') {
      const count = spec.recipients;
      assert.equal(allocation.baseline.carSerializations, CARS * count);
      assert.equal(allocation.current.carSerializations, count > 1 ? CARS : CARS * count);
      assert.equal(allocation.baseline.totalBackingCapacityBytes, 1159 * count);
      assert.equal(
        allocation.current.totalBackingCapacityBytes,
        count > 1 ? 1692 + 1006 * count : 1159 * count,
      );
      assert.equal(allocation.current.preparedObjects, Number(count > 1));
      assert.equal(allocation.baseline.growthEvents + allocation.current.growthEvents, 0);
    } else {
      assert.equal(allocation.baseline.growthEvents, Number(spec.commands > 0));
      assert.equal(allocation.current.growthEvents, 0);
      assert.equal(
        allocation.current.writerInitialCapacityBytes,
        allocation.current.finalPacketBytes,
      );
      assert.equal(
        allocation.current.totalBackingCapacityBytes,
        2 * allocation.current.finalPacketBytes,
      );
    }
    results.push({
      ...spec,
      completeWireAndDecodeEquality: true,
      ...packetDigest(packets.current),
      ownership,
      allocation,
    });
  }
  for (const source of Object.values(sources)) source.assertStable();
  return {
    purpose: 'untimed correctness and allocation observation',
    fixtureSeed: SEED,
    fixturesPerCase: FIXTURES,
    method:
      'Actual writer reserve/finish/scalar calls and actual backing-buffer identities, plus returned prepared FULL/compact buffers. All originals restored before paired workloads. No global ArrayBuffer proxy.',
    allocationLimits:
      'Counts cover the reviewed encoder backing stores, writer/DataView/typed-array objects, known subarray views and prepared objects. Byte capacities are cumulative per operation, not peak live memory, allocator overhead, all JS heap allocation, GC, RSS or wire protocol overhead. Prepared FULL capacity is already included in finish capacity and is not added twice. Car serializations are inferred from observed f32 calls: four per car and one per snapshot header.',
    cases: results,
  };
}

async function execute(lock) {
  const sources = {},
    api = {};
  for (const side of ['baseline', 'current']) {
    sources[side] = await prepareModule({
      root: values[side],
      entry: 'src/net/codec.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : values['expected-current'],
      extraFiles: ['src/net/server.ts'],
    });
    api[side] = await sources[side].load();
  }
  assert.equal(typeof api.baseline.prepareSnapshotCars, 'undefined');
  assert.equal(typeof api.current.prepareSnapshotCars, 'function');
  const checked = await preflight(sources, api),
    cases = [];
  let common;
  for (const spec of specifications) {
    const report = await runPaired({
      name: `network ${spec.name}`,
      sources,
      workloadFile,
      seed: SEED,
      purpose: values.measure ? 'measurement' : 'smoke',
      exclusiveCompute: values.measure,
      lock,
      warmupPairs: values.measure ? 3 : 0,
      samplePairs: values.measure ? 9 : 2,
      iterations,
      unit: spec.kind === 'snapshot' ? 'broadcast' : 'input packet',
      scope: {
        timedWork:
          spec.kind === 'snapshot'
            ? `One complete encoding broadcast over ${CARS} captured cars and ${spec.recipients} recipients per iteration. Baseline uses actual encodeSnapshot with owning FULL flag set/restored; current uses the ordinary path at one recipient, and actual prepareSnapshotCars exactly once plus every encodePreparedSnapshot at multiple recipients. Zero recipients skip encoding. Includes writer allocation, growth, FULL/compact construction, recipient copies and every final finish copy; includes bounded output-ring writes.`
            : `One complete actual encodeInput call for ${spec.commands} contiguous commands per iteration, including scalar validation/serialization, writer allocation, any growth and the final independently owned packet copy. Includes bounded output-ring writes.`,
        setupWork:
          'Imports, independent identical seeded fixture/header construction, fixture ring, retained reference packets and output reference array are outside timing. Decoding, complete packet checks, ownership checks, hashing, allocation instrumentation and report writes are outside timing. The 32-fixture ring repeats; final outputs for every fixture remain observable.',
        allocationScope:
          'All allocations performed by production encoder calls remain inside timed run(), including once-per-broadcast prepared storage. Preallocated fixture/header objects and the fixed output-reference ring are outside timing. Allocation counts come from a separate untimed probe; no instrumentation is active in paired runs.',
        limitations:
          'Local synchronous encoder comparison only. Excludes world capture, header-object construction, server queue/event/dispatch handling, transport, MessageChannel delivery, command-log/resend selection, physics and rendering. Retains a bounded output ring, not every historical packet; preflight checks all fixture packets and later-call ownership. Zero-recipient timing is only loop/branch control overhead. No whole-game FPS, network-latency, heap/GC or device claims; report slower and no-gain cases.',
      },
      prepare({ api, random, side }) {
        const fixtures = Array.from({ length: FIXTURES }, (_, variant) =>
            fixtureFor(spec, random, variant),
          ),
          retained = encodeFixture(api, side, spec, fixtures[0]);
        return {
          api,
          side,
          fixtures,
          fixtureHash: sha256(JSON.stringify(fixtures)),
          outputs: new Array(FIXTURES * (spec.kind === 'snapshot' ? spec.recipients : 1)),
          retained,
          retainedBytes: retained.map((packet) => packet.slice()),
        };
      },
      run(state, { iterations }) {
        for (let index = 0; index < iterations; index++) {
          const slot = index % FIXTURES;
          if (spec.kind === 'snapshot')
            broadcast(
              state.api,
              state.fixtures[slot],
              spec.recipients,
              state.side === 'current',
              state.outputs,
              slot * spec.recipients,
            );
          else state.outputs[slot] = state.api.encodeInput(state.fixtures[slot]);
        }
        return state.outputs;
      },
      observe(outputs, state) {
        assertPacketsEqual(state.retained, state.retainedBytes);
        assertOwned([...state.retained, ...outputs]);
        assert.equal(sha256(JSON.stringify(state.fixtures)), state.fixtureHash);
        return { outputs, fixtureHash: state.fixtureHash, ...packetDigest(outputs) };
      },
      compare(baseline, current) {
        return {
          equal:
            baseline.fixtureHash === current.fixtureHash &&
            baseline.outputs.length === current.outputs.length &&
            baseline.outputs.every((packet, index) =>
              byteView(packet).equals(byteView(current.outputs[index])),
            ),
          checksums: { baseline: baseline.checksum, current: current.checksum },
          fixtureSha256: baseline.fixtureHash,
          comparedPackets: baseline.packets,
          comparedBytes: baseline.bytes,
          retainedPacketsUnchanged: true,
          ownedOutputs: true,
        };
      },
    });
    const { sources: identity, runtime, evidenceFiles, ...caseReport } = report;
    if (!common) common = { sources: identity, runtime, evidenceFiles };
    else {
      assert.deepEqual(identity, common.sources);
      assert.deepEqual(evidenceFiles, common.evidenceFiles);
    }
    cases.push({
      specification: spec,
      sharedIdentity: '$.sources, $.runtime, $.evidenceFiles',
      ...caseReport,
    });
  }
  const report = {
    schema: 'engine-advancement-network/1',
    createdAt: new Date().toISOString(),
    purpose: values.measure ? 'measurement' : 'smoke',
    ...common,
    preflight: checked,
    cases,
    equivalence: { passed: cases.every((item) => item.equivalence.passed) },
    timing: {
      validForComparison: values.measure && cases.every((item) => item.timing.validForComparison),
      note: values.measure
        ? 'Inspect every raw paired case, including zero/single-recipient controls and increased prepared byte capacity at two/four recipients. No cases omitted.'
        : 'Untimed preflight and smoke only; all workload elapsed durations and medians are null.',
    },
  };
  writeReport(values.output, report);
  assert.equal(report.equivalence.passed, true);
  process.stdout.write(
    JSON.stringify({
      output: values.output,
      purpose: report.purpose,
      cases: cases.length,
      wirePacketsCompared: checked.cases.reduce((sum, item) => sum + item.packets, 0),
      wireBytesCompared: checked.cases.reduce((sum, item) => sum + item.bytes, 0),
      equivalence: true,
      workloadTimingsCollected: values.measure,
    }) + '\n',
  );
}

if (values.measure) await withTimingLock(values.lock, execute);
else await execute(null);
