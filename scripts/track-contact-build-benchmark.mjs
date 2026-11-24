/** Benchmark real, unchanged track contact geometry in isolated Node processes.
 *
 * node scripts/track-contact-build-benchmark.mjs --baseline /original/checkout \
 *   --candidate /revised/checkout --output /path/to/report.json
 *
 * Fresh workers load one checkout only, with a 512 MiB old-space limit. The
 * cold contact timer includes geometry generation and BVH construction; warm
 * BVH-only samples reuse the real geometry after the cold measurement. Source
 * fingerprints and binary geometry/tree/query hashes are checked separately
 * from the timers. No production source, venue or graphical asset is modified.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getHeapStatistics } from 'node:v8';

const script = fileURLToPath(import.meta.url);
const scenarios = ['aurel', 'vellamar', 'loirette'];
const coldRepetitions = 3;
const warmRepetitions = 3;
const sourcePaths = [
  'src/core/math.ts',
  'src/simulation/bvh.ts',
  'src/simulation/contact.ts',
  'src/simulation/tire-footprint.ts',
  'src/simulation/track.ts',
  'src/simulation/track-lane-index.ts',
  'src/simulation/circuits.ts',
  'src/simulation/gp-course-edges.ts',
  'src/simulation/gp-corner-shape.ts',
  'src/simulation/racing-line.ts',
  'src/simulation/circuit-catalogue',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function arrayBytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

/** Canonical tagged values retain signed zero, infinities, NaN and omitted
 * optional fields; JSON serialization alone cannot prove those equal. */
function hashValue(hash, value) {
  if (typeof value === 'number') {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleLE(value);
    hash.update('n').update(bytes);
  } else if (typeof value === 'string') {
    hash.update(`s${Buffer.byteLength(value)}:`).update(value);
  } else if (typeof value === 'boolean') hash.update(value ? 't' : 'f');
  else if (value === undefined) hash.update('u');
  else if (value === null) hash.update('z');
  else if (Array.isArray(value)) {
    hash.update(`a${value.length}:`);
    for (const entry of value) hashValue(hash, entry);
  } else {
    const keys = Object.keys(value).sort();
    hash.update(`o${keys.length}:`);
    for (const key of keys) {
      hashValue(hash, key);
      hashValue(hash, value[key]);
    }
  }
}

function hierarchyHashes(tree) {
  const nodes = createHash('sha256');
  const fields = new Float64Array(10);
  const bytes = arrayBytes(fields);
  for (const node of tree.nodes) {
    fields.set(node.min, 0);
    fields.set(node.max, 3);
    fields[6] = node.left;
    fields[7] = node.right;
    fields[8] = node.start;
    fields[9] = node.end;
    nodes.update(bytes);
  }
  const order = Uint32Array.from({ length: tree.indices.length / 3 }, (_, index) =>
    tree.orderedTriangle(index),
  );
  return {
    nodes: tree.nodes.length,
    triangles: order.length,
    nodesSHA256: nodes.digest('hex'),
    leafOrderSHA256: sha256(arrayBytes(order)),
  };
}

function geometryHashes(mesh) {
  return {
    rows: mesh.rows,
    vertices: mesh.vertices.length / 3,
    triangles: mesh.indices.length / 3,
    verticesSHA256: sha256(arrayBytes(mesh.vertices)),
    normalsSHA256: sha256(arrayBytes(mesh.normals)),
    indicesSHA256: sha256(arrayBytes(mesh.indices)),
  };
}

