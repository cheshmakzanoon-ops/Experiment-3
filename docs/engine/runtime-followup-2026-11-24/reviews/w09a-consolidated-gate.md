# Worker49 / Wave9A — final consolidated engine unit gate

## Outcome

**PASS: 1,852 / 1,852 test cases in exactly 128 / 128 unique physical test files** on published code/test checkpoint **`9119c7683d821d145f15ed64a03ee3406595b58d`**, tree **`3b704f846c3283c21e73f8f5c3febf670a773c63`**. Exit 0. Zero failures, skips, todos or retries. The result contains no duplicate, missing or unexpected file. This is one final invocation; earlier overlapping tests are not added to the total.

The final run started `2026-11-25T04:36:49.182559+00:00` and completed `2026-11-25T04:42:19.654899+00:00`. It took **330.01 seconds including the source guard**. Node `v24.22.3`, V8 `13.6.233.17-node.63`, Linux x64, Vitest `3.2.4`. Validation duration is not an engine-performance measurement.

**COMPUTE is explicitly released to root for worker50.** This worker will make no further test runs or repository edits. All final reports remain outside the frozen repository; root owns evidence publication and the following compiler/build/native gates.

## Selection and risk coverage

The exact selected paths, file hashes and selection reasons are in `w09a-final/selection-final.json` and `selection-final.txt`. The human-readable coverage inventory is `selection-proposed.md`.

| Selection component | Unique files |
| --- | ---: |
| Every `tests/engine-*.test.ts`, including all six Wave8 additions | 38 |
| Other tests changed since task baseline, including the four reviewed corrections | 14 |
| Additional justified adjacent regressions | 76 |
| **Final deduplicated union** | **128** |

All **46 changed test files** since task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb` are included. The mandatory engine/changed union is 52 files. Adjacent selection covers network lifecycle, command/record/wire compatibility and impaired recovery; controller button/shift/focus/replacement/pump/haptic ownership; audio graph/unlock/preview/tap lifetime; generated/imported texture source ownership, registration, loaders and renderer/vegetation release; recorder/export/ghost/replay/IndexedDB/seek continuity; worker frames, clocks, startup, diagnostics and surface backpressure; and exact BVH/contact/drivetrain regression paths.

The surface-channel file was added after a concrete broader-CI failure, followed by exact task-baseline proof and a reviewed contract correction. The whole repository unit suite was not run. The maintained focused CI subset—38 engine-prefixed files and the four reviewed adjacent files—accounts for **506 passing cases in 42 files within this local run**; this statement is not a remote-CI status claim.

## Exact source identity and stability

The unchanged production reference is checkpoint7 `6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`, tree `e6d37727eb695278c4934fa11365d6d014c40db6`.

- **3,396 protected inputs** were SHA-256 fingerprinted before and after the final command, using the same input domain and exclusions as `scripts/source-stability.ts`.
- The full before/after aggregate input SHA-256 is **`ed8f00d74c656abd95f0e5d54fcdafe31a222baec37bc0846c3d123ee943006b`** in both snapshots.
- **All 1,116 files under `src/` match checkpoint7 before and after**, including all **29 production files changed since the task baseline**. The fixture/CI corrections introduced no production change.
- HEAD and its tree remained exactly `9119c7683d821d145f15ed64a03ee3406595b58d` / `3b704f846c3283c21e73f8f5c3febf670a773c63` throughout the run.
- The guard reported no rewritten application inputs. No tracked working/staged application diff remained at the published execution checkpoint; the permitted browser receipt was the only untracked root item.
- Local-only evidence includes index entries, working/staged/HEAD diffs, full raw baseline object metadata and a scoped baseline binary patch for `src`, `tests`, `scripts`, `e2e` and `.github`. All final capture commands completed successfully.

The full manifests are `source-before.json` and `source-after.json`; per-production-file equivalence is `production-source-equivalence.json`; changed code/blob/hash mapping is `changed-code-source-manifest.json`. The built-in guard excludes the generated supplied-player archive and root browser receipt files; no asset-generation hooks were invoked.

## Reproduction

From the exact published checkout with installed locked dependencies:

```sh
NODE_OPTIONS=--max-old-space-size=1024 \
GIT_NO_LAZY_FETCH=1 GIT_ALLOW_PROTOCOL=none GIT_OPTIONAL_LOCKS=0 \
node --experimental-transform-types scripts/source-stability.ts -- \
  node node_modules/vitest/vitest.mjs run <the 128 explicit paths in selection-final.txt> \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 \
  --reporter=default --reporter=json --outputFile.json=/tmp/engine-final-unit-results.json
