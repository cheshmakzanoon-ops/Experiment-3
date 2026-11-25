/** W08E follow-up of the preserved W07 workload; only the pending-union oracle changes. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ORIGINAL_BASELINE,
  median,
  prepareModule,
  runPaired,
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
    'target-marks': { type: 'string' },
  },
});
for (const name of ['baseline', 'current', 'output'])
  assert(values[name] && isAbsolute(values[name]), `Required: --${name} /absolute/path`);
assert(!existsSync(values.output), 'Refusing to overwrite an existing report');
if (values.measure) {
  assert(values.exclusive, 'Use --exclusive only after the coordinator reserves local compute');
  assert(values.lock && isAbsolute(values.lock), 'Measurement requires an explicit shared --lock');
  assert(/^[a-f0-9]{40}$/.test(values['expected-current'] ?? ''), 'Pin --expected-current');
} else {
  assert(!values.exclusive, 'Smoke must not claim an exclusive reservation');
  assert(!values['target-marks'], '--target-marks is a measurement-only option');
}
const targetMarks = Number(values['target-marks'] ?? 250000);
assert(
  Number.isSafeInteger(targetMarks) && targetMarks >= 1000 && targetMarks <= 2000000,
  'Target marks must be an integer from 1000 through 2000000',
);
const workloadFile = fileURLToPath(import.meta.url);
const SEED = 0x41a71,
  ITEMS = 4096,
  ITEM_SIZE = 3,
  COMPONENTS = ITEMS * ITEM_SIZE,
  FULL_BYTES = COMPONENTS * Float32Array.BYTES_PER_ELEMENT,
  GUARD_PREFIX = 5,
  GUARD_SUFFIX = 3,
  sides = ['baseline', 'current'];
const mark = (first, last) => ({ kind: 0, first, last });
const all = () => ({ kind: 1 });
const publicRange = (first, count) => ({ kind: 2, first, last: first + count - 1 });
const repeats = (count, first, last) => Array.from({ length: count }, () => mark(first, last));
const disjoint = (count) => Array.from({ length: count }, (_, i) => mark(100 + i * 4, 100 + i * 4));
const specifications = [
  { name: 'duplicate-17', actions: repeats(17, 100, 103), bytes: [FULL_BYTES, 48] },
  { name: 'duplicate-1000', actions: repeats(1000, 100, 103), bytes: [FULL_BYTES, 48] },
  {
    name: 'contained-25',
    actions: [mark(100, 111), ...repeats(24, 102, 105)],
    bytes: [FULL_BYTES, 144],
  },
  {
    name: 'adjacent-17',
    actions: Array.from({ length: 17 }, (_, i) => mark(100 + i * 4, 103 + i * 4)),
    bytes: [FULL_BYTES, 816],
  },
  {
    name: 'overlap-17',
    actions: Array.from({ length: 17 }, (_, i) => mark(100 + (i % 4), 103 + (i % 4))),
    bytes: [FULL_BYTES, 84],
  },
  {
    name: 'bridge-at-16',
    actions: [...disjoint(16), mark(100, 160)],
    bytes: [FULL_BYTES, 732],
  },
  ...Array.from({ length: 17 }, (_, i) => ({
    name: `disjoint-${i + 1}`,
    actions: disjoint(i + 1),
    bytes: i < 16 ? [(i + 1) * 12, (i + 1) * 12] : [FULL_BYTES, FULL_BYTES],
  })),
  {
    name: 'full-then-partials',
    actions: [all(), ...repeats(16, 100, 103)],
    bytes: [FULL_BYTES, FULL_BYTES],
  },
  {
    name: 'public-unsorted-then-enclosing',
    actions: [publicRange(900, 3), publicRange(300, 6), publicRange(600, 3), mark(99, 301)],
    bytes: [2436, 2436],
  },
  { name: 'empty-mark', actions: [mark(4, 3)], bytes: [0, 0] },
].map((spec) => ({
  ...spec,
  helperCalls: spec.actions.filter((action) => action.kind !== 2).length,
  versionIncrements: spec.actions.filter(
    (action) => action.kind === 1 || action.last >= action.first,
  ).length,
}));
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const ranges = (attribute) => attribute.updateRanges.map(({ start, count }) => ({ start, count }));

/** This records only a GL boundary. All merging/version decisions stay in actual Three. */
function recordingDriver(WebGLAttributes, record) {
  let bound;
  const transfers = [],
    allocations = [];
  const copy = (_target, offset, array, first = 0, count = array.length - first) => {
    bound.bytes.set(
      new Uint8Array(
        array.buffer,
        array.byteOffset + first * array.BYTES_PER_ELEMENT,
        count * array.BYTES_PER_ELEMENT,
      ),
      offset,
    );
  };
  const gl = {
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    createBuffer: () => ({ bytes: null }),
    bindBuffer: (_target, buffer) => {
      bound = buffer;
    },
    bufferData: (_target, array) => {
      bound.bytes = Uint8Array.from(bytes(array));
      if (record) allocations.push({ bytes: array.byteLength, sourceByteOffset: array.byteOffset });
    },
    // Select instrumentation once, outside run(). Measured copies have no counters or log arrays.
    bufferSubData: record
      ? (_target, offset, array, first = 0, count = array.length - first) => {
          copy(_target, offset, array, first, count);
          transfers.push({
            offset,
            bytes: count * array.BYTES_PER_ELEMENT,
            first,
            count,
            sourceByteOffset: array.byteOffset,
          });
        }
      : copy,
    deleteBuffer: (buffer) => {
      buffer.bytes = null;
    },
  };
  const uploader = new WebGLAttributes(gl);
  return {
    uploader,
    transfers,
    allocations,
    upload: (attribute) => uploader.update(attribute, gl.ARRAY_BUFFER),
    read: (attribute) => Buffer.from(uploader.get(attribute).buffer.bytes),
  };
}

