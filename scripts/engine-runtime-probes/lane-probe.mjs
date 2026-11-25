import { createHash } from 'node:crypto';
import { assert, variants, BASELINE } from './support.mjs';

const CAPACITY = 2048;
const SOURCE = 'src/simulation/track-lane-index.ts';
const entry = [
  "export { TrackLaneIndex } from './src/simulation/track-lane-index.ts';",
  "export { Track, trackPoint, ROUTE_LAYER_GAP } from './src/simulation/track.ts';",
  "export { circuitDefinition } from './src/simulation/circuits.ts';",
  "export { FIGURE_EIGHT_OVERPASS } from './src/simulation/test-venues.ts';",
].join('\n');

// Only the lane-index dependency is replaced, using actual git-show source.
// Track, geometry and all other dependencies are the same candidate tree.
const { baseline, candidate, provenance } = await variants(entry, [SOURCE]);
assert.equal(BASELINE, 'dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc');
assert.equal(candidate.ROUTE_LAYER_GAP, baseline.ROUTE_LAYER_GAP);
const laneProvenance = provenance.files.find((file) => file.path === SOURCE);
assert.ok(laneProvenance, 'Lane source hashes must be present in provenance');
assert.notEqual(
  laneProvenance.baselineSha256,
  laneProvenance.candidateSha256,
  'The candidate must differ from the original lane-index source',
);
const fields = Object.keys(candidate.trackPoint());
assert.deepStrictEqual(fields, Object.keys(baseline.trackPoint()));
assert.equal(fields.length, 12, 'Update the scalar-count contract if TrackPoint changes');

const laneKey = (x, z) => String(Math.floor(x / 4)) + ',' + String(Math.floor(z / 4));
const coarseKey = (x, z) => String(Math.floor(x / 32)) + ',' + String(Math.floor(z / 32));
// Inspect entries, never Map.keys(): inspection must not inflate the measured count.
const keysOf = (index) => Array.from(index.cells, ([key]) => key);

function instrument(index) {
  const cells = index.cells;
  const originalKeys = cells.keys;
  const originalDelete = cells.delete;
  const counts = { freshMapKeysIterators: 0, deleteCalls: 0, successfulEvictions: 0 };
  Object.defineProperty(cells, 'keys', {
    configurable: true,
    value() {
      counts.freshMapKeysIterators++;
      return originalKeys.call(this);
    },
  });
  Object.defineProperty(cells, 'delete', {
    configurable: true,
    value(key) {
      counts.deleteCalls++;
      const deleted = originalDelete.call(this, key);
      if (deleted) counts.successfulEvictions++;
      return deleted;
    },
  });
  return {
    counts,
    restore() {
      delete cells.keys;
      delete cells.delete;
    },
  };
}

