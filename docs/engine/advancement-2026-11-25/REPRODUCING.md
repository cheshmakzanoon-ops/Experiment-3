# Reproducing the engine advancement programme

This guide separates **replaying a recorded workload at its original source**
from **validating or measuring the final candidate**. A successful rerun produces
new evidence. It does not replace a retained JSON file, reproduce a historical
wall-clock duration exactly, or extend a measurement to source it did not execute.

The original baseline is `350119e8ec0606e8c5de5b3ab80df41104025679`. The final
executable candidate covered here is
`774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`, tree
`5f466294eca0b188db58375a1caf4cd76088527b`. Later documentation or report-bot
commits need their own identities; a moving `main` name is not a substitute for
these pins. [CHECKPOINTS.md](CHECKPOINTS.md) records the publication sequence.

**Recorded final acceptance:** workflow
[45592833399](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399)
at that candidate passed 914 tests in 70 files, full TypeScript checking, the
product/full Vite build, and all 47 selected native/replay cases, with no failures,
flaky cases or skips. Artifact `15012585753` has original ZIP SHA-256
`3ae96693bf5bc12acdbd449592ef36b94bd1d05ffa9a1ce492d24e401cb2598a`.
Its [retained receipt](evidence/checkpoint-774e62f/result.json) identifies the
source, build, logs and actual Mesa/ANGLE llvmpipe backend. Native acceptance
retains the material-path limitation explained below.

## 1. Choose the evidence you intend to reproduce

The six original measurement areas used two source snapshots. The later
crossover and range review used two additional snapshots. The benchmark runner
and the source under test are separate inputs: some runners were committed
after the source they measured. Use the preserved runner whose hash matches the
report, and supply the historical source through `--current`.

| Source role                | Full commit                                | Used by retained evidence                                                                                    |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Original baseline          | `350119e8ec0606e8c5de5b3ab80df41104025679` | Every original/current comparison                                                                            |
| Early W07 candidate        | `aaaf5001a9e13e3e6839fc7ecada7b542a4005bc` | Lane and surface measurements                                                                                |
| Remaining W07 candidate    | `6a1c76fae3736e4d814ab6d0a354f6837320731c` | Network, audio, original attribute and integrated simulation measurements                                    |
| Crossover/review source    | `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b` | Snapshot crossover and physics-cache edge proof                                                              |
| Revised range source       | `26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1` | Revised attribute measurement; expanded unit gate passed, subsequent compiler gate failed at this checkpoint |
| Final executable candidate | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` | Final focused unit/compiler/build/native acceptance and W09D baseline-failure comparison                     |

| Area and preserved runner        | Historical measurement                                                                                | Scope and default measured workload                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure-lanes.mjs`              | [lane-measurement.json](evidence/lane-measurement.json)                                               | 18 cases: warm queries, cold streams, fallback controls and construction; 3 warmup/9 sample pairs; case-specific 8, 128 or 256 iterations   |
| `measure-surfaces.mjs`           | [surface-measurement.json](evidence/surface-measurement.json)                                         | 7 cases; 3/9 pairs; 16 repetitions except the deliberately cold first tick, which uses 1                                                    |
| `measure-network.mjs`            | [network-measurement.json](evidence/network-measurement.json)                                         | 10 snapshot/input cases; 3/9 pairs; 8,192 complete fixture iterations per arm                                                               |
| `measure-audio.mjs`              | [audio-measurement.json](evidence/audio-measurement.json)                                             | 8 cold/warm arithmetic cases; 2/8 pairs; 8,192 hot iterations, 4,000,000 zero-gain control iterations, 32 fresh profiles where applicable   |
| `measure-attributes.mjs`         | [attribute-measurement.json](evidence/attribute-measurement.json)                                     | Original coalescer: all 26 cases in both helper and mark-plus-recording-upload scopes; 3/9 pairs; target 250,000 helper marks per sample    |
| `measure-simulation.mjs`         | [simulation-measurement.json](evidence/simulation-measurement.json)                                   | 6 actual Simulation cases; 3/9 pairs; 480 measured steps at 1/120 second plus separate audit/priming work                                   |
| `measure-snapshot-crossover.mjs` | [snapshot-crossover-measurement-6cb1c881.json](evidence/snapshot-crossover-measurement-6cb1c881.json) | 22 cases; 3/9 pairs; 4,096 broadcasts; both measured arms use the same current codec; original source is an untimed wire/decode oracle      |
| `measure-attributes-review.mjs`  | [attribute-review-measurement-26efaeef.json](evidence/attribute-review-measurement-26efaeef.json)     | Revised range representation: the same 26 cases, two scopes, 3/9 pairs and target mark count; independent pending-component coverage oracle |

