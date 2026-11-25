import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assert, variants, BASELINE } from './support.mjs';

// Both constructors come from actual repository source. Only input.ts is
// replaced by git-show content at BASELINE in the historical bundle.
const { baseline, candidate, provenance } = await variants(
  [
    "export { ServerInputQueue } from './src/net/input.ts';",
    "export { LIMITS } from './src/net/constants.ts';",
    "export { controls } from './src/simulation/config.ts';",
  ].join('\n'),
  ['src/net/input.ts'],
);
assert.equal(BASELINE, 'dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc');
assert.equal(provenance.baselineRef, BASELINE);
assert.notStrictEqual(baseline.ServerInputQueue, candidate.ServerInputQueue);
assert.deepStrictEqual(baseline.LIMITS, candidate.LIMITS);
assert.equal(candidate.LIMITS.commandTicksMax, 8);
assert.equal(candidate.LIMITS.leadTicksMax, 240);

const MAX_TICK = 0xffffffff;
const SEEDS = [17, 0x1234abcd, 0xfedcba98];
const MIXED_STEPS = 1200;
const WARMUP_BATCHES = 2;
const PAIRED_SAMPLES = 7;

function command(seq, tick, ticks = 1) {
  const n = Number.isFinite(seq) ? Math.abs(Math.trunc(seq)) : 0;
  return Object.freeze({
    seq,
    tick,
    ticks,
    controls: Object.freeze({
      ...candidate.controls(),
      throttle: ((n % 9) + 1) / 10,
      brake: (n % 5) / 8,
      clutch: (n % 7) / 8,
      rearBrake: 0.4,
      steer: ((n % 5) - 2) / 2,
      riderLean: ((n % 9) - 4) / 4,
      shift: (n % 3) - 1,
      ers: n % 3,
      manualClutch: n % 2 === 0,
      reverse: n % 17 === 0,
      drs: n % 3 === 0,
      pit: true,
      overtake: true,
    }),
  });
}
const accept = (commands, now) =>
  Object.freeze({ kind: 'accept', commands: Object.freeze([...commands]), now });
const take = (tick) => Object.freeze({ kind: 'take', tick });
const slack = () => Object.freeze({ kind: 'slack' });
const fixture = (name, operations, extra = {}) =>
  Object.freeze({ name, initialAck: -1, ...extra, operations: Object.freeze(operations) });

function denseSequential() {
  // Match W02E's queue-API workload. This is one public accept() call,
  // not a claim that a 31-command batch fits one encoded network packet.
  const commands = Array.from({ length: 31 }, (_, seq) => command(seq, seq * 8, 8));
  return fixture('dense-sequential', [
    accept(commands, 0),
    ...Array.from({ length: 248 }, (_, tick) => take(tick)),
    slack(),
    slack(),
  ]);
}

function reorderedLate() {
  const later = command(2, 18, 4);
  const first = command(0, 10, 4);
  const overlap = command(1, 12, 8);
  const partial = command(4, 17, 8);
  const resend = command(6, 1000, 2);
  return fixture('reordered-late', [
    accept([later, first, overlap], 10),
    take(10), take(12), take(14), take(18), take(17), take(19),
    accept([overlap], 20),
    accept([partial], 20),
    take(20),
    accept([command(3, 18, 8), command(5, 5, 2)], 20),
    slack(), slack(),
    accept([resend], 20),
    accept([resend], 1000),
    take(21), take(23), take(23), take(0),
    take(24), take(1000), take(1001), take(MAX_TICK),
    slack(), slack(),
  ]);
}

function backwardTake() {
  return fixture('backward-take-and-admission', [
    accept([command(0, 100, 8)], 100),
    take(104), take(103),
    accept([command(1, 4, 8)], 4),
    take(6), take(5), take(7),
    accept([command(2, 0, 2)], 0),
    take(0), take(107), take(106), take(MAX_TICK),
    slack(), slack(),
  ]);
}

function sparseJumps() {
  return fixture('large-sparse-jumps', [
    accept([command(0, 5)], 0),
    accept([command(1, 2_000_000_000)], 2_000_000_000),
    accept([command(2, MAX_TICK - 1)], MAX_TICK - 1),
    take(2_000_000_000),
    take(1_000_000_000),
    accept([command(3, 4)], 4),
    take(4),
    take(MAX_TICK - 1),
    take(MAX_TICK),
    slack(), slack(),
  ]);
}