function fixture(BufferAttribute, WebGLAttributes, record, seed) {
  const allocation = new Float32Array(COMPONENTS + GUARD_PREFIX + GUARD_SUFFIX);
  for (let i = 0; i < allocation.length; i++)
    allocation[i] = (((i * 17 + (seed & 1023)) % 8192) - 4096) / 32;
  const array = allocation.subarray(GUARD_PREFIX, GUARD_PREFIX + COMPONENTS);
  const attribute = new BufferAttribute(array, ITEM_SIZE);
  const prefix = Buffer.from(bytes(allocation.subarray(0, GUARD_PREFIX)));
  const suffix = Buffer.from(bytes(allocation.subarray(GUARD_PREFIX + COMPONENTS)));
  const gpu = recordingDriver(WebGLAttributes, record);
  gpu.upload(attribute);
  return { attribute, allocation, prefix, suffix, gpu };
}

function checkGuards(state) {
  assert(
    bytes(state.allocation.subarray(0, GUARD_PREFIX)).equals(state.prefix),
    'Prefix guard changed',
  );
  assert(
    bytes(state.allocation.subarray(GUARD_PREFIX + COMPONENTS)).equals(state.suffix),
    'Suffix guard changed',
  );
  assert.equal(state.attribute.array.byteOffset, GUARD_PREFIX * 4);
}

function componentBounds(action) {
  if (action.kind === 1) return [0, COMPONENTS];
  const size = action.kind === 2 ? 1 : ITEM_SIZE;
  return [action.first * size, (action.last + 1) * size];
}

function writeAction(array, action, step, seed) {
  const [start, end] = componentBounds(action);
  for (let component = start; component < end; component++)
    array[component] = (((component * 11 + step * 31 + (seed & 4095)) % 16384) - 8192) / 16;
}

function applyAction(api, attribute, action) {
  if (action.kind === 0) api.markItems(attribute, action.first, action.last);
  else if (action.kind === 1) api.markAll(attribute);
  else {
    attribute.addUpdateRange(action.first, action.last - action.first + 1);
    attribute.needsUpdate = true;
  }
}

function applyBatch(state) {
  for (const action of state.spec.actions) applyAction(state.api, state.attribute, action);
}

