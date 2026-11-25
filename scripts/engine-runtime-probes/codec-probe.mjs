import { performance } from 'node:perf_hooks';
import { assert, BASELINE, variants } from './support.mjs';

const entry = [
  "export { ByteWriter } from './src/net/bytes.ts';",
  "export { encodeInput, encodeSnapshot, prepareSnapshotCars, encodePreparedSnapshot } from './src/net/codec.ts';",
  "export { LIMITS } from './src/net/constants.ts';",
  "export { CAR_FLAG, CAR_COMPACT_BYTES, CAR_FULL_BYTES, SNAPSHOT_HEADER_BYTES, emptyCarState } from './src/net/snapshot.ts';",
  "export { controls } from './src/simulation/config.ts';",
].join('\n');
const report = {
  probe: 'codec',
  schemaVersion: 1,
  baselineRef: BASELINE,
  status: 'running',
  scope: 'Codec encoding only; all dependencies except bytes.ts and codec.ts use the candidate checkout.',
};
let baseline, candidate;

function input(count, seed = 0) {
  let tick = 1200 + seed * 128;
  return {
    sentAt: 0x100000003 + seed,
    ackTick: 0xffffffff - seed,
    commands: Array.from({ length: count }, (_, i) => {
      const command = {
        seq: 40 + seed * 32 + i,
        tick,
        ticks: 1 + (i % candidate.LIMITS.commandTicksMax),
        controls: {
          ...candidate.controls(),
          throttle: i % 2 ? 1 : 0.5,
          brake: i % 3 ? 0 : 0.3,
          clutch: (i % 5) / 4,
          steer: (i % 3) - 1,
          riderLean: i % 2 ? -0.6 : 0.7,
          rearBrake: (i % 4) / 3,
          shift: (i % 3) - 1,
          ers: i % 3,
          manualClutch: !!(i & 1),
          pit: !!(i & 1),
          reverse: !!(i & 2),
          drs: !!(i & 2),
          overtake: !!(i & 4),
        },
      };
      tick += command.ticks;
      return command;
    }),
  };
}

function snapshot(count, seed = 0) {
  return {
    tick: 0xffffffff - seed,
    phase: 3,
    raceTime: seed ? 123.5 + seed / 20 : -0,
    ackSeq: seed ? 40 + seed : -1,
    slack: -200.5 + seed,
    missing: 300 - seed,
    echo: 0x100000003 + seed,
    hold: 65535.5 - seed,
    cars: Array.from({ length: count }, (_, i) => ({
      ...candidate.emptyCarState(count - i - 1),
      flags: (i * 39) & ~candidate.CAR_FLAG.FULL,
      x: i * -123.456 + seed,
      y: i / 7,
      z: -i / 11,
      vx: i * 100,
      vy: -i * 90,
      vz: i / 3,
      wx: i * -20,
      wy: i / 5,
      wz: -i / 7,
      ax: -i * 500,
      ay: i * 500,
      az: i / 2,
      steer: i - 1.5,
      throttle: (i % 4) / 3,
      brake: (i % 3) / 2,
      gear: (i % 13) - 2,
      rpm: i * 1024 + 32,
      s: i * 14.125,
      laps: i * 27,
      rank: i * 17,
    })),
  };
}

function forRecipient(source, own) {
  return {
    ...source,
    cars: source.cars.map((car, i) => ({
      ...car,
      flags: (car.flags & ~candidate.CAR_FLAG.FULL) | (i === own ? candidate.CAR_FLAG.FULL : 0),
    })),
  };
}

function exactBuffer(packet, label) {
  assert.ok(packet instanceof Uint8Array, label + ': Uint8Array');
  assert.equal(packet.byteOffset, 0, label + ': byte offset');
  assert.equal(packet.buffer.byteLength, packet.byteLength, label + ': exact backing length');
}

function transfer(packet, expected, label) {
  exactBuffer(packet, label);
  const backing = packet.buffer;
  const received = structuredClone(packet, { transfer: [backing] });
  assert.equal(backing.byteLength, 0, label + ': detached backing');
  assert.equal(packet.byteLength, 0, label + ': detached sender');
  exactBuffer(received, label + ': received');
  assert.deepEqual(received, expected, label + ': transferred bytes');
  return received;
}