function wireEndpoints() {
  const head = command(MAX_TICK - 4, MAX_TICK - 12, 2);
  const middle = command(MAX_TICK - 3, MAX_TICK - 10, 8);
  const tail = command(MAX_TICK - 2, MAX_TICK - 2, 2);
  const overlap = command(MAX_TICK - 1, MAX_TICK - 1);
  return fixture('wire-endpoints', [
    accept([middle, head, tail, overlap], MAX_TICK - 12),
    accept([
      command(MAX_TICK, MAX_TICK - 1),
      command(0, MAX_TICK),
      command(1, MAX_TICK - 1, 2),
      command(NaN, MAX_TICK - 10),
      command(0.5, MAX_TICK - 10),
    ], MAX_TICK - 12),
    take(MAX_TICK - 12),
    take(MAX_TICK - 9),
    take(MAX_TICK - 11),
    take(MAX_TICK - 2),
    take(MAX_TICK - 1),
    take(MAX_TICK),
    take(MAX_TICK),
    slack(), slack(),
  ], { initialAck: MAX_TICK - 5 });
}

function seededTrace(seed) {
  let randomState = seed >>> 0;
  const random = (n) => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return Math.floor((randomState / 0x100000000) * n);
  };
  const operations = [];
  const delivered = [];
  let now = 20;
  let nextSeq = 0;
  for (let step = 0; step < MIXED_STEPS; step++) {
    const action = random(10);
    if (action < 5) {
      const batch = [];
      const count = 1 + random(5);
      for (let i = 0; i < count; i++) {
        if (delivered.length && random(5) === 0) {
          batch.push(delivered[random(delivered.length)]);
          continue;
        }
        let seq = nextSeq;
        nextSeq += 1 + (random(8) === 0 ? 1 : 0);
        let tick = Math.max(0, now + random(72) - 18);
        let ticks = 1 + random(8);
        if (random(9) === 0) tick = now + candidate.LIMITS.leadTicksMax + 1;
        if (random(13) === 0) seq += candidate.LIMITS.seqWindow + 32;
        if (step % 53 === 0) ticks = 0;
        const item = command(seq, tick, ticks);
        batch.push(item);
        delivered.push(item);
      }
      // Reorder arrivals without changing the generated commands themselves.
      if (random(2) === 0) batch.reverse();
      operations.push(accept(batch, now));
    } else if (action < 9) {
      if (step % 79 === 0) now = random(400);
      else now += step % 41 === 0 ? 100_000 : 1 + random(5);
      operations.push(take(Math.max(0, now - (random(5) === 0 ? random(50) : 0))));
    } else {
      operations.push(slack());
    }
  }
  operations.push(take(MAX_TICK), slack(), slack());
  return fixture('seeded-' + seed.toString(16), operations, {
    seed,
    generatedSteps: MIXED_STEPS,
  });
}

// Trace generation does not consult either queue: both variants replay the
// exact same immutable operations, including control object identities.
const fixtures = [
  denseSequential(),
  reorderedLate(),
  backwardTake(),
  sparseJumps(),
  wireEndpoints(),
  ...SEEDS.map(seededTrace),
];

function json(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'number') return item;
    if (Number.isNaN(item)) return { number: 'NaN' };
    if (item === Infinity) return { number: '+Infinity' };
    if (item === -Infinity) return { number: '-Infinity' };
    if (Object.is(item, -0)) return { number: '-0' };
    return item;
  });
}
const digest = (value) => createHash('sha256').update(json(value)).digest('hex');

function makeQueue(Queue, workload) {
  const queue = new Queue();
  queue.contiguousSeq = workload.initialAck;
  return queue;
}
function apply(queue, operation) {
  switch (operation.kind) {
    case 'accept': return queue.accept(operation.commands, operation.now);
    case 'take': return queue.take(operation.tick);
    case 'slack': return queue.takeSlack();
    default: throw new Error('Unknown queue operation: ' + operation.kind);
  }
}
function state(queue) {
  return {
    depth: queue.depth,
    remembered: queue.remembered,
    contiguousSeq: queue.contiguousSeq,
    stats: { ...queue.stats },
  };
}

