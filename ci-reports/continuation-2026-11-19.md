# Published continuation and source-specific CI follow-up

Checkpoint as of 2026-11-19T16:30:56.432Z. Main browser results below are explicitly partial; the separate rendering-candidate run is complete.

## Publication

The user authorized: “Push a1e2e38 to main and continue with CI.” The exact reviewed file tree was published as [d8d87c73a8f3e921e865acdc02c61e84b8c877a7](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/d8d87c73a8f3e921e865acdc02c61e84b8c877a7). Both that commit and local reviewed commit `a1e2e385251b94f7cc82e123440a0a4c72611d63` have tree `51077ee3c9103d7faf139b622aa806bf8652d1f6`.

The command-line push had no GitHub credentials. The authenticated GitHub connection uploaded the reviewed blobs, verified the tree, created a server commit and fast-forwarded `main` from `c53f18073618523d63603577fa8f9b7ab038010c` with a matching-head lease. The connection does not expose commit author/timestamp overrides, so the server commit has a different identity. A subsequent fetch and tree diff confirmed there were no file differences. This was not a force push. [Publication receipt](evidence/continuation-ci-20261119/publication/publication-receipt.json).

The publication contains six test/fixture changes and their documentation/evidence. All 931 production `src/` files remain byte-identical to the published application at `2d67572a9a2ba4daa33311dcc9abed2c1b537632`. None of the rejected physics candidates was integrated. The older continuation-review report describes its historical prepublication checkpoint; this report records the later publication and actual CI results.

## Results on the published tree

These results belong to `d8d87c7`, whose tree is identical to the approved `a1e2e38`. They do not establish results for subsequent diagnostic or physics candidates.

| Workflow or gate | Observed result | Scope |
| --- | --- | --- |
| [Build and validation — 44553045707](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707) | In progress at the latest retained snapshot | Full acceptance requires every original job. |
| Main validate | Passed | Product lint/content validation/typecheck/build/IP guard, demo build/IP guard and exact-source/build artifact upload. |
| Main scenarios | Passed | Original physics, rotation, pit, classification, Vellamar, reference and vehicle calibration commands. |
| Main offroad scenarios | Passed | Original offroad calibrations and races, including all 20 jump runs and zero band failures. |
| Main wet presentation | Passed, 7/7 | Original independent SwiftShader browser gate. |
| Main full unit suite | Cancelled near its 45-minute cap; incomplete | 528 completed file summaries contain 5,958 passing and two failing tests. No global Vitest summary was produced. |
| Main browser partition 12 | Failed: 21 passed, 7 failed, 1 existing conditional skip | All seven failures are readiness or execution deadlines; no visual assertion mismatch was reported. |
| Other 11 main browser partitions and owner QA | Pending | Every job passed setup and reached its actual test command. No installation retry was required. |
| [Graphics evidence — 44553045749](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045749) | Failed overall | Seven component tests and the full compact driving/replay journey passed; High startup failed. |
| [MotoGP review — 44553045866](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045866) | Failed overall | Build and 699 focused unit tests passed. Browser cases: 26 passed, 1 failed. |

No assertion failure was retried to seek a passing result. The existing browser retries, race bounds, quality settings, viewports, test deadlines, GPU completion checks and publication gates were retained.

### Full unit checkpoint: two observed failures, unfinished suite

The unit job ended as `cancelled` after 45 minutes 14 seconds, close to its unchanged 45-minute cap. The available log says “The operation was canceled” without explicitly naming the initiating cause. No agent cancelled or reran it. Its 528 completed file summaries report 5,960 cases: 5,958 passed and two failed. These are partial observations, not full-suite totals. There are 694 committed paths matching the exact Vitest include; 166 have no completed summary, which does not distinguish not-started files from interrupted files.

The mixed GP/Superbike race at Vellamar, seed 3303, failed because the best GP lap (91.13427179346363 s) was slower than the best Superbike lap (90.36337145755091 s). The wet Poggio eight-rider case, seed 30101, failed its zero-contact assertion with an observed impact value of 0.9916666666666667. Its later crash and classification assertions were not reached. These values belong to the published baseline; the separate throttle control investigation below has its own source identity and different lap times.

