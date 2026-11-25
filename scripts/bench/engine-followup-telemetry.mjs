#!/usr/bin/env node
/** Actual committed TelemetryRecorder.snapshot and CSV characterization.
 * Run alone with the exclusive compute/browser lease and installed dependencies.
 * node --max-old-space-size=768 scripts/bench/engine-followup-telemetry.mjs \
 *   --output /tmp/telemetry.json --mode node
 * For the optional native worker: --mode all and the existing PLAYWRIGHT_BROWSERS_PATH.
 * No npm hooks, git mutations, native TypeScript transforms, or maximum-capacity allocation.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {
  baseline: "1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb",
  current: "f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6",
  mode: "node",
  capacities: "600,6000,54000",
  pairs: "10",
  warmups: "3",
  "csv-repeats": "3",
};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index].replace(/^--/, "");
  if (!(name in args) && !["repo", "output", "work-dir"].includes(name))
    throw new Error(`Unknown argument ${name}`);
  if (!process.argv[index + 1]) throw new Error(`Missing value for ${name}`);
  args[name] = process.argv[index + 1];
}
assert.ok(["node", "browser", "all"].includes(args.mode));
const repo = path.resolve(
  args.repo ?? fileURLToPath(new URL("../..", import.meta.url)),
);
const require = createRequire(path.join(repo, "package.json"));
const { build, version: esbuildVersion } = require("esbuild");
const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
const refs = Object.fromEntries(
  ["baseline", "current"].map((role) => [
    role,
    git("rev-parse", `${args[role]}^{commit}`).toString().trim(),
  ]),
);
const workDir = args["work-dir"]
  ? path.resolve(args["work-dir"])
  : mkdtempSync(path.join(tmpdir(), "engine-followup-telemetry-"));
mkdirSync(workDir, { recursive: true });
const output = path.resolve(
  args.output ?? path.join(workDir, "telemetry-measurement.json"),
);
mkdirSync(path.dirname(output), { recursive: true });
const positive = (value) => {
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number) && number > 0);
  return number;
};
const settings = {
  pairs: positive(args.pairs),
  warmups: positive(args.warmups),
  csvRepeats: positive(args["csv-repeats"]),
  capacities: args.capacities.split(",").map(positive),
  targetBytesPerSample: 32 * 1024 * 1024,
};
for (const capacity of settings.capacities)
  assert.ok(capacity >= 60 && capacity <= 54000 && capacity % 60 === 0);
const sourceMap = new Map();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let nativeWorkerSource;
const plugin = {
  name: "unmodified-committed-telemetry-source",
  setup(builder) {
    builder.onResolve({ filter: /^engine:/ }, ({ path: specifier }) => {
      const name = specifier.slice("engine:".length);
      if (name === "baseline" || name === "current")
        return { path: name, namespace: "engine-entry" };
      assert.ok(["worker", "export"].includes(name));
      return {
        path: `current:${name === "worker" ? "src/workers/telemetry.worker.ts" : "src/storage/telemetry-export.ts"}`,
        namespace: "git-source",
      };
    });
    builder.onLoad(
      { filter: /.*/, namespace: "engine-entry" },
      ({ path: role }) => ({
        loader: "js",
        contents:
          `export { TelemetryRecorder } from '${role}:src/storage/recorders.ts';\n` +
          `export { CHANNELS, TELEMETRY_STRIDE, telemetryCsv } from '${role}:src/storage/telemetry-schema.ts';`,
      }),
    );
    builder.onResolve(
      { filter: /^(baseline|current):/, namespace: "engine-entry" },
      ({ path: source }) => ({ path: source, namespace: "git-source" }),
    );
    builder.onResolve(
      {
        filter: /telemetry\.worker\.ts\?worker&inline$/,
        namespace: "git-source",
      },
      () => {
        assert.equal(typeof nativeWorkerSource, "string");
        return {
          path: "native-worker-constructor",
          namespace: "worker-adapter",
        };
      },
    );
    builder.onLoad({ filter: /.*/, namespace: "worker-adapter" }, () => ({
      loader: "js",
      contents:
        `export default class InlineTelemetryWorker { constructor(options) {\n` +
        `const url = URL.createObjectURL(new Blob([${JSON.stringify(nativeWorkerSource)}], {type:'text/javascript'}));\n` +
        `try { return new Worker(url, options); } finally { URL.revokeObjectURL(url); } } }`,
    }));
    builder.onResolve(
      { filter: /^\./, namespace: "git-source" },
      ({ path: imported, importer }) => {
        const separator = importer.indexOf(":");
        const role = importer.slice(0, separator);
        const sourcePath = path.posix.normalize(
          path.posix.join(
            path.posix.dirname(importer.slice(separator + 1)),
            imported,
          ),
        );
        return { path: `${role}:${sourcePath}`, namespace: "git-source" };
      },
    );
    builder.onLoad(
      { filter: /.*/, namespace: "git-source" },
      ({ path: key }) => {
        const separator = key.indexOf(":");
        const role = key.slice(0, separator);
        const sourcePath = key.slice(separator + 1);
        if (!sourceMap.has(key)) {
          const content = git("show", `${refs[role]}:${sourcePath}`);
          sourceMap.set(key, {
            role,
            path: sourcePath,
            gitBlob: git("rev-parse", `${refs[role]}:${sourcePath}`)
              .toString()
              .trim(),
            sha256: sha256(content),
            bytes: content.length,
            content,
          });
        }
        return { contents: sourceMap.get(key).content, loader: "ts" };
      },
    );
  },
};