function instrumentPending(queue, label) {
  // TypeScript-private fields remain ordinary properties in these bundles.
  // Instrument only this queue's Map. Do not patch global Map prototypes,
  // replace the Map, modify the algorithms, or instrument the timed runs.
  const pending = queue.pending;
  assert.ok(pending instanceof Map, label + ': pending Map test seam changed');
  const counts = {
    keyIteratorCalls: 0, keyVisits: 0,
    entryIteratorCalls: 0, entryVisits: 0,
    valueIteratorCalls: 0, valueVisits: 0,
    defaultIteratorCalls: 0, defaultIteratorVisits: 0,
    forEachCalls: 0, forEachVisits: 0,
    getCalls: 0, hasCalls: 0, setCalls: 0, deleteCalls: 0,
  };
  let operationWork = 0;
  let operationBudget = Infinity;
  let largestTakeExpiryWork = 0;
  const charge = () => {
    operationWork++;
    assert.ok(
      operationWork <= operationBudget,
      label + ': expiry exceeded twice the starting pending depth; possible unbounded tick walk',
    );
  };
  for (const [method, counter] of [
    ['get', 'getCalls'], ['has', 'hasCalls'], ['set', 'setCalls'], ['delete', 'deleteCalls'],
  ]) {
    const original = pending[method].bind(pending);
    pending[method] = (...args) => {
      counts[counter]++;
      if (method === 'delete') charge();
      return original(...args);
    };
  }
  const iteratorMethods = [
    ['keys', 'keyIteratorCalls', 'keyVisits'],
    ['entries', 'entryIteratorCalls', 'entryVisits'],
    ['values', 'valueIteratorCalls', 'valueVisits'],
    [Symbol.iterator, 'defaultIteratorCalls', 'defaultIteratorVisits'],
  ];
  for (const [method, calls, visits] of iteratorMethods) {
    const original = pending[method].bind(pending);
    pending[method] = (...args) => {
      counts[calls]++;
      const iterator = original(...args);
      const next = iterator.next.bind(iterator);
      iterator.next = (...nextArgs) => {
        const entry = next(...nextArgs);
        if (!entry.done) {
          counts[visits]++;
          charge();
        }
        return entry;
      };
      return iterator;
    };
  }
  const forEach = pending.forEach.bind(pending);
  pending.forEach = (callback, thisArg) => {
    counts.forEachCalls++;
    return forEach((value, key) => {
      counts.forEachVisits++;
      charge();
      callback.call(thisArg, value, key, pending);
    });
  };
  return {
    begin(operation) {
      assert.strictEqual(queue.pending, pending, label + ': pending Map was replaced');
      operationWork = 0;
      // A scan can visit N keys and delete at most N entries. The candidate's
      // numeric branch is chosen only when its inclusive span is <= N.
      // Charging inside each iterator step/delete stops a huge sparse walk
      // promptly, before a timing phase can reach the same regression.
      operationBudget = operation.kind === 'take' ? 2 * pending.size : Infinity;
    },
    end(operation) {
      assert.strictEqual(queue.pending, pending, label + ': pending Map was replaced');
      if (operation.kind === 'take')
        largestTakeExpiryWork = Math.max(largestTakeExpiryWork, operationWork);
    },
    summary() {
      const iterationVisits = counts.keyVisits + counts.entryVisits + counts.valueVisits
        + counts.defaultIteratorVisits + counts.forEachVisits;
      return {
        ...counts,
        iterationVisits,
        expiryWork: iterationVisits + counts.deleteCalls,
        largestTakeExpiryWork,
      };
    },
  };
}