The original attribute runner requires the old canonical pending-list
representation. **Use the review runner for the final candidate.** Its exact
coverage, version, bounds and uploaded-byte assertions preserve the external
contract; rewriting the old runner to accept the new representation would erase
the historical comparison. [W08E](w08e-render-resources-review.md) explains the
separate runner and the residual CPU regressions.

The network W07 and crossover tools measure codec workloads, including explicit
preparation inside a broadcast. They do not execute the complete server dispatch
policy. Production's later 12-recipient preparation threshold is validated
separately in [W08B](w08b-network-review.md) and
[snapshot-crossover-policy-validation.json](evidence/snapshot-crossover-policy-validation.json).

## 2. Prepare isolated source trees and locked dependencies

The following Bash commands are **reproduction recipes**. Their direct tool
invocations match the retained reports and checked-in workflow; this guide's
author inspected commands, JSON and hashes without running another test, build,
browser or timing workload. Use a checkout containing the pinned Git objects.
Adjust only `ENGINE_REPOSITORY` to its absolute location on another machine.

Full worktrees avoid misclassifying a file omitted by sparse checkout as a
product failure. The programme's original sparse baseline was at
`/dev/shm/aeebac160835-engine-baseline`; the recipes use fresh disk-backed trees
and a new output directory instead. They do not generate models or edit authored
content. Create only the historical worktrees needed for your chosen evidence.

```bash
set -euo pipefail
ENGINE_REPOSITORY=/tmp/aeebac160835-engine/Experiment-3
ENGINE_REPRO_ROOT="$(mktemp -d /tmp/engine-reproduction.XXXXXXXX)"
ENGINE_BASELINE_COMMIT=350119e8ec0606e8c5de5b3ab80df41104025679
ENGINE_CURRENT_COMMIT=774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86
ENGINE_EARLY_COMMIT=aaaf5001a9e13e3e6839fc7ecada7b542a4005bc
ENGINE_W07_COMMIT=6a1c76fae3736e4d814ab6d0a354f6837320731c
ENGINE_CROSSOVER_COMMIT=6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b
ENGINE_RANGES_COMMIT=26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1
ENGINE_BASELINE="$ENGINE_REPRO_ROOT/original"
ENGINE_CURRENT="$ENGINE_REPRO_ROOT/current"
ENGINE_RESULTS="$ENGINE_REPRO_ROOT/results"
ENGINE_RUNNERS="$ENGINE_CURRENT/scripts/engine-advancement"
ENGINE_TIMING_LOCK=/tmp/aeebac160835-engine-wave7.lock
mkdir "$ENGINE_RESULTS"

git -C "$ENGINE_REPOSITORY" worktree add --detach \
  "$ENGINE_BASELINE" "$ENGINE_BASELINE_COMMIT"
git -C "$ENGINE_REPOSITORY" worktree add --detach \
  "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"

engine_require_pin() {
  test "$(git -C "$1" rev-parse HEAD)" = "$2"
  test -z "$(git -C "$1" status --porcelain=v1 --untracked-files=all)"
}
engine_require_pin "$ENGINE_BASELINE" "$ENGINE_BASELINE_COMMIT"
engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"

(cd "$ENGINE_CURRENT" && npm ci --ignore-scripts --no-audit --no-fund)
cmp "$ENGINE_CURRENT/package-lock.json" "$ENGINE_BASELINE/package-lock.json"
ln -s "$ENGINE_CURRENT/node_modules" "$ENGINE_BASELINE/node_modules"

node --version > "$ENGINE_RESULTS/node-version.txt"
git -C "$ENGINE_CURRENT" rev-parse HEAD > "$ENGINE_RESULTS/source-commit.txt"
git -C "$ENGINE_CURRENT" rev-parse 'HEAD^{tree}' > "$ENGINE_RESULTS/source-tree.txt"
sha256sum "$ENGINE_CURRENT/package-lock.json" > "$ENGINE_RESULTS/package-lock.sha256"
```

The package requires Node at least 22.12.0. The retained local measurements used
Node **24.22.3**, V8 **13.6.233.17-node.63**, Linux/x64 on the recorded AMD EPYC
host; their reports retain the complete runtime identity. The focused CI workflow
uses Node **22**. Choose the corresponding runtime before executing the relevant
recipes and preserve the actual version receipt. Changing runtimes, machine,
load or installation produces a new measurement context.

The lockfile SHA-256 at the recorded pins is
`610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`.
The shared dependency symlink is deliberate: pairwise source roots remain
distinct while both resolve the same locked installation. The helper records
the resolved dependency root and actual imported dependency bytes. Do not run
`npm ci` inside a tree after attaching that shared symlink; install once in its
owner or use a separate locked installation.

`npm ci --ignore-scripts` avoids installation lifecycle hooks. The checked-in CI
uses `npm ci --no-audit --no-fund` inside the source-stability guard; it does not
currently include `--ignore-scripts`. The root package has no install/prepare
hook, while dependency installation hooks are a separate concern. The commands
below call installed binaries directly. **Do not substitute `npm test`,
`npm run build`, `npm run dev` or `npm run check`:** this package's
`pretest`, `prebuild` and `predev` generate player LOD assets. See
[package.json](../../../package.json) and [W09B](w09b-build-static-acceptance.md).

