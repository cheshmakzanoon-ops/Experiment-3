/** Compare actual route planners from two checkouts, without changing sources.
 * Default: exact routes and operation counts. --timings also runs paired trials.
 * node --experimental-transform-types scripts/engine-route-benchmark.mjs \
 *   --baseline /path/to/original/checkout [--output report.json] [--timings]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const routeFile = 'src/simulation/open-world/route-path.ts';
const fixtureFiles = ['road-network.ts', 'terrain-field.ts', 'region-data.ts'].map(
  (name) => `src/simulation/open-world/${name}`,
);
const sourceFiles = [routeFile, ...fixtureFiles];
const counterNames = [
  'shortestSearches',
  'settledStates',
  'scanSlots',
  'heapComparisons',
  'inserts',
  'decreases',
  'heapPops',
];

function options() {
  const result = { timings: false },
    args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--timings') result.timings = true;
    else if (['--baseline', '--output'].includes(option) && args[i + 1]) {
      if (result[option]) throw new Error(`Repeated option: ${option}`);
      result[option] = resolve(args[++i]);
    } else
      throw new Error(
        'Usage: node --experimental-transform-types scripts/engine-route-benchmark.mjs --baseline CHECKOUT [--output REPORT.json] [--timings]',
      );
  }
  if (!result['--baseline']) throw new Error('A baseline checkout is required');
  return result;
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function metadata(directory) {
  return {
    commit: git(directory, 'rev-parse', 'HEAD'),
    measuredFilesDirty: git(directory, 'status', '--porcelain', '--', ...sourceFiles) !== '',
    sourceSha256: Object.fromEntries(
      sourceFiles.map((path) => [path, sha256(readFileSync(resolve(directory, path)))]),
    ),
  };
}

/** AST-selected insertions avoid formatting-dependent source replacements.
 * Refuse an unfamiliar implementation instead of silently reporting zero work.
 * Only extra counter statements are inserted into the in-memory source.
 */
function countedSource(source, kind) {
  const file = ts.createSourceFile(
      routeFile,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
    edits = [],
    matched = { shortest: 0, settled: 0, scan: 0, before: 0, update: 0, pop: 0 };
  assert.equal(file.parseDiagnostics.length, 0, 'Route source must parse before instrumentation');
  const normalized = (node) => node.getText(file).replace(/\s+/g, '');
  const insert = (position, text) => edits.push({ position, text });
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'shortest' && node.body) {
      matched.shortest++;
      insert(node.body.getStart(file) + 1, '\n__engineRouteWork.shortestSearches++;\n');
    }
    if (ts.isExpressionStatement(node) && normalized(node) === 'done[u]=1;') {
      matched.settled++;
      insert(node.getStart(file), '__engineRouteWork.settledStates++;\n');
    }
    if (
      kind === 'scan' &&
      ts.isForStatement(node) &&
      node.condition &&
      normalized(node.condition) === 'i<states'
    ) {
      matched.scan++;
      insert(node.statement.getStart(file), '{ __engineRouteWork.scanSlots++; ');
      insert(node.statement.end, ' }');
    }
    if (kind === 'heap' && ts.isClassDeclaration(node) && node.name?.text === 'StateQueue') {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.body) continue;
        const name = member.name.getText(file);
        if (name === 'before') {
          matched.before++;
          insert(member.body.getStart(file) + 1, '\n__engineRouteWork.heapComparisons++;\n');
        } else if (name === 'update') {
          matched.update++;
          insert(
            member.body.getStart(file) + 1,
            '\nif (this.position[state] < 0) __engineRouteWork.inserts++; else __engineRouteWork.decreases++;\n',
          );
        } else if (name === 'pop') {
          matched.pop++;
          insert(
            member.body.getStart(file) + 1,
            '\nif (this.length > 0) __engineRouteWork.heapPops++;\n',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.deepStrictEqual(
    matched,
    kind === 'scan'
      ? { shortest: 1, settled: 1, scan: 1, before: 0, update: 0, pop: 0 }
      : { shortest: 1, settled: 1, scan: 0, before: 1, update: 1, pop: 1 },
    `Unsupported ${kind} planner structure; review the instrumentation`,
  );
  for (const { position, text } of edits.sort((a, b) => b.position - a.position))
    source = source.slice(0, position) + text + source.slice(position);
  return (
    `export const __engineRouteWork = ${JSON.stringify(Object.fromEntries(counterNames.map((name) => [name, 0])))};\n` +
    source
  );
}

async function countedModule(directory, kind) {
  const path = resolve(directory, routeFile);
  const result = await build({
    stdin: {
      contents: `export { planRoute, __engineRouteWork } from './${routeFile}';`,
      resolveDir: directory,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    plugins: [
      {
        name: `count-${kind}-planner`,
        setup(builder) {
          builder.onLoad({ filter: /route-path\.ts$/ }, (args) => {
            assert.equal(resolve(args.path), path, 'Only the selected planner may be instrumented');
            return { contents: countedSource(readFileSync(path, 'utf8'), kind), loader: 'ts' };
          });
        },
      },
    ],
  });
  assert.equal(result.outputFiles.length, 1);
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}

function load(directory, path) {
  return import(pathToFileURL(resolve(directory, path)).href);
}

function grid(side, leaving) {
  const edges = [],
    nodes = Array.from({ length: side * side }, () => ({ edges: [] }));
  function edge(from, to) {
    const index = edges.length;
    edges.push({ from, to, length: 10, index, offset: index * 10000 });
    nodes[from].edges.push(index);
    nodes[to].edges.push(index);
  }
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const from = y * side + x;
      if (x + 1 < side) edge(from, from + 1);
      if (y + 1 < side) edge(from, from + side);
    }
  }
  // Synthetic coordinates select an edge and a local station directly. This
  // isolates graph search without constructing or changing authored terrain.
  const network = {
    edges,
    nodes,
    edgeOf: Int32Array.from(edges, (e) => e.index),
    lastSegment: 0,
    nearest(x, z, out) {
      this.lastSegment = x;
      Object.assign(out, { s: edges[x].offset + z, x, z });
      return out;
    },
    at(_s, out) {
      out.tx = 1;
      out.tz = 0;
      return out;
    },
    leaving,
  };
  return [
    {
      name: `grid-${side}`,
      network,
      waypoints: [
        [0, 5],
        [edges.length - 1, 5],
      ],
      closed: false,
    },
  ];
}

function routes(module, cases, repeats = 1) {
  const result = [];
  for (let i = 0; i < repeats; i++)
    for (const test of cases)
      result.push(module.planRoute(test.network, test.waypoints, test.closed));
  return result;
}

function counts(module, cases, expected) {
  for (const name of counterNames) module.__engineRouteWork[name] = 0;
  assert.deepStrictEqual(
    routes(module, cases),
    expected,
    'Instrumentation must preserve every route leg',
  );
  return { ...module.__engineRouteWork };
}

function timings(before, after, cases, repeats) {
  for (let i = 0; i < 12; i++) {
    routes(before, cases);
    routes(after, cases);
  }
  const samples = { baseline: [], candidate: [] };
  for (let trial = 0; trial < 9; trial++) {
    for (const [key, module] of trial % 2
      ? [
          ['candidate', after],
          ['baseline', before],
        ]
      : [
          ['baseline', before],
          ['candidate', after],
        ]) {
      const start = performance.now(),
        result = routes(module, cases, repeats);
      const elapsed = performance.now() - start;
      assert.equal(result.length, repeats * cases.length);
      samples[key].push(elapsed / repeats);
    }
  }
  return {
    unit: 'milliseconds per complete fixture set',
    warmupPasses: 12,
    pairedTrials: 9,
    repeatsPerTrial: repeats,
    // These use the actual, uninstrumented modules. Retain raw paired samples
    // so host noise and trial ordering remain visible rather than hidden.
    samples,
    medianMs: Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [
        key,
        values.slice().sort((a, b) => a - b)[4],
      ]),
    ),
  };
}

