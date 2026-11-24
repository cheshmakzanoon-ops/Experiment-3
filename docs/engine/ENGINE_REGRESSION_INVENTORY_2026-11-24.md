# Consolidated engine regression inventory — 24 November 2026

## Result

**All 60 selected unit-test files passed: 1,072 test-case executions, representing 1,068 distinct `(file, fullName)` identities.** The run had zero failed, skipped or pending cases. Each file ran once in a separate process; all 60 processes exited successfully, with no retry.

The distinction between executions and named identities is deliberate. Four parameterized titles each occur twice because JSON-style title formatting represents both `NaN` and `Infinity` as `null`. Those are separate executed input cases. The requested conservative name-based count includes each repeated identity once, and the receipt retains its occurrence count. No earlier agent total or repeated run is added to these results.

| Inventory group | Files | Passed executions | Distinct passed names |
|---|---:|---:|---:|
| Files added since the baseline | 55 | 1,004 | 1,000 |
| Existing files modified since the baseline | 5 | 68 | 68 |
| **Total** | **60** | **1,072** | **1,068** |

The [machine-readable receipt](ENGINE_REGRESSION_INVENTORY_2026-11-24.json) contains every selected file, its source hash, every accepted full test name, process settings, result digests and all four naming collisions. A test case can contain many assertions or seeded observations; those inner-loop observations are not counted as additional tests.

## Selection and source boundary

The baseline is `a0ae513e7982f0b4719296519752e0ae5f1983f8`. Selection takes every added or modified `.test.ts` file in the baseline-to-worktree diff, plus newly created untracked test files. The three frozen reference helpers are test inputs rather than suites. Unchanged unit suites and all browser cases are outside this inventory.

The repository HEAD at both the start and completion was `596bdfc44a47c39d299324cf30969c74e6e448c5`. Four final production files and the three new final-wave suites were still awaiting publication, so this receipt binds to their exact frozen working-tree contents. The four production paths were `src/main.ts`, `src/net/server.ts`, `src/rendering/open-world/festival-renderer.ts`, and `src/session/free-roam.ts`. Their hashes are retained with all changed production files in the JSON receipt.

After execution, the coordinator published commit `b282f121b5766df26466d413d2c685b2f826799d` (tree `1472d9c28a270af720507d90f490d52ff5ca1fbb`). An independent comparison read all 1,074 production inputs, 851 test inputs and four configuration inputs directly from that published Git tree. Every file path and SHA-256 content hash matched the frozen test inputs. The publication therefore contains the tested code; the original `596bdfc` execution boundary above is preserved rather than retroactively described as the published commit.

Before and after execution, the verifier hashed every tracked or newly created TS/TSX/JS/MJS/JSON input under `src/` and `tests/`, along with Vitest, TypeScript, package and dependency-lock configuration. **All input hashes remained unchanged.** Documentation and ignored validation outputs were excluded so evidence could be assembled without changing the tested programme.

| Input set | Files | SHA-256 manifest digest |
|---|---:|---|
| Production source inputs | 1,074 | `8dec1a18da6a2dc05169a7947eaa85205dcfbaf7b1c4979570aabe62a429ebb1` |
| Test inputs, including helpers and unchanged test sources | 851 | `5bae7c8c7bfd4a7f4ec0fc753812fa8579e5908e0fe57b8ceb5c04d57e19ceb9` |

The manifest digest covers sorted UTF-8 records of `relative path + NUL + SHA256(file bytes) + newline`. Asset identity is established separately by the [scope audit](ENGINE_SCOPE_AUDIT_2026-11-24.md); this code-input manifest does not purport to rehash every binary asset.

## Execution method

The completed run used Node `v24.22.3` and Vitest `3.2.4`. Each file ran in its own direct Vitest process with one threaded worker. Ordinary suites used a 768 MiB JavaScript heap limit. The previously memory-sensitive Festival renderer-loader and snapshot-encoding suites were isolated with a preassigned 1,280 MiB limit. Their fresh runs passed 18 and 14 cases respectively.

No npm lifecycle hook, model generator, browser launch, source rewrite or assertion relaxation was used. Focused-only cases were prohibited through `--allowOnly=false`. Ordinary output and JSON reports were retained for every process, with independent exit-status checks. The source/input manifests were compared after the priority group and after the remaining group.