const report = {
  schema: 1,
  measuredAt: new Date().toISOString(),
  refs,
  settings,
  environment: {
    node: process.version,
    v8: process.versions.v8,
    esbuild: esbuildVersion,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    systemTotalMemoryBytes: totalmem(),
    childOldHeapMiB: 768,
  },
  methodology: [
    "Each version is bundled from its actual committed TypeScript tree using esbuild; no rewritten snapshot implementation.",
    "Fixtures call production appendBatch/truncate; equal exactly representable practice/session clocks isolate snapshot behavior.",
    "Snapshot timings include the production destination allocation and copy; explicit GC occurs outside every timed sample.",
    "Warmups and measured pairs alternate baseline/current order. Raw elapsed times and per-snapshot normalization are retained.",
    "At most two rings and two full verification snapshots are intentionally live together; fixtures run in separate sequential child processes.",
    "View/set/offset instrumentation runs after timings and measures method calls, not heap allocation bytes.",
    "CSV source is unchanged between refs and already formats 500 rows per chunk; CSV results characterize the existing implementation.",
    "No FPS claim; no browser-memory inference from Node/V8 or string code-unit counts.",
  ],
  capacities: {
    stride: 228,
    bytesPerRow: 912,
    default: {
      seconds: 900,
      rows: 54000,
      ringBytes: 49248000,
      ringPlusFullSnapshotBytes: 98496000,
    },
    configuredMaximumUnallocated: {
      seconds: 3600,
      rows: 216000,
      ringBytes: 196992000,
      ringPlusFullSnapshotBytes: 393984000,
    },
  },
  snapshots: [],
  csvNode: [],
  browser: null,
};

function save() {
  report.sources = [...sourceMap.values()]
    .map(({ content: _content, ...source }) => source)
    .sort(
      (a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path),
    );
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
}

if (args.mode !== "browser") {
  const bundle = path.join(workDir, "telemetry-node.bundle.mjs");
  await build({
    entryPoints: [
      fileURLToPath(
        new URL("./engine-followup-telemetry.runner.mjs", import.meta.url),
      ),
    ],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    plugins: [plugin],
  });
  report.nodeBundleSha256 = sha256(readFileSync(bundle));
  let index = 0;
  const run = (config) => {
    const prefix = `${String(index++).padStart(2, "0")}-${config.kind}-${config.capacity}-${config.state ?? "csv"}`;
    config.output = path.join(workDir, `${prefix}.json`);
    const configFile = path.join(workDir, `${prefix}.config.json`);
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    const child = spawnSync(
      process.execPath,
      ["--max-old-space-size=768", "--expose-gc", bundle, configFile],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    writeFileSync(
      path.join(workDir, `${prefix}.stdout.log`),
      child.stdout ?? "",
    );
    writeFileSync(
      path.join(workDir, `${prefix}.stderr.log`),
      child.stderr ?? "",
    );
    if (child.status !== 0)
      throw new Error(`${prefix} failed: ${child.error ?? child.stderr}`);
    process.stdout.write(child.stdout);
    return JSON.parse(readFileSync(config.output, "utf8"));
  };
  const states = [
    "unwrapped-partial",
    "unwrapped-full",
    "wrapped-full",
    "truncated-wrap",
    "truncated-resumed",
  ];
  report.snapshots.push(
    run({
      kind: "snapshot",
      capacity: 60,
      state: "empty",
      ...settings,
      iterations: 1000,
    }),
  );
  save();
  for (const capacity of settings.capacities) {
    for (const state of states) {
      const rows =
        state === "unwrapped-partial"
          ? capacity * 0.6
          : state === "truncated-wrap"
            ? capacity * 0.75
            : capacity;
      const iterations = Math.max(
        2,
        Math.min(128, Math.floor(settings.targetBytesPerSample / (rows * 912))),
      );
      report.snapshots.push(
        run({ kind: "snapshot", ...settings, capacity, state, iterations }),
      );
      save();
    }
    report.csvNode.push(run({ kind: "csv", ...settings, capacity }));
    save();
  }
}

if (args.mode !== "node") {
  const worker = await build({
    stdin: { contents: "import 'engine:worker';", resolveDir: repo },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    plugins: [plugin],
  });
  nativeWorkerSource = worker.outputFiles[0].text;
  const browserBuild = await build({
    entryPoints: [
      fileURLToPath(
        new URL("./engine-followup-telemetry.browser.mjs", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "TelemetryMeasurement",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    plugins: [plugin],
  });
  const browserFixture = browserBuild.outputFiles[0].text;
  writeFileSync(
    path.join(workDir, "telemetry-browser.bundle.js"),
    browserFixture,
  );
  writeFileSync(
    path.join(workDir, "telemetry-worker.bundle.js"),
    nativeWorkerSource,
  );
  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--js-flags=--max-old-space-size=768"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://telemetry.invalid/measurement", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Telemetry measurement</title>",
      }),
    );
    await page.goto("http://telemetry.invalid/measurement");
    await page.addScriptTag({ content: browserFixture });
    let timeout;
    try {
      report.browser = await Promise.race([
        page.evaluate(() => globalThis.TelemetryMeasurement.run(54000)),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error("Native telemetry measurement exceeded 120 seconds"),
              ),
            120000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.deepEqual(errors, []);
    Object.assign(report.browser, {
      browserVersion: browser.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      workerBundleSha256: sha256(nativeWorkerSource),
      fixtureBundleSha256: sha256(browserFixture),
      pageErrors: errors,
    });
    process.stdout.write(JSON.stringify(report.browser) + "\n");
  } finally {
    await browser.close();
  }
  save();
}
report.completedAt = new Date().toISOString();
save();
process.stdout.write(`Telemetry evidence written: ${output}\n`);
