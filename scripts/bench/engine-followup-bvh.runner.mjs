/** Bundled only by engine-followup-bvh.mjs. Git-snapshot imports are intentional. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { getHeapStatistics } from "node:v8";
import * as baseline from "engine-benchmark:baseline-bvh";
import * as current from "engine-benchmark:current-bvh";
import { TireFootprint as BaselineTire } from "engine-benchmark:baseline-tire";
import { TireFootprint as CurrentTire } from "engine-benchmark:current-tire";
import { TrackContactMesh } from "engine-benchmark:contact";
import { Track } from "engine-benchmark:track";
import { circuitDefinition } from "engine-benchmark:circuits";
import { Vec3 } from "engine-benchmark:math";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(
  typeof globalThis.gc,
  "function",
  "Run through the controller with --expose-gc",
);
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const bytes = (array) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const geometryHashes = (mesh) =>
  Object.fromEntries(
    ["vertices", "normals", "indices"].map((name) => [
      name,
      sha256(bytes(mesh[name])),
    ]),
  );
const startTime = new Date().toISOString();
const track = new Track(
  "clear",
  false,
  undefined,
  circuitDefinition(config.id),
);
assert.equal(
  track.circuit.id,
  config.id,
  "Do not silently benchmark a fallback circuit",
);
const mesh =
  config.rows === 8192
    ? new TrackContactMesh(track)
    : new TrackContactMesh(track, config.rows);
assert.equal(mesh.rows, config.rows);
const geometryBefore = geometryHashes(mesh);
const geometry = [
  mesh.vertices,
  mesh.indices,
  mesh.normals,
  mesh.bvh.ownsContact,
];

/** Independently derive leaf extrema from geometry, then union child extrema.
 * This never reuses a node's stored bounds to establish its expected bounds.
 * Also checks the balanced contiguous topology and every permutation element.
 */
