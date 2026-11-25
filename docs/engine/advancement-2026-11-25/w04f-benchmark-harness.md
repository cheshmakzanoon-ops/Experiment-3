# W04F — paired benchmark support for wave 7

Assignment 24/60. This adds support code and one small correctness smoke. It
changes no production engine, dependencies, authored content, or existing
reports. **No feature benchmark or performance acceptance measurement ran.**
The smoke deliberately records no workload durations.

## Files and API

- `scripts/engine-advancement/benchmark-support.mjs`: source preparation,
  paired execution, checksums, seed/median utilities, optional owned lock,
  and explicit JSON output.
- `scripts/engine-advancement/benchmark-smoke.mjs`: runnable example using
  the actual unchanged `src/core/math.ts` from both trees.

| Export                                                                                                  | Contract                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ORIGINAL_BASELINE`                                                                                     | Full original commit `350119e8ec0606e8c5de5b3ab80df41104025679`.                                                               |
| `prepareModule({ root, entry, expectedCommit?, allowDirty = false, mode = 'native', extraFiles = [] })` | Returns `{ identity, load({ fresh = false }), assertStable() }`. Root is absolute; entry and extra files belong to that tree.  |
| `runPaired(options)`                                                                                    | Returns a JSON-ready report. It writes nothing and performs no process spawning for timed work. Callback details follow below. |
| `seeded(uint32Seed)`                                                                                    | Independent deterministic Mulberry32 random stream, including seed zero.                                                       |
| `sha256(bytes)` / `median(numbers)`                                                                     | SHA-256 and ordinary numeric median; an even sample count averages its two middle values.                                      |
| `withTimingLock(absolutePath, async owner => result)`                                                   | Creates an exclusive `wx` lock with PID/host/token; removes only its own lock in `finally`. It never steals an existing lock.  |
| `writeReport(absolutePath, report)`                                                                     | Caller chooses the path; creates parents and refuses to overwrite an existing file.                                            |

This is a callback helper, not a new test runner. The complete executable
example is the smoke script; each wave-7 workload owns its fixtures, operation
counts, exact equality policy, and result checksums.

## Source identity and actual baseline loading

Use the existing read-only original tree at
`/dev/shm/aeebac160835-engine-baseline`. The candidate root is explicit too:
`/tmp/aeebac160835-engine/Experiment-3`. Neither helper creates or checks out
trees, changes Git state, installs dependencies, runs npm hooks, or invokes a
browser.

`prepareModule` runs the installed esbuild once with `write: false`, no
minification, and no tree shaking. An `onLoad` callback hashes the exact file
bytes it passes to esbuild; the metafile must contain no unrecorded input.
Inputs outside the selected tree and its resolved `node_modules` are rejected.
Only Node builtins may remain external. Both native and bundle modes preserve
the actual implementation from their respective roots; neither substitutes a
reimplementation as the timing baseline.

The identity includes the root, full HEAD, expected commit, every static source
input's absolute path/byte length/SHA-256, `package.json`, `package-lock.json`,
`tsconfig.json`, requested extra files, relevant Git status, dependency symlink
target, esbuild version/options, and emitted bundle hash. Node/runtime/CPU
metadata and hashes of the helper and workload script accompany the report.
The pair requires matching lock hashes, distinct roots, the same loader mode,
and an explicitly pinned baseline commit.

Dirty graph inputs fail by default. Use `allowDirty: true` explicitly for a
reviewable candidate snapshot; its actual dirty file hashes and Git status
remain in the report. A HEAD identifier alone never substitutes for those
hashes. Files, HEAD, relevant status, and benchmark code are checked before and
after execution; changes abort the report. The smoke's selected math graph is
clean even though unrelated production work was in progress.

The native loader imports the original `.ts` entry by its real file URL. The
repository's parameter properties require the already available Node 24
transform flag:

```sh
node --no-warnings --experimental-transform-types /absolute/path/workload.mjs
```

The helper uses esbuild's static graph for native identity too. Use a fresh Node
process, default Node resolution, and this repository's explicit `.ts` imports;
do not pre-import or change these modules before preparation. Computed imports,
runtime `fs` reads, custom loaders/conditions, or a different package-resolution
policy need workload-specific source review. Declare runtime fixture files with
`extraFiles`. If fixture helpers live in separate scripts, preserve/hash those
too; the helper automatically hashes only `workloadFile` and itself. Lock hashes
do not independently certify an entire installed dependency tree.

## Paired execution

The required callbacks are:

```js
prepare({ api, side, phase, pair, seed, random }) => state
run(state, { iterations, seed, side }) => result
observe(result, state, context) => evidence
compare(baselineEvidence, currentEvidence, { phase, pair, seed }) => ({
  equal: true,
  checksums: { baseline: '...', current: '...' },
  // Optional JSON-safe details: byte counts, maximum error, mismatched field.
})
dispose(state, context) // optional; executes in finally
```

Only the single synchronous `run` callback is timed. A Promise result is
rejected. **The workload implements its own `iterations` loop** so the helper
adds no per-operation dispatch. `unitsPerIteration` and `unit` declare the
denominator; the helper cannot infer whether the workload counted correctly.
Use a returned result or changed state that `observe` consumes.

Imports, fixture preparation/allocation, observation, equality checks, cleanup,
and report I/O remain outside that interval. An allocation performed by the
actual production operation inside `run` stays inside its duration. Required
`scope` strings describe `timedWork`, `setupWork`, `allocationScope`, and
`limitations`; build/import/setup/observation costs are recorded separately.
These are durations and declarations, not heap or allocation instrumentation.

Both sides receive the same derived seed and an independent PRNG per pair.
Warmup pairs precede sample pairs. Each phase alternates baseline/current then
current/baseline. Raw samples retain order, seed, total milliseconds,
milliseconds per declared unit, checksums, and full supplied equality results.
Medians use only sample pairs; no outlier deletion or hidden resampling occurs.
Warmup results are also checked and retained. A false equality result preserves
the report with `equivalence.passed: false` and
`timing.validForComparison: false`; after writing that evidence, the workload
should assert `report.equivalence.passed`. Throwing callbacks or source drift
abort instead of yielding a success report.

For timing, use `purpose: 'measurement'` and set `exclusiveCompute: true` only
after the coordinator has reserved exclusive local compute. The optional lock
is cooperative; unrelated tests, builds, browsers, and other workloads do not
honor it automatically. Arrange the reservation first and hold one common lock
around source preparation and the full run, for example:

```js
await withTimingLock('/tmp/aeebac160835-engine-wave7.lock', async (lock) => {
  const sources = {
    baseline: await prepareModule({
      root: baselineRoot,
      entry,
      expectedCommit: ORIGINAL_BASELINE,
    }),
    current: await prepareModule({ root: currentRoot, entry }),
  };
  const report = await runPaired({
    name,
    sources,
    workloadFile: fileURLToPath(import.meta.url),
    seed: 0x7a11,
    warmupPairs: 3,
    samplePairs: 9,
    iterations,
    unitsPerIteration,
    unit,
    purpose: 'measurement',
    exclusiveCompute: true,
    lock,
    scope,
    prepare,
    run,
    observe,
    compare,
  });
  writeReport(outputPath, report);
  assert(report.equivalence.passed);
});
```

The snippet's fixtures/counts/callbacks are workload-defined, as in the complete
smoke script. Use a new output filename for each run. An existing lock is a
hard failure; its recorded owner must be checked before the coordinator
manually removes a stale lock. No automatic stale-lock recovery is attempted.

## Cold audio and warm workloads

For an entirely fresh audio cache, prepare **both** sides with `mode: 'bundle'`
and choose `moduleLifetime: 'fresh-per-sample'` in `runPaired`. Each load uses a
unique data URL for the whole self-contained graph. Merely adding a query to a
native entry would leave imported dependencies cached, so that form of fresh
loading is explicitly rejected.

The compile runs once per side, outside timing. Module evaluation happens
outside each timed sample. Then construct the required profile/inputs in
`prepare` and call the actual `loudnessScale` or `normalisedWavePower` in `run`.
For a first-family cold sample, use one invocation: lazy sine-basis and waveform
cache creation must stay inside it. Iterating many times would average a cold
call together with warm calls. For hot audio, use `moduleLifetime: 'reuse'`, keep
the same profile object per side, and explicitly prime its waveform cache in
setup or retain it through warmups. A new profile object each sample tests a
different cache state and must be labeled accordingly.

Fresh ESM instances remain in Node's module cache. Keep cold sample counts
bounded and launch a new process for another scenario. This resets module-owned
state, not the entire VM, CPU cache, or allocator; it is unsuitable for claiming
cold-process startup or retained-heap savings. No forced GC, worker process
pool, browser shim, allocation patching, or instrumentation is installed.

## Wave-7 workload boundaries

| Workload                     | Actual entry and required separation                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lane lookup                  | `src/simulation/track.ts`; construct matching Tracks outside the nearest-query interval; separate cold cell building, warm reuse, misses/overpass fallback. Compare returned values and fields.                                                                                                                                       |
| Surface update               | `src/simulation/track.ts`; hold initial state/weather/shelter/drainage/input schedules equal. Exclude construction. Compare surface arrays and relevant scalars at the declared evolution boundaries.                                                                                                                                 |
| Network snapshot/input       | `src/net/codec.ts`; actual original encoders are the baseline. Keep broadcast recipient counts explicit. Account for candidate snapshot preparation once per broadcast, rather than removing its required work from the measured operation. Compare complete packet bytes and decoder outcomes.                                       |
| Audio cold/hot               | `src/audio/engine-loudness.ts`; distinguish module-cold first family, warm basis with a fresh family, and already cached profile updates. Preserve exact numeric outputs including nonfinite/signed-zero policy.                                                                                                                      |
| Attribute uploads/helper CPU | `src/rendering/attribute-ranges.ts`; separate helper CPU from actual Three uploader byte/call observations. Use baseline helper from its actual tree. An upload-recording shim cannot establish native GPU duration.                                                                                                                  |
| Combined Simulation          | `src/simulation/world.ts`; create actual baseline/current Simulation instances and apply identical deterministic schedules. Keep construction separate. Compare packed frames **and** the required Float64/internal state, weather/surface state, ordering and event outcomes; aggregate checksums alone must not conceal a mismatch. |

Fixture guidance already exists in `w02a-lane-index.md`, `w02e-surface.md`,
`w02f-snapshot-batch.md`, `w03a-audio-coefficients.md`, `w03c-attribute-ranges.md`,
`w04a-audio-sine-basis.md`, and `w04c-input-encoder-capacity.md`. Inspected local
proofs include `/tmp/aeebac160835-surface-coefficients-probe.mjs`,
`/tmp/aeebac160835-engine/w04c-input-encoder-capacity-proof.mjs`, and the audio
probe/saved module under `/tmp/aeebac160835-audio-audit/`. Their fixtures and
comparison details are useful; extracted, patched, or reconstructed references
in older probes must not replace the original checkout as the primary timing
baseline. The helper does not convert these proofs into accepted timings.

## Executed validation and inspected smoke JSON

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/benchmark-smoke.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/validation/w04f-benchmark-smoke-final.json

node node_modules/eslint/bin/eslint.js \
  scripts/engine-advancement/benchmark-support.mjs \
  scripts/engine-advancement/benchmark-smoke.mjs
```

The real unchanged math module produced **five equivalent pairs**, two warmup
and three sample, comparing **2,560 output bytes**. The sample orders were AB,
BA, AB; every pair retained matching SHA-256 values. Seed zero reproducibility
and odd/even median calculations also passed. Two fresh bundled imports of the
actual baseline math module yielded distinct namespaces and `Vec3` constructors.

The inspected JSON records Node **v24.22.3**, esbuild **0.25.12**, original HEAD
`350119e8ec0606e8c5de5b3ab80df41104025679`, source/lock/harness hashes, and stable
inputs. The selected math SHA-256 is
`7f32bf1fcb9c784129594225d2bae7073fbb87cfbc54c890994db46b71f452d0`; the shared lock
SHA-256 is `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`.
Every workload duration and both median fields are **null**;
`timing.validForComparison` is **false** with the explicit smoke-only reason.
Preparation diagnostics are not feature performance measurements. Scoped ESLint
passed. Broad validation, exclusive timing, and publication remain with the
coordinator and subsequent waves.
