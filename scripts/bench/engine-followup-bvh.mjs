#!/usr/bin/env node
/** Reproducible, isolated TriangleBVH constructor comparison.
 *
 * Uses the actual committed modules through esbuild, never a reconstructed old
 * algorithm or Node's native TypeScript transformer. No repository writes,
 * package installs, hooks, or game/browser processes are started by this file.
 * Run only when other benchmarks, builds and browser suites are idle.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const options = {
  repo: path.resolve(scriptDirectory, "../.."),
  baseline: "1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb",
  current: "f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6",
  cases: [],
  warmupPairs: 2,
  measuredPairs: 10,
  querySamples: 256,
  heapMb: 768,
  prepareOnly: false,
};

function integer(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum)
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`);
  return number;
}

for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  if (name === "--help") {
    process.stdout
      .write(`Usage: node scripts/bench/engine-followup-bvh.mjs [options]\n
  --repo PATH             Repository with installed esbuild (default: script ../..)
  --baseline REF          Committed baseline (default: 1c609bfa...)
  --current REF           Committed current (default: f4d41b0c...)
  --case ID:ROWS          Repeatable; defaults: poggio-alto:1024, aurel:8192
  --warmup-pairs N        Warmup pairs excluded from summaries (default: 2)
  --pairs N              Alternating measured pairs, even N (default: 10)
  --query-samples N       Deterministic triangle targets (default: 256)
  --heap-mb N             Child old-space limit, 512–1024 MB (default: 768)
  --work-dir PATH         Generated bundle/config/case results (default: new /tmp dir)
  --output PATH          Complete raw JSON result (default: work-dir/result.json)
  --prepare-only         Resolve git sources and bundle; never instantiate geometry
\nOnly TriangleBVH constructors are timed. Geometry, GC, correctness checks,
hashing, module initialization, and serialization are outside each timed interval.
`);
    process.exit(0);
  }
  if (name === "--prepare-only") {
    options.prepareOnly = true;
    continue;
  }
  const value = process.argv[++index];
  if (value === undefined) throw new Error(`Missing value for ${name}`);
  if (name === "--repo") options.repo = path.resolve(value);
  else if (name === "--baseline") options.baseline = value;
  else if (name === "--current") options.current = value;
  else if (name === "--case") {
    const match = /^([a-z0-9-]+):(\d+)$/.exec(value);
    if (!match) throw new Error(`Invalid case: ${value}`);
    options.cases.push({
      id: match[1],
      rows: integer(match[2], "rows", 1, 8192),
    });
  } else if (name === "--warmup-pairs")
    options.warmupPairs = integer(value, name, 1, 10);
  else if (name === "--pairs")
    options.measuredPairs = integer(value, name, 2, 40);
  else if (name === "--query-samples")
    options.querySamples = integer(value, name, 8, 1024);
  else if (name === "--heap-mb")
    options.heapMb = integer(value, name, 512, 1024);
  else if (name === "--work-dir") options.workDir = path.resolve(value);
  else if (name === "--output") options.output = path.resolve(value);
  else throw new Error(`Unknown option: ${name}`);
}
if (options.measuredPairs % 2)
  throw new Error("--pairs must be even to balance execution order");
if (!options.cases.length)
  options.cases.push(
    { id: "poggio-alto", rows: 1024 },
    { id: "aurel", rows: 8192 },
  );

const git = (...args) =>
  execFileSync("git", args, {
    cwd: options.repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
const commit = (ref) => git("rev-parse", "--verify", `${ref}^{commit}`);
options.baseline = commit(options.baseline);
options.current = commit(options.current);
options.workDir ??= mkdtempSync(path.join(tmpdir(), "engine-followup-bvh-"));
options.output ??= path.join(options.workDir, "result.json");
mkdirSync(options.workDir, { recursive: true });
mkdirSync(path.dirname(options.output), { recursive: true });

const requireFromRepo = createRequire(path.join(options.repo, "package.json"));
const esbuild = requireFromRepo("esbuild");
const refs = { baseline: options.baseline, current: options.current };
const sourceManifest = new Map();
const sourceCache = new Map();
const blobMaps = Object.fromEntries(
  Object.entries(refs).map(([version, ref]) => [
    version,
    new Map(
      git("ls-tree", "-r", ref, "--", "src")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [description, filename] = line.split("\t");
          return [filename, description.split(" ")[2]];
        }),
    ),
  ]),
);
const aliases = {
  "engine-benchmark:baseline-bvh": ["baseline", "src/simulation/bvh.ts"],
  "engine-benchmark:current-bvh": ["current", "src/simulation/bvh.ts"],
  "engine-benchmark:baseline-tire": [
    "baseline",
    "src/simulation/tire-footprint.ts",
  ],
  "engine-benchmark:current-tire": [
    "current",
    "src/simulation/tire-footprint.ts",
  ],
  "engine-benchmark:contact": ["current", "src/simulation/contact.ts"],
  "engine-benchmark:track": ["current", "src/simulation/track.ts"],
  "engine-benchmark:circuits": ["current", "src/simulation/circuits.ts"],
  "engine-benchmark:math": ["current", "src/core/math.ts"],
};
const bundlePath = path.join(options.workDir, "engine-followup-bvh.bundle.mjs");
const runnerPath = path.join(scriptDirectory, "engine-followup-bvh.runner.mjs");
await esbuild.build({
  entryPoints: [runnerPath],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  plugins: [
    {
      name: "committed-engine-sources",
      setup(build) {
        build.onResolve({ filter: /^engine-benchmark:/ }, (args) => {
          const target = aliases[args.path];
          if (!target)
            throw new Error(`Unknown benchmark import: ${args.path}`);
          return { path: target[1], namespace: `git-${target[0]}` };
        });
        for (const version of Object.keys(refs)) {
          const namespace = `git-${version}`;
          build.onResolve({ filter: /.*/, namespace }, (args) => {
            if (!args.path.startsWith("."))
              throw new Error(
                `Unexpected non-relative committed import: ${args.path}`,
              );
            const resolved = path.posix.normalize(
              path.posix.join(path.posix.dirname(args.importer), args.path),
            );
            if (!resolved.startsWith("src/"))
              throw new Error(`Import leaves src/: ${resolved}`);
            return { path: resolved, namespace };
          });
          build.onLoad({ filter: /.*/, namespace }, (args) => {
            const key = `${version}:${args.path}`;
            let contents = sourceCache.get(key);
            if (contents === undefined) {
              // Actual baseline/current source, including the complete original
              // algorithm and its dependencies. Never reconstruct a build method.
              contents = execFileSync(
                "git",
                ["show", `${refs[version]}:${args.path}`],
                {
                  cwd: options.repo,
                  encoding: "utf8",
                  maxBuffer: 32 * 1024 * 1024,
                },
              );
              sourceCache.set(key, contents);
              sourceManifest.set(key, {
                version,
                commit: refs[version],
                path: args.path,
                gitBlob: blobMaps[version].get(args.path),
                sha256: createHash("sha256").update(contents).digest("hex"),
              });
            }
            return {
              contents,
              loader: args.path.endsWith(".json") ? "json" : "ts",
            };
          });
        }
      },
    },
  ],
});