function compare(workload, counted) {
  const original = makeQueue(baseline.ServerInputQueue, workload);
  const revised = makeQueue(candidate.ServerInputQueue, workload);
  const originalWork = counted ? instrumentPending(original, workload.name + '/baseline') : null;
  const revisedWork = counted ? instrumentPending(revised, workload.name + '/candidate') : null;
  const observations = createHash('sha256');
  const methods = { accept: 0, take: 0, slack: 0 };
  let deliveredSlots = 0;
  let firstEdges = 0;
  let missingSlots = 0;
  let maximumDepth = 0;
  let maximumRemembered = 0;
  for (let index = 0; index < workload.operations.length; index++) {
    const operation = workload.operations[index];
    const label = workload.name + ' operation ' + index + ' (' + operation.kind + ')';
    originalWork?.begin(operation);
    const expected = apply(original, operation);
    originalWork?.end(operation);
    revisedWork?.begin(operation);
    const actual = apply(revised, operation);
    revisedWork?.end(operation);
    assert.deepStrictEqual(actual, expected, label + ': returned value');
    const expectedState = state(original);
    assert.deepStrictEqual(state(revised), expectedState, label + ': public state');
    if (operation.kind === 'take') {
      if (expected) {
        assert.strictEqual(actual.controls, expected.controls, label + ': control object identity');
        deliveredSlots++;
        if (expected.first) firstEdges++;
      } else {
        missingSlots++;
      }
    }
    methods[operation.kind]++;
    maximumDepth = Math.max(maximumDepth, original.depth);
    maximumRemembered = Math.max(maximumRemembered, original.remembered);
    observations.update(json({ operation: index, result: expected, state: expectedState }) + '\n');
  }
  assert.equal(original.depth, 0, workload.name + ': final pending drain');
  assert.equal(original.remembered, 0, workload.name + ': final ACK-gap drain');
  return {
    name: workload.name,
    seed: workload.seed ?? null,
    generatedSteps: workload.generatedSteps ?? null,
    operationCount: workload.operations.length,
    methods,
    traceSha256: digest({ initialAck: workload.initialAck, operations: workload.operations }),
    observationsSha256: observations.digest('hex'),
    deliveredSlots,
    firstEdges,
    missingSlots,
    controlReferenceChecks: deliveredSlots,
    maximumDepth,
    maximumRemembered,
    finalState: state(original),
    pendingMapOperations: counted ? {
      baseline: originalWork.summary(),
      candidate: revisedWork.summary(),
    } : null,
  };
}

const comparisons = fixtures.map((workload) => {
  const counted = compare(workload, true);
  const plain = compare(workload, false);
  assert.equal(plain.observationsSha256, counted.observationsSha256,
    workload.name + ': instrumentation changed observations');
  return { ...counted, instrumentationParity: true, compatible: true };
});

const dense = comparisons.find((item) => item.name === 'dense-sequential');
assert.deepStrictEqual({
  slots: dense.deliveredSlots,
  edges: dense.firstEdges,
  baselineKeyVisits: dense.pendingMapOperations.baseline.keyVisits,
  candidateKeyVisits: dense.pendingMapOperations.candidate.keyVisits,
  baselineIterationVisits: dense.pendingMapOperations.baseline.iterationVisits,
  candidateIterationVisits: dense.pendingMapOperations.candidate.iterationVisits,
  baselineDeletes: dense.pendingMapOperations.baseline.deleteCalls,
  candidateDeletes: dense.pendingMapOperations.candidate.deleteCalls,
  appliedTicks: dense.finalState.stats.appliedTicks,
}, {
  slots: 248,
  edges: 31,
  baselineKeyVisits: 30876,
  candidateKeyVisits: 0,
  baselineIterationVisits: 30876,
  candidateIterationVisits: 0,
  baselineDeletes: 248,
  candidateDeletes: 248,
  appliedTicks: 248,
}, 'W02E dense workload did not reproduce; assertion displays observed values');

const sparse = comparisons.find((item) => item.name === 'large-sparse-jumps');
assert.deepStrictEqual({
  baselineKeyVisits: sparse.pendingMapOperations.baseline.keyVisits,
  candidateKeyVisits: sparse.pendingMapOperations.candidate.keyVisits,
  baselineDeletes: sparse.pendingMapOperations.baseline.deleteCalls,
  candidateDeletes: sparse.pendingMapOperations.candidate.deleteCalls,
}, {
  baselineKeyVisits: 7,
  candidateKeyVisits: 4,
  baselineDeletes: 4,
  candidateDeletes: 4,
}, 'Sparse fallback/rewind operation counts changed');

const reordered = comparisons.find((item) => item.name === 'reordered-late');
assert.equal(reordered.finalState.stats.late, 1);
assert.equal(reordered.finalState.stats.lateTicks, 5);
assert.equal(reordered.finalState.stats.duplicates, 2);
assert.equal(reordered.finalState.stats.rejected, 1);
assert.equal(
  comparisons.find((item) => item.name === 'wire-endpoints').finalState.stats.rejected,
  5,
);