The corrected startup fixture passed all 32 cases. The completed file summaries also confirm high-fragment-inspector 6/6, preparation 9/9, recorded-signal-displays 9/9 and reflections 27/27. None of these focused outcomes replaces the unfinished full suite. The cancelled unit prerequisite blocks release publication.

[Frozen unit checkpoint and complete logs](evidence/continuation-ci-20261119/main-unit-checkpoint/README.md) · [Exact source discovery coverage addendum](evidence/continuation-ci-20261119/main-unit-coverage-addendum/README.md).

### First completed ordinary browser partition

Partition 12 completed its full assigned set of 29 cases out of the original 353-case discovery. Its test invocation took 52.8 minutes and produced 21 passes, seven failures and one skip. The skip is the existing `!REVIEW_BUILD` guard on the reference review-tool continuation; this work introduced no skip.

| Case | Original failed boundary |
| --- | --- |
| Wet-day full chase lap, held views and replay weather | Still `loading` after the 240-second race-state predicate. |
| A61 Aurel clear/day full grid | Still `loading` after the 240-second `paused` predicate. |
| A33 spare-wheel-set ordinary startup | Still `loading` after the 240-second race-state predicate. |
| A36 workshop-equipment ordinary startup | Still `loading` after the 240-second race-state predicate. |
| Full-scene populated-grid fog GPU survey | 300-second test deadline, inside `page.evaluate`. |
| MX and SX worked-soil prepared traffic | 300-second test deadline. |
| A71 sunset event-hall survey | 600-second test deadline, inside `page.evaluate`. |

These logs establish the failed deadlines, not a common native graphics cause. The component, visual and physical assertions downstream of readiness were not reached in the corresponding cases. Artifact `14550657945` uploaded successfully (719,688,136 bytes; upload-reported SHA-256 `684a43807ef8df5e1cb5f670947afe6ea852e966471ddeb781291a8a9205d2ba`). The full archive was not downloaded; the complete compressed job log and its provenance preserve the current findings.

[Frozen browser partition 12 checkpoint, exact test names and complete log](evidence/continuation-ci-20261119/main-browser-12-checkpoint/README.md).

### High startup: earlier inspector stall removed, another blocker exposed

The component job passed all seven fixtures. Its 32 attached PNG files are byte-identical to the committed `components-2d67572` evidence. The original Low 640×400 driving, performance capture and recorded replay journey also passed. These are software-renderer results, not physical-hardware performance measurements.

High still failed the original 90-second `paused` predicate at `graphics-high-journey.spec.ts:698`; state remained `loading`. The original High quality, 960×600 viewport and 300-second test deadline were unchanged. Playwright reported 166.069 seconds for the whole failed test, including delayed observation and cleanup; that number is not the readiness predicate's configured deadline.

The inspector correction is visible in the actual trace: 140 completed `getFragDataLocation` calls total 21.5 ms, versus 13 calls totaling 29,627 ms in the earlier `2d67572` trace. The remaining failure is within the first chase reflection warmup, before any retained `fenceSync`, `clientWaitSync` or `flush` call. The later compile-after-draw and explicit GPU wait have not been reached.

The first chase begins at page time 105,487.6 ms. Three late `getProgramInfoLog` requests follow, for programs 419, 424 and 436. The third costs 7.643 seconds during the first cube face (+X). The final retained native operation is a later in-flight `texSubImage2D`, sequence 23,686, during cube face +Z at 256×256. Its preceding `texStorage2D` returned. The independent worker observes at least 3.516 seconds in flight; no GL error was captured. Native call wall times can include waiting for prior driver work and do not isolate shader compilation, transfer cost or GPU execution time.

The initial 32 program-summary and 64 first-use allowances were exhausted before these late programs. Consequently this run does not establish their shader names or resource owners. The currently bound program during an upload is context, not proof of the uploaded texture's ownership. The last application-wide diagnostic was stale while the page thread was blocked; it cannot supersede the later independent worker observations.

[Complete graphics findings and compact evidence](evidence/continuation-ci-20261119/graphics-d8d87c7/README.md).

### Compact menu startup: a separate later stage

The MotoGP-focused unit job passed 55 files / 699 tests. Its six browser groups produced 26 passes and one failure. The failure is `30-menu-access.spec.ts:162`, “640x400 settings persist and the normal paused grid starts”: Low quality, four Formula cars, Aurel, dry conditions. The original 60-second predicate expected `paused` and observed `loading`.