### Optional historical trees

For all eight historical measurement recipes, add these four trees and share
the already installed dependencies only after their lockfiles match:

```bash
ENGINE_EARLY_ROOT="$ENGINE_REPRO_ROOT/aaaf5001"
ENGINE_W07_ROOT="$ENGINE_REPRO_ROOT/6a1c76fa"
ENGINE_CROSSOVER_ROOT="$ENGINE_REPRO_ROOT/6cb1c881"
ENGINE_RANGES_ROOT="$ENGINE_REPRO_ROOT/26efaeef"
git -C "$ENGINE_REPOSITORY" worktree add --detach "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
git -C "$ENGINE_REPOSITORY" worktree add --detach "$ENGINE_W07_ROOT" "$ENGINE_W07_COMMIT"
git -C "$ENGINE_REPOSITORY" worktree add --detach "$ENGINE_CROSSOVER_ROOT" "$ENGINE_CROSSOVER_COMMIT"
git -C "$ENGINE_REPOSITORY" worktree add --detach "$ENGINE_RANGES_ROOT" "$ENGINE_RANGES_COMMIT"
for ENGINE_SOURCE_ROOT in "$ENGINE_EARLY_ROOT" "$ENGINE_W07_ROOT" \
  "$ENGINE_CROSSOVER_ROOT" "$ENGINE_RANGES_ROOT"; do
  cmp "$ENGINE_CURRENT/package-lock.json" "$ENGINE_SOURCE_ROOT/package-lock.json"
  ln -s "$ENGINE_CURRENT/node_modules" "$ENGINE_SOURCE_ROOT/node_modules"
done
engine_require_pin "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
engine_require_pin "$ENGINE_W07_ROOT" "$ENGINE_W07_COMMIT"
engine_require_pin "$ENGINE_CROSSOVER_ROOT" "$ENGINE_CROSSOVER_COMMIT"
engine_require_pin "$ENGINE_RANGES_ROOT" "$ENGINE_RANGES_COMMIT"
```

For **new measurements on the final candidate**, instead select these aliases
before using sections 5 and 6. The original attribute command is explicitly
excluded; use the revised attribute command.

```bash
ENGINE_EARLY_ROOT="$ENGINE_CURRENT"
ENGINE_EARLY_COMMIT="$ENGINE_CURRENT_COMMIT"
ENGINE_W07_ROOT="$ENGINE_CURRENT"
ENGINE_W07_COMMIT="$ENGINE_CURRENT_COMMIT"
ENGINE_CROSSOVER_ROOT="$ENGINE_CURRENT"
ENGINE_CROSSOVER_COMMIT="$ENGINE_CURRENT_COMMIT"
ENGINE_RANGES_ROOT="$ENGINE_CURRENT"
ENGINE_RANGES_COMMIT="$ENGINE_CURRENT_COMMIT"
```

### Check preserved runner identities without executing them

All eight workload scripts and the common helper matched their recorded hashes
when this guide was prepared. This read-only recipe checks every nested
`evidenceFiles` record in the historical measurement files against the selected
runner tree. Absolute paths in old reports identify the original location;
relocation is acceptable only while the bytes and source pins remain verified.

```bash
python3 - "$ENGINE_REPOSITORY" "$ENGINE_RUNNERS" <<'PY'
import hashlib, json, sys
from pathlib import Path
evidence = Path(sys.argv[1]) / 'docs/engine/advancement-2026-11-25/evidence'
runners = Path(sys.argv[2])
names = [
    'lane-measurement.json', 'surface-measurement.json',
    'network-measurement.json', 'audio-measurement.json',
    'attribute-measurement.json', 'simulation-measurement.json',
    'snapshot-crossover-measurement-6cb1c881.json',
    'attribute-review-measurement-26efaeef.json',
]
def records(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.endswith('.mjs') and isinstance(child, dict) and 'sha256' in child:
                yield Path(key).name, child['sha256']
            yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)
for name in names:
    identities = set(records(json.loads((evidence / name).read_text())))
    assert identities, name
    for script, expected in identities:
        actual = hashlib.sha256((runners / script).read_bytes()).hexdigest()
        assert actual == expected, (name, script, expected, actual)
    print(name, 'runner identities match')
PY
```

The common helper's retained SHA-256 is
`dd913599e80387a2e9f8e34364e5bd57b5a2845e9d330966430183eafe2d7522`.
This check verifies runner bytes, not successful execution or the entire source
tree. The helper's source manifests and Git pin checks provide the latter's
declared import scope during execution.

## 3. Reproduce current correctness and build gates