// Timed passes use fresh, uninstrumented instances. This checksum consumes
// public results cheaply; exact controls, identities, counters and ACKs were
// already compared operation by operation above. Construction, dispatch and
// checksum overhead are included, so this is workload time, not take()-only.
function timedBatch(Queue, workload, repetitions) {
  let checksum = 0;
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const queue = makeQueue(Queue, workload);
    for (const operation of workload.operations) {
      const result = apply(queue, operation);
      let token;
      if (operation.kind === 'take') {
        token = result
          ? (result.first ? 3 : 1) + Math.round(result.controls.throttle * 65535)
          : 0;
      } else {
        token = Number.isFinite(result) ? result : 0x7fffffff;
      }
      checksum = (Math.imul(checksum, 33) ^ token) >>> 0;
    }
    checksum = (checksum + queue.contiguousSeq + queue.depth + queue.remembered
      + queue.stats.appliedTicks + queue.stats.rejected + queue.stats.duplicates) >>> 0;
  }
  return checksum;
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}
function measure(workload) {
  const repetitions = Math.max(1, Math.min(64, Math.floor(4096 / workload.operations.length)));
  for (let warmup = 0; warmup < WARMUP_BATCHES; warmup++) {
    const order = warmup % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const checksums = {};
    for (const variant of order) {
      const Queue = variant === 'baseline' ? baseline.ServerInputQueue : candidate.ServerInputQueue;
      checksums[variant] = timedBatch(Queue, workload, repetitions);
    }
    assert.equal(checksums.candidate, checksums.baseline, workload.name + ': warmup checksum');
  }
  const samples = [];
  for (let sample = 0; sample < PAIRED_SAMPLES; sample++) {
    const order = sample % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    const elapsed = {};
    const checksums = {};
    for (const variant of order) {
      const Queue = variant === 'baseline' ? baseline.ServerInputQueue : candidate.ServerInputQueue;
      const start = performance.now();
      checksums[variant] = timedBatch(Queue, workload, repetitions);
      elapsed[variant] = performance.now() - start;
    }
    assert.equal(checksums.candidate, checksums.baseline, workload.name + ': timed checksum');
    samples.push({
      order,
      baselineMs: elapsed.baseline,
      candidateMs: elapsed.candidate,
      checksum: checksums.baseline,
    });
  }
  const baselineMsPerReplay = distribution(samples.map((item) => item.baselineMs / repetitions));
  const candidateMsPerReplay = distribution(samples.map((item) => item.candidateMs / repetitions));
  return {
    name: workload.name,
    replaysPerBatch: repetitions,
    operationsPerBatch: repetitions * workload.operations.length,
    samples,
    baselineMsPerReplay,
    candidateMsPerReplay,
    baselineOverCandidateMedianRatio: candidateMsPerReplay.median > 0
      ? baselineMsPerReplay.median / candidateMsPerReplay.median
      : null,
  };
}

// Emit exactly one JSON document only after all compatibility/count assertions
// have passed. Assertion failures throw and result in a nonzero Node exit.
console.log(JSON.stringify({
  schemaVersion: 1,
  probe: 'server-input-queue',
  status: 'passed',
  provenance,
  methodology: {
    baseline: 'actual git-show input.ts at BASELINE; other imports resolve from candidate checkout',
    compatibility: 'every return, control reference, public ACK/depth/remembered/stats; explicit slack/reset calls',
    counts: 'instance-only pending Map instrumentation; no seen/ACK Map counts',
    expiryBudget: 'each instrumented take permits at most twice its starting pending depth in iteration visits plus delete calls',
    timing: 'fresh uninstrumented queue replay including construction, dispatch and checksum; excludes bundling, assertions, hashes and counters',
    clock: 'node:perf_hooks.performance.now',
    warmupBatchesPerVariant: WARMUP_BATCHES,
    pairedSamples: PAIRED_SAMPLES,
    traceSeeds: SEEDS,
    generatedStepsPerSeed: MIXED_STEPS,
    timingThreshold: null,
    scope: 'queue workloads only; no whole-engine, network latency, frame rate, allocation or GC claim',
  },
  comparisons,
  timings: fixtures.map(measure),
}));