function checkOrdinary(source, encode, mutate, label) {
  const original = structuredClone(source);
  const expected = encode(baseline, source);
  const retained = [];
  for (const [name, api] of [['baseline', baseline], ['candidate', candidate]]) {
    const first = encode(api, source);
    const second = encode(api, source);
    assert.deepEqual(first, expected, label + ': ' + name + ' bytes');
    assert.deepEqual(second, expected, label + ': ' + name + ' retained bytes');
    exactBuffer(second, label);
    assert.notEqual(first.buffer, second.buffer, label + ': independent calls');
    transfer(first, expected, label + ': ' + name);
    const later = encode(api, source);
    assert.deepEqual(later, expected, label + ': encode after transfer');
    assert.notEqual(later.buffer, second.buffer, label + ': later call independence');
    retained.push(second, later);
  }
  assert.deepEqual(source, original, label + ': source unchanged');
  mutate(source);
  for (const packet of retained) assert.deepEqual(packet, expected, label + ': retained after source mutation');
}

function verify() {
  const summary = { inputCases: 0, ordinarySnapshotCases: 0, preparedBoundaries: 0, preparedRecipients: 0 };
  const fullPatterns = [
    ['none', () => false],
    ['last', (i, count) => i === count - 1],
    ['alternating', (i) => !!(i & 1)],
    ['all', () => true],
  ];
  for (let seed = 0; seed < 3; seed++) {
    for (let count = 0; count <= candidate.LIMITS.commandsPerPacket; count++) {
      checkOrdinary(input(count, seed), (api, value) => api.encodeInput(value), (value) => {
        value.commands.length = 0;
        value.sentAt = 99;
      }, 'input/' + count + '/' + seed);
      summary.inputCases++;
    }
    for (let count = 0; count <= candidate.LIMITS.carsPerSnapshot; count++) {
      for (const [pattern, full] of fullPatterns) {
        const source = snapshot(count, seed);
        source.cars.forEach((car, i) => { if (full(i, count)) car.flags |= candidate.CAR_FLAG.FULL; });
        checkOrdinary(source, (api, value) => api.encodeSnapshot(value), (value) => {
          value.cars.forEach((car) => { car.x = 999; car.flags = candidate.CAR_FLAG.FULL; });
        }, 'snapshot/' + count + '/' + pattern + '/' + seed);
        summary.ordinarySnapshotCases++;
      }
    }
    for (let count = 1; count <= candidate.LIMITS.carsPerSnapshot; count++) {
      const source = snapshot(count, seed);
      source.cars.forEach((car, i) => { if (i & 1) car.flags |= candidate.CAR_FLAG.FULL; });
      const original = structuredClone(source);
      const expected = source.cars.map((_, own) => baseline.encodeSnapshot(forRecipient(source, own)));
      for (const [name, api] of [['baseline', baseline], ['candidate', candidate]]) {
        const captured = structuredClone(source);
        const prepared = api.prepareSnapshotCars(captured.cars);
        exactBuffer(prepared.full, name + ': prepared full');
        exactBuffer(prepared.compact, name + ': prepared compact');
        assert.notEqual(prepared.full.buffer, prepared.compact.buffer);
        const packets = expected.map((reference, own) => {
          const packet = api.encodePreparedSnapshot(captured, prepared, own);
          assert.deepEqual(packet, reference, name + ': prepared/' + count + '/' + own + '/' + seed);
          exactBuffer(packet, name + ': prepared packet');
          assert.notEqual(packet.buffer, prepared.full.buffer);
          assert.notEqual(packet.buffer, prepared.compact.buffer);
          return packet;
        });
        assert.equal(new Set(packets.map((packet) => packet.buffer)).size, count);
        const moved = transfer(packets[0], expected[0], name + ': prepared transfer');
        packets[0] = api.encodePreparedSnapshot(captured, prepared, 0);
        assert.deepEqual(captured, original, name + ': prepared source unchanged');
        captured.cars.forEach((car) => { car.x = 999; car.flags = candidate.CAR_FLAG.FULL; });
        api.prepareSnapshotCars(captured.cars);
        prepared.full.fill(0);
        prepared.compact.fill(0);
        assert.deepEqual(moved, expected[0], name + ': moved packet retained');
        packets.forEach((packet, own) => assert.deepEqual(packet, expected[own], name + ': peer retained'));
      }
      summary.preparedBoundaries++;
      summary.preparedRecipients += count;
    }
  }
  // Candidate-only consuming API; baseline finish() remains the byte reference.
  const writer = new candidate.ByteWriter(4).u32(0x12345678);
  const backing = writer.buffer;
  const owned = writer.finishOwned();
  assert.equal(owned, backing);
  assert.equal(writer.length, 0);
  transfer(owned, Uint8Array.of(0x78, 0x56, 0x34, 0x12), 'writer exact transfer');
  const writeAll = (w) => w.u8(1).i8(-2).u16(3).i16(-4).u32(5).f32(1.5).f64(-0.25)
    .varint(16384).bytes(Uint8Array.of(6, 7));
  const reference = writeAll(new baseline.ByteWriter()).finish();
  assert.deepEqual(writeAll(writer).finishOwned(), reference, 'writer reuse after transfer');
  for (let i = 0; i < 3; i++) {
    transfer(writer.finishOwned(), new Uint8Array(0), 'empty transfer');
    writer.bytes(new Uint8Array(0));
  }
  assert.deepEqual(writer.u8(19).finishOwned(), Uint8Array.of(19));
  for (const capacity of [0, 2, 32]) {
    const spare = new candidate.ByteWriter(capacity).u16(0x1234).u8(0x56);
    const prior = spare.buffer;
    const packet = spare.finishOwned();
    assert.notEqual(packet.buffer, prior.buffer);
    transfer(packet, Uint8Array.of(0x34, 0x12, 0x56), 'spare capacity');
    assert.deepEqual(spare.u8(7).finishOwned(), Uint8Array.of(7));
  }
  for (const api of [baseline, candidate]) {
    const w = new api.ByteWriter(8).u16(0x1234);
    const first = w.finish();
    w.u16(0x5678);
    assert.deepEqual(first, Uint8Array.of(0x34, 0x12));
    first.fill(0);
    assert.deepEqual(w.finish(), Uint8Array.of(0x34, 0x12, 0x78, 0x56));
    assert.equal(w.length, 4);
    assert.throws(() => api.encodeInput(input(api.LIMITS.commandsPerPacket + 1)), /Too many commands/);
    const gap = input(2); gap.commands[1].seq++;
    assert.throws(() => api.encodeInput(gap), /contiguous/);
    assert.throws(() => api.encodeSnapshot(snapshot(api.LIMITS.carsPerSnapshot + 1)), /Too many cars/);
    const empty = api.prepareSnapshotCars([]);
    exactBuffer(empty.full, 'empty prepared full');
    exactBuffer(empty.compact, 'empty prepared compact');
    assert.throws(() => api.encodePreparedSnapshot(snapshot(0), empty, 0), /Invalid full car index/);
  }
  return {
    ...summary,
    inputCountRange: [0, candidate.LIMITS.commandsPerPacket],
    snapshotCountRange: [0, candidate.LIMITS.carsPerSnapshot],
    fullPatterns: fullPatterns.map(([name]) => name),
    seeds: 3,
    reference: 'Actual baseline encodeInput/encodeSnapshot; prepared outputs also match baseline ordinary encoding.',
    ownership: 'Exact backing lengths, retained packets, source independence, peer independence, whole-buffer transfer, writer reuse.',
  };
}

