# W10B — Reproducing and maintaining the engine validation gate

Assignment **56/60**, wave **10** · 25 November 2026.

## Purpose and source boundary

Use the focused engine workflow to validate an immutable source revision, preserve its evidence, and distinguish engine acceptance from the separate repository-wide content gate. This guide reproduces the commands and selection in [the workflow at 3949139][workflow]. It does not describe a new local execution.

The executable checkpoint reproduced by this guide is **`394913934d3c6c9cfbe5ba5251beb7ebe68ee249`**. Its complete focused gate [run 45647350422, job 139321807542](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/job/139321807542) passed on attempt 1: full lint, **1,351 units across 95 files**, all six probes, full TypeScript/Vite build, and **60 native cases with zero retries**. The coordinator and independent release reviewers retrieved the completed job; [release evidence](w10e-release-evidence.md) and the [retained result](evidence/3949139/result.json) preserve the exact outcome.

The author independently checked that this checkpoint's seven workflow/support/configuration inputs match the previously inspected 0bc versions; the commands below are the same guarded workflow commands. This guide is not a claim that they were rerun locally. Earlier 0bc and other intermediate failures remain in [CHECKPOINTS.md](CHECKPOINTS.md), alongside the historical [92e2dc2 acceptance][accepted-run].

The authoritative inputs for this guide are the exact [workflow][workflow], [package scripts][package], [source guard][guard], [baseline helper][helper], [Playwright configuration][playwright], and [browser backend/setup][backend]. No production, test or workflow file was changed by this assignment.

## 1. Prepare an isolated checkout and evidence directory

Run these commands in Bash on an isolated Ubuntu 24.04 runner with Node 22. The workflow selects Node major 22; the retained accepted probe run used **Node v22.23.5** and **esbuild 0.25.12**. Record the versions actually used. The lockfile controls JavaScript dependencies.

Use a fresh checkout rather than switching the shared working copy used by another contributor:

~~~bash
set -euo pipefail

MOTOBOUND_ENGINE_SOURCE=394913934d3c6c9cfbe5ba5251beb7ebe68ee249
git clone --no-checkout https://github.com/cheshmakzanoon-ops/Experiment-3.git motobound-engine-validation
cd motobound-engine-validation
git fetch --no-tags origin "$MOTOBOUND_ENGINE_SOURCE"
git switch --detach "$MOTOBOUND_ENGINE_SOURCE"
test "$(git rev-parse HEAD)" = "$MOTOBOUND_ENGINE_SOURCE"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

MOTOBOUND_ENGINE_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/motobound-engine-evidence.XXXXXX")"
export NODE_OPTIONS=--max-old-space-size=4096
export CI=1

git rev-parse HEAD > "$MOTOBOUND_ENGINE_EVIDENCE/engine-source-commit.txt"
git rev-parse 'HEAD^{tree}' > "$MOTOBOUND_ENGINE_EVIDENCE/engine-source-tree.txt"
sha256sum package-lock.json > "$MOTOBOUND_ENGINE_EVIDENCE/engine-package-lock.sha256"
sha256sum desktop/src/save-mirror.cjs > "$MOTOBOUND_ENGINE_EVIDENCE/engine-desktop-service.sha256"
node --version > "$MOTOBOUND_ENGINE_EVIDENCE/node-version.txt"
npm --version > "$MOTOBOUND_ENGINE_EVIDENCE/npm-version.txt"
~~~

Replace the source value only when intentionally validating another reviewed commit. Keep its resulting commit/tree identities with the new result. A directory created by `mktemp` outside the checkout avoids treating validation logs as source modifications.

`CI=1` also makes Playwright refuse an already running preview server instead of reusing it. Port 4173 must be available for this checkout's preview. This prevents an old server from supplying a different build during an ostensibly exact-source run.

Install the lockfile through the same guard used in CI:

~~~bash
node --experimental-transform-types scripts/source-stability.ts -- \
  npm ci --no-audit --no-fund
~~~

Do not substitute `npm update`. The [package scripts][package] attach model-generation hooks to `npm run build`, `npm test`, `npm run dev`, and the demo build path. The commands below invoke the actual compiler, build tool and test runners directly, keeping those authoring hooks outside this engine-validation procedure.

## 2. Run full lint

~~~bash
set -euo pipefail