The screenshot and error context show “Warming up tyres” at 94%. Subsequent inspection of the already-downloaded trace recovered direct stage and native-fence evidence from the published `menuTimingTest` fixture. Snapshot `before@call@2670` at trace time 152,252.606 ms contains hidden `#loadingText` = “Waiting for completed cockpit GPU work…”. This is a direct observation 54.790 seconds after the paused-grid click began, not merely an inference from the public progress label.

In post-reload document epoch `1795101643928`, world context 1 created fence 13 at page time 73,341.5 ms. Eleven completed zero-timeout `clientWaitSync` calls returned native `37147 / TIMEOUT_EXPIRED` between page times 73,385.8 and 81,137.4 ms. Each returned in 0–0.1 ms; the native polls themselves were not recorded as synchronously blocked. No completion or deletion of fence 13 appears in the retained trace. Earlier fences 11 and 12 returned `CONDITION_SATISFIED` and were deleted. The epoch contains 173 timing packets with zero reported browser-event drops. This establishes an observed unfinished fence during the completed-cockpit stage, without identifying the responsible draw, shader, upload or driver work, or proving that it would never complete.

All 29 completed JavaScript state polls returned `loading`. Two evaluations were delayed by 6.283001 and 22.624815 seconds; a recorded 23.141-second main-thread task overlaps the latter. Final state polls again returned promptly. The network trace has 144 retained resource records (142 HTTP 200, two HTTP 304), without a recorded failure. Its 239 console records are debug messages; no console warning/error or page-error event was found. An unnamed context 2 was lost during earlier settings setup, before the paused-grid click; no loss is recorded for world context 1. Both settings-transition sizes passed. Keep this later completed-cockpit failure separate from High's earlier first-reflection stall.

[MotoGP findings, complete compressed logs and failure screenshot](evidence/continuation-ci-20261119/motogp-d8d87c7/README.md). That frozen package retains the initial label-based interpretation; the [menu-timing addendum](evidence/continuation-ci-20261119/menu-timing-addendum/README.md) preserves the stronger direct evidence above without rewriting the earlier record.

## Bounded diagnostic follow-up

Local commit `41294f9454da7c625d9cf141afa41a05360903e1` changes only the High test's diagnostic collection plus documentation/evidence. It retains up to eight late program-metadata records and 16 completed uploads of at least 100 ms after first chase begins. Cached vertex/fragment text supplies bounded shader identity; dedicated Node-side collectors retain records after the ordinary activity ring expires. No additional native graphics query, draw, flush or finish is introduced.

The composed CPU proof passed on the candidate and failed as expected on the exact old `d8` spec when the early allowances were exhausted. It checks native argument/receiver/result/exception behavior, unchanged native call counts, bounded retention and survival after 400 activities. TypeScript and scoped ESLint passed. The final guarded runs retained 7,458 unchanged protected inputs. This is CPU validation, not a browser or performance result. The initially failed proof invocation was a harness serial assertion; its original log and receipt are preserved alongside the correction.

The observed costly program 436 is third among the three late requests and fits the new allowance of eight. Future traces may exhaust either cap. A slow upload must return before its stack can be recorded; the unchanged worker still reports an operation that remains in flight. Bounded reporting adds CPU overhead and does not establish timing neutrality.

The current main CI run is being preserved. The separate branch `ci/high-late-startup-20261119` was published as `d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6`, tree `b0eb64883e62199a789ba351385718ec80e07a89`, identical to local `f97e732fb7106db4230c2ecece1b17abdc92b324`. [Isolated run 44559369205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205) completed with the same original 90-second readiness failure after setup and build passed. The complete failed test took 156.008 seconds. `main` remained at `d8d87c7`. Its complete High job is byte-identical to the original job, including all eight steps, dependencies, environment and deadlines. It cannot publish the application or substitute for any main acceptance gate. [Branch publication receipt](evidence/continuation-ci-20261119/publication/high-isolated-publication-receipt.json).

The new bounded records identify four late native programs:

| Program | Recorded shader owner name | Result in this diagnostic run |
| --- | --- | --- |
| 419 | `PMREM.Background` | Metadata query returned in 888.3 ms. |
| 424 | `PMREM.Background` | Later work progressed; exact completion duration is not retained. |
| 436 | `Recorded marshal display 0` | Query returned in 5,723.2 ms during cube face +X. |
| 463 | `APEX scalable ambient obscurance` | Final in-flight metadata query, observed for at least 12,198.3 ms at 480×300. |