// Fixed work, no adaptive expansion: normally seconds, not a hard wall-clock guarantee.
function cases() {
  const makeSeeds = (fn) => Array.from({ length: 3 }, (_, seed) => fn(seed));
  return [
    ...[2, 4, 12].map((count) => ({
      name: 'input-' + count, kind: 'input', iterations: 8000, packetsPerIteration: 1,
      fixtures: makeSeeds((seed) => input(count, seed)),
      expected: { baseline: [2, 2 * (18 + count * 9), 18 + count * 9, 0], candidate: [1, 18 + count * 9, 0, 0] },
    })),
    {
      name: 'snapshot-12-cars-2-ordinary', kind: 'ordinary', iterations: 600, packetsPerIteration: 2,
      fixtures: makeSeeds((seed) => {
        const source = snapshot(12, seed);
        return [forRecipient(source, 0), forRecipient(source, 11)];
      }),
      expected: { baseline: [4, 2318, 1006, 0], candidate: [2, 1006, 0, 0] },
    },
    {
      name: 'snapshot-12-cars-12-prepared', kind: 'prepared', iterations: 180, packetsPerIteration: 12,
      fixtures: makeSeeds((seed) => snapshot(12, seed)),
      expected: { baseline: [27, 13764, 6648, 6228], candidate: [14, 7116, 0, 6228] },
    },
  ];
}