function makePair(venue, capacity) {
  const make = (api) => {
    const circuit =
      venue === 'overpass' ? api.FIGURE_EIGHT_OVERPASS : api.circuitDefinition(venue);
    const track = new api.Track('clear', false, undefined, circuit);
    // Start from a cold actual index on each side. This test-only assignment
    // leaves the production Track.nearest implementation completely intact.
    const index = new api.TrackLaneIndex(track.points, capacity);
    track.laneIndex = index;
    return { api, track, index, out: api.trackPoint(), digest: createHash('sha256') };
  };
  const before = make(baseline);
  const after = make(candidate);
  assert.equal(after.track.length, before.track.length);
  assert.deepStrictEqual(after.track.points, before.track.points);
  assert.deepStrictEqual(Array.from(after.track.hash), Array.from(before.track.hash));
  assert.deepStrictEqual(keysOf(before.index), []);
  assert.deepStrictEqual(keysOf(after.index), []);

  const baselineCounter = instrument(before.index);
  const candidateCounter = instrument(after.index);
  const stats = {
    venue,
    capacity,
    nearestComparisons: 0,
    primaryNearestComparisons: 0,
    explicitOldestHitComparisons: 0,
    exactScalarComparisons: 0,
    primaryExactScalarComparisons: 0,
    candidateArrayComparisons: 0,
    candidateRecordComparisons: 0,
    fallbackIdentityComparisons: 0,
    coarseFallbackReads: 0,
    prunedCandidateReads: 0,
    queriesWithoutCoarseCell: 0,
    negativeCoordinateQueries: 0,
    negativeCoordinateLaneQueries: 0,
    finiteHeightQueries: 0,
    nonfiniteHeightQueries: 0,
    omittedHeightQueries: 0,
    cacheMisses: { baseline: 0, candidate: 0 },
    cacheHits: { baseline: 0, candidate: 0 },
    maximumResidentCells: { baseline: 0, candidate: 0 },
    maximumFifoKeyReferences: 0,
    fifoCheckpoints: 0,
  };
  const bytes = Buffer.allocUnsafe((fields.length + 1) * 8);
  const digestOutput = (side, lateral) => {
    bytes.writeDoubleLE(lateral, 0);
    for (let i = 0; i < fields.length; i++) bytes.writeDoubleLE(side.out[fields[i]], (i + 1) * 8);
    side.digest.update(bytes);
  };

  function checkBound() {
    for (const [name, side] of [
      ['baseline', before],
      ['candidate', after],
    ]) {
      assert.ok(side.index.cells.size <= capacity, name + ' cache exceeded capacity');
      stats.maximumResidentCells[name] = Math.max(
        stats.maximumResidentCells[name],
        side.index.cells.size,
      );
    }
    const ring = after.index.fifoKeys;
    assert.ok(Array.isArray(ring), 'positive integral capacity must use FIFO storage');
    assert.equal(ring.length, after.index.cells.size);
    assert.ok(ring.length <= capacity, 'FIFO retained more than capacity key references');
    assert.ok(Number.isInteger(after.index.fifoCursor));
    assert.ok(after.index.fifoCursor >= 0 && after.index.fifoCursor < capacity);
    stats.maximumFifoKeyReferences = Math.max(stats.maximumFifoKeyReferences, ring.length);
  }

  function checkpoint() {
    checkBound();
    assert.deepStrictEqual(Array.from(after.index.cells), Array.from(before.index.cells));
    const cursor = after.index.fifoCursor;
    const ring = after.index.fifoKeys;
    assert.deepStrictEqual([...ring.slice(cursor), ...ring.slice(0, cursor)], keysOf(after.index));
    stats.fifoCheckpoints++;
  }

  function query(x, z, height, role = 'edge') {
    const key = laneKey(x, z);
    const context = venue + ' query ' + stats.nearestComparisons + ' at ' + key + ' (' + role + ')';
    const baseCoarse = before.track.hash.get(coarseKey(x, z));
    const nextCoarse = after.track.hash.get(coarseKey(x, z));
    assert.equal(nextCoarse !== undefined, baseCoarse !== undefined, context);
    if (baseCoarse !== undefined) {
      for (const [name, side] of [
        ['baseline', before],
        ['candidate', after],
      ]) {
        const hit = side.index.cells.has(key);
        stats[hit ? 'cacheHits' : 'cacheMisses'][name]++;
        if (role === 'primary') assert.equal(hit, false, context + ': expected primary miss');
        if (role === 'oldest-hit') assert.equal(hit, true, context + ': expected resident hit');
      }
    } else {
      stats.queriesWithoutCoarseCell++;
      assert.notEqual(role, 'primary', context + ': primary query must exercise the lane index');
    }
    const expected = before.track.nearest(x, z, before.out, height);
    const actual = after.track.nearest(x, z, after.out, height);
    assert.equal(actual, expected, context + ': lateral');
    assert.deepStrictEqual(Object.keys(after.out), fields, context + ': output fields');
    assert.deepStrictEqual(Object.keys(before.out), fields, context + ': baseline output fields');
    for (const field of fields) assert.equal(after.out[field], before.out[field], context + ': ' + field);
    digestOutput(before, expected);
    digestOutput(after, actual);
    stats.nearestComparisons++;
    stats.exactScalarComparisons += fields.length + 1;
    if (role === 'primary') {
      stats.primaryNearestComparisons++;
      stats.primaryExactScalarComparisons += fields.length + 1;
    }
    if (role === 'oldest-hit') stats.explicitOldestHitComparisons++;
    if (x < 0 || z < 0) stats.negativeCoordinateQueries++;
    if (height === undefined) stats.omittedHeightQueries++;
    else if (Number.isFinite(height)) stats.finiteHeightQueries++;
    else stats.nonfiniteHeightQueries++;

    if (baseCoarse !== undefined) {
      if (x < 0 || z < 0) stats.negativeCoordinateLaneQueries++;
      const baseRecord = before.index.cells.get(key);
      const nextRecord = after.index.cells.get(key);
      assert.ok(baseRecord && nextRecord, context + ': nearest must populate both cells');
      const expectedCandidates = before.index.candidates(
        x, z, baseCoarse, height, baseline.ROUTE_LAYER_GAP,
      );
      const actualCandidates = after.index.candidates(
        x, z, nextCoarse, height, candidate.ROUTE_LAYER_GAP,
      );
      assert.deepStrictEqual(actualCandidates, expectedCandidates, context + ': candidate order');
      assert.equal(actualCandidates === nextCoarse, expectedCandidates === baseCoarse, context + ': fallback identity');
      assert.deepStrictEqual(nextRecord, baseRecord, context + ': segments and witness');
      assert.equal(before.index.cells.get(key), baseRecord, context + ': baseline candidate read must hit');
      assert.equal(after.index.cells.get(key), nextRecord, context + ': candidate read must hit');
      stats.candidateArrayComparisons++;
      stats.candidateRecordComparisons++;
      stats.fallbackIdentityComparisons++;
      if (expectedCandidates === baseCoarse) stats.coarseFallbackReads++;
      if (expectedCandidates.length < baseCoarse.length) stats.prunedCandidateReads++;
    }
    checkBound();
    return { ...after.out };
  }

  function oldestHit(height) {
    const key = keysOf(before.index)[0];
    assert.ok(key !== undefined);
    const [ix, iz] = key.split(',').map(Number);
    const baseOrder = keysOf(before.index);
    const nextOrder = keysOf(after.index);
    const ring = [...after.index.fifoKeys];
    const cursor = after.index.fifoCursor;
    const baseCell = before.index.cells.get(key);
    const nextCell = after.index.cells.get(key);
    query(ix * 4 + 2, iz * 4 + 2, height, 'oldest-hit');
    assert.deepStrictEqual(keysOf(before.index), baseOrder, 'baseline hit changed FIFO order');
    assert.deepStrictEqual(keysOf(after.index), nextOrder, 'candidate hit changed FIFO order');
    assert.deepStrictEqual(after.index.fifoKeys, ring, 'candidate hit changed FIFO storage');
    assert.equal(after.index.fifoCursor, cursor, 'candidate hit advanced FIFO cursor');
    assert.equal(before.index.cells.get(key), baseCell, 'baseline hit rebuilt a cell');
    assert.equal(after.index.cells.get(key), nextCell, 'candidate hit rebuilt a cell');
    checkpoint();
    return key;
  }

  function finish() {
    checkpoint();
    assert.equal(baselineCounter.counts.deleteCalls, baselineCounter.counts.successfulEvictions);
    assert.equal(candidateCounter.counts.deleteCalls, candidateCounter.counts.successfulEvictions);
    assert.equal(
      baselineCounter.counts.successfulEvictions,
      candidateCounter.counts.successfulEvictions,
      'FIFO and baseline must evict the same number of cells',
    );
    assert.equal(
      baselineCounter.counts.freshMapKeysIterators,
      baselineCounter.counts.successfulEvictions,
      'actual Git baseline must create one fresh key iterator per eviction',
    );
    assert.equal(candidateCounter.counts.freshMapKeysIterators, 0);
    const baselineDigest = before.digest.digest('hex');
    const candidateDigest = after.digest.digest('hex');
    assert.equal(candidateDigest, baselineDigest, 'exact output byte digests diverged');
    return {
      ...stats,
      instrumentation: {
        baseline: { ...baselineCounter.counts },
        candidate: { ...candidateCounter.counts },
      },
      finalResidentCells: { baseline: before.index.cells.size, candidate: after.index.cells.size },
      finalFifoKeyReferences: after.index.fifoKeys.length,
      outputSha256: { baseline: baselineDigest, candidate: candidateDigest },
      outputEncoding: 'query order; Float64LE lateral then ' + fields.join(','),
    };
  }

  return {
    before,
    after,
    query,
    oldestHit,
    checkpoint,
    finish,
    restore() {
      baselineCounter.restore();
      candidateCounter.restore();
    },
  };
}

