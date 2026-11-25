/** W07E isolated simulation regression investigation. Run with exclusive CPU.
 * No browser, compiler, test suite, or other benchmark may run concurrently.
 * node --max-old-space-size=768 scripts/bench/engine-followup-simulation.mjs \
 *   --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb \
 *   --candidate f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 \
 *   --output docs/engine/runtime-followup-2026-11-24/measurements/w07e-simulation.json
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, extname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const options = {
  baseline: '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb',
  candidate: 'f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6',
  repo: process.cwd(),
  rounds: 12,
  warmupEpisodes: 32,
  measuredEpisodes: 24,
  episodeSteps: 1200,
  ticks: 1200,
  frameWarmupCalls: 500000,
  frameMeasuredCalls: 1000000,
};
const numbers = new Set([
  'rounds',
  'warmupEpisodes',
  'measuredEpisodes',
  'episodeSteps',
  'ticks',
  'frameWarmupCalls',
  'frameMeasuredCalls',
]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  assert([...Object.keys(options), 'output', 'scratch'].includes(key), `Unknown option ${key}`);
  assert(process.argv[i + 1], `Missing value for ${key}`);
  options[key] = numbers.has(key) ? Number(process.argv[i + 1]) : process.argv[i + 1];
}
for (const key of numbers)
  assert(Number.isSafeInteger(options[key]) && options[key] > 0, `Invalid ${key}`);
assert.equal(options.rounds % 6, 0, 'Round count must include balanced six-order blocks');
assert(options.output, '--output is required');
options.repo = resolve(options.repo);
options.output = resolve(options.output);
const git = (...args) =>
  execFileSync('git', ['-C', options.repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
for (const key of ['baseline', 'candidate'])
  options[key] = git('rev-parse', `${options[key]}^{commit}`).toString().trim();
const scratch = options.scratch
  ? resolve(options.scratch)
  : mkdtempSync(resolve(tmpdir(), 'simulation-followup-'));
mkdirSync(scratch, { recursive: true });
mkdirSync(dirname(options.output), { recursive: true });
const worker = fileURLToPath(new URL('./engine-followup-simulation.worker.mjs', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(resolve(options.repo, 'package.json'));
const { build, version: esbuildVersion } = require('esbuild');
const aliases = {
  math: 'src/core/math.ts',
  vehicle: 'src/simulation/vehicle.ts',
  frame: 'src/simulation/road-contact.ts',
  fixtures: 'scripts/dynamics-fixtures.ts',
  catalogue: 'src/simulation/vehicle-catalogue/index.ts',
  config: 'src/simulation/config.ts',
  world: 'src/simulation/world.ts',
  protocol: 'src/simulation/protocol.ts',
};
const roles = ['baseline', 'candidate', 'candidate-original-frame'];
const permutations = [
  ['baseline', 'candidate', 'candidate-original-frame'],
  ['candidate-original-frame', 'candidate', 'baseline'],
  ['candidate', 'baseline', 'candidate-original-frame'],
  ['candidate-original-frame', 'baseline', 'candidate'],
  ['baseline', 'candidate-original-frame', 'candidate'],
  ['candidate', 'candidate-original-frame', 'baseline'],
];
const report = {
  schemaVersion: 1,
  worker: 'w07e / worker41 of 60',
  status: 'preparing',
  startedAt: new Date().toISOString(),
  options,
  scratch,
  environment: {
    node: process.version,
    versions: process.versions,
    esbuild: esbuildVersion,
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model,
    logicalCPUs: cpus().length,
    totalMemoryBytes: totalmem(),
    childOldSpaceMiB: 768,
    nodeExecutableSHA256: sha(readFileSync(process.execPath)),
  },
  harness: {
    orchestratorSHA256: sha(readFileSync(fileURLToPath(import.meta.url))),
    workerSHA256: sha(readFileSync(worker)),
    variants: {},
  },
  methodology: {
    sources:
      'Each bundle resolves every production source from one exact committed tree. The attribution-only bundle resolves all files from candidate except road-contact.ts, which is the actual committed baseline file. No production or authored source is patched.',
    processIsolation:
      'Each process has only one source variant and one vehicle or microbenchmark input kind. The same worker contains no second implementation. Every role/round/workload starts a fresh process; children execute sequentially.',
    timing:
      'Fixed, predeclared equal warmup. Vehicle samples aggregate multiple identical 1200-substep episodes with fresh track and vehicle setup outside every timer. GC, setup, canonical serialization, hashing, and exact output comparisons are untimed. Wall and user/system CPU durations are retained for every warmup and measured episode.',
    inputScope:
      'Natural rl2 and sk125 match W07B input and support-loss schedules on its analytic DynamicsTrack fixture. No authored AWD clutch coupling is enabled. Frame microbenchmarks separately use 128 actual unit-up rl2 input snapshots captured in an untimed process and 128 W07B diverse-normal inputs.',
    proof:
      'Full production Simulation worlds execute formula practice, wet motorcycle practice, and motocross race. Packed Float32 frames and exposed dynamic car/race/AI state are captured every tick. Surface/weather arrays and sparse deformable-terrain checkpoints are captured every 120 ticks and at the end. Raw files are compared byte for byte, not merely by hashes.',
    stateExclusions: [
      'JavaScript #private fields are inaccessible',
      'Shared authored definitions/setup/vehicle physics specifications and static circuit geometry are omitted from dynamic state capture',
      'Contact BVH construction/layout counters and internal collision scratch are not treated as gameplay state',
    ],
    noSelection:
      'No samples, outliers, warmups, or unfavorable runs are removed. Every started child and failed attempt remains in the report. Defaults are fixed before measurement; changing them creates a separate explicitly labelled report.',
    limits:
      'Node CPU measurements on this runtime and host; no browser/GPU/FPS or other-machine claim. Actual circuit proof is correctness evidence, not a timed full-game benchmark. Analytic Vehicle timings exclude TrackContactMesh/BVH and race/AI/weather orchestration. JIT behavior can differ from CI Node22.',
  },
  changedSimulationOrCoreFiles: git(
    'diff',
    '--name-only',
    options.baseline,
    options.candidate,
    '--',
    'src/core',
    'src/simulation',
  )
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean),
  runs: [],
  proof: [],
  vehicleRounds: [],
  frameRounds: [],
};
const save = () => writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
save();

async function bundle(role) {
  const baseCommit = role === 'baseline' ? options.baseline : options.candidate;
  const pick = (path) =>
    role === 'candidate-original-frame' && path === 'src/simulation/road-contact.ts'
      ? options.baseline
      : baseCommit;
  const graph = new Map(),
    path = resolve(scratch, `${role}.bundle.mjs`);
  await build({
    entryPoints: [worker],
    outfile: path,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: false,
    logLevel: 'silent',
    plugins: [
      {
        name: `committed-source-${role}`,
        setup(builder) {
          builder.onResolve({ filter: /^simulation-followup:/ }, (args) => {
            const file = aliases[args.path.slice('simulation-followup:'.length)];
            assert(file, `Unknown alias ${args.path}`);
            return { path: `${pick(file)}:${file}`, namespace: 'committed-source' };
          });
          builder.onResolve({ filter: /^\./, namespace: 'committed-source' }, (args) => {
            const importer = args.importer.slice(args.importer.indexOf(':') + 1);
            const file = posix.normalize(posix.join(posix.dirname(importer), args.path));
            return { path: `${pick(file)}:${file}`, namespace: 'committed-source' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'committed-source' }, (args) => {
            const separator = args.path.indexOf(':'),
              commit = args.path.slice(0, separator),
              file = args.path.slice(separator + 1);
            const bytes = git('show', args.path);
            graph.set(args.path, {
              commit,
              path: file,
              bytes: bytes.length,
              sha256: sha(bytes),
              blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
            });
            return { contents: bytes.toString(), loader: extname(file) === '.ts' ? 'ts' : 'js' };
          });
        },
      },
    ],
  });
  const sources = [...graph.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    path,
    baseCommit,
    roadFrameCommit: pick('src/simulation/road-contact.ts'),
    bundleSHA256: sha(readFileSync(path)),
    sourceGraphSHA256: sha(Buffer.from(sources.map((s) => `${s.path}\0${s.sha256}`).join('\n'))),
    sources,
  };
}
function compareFiles(left, right) {
  const a = openSync(left, 'r'),
    b = openSync(right, 'r'),
    x = Buffer.allocUnsafe(65536),
    y = Buffer.allocUnsafe(65536);
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const na = readSync(a, x, 0, x.length, null),
        nb = readSync(b, y, 0, y.length, null);
      assert.equal(nb, na, `Output lengths differ at byte ${bytes}: ${left} / ${right}`);
      if (!na) break;
      if (!x.subarray(0, na).equals(y.subarray(0, nb))) {
        const at = x.subarray(0, na).findIndex((value, i) => value !== y[i]);
        throw new Error(`Outputs differ at byte ${bytes + at}: ${left} / ${right}`);
      }
      digest.update(x.subarray(0, na));
      bytes += na;
    }
  } finally {
    closeSync(a);
    closeSync(b);
  }
  return { exactBytesEqual: true, bytes, sha256: digest.digest('hex') };
}
function child(role, request, label) {
  const entry = {
    sequence: report.runs.length,
    label,
    role,
    startedAt: new Date().toISOString(),
    request,
    status: 'running',
  };
  report.runs.push(entry);
  save();
  process.stderr.write(`w07e ${entry.sequence}: ${label} / ${role}\n`);
  try {
    const output = execFileSync(
      process.execPath,
      [
        '--expose-gc',
        '--max-old-space-size=768',
        report.harness.variants[role].path,
        JSON.stringify(request),
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180000,
      },
    );
    entry.result = JSON.parse(output);
    entry.status = 'passed';
    assert.equal(entry.result.process.node, process.version);
    return entry;
  } catch (error) {
    entry.status = 'failed';
    entry.error = String(error);
    throw error;
  } finally {
    entry.completedAt = new Date().toISOString();
    save();
  }
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (fraction) => {
    const p = (sorted.length - 1) * fraction,
      lo = Math.floor(p),
      hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  };
  return { minimum: sorted[0], q1: q(0.25), median: q(0.5), q3: q(0.75), maximum: sorted.at(-1) };
}
function summarize(rounds, before, after) {
  const rows = rounds.map((r) => {
    const a = report.runs[r.runs[before]].result.phases.measured.totals;
    const b = report.runs[r.runs[after]].result.phases.measured.totals;
    return {
      round: r.round,
      order: r.order,
      baselineMs: a.elapsedMs,
      candidateMs: b.elapsedMs,
      wallChangePercent: (b.elapsedMs / a.elapsedMs - 1) * 100,
      cpuChangePercent: ((b.cpuUserMs + b.cpuSystemMs) / (a.cpuUserMs + a.cpuSystemMs) - 1) * 100,
    };
  });
  return {
    before,
    after,
    pairs: rows.length,
    beforeMs: distribution(rows.map((r) => r.baselineMs)),
    afterMs: distribution(rows.map((r) => r.candidateMs)),
    pairedWallChangePercent: distribution(rows.map((r) => r.wallChangePercent)),
    pairedCPUChangePercent: distribution(rows.map((r) => r.cpuChangePercent)),
    afterFasterPairs: rows.filter((r) => r.wallChangePercent < 0).length,
    rows,
  };
}
function markdown() {
  if (!report.summary) return;
  const rows = [];
  for (const [vehicle, comparisons] of Object.entries(report.summary.vehicles)) {
    for (const c of comparisons)
      rows.push(
        `| Natural ${vehicle}: ${c.before} → ${c.after} | ${c.beforeMs.median.toFixed(3)} | ${c.afterMs.median.toFixed(3)} | ${c.pairedWallChangePercent.median.toFixed(2)}% | ${c.pairedCPUChangePercent.median.toFixed(2)}% | ${c.afterFasterPairs}/${c.pairs} |`,
      );
  }
  for (const [kind, c] of Object.entries(report.summary.frames))
    rows.push(
      `| Frame ${kind}: baseline → candidate | ${c.beforeMs.median.toFixed(3)} | ${c.afterMs.median.toFixed(3)} | ${c.pairedWallChangePercent.median.toFixed(2)}% | ${c.pairedCPUChangePercent.median.toFixed(2)}% | ${c.afterFasterPairs}/${c.pairs} |`,
    );
  let text = `# Wave 7E independent simulation and road-frame investigation\n\nMeasured ${report.startedAt} to ${report.completedAt}. Baseline \`${options.baseline}\`; candidate \`${options.candidate}\`. The third source graph uses candidate everywhere except the original committed road-contact frame.\n\n## Fresh-process timing\n\nEach row summarizes ${options.rounds} balanced process pairs. Vehicle samples contain ${options.measuredEpisodes * options.episodeSteps} measured substeps after ${options.warmupEpisodes * options.episodeSteps} warmup substeps in that same fresh process. Each episode resets the laboratory track/car outside timing. Frame samples contain ${4 * options.frameMeasuredCalls} measured calls after ${4 * options.frameWarmupCalls} warmup calls. Negative paired change means faster.\n\n| Workload and comparison | Before median ms | After median ms | Median paired wall change | Median paired CPU change | After faster pairs |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n## Exact production-world output\n\n`;
  for (const proof of report.proof) {
    const value = report.runs[proof.candidateRun].result;
    text += `- **${proof.scenario}:** ${value.ticks} production Simulation ticks (${value.simulatedSeconds} simulated seconds), ${value.observations} complete packed frames and dynamic state snapshots, ${value.surfaceSnapshots} weather/surface/terrain snapshots; ${proof.comparison.bytes.toLocaleString('en-US')} raw bytes compared exactly. Frame SHA-256 \`${value.frameSHA256}\`; state SHA-256 \`${value.stateSHA256}\`.\n`;
  }
  text += `\n## Attribution, methodology, and limits\n\nThe flat frame case uses 128 input records captured from actual rl2 RoadContactFrame.set calls on the analytic runway, preserving Float64 bits and signed zero. Its 1200-substep capture made ${report.flatInputs.frameCalls} frame calls and ${report.flatInputs.couplingCalls} clutch-coupling calls; the mesh remained unbuilt. Diverse-normal microbenchmarks use the earlier pitch/roll/bank/scale fixture and are not treated as the cost of flat runway frames. The authored AWD clutch saving remains dormant and is excluded from claimed natural-workload improvements.\n\nOne source implementation and one vehicle/workload run in each fresh process. Twelve rounds cover all six three-variant orders twice, and workload order alternates. No build, mesh creation, vehicle/track setup, explicit GC, serialization, hashes, or exact comparisons enter the timed episodes. Endogenous allocation/GC during integration remains included. Every raw warmup and measured wall/user/system CPU duration is retained in JSON, as are all process IDs, memory/resource usage, source graphs, Git blobs, source SHA-256s, Node executable hash, and bundle/harness hashes.\n\nPacked frames are compared without changing, rounding, omitting, or normalizing any byte; writeFrame receives its normal zero timing/dropped defaults in both variants. Exposed dynamic car/race/AI state is serialized with exact Float64 bits. Shared authored definitions and static geometry are excluded from dynamic serialization; JavaScript #private fields are inaccessible. Weather/surface arrays and sparse off-road terrain checkpoints are additionally compared every 120 ticks and at the end. No renderer/browser/GPU or full-game FPS conclusion follows from Node CPU timings. This host runs ${process.version} / V8 ${process.versions.v8}; JIT behavior need not match CI Node22 or other machines.\n\nThe original W07B +9.96% rl2 signal remains retained in its separate report. This independent run does not delete or relabel it.\n\n## Reproduce\n\nRun alone from the repository root:\n\n\`\`\`sh\nnode --max-old-space-size=768 scripts/bench/engine-followup-simulation.mjs --baseline ${options.baseline} --candidate ${options.candidate} --output docs/engine/runtime-followup-2026-11-24/measurements/w07e-simulation.json\n\`\`\`\n`;
  writeFileSync(options.output.replace(/\.json$/, '') + '.md', text);
}

try {
  for (const role of roles) {
    report.harness.variants[role] = await bundle(role);
    save();
  }
  const framePath = 'src/simulation/road-contact.ts';
  assert.equal(
    report.harness.variants.baseline.sources.find((s) => s.path === framePath).blob,
    report.harness.variants['candidate-original-frame'].sources.find((s) => s.path === framePath)
      .blob,
  );
  report.status = 'running';
  save();
  const inputs = resolve(scratch, 'actual-rl2-flat-frame-inputs.bin');
  report.flatInputs = child(
    'baseline',
    { task: 'capture-flat', inputs },
    'capture actual flat frame inputs',
  ).result;
  save();
  for (const scenario of ['formula', 'motorcycle-wet', 'motocross']) {
    const baselineTrace = resolve(scratch, `proof-${scenario}-baseline.bin`),
      candidateTrace = resolve(scratch, `proof-${scenario}-candidate.bin`);
    const a = child(
      'baseline',
      { task: 'proof', scenario, ticks: options.ticks, trace: baselineTrace },
      `production proof ${scenario}`,
    );
    const b = child(
      'candidate',
      { task: 'proof', scenario, ticks: options.ticks, trace: candidateTrace },
      `production proof ${scenario}`,
    );
    const comparison = compareFiles(baselineTrace, candidateTrace);
    assert.equal(a.result.output.sha256, b.result.output.sha256);
    report.proof.push({ scenario, baselineRun: a.sequence, candidateRun: b.sequence, comparison });
    save();
  }
  for (let round = 0; round < options.rounds; round++) {
    const order = permutations[round % permutations.length];
    for (const vehicle of round % 2 === 0 ? ['rl2', 'sk125'] : ['sk125', 'rl2']) {
      const entry = { round, vehicle, order, runs: {}, comparisons: [] };
      report.vehicleRounds.push(entry);
      save();
      for (const role of order) {
        const trace = resolve(scratch, `vehicle-${vehicle}-${round}-${role}.bin`);
        const run = child(
          role,
          {
            task: 'vehicle',
            vehicle,
            trace,
            episodeSteps: options.episodeSteps,
            warmupEpisodes: options.warmupEpisodes,
            measuredEpisodes: options.measuredEpisodes,
          },
          `vehicle ${vehicle} round ${round + 1}/${options.rounds}`,
        );
        entry.runs[role] = run.sequence;
        save();
      }
      for (const role of roles.slice(1)) {
        const a = report.runs[entry.runs.baseline].result.output,
          b = report.runs[entry.runs[role]].result.output;
        entry.comparisons.push({ role, ...compareFiles(a.path, b.path) });
      }
      save();
    }
  }
  for (let round = 0; round < options.rounds; round++) {
    const order = round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const kind of round % 2 === 0
      ? ['flat-actual-rl2', 'diverse-normal']
      : ['diverse-normal', 'flat-actual-rl2']) {
      const entry = { round, kind, order, runs: {} };
      report.frameRounds.push(entry);
      save();
      for (const role of order) {
        const trace = resolve(scratch, `frame-${kind}-${round}-${role}.bin`);
        const run = child(
          role,
          {
            task: 'frame',
            kind,
            trace,
            inputs,
            frameWarmupCalls: options.frameWarmupCalls,
            frameMeasuredCalls: options.frameMeasuredCalls,
          },
          `frame ${kind} round ${round + 1}/${options.rounds}`,
        );
        entry.runs[role] = run.sequence;
        save();
      }
      entry.comparison = compareFiles(
        report.runs[entry.runs.baseline].result.output.path,
        report.runs[entry.runs.candidate].result.output.path,
      );
      save();
    }
  }
  report.summary = { vehicles: {}, frames: {} };
  for (const vehicle of ['rl2', 'sk125']) {
    const rows = report.vehicleRounds.filter((r) => r.vehicle === vehicle);
    report.summary.vehicles[vehicle] = [
      summarize(rows, 'baseline', 'candidate'),
      summarize(rows, 'candidate-original-frame', 'candidate'),
      summarize(rows, 'baseline', 'candidate-original-frame'),
    ];
  }
  for (const kind of ['flat-actual-rl2', 'diverse-normal'])
    report.summary.frames[kind] = summarize(
      report.frameRounds.filter((r) => r.kind === kind),
      'baseline',
      'candidate',
    );
  assert.equal(
    new Set(report.runs.map((r) => r.result.process.pid)).size,
    report.runs.length,
    'Every child should be a fresh process',
  );
  report.status = 'passed';
  report.completedAt = new Date().toISOString();
  save();
  markdown();
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  report.completedAt = new Date().toISOString();
  save();
  throw error;
}
process.stdout.write(`${options.output}\n`);
