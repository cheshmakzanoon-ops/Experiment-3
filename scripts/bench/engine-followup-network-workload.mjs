/** Loaded only through the companion esbuild runner. Synthetic fixtures supply
 * fixed data; all measured server/capture/ranking/codec/queue methods are real.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import * as baseline from 'baseline-engine';
import * as current from 'current-engine';

const { settings, metadata } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const count = 12;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function optionalFile(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}
function makeFixture(
  engine,
  recipients,
  { record = false, instrument = false, event = false } = {},
) {
  const loop = { now: 1000, every: () => () => {}, after: () => () => {} };
  const server = new engine.RaceServer({ loop, lobby: {}, autoStart: false });
  const sim = {
    tick: 120,
    cars: Array.from({ length: count }, (_, car) => ({
      body: {
        position: { x: car * 1.25 - 90, y: car * 0.17, z: 250 - car * 2.125 },
        orientation: { x: 0, y: Math.sin(car / 8), z: 0, w: Math.cos(car / 8) },
        velocity: { x: -2.123 * car, y: 0.125 * car, z: 16.789 * car },
        omega: { x: 0.133 * car, y: -0.234 * car, z: 0.999 * car },
      },
      inPit: car % 5 === 1,
      retired: car % 7 === 2,
      finishTime: car % 5 === 3 ? 90 : 0,
      pitRequested: car % 6 === 4,
      drsOpen: car % 2 === 1,
      steer: car / 7 - 0.8,
      throttle: car / 9,
      brake: car / 11,
      gear: car - 2,
      rpm: 1234 + car * 1500,
      s: 123.456 + car * 77,
    })),
    race: {
      phase: engine.PHASE.RACING,
      time: 11.125,
      order: Array.from({ length: count }, (_, car) => count - car - 1),
      laps: Array.from({ length: count }, (_, car) => ({ completed: car })),
    },
  };
  const contact = Uint8Array.from({ length: count }, (_, car) => Number(car % 2 === 0));
  const world = Object.assign(Object.create(engine.AuthoritativeWorld.prototype), {
    sim,
    drivers: Array.from({ length: count }, (_, car) => ({ mode: car % 3 ? 'human' : 'ai' })),
    history: Float64Array.from({ length: count * 12 }, (_, index) => index * 0.02345),
    contact,
    journal: [],
  });
  server.world = world;
  server.phase = 'race';
  server.scratch = Array.from({ length: count }, (_, car) => engine.emptyCarState(car));
  const peers = Array.from({ length: recipients }, (_, car) => {
    const packets = [];
    const sink = { packets: 0, bytes: 0, checksum: 0 };
    const transport = {
      label: `synthetic-inert-peer-${car}`,
      open: true,
      onMessage: null,
      onClose: null,
      send(data, channel) {
        sink.packets++;
        sink.bytes += data.length;
        sink.checksum =
          (sink.checksum +
            data.length +
            data[0] +
            data[data.length >> 1] +
            data[data.length - 1]) >>>
          0;
        if (record) packets.push({ data, channel });
      },
      close() {},
    };
    const player = {
      id: `bench-${car}`,
      car,
      ghost: car % 4 === 1,
      queue: new engine.ServerInputQueue(),
      missingWindow: car * 25,
      connection: null,
    };
    const connection = {
      id: car + 1,
      closed: false,
      player,
      transport,
      echo: 0xffffffff - car * 19,
      echoAt: 999.5 - car * 33,
    };
    player.connection = connection;
    server.players.set(player.id, player);
    server.connections.add(connection);
    server.byCar[car] = player;
    if (car)
      player.queue.accept(
        Array.from({ length: car + 1 }, (_, seq) => ({
          seq,
          tick: sim.tick + car - 3 + seq,
          ticks: 1,
          controls: engine.controls(),
        })),
        sim.tick,
      );
    return { packets, sink, transport, player };
  });
  const firstEvent = { type: 'lap', car: 0, lap: 1, time: 80, valid: true, tick: 120 };
  if (event) server.emit(firstEvent);
  const calls = { capture: 0, rank: 0, acceleration: 0, clearContacts: 0 };
  if (instrument) {
    for (const method of ['capture', 'acceleration', 'clearContacts']) {
      const original = world[method];
      world[method] = function (...args) {
        calls[method]++;
        return original.apply(this, args);
      };
    }
    const indexOf = sim.race.order.indexOf;
    sim.race.order.indexOf = function (...args) {
      calls.rank++;
      return indexOf.apply(this, args);
    };
  }
  return { server, world, sim, contact, peers, calls, firstEvent };
}

function snapshots(peer) {
  return peer.packets
    .filter(({ channel }) => channel === 'unreliable')
    .map(({ data, channel }) => {
      const decoded = current.decodeServerMessage(data, channel);
      assert.equal(decoded.ok, true);
      assert.equal(decoded.value.type, 'snapshot');
      return decoded.value.snapshot;
    });
}
function events(peer) {
  return peer.packets
    .filter(({ channel }) => channel === 'reliable')
    .flatMap(({ data, channel }) => {
      const decoded = current.decodeServerMessage(data, channel);
      assert.equal(decoded.ok, true);
      assert.equal(decoded.value.type, 'control');
      assert.equal(decoded.value.control.kind, 'events');
      return decoded.value.control.events;
    });
}
function validateSnapshots(recipients) {
  const old = makeFixture(baseline, recipients, { record: true, instrument: true, event: true });
  const next = makeFixture(current, recipients, { record: true, instrument: true, event: true });
  old.server.snapshot();
  next.server.snapshot();
  assert.deepEqual(old.calls, {
    capture: count * recipients,
    rank: count * recipients,
    acceleration: recipients,
    clearContacts: 1,
  });
  assert.deepEqual(next.calls, {
    capture: recipients ? count : 0,
    rank: recipients ? count : 0,
    acceleration: recipients,
    clearContacts: 1,
  });
  const result = {
    recipients,
    cars: count,
    firstBatchCalls: { baseline: { ...old.calls }, current: { ...next.calls } },
    packetLengths: next.peers.map((peer) =>
      peer.packets.map(({ data, channel }) => ({ channel, bytes: data.length })),
    ),
    snapshotSha256ByRecipient: [],
    recipientFullIds: [],
  };
  for (let recipient = 0; recipient < recipients; recipient++) {
    assert.deepEqual(next.peers[recipient].packets, old.peers[recipient].packets);
    const decoded = snapshots(next.peers[recipient])[0];
    const full = decoded.cars
      .filter((car) => car.flags & current.CAR_FLAG.FULL)
      .map((car) => car.id);
    assert.deepEqual(full, [recipient]);
    result.recipientFullIds.push(full);
    result.snapshotSha256ByRecipient.push(sha256(next.peers[recipient].packets[0].data));
    assert.equal(next.peers[recipient].player.missingWindow, 0);
    assert.equal(next.peers[recipient].player.queue.takeSlack(), Infinity);
  }
  assert.equal(next.contact.some(Boolean), false);
  assert.equal(old.contact.some(Boolean), false);
  assert.deepEqual(next.server.pendingEvents, []);
  assert.equal(next.server.stats.snapshotsSent, recipients);
  const retained = next.peers.map((peer) => peer.packets.map(({ data }) => Uint8Array.from(data)));
  old.sim.tick = next.sim.tick = 126;
  old.sim.race.time = next.sim.race.time = 11.175;
  for (let car = 0; car < count; car++) {
    old.sim.cars[car].body.position.x += car * 0.03;
    next.sim.cars[car].body.position.x += car * 0.03;
  }
  old.server.snapshot();
  next.server.snapshot();
  for (let recipient = 0; recipient < recipients; recipient++) {
    assert.deepEqual(next.peers[recipient].packets, old.peers[recipient].packets);
    retained[recipient].forEach((data, index) =>
      assert.deepEqual(next.peers[recipient].packets[index].data, data),
    );
    const decoded = snapshots(next.peers[recipient])[1];
    assert.deepEqual(
      decoded.cars.filter((car) => car.flags & current.CAR_FLAG.FULL).map((car) => car.id),
      [recipient],
    );
    assert.equal(
      decoded.cars.some((car) => car.flags & current.CAR_FLAG.CONTACT),
      false,
    );
  }
  const all = next.peers.flatMap((peer) =>
    peer.packets.filter(({ channel }) => channel === 'unreliable'),
  );
  assert.equal(new Set(all.map(({ data }) => data.buffer)).size, recipients * 2);
  const copies = all.map(({ data }) => Uint8Array.from(data));
  if (all.length) {
    all[0].data.fill(0);
    for (let i = 1; i < all.length; i++) assert.deepEqual(all[i].data, copies[i]);
  }
  return {
    ...result,
    exactBytesAcrossTwoBatches: true,
    independentSnapshotBuffers: recipients * 2,
    retainedPacketsUnchanged: true,
  };
}

function validateReentrancy() {
  const fixture = makeFixture(current, 2, { record: true, instrument: true, event: true });
  const reference = makeFixture(baseline, 2, { record: true, event: true });
  reference.server.snapshot();
  const peer = fixture.peers[0];
  const send = peer.transport.send;
  const second = { type: 'finish', car: 1, tick: 126 };
  const deferred = { type: 'finish', car: 2, tick: 126 };
  let reenteredCalls = 0;
  peer.transport.send = (data, channel) => {
    send(data, channel);
    if (channel !== 'unreliable') return;
    reenteredCalls++;
    if (reenteredCalls === 1) {
      fixture.sim.tick = 126;
      fixture.sim.race.time += 0.05;
      fixture.sim.cars[1].body.position.x += 100;
      fixture.peers[1].player.connection.echo = 72;
      fixture.peers[1].player.queue.accept(
        [{ seq: 2, tick: 129, ticks: 1, controls: current.controls() }],
        126,
      );
      fixture.contact[1] = 1;
      fixture.server.emit(second);
      data.fill(0);
    } else {
      fixture.contact[2] = 1;
      fixture.peers[1].player.missingWindow = 7;
      fixture.server.emit(deferred);
    }
    fixture.server.snapshot();
  };
  fixture.server.snapshot();
  assert.equal(reenteredCalls, 2);
  assert.deepEqual(fixture.peers[1].packets[0], reference.peers[1].packets[0]);
  const received = snapshots(fixture.peers[1]);
  assert.deepEqual(
    received.map((packet) => packet.tick),
    [120, 126],
  );
  assert.equal(received[0].echo, 0xffffffff - 19);
  assert.equal(received[1].echo, 72);
  assert.equal(received[1].ackSeq, 2);
  assert.equal(received[1].slack, 3);
  assert.equal(received[1].cars[1].x - received[0].cars[1].x, 100);
  assert.notEqual(received[1].cars[1].flags & current.CAR_FLAG.CONTACT, 0);
  assert.deepEqual(events(fixture.peers[1]), [fixture.firstEvent, second]);
  assert.deepEqual(fixture.server.pendingEvents, [deferred]);
  assert.equal(fixture.contact[2], 1);
  assert.equal(fixture.peers[1].player.missingWindow, 7);
  assert.equal(fixture.calls.capture, 24);
  assert.equal(fixture.calls.rank, 24);
  const firstDispatchCalls = { ...fixture.calls };
  peer.transport.send = send;
  fixture.server.snapshot();
  const last = snapshots(fixture.peers[1]).at(-1);
  assert.equal(last.missing, 7);
  assert.notEqual(last.cars[2].flags & current.CAR_FLAG.CONTACT, 0);
  assert.deepEqual(events(fixture.peers[1]), [fixture.firstEvent, second, deferred]);
  return {
    recipients: 2,
    reentrantSendCallsBeforeNextScheduledSnapshot: reenteredCalls,
    firstDispatchCalls,
    firstBatchSurvivesTransportMutation: true,
    nestedPacketsFollowEarlierBatch: true,
    deferredContactEventAndMissingWindowPreserved: true,
    verifiedTicks: [120, 126, 126],
  };
}

function createCorpus() {
  let seed = 0x65f03a19;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const corpus = Array.from({ length: 16384 }, (_, i) => ({
    throttle: random() * 3 - 1,
    brake: random() * 3 - 1,
    clutch: random() * 3 - 1,
    rearBrake: random() * 3 - 1,
    steer: random() * 4 - 2,
    riderLean: random() * 4 - 2,
    shift: random() * 2 - 1,
    ers: i % 3,
    manualClutch: i % 5 === 0,
    reverse: i % 7 === 0,
    drs: i % 11 === 0,
    overtake: i % 13 === 0,
    pit: i % 17 === 0,
  }));
  return { corpus, seed, startSeed: 0x65f03a19 };
}
function encodeControls(engine, input) {
  const writer = new engine.ByteWriter(8);
  engine.writeControls(writer, input);
  return writer.finish();
}
function validateControls(corpus) {
  const digest = createHash('sha256');
  let compared = 0;
  function compare(input) {
    const old = baseline.quantizeControls(input);
    const next = current.quantizeControls(input);
    const wire = encodeControls(current, input);
    const decoded = current.readControls(new current.ByteReader(wire));
    assert.deepEqual(Object.keys(next), Object.keys(decoded));
    for (const key of Object.keys(decoded)) {
      assert.equal(Object.is(old[key], decoded[key]), true, `Baseline changed ${key}`);
      assert.equal(Object.is(next[key], decoded[key]), true, `Current changed ${key}`);
    }
    assert.deepEqual(encodeControls(baseline, input), wire);
    assert.deepEqual(encodeControls(current, next), wire);
    assert.notEqual(next, input);
    digest.update(wire);
    compared++;
  }
  for (const input of corpus) compare(input);
  const randomCount = compared;
  const sample = current.controls();
  for (const field of ['steer', 'throttle', 'brake', 'clutch', 'rearBrake', 'riderLean']) {
    const limit = field === 'steer' ? 32767 : field === 'riderLean' ? 63 : 255;
    const first = field === 'steer' || field === 'riderLean' ? -limit : 0;
    for (let code = first; code <= limit; code++) {
      sample[field] = code / limit;
      compare(sample);
      if (code === limit) continue;
      const boundary = (code + 0.5) / limit;
      for (const offset of [-Number.EPSILON, 0, Number.EPSILON]) {
        sample[field] = boundary + offset;
        compare(sample);
      }
    }
    sample[field] = 0;
  }
  const boundaryCount = compared - randomCount;
  const oddValues = [
    NaN,
    Infinity,
    -Infinity,
    -0,
    -Number.MIN_VALUE,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    undefined,
    null,
    '',
    '0.6',
    'invalid',
    true,
    false,
    [],
    [1],
    {},
  ];
  for (const field of [
    'throttle',
    'brake',
    'clutch',
    'rearBrake',
    'steer',
    'riderLean',
    'shift',
    'ers',
  ])
    for (const value of oddValues) compare({ ...current.controls(), [field]: value });
  for (const field of ['manualClutch', 'reverse', 'drs', 'overtake', 'pit'])
    for (const value of [false, true, undefined, null, 0, 1, '', 'false', [], {}])
      compare({ ...current.controls(), [field]: value });
  const absent = current.controls();
  delete absent.rearBrake;
  delete absent.riderLean;
  delete absent.drs;
  delete absent.overtake;
  compare(absent);
  const unsupported = [];
  for (const field of ['throttle', 'brake', 'clutch', 'rearBrake', 'steer', 'riderLean'])
    for (const value of [1n, Symbol('invalid-control')]) {
      const input = { ...current.controls(), [field]: value };
      assert.throws(() => baseline.quantizeControls(input), TypeError);
      assert.throws(() => current.quantizeControls(input), TypeError);
      assert.throws(() => encodeControls(current, input), TypeError);
      unsupported.push({ field, type: typeof value });
    }
  const input = Object.freeze({ ...current.controls(), throttle: 0.75, riderLean: -0.8 });
  const first = current.quantizeControls(input);
  const second = current.quantizeControls(input);
  assert.notEqual(first, second);
  const before = { ...second };
  first.throttle = 0;
  first.riderLean = 1;
  assert.deepEqual(second, before);
  assert.equal(input.throttle, 0.75);
  return {
    compared,
    randomCount,
    boundaryCount,
    edgeCaseCount: compared - randomCount - boundaryCount,
    wireBytes: compared * 8,
    wireSha256: digest.digest('hex'),
    allFieldsObjectIsEqual: true,
    allReencodedBytesEqual: true,
    independentReturnedObjects: true,
    rejectedUnsupportedRuntimeValues: unsupported,
  };
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = ordered.length >> 1;
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}
function distribution(values) {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}
function pairedSummary(samples, iterations) {
  const before = samples.map((sample) => (sample.baselineMs * 1e6) / iterations);
  const after = samples.map((sample) => (sample.currentMs * 1e6) / iterations);
  return {
    baselineNsPerOperation: distribution(before),
    currentNsPerOperation: distribution(after),
    pairedSpeedup: distribution(samples.map((sample) => sample.baselineMs / sample.currentMs)),
    pairedLatencyReductionPercent: distribution(
      samples.map((sample) => (1 - sample.currentMs / sample.baselineMs) * 100),
    ),
  };
}
function timeCall(call) {
  globalThis.gc?.();
  const start = performance.now();
  const checksum = call();
  const elapsedMs = performance.now() - start;
  return { elapsedMs, checksum };
}
function measurePairs(calls, iterations) {
  for (let warmup = 0; warmup < settings.warmups; warmup++) {
    const order = warmup % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
    for (const role of order) calls[role](iterations);
  }
  const samples = [];
  for (let pair = 0; pair < settings.pairs; pair++) {
    const order = pair % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
    const values = {};
    for (const role of order) values[role] = timeCall(() => calls[role](iterations));
    assert.equal(values.current.checksum, values.baseline.checksum);
    samples.push({
      pair,
      order,
      baselineMs: values.baseline.elapsedMs,
      currentMs: values.current.elapsedMs,
      checksum: values.current.checksum,
    });
  }
  return {
    iterationsPerSample: iterations,
    warmupsPerVariant: settings.warmups,
    pairs: settings.pairs,
    samples,
    summary: pairedSummary(samples, iterations),
  };
}

function measureSnapshots(recipients) {
  const old = makeFixture(baseline, recipients);
  const next = makeFixture(current, recipients);
  // Establish a normal steady boundary: no contact/event/slack latches from
  // fixture initialization remain. No physics stepping occurs in this suite.
  old.server.snapshot();
  next.server.snapshot();
  function run(fixture, iterations) {
    for (const peer of fixture.peers) peer.sink.checksum = 0;
    for (let i = 0; i < iterations; i++) fixture.server.snapshot();
    return fixture.peers.reduce((sum, peer) => (sum + peer.sink.checksum) >>> 0, 0);
  }
  const factor = { 0: 20, 1: 4, 4: 2, 12: 1 }[recipients];
  const iterations = settings.snapshotIterations * factor;
  const result = measurePairs(
    { baseline: (n) => run(old, n), current: (n) => run(next, n) },
    iterations,
  );
  const expected = (settings.warmups + settings.pairs) * iterations * recipients + recipients;
  assert.equal(old.server.stats.snapshotsSent, expected);
  assert.equal(next.server.stats.snapshotsSent, expected);
  assert.equal(
    old.peers.reduce((sum, peer) => sum + peer.sink.packets, 0),
    expected,
  );
  assert.equal(
    next.peers.reduce((sum, peer) => sum + peer.sink.packets, 0),
    expected,
  );
  return {
    recipients,
    cars: count,
    timedOperation:
      'One real RaceServer.snapshot() dispatch including inert transport checksum consumption',
    transport:
      'Synchronous synthetic sink: increments counts and reads length plus three packet bytes; no network, decode, callback reentry or retained data',
    packetsPerVariantIncludingWarmup: expected,
    ...result,
  };
}
function measureControls(corpus) {
  function run(quantize, iterations) {
    let checksum = 0;
    for (let i = 0; i < iterations; i++) {
      const value = quantize(corpus[i & (corpus.length - 1)]);
      checksum +=
        value.throttle +
        value.brake +
        value.clutch +
        value.steer +
        value.riderLean +
        value.rearBrake +
        value.shift +
        value.ers +
        Number(value.manualClutch) +
        Number(value.reverse) +
        Number(value.drs) +
        Number(value.overtake) +
        Number(value.pit);
    }
    return checksum;
  }
  return {
    corpusSize: corpus.length,
    timedOperation:
      'One real quantizeControls() call plus identical consumption of every returned field',
    ...measurePairs(
      {
        baseline: (n) => run(baseline.quantizeControls, n),
        current: (n) => run(current.quantizeControls, n),
      },
      settings.controlIterations,
    ),
  };
}

const startedAt = new Date().toISOString();
const environment = {
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  cpuModel: os.cpus()[0]?.model ?? null,
  visibleLogicalCpus: os.cpus().length,
  availableParallelism: os.availableParallelism(),
  cgroupCpuMax: optionalFile('/sys/fs/cgroup/cpu.max'),
  cgroupMemoryMax: optionalFile('/sys/fs/cgroup/memory.max'),
  nodeExecArgv: process.execArgv,
  v8HeapSizeLimitBytes: getHeapStatistics().heap_size_limit,
};
console.error('Network measurement: validating committed snapshot methods and codec bytes.');
const snapshotEquivalence = [0, 1, 4, 12].map(validateSnapshots);
const reentrantOwnership = validateReentrancy();
const { corpus, seed: finalSeed, startSeed } = createCorpus();
// Check the finite timing inputs first. Exhaustive malformed-runtime probes run
// after timing so their type feedback cannot distort the normal warmed case.
for (const input of corpus)
  assert.deepEqual(current.quantizeControls(input), baseline.quantizeControls(input));
const snapshotTimings = [];
for (const recipients of [0, 1, 4, 12]) {
  console.error(`Network measurement: paired snapshot timing, ${recipients} recipients.`);
  snapshotTimings.push(measureSnapshots(recipients));
}
console.error('Network measurement: paired control quantization timing.');
const controlTiming = measureControls(corpus);
console.error(
  'Network measurement: checking every control code, rounding boundary and runtime edge case.',
);
const controlEquivalence = validateControls(corpus);
console.log(
  JSON.stringify({
    schema: 'engine-followup-network-v1',
    startedAt,
    completedAt: new Date().toISOString(),
    environment,
    metadata,
    settings,
    method: {
      source:
        'Actual baseline/current committed modules bundled by esbuild from git show; no transcription of the old snapshot or quantizer',
      realSnapshotMethods: [
        'RaceServer.snapshot',
        'RaceServer.sendData (current)',
        'AuthoritativeWorld.capture',
        'AuthoritativeWorld.acceleration',
        'AuthoritativeWorld.clearContacts',
        'AuthoritativeWorld.tick getter',
        'Array.indexOf ranking',
        'ServerInputQueue.takeSlack',
        'encodeSnapshot/writeSnapshot/ByteWriter',
      ],
      synthetic:
        'Deterministic twelve-car plain-data boundary and inert event loop/transports; AuthoritativeWorld constructor and physics stepping are omitted',
      excludedFromTimings: [
        'Module loading/bundling',
        'Fixture and corpus construction',
        'Correctness checks and instrumented call counts',
        'Explicit pre-sample full GC',
      ],
      includedInTimings: [
        'Real snapshot/quantizer calls',
        'Ordinary internal allocations and any natural GC',
        'Identical deterministic output-consumption sink',
      ],
      pairing:
        'Alternating baseline/current ordering after equal full-iteration warmups; only one measured workload runs at a time',
      controlValidationOrder:
        'Finite timing corpus compared first; exhaustive boundary and malformed-runtime probes follow timing to avoid contaminating normal numeric JIT feedback',
      snapshots:
        'Steady fixed field with empty events, consumed contacts/slack, independent pre-encoded recipient packets; correctness cases also exercise initial events and latches',
      retention:
        'Two twelve-car boundary fixtures at a time for timing; timed packets/results are consumed without retention',
    },
    sourceLevelAllocationInventoryPerQuantizeCall: {
      baselineTemporaryObjects: [
        'ByteWriter instance',
        'Uint8Array(8) view',
        'Its backing ArrayBuffer',
        'Writer DataView',
        'finish().slice() Uint8Array view',
        'Its new backing ArrayBuffer',
        'ByteReader instance',
        'Reader DataView',
      ],
      currentTemporaryByteStorageObjects: 0,
      returnedControlsObjectPerVariant: 1,
      qualification:
        'Source/spec-level creation-path inventory, not observed heap allocation counts; JIT escape analysis and backing-store implementation may change runtime allocation. Capacity eight avoids ByteWriter growth.',
    },
    corpus: {
      startSeed,
      finalSeed,
      generator:
        'LCG: imul(seed, 1664525) + 1013904223, unsigned 32 bit; mixed finite analog values including clamp cases and periodic flags',
      size: corpus.length,
    },
    snapshotEquivalence,
    reentrantOwnership,
    controlEquivalence,
    snapshotTimings,
    controlTiming,
    limitations: [
      'Microbenchmark of server snapshot dispatch and control normalization; no browser, rendering, FPS, end-to-end tick, real networking or simulation throughput claim.',
      'Field state is representative deterministic test data, not a captured live race. Physics/session construction and joins are outside scope.',
      'Transport is an inert synchronous checksum sink. Latency, bandwidth, socket queues, loss, duplication and reordering are not measured.',
      'The current snapshot path also includes published ownership/reentrancy/failure-containment work. Timing changes cannot be attributed solely to capture/rank count reduction.',
      'The zero-recipient path does no capture or encoding and mostly exposes fixed dispatch overhead.',
      'One process on one shared host with alternating paired samples; ranges are observed variation, not confidence intervals or cross-device predictions.',
      'Explicit GC precedes each measured member outside timing; natural GC during each measured loop remains included.',
      'Source-level temporary-object counts are not measured heap allocations, bytes saved or GC-time reductions.',
      'Reentrant dispatch is correctness-checked separately and is not included in normal throughput timings.',
    ],
  }),
);