function unionRanges(bits) {
  const result = [];
  for (let i = 0; i < bits.length; ) {
    if (!bits[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < bits.length && bits[i]) i++;
    result.push({ start, count: i - start });
  }
  return result;
}

function auditCase(api, side, spec, BufferAttribute, WebGLAttributes) {
  const state = fixture(BufferAttribute, WebGLAttributes, true, SEED);
  const { attribute, gpu } = state;
  const rangeArray = attribute.updateRanges;
  const dirty = new Uint8Array(COMPONENTS),
    oracle = new Uint8Array(COMPONENTS);
  const seen = new Set();
  let versions = 0,
    maximumPending = 0,
    helperRangeObjects = 0,
    publicRangeObjects = 0;
  for (const [step, action] of spec.actions.entries()) {
    writeAction(attribute.array, action, step, SEED);
    const [start, end] = componentBounds(action);
    if (end > start) {
      dirty.fill(1, start, end);
      oracle.fill(1, start, end);
      versions++;
    }
    applyAction(api, attribute, action);
    assert.equal(attribute.version, versions, `${spec.name}: exact version per action`);
    assert.equal(attribute.updateRanges, rangeArray, 'Pending array identity changed');
    for (const range of attribute.updateRanges) {
      if (!seen.has(range)) {
        seen.add(range);
        if (action.kind === 2) publicRangeObjects++;
        else helperRangeObjects++;
      }
      assert(Number.isInteger(range.start) && Number.isInteger(range.count));
      assert(range.start >= 0 && range.count > 0 && range.start + range.count <= COMPONENTS);
    }
    maximumPending = Math.max(maximumPending, attribute.updateRanges.length);
    if (action.kind !== 2) assert(attribute.updateRanges.length <= 16);
    const coverage = new Uint8Array(COMPONENTS);
    for (const range of attribute.updateRanges)
      coverage.fill(1, range.start, range.start + range.count);
    for (let i = 0; i < dirty.length; i++)
      assert(!dirty[i] || coverage[i], 'A dirty component was omitted');
    if (side === 'current' && action.kind !== 2) {
      if (unionRanges(oracle).length > 16) oracle.fill(1);
      // The reviewed helper defers canonical ordering below its entry budget.
      // Compare every coverage bit, independently of pending representation.
      assert.deepEqual(coverage, oracle, 'Current union differs from independent bitset');
    }
  }
  const pending = ranges(attribute);
  const originalVersions = attribute.version;
  assert.equal(originalVersions, spec.versionIncrements);
  gpu.upload(attribute);
  assert(gpu.read(attribute).equals(bytes(attribute.array)), `${spec.name}: exact uploaded bytes`);
  assert.deepEqual(attribute.updateRanges, []);
  assert.equal(gpu.uploader.get(attribute).version, originalVersions);
  const caseTransfers = gpu.transfers.slice();
  const uploadedBytes = caseTransfers.reduce((total, item) => total + item.bytes, 0);
  assert.equal(
    uploadedBytes,
    spec.bytes[side === 'baseline' ? 0 : 1],
    `${spec.name}: transfer byte expectation`,
  );
  const publishedBytes = gpu.read(attribute);
  const checksum = sha256(publishedBytes);
  const unchangedStart = gpu.transfers.length;
  api.markItems(attribute, 90, 89);
  gpu.upload(attribute);
  gpu.upload(attribute);
  assert.equal(attribute.version, originalVersions);
  assert.equal(gpu.transfers.length, unchangedStart, 'Unchanged version uploaded');
  // A consumed full range must not poison later narrow publication.
  for (const [step, action] of [mark(70, 70), mark(71, 71)].entries()) {
    writeAction(attribute.array, action, step + 2000, SEED);
    applyAction(api, attribute, action);
  }
  const reusePending = ranges(attribute);
  gpu.upload(attribute);
  assert(gpu.read(attribute).equals(bytes(attribute.array)), 'Exact bytes after narrow reuse');
  const reuse = gpu.transfers.slice(unchangedStart);
  assert.deepEqual(
    reuse.map(({ offset, bytes }) => ({ offset, bytes })),
    [{ offset: 840, bytes: 24 }],
  );
  assert.equal(attribute.version, originalVersions + 2);
  assert.deepEqual(attribute.updateRanges, []);
  checkGuards(state);
  const finalBytes = gpu.read(attribute);
  gpu.uploader.remove(attribute);
  assert.equal(gpu.uploader.get(attribute), undefined);
  return {
    publishedBytes,
    finalBytes,
    report: {
      name: spec.name,
      helperCalls: spec.helperCalls,
      publicCalls: spec.actions.length - spec.helperCalls,
      versionIncrements: originalVersions,
      pending,
      maximumPending,
      checksum,
      uploadedBytes,
      uploadCalls: caseTransfers.length,
      transfers: caseTransfers,
      observedNewPendingRangeObjects: {
        helper: helperRangeObjects,
        public: publicRangeObjects,
        total: seen.size,
      },
      allocationScope:
        'Unique pending range object identities observed after each actual call; excludes splice return arrays, sort/VM allocations, byte sizes, retained heap, and recorder allocations.',
      initialBufferData: gpu.allocations,
      sourceByteOffset: attribute.array.byteOffset,
      rangeArrayIdentityStable: true,
      unchangedVersionUploadCalls: 0,
      reusePending,
      reuseTransfers: reuse,
      exactUploadedBytes: true,
      guardsIntact: true,
      finalChecksum: sha256(finalBytes),
      removed: true,
    },
  };
}

function makeSnapshot(protocol, vehicleIndex, time, z) {
  const { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase } = protocol;
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame[H.TICK] = Math.round(time * 120);
  frame[o + F.QW] = 1;
  frame[o + F.Z] = z;
  frame[o + F.Y] = 1;
  frame[o + F.GEAR] = 2;
  frame[o + F.RPM] = 3000;
  frame[o + F.SPEED] = frame[o + F.VZ] = 25;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('tc1');
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = 2000;
    frame[p + W.SLIP] = 0.5;
    frame[p + W.SLIP_POWER] = 12000;
    frame[p + W.RADIUS] = frame[p + W.LENGTH] = 0.3;
  }
  return frame;
}