function queryProof(mesh, { Vec3, rayHit, surfaceSample, trackPoint }) {
  const track = mesh.track;
  const p = trackPoint();
  const stations = [
    ...Array.from({ length: 32 }, (_, index) => (index * track.length) / 32),
    track.length - 1e-7,
    track.length - track.pit.entry,
    track.length - track.pit.sectionBefore,
    track.pit.firstBox,
    track.pit.mergeEnd,
  ];
  const groups = new Map();
  function record(kind, input, distance, output, candidates, features = 0) {
    let group = groups.get(kind);
    if (!group) {
      group = {
        hash: createHash('sha256'),
        count: 0,
        finiteHits: 0,
        misses: 0,
        candidateTotal: 0,
        candidateMinimum: Infinity,
        candidateMaximum: 0,
        featureTests: 0,
      };
      groups.set(kind, group);
    }
    hashValue(group.hash, { input, distance, output, candidates, features });
    group.count++;
    if (Number.isFinite(distance)) group.finiteHits++;
    else group.misses++;
    group.candidateTotal += candidates;
    group.candidateMinimum = Math.min(group.candidateMinimum, candidates);
    group.candidateMaximum = Math.max(group.candidateMaximum, candidates);
    group.featureTests += features;
  }
  for (const station of stations) {
    track.at(station, p);
    const offsets = [
      -40,
      -p.width - 4,
      -p.width - 0.55,
      -p.width,
      -p.width + 0.09,
      0,
      p.width - 0.09,
      p.width,
      p.width + 0.55,
      p.width + 4,
      track.pit.side * track.pit.offset,
      40,
    ];
    for (const lateral of offsets) {
      const origin = new Vec3(p.x + p.nx * lateral, p.y + 3, p.z + p.nz * lateral);
      const down = new Vec3(0, -1, 0);
      const oblique = new Vec3(0.12 * p.tx, -1, 0.12 * p.tz).normalize();
      const axle = new Vec3(p.nx, 0, p.nz).normalize();
      const maximum = 7;
      const input = { station, lateral, origin, down, maximum };
      const surface = surfaceSample();
      let distance = mesh.cast(origin, down, maximum, surface);
      record('vertical', input, distance, surface, mesh.bvh.trianglesTested);
      distance = mesh.cast(origin, down, maximum, surface);
      record('vertical-reused-probe', input, distance, surface, mesh.bvh.trianglesTested);
      const heightOnly = surfaceSample();
      distance = mesh.cast(origin, down, maximum, heightOnly, true);
      record('height-only', input, distance, heightOnly, mesh.bvh.trianglesTested);
      const directHit = rayHit();
      const direct = mesh.bvh.raycast(origin, oblique, maximum, directHit);
      record(
        'oblique-bvh',
        { ...input, down: oblique },
        direct ? directHit.distance : Infinity,
        directHit,
        mesh.bvh.trianglesTested,
      );
      const obliqueSurface = surfaceSample();
      distance = mesh.cast(origin, oblique, maximum, obliqueSurface);
      record(
        'oblique-contact',
        { ...input, down: oblique },
        distance,
        obliqueSurface,
        mesh.bvh.trianglesTested,
      );
      for (const [kind, direction, radius, halfWidth] of [
        ['car-tire', down, 0.34, 0.16],
        ['bike-tire-oblique', oblique, 0.31, 0.065],
      ]) {
        const tireSurface = surfaceSample();
        const point = new Vec3();
        distance = mesh.castTire(
          origin,
          direction,
          maximum,
          radius,
          halfWidth,
          axle,
          tireSurface,
          point,
        );
        record(
          kind,
          { ...input, down: direction, radius, halfWidth, axle },
          distance,
          { surface: tireSurface, point, rayCandidates: mesh.bvh.trianglesTested },
          mesh.tireFootprint.trianglesTested,
          mesh.tireFootprint.featureTests,
        );
      }
    }
  }
  return Object.fromEntries(
    [...groups].map(([kind, { hash, ...summary }]) => [
      kind,
      { ...summary, querySHA256: hash.digest('hex') },
    ]),
  );
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
}