Run these outside any reserved performance window. Keep the source trees frozen
throughout each guarded command, including documentation: the source-stability
wrapper observes more than executable files. A fresh `ENGINE_RESULTS` directory
keeps logs separate from source inputs and prevents replacing historical logs.

### Focused units: 70 files at the final candidate

This is the exact workflow selection: 63 engine-prefixed files and seven named
suites at `774e62fa`. The [selection manifest](evidence/w09-unit-selection.json)
and [W09A](w09a-consolidated-unit-acceptance.md) distinguish path inventory from
actual executed test counts. Shell expansion is intentional; run at the source
root. Leave optional attribute timing disabled.

```bash
cd "$ENGINE_CURRENT"
engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"
unset ENGINE_ATTRIBUTE_RANGE_BENCH
test ! -e "$ENGINE_RESULTS/engine-runtime-unit.log"
NODE_OPTIONS=--max-old-space-size=1024 \
node --experimental-transform-types scripts/source-stability.ts -- \
  node node_modules/vitest/vitest.mjs run tests/engine-*.test.ts \
  tests/circuit-frame-transport.test.ts tests/circuit-preparation-lifetime.test.ts \
  tests/circuit-startup-settlement.test.ts tests/festival-ground-height.test.ts \
  tests/festival-renderer-loader-lifecycle.test.ts tests/festival-session-lifecycle.test.ts \
  tests/surface-channel-backpressure.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 \
  2>&1 | tee "$ENGINE_RESULTS/engine-runtime-unit.log"
```

`set -euo pipefail` from setup is required so `tee` cannot conceal a failure.
The local consolidated attempt at `26efaeef` was killed after 113.549 seconds,
with only 10 completed file summaries/122 tests and no final summary or machine
report. It is **incomplete**, not a 914-test pass. Final exact-source CI supplies
the complete acceptance result. Do not shrink the selection or repeatedly run
resource-limited broad checks to manufacture a completed local result.

### Full TypeScript and direct production build

```bash
cd "$ENGINE_CURRENT"
engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"
test ! -e "$ENGINE_RESULTS/engine-runtime-build.log"
NODE_OPTIONS=--max-old-space-size=4096 \
node --experimental-transform-types scripts/source-stability.ts -- bash -c \
  'node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build' \
  2>&1 | tee "$ENGINE_RESULTS/engine-runtime-build.log"
```

The compiler covers the project's configured `src`, tests, e2e and TypeScript
scripts/configuration; existing `skipLibCheck` remains in force. It does not
typecheck the `.mjs` benchmark tools. `&&` means a compiler failure prevents the
build. Retain `dist/BUILD_IDENTITY.json` with the commit/tree/lock receipts.
The build produces the existing product/full output; it does not run the
player-asset prebuild hook. [W09B](w09b-build-static-acceptance.md) documents the
identity and output-guard boundaries.

At `26efaeef`, the expanded unit gate passed but `TS2352` rejected the controlled
UI fixture cast; Vite did not execute and native tests were skipped. The final
candidate's explicit cast through `unknown` corrected that typing boundary
without changing emitted runtime behavior. Preserve that earlier failure and
the final successful receipt as separate executions.

### Native browser/replay scope and environment

Use the checked-in
[focused workflow](../../../.github/workflows/engine-runtime-validation.yml)
on a permitted browser host. It runs Ubuntu 24.04, Node 22, one browser worker,
zero retries, `--forbid-only`, a 20-minute job deadline and a Mesa software
backend. Its browser glob plus `e2e/replay-state.spec.ts` selects 47 cases at the
final source. A manually dispatched workflow must still be checked against its
actual resolved SHA; selecting a moving branch does not pin an earlier result.

On an equivalent Ubuntu host, **after the unit and build gates**, the workflow's
system/browser preparation and native command are:

```bash
cd "$ENGINE_CURRENT"
sudo python3 scripts/ci-ubuntu-https.py
npx playwright install --with-deps chromium
sudo apt-get install -y libgl1-mesa-dri libegl1 libglx-mesa0 mesa-utils xvfb imagemagick

engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"
test ! -e "$ENGINE_RESULTS/engine-runtime-browser.log"
CI=1 APEX_BROWSER_BACKEND=mesa APEX_MOTOCROSS_XVFB_CAPTURE=1 \
LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe \
NODE_OPTIONS=--max-old-space-size=4096 \
node --experimental-transform-types scripts/source-stability.ts -- \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  node node_modules/@playwright/test/cli.js test \
  e2e/engine-native-*.spec.ts e2e/replay-state.spec.ts \
  --workers=1 --retries=0 --forbid-only \
  2>&1 | tee "$ENGINE_RESULTS/engine-runtime-browser.log"
```

