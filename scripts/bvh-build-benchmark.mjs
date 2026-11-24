/** Compare only BVH construction with another checkout, in fresh Node processes:
 * node --no-warnings --experimental-transform-types scripts/bvh-build-benchmark.mjs /baseline
 * Uses synthetic triangles/ribbon; never imports a Simulation or changes assets.
 * Startup includes process launch, imports, fixture creation and the first build.
 * Warm timings run without instrumentation; work counts are collected afterward.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const scenarios = ['random-8192', 'random-65537', 'ribbon-229376', 'equal-8192', 'organ-pipe-8192'];

function seeded(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function geometry(scenario) {
  if (scenario === 'ribbon-229376') {
    const rows = 8192,
      columns = 15,
      vertices = new Float64Array(rows * columns * 3),
      indices = new Uint32Array(rows * (columns - 1) * 6);
    for (let row = 0; row < rows; row++) {
      const angle = (row / rows) * Math.PI * 2;
      for (let column = 0; column < columns; column++) {
        const radius = 500 + column - 7,
          at = (row * columns + column) * 3;
        vertices[at] = Math.cos(angle) * radius;
        vertices[at + 1] = 12 * Math.sin(3 * angle) + column * 0.03;
        vertices[at + 2] = Math.sin(angle) * radius;
        if (column < columns - 1) {
          const first = row * columns + column,
            next = ((row + 1) % rows) * columns + column,
            index = (row * (columns - 1) + column) * 6;
          indices.set([first, next, first + 1, first + 1, next, next + 1], index);
        }
      }
    }
    return [vertices, indices];
  }
  const count = Number(scenario.slice(scenario.lastIndexOf('-') + 1)),
    random = seeded(18731),
    vertices = new Float64Array(count * 9),
    indices = Uint32Array.from({ length: count * 3 }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    if (scenario.startsWith('equal')) {
      const size = 1 + (i % 19);
      vertices.set([size, 0, 0, -size, size, -size, 0, -size, size], i * 9);
    } else {
      const randomGeometry = scenario.startsWith('random'),
        x = randomGeometry ? random() * 1000 : Math.min(i, count - i),
        y = randomGeometry ? random() * 20 : 0,
        z = randomGeometry ? random() * 1000 : 0;
      vertices.set([x, y, z, x + 1, y, z, x, y, z + 1], i * 9);
    }
  }
  return [vertices, indices];
}

/** Hash every binary node field and every ordered triangle ID. This preserves
 * signed zero and avoids serializing a large hierarchy into timing output. */
function hierarchyHash(tree) {
  const hash = createHash('sha256'),
    fields = new Float64Array(10),
    bytes = Buffer.from(fields.buffer);
  for (const node of tree.nodes) {
    fields.set(node.min, 0);
    fields.set(node.max, 3);
    fields[6] = node.left;
    fields[7] = node.right;
    fields[8] = node.start;
    fields[9] = node.end;
    hash.update(bytes);
  }
  const order = Uint32Array.from({ length: tree.indices.length / 3 }, (_, i) =>
    tree.orderedTriangle(i),
  );
  hash.update(Buffer.from(order.buffer));
  return hash.digest('hex');
}