const sourceFiles = [...sourceManifest.values()].sort((a, b) =>
  `${a.version}:${a.path}`.localeCompare(`${b.version}:${b.path}`),
);
const result = {
  schema: "engine-followup-bvh/v1",
  status: options.prepareOnly ? "prepared-only" : "running",
  startedAt: new Date().toISOString(),
  invocation: [process.execPath, scriptPath, ...process.argv.slice(2)],
  options,
  sources: {
    baseline: options.baseline,
    current: options.current,
    bvhBaselineBlob: blobMaps.baseline.get("src/simulation/bvh.ts"),
    bvhCurrentBlob: blobMaps.current.get("src/simulation/bvh.ts"),
    bvhPatch: git(
      "diff",
      "--no-ext-diff",
      options.baseline,
      options.current,
      "--",
      "src/simulation/bvh.ts",
    ),
    files: sourceFiles,
    harnessSha256: createHash("sha256")
      .update(readFileSync(scriptPath))
      .digest("hex"),
    runnerSha256: createHash("sha256")
      .update(readFileSync(runnerPath))
      .digest("hex"),
    bundleSha256: createHash("sha256")
      .update(readFileSync(bundlePath))
      .digest("hex"),
    esbuildVersion: esbuild.version,
  },
  methodology: {
    timed:
      "Only new TriangleBVH(vertices, indices, normals, ownsContact), including constructor validation, centroids, partitioning and all nodes.",
    outsideTiming: [
      "module initialization",
      "Track and TrackContactMesh creation",
      "query setup",
      "explicit GC before every constructor",
      "all correctness checks",
      "hashes",
      "memory sampling",
      "output serialization",
    ],
    fixture:
      "One actual current-commit TrackContactMesh, including authored normals and ownership, supplies identical immutable arrays to both constructors. At 8192 rows the actual default constructor argument is exercised.",
    scheduling:
      "One fresh bounded-heap Node child per case; children run sequentially. Pair 0 runs baseline/current, pair 1 current/baseline, repeating for warmup and measurement.",
    retention:
      "A single untimed mesh tree remains resident because its actual ownership callback captures its mesh. Each measured tree is compared against compact binary reference snapshots, then released before the next explicit GC. No sequence of large trees is retained.",
    equivalence:
      "Independent leaf reductions and parent unions validate exact signed-zero-sensitive bounds, balanced contiguous topology, leaf sizes and a complete triangle permutation. Binary snapshots compare every node field and ordered triangle against the actual baseline. Sampled ray, cached vertical and tire queries compare full hit outputs and candidate counts bit-for-bit.",
    limitations: [
      "Constructor microbenchmark with warmed code; not a whole-game, cold-start, browser, frame-time or FPS result.",
      "Explicit GC is outside timing; naturally occurring collections during a constructor remain included.",
      "Queries cover deterministic samples and edge/miss cases, not every possible ray.",
      "One runtime, host and run; frequency scaling, scheduler noise and JIT variability remain possible.",
    ],
  },
  cases: [],
};
const save = () =>
  writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