The coordinator requested the three final-wave suites first. They passed 11 network cases, eight physics cases and 18 resource-lifetime cases before the remaining 57 files ran. Earlier resource-terminated runs from other assignments are not counted here; this recovered-environment run completed all 60 processes on their first attempt.

A portable command for any file listed below is:

```sh
NODE_OPTIONS=--max-old-space-size=768 node node_modules/vitest/vitest.mjs run \
  tests/engine-network-integration.test.ts \
  --pool=threads --maxWorkers=1 --allowOnly=false \
  --reporter=default --reporter=json --outputFile.json=/tmp/engine-case-results.json
```

Use the 1,280 MiB limit for the two larger suites identified in the table. The selected inventory can be reconstructed with:

```sh
git diff --name-status --diff-filter=AM a0ae513e7982f0b4719296519752e0ae5f1983f8 -- tests
git ls-files --others --exclude-standard -- tests
```

Keep only `.test.ts` files, deduplicate paths, and compare them with the receipt before executing. Raw process reports and the full input manifests are retained in the validation workspace and recovery backup; the committed JSON preserves the portable result inventory and their hashes.

## Parameterized name collisions

Every row below corresponds to two passed input cases but one named identity. `%j` title formatting converts the differing nonfinite value to `null`. All exact labels are also retained in the JSON receipt.

| File | Exact repeated full name | Distinct inputs |
|---|---|---|
| `flashback-work-budget.test.ts` | `flashback work budget yields on an invalid or regressing clock ([0,null])` | `[0, NaN]` and `[0, Infinity]` |
| `net-transport-lifetime.test.ts` | `link condition boundaries rejects malformed initial conditions {"jitterMs":null} before registering a link` | `{ jitterMs: NaN }` and `{ jitterMs: Infinity }` |
| `net-transport-lifetime.test.ts` | `link condition boundaries rejects malformed initial conditions {"latencyMs":null} before registering a link` | `{ latencyMs: NaN }` and `{ latencyMs: Infinity }` |
| `net-transport-lifetime.test.ts` | `link condition boundaries rejects malformed initial conditions {"loss":null} before registering a link` | `{ loss: NaN }` and `{ loss: Infinity }` |

## Complete file inventory

“Added” and “modified” describe the file relative to the baseline. The 68 results in modified files include existing cases; they are not all newly introduced coverage. Every row has a successful process exit and zero skipped cases.