All four records fit within the new allowance of eight. The earlier `texSubImage2D` sequence 23686 returned in this run after 6,512.2 ms; preparation then reached the separate ambient-obscurance shader. The first warmup draw still had not returned, and retained fence/flush counts were still zero. Sixteen upload stacks were retained, but their bounded call chains end in Three's generic buffer/texture paths; they do not establish a unique application resource owner. Their allowance was exhausted before some later slow uploads. The marshal fragment prefix is explicitly truncated, with its full-source hash preserved.

Source review confirms that initial scene compilation omits the separate `SceneAmbientPass` fullscreen materials. It also compiles before the recorded marshal update first attaches the cached display material. Those observations motivated the separate candidate below. The two PMREM background programs remain a separately identified gap.

[Diagnostic design, limitations and local proof](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6/docs/studio/reports/graphics-high-late-startup-diagnostics.md).

[Completed diagnostic run, bounded records and artifact provenance](evidence/continuation-ci-20261119/high-isolated-d784d94/README.md).

## Isolated rendering candidate: source-specific validation

The isolated branch was advanced with a matching-head lease to `a02e516cf3a58b33e4f783ecb37baafeed0e6ba5`, tree `a9c5d75554b2805b42eea1f393e01e616bbc5d9d`, identical to local commit `872fa9d06edbcbb57b47167f0c99a660bb9bb3ef`. It changes three production rendering files. The original published application on `main` remains unchanged. [Candidate publication receipt](evidence/continuation-ci-20261119/publication/prewarm-candidate-publication-receipt.json).

The renderer selects the recorded marshal material for the same paused frame before scene compilation, then awaits preparation of the ambient pass's enabled obscurance, blur and composite materials on their actual native targets. The preparation helper uses the real fullscreen mesh and camera through the public quad interface without drawing. Borrowed target, viewport, scissor and material state is restored before each await. Cancellation, disposal and compilation failures stop subsequent warmup. The complete original chase/cockpit draw loop and both native GPU-completion waits are unchanged.

All 87 tests across seven focused files passed, including 37 startup cases and eight native-cache ambient-preparation cases. TypeScript and scoped ESLint passed. The unchanged source-stability guard checked 7,486 protected inputs. These CPU checks establish ownership and lifecycle behavior, not successful browser startup.

[Isolated candidate run 44563795294](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44563795294) completed using the original graphics component, gameplay and High jobs unchanged, plus the original MotoGP build and its existing menu-entry group. The build, all seven component tests, the full driving/replay journey and all seven menu tests passed. High failed again. The candidate is unaccepted and has not been integrated into `main`.

The compact-menu case that previously failed passed its unchanged assertions: `paused` state, completed circuit preparation, acknowledged worker pause, no page errors and final screenshot capture. Its 86,317 ms whole-test duration includes setup and other actions; it is not time since the start click. The original 60,000 ms predicate and 240,000 ms test deadline remain unchanged. Every menu case passed on retry 0. The successful artifact has no trace ZIP, and its native ring retained 4,096 of 7,321 events (3,225 dropped at the Node collector), so the result does not provide a complete comparable native-fence timeline.

The original Low driving, performance capture and recorded-replay case passed in 157.093 seconds (164.701241 seconds for the invocation). These measurements belong to this software-renderer run and do not establish a physical-hardware performance improvement.

The component comparison found 26 of 32 PNG attachments byte-identical to `d8`. The other six are road-bike pose images: each differs in only 53–67 of 153,600 pixels, with a maximum channel difference of 1/255 and unchanged alpha. This measures actual differences without assigning their cause. The original same-run component assertions all passed.

The candidate's High trace reaches first scene warmup 50,263.657 ms into the original 90,000 ms predicate. Its final retained native call is `bufferData`, sequence 23,566, with a 1,584-byte static array buffer during cube face +Z at 256×256. The last independent observation sees that call in flight for 1,223.7 ms. No retained fence, fence poll or flush has occurred. The buffer's unique resource owner is not established by the currently bound program. Native upload wall times can include queued driver work and do not identify the source of GPU cost.