save();
if (options.prepareOnly) {
  process.stdout.write(
    `Prepared ${sourceFiles.length} committed modules; no geometry instantiated.\n${options.output}\n`,
  );
  process.exit(0);
}

for (let caseIndex = 0; caseIndex < options.cases.length; caseIndex++) {
  const fixture = options.cases[caseIndex];
  const stem = `${caseIndex}-${fixture.id}-${fixture.rows}`;
  const caseOutput = path.join(options.workDir, `${stem}.json`);
  const configPath = path.join(options.workDir, `${stem}.config.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      ...fixture,
      warmupPairs: options.warmupPairs,
      measuredPairs: options.measuredPairs,
      querySamples: options.querySamples,
      output: caseOutput,
    }),
  );
  process.stdout.write(
    `Starting ${fixture.id}/${fixture.rows} rows with ${options.heapMb} MB old-space limit.\n`,
  );
  const child = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      `--max-old-space-size=${options.heapMb}`,
      bundlePath,
      configPath,
    ],
    { cwd: options.repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  writeFileSync(
    path.join(options.workDir, `${stem}.stdout.log`),
    child.stdout ?? "",
  );
  writeFileSync(
    path.join(options.workDir, `${stem}.stderr.log`),
    child.stderr ?? "",
  );
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error || child.status !== 0) {
    result.status = "failed";
    result.failure = {
      case: fixture,
      exitCode: child.status,
      signal: child.signal,
      error: child.error?.message,
      stderr: child.stderr,
    };
    result.finishedAt = new Date().toISOString();
    save();
    throw (
      child.error ??
      new Error(
        `Case ${stem} failed (${child.status ?? child.signal}); partial evidence saved`,
      )
    );
  }
  result.cases.push(JSON.parse(readFileSync(caseOutput, "utf8")));
  save();
}
result.status = "complete";
result.finishedAt = new Date().toISOString();
save();
process.stdout.write(`Complete: ${options.output}\n`);