node --experimental-transform-types scripts/source-stability.ts -- \
  node node_modules/eslint/bin/eslint.js src tests e2e scripts \
  2>&1 | tee "$MOTOBOUND_ENGINE_EVIDENCE/engine-runtime-lint.log"
~~~

This is the repository's complete configured source/test/script ESLint scope, with no automatic fixing or rule suppression. It is separate from content validation. The new gate deliberately caught the worker-observer lint defects before accepting another full runtime checkpoint; their failed runs remain in the checkpoint history.

Keep `pipefail`: otherwise a successful `tee` could conceal the runner's failure. The source guard returns the child exit status and also fails when its protected input snapshot changes.

## 3. Execute the exact focused unit selection

The engine glob is supplemented by existing circuit, festival, storage and transport contracts affected by the changes. Retain all the named suites; an engine-only glob is a smaller gate.

~~~bash
set -euo pipefail

NODE_OPTIONS=--max-old-space-size=1024 node --experimental-transform-types scripts/source-stability.ts -- \
  node node_modules/vitest/vitest.mjs run tests/engine-*.test.ts \
  tests/circuit-frame-transport.test.ts tests/circuit-preparation-lifetime.test.ts \
  tests/circuit-startup-settlement.test.ts tests/festival-ground-height.test.ts \
  tests/festival-renderer-loader-lifecycle.test.ts tests/festival-session-lifecycle.test.ts \
  tests/surface-channel-backpressure.test.ts \
  tests/net-event-loop-ownership.test.ts \
  tests/net-transport-lifetime.test.ts \
  tests/save-store-lifecycle.test.ts \
  tests/desktop-mirror-consistency.test.ts \
  tests/desktop-mirror-crash-recovery.test.ts \
  tests/desktop-mirror-recovery.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 \
  2>&1 | tee "$MOTOBOUND_ENGINE_EVIDENCE/engine-runtime-unit.log"
~~~

The 1 GB Node heap and single worker are the actual focused-workflow settings. `--allowOnly=false` prevents an accidentally focused test from producing incomplete acceptance, and `--retry=0` retains first-attempt failures.

Record the actual file/case counts and failures from this invocation. Selection growth is not equivalent to newly authored tests: the six existing storage/network suites added during this task contribute 191 cases. The [provenance review](w09d-evidence-provenance.md) separates that inherited coverage from new cases.

A targeted failing-file run is useful for diagnosis. It does not replace the complete selection above when reporting integrated acceptance.

## 4. Run all six original-baseline comparisons

Fetch the immutable historical object without changing the candidate checkout:

~~~bash
set -euo pipefail

git fetch --no-tags --depth=1 origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc

NODE_OPTIONS=--max-old-space-size=1024 node --experimental-transform-types scripts/source-stability.ts -- \
  bash -e -u -o pipefail -c \
  'for probe in scripts/engine-runtime-probes/*-probe.mjs; do node "$probe"; done' \
  2>&1 | tee "$MOTOBOUND_ENGINE_EVIDENCE/engine-runtime-probes.log"
~~~

Both the outer logged pipeline and the inner loop must retain fail-fast handling. If an early probe fails, a later successful probe must not supply the overall exit status.

Require the following six report identities, not merely a zero exit from whatever files happen to match the glob:

| Script | Report `probe` | Successful `status` | Historical production modules |
| --- | --- | --- | --- |
| `codec-probe.mjs` | `codec` | `passed` | `src/net/bytes.ts`, `src/net/codec.ts` |
| `lane-probe.mjs` | `lane-cache-actual-git-baseline` | `passed` | `src/simulation/track-lane-index.ts` |
| `queue-probe.mjs` | `server-input-queue` | `passed` | `src/net/input.ts` |
| `radio-probe.mjs` | `radio` | `passed` | `src/core/radio.ts` |
| `simulation-probe.mjs` | `whole-simulation-composition` | **`pass`** | Lane and thermal modules together |
| `thermal-probe.mjs` | `surface-thermal` | `passed` | `src/simulation/surface-thermal.ts` |

The Simulation status spelling is intentionally different in this version. A result parser should validate these actual schemas instead of rejecting a successful `pass` or treating missing reports as successful.

For each report, preserve the complete JSON object and verify its baseline and candidate provenance. The helper records the candidate HEAD, declared source hashes, bundle hashes, entry hash, Node/esbuild versions and scoped tracked state. Each historical target must actually be loaded; candidate target bytes, HEAD and tracked status must remain unchanged during bundling.