`npx` above resolves the already installed, locked Playwright package. The
existing [Playwright configuration](../../../playwright.config.ts) starts
`npm run preview -- --port 4173`; this package has no `prepreview` hook. `CI=1`
prevents reuse of an unrelated server already listening on that port. The
build must exist before preview starts. Leave `CHROMIUM_PATH` unset unless
deliberately testing and recording a different browser binary.

Preserve `test-results/`, `playwright-report/`, `browser-backend.json`,
`browser-progress.json`, `dist/BUILD_IDENTITY.json`, the three complete logs and
source/tree/lock receipts. The workflow uploads them even on failure, with a
seven-day retention period. Record workflow/job/artifact IDs and the original
ZIP digest before retention expires; a downloaded duplicate is not another run.

**The local programme container could not launch Chromium:** its established
failure was `socket() failed: Operation not permitted`, before a test could run.
Use permitted CI; neither retrying that launch nor bypassing the restriction is
a reproduction step. Compilation, fixture bundling and Playwright discovery
are separate checks and must not be called native execution.

## 4. Untimed exact-module proofs

These commands compare actual source implementations. They collect no workload
performance samples and need no timing lock. They still execute real workloads,
so schedule them outside a measurement reservation. Run each once per new output
directory; the proof writers refuse to overwrite their result files.

```bash
engine_require_pin "$ENGINE_BASELINE" "$ENGINE_BASELINE_COMMIT"
engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/benchmark-smoke.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CURRENT" \
  --output "$ENGINE_RESULTS/harness-smoke.json"

node "$ENGINE_RUNNERS/network-composition-proof.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CURRENT" \
  --output "$ENGINE_RESULTS/network-composition-current.json"

node "$ENGINE_RUNNERS/audio-composition-proof.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CURRENT" \
  --output "$ENGINE_RESULTS/audio-composition-current.json"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/physics-cache-edge-proof.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CURRENT" \
  --output "$ENGINE_RESULTS/physics-cache-edges-current.json"
```

The harness smoke uses unchanged real core math and tests helper behavior; it
does not demonstrate an engine speedup. Physics edge proof checks actual
original/current arithmetic, signed-zero and finite extremes, relevant
rejections and cache invalidation. To reproduce its retained historical source,
use the `6cb1c881` worktree from section 2 as `--current`, verify its pin, and use
a distinct output name. See [W04F](w04f-benchmark-harness.md) and
[W08A](w08a-physics-cache-review.md).

The W05 network/audio tools predate the common helper. They extract a workload
from the current tree's integration test, execute original/current modules in
separate sequential Node processes, and record selected source and workload
hashes. Their historical summaries contain a coordinator-supplied original pin
but **no verified current HEAD or full transitive source manifest**. Treat
[w05b-network-composition.json](evidence/w05b-network-composition.json) and
[w05e-audio-composition.json](evidence/w05e-audio-composition.json) according to
that narrower provenance. The network summary compares packet/header/control
and lifetime observations; presentation smoothing is not asserted byte-identical.
The audio boundary records graph operations and exact supplied values, not PCM.

For a historical W05 input match, commit
`955bc20f98fa1397ce1e41cd877c78c41a42cab5` matches the network summary's named
current source hashes and entire test-workload hash. This was checked read-only
for this guide; it does not retroactively add a recorded HEAD to the old summary.
The audio named files and workload also match the later measured trees. To
replay a W05 record, create an isolated tree at the matching commit, compare
its named hashes and workload against the summary, share matching locked
dependencies, and pass that tree as `--current`. Using `774e62fa` above is a
**new current-source proof**, especially because later network source and test
formatting changed. [W05B](w05b-network-composition.md) and
[W05E](w05e-audio-composition.md) document what is retained and what is temporary.

## 5. Untimed preflights for the measurement tools

Use the source aliases selected in section 2. Defaults are intentionally retained;
do not pass `--measure` or `--exclusive` to a preflight. Audio additionally has
an untimed `counts` mode. Setup/import diagnostics may contain durations, but
workload duration and timing-summary fields remain null or invalid for
comparison in smoke/counts mode.

```bash
engine_require_pin "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-lanes.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_EARLY_ROOT" \
  --output "$ENGINE_RESULTS/lanes-preflight.json"

engine_require_pin "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-surfaces.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_EARLY_ROOT" \
  --mode smoke --output "$ENGINE_RESULTS/surfaces-preflight.json"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-network.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --expected-current "$ENGINE_W07_COMMIT" --output "$ENGINE_RESULTS/network-preflight.json"

node "$ENGINE_RUNNERS/measure-audio.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --current-commit "$ENGINE_W07_COMMIT" --mode smoke \
  --output "$ENGINE_RESULTS/audio-preflight.json"
node "$ENGINE_RUNNERS/measure-audio.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --current-commit "$ENGINE_W07_COMMIT" --mode counts \
  --output "$ENGINE_RESULTS/audio-operation-counts.json"

engine_require_pin "$ENGINE_W07_ROOT" "$ENGINE_W07_COMMIT"
node --max-old-space-size=768 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-simulation.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --mode smoke --output "$ENGINE_RESULTS/simulation-preflight.json"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-snapshot-crossover.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CROSSOVER_ROOT" \
  --expected-current "$ENGINE_CROSSOVER_COMMIT" \
  --output "$ENGINE_RESULTS/snapshot-crossover-preflight.json"

node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-attributes-review.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_RANGES_ROOT" \
  --expected-current "$ENGINE_RANGES_COMMIT" \
  --output "$ENGINE_RESULTS/attribute-review-preflight.json"
```