function distinctCells(track, count) {
  const queries = [];
  // Use the same actual hash insertion order and 4 m cell centres as W03D.
  for (const [key] of track.hash) {
    const [hx, hz] = key.split(',').map(Number);
    for (let ix = 0; ix < 8; ix++) {
      for (let iz = 0; iz < 8; iz++) {
        queries.push([hx * 32 + ix * 4 + 2, hz * 32 + iz * 4 + 2]);
        if (queries.length === count) return queries;
      }
    }
  }
  throw new Error('Track has fewer than ' + count + ' lane cells');
}

function productionTrace() {
  const pair = makePair('aurel', CAPACITY);
  try {
    const queries = distinctCells(pair.before.track, CAPACITY * 2);
    assert.equal(new Set(queries.map(([x, z]) => laneKey(x, z))).size, CAPACITY * 2);
    const heights = [undefined, 0.5, 9.5, 100, NaN, Infinity, -Infinity];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let i = 0; i < queries.length; i++) {
        let oldest;
        // Three full-cache transitions hit the oldest resident immediately
        // before a miss. The next insertion must still evict that same key.
        if ((cycle > 0 && i === 0) || i === CAPACITY) oldest = pair.oldestHit(0.5);
        const [x, z] = queries[i];
        pair.query(x, z, heights[i % heights.length], 'primary');
        if (oldest !== undefined) {
          assert.equal(pair.before.index.cells.has(oldest), false, 'baseline promoted a hit');
          assert.equal(pair.after.index.cells.has(oldest), false, 'candidate promoted a hit');
        }
        if (i === CAPACITY - 1 || i === queries.length - 1) pair.checkpoint();
      }
    }
    const result = pair.finish();
    assert.equal(result.primaryNearestComparisons, 8192);
    assert.equal(result.primaryExactScalarComparisons, 106496);
    assert.equal(result.explicitOldestHitComparisons, 3);
    assert.deepStrictEqual(result.cacheMisses, { baseline: 8192, candidate: 8192 });
    assert.deepStrictEqual(result.cacheHits, { baseline: 3, candidate: 3 });
    assert.equal(result.instrumentation.baseline.successfulEvictions, 6144);
    assert.equal(result.instrumentation.candidate.successfulEvictions, 6144);
    assert.equal(result.instrumentation.baseline.freshMapKeysIterators, 6144);
    assert.equal(result.instrumentation.candidate.freshMapKeysIterators, 0);
    assert.deepStrictEqual(result.finalResidentCells, { baseline: CAPACITY, candidate: CAPACITY });
    assert.equal(result.maximumFifoKeyReferences, CAPACITY);
    assert.equal(result.finalFifoKeyReferences, CAPACITY);
    assert.ok(result.coarseFallbackReads > 0, 'height fallback must be exercised');
    return { ...result, distinctLaneCells: queries.length, primaryCycles: 2 };
  } finally {
    pair.restore();
  }
}