| Test file | Change | Passed executions | Distinct names | Heap MiB |
|---|---|---:|---:|---:|
| [audio-unlock-lifetime.test.ts](../../tests/audio-unlock-lifetime.test.ts) | added | 12 | 12 | 768 |
| [bindings-migration.test.ts](../../tests/bindings-migration.test.ts) | added | 2 | 2 | 768 |
| [bvh-traversal.test.ts](../../tests/bvh-traversal.test.ts) | added | 7 | 7 | 768 |
| [circuit-frame-transport.test.ts](../../tests/circuit-frame-transport.test.ts) | added | 5 | 5 | 768 |
| [circuit-preparation-lifetime.test.ts](../../tests/circuit-preparation-lifetime.test.ts) | added | 19 | 19 | 768 |
| [collision-query-efficiency.test.ts](../../tests/collision-query-efficiency.test.ts) | added | 14 | 14 | 768 |
| [desktop-mirror-consistency.test.ts](../../tests/desktop-mirror-consistency.test.ts) | added | 22 | 22 | 768 |
| [draw-ledger-frame-ownership.test.ts](../../tests/draw-ledger-frame-ownership.test.ts) | added | 4 | 4 | 768 |
| [engine-clock-transfer-integration.test.ts](../../tests/engine-clock-transfer-integration.test.ts) | added | 7 | 7 | 768 |
| [engine-network-integration.test.ts](../../tests/engine-network-integration.test.ts) | added | 11 | 11 | 768 |
| [engine-persistence-integration.test.ts](../../tests/engine-persistence-integration.test.ts) | added | 13 | 13 | 768 |
| [engine-physics-invariants.test.ts](../../tests/engine-physics-invariants.test.ts) | added | 8 | 8 | 768 |
| [engine-resource-integration.test.ts](../../tests/engine-resource-integration.test.ts) | added | 18 | 18 | 768 |
| [environment-loader-lifecycle.test.ts](../../tests/environment-loader-lifecycle.test.ts) | added | 14 | 14 | 768 |
| [festival-host-startup.test.ts](../../tests/festival-host-startup.test.ts) | added | 12 | 12 | 768 |
| [festival-renderer-loader-lifecycle.test.ts](../../tests/festival-renderer-loader-lifecycle.test.ts) | added | 18 | 18 | 1,280 |
| [festival-session-lifecycle.test.ts](../../tests/festival-session-lifecycle.test.ts) | added | 31 | 31 | 768 |
| [festival-terrain-transitions.test.ts](../../tests/festival-terrain-transitions.test.ts) | modified | 11 | 11 | 768 |
| [festival-terrain-transport.test.ts](../../tests/festival-terrain-transport.test.ts) | added | 9 | 9 | 768 |
| [flashback-determinism.test.ts](../../tests/flashback-determinism.test.ts) | modified | 2 | 2 | 768 |
| [flashback-work-budget.test.ts](../../tests/flashback-work-budget.test.ts) | added | 12 | 11 | 768 |
| [frame-buffer-pool.test.ts](../../tests/frame-buffer-pool.test.ts) | added | 11 | 11 | 768 |
| [gain-map-lifecycle.test.ts](../../tests/gain-map-lifecycle.test.ts) | added | 10 | 10 | 768 |
| [gpu-lifecycle.test.ts](../../tests/gpu-lifecycle.test.ts) | added | 20 | 20 | 768 |
| [gpu-pass-timer-lifetime.test.ts](../../tests/gpu-pass-timer-lifetime.test.ts) | added | 33 | 33 | 768 |
| [indexed-replay-store-lifetime.test.ts](../../tests/indexed-replay-store-lifetime.test.ts) | added | 18 | 18 | 768 |
| [input-controller-lifecycle.test.ts](../../tests/input-controller-lifecycle.test.ts) | added | 16 | 16 | 768 |
| [input-pump.test.ts](../../tests/input-pump.test.ts) | added | 4 | 4 | 768 |
| [music-bus-lifetime.test.ts](../../tests/music-bus-lifetime.test.ts) | added | 20 | 20 | 768 |
| [net-bytes-boundaries.test.ts](../../tests/net-bytes-boundaries.test.ts) | added | 38 | 38 | 768 |
| [net-client-lifetime.test.ts](../../tests/net-client-lifetime.test.ts) | added | 20 | 20 | 768 |
| [net-command-queues.test.ts](../../tests/net-command-queues.test.ts) | added | 56 | 56 | 768 |
| [net-event-loop-ownership.test.ts](../../tests/net-event-loop-ownership.test.ts) | added | 21 | 21 | 768 |
| [net-runtime-metrics.test.ts](../../tests/net-runtime-metrics.test.ts) | added | 51 | 51 | 768 |
| [net-server-control-validation.test.ts](../../tests/net-server-control-validation.test.ts) | added | 112 | 112 | 768 |
| [net-transport-lifetime.test.ts](../../tests/net-transport-lifetime.test.ts) | added | 50 | 47 | 768 |
| [open-world-worker-clock.test.ts](../../tests/open-world-worker-clock.test.ts) | added | 6 | 6 | 768 |
| [open-world-worker-frame-pool.test.ts](../../tests/open-world-worker-frame-pool.test.ts) | added | 7 | 7 | 768 |
| [preparation-trace-lifecycle.test.ts](../../tests/preparation-trace-lifecycle.test.ts) | added | 4 | 4 | 768 |
| [presentation-buffer-ownership.test.ts](../../tests/presentation-buffer-ownership.test.ts) | added | 6 | 6 | 768 |
| [presentation.test.ts](../../tests/presentation.test.ts) | modified | 20 | 20 | 768 |
| [racing-audio-lifetime.test.ts](../../tests/racing-audio-lifetime.test.ts) | added | 19 | 19 | 768 |
| [recorder-rings.test.ts](../../tests/recorder-rings.test.ts) | added | 31 | 31 | 768 |
| [recording-transport.test.ts](../../tests/recording-transport.test.ts) | added | 16 | 16 | 768 |
| [reflection-resource-lifetime.test.ts](../../tests/reflection-resource-lifetime.test.ts) | added | 12 | 12 | 768 |
| [replay-clock.test.ts](../../tests/replay-clock.test.ts) | modified | 27 | 27 | 768 |
| [review-audio-tap-lifetime.test.ts](../../tests/review-audio-tap-lifetime.test.ts) | added | 6 | 6 | 768 |
| [route-planner-equivalence.test.ts](../../tests/route-planner-equivalence.test.ts) | added | 8 | 8 | 768 |
| [rumble-actuator-lifetime.test.ts](../../tests/rumble-actuator-lifetime.test.ts) | added | 24 | 24 | 768 |
| [save-store-lifecycle.test.ts](../../tests/save-store-lifecycle.test.ts) | added | 35 | 35 | 768 |
| [session-replay-lifecycle.test.ts](../../tests/session-replay-lifecycle.test.ts) | added | 7 | 7 | 768 |
| [shadow-proxies.test.ts](../../tests/shadow-proxies.test.ts) | modified | 8 | 8 | 768 |
| [shadow-proxy-batching-equivalence.test.ts](../../tests/shadow-proxy-batching-equivalence.test.ts) | added | 3 | 3 | 768 |
| [snapshot-encoding-hotpath.test.ts](../../tests/snapshot-encoding-hotpath.test.ts) | added | 14 | 14 | 1,280 |
| [telemetry-export-lifetime.test.ts](../../tests/telemetry-export-lifetime.test.ts) | added | 27 | 27 | 768 |
| [terrain-tile-cache.test.ts](../../tests/terrain-tile-cache.test.ts) | added | 20 | 20 | 768 |
| [texture-budget-source-refresh.test.ts](../../tests/texture-budget-source-refresh.test.ts) | added | 2 | 2 | 768 |
| [texture-loader-cache-lifecycle.test.ts](../../tests/texture-loader-cache-lifecycle.test.ts) | added | 3 | 3 | 768 |
| [ui-audio-lifetime.test.ts](../../tests/ui-audio-lifetime.test.ts) | added | 17 | 17 | 768 |
| [worker-fixed-step-clock.test.ts](../../tests/worker-fixed-step-clock.test.ts) | added | 19 | 19 | 768 |