Historical original-attribute preflight only; the explicit test prevents
accidentally applying its old representation oracle to the final candidate:

```bash
test "$ENGINE_W07_COMMIT" = 6a1c76fae3736e4d814ab6d0a354f6837320731c
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-attributes.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --expected-current "$ENGINE_W07_COMMIT" \
  --output "$ENGINE_RESULTS/attribute-original-preflight.json"
```

The CLI is deliberately not uniform. Lane, network, crossover and attribute
tools use `--measure`; surface, audio and simulation use `--mode measure`.
Audio's pin is `--current-commit`; network, crossover and attribute tools use
`--expected-current`. Crossover requires its pin even in smoke mode. Lane,
surface and simulation have no current-pin flag; `engine_require_pin` supplies
the explicit starting check, and their helper verifies source/HEAD stability
during execution. These tools do not implement a `--help` option.

Optional knobs, when deliberately defining a different experiment, are:

| Runner                 | Supported additional workload options                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Lane                   | `--cases`                                                                                        |
| Surface                | `--cases`, `--iterations`, `--samples`, `--warmups`                                              |
| Network                | `--iterations` in measurement mode only; multiple of 32 from 32 to 262,144                       |
| Audio                  | `--cases`, `--samples`, `--warmups`, `--hot-iterations`, `--zero-iterations`, `--fresh-profiles` |
| Simulation             | `--cases`, `--steps`, `--samples`, `--warmups`; steps must be positive, even and at most 12,000  |
| Both attribute runners | `--target-marks` in measurement mode only; integer 1,000 through 2,000,000                       |
| Snapshot crossover     | `--iterations` in measurement mode only; multiple of 32 from 32 to 262,144                       |

All tools in this table require explicit baseline/current/output paths. Use
their defaults and all cases for the recorded experiment. A selected-case run,
different loop count or changed equality oracle must be named as a separate
experiment, never substituted into the historical result.

## 6. Reserved measurements: six areas and two follow-ups

Complete preflights first. **Reserve exclusive compute before invoking this
section:** stop concurrent test, compiler, build, browser and benchmark work on
the measurement host and freeze all source inputs. `--exclusive` records the
reservation; it cannot create one. Every measured command below uses the same
absolute cooperative lock. Do not use different per-agent locks, precreate the
lock file, wrap that same path in `flock`, or delete another process's lock.

The helper obtains the lock with exclusive file creation and records PID, host
and an ownership token. It removes only its own lock on normal completion/error.
It does not steal stale locks or detect unrelated host activity. Investigate
the owning process before recovering an abandoned lock after termination.
Run the selected commands **sequentially**, preserving every case, warmup and raw
sample, including regressions and stalls. Never overwrite a report or rerun
selected slow samples to improve the summary.

```bash
engine_require_pin "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-lanes.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_EARLY_ROOT" \
  --output "$ENGINE_RESULTS/lanes-measurement.json" \
  --measure --exclusive --lock "$ENGINE_TIMING_LOCK"

engine_require_pin "$ENGINE_EARLY_ROOT" "$ENGINE_EARLY_COMMIT"
node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-surfaces.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_EARLY_ROOT" \
  --output "$ENGINE_RESULTS/surfaces-measurement.json" \
  --mode measure --exclusive --lock "$ENGINE_TIMING_LOCK"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-network.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --expected-current "$ENGINE_W07_COMMIT" --output "$ENGINE_RESULTS/network-measurement.json" \
  --measure --exclusive --lock "$ENGINE_TIMING_LOCK"

node "$ENGINE_RUNNERS/measure-audio.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --current-commit "$ENGINE_W07_COMMIT" --output "$ENGINE_RESULTS/audio-measurement.json" \
  --mode measure --exclusive --lock "$ENGINE_TIMING_LOCK"

engine_require_pin "$ENGINE_W07_ROOT" "$ENGINE_W07_COMMIT"
node --max-old-space-size=768 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-simulation.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --output "$ENGINE_RESULTS/simulation-measurement.json" \
  --mode measure --exclusive --lock "$ENGINE_TIMING_LOCK"

node --no-warnings --experimental-transform-types "$ENGINE_RUNNERS/measure-snapshot-crossover.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_CROSSOVER_ROOT" \
  --expected-current "$ENGINE_CROSSOVER_COMMIT" \
  --output "$ENGINE_RESULTS/snapshot-crossover-measurement.json" \
  --measure --exclusive --lock "$ENGINE_TIMING_LOCK"

node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-attributes-review.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_RANGES_ROOT" \
  --expected-current "$ENGINE_RANGES_COMMIT" \
  --output "$ENGINE_RESULTS/attribute-review-measurement.json" \
  --measure --exclusive --lock "$ENGINE_TIMING_LOCK"
```