async function main() {
  const args = options(),
    baselineDirectory = args['--baseline'],
    candidateDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.notEqual(baselineDirectory, candidateDirectory, 'Use a separate baseline checkout');
  assert.equal(
    git(baselineDirectory, 'status', '--porcelain', '--', 'src/core', 'src/simulation'),
    '',
    'The baseline engine directories must match their commit',
  );
  const baseline = metadata(baselineDirectory),
    candidate = metadata(candidateDirectory);
  for (const file of fixtureFiles)
    assert.equal(
      candidate.sourceSha256[file],
      baseline.sourceSha256[file],
      `Hold the fixture source unchanged: ${file}`,
    );
  const before = await load(baselineDirectory, routeFile),
    after = await load(candidateDirectory, routeFile),
    scan = await countedModule(baselineDirectory, 'scan'),
    heap = await countedModule(candidateDirectory, 'heap'),
    { RoadNetwork } = await load(baselineDirectory, fixtureFiles[0]),
    { TerrainField } = await load(baselineDirectory, fixtureFiles[1]),
    { SOLVANE } = await load(baselineDirectory, fixtureFiles[2]),
    network = new RoadNetwork(SOLVANE, new TerrainField(SOLVANE)),
    real = SOLVANE.events
      .filter((event) => event.waypoints.length >= 2)
      .map((event) => ({
        name: event.id,
        network,
        waypoints: event.waypoints,
        closed: event.kind === 'circuit',
      })),
    results = [];
  for (const [name, cases, repeats] of [
    ['existing Solvane events', real, 25],
    ['24 x 24 equal-length grid', grid(24, RoadNetwork.prototype.leaving), 15],
    ['48 x 48 equal-length grid', grid(48, RoadNetwork.prototype.leaving), 2],
  ]) {
    const expected = routes(before, cases);
    assert.deepStrictEqual(routes(after, cases), expected, 'The candidate changed a route');
    results.push({
      name,
      cases: cases.length,
      edges: cases[0].network.edges.length,
      directedStates: cases[0].network.edges.length * 2,
      baseline: counts(scan, cases, expected),
      candidate: counts(heap, cases, expected),
      exactRoutes: true,
      routesSha256: sha256(JSON.stringify(expected)),
      timing: args.timings ? timings(before, after, cases, repeats) : null,
    });
  }
  assert.deepStrictEqual(
    metadata(baselineDirectory),
    baseline,
    'Baseline measured files changed during the run',
  );
  assert.deepStrictEqual(
    metadata(candidateDirectory),
    candidate,
    'Candidate measured files changed during the run',
  );
  const report = {
    schema: 1,
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    platform: `${process.platform}/${process.arch}`,
    scope:
      'Route search only. Scan slots and heap comparator calls are different operation units, not equivalent instructions. Optional timings use uninstrumented modules on this host; no FPS or full-game performance claim.',
    baseline,
    candidate,
    results,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args['--output']) {
    mkdirSync(dirname(args['--output']), { recursive: true });
    writeFileSync(args['--output'], output);
  }
  process.stdout.write(output);
}

await main();