## Separate coordinator verification

The coordinating agent independently ran the complete project TypeScript compiler and the direct production Vite build on the same frozen source. Their retained logs were inspected for this report:

- TypeScript passed for **3,169 files**, with 2,366,496 KiB compiler memory and 36.88 seconds reported by the compiler.
- Production Vite build passed for **1,094 transformed modules** in 15.27 seconds; the IP guard and the existing source-stability guard passed.
- Four selected existing network cases passed; 17 other cases in that selected run were explicitly filtered. None of those four is added to the 60-suite inventory total.

The local product/full build identity records fingerprint `c3f2de274c415d70a377784a67bd926bbf96dff062385ffd90d75352c8847106`. Its commit field is `null`, consistent with building the pending final source before publication; the source fingerprint and frozen-input hashes identify the inspected contents.

These compiler/build/network results belong to the coordinator. Agent 58 did not repeat a compiler run after the full-project check passed. Log digests and the exact build identity are included in the JSON receipt.

## Limits

This is a consolidated run of the regression files added or modified by the engine programme. It establishes the stated results for those exact files and frozen inputs. It does not claim that every pre-existing repository test passes, that a browser test executed locally, or that physical GPU/audio/controller behavior or an overall FPS improvement was measured. The broader CI and browser status remain separate in the [development report](ENGINE_DEVELOPMENT_2026-11-24.md).

Controlled mocks, actual simulation modules, AST-extracted host methods, structured-clone transfers and deterministic reference comparisons provide different kinds of evidence within this inventory. Their per-suite contracts remain the authority on what each case exercises. The count is not an exhaustive proof for every possible gameplay state.

No production code, test implementation, models, characters, authored environments, assets, vehicle tuning, dependencies, commits or remote branches were changed by this inventory assignment.