These are **declared historical-module substitutions into the same candidate dependency graph**. They are not two complete historical/current product builds. The helper's tracked-status scope is `src`, the probe directory, package files and `tsconfig.json`; untracked files are excluded from that specific status claim. A fresh clean checkout makes the intended source identity straightforward. The helper reports preexisting dirty state rather than universally rejecting it.

Only queue and codec report descriptive paired timings. There is no timing pass threshold. Keep complete sample vectors and workload definitions, and use [the measurement report](w09b-measurements.md) for the distinction between paired medians, ratios of medians and structural work reductions. Probe success is not a hardware FPS, power or physical-network result.

## 5. Typecheck and build without model-generation hooks

~~~bash
set -euo pipefail

node --experimental-transform-types scripts/source-stability.ts -- bash -c \
  'node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build' \
  2>&1 | tee "$MOTOBOUND_ENGINE_EVIDENCE/engine-runtime-build.log"
~~~

The `&&` requires the compiler to pass before Vite runs. `dist/` is an output directory; retain `dist/BUILD_IDENTITY.json` with the run. This direct invocation is the focused workflow's build path and avoids the package's `prebuild` asset-generation hook.

## 6. Provision and run the native browser gate

On the isolated Ubuntu 24.04 runner, the workflow uses these system/browser preparation commands:

~~~bash
sudo python3 scripts/ci-ubuntu-https.py
npx playwright install --with-deps chromium
sudo apt-get install -y libgl1-mesa-dri libegl1 libglx-mesa0 mesa-utils xvfb imagemagick
~~~

The HTTPS helper adjusts the runner's Ubuntu package sources. Browser/dependency installation and the virtual display are environment preparation, separate from the guarded application build.

Use the workflow's graphics selection and the installed Playwright Chromium. In this isolated shell, clear a custom Chromium override so the launch path agrees with the workflow:

~~~bash
export APEX_BROWSER_BACKEND=mesa
export APEX_MOTOCROSS_XVFB_CAPTURE=1
export LIBGL_ALWAYS_SOFTWARE=true
export GALLIUM_DRIVER=llvmpipe
unset CHROMIUM_PATH

set -euo pipefail

sha256sum --check "$MOTOBOUND_ENGINE_EVIDENCE/engine-desktop-service.sha256"

node --experimental-transform-types scripts/source-stability.ts -- \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  node node_modules/@playwright/test/cli.js test \
  e2e/engine-native-*.spec.ts e2e/replay-state.spec.ts \
  --workers=1 --retries=0 --forbid-only \
  2>&1 | tee "$MOTOBOUND_ENGINE_EVIDENCE/engine-runtime-browser.log"

sha256sum --check "$MOTOBOUND_ENGINE_EVIDENCE/engine-desktop-service.sha256"
~~~

The backend requires Linux, an X display and an observed llvmpipe renderer. [Global setup][setup] launches the same browser configuration, observes WebGL2 adapter identity and a known framebuffer pixel, writes `browser-backend.json`, and rejects fallback to another backend. Keep that receipt rather than inferring the adapter solely from environment variables.

The desktop-service checks cover the exact `desktop/src/save-mirror.cjs` imported by the native recovery tests, which lies outside the generic source guard's directory set. The final check executes after a successful browser pipeline. Under fail-fast handling it does not run after an earlier failure; the initial digest still remains evidence.

The selected browser cases include the existing native engine/replay coverage plus the new worker-idle and desktop-recovery specifications. Use the complete glob and replay spec for final acceptance. Keep one browser worker, zero retries and `--forbid-only`; retain the configured test deadlines and graphics behavior.

Native acceptance has distinct boundaries:

- Worker cases use actual DedicatedWorker messages, timers and transferable buffers. Controlled unit tests separately supply stale-callback and full-credit adversaries.
- Audio cue cases use an actual OfflineAudioContext and rendered PCM, without establishing live hardware output or AudioWorklet behavior.
- Desktop recovery uses real Chromium IndexedDB and the production Node file service over real temporary files. Its Playwright binding is an explicit test transport, not Electron preload/IPC.
- Mesa llvmpipe is a software-renderer test environment. Its acceptance is not physical GPU, FPS or power validation.