function validateTree(tree) {
  const count = tree.indices.length / 3;
  const trianglesSeen = new Uint8Array(count);
  for (let position = 0; position < count; position++) {
    const triangle = tree.orderedTriangle(position);
    assert(Number.isInteger(triangle) && triangle >= 0 && triangle < count);
    assert.equal(trianglesSeen[triangle], 0, `Duplicate triangle ${triangle}`);
    trianglesSeen[triangle] = 1;
  }
  const seen = new Uint8Array(tree.nodes.length);
  let leafCount = 0;
  let depthMaximum = 0;
  let boundValuesChecked = 0;
  function visit(id, start, end, depth) {
    assert(Number.isInteger(id) && id >= 0 && id < tree.nodes.length);
    assert.equal(seen[id], 0, `Duplicate node ${id}`);
    seen[id] = 1;
    const node = tree.nodes[id];
    assert.equal(node.start, start);
    assert.equal(node.end, end);
    depthMaximum = Math.max(depthMaximum, depth);
    const expected = [
      Infinity,
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    let next = id + 1;
    if (end - start <= 8) {
      assert.equal(node.left, -1);
      assert.equal(node.right, -1);
      leafCount++;
      for (let position = start; position < end; position++) {
        const triangle = tree.orderedTriangle(position);
        for (let corner = 0; corner < 3; corner++) {
          const vertex = tree.indices[triangle * 3 + corner] * 3;
          for (let axis = 0; axis < 3; axis++) {
            const value = tree.vertices[vertex + axis];
            expected[axis] = Math.min(expected[axis], value);
            expected[axis + 3] = Math.max(expected[axis + 3], value);
          }
        }
      }
    } else {
      assert.equal(node.left, id + 1);
      const middle = (start + end) >>> 1;
      const left = visit(node.left, start, middle, depth + 1);
      assert.equal(node.right, left.next);
      const right = visit(node.right, middle, end, depth + 1);
      next = right.next;
      for (let axis = 0; axis < 3; axis++) {
        expected[axis] = Math.min(left.bounds[axis], right.bounds[axis]);
        expected[axis + 3] = Math.max(
          left.bounds[axis + 3],
          right.bounds[axis + 3],
        );
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      assert(
        Object.is(node.min[axis], expected[axis]),
        `Node ${id} min ${axis}`,
      );
      assert(
        Object.is(node.max[axis], expected[axis + 3]),
        `Node ${id} max ${axis}`,
      );
      boundValuesChecked += 2;
    }
    return { bounds: expected, next };
  }
  const root = visit(0, 0, count, 0);
  assert.equal(root.next, tree.nodes.length);
  assert(
    seen.every((value) => value === 1),
    "Unreachable node",
  );
  return {
    nodes: tree.nodes.length,
    leaves: leafCount,
    maximumDepth: depthMaximum,
    triangles: count,
    boundValuesChecked,
  };
}

/** Explicit little-endian binary snapshots retain negative zero exactly. */
function snapshot(tree) {
  const nodes = Buffer.allocUnsafe(tree.nodes.length * 64);
  for (let id = 0; id < tree.nodes.length; id++) {
    const node = tree.nodes[id];
    const offset = id * 64;
    for (let axis = 0; axis < 3; axis++) {
      nodes.writeDoubleLE(node.min[axis], offset + axis * 8);
      nodes.writeDoubleLE(node.max[axis], offset + 24 + axis * 8);
    }
    nodes.writeInt32LE(node.left, offset + 48);
    nodes.writeInt32LE(node.right, offset + 52);
    nodes.writeInt32LE(node.start, offset + 56);
    nodes.writeInt32LE(node.end, offset + 60);
  }
  const order = Buffer.allocUnsafe((tree.indices.length / 3) * 4);
  for (let position = 0; position < tree.indices.length / 3; position++)
    order.writeUInt32LE(tree.orderedTriangle(position), position * 4);
  return {
    nodes,
    order,
    hashes: {
      nodes: sha256(nodes),
      order: sha256(order),
      combined: createHash("sha256").update(nodes).update(order).digest("hex"),
    },
  };
}

function compareSnapshots(actual, expected, label) {
  assert(
    actual.nodes.equals(expected.nodes),
    `${label}: node bounds/topology/ranges differ`,
  );
  assert(
    actual.order.equals(expected.order),
    `${label}: ordered triangles differ`,
  );
  assert.deepEqual(actual.hashes, expected.hashes);
}

/** Deterministic real-mesh triangle interiors, seams, vertices and misses. */
function queryTargets() {
  const targets = [];
  const triangleCount = mesh.indices.length / 3;
  for (let i = 0; i < config.querySamples; i++) {
    const triangle = (i * 104729 + 7919) % triangleCount;
    const offsets = [0, 1, 2].map(
      (corner) => mesh.indices[triangle * 3 + corner] * 3,
    );
    const weights =
      i % 8 === 0 ? [1, 0, 0] : i % 8 === 1 ? [0.5, 0.5, 0] : [0.5, 0.25, 0.25];
    const point = [0, 1, 2].map((axis) =>
      offsets.reduce(
        (sum, offset, corner) =>
          sum + weights[corner] * mesh.vertices[offset + axis],
        0,
      ),
    );
    targets.push({ point, triangle, maximum: [0, 2.5, 8, 8][i % 4] });
  }
  return targets;
}
const targets = queryTargets();

function queries(tree, module, TireClass) {
  const output = [];
  const counts = Object.fromEntries(
    ["ray", "vertical", "tire"].map((name) => [
      name,
      { queries: 0, hits: 0, misses: 0, trianglesTested: 0, featureTests: 0 },
    ]),
  );
  const ray = module.rayHit();
  const vertical = module.rayHit();
  const tire = module.rayHit();
  const column = new module.VerticalRayColumn();
  const footprint = new TireClass(tree);
  const down = new Vec3(0, -1, -0);
  const up = new Vec3(0, 1, 0);
  const oblique = new Vec3(0.2, -1, -0.1).normalize();
  const axle = new Vec3(1, 0, 0);
  const origin = new Vec3();
  const target = new Vec3();
  const record = (kind, found, hit, tested, features = 0) => {
    const count = counts[kind];
    count.queries++;
    count[found ? "hits" : "misses"]++;
    count.trianglesTested += tested;
    count.featureTests += features;
    // Include retained output vectors on misses as well as all successful data.
    output.push(
      found ? 1 : 0,
      hit.distance,
      hit.triangle,
      hit.point.x,
      hit.point.y,
      hit.point.z,
      hit.normal.x,
      hit.normal.y,
      hit.normal.z,
      tested,
      features,
    );
  };
  for (const sample of targets) {
    target.set(...sample.point);
    for (const direction of [down, oblique, up]) {
      origin.copy(target).addScaled(direction, -3);
      const found = tree.raycast(origin, direction, sample.maximum, ray);
      record("ray", found, ray, tree.trianglesTested);
    }
    // Same x/z repeats explicitly exercise a reused vertical-column cache.
    for (const height of [3, 2, -1, 3]) {
      origin.copy(target);
      origin.y += height;
      const found = tree.raycastVertical(
        origin,
        sample.maximum,
        vertical,
        column,
      );
      record("vertical", found, vertical, tree.trianglesTested);
    }
    origin.copy(target).addScaled(down, -3);
    for (const prior of [Infinity, 2.7]) {
      const found = footprint.cast(
        origin,
        down,
        sample.maximum,
        0.3,
        0.12,
        axle,
        prior,
        tire,
      );
      record(
        "tire",
        found,
        tire,
        footprint.trianglesTested,
        footprint.featureTests,
      );
    }
  }
  const root = tree.nodes[0];
  origin.set(root.max[0] + 100, root.max[1] + 100, root.max[2] + 100);
  const rayMiss = tree.raycast(origin, down, 10, ray);
  assert.equal(rayMiss, false);
  record("ray", rayMiss, ray, tree.trianglesTested);
  const verticalMiss = tree.raycastVertical(origin, 10, vertical, column);
  assert.equal(verticalMiss, false);
  record("vertical", verticalMiss, vertical, tree.trianglesTested);
  const tireMiss = footprint.cast(
    origin,
    down,
    10,
    0.3,
    0.12,
    axle,
    Infinity,
    tire,
  );
  assert.equal(tireMiss, false);
  record(
    "tire",
    tireMiss,
    tire,
    footprint.trianglesTested,
    footprint.featureTests,
  );
  for (const count of Object.values(counts))
    assert(count.hits > 0 && count.misses > 0);
  const packed = Buffer.allocUnsafe(output.length * 8);
  for (let i = 0; i < output.length; i++)
    packed.writeDoubleLE(output[i], i * 8);
  return {
    packed,
    hash: sha256(packed),
    counts,
    numbersCompared: output.length,
  };
}

// Setup and complete validation are deliberately outside all timed intervals.
const currentValidation = validateTree(mesh.bvh);
const expectedSnapshot = snapshot(mesh.bvh);
const currentQueries = queries(mesh.bvh, current, CurrentTire);
let baselineTree = new baseline.TriangleBVH(...geometry);
const baselineValidation = validateTree(baselineTree);
assert.deepEqual(baselineValidation, currentValidation);
compareSnapshots(
  snapshot(baselineTree),
  expectedSnapshot,
  "Initial baseline/current",
);
const baselineQueries = queries(baselineTree, baseline, BaselineTire);
assert(
  baselineQueries.packed.equals(currentQueries.packed),
  "Sampled query outputs or work counts differ",
);
assert.deepEqual(baselineQueries.counts, currentQueries.counts);
baselineTree = null;
globalThis.gc();

const optionalFile = (filename) => {
  try {
    return readFileSync(filename, "utf8").trim();
  } catch {
    return null;
  }
};
const runtime = {
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  cpuModel: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  availableParallelism: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  cgroup: {
    cpuMax: optionalFile("/sys/fs/cgroup/cpu.max"),
    memoryMax: optionalFile("/sys/fs/cgroup/memory.max"),
    effectiveCpuSet: optionalFile("/sys/fs/cgroup/cpuset.cpus.effective"),
  },
  heapLimitBytes: getHeapStatistics().heap_size_limit,
  execArgv: process.execArgv,
  timer:
    "process.hrtime.bigint; reported milliseconds = integer nanoseconds / 1e6",
};
const samples = [];
const warmups = [];
let measuredPeakRssBytes = process.memoryUsage().rss;
let measuredPeakHeapUsedBytes = process.memoryUsage().heapUsed;
function buildOne(version, phase, pair, position) {
  const Constructor =
    version === "baseline" ? baseline.TriangleBVH : current.TriangleBVH;
  globalThis.gc();
  const before = process.memoryUsage();
  const start = process.hrtime.bigint();
  let tree = new Constructor(...geometry);
  const duration = process.hrtime.bigint() - start;
  const after = process.memoryUsage();
  measuredPeakRssBytes = Math.max(measuredPeakRssBytes, after.rss);
  measuredPeakHeapUsedBytes = Math.max(
    measuredPeakHeapUsedBytes,
    after.heapUsed,
  );
  // All bytes are checked for every constructed tree, after stopping the clock.
  compareSnapshots(
    snapshot(tree),
    expectedSnapshot,
    `${phase}/${pair}/${version}`,
  );
  tree = null;
  return {
    phase,
    pair,
    position,
    version,
    durationNs: duration.toString(),
    milliseconds: Number(duration) / 1e6,
    heapUsedBeforeBytes: before.heapUsed,
    heapUsedAfterBytes: after.heapUsed,
    rssAfterBytes: after.rss,
  };
}
for (const [phase, pairCount, destination] of [
  ["warmup", config.warmupPairs, warmups],
  ["measured", config.measuredPairs, samples],
]) {
  for (let pair = 0; pair < pairCount; pair++) {
    const order = pair % 2 ? ["current", "baseline"] : ["baseline", "current"];
    for (let position = 0; position < order.length; position++)
      destination.push(buildOne(order[position], phase, pair, position));
  }
}
assert.deepEqual(
  geometryHashes(mesh),
  geometryBefore,
  "A build or query mutated fixture geometry",
);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >>> 1] + sorted[sorted.length >>> 1]) / 2;
};
const summarize = (values) => ({
  count: values.length,
  median: median(values),
  minimum: Math.min(...values),
  maximum: Math.max(...values),
});
const baselineSummary = summarize(
  samples
    .filter((sample) => sample.version === "baseline")
    .map((sample) => sample.milliseconds),
);
const currentSummary = summarize(
  samples
    .filter((sample) => sample.version === "current")
    .map((sample) => sample.milliseconds),
);
const pairs = Array.from({ length: config.measuredPairs }, (_, pair) => {
  const oldSample = samples.find(
    (sample) => sample.pair === pair && sample.version === "baseline",
  );
  const newSample = samples.find(
    (sample) => sample.pair === pair && sample.version === "current",
  );
  return {
    pair,
    first: oldSample.position === 0 ? "baseline" : "current",
    baselineMs: oldSample.milliseconds,
    currentMs: newSample.milliseconds,
    savedMs: oldSample.milliseconds - newSample.milliseconds,
    reductionPercent:
      (100 * (oldSample.milliseconds - newSample.milliseconds)) /
      oldSample.milliseconds,
    speedRatio: oldSample.milliseconds / newSample.milliseconds,
  };
});
const result = {
  status: "complete",
  startedAt: startTime,
  finishedAt: new Date().toISOString(),
  runtime,
  fixture: {
    circuit: config.id,
    circuitName: track.circuit.name,
    rows: mesh.rows,
    defaultRowsArgumentUsed: config.rows === 8192,
    columns: mesh.vertices.length / (mesh.rows + 1) / 3,
    vertices: mesh.vertices.length / 3,
    triangles: mesh.indices.length / 3,
    geometryBytes:
      mesh.vertices.byteLength +
      mesh.normals.byteLength +
      mesh.indices.byteLength,
    hashesBefore: geometryBefore,
    hashesAfter: geometryHashes(mesh),
  },
  verification: {
    exact: true,
    baseline: baselineValidation,
    current: currentValidation,
    treeHashes: expectedSnapshot.hashes,
    binaryLayout:
      "Each node: float64LE min[3], max[3], then int32LE left/right/start/end (64 bytes). Order: uint32LE triangle IDs. Query: float64LE found/distance/triangle/point[3]/normal[3]/triangleTests/featureTests (11 numbers).",
    queryTargets: config.querySamples,
    queryCounts: currentQueries.counts,
    querySha256: currentQueries.hash,
    queryNumbersCompared: currentQueries.numbersCompared,
    treesComparedExactly: 2 + warmups.length + samples.length,
    geometryUnchanged: true,
  },
  memory: {
    peakObservedRssBytes: measuredPeakRssBytes,
    peakObservedHeapUsedBytes: measuredPeakHeapUsedBytes,
    maximumResidentSetKiB: process.resourceUsage().maxRSS,
    note: "Observed after builds; maxRSS is the OS process high-water mark and includes untimed setup and checks.",
  },
  warmups,
  samples,
  pairs,
  summary: {
    baselineMs: baselineSummary,
    currentMs: currentSummary,
    ratioOfMedians: baselineSummary.median / currentSummary.median,
    reductionOfMediansPercent:
      (100 * (baselineSummary.median - currentSummary.median)) /
      baselineSummary.median,
    pairedSavedMs: summarize(pairs.map((pair) => pair.savedMs)),
    pairedReductionPercent: summarize(
      pairs.map((pair) => pair.reductionPercent),
    ),
    pairedSpeedRatio: summarize(pairs.map((pair) => pair.speedRatio)),
  },
};
writeFileSync(config.output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `${config.id}/${config.rows}: baseline median ${baselineSummary.median.toFixed(3)} ms [${baselineSummary.minimum.toFixed(3)}, ${baselineSummary.maximum.toFixed(3)}]; current median ${currentSummary.median.toFixed(3)} ms [${currentSummary.minimum.toFixed(3)}, ${currentSummary.maximum.toFixed(3)}]. All checks exact.\n`,
);