```

`command.txt` and `invocation.json` retain the exact expanded argument list actually executed. `run-gate.py` orchestrates source identity, local-only evidence capture, guarded execution and exact file/case-count validation. It requires the coordinator's explicit source-freeze/compute flag and checks the expected published commit/tree supplied at execution. No npm pretest/prebuild/dev hooks, dependency installs, test-only filtering, retries or timeout changes were used.

## Failures retained and independently classified

The initial published checkpoint7 run is retained intact under `w09a-work`: **1,803 passed / 34 failed**, 1,837 cases across 127 files, with 124 files passing. A subsequently identified surface test separately produced **13 passed / 1 failed** on checkpoint8. None of these original failures is labeled a baseline issue: **every one of the 35 distinct failed case names was executed and passed on exact task baseline `1c609b`**.

| File | Exact baseline | Original candidate | Reviewed targeted correction | Classification |
| --- | ---: | ---: | ---: | --- |
| circuit-preparation-lifetime.test.ts | 19 / 19 | 5 / 19 | 19 / 19 | Partial renderer fixture omitted its newly owned output pass. |
| festival-renderer-loader-lifecycle.test.ts | 18 / 18 | 0 / 18 | 18 / 18 | Partial fixture omitted sky geometry/material, near-shadow owner and output pass. |
| circuit-frame-transport.test.ts | 5 / 5 | 3 / 5 | 5 / 5 | Old expectations allowed repeated errors and pause-driven revival after fatal frame failure. |
| surface-channel-backpressure.test.ts | 14 / 14 | 13 / 14 | 15 / 15 | Old expectation used an ACK to revive a worker after fatal surface publication failure; one preservation case was added. |

The exact isolated baseline was reconstructed locally and verified against baseline Git blob identities: **1,125 file contents** for the combined four-file proof, including **29 historical source blobs** read from the local object store. Unchanged working bytes were used only when their Git blob SHA-1 exactly matched the baseline object; each file also has a SHA-256. No required executed source remained unavailable. The original 42-case three-file baseline archive is retained, with the additional exact surface test separately archived.

After reviewing this evidence, root authorized narrow freeze exceptions for **four test files only**. No production fix was made:

1. The circuit preparation fixture supplies a real Three `OutputPass`; its actual material joins the existing one-time resource-disposal assertions.
2. The Festival loader fixture supplies all four omitted owners and requires each to be disposed exactly once during every case's cleanup, retaining loader installation, cancellation, retry and idempotence checks.
3. The circuit frame cases keep the real Simulation, serializer and native transfers. They require one terminal error, no frames/ACKs/steps from repeated commands or a retired return while failed, five distinct full-sized frames only after successful init, and bounded one-shot recycling despite duplicate returns.
4. The surface worker case now requires terminal quiescence and a fresh simulation before a complete new-epoch terrain publication. A separate direct `SurfaceChannel` case preserves the original nontrivial same-terrain property: an attached failed send consumes a real nonempty change set, and retry reconstructs exactly that same deformed terrain, preserves its physical hash, detaches accepted native transfers, rejects failed-ticket credit and still respects the outstanding bound.

Existing assertions were retained or strengthened to the authorized ownership contract. No tests were skipped, no production behavior was weakened for `Object.create` fixtures, and no authored models, environments, geometry/material/texture definitions, vehicle tuning, quality settings or timeouts were changed. Root added the four reviewed adjacent files to focused workflow triggers and unit arguments. The final whole 128-file run occurred only after those corrections were published as checkpoint9.

## Evidence map

### Final passing gate — `/tmp/engine-c71f32882729/w09a-final/`

- `consolidated-validation.json`: concise machine-readable outcome, unique counts, scope and separately listed historical runs.
- `results-summary.json`, `unit-results.json`, `unit-default.log`: complete final results and original reporter output.
- `assertion-results-unique.json`: each final test identity by file, full name and repeated-name occurrence, without merging previous runs.
- `selection-final.json`, `selection-final.txt`, `selection-proposed.md`: exact deduplicated file inventory, per-file hashes and coverage rationale.
- `source-before.json`, `source-after.json`, `production-source-equivalence.json`, `changed-code-source-manifest.json`: exact executed source provenance.
- `invocation.json`, `command.txt`, `run-gate.py`, `before/after-git-capture.json` and their index/status/diff/raw outputs: exact reproduction and local-only Git evidence.

### Preserved earlier evidence — `/tmp/engine-c71f32882729/w09a-work/`

- Initial failed gate: `unit-default.log`, `unit-results.json`, `results-summary.json`, `assertion-results-unique.json`, selection and source manifests.
- Exact original three-file baseline: `baseline-source-manifest.json`, `baseline-source.tar.gz`, `baseline-tree-objects.txt`, `baseline-invocation.json`, `baseline-default.log`, `baseline-unit-results.json`, `baseline-results-summary.json`.
- Three-file corrections: `correction-tests.patch`, `failure-classification.json`, `correction-three-file.log`, `correction-three-file-results.json`, `correction-eslint.log`, `correction-results-summary.json` and source manifests.
- Surface proof/correction: `surface-comparison-summary.json`, `surface-unchanged-current.log/.json`, `surface-baseline.log/.json`, `surface-baseline-source-manifest.json`, `surface-baseline-test.tar.gz`, `surface-tests.patch`, `surface-failure-classification.json`, `surface-corrected.log/.json`, `surface-eslint.log`, `surface-correction-summary.json` and source manifests.

## Preparation restriction and limits

Automatic approval review blocked the initial preparation before Vitest started, when a full historical binary diff caused a partial-clone lazy-fetch attempt to GitHub. The denial, original runner and completed preflight index/status remain under `w09a-work/preflight-blocked/`. Root authorized a materially safer local-only path using `GIT_NO_LAZY_FETCH=1`, `GIT_ALLOW_PROTOCOL=none` and per-command `protocol.allow=never`; no global Git configuration, permissions or approval settings were changed. A later local-only archive reported an absent unchanged blob; exact blob-verified working bytes supplied that baseline file without fetching. These preparation events are preserved and are not counted as test failures.

This gate establishes the selected unit and integration contracts on the exact published runtime source. It does not replace the complete project unit suite, whole-project compiler/build, native browser/replay gate or remote CI review. It makes no physical GPU, hardware input/audio, heap, GC, FPS or whole-engine performance claim. Those workstreams remain separate.