See [the native review](w09e-native-acceptance.md) and [validation review](w08f-validation-review.md) for the witnesses and failure-evidence boundaries.

## 7. Retain and interpret the result

Preserve the evidence directory and these checkout outputs:

| Evidence | Purpose |
| --- | --- |
| Source commit/tree and lockfile digest | Identify the exact checkout and dependency input |
| Desktop service digest | Identify the extra native service input |
| Lint, unit, probe, build and browser logs | Record stage completion, failures, counts and commands |
| All six complete probe JSON objects | Preserve provenance, exact comparisons, counters and timing samples |
| `dist/BUILD_IDENTITY.json` | Identify the built product |
| `browser-backend.json`, `browser-progress.json` | Preserve observed backend and browser progress |
| `test-results/`, `playwright-report/` | Preserve available traces, screenshots, attachments and runner reports |

The hosted workflow uploads available evidence under `engine-runtime-validation-<source SHA>` with seven-day retention and `if: always()`. Its missing-files setting does not promise every listed artifact exists after an early failure. Preserve durable result/probe/log records in the repository when needed beyond that retention period. Keep the hosted run/job and uploaded artifact identity with those records.

The current retained logs use a documented normalization: remove ANSI control sequences and line-leading timestamps, retaining command/output text. Label a normalized copy accordingly. Distinguish an artifact digest reported by the upload log from a digest independently computed after downloading the ZIP. Do not describe attached browser JSON or trace contents as inspected unless they were actually opened.

A result is a complete focused acceptance only when lint, the full selected units, all six expected probes, compiler/build, native tests, source guards and successful-stage desktop integrity checks have completed successfully for the same candidate. A failed or skipped stage stays failed or skipped. Heap exhaustion, exit 137, unavailable browser infrastructure and a disconnected local runner are not substitute passes.

The generic source guard protects `src`, `public`, `scripts`, `tests`, `e2e`, `docs`, `.github`, and root files, comparing executable bits/content or symlink targets. It deliberately excludes `public/models/supplied-player-lods.bin.gz`, root `browser-backend.json`/`browser-progress.json`, and ordinary output directories. It compares each command with that command's starting inputs. It does not certify whole-repository immutability, freeze all dependencies across separate invocations, or authorize model generation.

The complete repository workflow remains separate. Known livery, translation and vehicle catalogue failures predate this task; provenance is recorded in [W09D](w09d-evidence-provenance.md). A successful focused engine gate does not relabel that broader workflow as green.

## 8. Maintain the gate and publish without overwriting concurrent work

When engine dependencies or witnesses change, update the focused workflow selection and path triggers together. Its current triggers explicitly include the desktop bridge, native save service and ESLint configuration. Keep six expected probe identities visible in release review. A new probe should declare its historical replacement scope and preserve deterministic correctness assertions independently of descriptive timing.

For shared `main`, use the same ownership pattern as this development:

1. Give each contributor explicit disjoint paths and preserve their reviewed source/tree identities.
2. Re-read the latest remote `main` and inspect every incoming commit since the last known parent. Compare changed paths before applying an overlay.
3. Build the publication tree from that latest parent tree, replacing only approved files. Preserve all unrelated inherited blobs.
4. Create the commit with that exact parent and update `main` with `expected_sha` set to the inspected head and `force: false`.
5. If the expected-head check fails, inspect the new head and recompute the overlay on its tree. Do not retry using a stale full-tree snapshot.
6. Audit the resulting commit against its immediate parent. Protected rendering/model/character/environment and concurrent animation identities should remain equal for an engine-only change.

The [protected-path audit](w09c-protected-path-audit.md) and its JSON manifest show the parent-relative method. A baseline-to-latest aggregate diff contains other contributors' legitimate work and cannot by itself attribute those paths to this engine task.

Finally, pin the executed source and run in the release handoff. If only documentation follows a successful executable checkpoint, prove that runtime, tests, workflow and dependency inputs remain identical and retain the original accepted SHA. Any later executable or harness change needs its own integrated gate; a report-only change does not retroactively change what an earlier run executed.

[workflow]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/.github/workflows/engine-runtime-validation.yml
[package]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/package.json
[guard]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/source-stability.ts
[helper]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/engine-runtime-probes/support.mjs
[playwright]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/playwright.config.ts
[backend]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/browser-backend.ts
[setup]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/browser-backend-setup.ts
[previous-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45645636058
[accepted-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