Historical original-attribute measurement only:

```bash
test "$ENGINE_W07_COMMIT" = 6a1c76fae3736e4d814ab6d0a354f6837320731c
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  "$ENGINE_RUNNERS/measure-attributes.mjs" \
  --baseline "$ENGINE_BASELINE" --current "$ENGINE_W07_ROOT" \
  --expected-current "$ENGINE_W07_COMMIT" \
  --output "$ENGINE_RESULTS/attribute-original-measurement.json" \
  --measure --exclusive --lock "$ENGINE_TIMING_LOCK"
```

### What the timing boundary includes

The common [benchmark helper](../../../scripts/engine-advancement/benchmark-support.mjs)
records actual source/import/package/configuration identities, relevant clean
Git status, helper/workload hashes, runtime, seeded fixture identity and source
stability before/after. Native mode imports the real `.ts` module from each tree;
`--experimental-transform-types` handles parameter properties. Its esbuild graph
scan runs without writing, minifying or tree-shaking. Audio uses a bundled graph
to obtain genuinely fresh numeric module caches for the declared cold cases.

Only the synchronous workload callback is timed. Compilation/imports, fixture
preparation, explicit observation/equality, cleanup and report I/O are outside;
allocations performed by the production function inside the callback stay
inside. The helper rejects asynchronous workload results. It retains warmups
and alternates original/current order within phases; sample medians exclude
warmups without dropping outliers. Crossover has a separate same-source runner
with randomized case order and alternating arm order, retaining all raw pairs.

Equality failure invalidates a comparison; a thrown assertion or source drift
aborts it. Read actual `purpose`, per-case `equivalence`, `stableSources`, raw
samples and `timing.validForComparison` fields, respecting each report's schema.
Do not infer validity from a file merely existing. Setup timings are not workload
results, and a checksum does not replace the recorded direct equality checks.

The manifests cover declared static imports and extra inputs, not arbitrary
runtime file reads or every installed dependency. The tools expose no CLI to
disable clean-input checking. Audio's fresh bundle is a fresh module graph, not
a fresh process, allocator, CPU cache or browser context. Logical cache payloads
and cumulative observed backing-buffer capacities are not heap/RSS/GC or peak
memory measurements. The detailed boundaries remain in
[W04F](w04f-benchmark-harness.md) and each W07/W08 report linked above.

## 7. Interpret native and recording evidence at the right boundary

The attribute CPU tools run the **actual installed Three 0.180.0
`WebGLAttributes` implementation** against a recording GL boundary. The recorder
copies full destination bytes and observes actual upload decisions; it is not a
native GPU driver. The native attribute case separately uses real WebGL buffers
and complete `getBufferSubData` comparisons. Neither measures GPU upload time,
frame time or game FPS. The audio CPU/composition tools similarly establish
arithmetic and supplied graph events; native PCM is a different fixture.

The final native suite ran on Mesa/ANGLE **llvmpipe software rendering**, with
`physicalHardwareValidated: false`. The shared-gate case keeps complete 8 × 8
red/green byte checks, real fences, zero-time native waits, admission and resource
cleanup. Its test-only image material uses the verified `vec4` path. The retained
six-path diagnostic still exposes MeshBasic/raw `vec3` material failures on the
observed backend; a 47/47 suite result does not declare those diagnostic paths
correct. Native clear, upload, constant and `vec4` controls remain strict.
See [W09C](w09c-native-evidence-audit.md) and the final checkpoint attachments.

### Native PCM acceptance contract

The native audio fixture compares the actual archived original graph with the
current graph. Supplied PeriodicWave values, graph operations, parameter writes,
automation and scheduling are exact, including binary64 signed-zero identity.
Native mixed Float32 PCM uses a separate fixed budget:

- `u = 2^-24`, `gamma_11 = 11*u/(1-11*u)`, and
  `b = 2*gamma_11 = 1.3113030448158677e-6`.
- Each channel's maximum absolute sample error is at most
  `b * max(originalPeak, currentPeak)`; RMS error is at most
  `b * max(originalRMS, currentRMS)`.
- Mean-square energy difference is at most
  `2 * originalRMS * allowedRMSError + allowedRMSError^2`.
- Original/current pairs and same-implementation controls at each represented
  rate satisfy the same contract. Channels remain finite/nontrivial and the
  stereo image remains nontrivial. Raw differences and digests are retained.