async function auditProducer(producerSources, WebGLAttributes) {
  const states = {},
    names = ['position', 'born', 'strength'];
  for (const side of sides) {
    const source = producerSources[side];
    const { FestivalTrails } = await source.load();
    const protocol = await import(
      pathToFileURL(source.identity.files['src/simulation/protocol.ts'].path)
    );
    const { vehicleIndex } = await import(
      pathToFileURL(source.identity.files['src/simulation/vehicles.ts'].path)
    );
    const trail = new FestivalTrails(),
      gpu = recordingDriver(WebGLAttributes, true);
    const attributes = names.map((name) => trail.root.geometry.getAttribute(name));
    attributes.forEach(gpu.upload);
    states[side] = { trail, gpu, attributes, protocol, vehicleIndex, lastTransfer: 0 };
  }
  const checkpoints = [];
  try {
    for (let i = 0; i <= 181; i++) {
      const frames = sides.map((side) =>
        makeSnapshot(states[side].protocol, states[side].vehicleIndex, 2 + i * 0.05, i * 1.28),
      );
      assert(bytes(frames[0]).equals(bytes(frames[1])), 'Producer inputs differ');
      for (const [sideIndex, side] of sides.entries()) {
        const state = states[side];
        state.trail.update(frames[sideIndex], (x, z) => x * 0.07 - z * 0.025);
        for (const attribute of state.attributes) {
          assert(attribute.updateRanges.length <= 16);
          for (const { start, count } of attribute.updateRanges)
            assert(start >= 0 && count > 0 && start + count <= attribute.array.length);
        }
      }
      if (![40, 180, 181].includes(i)) continue;
      const row = { updateIndex: i, snapshotsSoFar: i + 1 };
      for (const side of sides) {
        const { trail, gpu, attributes } = states[side];
        const pending = attributes.map(ranges);
        attributes.forEach(gpu.upload);
        for (const attribute of attributes) {
          assert(
            gpu.read(attribute).equals(bytes(attribute.array)),
            'Producer upload omitted current CPU bytes',
          );
          assert.deepEqual(attribute.updateRanges, []);
          assert.equal(gpu.uploader.get(attribute).version, attribute.version);
        }
        const transfers = gpu.transfers.slice(states[side].lastTransfer);
        states[side].lastTransfer = gpu.transfers.length;
        row[side] = {
          segments: trail.segments,
          drawRange: { ...trail.root.geometry.drawRange },
          pending,
          versions: attributes.map((attribute) => attribute.version),
          uploadCalls: transfers.length,
          uploadedBytes: transfers.reduce((total, transfer) => total + transfer.bytes, 0),
          checksums: attributes.map((attribute) => sha256(gpu.read(attribute))),
        };
      }
      assert.deepEqual(row.baseline.versions, row.current.versions);
      assert.deepEqual(row.baseline.drawRange, row.current.drawRange);
      assert.equal(row.baseline.segments, row.current.segments);
      for (let a = 0; a < names.length; a++)
        assert(
          states.baseline.gpu
            .read(states.baseline.attributes[a])
            .equals(states.current.gpu.read(states.current.attributes[a])),
          'Producer baseline/current bytes differ',
        );
      if (i === 180) {
        assert.equal(states.current.trail.segments, states.current.trail.capacity);
        assert(
          states.current.attributes[1].array.every((born) => born > 2),
          'Ring did not overwrite original birth times',
        );
      }
      if (i === 181) {
        assert(
          row.current.uploadedBytes > 0 && row.current.uploadedBytes < 81920,
          'Producer did not return to narrow publication',
        );
      }
      row.exactBytesEqual = true;
      checkpoints.push(row);
    }
  } finally {
    for (const { trail, gpu, attributes } of Object.values(states)) {
      attributes.forEach((attribute) => gpu.uploader.remove(attribute));
      trail.dispose();
    }
  }
  for (const source of Object.values(producerSources)) source.assertStable();
  return {
    name: 'actual FestivalTrails, same 182 snapshots and publication checkpoints',
    timingsCollected: false,
    checkpoints,
    exactBytesEqual: true,
    limitation:
      'Controlled deferred publication of a real producer, not a claim that a GPU-gated Festival presentation continues posing. No native GL or GPU duration.',
  };
}