function boundaryTrace(venue) {
  const pair = makePair(venue, 2);
  try {
    const gap = candidate.ROUTE_LAYER_GAP;
    const xs = [-4 - 1e-7, -4, -4 + 1e-7, -1e-7, 0, 1e-7, 4];
    const zs = [-32 - 1e-7, -32, -32 + 1e-7, -1e-7, 0, 1e-7];
    const heights = [undefined, 0.5, gap - 0.5e-7, gap, gap + 1e-7, 9.5, 100, NaN, Infinity, -Infinity];
    for (const x of xs) {
      for (const z of zs) {
        for (const height of heights) pair.query(x, z, height);
        pair.checkpoint();
      }
    }
    const bankPoint =
      venue === 'speedbowl'
        ? pair.after.track.points.find((point) => Math.abs(point.bank) > 0.05)
        : pair.after.track.at(0, candidate.trackPoint());
    assert.ok(bankPoint, venue + ' must provide its intended height test point');
    for (const lateral of [-9, 0, 9]) {
      pair.query(
        bankPoint.x + bankPoint.nx * lateral,
        bankPoint.z + bankPoint.nz * lateral,
        bankPoint.y + bankPoint.bank * lateral + 0.4,
      );
    }
    const upper = pair.query(0, 0, 9.5);
    const lower = pair.query(0, 0, 0.5);
    if (venue === 'overpass') assert.ok(upper.y - lower.y > gap, 'both overpass decks must be selected');
    const result = pair.finish();
    assert.equal(result.nearestComparisons, 425);
    assert.ok(result.negativeCoordinateQueries > 0);
    if (venue === 'overpass') assert.ok(result.negativeCoordinateLaneQueries > 0);
    assert.ok(result.finiteHeightQueries > 0);
    assert.ok(result.nonfiniteHeightQueries > 0);
    assert.ok(result.omittedHeightQueries > 0);
    return result;
  } finally {
    pair.restore();
  }
}

const primaryTrace = productionTrace();
const boundaryTraces = ['overpass', 'speedbowl'].map(boundaryTrace);
const allTraces = [primaryTrace, ...boundaryTraces];
const totals = {
  nearestComparisons: allTraces.reduce((sum, trace) => sum + trace.nearestComparisons, 0),
  exactScalarComparisons: allTraces.reduce((sum, trace) => sum + trace.exactScalarComparisons, 0),
};
assert.equal(totals.nearestComparisons, 9045);
assert.equal(totals.exactScalarComparisons, 117585);
console.log(
  JSON.stringify(
    {
      probe: 'lane-cache-actual-git-baseline',
      status: 'passed',
      baselineCommit: BASELINE,
      provenance,
      baselineReplacementPaths: [SOURCE],
      comparisonScope: 'Only TrackLaneIndex source differs; both bundles execute actual candidate-tree Track.nearest and geometry.',
      primaryTrace,
      boundaryTraces,
      totals,
      memoryTradeoff: {
        additionalFifoKeyReferenceBound: CAPACITY,
        observedMaximumFifoKeyReferences: primaryTrace.maximumFifoKeyReferences,
        storage: 'One lazily grown array of resident-key references plus cursor; evicted slots are overwritten.',
        heapBytesMeasured: false,
      },
      measurement: 'Exact-output and structural operation counts only; no clock, FPS, GC or heap-byte result.',
    },
    null,
    2,
  ),
);