- A native output-gain perturbation of `1 + 2^-10` must fail both channels by
  more than 100 times the relevant budgets; sampled PCM is not edited.

Output peak/RMS scaling is a **scoped fixture acceptance budget**, not a universal
rounding theorem for cancellation or arbitrary native DSP. The fixture includes
cold/warm 44.1 kHz, 48 kHz and 96 kHz comparisons, same-rate self-controls and the
sensitivity render: 13 native renders and 1,019,520 sample values. Do not widen
the budget when a new environment fails it. [W06D](w06d-native-audio-advancement.md)
and [W09C](w09c-native-evidence-audit.md) explain the retained non-bit-identical
self-control observations and exact input requirement.

Other native boundaries also remain explicit: browser MessageChannels are not
physical-network latency; scripted `navigator.getGamepads()` values are not
controller hardware; controlled stale-handler delivery is not a claim about
natural browser event order; actual contexts/close/ended events do not prove
speaker silence or acoustic quality. No reproduction here promises physical
GPU/audio/controller validation or whole-game FPS gains.

## 8. Reproduce the four demonstrated baseline failures separately

The focused engine gate is not the full repository suite. [W09D](w09d-baseline-failure-classification.md)
records four targeted unit assertions that fail identically on actual original
`350119e8` and final candidate `774e62fa`: the livery alloy-role assertion, stale
GP-R1 calibration hash, frozen catalogue hash and 14 missing dictionary keys.
No asset, calibration expectation or dictionary was changed to obtain that
classification. Broader retained browser assertions/deadlines remain separate;
cancellation alone neither explains them nor proves they predate this work.

To repeat precisely that narrow comparison, use the full source worktrees and
the recorded argument arrays. This recipe reads the evidence from the programme
checkout, changes only the working directory and output destination, captures
both nonzero exits, and does not remove the name filter or run the expensive
unrelated cases in those files. Run outside any timing reservation.

```bash
engine_require_pin "$ENGINE_BASELINE" "$ENGINE_BASELINE_COMMIT"
engine_require_pin "$ENGINE_CURRENT" "$ENGINE_CURRENT_COMMIT"
python3 - "$ENGINE_REPOSITORY" "$ENGINE_BASELINE" "$ENGINE_CURRENT" "$ENGINE_RESULTS" <<'PY'
import json, subprocess, sys
from pathlib import Path
repo, baseline, current, output = map(Path, sys.argv[1:])
receipt = json.loads((repo / 'docs/engine/advancement-2026-11-25/evidence/'
    'w09d-baseline-failures/unit-comparison.json').read_text())
for side, root in [('baseline', baseline), ('current', current)]:
    args = list(receipt['runs'][side]['command'])
    destination = output / f'{side}-baseline-failures.vitest.json'
    assert not destination.exists(), destination
    args[args.index('--outputFile') + 1] = str(destination)
    with (output / f'{side}-baseline-failures.log').open('xb') as log:
        result = subprocess.run(args, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    print(side, 'exit', result.returncode, 'report', destination)
PY
```

The retained executions both exited 1 with four failed assertions and 48
intentionally unselected cases. Compare the actual new messages/JSON with
[unit-comparison.json](evidence/w09d-baseline-failures/unit-comparison.json);
an exit code by itself is not equivalence. The original evidence also records
before/after source/input hashes verified against pinned Git blobs. The short
recipe above reproduces the assertion selection; it does not generate that
complete audit manifest. Read-only integrity checking of the retained bundle is:

```bash
(cd "$ENGINE_REPOSITORY/docs/engine/advancement-2026-11-25/evidence/w09d-baseline-failures" \
  && sha256sum --check SHA256SUMS)
```

## 9. Preserve the result and its limits

Keep the original scripts, preflights, raw measurements, failed checkpoints and
final passing checkpoint byte-for-byte. Store a new run under a new directory;
record its source/root/runtime/lock identities, exact command, exit status and
complete evidence. A doc-only commit or report update does not retroactively
change which executable source a prior run validated.

The source-stability guard intentionally excludes generated
`public/models/supplied-player-lods.bin.gz` and root browser receipts. Its pass
alone therefore cannot prove the user-required content protection. The
independent [protected-content audit](w09e-protected-content-audit.md) compared
1,758 protected paths/263,530,318 bytes against original Git blobs, candidate
Git blobs and worktree bytes. The generated LOD file was absent in both trees
and the worktree; it was not a tracked hash-equality result. The actual supplied
player model remained unchanged. No generation hook is needed for these engine
recipes.

This guide was checked by source/CLI inspection, retained-evidence parsing and
read-only hash comparisons. The command blocks are recipes, not additional
execution receipts. For outcomes, use the pinned JSON/log artifacts; for engine
behavior and tradeoffs, use [ENGINE_CHANGES.md](ENGINE_CHANGES.md).