async function execute(lock = null) {
  const sources = {},
    producerSources = {},
    sharedSources = {};
  for (const side of sides) {
    sources[side] = await prepareModule({
      root: values[side],
      entry: 'src/rendering/attribute-ranges.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : values['expected-current'],
    });
  }
  // Both helpers receive the same actual installed class and uploader. Their entire
  // static graphs are explicit, stable manifests rather than an assumed lockfile identity.
  for (const [name, entry] of Object.entries({
    BufferAttribute: 'node_modules/three/src/core/BufferAttribute.js',
    WebGLAttributes: 'node_modules/three/src/renderers/webgl/WebGLAttributes.js',
  }))
    sharedSources[name] = await prepareModule({
      root: values.current,
      entry,
      expectedCommit: values['expected-current'],
    });
  assert.equal(
    sources.baseline.identity.dependencyRoot,
    sources.current.identity.dependencyRoot,
    'This controlled comparison requires shared installed dependencies',
  );
  const { BufferAttribute } = await sharedSources.BufferAttribute.load();
  const { WebGLAttributes } = await sharedSources.WebGLAttributes.load();
  const api = {};
  for (const side of sides) api[side] = await sources[side].load();
  const audit = [];
  for (const spec of specifications) {
    const baseline = auditCase(api.baseline, 'baseline', spec, BufferAttribute, WebGLAttributes);
    const current = auditCase(api.current, 'current', spec, BufferAttribute, WebGLAttributes);
    assert(
      baseline.publishedBytes.equals(current.publishedBytes),
      `${spec.name}: main publication byte equality`,
    );
    assert(baseline.finalBytes.equals(current.finalBytes), `${spec.name}: final byte equality`);
    audit.push({
      name: spec.name,
      baseline: baseline.report,
      current: current.report,
      exactBytesEqual: true,
    });
  }
  for (const side of sides)
    producerSources[side] = await prepareModule({
      root: values[side],
      entry: 'src/rendering/open-world/festival-trails.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : values['expected-current'],
    });
  const producer = await auditProducer(producerSources, WebGLAttributes);
  const reports = [];
  for (const scopeName of ['helper', 'mark-and-recording-upload']) {
    for (const spec of specifications) {
      const iterations = values.measure ? Math.ceil(targetMarks / spec.helperCalls) : 2;
      const proof = audit.find((row) => row.name === spec.name);
      const report = await runPaired({
        name: `attributes:${scopeName}:${spec.name}`,
        sources,
        workloadFile,
        seed: SEED,
        purpose: values.measure ? 'measurement' : 'smoke',
        exclusiveCompute: values.measure,
        lock,
        warmupPairs: values.measure ? 3 : 0,
        samplePairs: values.measure ? 9 : 2,
        iterations,
        unitsPerIteration: spec.helperCalls,
        unit: 'helper invocation',
        scope: {
          timedWork:
            scopeName === 'helper'
              ? 'Per batch, clear the pending list and dispatch the actual markItems/markAll calls; the public-range case also dispatches its three public API writes. No producer array writes or uploader in this interval.'
              : 'Per batch, dispatch the same actual marks (and the public case public writes), then actual Three WebGLAttributes.update including merge/version/clearing and the uninstrumented recording boundary byte copy. No producer array writes.',
          setupWork:
            'Allocate a guarded Float32 view and real installed BufferAttribute; prime recording storage; prepare deterministic CPU edits once; all imports and fixtures are outside run().',
          allocationScope:
            'Actual helper and uploader allocations remain inside run(). Recording uploads create Uint8Array source views and copy into existing storage. No timed counters, log entries, hashes, readbacks, assertions, forced GC, or heap instrumentation. Distinct pending-object witnesses are collected in a separate untimed audit.',
          limitations:
            'Synchronous Node CPU workload with loop, dispatch and reset costs; the public API fixture includes three public writes per one helper invocation. Recording-copy cost is not a native driver or GPU duration. No FPS, retained-heap, energy, or hardware claim. Helper-only and uploader scopes must be interpreted independently.',
        },
        prepare({ api, seed }) {
          const state = fixture(BufferAttribute, WebGLAttributes, false, seed);
          for (const [step, action] of spec.actions.entries())
            writeAction(state.attribute.array, action, step, seed);
          return { ...state, api, spec };
        },
        run(state, { iterations }) {
          if (scopeName === 'helper') {
            for (let i = 0; i < iterations; i++) {
              state.attribute.clearUpdateRanges();
              applyBatch(state);
            }
          } else {
            for (let i = 0; i < iterations; i++) {
              applyBatch(state);
              state.gpu.upload(state.attribute);
            }
          }
          return state.attribute.version;
        },
        observe(version, state, { side }) {
          assert.equal(version, spec.versionIncrements * iterations);
          assert.deepEqual(
            ranges(state.attribute),
            scopeName === 'helper' ? proof[side].pending : [],
          );
          if (scopeName === 'helper') state.gpu.upload(state.attribute);
          assert.equal(state.gpu.uploader.get(state.attribute).version, version);
          assert.deepEqual(state.attribute.updateRanges, []);
          checkGuards(state);
          const finalBytes = state.gpu.read(state.attribute);
          assert(
            finalBytes.equals(bytes(state.attribute.array)),
            'Paired sample upload differs from CPU bytes',
          );
          return { bytes: finalBytes, checksum: sha256(finalBytes), version };
        },
        compare(baseline, current) {
          return {
            equal: baseline.version === current.version && baseline.bytes.equals(current.bytes),
            checksums: { baseline: baseline.checksum, current: current.checksum },
            comparedBytes: baseline.bytes.length,
            versions: { baseline: baseline.version, current: current.version },
            exactByteComparison: true,
            exactVersionsAndDirtyBounds: true,
            guardsIntact: true,
          };
        },
        dispose(state) {
          state.gpu.uploader.remove(state.attribute);
        },
      });
      assert.equal(report.equivalence.passed, true);
      report.fixture = {
        name: spec.name,
        helperCallsPerBatch: spec.helperCalls,
        publicCallsPerBatch: spec.actions.length - spec.helperCalls,
        versionsPerBatch: spec.versionIncrements,
      };
      if (values.measure) {
        const baselineNs = report.timing.medianMsPerUnit.baseline * 1e6;
        const currentNs = report.timing.medianMsPerUnit.current * 1e6;
        report.cpuComparison = {
          baselineNsPerHelperInvocation: baselineNs,
          currentNsPerHelperInvocation: currentNs,
          deltaNsPerHelperInvocation: currentNs - baselineNs,
          ratioOfMedians: currentNs / baselineNs,
          medianPairedRatio: median(
            report.samples.map((row) => row.current.elapsedMs / row.baseline.elapsedMs),
          ),
          baselineNsPerBatch: baselineNs * spec.helperCalls,
          currentNsPerBatch: currentNs * spec.helperCalls,
          candidateSlower: currentNs > baselineNs,
          note: 'Every result is retained, including CPU regressions. No subtraction of dispatch/reset/copy overhead or outlier removal.',
        };
      } else report.cpuComparison = null;
      reports.push(report);
    }
  }
  for (const source of [
    ...Object.values(sources),
    ...Object.values(sharedSources),
    ...Object.values(producerSources),
  ])
    source.assertStable();
  const result = {
    schema: 'engine-advancement-attributes/1',
    createdAt: new Date().toISOString(),
    purpose: values.measure ? 'measurement' : 'smoke',
    workloadTimingsCollected: values.measure,
    configuration: {
      attributeItems: ITEMS,
      itemSize: ITEM_SIZE,
      bytes: FULL_BYTES,
      sourceByteOffset: GUARD_PREFIX * 4,
      targetMarksPerSample: values.measure ? targetMarks : null,
      caseCount: specifications.length,
      scopes: ['helper', 'mark-and-recording-upload'],
    },
    sharedInstalledSources: Object.fromEntries(
      Object.entries(sharedSources).map(([name, source]) => [name, source.identity]),
    ),
    producerSources: Object.fromEntries(
      sides.map((side) => [side, producerSources[side].identity]),
    ),
    untimedAudits: audit,
    producer,
    pairedWorkloads: reports,
    passed: true,
    stableSources: true,
    limitations: [
      'Transfer arguments and exact storage copies use the actual installed Three uploader with a recording GL boundary; this is not native GPU execution or GPU time.',
      'Range object witnesses count observed identities, not total allocations, allocated bytes, GC, or retained heap. Current splice return arrays and runtime sort/iterator allocation behavior are not quantified.',
      'Array writes and fixture allocations are outside both timed scopes. Helper scope includes pending-list reset; uploader scope includes actual clearing and JavaScript byte-copy cost.',
      'Source/helper/workload identities are retained, with raw alternating AB/BA warmups and samples. Build/import/setup/observation diagnostics are not workload performance.',
      'Native upload correctness and shared-fence pixel acceptance have separate CI results; this report makes neither a native acceptance nor a physical-hardware claim.',
    ],
  };
  if (!values.measure)
    for (const report of reports) {
      assert.equal(report.timing.validForComparison, false);
      assert.equal(report.timing.medianMs, null);
      for (const row of report.samples)
        for (const side of sides) assert.equal(row[side].elapsedMs, null);
    }
  writeReport(values.output, result);
  process.stdout.write(
    JSON.stringify({
      output: resolve(values.output),
      passed: true,
      workloadTimingsCollected: values.measure,
      cases: specifications.length,
      pairedWorkloads: reports.length,
      checkedPairs: reports.reduce((total, report) => total + report.equivalence.checkedPairs, 0),
      producerCheckpoints: producer.checkpoints.length,
      cpuRegressions: values.measure
        ? reports
            .filter((report) => report.cpuComparison.candidateSlower)
            .map((report) => report.name)
        : null,
    }) + '\n',
  );
}

if (values.measure) await withTimingLock(values.lock, execute);
else await execute();
