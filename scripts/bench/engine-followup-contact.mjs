/** Isolated contact follow-up measurement; no native TypeScript transform.
 * Run alone, without browsers, other benchmarks, builds or tests.
 * node --max-old-space-size=768 scripts/bench/engine-followup-contact.mjs \
 *   --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb \
 *   --candidate f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 \
 *   --output docs/engine/runtime-followup-2026-11-24/measurements/w07b-contact.json
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, extname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = {
  baseline: "1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb",
  candidate: "f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6",
  repo: process.cwd(),
};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, "");
  assert.ok(
    ["baseline", "candidate", "repo", "output", "scratch"].includes(key),
  );
  assert.ok(process.argv[i + 1], `Missing --${key} argument`);
  options[key] = process.argv[i + 1];
}
assert.ok(options.output, "--output REPORT.json is required");
options.repo = resolve(options.repo);
options.output = resolve(options.output);
const git = (...args) =>
  execFileSync("git", ["-C", options.repo, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
for (const key of ["baseline", "candidate"])
  options[key] = git("rev-parse", `${options[key]}^{commit}`).toString().trim();
const scratch = options.scratch
  ? resolve(options.scratch)
  : mkdtempSync(resolve(tmpdir(), "contact-followup-"));
mkdirSync(scratch, { recursive: true });
mkdirSync(dirname(options.output), { recursive: true });
const require = createRequire(resolve(options.repo, "package.json"));
const { build, version: esbuildVersion } = require("esbuild");
const sourceGraph = new Map();
const aliases = {
  "baseline-contact": [options.baseline, "src/simulation/contact.ts"],
  "candidate-contact": [options.candidate, "src/simulation/contact.ts"],
  "baseline-frame": [options.baseline, "src/simulation/road-contact.ts"],
  "candidate-frame": [options.candidate, "src/simulation/road-contact.ts"],
  "baseline-vehicle": [options.baseline, "src/simulation/vehicle.ts"],
  "candidate-vehicle": [options.candidate, "src/simulation/vehicle.ts"],
  math: [options.candidate, "src/core/math.ts"],
  track: [options.candidate, "src/simulation/track.ts"],
  circuits: [options.candidate, "src/simulation/circuits.ts"],
  catalogue: [options.candidate, "src/simulation/vehicle-catalogue/index.ts"],
  config: [options.candidate, "src/simulation/config.ts"],
  fixtures: [options.candidate, "scripts/dynamics-fixtures.ts"],
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bundle = resolve(scratch, "engine-followup-contact.bundle.mjs");
const worker = fileURLToPath(
  new URL("./engine-followup-contact.worker.mjs", import.meta.url),
);
await build({
  entryPoints: [worker],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "silent",
  minify: false,
  plugins: [
    {
      name: "pinned-git-source-with-shared-candidate-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^engine-followup:/ }, (args) => {
          const pair = aliases[args.path.slice("engine-followup:".length)];
          assert.ok(pair, `Unknown source alias ${args.path}`);
          return { path: pair.join(":"), namespace: "pinned-engine-source" };
        });
        builder.onResolve(
          { filter: /^\./, namespace: "pinned-engine-source" },
          (args) => {
            const importer = args.importer.slice(
              args.importer.indexOf(":") + 1,
            );
            const path = posix.normalize(
              posix.join(posix.dirname(importer), args.path),
            );
            // Keep the two target methods together during real vehicle stepping;
            // all other dependencies, especially BVH and authored data, are shared.
            const ref =
              args.importer ===
                `${options.baseline}:src/simulation/vehicle.ts` &&
              path === "src/simulation/road-contact.ts"
                ? options.baseline
                : options.candidate;
            return {
              path: `${ref}:${path}`,
              namespace: "pinned-engine-source",
            };
          },
        );
        builder.onLoad(
          { filter: /.*/, namespace: "pinned-engine-source" },
          (args) => {
            const separator = args.path.indexOf(":");
            const commit = args.path.slice(0, separator);
            const path = args.path.slice(separator + 1);
            const bytes = git("show", args.path);
            const blob = createHash("sha1")
              .update(`blob ${bytes.length}\0`)
              .update(bytes)
              .digest("hex");
            sourceGraph.set(args.path, {
              commit,
              path,
              blob,
              sha256: sha(bytes),
              bytes: bytes.length,
            });
            return {
              contents: bytes.toString(),
              loader: extname(path) === ".ts" ? "ts" : "js",
            };
          },
        );
      },
    },
  ],
});
const sources = [...sourceGraph.values()].sort(
  (a, b) => a.path.localeCompare(b.path) || a.commit.localeCompare(b.commit),
);
const report = {
  schemaVersion: 1,
  worker: "w07b / worker38 of 60",
  recordedAt: new Date().toISOString(),
  status: "running",
  baselineCommit: options.baseline,
  candidateCommit: options.candidate,
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
  },
  harness: {
    orchestratorSHA256: sha(readFileSync(fileURLToPath(import.meta.url))),
    workerSHA256: sha(readFileSync(worker)),
    bundleSHA256: sha(readFileSync(bundle)),
    sourceGraph: sources,
  },
  methodology: {
    baseline:
      "Actual target source files loaded with git show from baselineCommit; no hand-reimplemented baseline.",
    isolation:
      "All non-target dependencies resolve to candidateCommit. Baseline Vehicle imports the actual baseline RoadContactFrame; all other dependencies are shared. Both contact constructors use the identical candidate BVH and authored track data. Unrelated engine changes cannot explain the A/B difference.",
    frameAndClutch:
      "Actual baseline RoadContactFrame and Vehicle modules, with shared candidate dependencies. Baseline Vehicle imports baseline RoadContactFrame directly; no per-instance method patch is present during timing.",
    timing:
      "Sequential exclusive workers. Ten paired samples alternate baseline/candidate order, with five pairs of each order. Warmup precedes samples; explicit GC precedes each timed sample. Instrumentation, serialization, track/vehicle setup, comparison and GC are outside the timer.",
    heap: "One contact mesh/tree at a time. Baseline geometry is written to temporary binary files before the candidate is built and compared byte for byte. Each child has a 768 MiB old-space limit.",
    counts:
      "Instrumented proof workers count typed-array set calls with literal-array operands, Math.hypot calls and tire-array map calls. These semantic operation counts are distinct from physical allocator/GC counts.",
    catalogue:
      "No authored AWD definition enables engine.clutchCoupling at this revision. AWD microbenchmarks call the real method explicitly on real AWD Vehicle instances; this is dormant-branch evidence, not an active-catalogue runtime saving.",
    limits:
      "Node CPU evidence only. No renderer, browser, GPU, full-game FPS, physical-device or cross-machine claim. A controlled constructor includes the unchanged shared BVH cost. Hot-loop timings include identical input writes and checksum work.",
  },
  results: {},
};
function save() {
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
}
save();
try {
  for (const task of ["proof", "construction", "frame", "clutch", "substeps"]) {
    process.stderr.write(`w07b: ${task}\n`);
    const output = execFileSync(
      process.execPath,
      ["--expose-gc", "--max-old-space-size=768", bundle, task, scratch],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        timeout: 240000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    report.results[task] = JSON.parse(output);
    save();
  }
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  save();
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  save();
  throw error;
}
function timingRow(name, result) {
  return `| ${name} | ${result.operationsPerSample.toLocaleString("en-US")} | ${result.summary.baseline.medianMs.toFixed(3)} | ${result.summary.candidate.medianMs.toFixed(3)} | ${result.summary.pairedChangePercent.median.toFixed(2)}% | ${result.summary.pairedChangePercent.minimum.toFixed(2)}% to ${result.summary.pairedChangePercent.maximum.toFixed(2)}% |`;
}
const rows = [
  ...report.results.construction.scenarios.map((r) =>
    timingRow(`Constructor: ${r.circuitId}, ${r.rows} rows`, r),
  ),
  timingRow("Road-contact frame.set", report.results.frame),
  timingRow("Explicit dormant AWD coupleClutch", report.results.clutch),
  ...report.results.substeps.scenarios.map((r) =>
    timingRow(`Catalogue substeps: ${r.vehicleId}`, r),
  ),
];
const proof = report.results.proof;
const markdown =
  `# Wave 7 contact construction and math measurement\n\n` +
  `Measured ${report.recordedAt}. Baseline \`${options.baseline}\`; candidate \`${options.candidate}\`.\n\n` +
  `## Results\n\n` +
  `All exact-output checks passed. ${proof.geometry.length} real-track meshes matched byte for byte; ${proof.frames.cases} road-frame cases matched, including signed zero, near-threshold normals, overflow, invalid inputs and degenerate tangents. ${proof.clutch.cases} real-vehicle clutch cases and ${proof.trajectories.reduce((n, r) => n + r.substeps, 0)} paired vehicle substeps matched their complete captured state.\n\n` +
  `| Timed workload | Operations/sample | Baseline median ms | Candidate median ms | Median paired change | Paired range |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n\n` +
  `Negative change means the candidate was faster for that paired sample. A mixed-sign paired range is evidence of timing noise. Raw samples and warmups are retained in the adjacent JSON.\n\n` +
  `## Deterministic operation evidence\n\n` +
  `At 8,192 rows the original constructor passes 122,895 three-element arrays to normals.set and 114,688 six-element arrays to indices.set: 237,583 literal-array/set operations, containing 1,056,813 numeric entries. The scalar constructor performs none. Both versions write the same 122,895 vertices and 229,376 triangles, and use the same candidate BVH.\n\n` +
  `Each ordinary accepted road frame uses five Math.hypot calls before and four after. Invalid-input and degenerate-input cases retain baseline results, including state left behind on errors. Existing finite-sum/overflow behavior is preserved.\n\n` +
  `The AWD method performs one tires.map call per invocation before and none after. Only rear-drive sk125 and dk100 currently enable authored clutchCoupling; the AWD branch is dormant in ordinary catalogue stepping. The explicit AWD timing is a controlled future/caller-path measurement, not a demonstrated current-game speedup. No authored data or tuning was changed to activate it.\n\n` +
  `## Scope and reproducibility\n\n` +
  `The harness loads actual original target files using git show. All non-target dependencies are pinned to the candidate revision; the baseline Vehicle imports the actual baseline road frame. The separately changed BVH builder is identical in both constructor variants. Geometry is compared with Buffer.compare against temporary baseline binary files after the old tree is released. Binary Float64 serialization retains signed zero and non-finite frame and vehicle state.\n\n` +
  `Ten paired samples alternate order after warmup. GC, instrumentation, hashing, object setup and output verification are outside timing. Each child has a 768 MiB old-space cap and only one large contact mesh is live. Runtime: ${report.environment.node}, esbuild ${esbuildVersion}, ${report.environment.cpu}, ${report.environment.platform}/${report.environment.architecture}. Source blob IDs, fingerprints, resource usage and raw timings are in the JSON.\n\n` +
  `Run from the repository root, alone without browsers or other benchmarks:\n\n\`\`\`sh\nnode --max-old-space-size=768 scripts/bench/engine-followup-contact.mjs --baseline ${options.baseline} --candidate ${options.candidate} --output docs/engine/runtime-followup-2026-11-24/measurements/w07b-contact.json\n\`\`\`\n\n` +
  `No full-game FPS, GPU, browser or physical-device claim follows from this report. Real-vehicle substep timings combine frame work with the unchanged remainder of integration; small or noisy aggregate changes are reported as measured.\n`;
writeFileSync(options.output.replace(/\.json$/, "") + ".md", markdown);
process.stdout.write(`${options.output}\n`);