Only two late program identities appear, both `PMREM.Background`. The diagnostic's existing activity selector is inactive during the new post-processing preparation label, and its earlier metadata-owner allowances are exhausted. Thus this artifact does not independently prove each ambient/display owner's native metadata completion. It establishes that preparation returned before the observed shadow stage, followed by the still-unfinished first warmup draw. The absence of a late ambient query is not an accepted High result.

[Implementation, exact local proof and workflow parity](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/a02e516cf3a58b33e4f783ecb37baafeed0e6ba5/docs/studio/reports/graphics-scene-ambient-preparation.md).

[Frozen candidate graphics evidence](evidence/continuation-ci-20261119/prewarm-graphics-a02e516/README.md) · [Frozen build/menu evidence and 640×400 screenshot](evidence/continuation-ci-20261119/prewarm-menu-a02e516/README.md).

## Physics control investigation: still unaccepted

An isolated control candidate changed only the steering-throttle demand calculation on the published production baseline. It used the actual front-plus-rear normal reaction and stopped counting tracking correction twice after that correction had already been encoded in `steerIntent`. The candidate did not change plant dynamics, grip, geometry, passing policy, class speed targets, gains, race assertions or deadlines.

The original implementation failed all three native ownership checks; the candidate passed all three. The unchanged wet Poggio seed 30101 passed its finish, zero-impact and zero-crash assertions in 98.45 seconds, within the original 120-second test deadline. However the original mixed seed 3303 still failed: GP's best lap was 91.4372396579149 s versus Superbike's 90.3703801553851 s. GP was 1.0668595025298 s slower; the requirement needs GP faster by more than 0.15 s. All six machines finished with zero incidents. The candidate is therefore unaccepted and absent from `main`.

The source-matched recording-only replay reproduced those exact lap times. GP minus Superbike sector differences were +0.321413 s, −0.304530 s and +1.049977 s. On GP0's fastest valid lap, the steering-throttle ceiling lay more than 0.05 below the throttle allowed by the speed command, opening rate and sideslip limits for 0.2667 s, measured before the remaining-brake throttle clamp. This is a thresholded counter, not the duration of every nonzero steering-throttle restriction. The later losses include traffic-limited running and the rider's own speed plan; the data does not support blaming the complete gap on steering-throttle control.

A separate bounded partial replay retained 96 complete native approach-profile inputs/results and stopped at race time 146.10753271592452 s before the race finished (overall simulation time 151.88333333335953 s). All saved transition calls and native profile replays matched exactly. With one fixed recorded profile of 42 valid samples, increasing only measured speed from 80.80081641717129 to 81.14925971746447 m/s changes the original runway calculation from `Infinity`—no valid sampled profile point below speed minus 1 m/s, resulting in 672 m supplied downstream—to 108 m. `Infinity` is a sentinel for that finite scan, not a physically verified unlimited horizon. A 0.34844330029318 m/s speed difference therefore shifts the supplied horizon by 564 m, without any geometry or grip change. This demonstrates a measured-speed-dependent discontinuity around 2,182 m in sector 2; it does not explain all sector-3 loss or establish a pace fix.

The compact supplement preserves all 96 profiles, transition calls, native lap/sector tables, exact candidate patch/fixture, source manifests, scripts, receipts and a verified consumed-field projection. That projection passed 64,341 strict comparisons, including binary64 float comparisons. Its 10 stored-data checks reproduce the retained CSVs. Residence-bin totals are reproduced from original aggregates; individual 240 Hz states were never retained, so the supplement cannot independently reintegrate them. The larger full trace is omitted with its hash and reconstruction limitations stated explicitly.

[Throttle control results](evidence/continuation-ci-20261119/gp-throttle-control/README.md) · [Native runway investigation and reproduction guide](evidence/continuation-ci-20261119/gp-native-runway/README.md).

## Evidence integrity and acceptance

Each frozen evidence package retains a `SHA256SUMS` manifest, provenance and clear omissions. The package-copy receipt records byte-for-byte checks against the originals. Large duplicate artifact archives and the full native trace are not added to Git; their identities/hashes and relevant compact records remain available. No local browser workaround was attempted after its known environment launch restriction.

The published application is not accepted as green: High and compact-menu startup have demonstrated failures, and the remaining main gates must complete. No rejected physics candidate, diagnostic-only pass, partial simulation, software-renderer component image or focused unit subset overrides those requirements.