function measureWork(BVH, fixture) {
  const prototype = BVH.prototype,
    build = prototype.build,
    compare = prototype.compare,
    heapSort = prototype.heapSort,
    slice = Array.prototype.slice,
    sort = Array.prototype.sort,
    work = {
      temporaryRanges: 0,
      copiedIDsIntoRanges: 0,
      nativeSorts: 0,
      comparisons: 0,
      sortWrites: 0,
      orderWrites: 0,
      heapFallbacks: 0,
    };
  try {
    prototype.build = function (...args) {
      if (this.nodes.length === 0)
        this.order = new Proxy(this.order, {
          set(target, key, value) {
            if (key !== 'length') work.orderWrites++;
            return Reflect.set(target, key, value);
          },
        });
      return build.apply(this, args);
    };
    if (compare)
      prototype.compare = function (...args) {
        work.comparisons++;
        return compare.apply(this, args);
      };
    if (heapSort)
      prototype.heapSort = function (...args) {
        work.heapFallbacks++;
        return heapSort.apply(this, args);
      };
    Array.prototype.slice = function (...args) {
      const result = slice.apply(this, args);
      work.temporaryRanges++;
      work.copiedIDsIntoRanges += result.length;
      return result;
    };
    Array.prototype.sort = function (comparator) {
      work.nativeSorts++;
      const target = new Proxy(this, {
        set(array, key, value) {
          if (key !== 'length') work.sortWrites++;
          return Reflect.set(array, key, value);
        },
      });
      sort.call(
        target,
        comparator
          ? (a, b) => {
              work.comparisons++;
              return comparator(a, b);
            }
          : undefined,
      );
      return this;
    };
    const tree = new BVH(...fixture);
    return { tree, work };
  } finally {
    prototype.build = build;
    if (compare) prototype.compare = compare;
    if (heapSort) prototype.heapSort = heapSort;
    Array.prototype.slice = slice;
    Array.prototype.sort = sort;
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[values.length >>> 1];

if (process.argv[2] === '--worker') {
  const [, , , root, scenario, mode] = process.argv,
    { TriangleBVH } = await import(pathToFileURL(resolve(root, 'src/simulation/bvh.ts')).href),
    fixture = geometry(scenario);
  if (mode === 'startup') {
    const start = performance.now(),
      tree = new TriangleBVH(...fixture),
      firstBuildMs = performance.now() - start;
    console.log(JSON.stringify({ firstBuildMs, nodes: tree.nodes.length }));
  } else {
    for (let i = 0; i < 3; i++) new TriangleBVH(...fixture);
    const samples = [];
    for (let i = 0; i < 7; i++) {
      global.gc?.();
      const start = performance.now();
      new TriangleBVH(...fixture);
      samples.push(performance.now() - start);
    }
    const { tree, work } = measureWork(TriangleBVH, fixture);
    console.log(
      JSON.stringify({
        triangles: fixture[1].length / 3,
        nodes: tree.nodes.length,
        hierarchySHA256: hierarchyHash(tree),
        warmBuildMs: samples,
        warmMedianMs: median(samples),
        work,
      }),
    );
  }
} else {
  if (process.argv.length !== 3)
    throw new Error('Expected the baseline checkout path as the only argument');
  const current = fileURLToPath(new URL('..', import.meta.url)),
    baseline = resolve(process.argv[2]),
    report = {
      node: process.version,
      current,
      baseline,
      note: 'Synthetic construction only; startup includes fresh process/import/fixture/build.',
      startupSamples: 3,
      warmSamples: 7,
      results: [],
    };
  function run(root, scenario, mode) {
    const start = performance.now(),
      output = execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--expose-gc',
          '--max-old-space-size=128',
          '--experimental-transform-types',
          script,
          '--worker',
          root,
          scenario,
          mode,
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      );
    return { ...JSON.parse(output), startupWallMs: performance.now() - start };
  }
  for (const scenario of scenarios) {
    const startup = { current: [], baseline: [] };
    for (let i = 0; i < 3; i++)
      for (const name of i % 2 ? ['current', 'baseline'] : ['baseline', 'current'])
        startup[name].push(run(name === 'current' ? current : baseline, scenario, 'startup'));
    const before = run(baseline, scenario, 'work'),
      after = run(current, scenario, 'work');
    assert.equal(after.hierarchySHA256, before.hierarchySHA256, `${scenario}: hierarchy changed`);
    delete before.startupWallMs;
    delete after.startupWallMs;
    for (const [name, result] of [
      ['baseline', before],
      ['current', after],
    ]) {
      result.firstBuildMedianMs = median(startup[name].map((sample) => sample.firstBuildMs));
      result.startupWallMedianMs = median(startup[name].map((sample) => sample.startupWallMs));
      result.startup = startup[name];
    }
    report.results.push({ scenario, baseline: before, current: after });
    process.stderr.write(`${scenario}: identical hierarchy and leaf order\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}