function consume(sum, packet) {
  return (sum + packet.length + packet[0] + packet[packet.length >> 1] + packet[packet.length - 1]) >>> 0;
}

function batch(api, testCase) {
  let checksum = 0;
  const { fixtures, iterations, kind } = testCase;
  if (kind === 'input') {
    for (let i = 0; i < iterations; i++) checksum = consume(checksum, api.encodeInput(fixtures[i % 3]));
  } else if (kind === 'ordinary') {
    for (let i = 0; i < iterations; i++) {
      for (const source of fixtures[i % 3]) checksum = consume(checksum, api.encodeSnapshot(source));
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      const source = fixtures[i % 3];
      const prepared = api.prepareSnapshotCars(source.cars);
      for (let own = 0; own < source.cars.length; own++) {
        checksum = consume(checksum, api.encodePreparedSnapshot(source, prepared, own));
      }
    }
  }
  return checksum;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function pairedTimings(testCases) {
  const started = performance.now();
  const results = testCases.map((testCase, caseIndex) => {
    function pair(index, phase) {
      const order = (index + caseIndex) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
      const samples = {};
      for (const name of order) {
        const start = performance.now();
        const checksum = batch(name === 'baseline' ? baseline : candidate, testCase);
        samples[name] = { milliseconds: performance.now() - start, checksum };
      }
      assert.equal(samples.candidate.checksum, samples.baseline.checksum, testCase.name + ': timed checksum');
      return {
        index, phase, order,
        baselineMs: samples.baseline.milliseconds,
        candidateMs: samples.candidate.milliseconds,
        candidateOverBaseline: samples.candidate.milliseconds / samples.baseline.milliseconds,
        checksum: samples.baseline.checksum,
      };
    }
    const warmups = Array.from({ length: 3 }, (_, i) => pair(i, 'warmup'));
    const pairs = Array.from({ length: 7 }, (_, i) => pair(i + 3, 'measured'));
    const baselineMedianMs = median(pairs.map((p) => p.baselineMs));
    const candidateMedianMs = median(pairs.map((p) => p.candidateMs));
    return {
      name: testCase.name, iterationsPerSample: testCase.iterations,
      packetsPerIteration: testCase.packetsPerIteration, warmups, pairs,
      baselineMedianMs, candidateMedianMs,
      medianPairedRatio: median(pairs.map((p) => p.candidateOverBaseline)),
      ratioOfMedians: candidateMedianMs / baselineMedianMs,
    };
  });
  return {
    elapsedMs: performance.now() - started,
    warmupPairs: 3, measuredPairs: 7,
    timer: 'performance.now(), sequential alternating order within each pair',
    includes: 'Encoding, prepared-car work once per prepared boundary, and output checksum reads.',
    excludes: 'Bundling, fixtures, assertions, ownership checks, copy/backing instrumentation.',
    workBound: '8000 input packets, 600 ordinary boundaries, or 180 prepared boundaries per sample; no adaptive expansion.',
    timingPassCriteria: null,
    results,
  };
}

// Synchronous, untimed instrumentation only. Never installed during timing.
function instrument(run) {
  const Native = globalThis.Uint8Array;
  const prototype = Native.prototype;
  const sliceDescriptor = Object.getOwnPropertyDescriptor(prototype, 'slice');
  const setDescriptor = Object.getOwnPropertyDescriptor(prototype, 'set');
  const slice = prototype.slice, set = prototype.set;
  const backings = new Set();
  let backingBytes = 0, sliceBytes = 0, setBytes = 0;
  const observe = (view) => {
    const buffer = view.buffer;
    if (buffer.byteLength > 0 && !backings.has(buffer)) {
      backings.add(buffer);
      backingBytes += buffer.byteLength;
    }
    return view;
  };
  const restore = (name, descriptor) => {
    if (descriptor) Object.defineProperty(prototype, name, descriptor);
    else delete prototype[name];
  };
  let packets;
  try {
    globalThis.Uint8Array = new Proxy(Native, {
      construct(target, args) { return observe(Reflect.construct(target, args, target)); },
    });
    Object.defineProperty(prototype, 'slice', {
      configurable: true, writable: true,
      value: function (...args) {
        const output = slice.apply(this, args);
        observe(this); observe(output);
        sliceBytes += output.byteLength;
        return output;
      },
    });
    Object.defineProperty(prototype, 'set', {
      configurable: true, writable: true,
      value: function (source, offset) {
        const result = set.call(this, source, offset);
        observe(this);
        setBytes += source.length;
        return result;
      },
    });
    packets = run();
  } finally {
    globalThis.Uint8Array = Native;
    restore('slice', sliceDescriptor);
    restore('set', setDescriptor);
  }
  assert.equal(globalThis.Uint8Array, Native);
  assert.equal(prototype.slice, slice);
  assert.equal(prototype.set, set);
  return { packets, metrics: { nonemptyBackings: backings.size, backingBytes, sliceBytes, setBytes, copiedBytes: sliceBytes + setBytes } };
}

function boundary(api, testCase, seed) {
  const source = testCase.fixtures[seed];
  if (testCase.kind === 'input') return [api.encodeInput(source)];
  if (testCase.kind === 'ordinary') return source.map((value) => api.encodeSnapshot(value));
  const prepared = api.prepareSnapshotCars(source.cars);
  return source.cars.map((_, own) => api.encodePreparedSnapshot(source, prepared, own));
}

function copyCounts(testCases) {
  const self = instrument(() => {
    const source = new Uint8Array(3);
    const copy = source.slice();
    const target = new Uint8Array(3);
    target.set(copy);
    return [copy, target];
  });
  assert.deepEqual(self.metrics, { nonemptyBackings: 3, backingBytes: 9, sliceBytes: 3, setBytes: 3, copiedBytes: 6 });
  return {
    method: 'Constructor proxy plus Uint8Array slice/set hooks; deduplicated nonempty backing identities and byte capacities.',
    exclusions: 'Scalar DataView writes, zero-byte buffers, module initialization, JavaScript objects, transport copies, and engine heap/GC.',
    sharedEmptyReset: 'Allocated once at module initialization before the hooks; never a per-packet nonempty backing.',
    results: testCases.map((testCase) => {
      const runs = [];
      for (let seed = 0; seed < 3; seed++) {
        const before = instrument(() => boundary(baseline, testCase, seed));
        const after = instrument(() => boundary(candidate, testCase, seed));
        assert.equal(after.packets.length, before.packets.length);
        after.packets.forEach((packet, i) => {
          assert.deepEqual(packet, before.packets[i], testCase.name + ': instrumented bytes');
          exactBuffer(packet, testCase.name);
        });
        for (const [name, result] of [['baseline', before], ['candidate', after]]) {
          const [nonemptyBackings, backingBytes, sliceBytes, setBytes] = testCase.expected[name];
          assert.deepEqual(result.metrics, {
            nonemptyBackings, backingBytes, sliceBytes, setBytes, copiedBytes: sliceBytes + setBytes,
          }, testCase.name + ': ' + name + ' copy/backing counts');
        }
        runs.push({
          seed, packetLengths: after.packets.map((packet) => packet.length),
          baseline: before.metrics, candidate: after.metrics,
        });
      }
      return { name: testCase.name, unit: testCase.kind === 'input' ? 'one packet' : 'one recipient boundary', runs };
    }),
  };
}

try {
  ({ baseline, candidate, provenance: report.provenance } = await variants(entry, ['src/net/bytes.ts', 'src/net/codec.ts']));
  report.correctness = verify();
  const testCases = cases();
  // Time pristine built-ins before installing any allocation/copy hooks.
  report.timings = pairedTimings(testCases);
  report.copyCounts = copyCounts(testCases);
  report.status = 'passed';
  report.statusMeaning = 'Exact-byte, ownership, and deterministic copy/backing assertions passed; timing is descriptive only.';
  report.runtime = { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
  console.log(JSON.stringify(report, null, 2));
  throw error;
}