function metadata(directory) {
  const files = git(directory, 'ls-files', '--', ...sourcePaths)
    .split('\n')
    .sort();
  return {
    directory,
    commit: git(directory, 'rev-parse', 'HEAD'),
    measuredSourceDirty: git(directory, 'status', '--porcelain', '--', ...sourcePaths) !== '',
    sourceSHA256: Object.fromEntries(
      files.map((file) => [file, sha256(readFileSync(resolve(directory, file)))]),
    ),
  };
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples,
    minimum: sorted[0],
    median: sorted[sorted.length >>> 1],
    maximum: sorted.at(-1),
  };
}

function options() {
  const result = { candidate: fileURLToPath(new URL('..', import.meta.url)) };
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '');
    if (!['baseline', 'candidate', 'output'].includes(key) || !args[index + 1] || seen.has(key))
      throw new Error('Usage: --baseline CHECKOUT [--candidate CHECKOUT] [--output REPORT.json]');
    seen.add(key);
    result[key] = resolve(args[++index]);
  }
  if (!result.baseline) throw new Error('A baseline checkout is required');
  return result;
}

if (process.argv[2] === '--worker') {
  const [, , , root, circuitId, warm] = process.argv;
  const importStart = performance.now();
  const { Track, trackPoint, surfaceSample } = await import(
    pathToFileURL(resolve(root, 'src/simulation/track.ts')).href
  );
  const { TrackContactMesh } = await import(
    pathToFileURL(resolve(root, 'src/simulation/contact.ts')).href
  );
  const { TriangleBVH, rayHit } = await import(
    pathToFileURL(resolve(root, 'src/simulation/bvh.ts')).href
  );
  const { CIRCUITS } = await import(
    pathToFileURL(resolve(root, 'src/simulation/circuits.ts')).href
  );
  const { Vec3 } = await import(pathToFileURL(resolve(root, 'src/core/math.ts')).href);
  const importMs = performance.now() - importStart;
  assert.ok(Object.hasOwn(CIRCUITS, circuitId), `Unknown circuit ${circuitId}`);
  const trackStart = performance.now();
  const track = new Track('clear', false, undefined, CIRCUITS[circuitId]);
  const trackMs = performance.now() - trackStart;
  const rows = track.circuit.samples ? Math.max(8192, Math.ceil(track.length / 0.9)) : 8192;
  const contactStart = performance.now();
  let mesh = new TrackContactMesh(track, rows);
  const contactMs = performance.now() - contactStart;
  const contactReadySinceProcessTimeOriginMs = performance.now();
  const geometry = geometryHashes(mesh);
  const hierarchy = hierarchyHashes(mesh.bvh);
  const queries = queryProof(mesh, { Vec3, rayHit, surfaceSample, trackPoint });
  const warmBVHMs = [];
  if (warm === 'warm') {
    const arrays = [mesh.vertices, mesh.indices, mesh.normals];
    // A builder does not call ownership. Releasing the original mesh avoids
    // retaining two large trees in the worker during repeated construction.
    mesh = null;
    function rebuild(timed) {
      global.gc?.();
      const start = performance.now();
      const tree = new TriangleBVH(...arrays);
      const duration = performance.now() - start;
      assert.deepEqual(hierarchyHashes(tree), hierarchy, 'Warm hierarchy differs from cold');
      if (timed) warmBVHMs.push(duration);
    }
    rebuild(false);
    for (let index = 0; index < warmRepetitions; index++) rebuild(true);
  }
  console.log(
    JSON.stringify({
      circuitId,
      circuitName: track.circuit.name,
      lengthM: track.length,
      trackSamples: track.points.length,
      importMs,
      trackMs,
      contactMs,
      contactReadySinceProcessTimeOriginMs,
      warmBVHMs,
      geometry,
      hierarchy,
      queries,
      memory: {
        heapLimitBytes: getHeapStatistics().heap_size_limit,
        maxRSSKiB: process.resourceUsage().maxRSS,
      },
    }),
  );
} else {
  const args = options();
  const baseline = metadata(args.baseline);
  const candidate = metadata(args.candidate);
  const changedMeasuredSources = [
    ...new Set([...Object.keys(baseline.sourceSHA256), ...Object.keys(candidate.sourceSHA256)]),
  ].filter((file) => baseline.sourceSHA256[file] !== candidate.sourceSHA256[file]);
  assert.deepEqual(changedMeasuredSources, ['src/simulation/bvh.ts'], 'Geometry/source changed');
  const report = {
    version: 1,
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCPUs: cpus().length,
      totalMemoryBytes: totalmem(),
      childOldSpaceMiB: 512,
    },
    methodology: {
      coldRepetitions,
      warmRepetitions,
      warmupRebuilds: 1,
      order: 'Sequential fresh workers, alternating checkout order on every repetition.',
      importMs: 'Dynamic source graph import and module initialization, including the catalogue.',
      trackMs: 'The real clear-weather, non-flat Track constructor, before contact creation.',
      contactMs: 'The first uninstrumented real TrackContactMesh constructor: mesh plus BVH.',
      warmBVHMs:
        'BVH-only rebuilds of those unchanged mesh arrays after one untimed rebuild; GC before each. Only the final cold worker per checkout collects warm samples.',
      processWallMs:
        'Full child lifetime, including hashes, queries, and optional warm samples; not a startup-only metric.',
      contactReadySinceProcessTimeOriginMs:
        'Child performance.now() immediately after the first contact construction; excludes subsequent verification and warm rebuilding.',
      rowRule:
        '8192 unless circuit.samples is set, then max(8192, ceil(track.length / 0.9)), matching Track.cast.',
      proof:
        'SHA-256 of every mesh array, every binary node field, every ordered triangle ID, and tagged binary contact query outputs/counts. No epsilon comparison.',
      scope:
        'Construction measurements on three real paved tracks. No rendering, GPU, FPS, off-road deformation or driving-performance claim.',
    },
    baseline,
    candidate,
    changedMeasuredSources,
    results: [],
  };
  for (const circuitId of scenarios) {
    const samples = { baseline: [], candidate: [] };
    for (let repetition = 0; repetition < coldRepetitions; repetition++) {
      const order = repetition % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      for (const label of order) {
        process.stderr.write(`${circuitId} ${label}: cold ${repetition + 1}/${coldRepetitions}\n`);
        const start = performance.now();
        const output = execFileSync(
          process.execPath,
          [
            '--no-warnings',
            '--expose-gc',
            '--max-old-space-size=512',
            '--experimental-transform-types',
            script,
            '--worker',
            args[label],
            circuitId,
            repetition === coldRepetitions - 1 ? 'warm' : 'cold',
          ],
          { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
        );
        samples[label].push({ ...JSON.parse(output), processWallMs: performance.now() - start });
      }
    }
    const reference = samples.baseline[0];
    for (const sample of [...samples.baseline, ...samples.candidate]) {
      for (const key of [
        'circuitName',
        'lengthM',
        'trackSamples',
        'geometry',
        'hierarchy',
        'queries',
      ])
        assert.deepEqual(sample[key], reference[key], `${circuitId}: ${key} differs`);
    }
    const summaries = {};
    for (const label of ['baseline', 'candidate']) {
      summaries[label] = Object.fromEntries(
        ['importMs', 'trackMs', 'contactMs', 'contactReadySinceProcessTimeOriginMs'].map((key) => [
          key,
          distribution(samples[label].map((sample) => sample[key])),
        ]),
      );
      summaries[label].warmBVHMs = distribution(
        samples[label].flatMap((sample) => sample.warmBVHMs),
      );
    }
    report.results.push({ circuitId, exactEquality: true, summaries, samples });
  }
  for (const [label, directory] of [
    ['baseline', args.baseline],
    ['candidate', args.candidate],
  ])
    assert.deepEqual(
      metadata(directory).sourceSHA256,
      report[label].sourceSHA256,
      `${label} source changed during measurement`,
    );
  report.exactEquality = true;
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, json);
    process.stdout.write(`${args.output}\n`);
  } else process.stdout.write(json);
}
