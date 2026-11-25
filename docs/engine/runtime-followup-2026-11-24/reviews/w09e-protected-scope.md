# Worker53 / W09E — protected content and engine scope audit

## Exact-source verdict

**Accept the published engine scope at `6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`**, tree `e6d37727eb695278c4934fa11365d6d014c40db6`, against task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`, tree `9be30d69c06ac08f9eec038334ad0f8bbd65b13b`.

The complete committed-tree inventory contains exactly **29 production engine files**. I reviewed every added/removed line in their **107 diff hunks (943 added / 295 removed lines)**. The edits implement ownership, bounded delivery/storage, input edge semantics, failure settlement, exact-output scalar construction and math reuse. I found **no authored model, character, environment definition, geometry/material/texture definition or asset, vehicle tuning, catalogue, track definition, dependency, or default-quality edit**. All 29 local production files matched their published blobs during this audit.

Five rendering implementation files do change. Their scope is resource acquisition/registration, texture-budget ownership and disposal, plus retaining existing render-pass handles for disposal. In particular, `src/rendering/open-world/festival-renderer.ts` is an environment-folder exception for lifecycle work; saying “all environment files are unchanged” would be inaccurate. The authored environment definitions remain identical.

This is a read-only source and evidence audit. I ran **no tests, compiler, build, browser, benchmark, asset-generation command, Git mutation, network operation or external message**. Reports/evidence were written only outside the repository under the requested paths. No new production correction is requested. A final metadata refresh remains necessary after the separately authorized three legacy fixture corrections and focused-CI update are published; that refresh must confirm the same production tree.

## Complete changed-path inventory

The recursive Git trees contain 9,795 baseline and 9,916 current tracked leaves. Their union contains 9,918 paths: **9,723 have identical mode/type/blob identity**, and 195 differ. Status totals are 123 additions, 70 modifications and 2 deletions. All production changes are modifications; both deletions are concurrent CI logs.

| Classification | Changed paths |
| --- | ---: |
| focused-engine-ci | 1 |
| concurrent-ci-reports | 31 |
| programme-evidence | 62 |
| browser-tests-and-fixtures | 14 |
| measurement-harnesses | 16 |
| production-engine | 29 |
| unit-tests | 42 |

The 31 `ci-reports/**` paths are kept separate from the 164 programme-owned paths. A local per-path last-writer query identifies **`ci-report[bot]` for all 31**; the machine-readable attribution records each commit and subject. Existing broad CI, content checks and report publisher definitions were not modified. Only `.github/workflows/engine-runtime-validation.yml` changed, adding focused source/test selection, a direct Vitest gate and evidence retention. The existing replay deadline, quality choices, no-retry checks, direct compiler/build invocation and source guard were retained at the audited commit.

`w09e-work/changed-path-inventory.json` lists **every** changed path, category, status, old/new mode, object type and complete blob ID. `all-tree-metadata.json` and the two raw NUL-delimited tree manifests retain all tracked paths, including sparse-checkout exclusions. No historical report binaries were materialized.

## Protected definitions: exact coverage and identity

The explicit protection groups below cover **3,883 distinct tracked leaves** after deduplicating overlap. Every member is listed with both object identities in `protected-coverage.json`; all members match. This explicit selection complements the complete 9,918-path comparison, so unanticipated changed paths cannot disappear behind a directory filter.

| Exact group | Leaves | Result |
| --- | ---: | --- |
| All of `assets/`, `authoring/`, `public/`, `playable/`, `tools/` | 297 | Identical |
| All `src/rendering/` except the five reviewed resource files | 703 | Identical |
| All `src/simulation/` except five reviewed engine implementation files | 169 | Identical |
| All `src/shaders/` | 4 | Identical |
| All `src/ui/` | 103 | Identical |
| Explicit package, lock, build/test and settings files | 8 | Identical |
| All existing scripts except the 16 new engine measurement harnesses | 304 | Identical |
| Every workflow except focused engine validation | 62 | Identical |
| Global model/image/material-format paths, including compressed forms | 2,497 | Identical |

The global extension selection is exactly `glb`, `gltf`, `fbx`, `obj`, `mtl`, `blend`, `png`, `jpg`/`jpeg`, `webp`, `ktx`/`ktx2`, `basis`, `hdr`, `exr`, `dds`, `tga`, `gif`, `tif`/`tiff`, `avif`, `svg`, optionally followed by `.gz`, case-insensitively. It includes documentary images as well as production assets. JSON and code-authored content are covered by their complete source/asset trees, not by this extension heuristic.

Selected unchanged tree IDs provide compact independently reusable evidence:

| Protected subtree | Leaves | Identical baseline/current Git tree |
| --- | ---: | --- |
| `assets` | 2 | `a17835cbd39364c5baec560e73badf748a450a15` |
| `authoring` | 22 | `9232f7c8f4254fbe8d462f7a94fb1b212e8c15d7` |
| `public` | 231 | `2cac282975906f4e5403dd51c05df626cdbe1597` |
| `public/models` | 44 | `8522edf24f42bc5164764e311faf9197a36109ac` |
| `public/assets` | 185 | `c092d27d81aa7a5a22f6ab2ff3229fa7ea540749` |
| `src/rendering/materials` | 4 | `57638624e7b6e80034bf961780b69703b5558ee4` |
| `src/rendering/vehicle-bodies` | 36 | `8d9fc6cb0870509e17eb7241b929b724bdbc2f74` |
| `src/rendering/venue-kit` | 38 | `d096406766d9b96cd29640ab27be27ed96d78786` |
| `src/rendering/vegetation` | 9 | `1d80c38cbec847015063234c030f88c36c0ccaeb` |
| `src/rendering/offroad` | 114 | `0efdda46066accbd0fb75a37df2bd085d1a71b70` |
| `src/shaders` | 4 | `82b133b562ff1304bbff846861032a36252f76ef` |
| `src/simulation/vehicle-catalogue` | 16 | `8b957c3c7584be5eaa4be6bba09d4d00a0cc0747` |
| `src/simulation/circuit-catalogue` | 14 | `426826007d7b747ea0f5c1514ae96670e29e029a` |
| `src/simulation/offroad` | 28 | `93db6836722214d3676e24d400cd816af87b4809` |

Additional precise exclusions:

- `src/rendering/open-world/` has 58 leaves: 57 are identical; only `festival-renderer.ts` has the reviewed ownership/disposal changes. Its light/sky values, camera defaults, terrain, roads, vegetation, materials, frame pipeline and quality configuration are unchanged.
- `src/simulation/open-world/` has 35 leaves: 34 are identical; `session.ts` only introduces a typed pre-mutation command-validation error and substitutes it at three existing validation throws. Region, road, event, world and terrain definitions are unchanged.
- The five simulation implementation exceptions are `bvh.ts`, `contact.ts`, `road-contact.ts`, `vehicle.ts` and `open-world/session.ts`. In `vehicle.ts` only the fixed-four AWD slip maximum changes; no tuning value changes.
- Root `package.json` blob is `3706ae53a34453f33f1ead9015005246aa6d7831`; root `package-lock.json` blob is `9f3197395e8b9ec7d82e73668b21727b37038805`. Their SHA-256 values are respectively `8b869eba1bd88baa34bf8544e4cf955e055806a2ea6e63d747f62168ad6e9436` and `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`. Both are identical to baseline. The full `desktop/` tree, including its package and lock files, is also unchanged.
- `src/storage/data.ts` (default quality `medium`), `src/rendering/options.ts` (preset texture limits/filtering), `src/simulation/config.ts`, both catalogues, `vehicles.ts`, `bike-definitions.ts`, `offroad/dirt-bikes.ts`, `circuits.ts`, `track.ts`, weather/material definitions and model-generation scripts are identical.

I compared these same protected leaves against **all seven named programme checkpoints**, and against **all 18 locally reachable first-parent commit trees** from checkpoint1 through checkpoint7. Every comparison has zero protected changes and zero unexpected production paths. `checkpoint-protected-matrix.json` and `reachable-chain-scope.json` retain those results.

## Allowed production methods and behavior

The following is the complete 29-file production inventory. Supporting state/type declarations are included where their ownership or message shape changes. `allowed-production-changes.json` also records exact baseline/current hunk coordinates and SHA-256/blob identities per file.

| Production file | Reviewed changed members / scope |
| --- | --- |
| `src/audio/engine.ts` | `RacingAudio.previewDriving`, `RacingAudio.muted getter/setter`, `RacingAudio.isMuted state`. Preview activation/cancellation ownership: muted or non-running live audio cannot arm delayed tones; offline scheduling remains supported. |
| `src/core/ghost-lap.ts` | `ghost bounds/constants`, `validLapTime`, `validateGhost`, `GhostRecorder.observe`, `GhostRecorder.discardLap`, `GhostRecorder.pushSample`. Bound and validate recorded ghost storage using the existing accepted duration/minimum samples and a derived maximum sample bound; discard ineligible or malformed laps; existing version-1 record field shape retained. |
| `src/input/button-actions.ts` | `ControllerActions.poll`. Observe the entire button sample before dispatching at most one UI action, so callbacks cannot leave later held edges unconsumed. |
| `src/input/controller.ts` | `pendingShifts ownership`, `InputController.keyDown`, `InputController.queueShift`, `InputController.stageShift`, `InputController.reset`, `InputController.update`. Bounded FIFO ownership for discrete shift edges through host acknowledgement, preserving accepted keyboard/gamepad order. |
| `src/main.ts` | `GameApp.constructor blur registration`, `GameApp.startFestival load callback`, `GameApp.start engineering message callback`, `GameApp.suspendOnBlur`, `GameApp.suspendPlayback`, `GameApp.pause`, `GameApp.exportTelemetry`, `GameApp.fail`, `GameApp.dispose blur release`. Host worker/diagnostics credit ownership, asynchronous export ownership, error cleanup, and audio/haptic suspension; no presentation definition or quality default changes. |
| `src/net/authority.ts` | `JOURNAL_ENTRIES_PER_CAR_TICK`, `NetDriver.shiftEdge`, `NetDriver.update`, `JournalEntry union`, `AuthoritativeWorld.setControls`, `AuthoritativeWorld.setLevelControls`, `AuthoritativeWorld.setMode`, `AuthoritativeWorld.apply`, `KIND journal tags`, `encodeJournal`, `decodeJournal`. Intentional live one-shot shifts and explicit journal tag 5; legacy control tags 0/4 keep persistent shift replay semantics; journal level snapshots have independent ownership. |
| `src/net/client.ts` | `RaceClient.sample`. Rejecting a malformed current input clears shift together with other discrete edges instead of replaying the previous shift. |
| `src/net/input.ts` | `quantizeControls`. Replace temporary byte encode/decode with exact wire-equivalent scalar clamp/round/coercion; control field layout and writer/reader unchanged. |
| `src/net/records.ts` | `createRecord`. Archive only consumed journal entries before exclusive endTick; trim the current-boundary suffix without changing record schema or digest rules. |
| `src/net/server.ts` | `SnapshotBatch and ownership state`, `ServerStats transport diagnostics`, `RaceServer.ownsWorld`, `RaceServer.send`, `RaceServer.sendData`, `RaceServer.close`, `RaceServer.closeTransport`, `RaceServer.transportError`, `RaceServer.rejoin`, `RaceServer.startGrid`, `RaceServer.tick`, `RaceServer.snapshot`, `RaceServer.disconnect`, `RaceServer.lost`, `RaceServer.forfeit`, `RaceServer.endRace`, `RaceServer.teardown`. Retire peer/session ownership before callbacks, isolate transport failures, share per-boundary capture with independently encoded recipient packets, bound reentrant batches, and stop stale grid/results work. |
| `src/rendering/assets/texture-source-ownership.ts` | `disposeSceneTexture`. Independent exclusive bitmap release after texture-disposal errors, with shared/cache pixels kept borrowed and first error preserved. |
| `src/rendering/imported-texture-budget.ts` | `ImportedTextureBudget.register`, `ImportedTextureBudget.unregister`, `ImportedTextureBudget.dispose`. Batch shared image acquisition and retire/restore wrapper ownership on unregister/dispose; apply/resampling/filtering logic unchanged. |
| `src/rendering/open-world/festival-renderer.ts` | `FestivalRenderer.outputPass handle`, `FestivalRenderer.constructor pass registration`, `FestivalRenderer.dispose`. Retain existing OutputPass for release; dispose owned sky geometry/material, near sun shadow targets and output pass. Borrowed renderer survives; environment/scene definitions untouched. |
| `src/rendering/renderer.ts` | `RacingRenderer.outputPass handle`, `RacingRenderer.constructor pass registration`, `RacingRenderer.releasePlanting`, `RacingRenderer.dispose`. Retain/release OutputPass and independently attempt existing planting-owner cleanup after unregister failure. Geometry/material/texture generation and rendering pipeline configuration untouched. |
| `src/rendering/texture-budget.ts` | `CanvasSource.groups ownership index`, `TextureBudget.register`, `TextureBudget.unregister`, `TextureBudget.refresh group iteration`, `TextureBudget.dispose`. Batch compatible wrappers by owned source and preserve restoration/reentrant release. Existing apply/applyDetail implementation and defaults unchanged. |
| `src/session/free-roam.ts` | `FestivalSession.boot`, `FestivalSession.fail`, `FestivalSession.receive status branch`, `FestivalSession.frame`. Require renderer readiness also for default startup; fatal cleanup survives notification errors; sequence-bound status acknowledgement; return after HUD callback disposes session. |
| `src/session/session-lifetime.ts` | `SessionLifetime.wait/finish/abort closures`. Settle promises despite cancellation callback errors, preserving original rejection/abort cause and reporting cleanup failure after otherwise successful work. |
| `src/simulation/bvh.ts` | `TriangleBVH.build`. Accumulate each component minimum/maximum in scalar locals and store once per node; same fold/order/signed-zero/partition/traversal behavior. |
| `src/simulation/contact.ts` | `TrackContactMesh.constructor row guard`, `TrackContactMesh.constructor normal/index typed-array writes`. Require positive-integer rows; replace temporary normal/index literals with same-order same-offset scalar typed-array writes. Authored height/bank/kerb/bands, resolution and winding unchanged. |
| `src/simulation/open-world/session.ts` | `FestivalCommandValidationError`, `OpenWorldSimulation.command start/vehicle/travel validation branches`. Identify pre-mutation command validation failures so worker can distinguish recoverable rejection from fatal execution failure; no world/event/vehicle definition edits. |
| `src/simulation/road-contact.ts` | `RoadContactFrame.set`. Reuse the already validated ordinary Vec3 normal length instead of recomputing it in normalize; mathematical expressions after that copy remain unchanged. |
| `src/simulation/vehicle.ts` | `Vehicle.coupleClutch AWD slip maximum`. Use four explicit Math.abs terms in Math.max instead of array map/spread under the fixed-four tire invariant; no torque, gearing, grip, setup or catalogue tuning changes. |
| `src/storage/recorders.ts` | `telemetry channel-index constants`, `TelemetryRecorder.truncate`, `TelemetryRecorder.snapshot`. Use Float32 session-time cutoff and reset last-tick deduplication after rewind; copy chronological ring snapshot in at most two spans. |
| `src/storage/replay-pages.ts` | `SessionReplay.truncationPage`, `SessionReplay.truncate`. Compare double rewind receipts in the stored Float32 pose-time domain; unchanged replay fields and page shape. |
| `src/storage/telemetry-schema.ts` | `telemetryCsv`. Materialize completed 500-row CSV groups as Blob parts; channel list, formatting, finite validation and final MIME type unchanged. |
| `src/workers/diagnostics.ts` | `EngineeringMessage`, `ClientMessage/WorkerMessage unions`, `EngineeringChannel.reset/enable/publish/acknowledge`, `isEngineeringSample surface predicate`. One in-flight optional diagnostics sample with epoch/sequence acknowledgement; validate existing material IDs through unchanged MATERIALS definitions. |
| `src/workers/open-world-protocol.ts` | `FESTIVAL_STATUS_CAPACITY`, `ToOpenWorld statusAck`, `FromOpenWorld status sequence`. Internal worker envelope gains sequence and acknowledgement; bounded 64-status credit, preserving every accepted status transition. |
| `src/workers/open-world.worker.ts` | `failed/status receipt state`, `statusAvailable`, `status`, `scope.onmessage init/pause/command/statusAck/fatal paths`, `setInterval gate and fatal path`. Bound status delivery, reject busy commands before mutation, suspend stepping/rebase under prolonged backpressure, and make execution errors terminal until init. |
| `src/workers/physics.worker.ts` | `EngineeringChannel instance`, `failed state`, `finishFlashback diagnostics reset`, `fail`, `engineering`, `scope.onmessage receipt/init/fatal paths`, `setInterval failure/rewind handling`. Diagnostics credit flow and terminal worker ownership; stale resume cannot revive partial failure, while delivered ownership ACKs still retire. |

### Rendering scope is resource ownership

In `FestivalRenderer`, changes are a stored `OutputPass`, registration of that same pass in the existing order, and disposal of the owned sky geometry, sky material, near sun shadow targets and output pass. The borrowed renderer is not disposed. In `RacingRenderer`, the corresponding pass gets an owned handle/disposal and `releasePlanting` independently attempts the existing planting owner after budget unregister throws. No planting generator or nested authored owner was edited.

The two texture budgets change shared-source registration scheduling and ownership teardown. Their entire `private apply` to pre-`dispose` spans, including `applyDetail` where present, are **byte-identical** to baseline. The generated span SHA-256 is `3a6d1966cea3022802e4a9f5059e52dc1d0baff385a7dcf337bd178c437df8da`; the imported span is `6e1872cfcb2d8fe52047644d35673b507a38b593c792defbf3e756b121cc3be2`. Thus resampling, coverage/mipmap computation, dimensions and filter application remain the same implementation. `refresh` only iterates Map values instead of Set values.

Retained W08E native evidence reports exact CPU and rendered pixels for three tested source groups and six Festival lifecycle cycles with a surviving borrowed renderer. It is evidence for those resource cases, not an assertion that every whole-game image was compared. Known remaining limits are documented: a throwing Three listener installed before its GPU release listener may interrupt vendor cleanup; nested planting/BikeShells/vendor cleanup internals remain unchanged. The patch guarantees independent cleanup attempts and first-error preservation at the reviewed owners, not universal exception-proof draining.

### Formats and message semantics: intentional exceptions

An “all formats/protocols unchanged” statement would be false:

- Journal **tag 5** adds an explicit one-shot shift edge. Tags 0/4 retain archived persistent-shift replay semantics; older decoders reject the new unknown tag. The per-car per-tick entry bound rises from 6 to 7.
- Engineering worker messages gain epoch/sequence receipts and `engineeringAck`; Festival status messages gain a sequence and `statusAck`. Festival queue capacity is explicitly 64. These internal host/worker envelopes and backpressure semantics intentionally change.
- Ghost version/record field layout, packed simulation frame layout, control-wire field layout, replay page layout, telemetry channel list and CSV text rules remain unchanged. Ghost acceptance is intentionally stricter and bounded. Record archiving intentionally excludes the unconsumed current-tick suffix. A schema-shape identity claim must not hide those behavior changes.

## Simulation equivalence and positive-integer rows

The scope allowance for generic collision construction is backed by source-level reasoning and retained exact-output evidence, rather than an assertion that arbitrary gameplay is unchanged.

`TriangleBVH.build` performs the same per-axis `Math.min`/`Math.max` fold in the same vertex order, retaining signed-zero behavior. It writes the six final bounds before the unchanged split/partition code. `TrackContactMesh` stores identical normal components and triangle indices at identical offsets in the same order; authored bands, columns, kerb/height/bank equations, triangle winding and row resolution are unchanged. `RoadContactFrame.set` reuses the ordinary Vec3's pure length after the original threshold check; the normalize fallback is unreachable on accepted normals. `Vehicle.coupleClutch` uses exactly the same four absolute slips under its existing fixed-four tire invariant.

I independently checked **22 W07 target-source manifest entries** against their declared local commit/blob IDs and actual source SHA-256s, plus four contact/simulation harness hashes and three post-guard target-source entries. All match. The final BVH, road-contact and vehicle files exactly match the measured candidate. `contact.ts` differs from that measured candidate only by the later row-domain guard; W07 constructor timings do not measure that new guard.

Retained, source-pinned proof includes:

- W07A: exact BVH node/order outputs and sampled query results at 1,024-row Poggio Alto and 8,192-row Aurel; each case compared 26 constructed trees and preserved geometry hashes.
- W07B: eight exact contact meshes (rows 1, 2, 31, 128, 257 and three actual 8,192-row meshes), with matching vertices/normals/indices/tree hashes and sampled query hashes.
- W07E: three 1,200-tick production Simulation traces (formula, wet motorcycle and motocross), ten simulated seconds each, totaling **617,181,316 identical captured bytes**. Packed frames and exposed dynamic state are captured every tick; weather/surface/terrain checkpoints are less frequent. JavaScript private state, static authored definitions and internal collision scratch are outside that state capture. This is finite trace evidence, not every trajectory or physical-GPU/FPS evidence.

The positive-integer contract deserves an explicit qualification. Fractional rows **0.4, 1.4 and 7.4** caused the original typed-array `.set` version to throw, but the intermediate scalar version could silently return truncated meshes. The final guard rejects them before allocation:

```ts
if (!Number.isInteger(rows) || rows < 1)
  throw new RangeError('Contact mesh rows must be a positive integer');
```

The retained post-guard proof imports the actual baseline constructor; it shows those fractions rejected again and rows 1/2 with identical buffers. Zero, negative zero and NaN now receive an explicit `RangeError` instead of the later original BVH error. This is an intentional clarification of malformed-input rejection, not exact preservation of every old exception class/message. Production callers still use 8,192 or `Math.max(8192, Math.ceil(track.length / 0.9))`; no caller or authored resolution changed. Fixed arrays/ordinary Vec3/static mesh ownership are the numerical domain; custom accessors/overrides or externally mutated shared geometry are not claimed equivalent.

The original W07B +9.96% rl2 timing observation remains unresolved. W07E's longer, fresh-process natural rl2 result did not robustly reproduce it, but did not establish its cause. No natural-vehicle throughput, full-game FPS or hardware gain is certified here. Current authored AWD clutch coupling is dormant in that optimized branch, so it contributes no claimed natural-workload saving.

## Model-generation hooks and CI ownership

The recorded programme validation commands use direct installed Vitest, TypeScript, Vite and Playwright entry points. The changed focused engine workflow does the same, and the inspected measurement harnesses do not invoke npm test/build/dev hooks. The workflow's unchanged `npm ci` install has no root install lifecycle hook that calls the player generator. Programme reports explicitly retain this no-generation execution policy. Worker53 invoked none of these workloads.

**This must not be generalized to all automatic repository CI.** The unchanged `.github/workflows/ci.yml` explicitly retains npm pretest generation and calls npm build; other unchanged workflows also call those commands. Those pre-existing automatic content/build paths are not this programme's code changes. All 62 other workflow files and all existing generation/support scripts remain identical, and all changed CI reports are independently attributed to the report bot.

The unchanged `scripts/source-stability.ts` excludes generated `public/models/supplied-player-lods.bin.gz`, along with browser evidence receipts. That generated model output is untracked and absent in the local working tree. Therefore a passing source guard alone is not a proof that no model generator ever ran. The supported assertion is that **the recorded engine programme commands and focused engine job avoid those hooks, and committed authored assets/definitions are identical**.

## Limits and remaining action

1. Complete Git tree metadata covers committed tracked content even when sparse checkout omits a file. Binary asset bytes were not downloaded or independently rehashed; equality is the same Git object ID, file type and mode. No missing-object fetch was attempted; all requested tree metadata and needed engine text blobs were locally available.
2. Local history is shallow at both baseline and checkpoint1. The audit covers the endpoints, all seven published engine checkpoints and all 18 reachable intervening trees. It cannot certify an unseen history before the shallow boundary or transient edits undone between commits. Untracked/generated outputs and remote/runtime-loaded assets are outside committed-tree equality.
3. Retained experiments were inspected and linked to exact sources; they were not rerun by this worker. Published CI verification belongs to the separate Wave9 CI auditor.
4. Three legacy fixture corrections and the focused workflow update are authorized separately. They must not change the 29 production blobs. Recheck final publication metadata, then append its exact SHA/tree and delta to this report. No engine scope repair is otherwise needed.

## Evidence index and audit commands

All evidence is under `/tmp/engine-c71f32882729/w09e-work/`:

- `changed-path-inventory.json`: all 195 changed paths with categories, statuses and complete before/after identities.
- `all-tree-metadata.json` plus `1c609bf-tree-metadata.bin` / `6a6bf02-tree-metadata.bin`: complete recursive path/type/mode/object metadata.
- `protected-coverage.json`: all explicitly covered paths, overlapping group digests and unchanged subtree identities.
- `checkpoint-protected-matrix.json`, `reachable-chain-scope.json`, `history-coverage.json`: publication and shallow-history coverage.
- `allowed-production-changes.json`, `production-hashes.json` and 29 `src__*.diff` files: exact per-method review coordinates and source hashes.
- `unchanged-texture-application-fragments.json`: byte identity of the budget application implementations.
- `equivalence-evidence-linkage.json`: actual-source manifest/harness checks and retained exact-output proof summaries.
- `ci-report-last-writers.json`, `ci-report-commits.txt`, `focused-workflow-published.diff`: CI attribution and exact committed focused-workflow scope. The broad historical log includes a shallow-root artifact at checkpoint1; use per-path last-writer records for attribution.
- `audit-operations.json`: read-only operation classes and exclusions; `working-tree-status.txt` is the initial status snapshot, not a later final publication claim.

Every Git invocation used `GIT_NO_LAZY_FETCH=1`, `GIT_OPTIONAL_LOCKS=0` where applicable and per-command `-c protocol.allow=never`. The core comparison is `git ls-tree --full-tree -r -t -z <revision>` plus a keyed comparison of every leaf's mode/type/object ID. Only selected engine source diffs/blobs were read with `git diff --no-ext-diff --no-textconv` and `git cat-file blob`. No full historical binary diff or archive was used.
