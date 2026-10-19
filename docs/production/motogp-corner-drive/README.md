# GP corner drive and rear structure refinement

This pass improves the GP-R1 and GP-R2 rear construction, keeps riding guidance with the road through long and linked corners, corrects assisted drive demand during mixed-grip brake/throttle overlap, and starts replay page loading when a seek is requested. All geometry is authored in Three.js. The reference review, controlled behavior comparisons, and integration results are recorded separately below.

## Rear construction from the reference archive

The GP rear assembly now has closed, tapered carbon spars; individual machined axle adjusters, slotted plates, nuts and tension screws; and a shaped 2 mm carbon undertail. A compact damper attaches to the existing sprung chassis and swingarm matrices. Its barrel and shaft retain their dimensions as the attachment eyes move, and the spring follows the absolute eye separation. It uses the recorded suspension pose and adds no physics state.

All 100 archived reference images were reviewed through ten contact sheets. REF018, REF071 and REF087 were also inspected at full size for side-profile hardware and rear-quarter construction. Geometry dimensions are authored game dimensions; the images guide construction and silhouette. See [the reference review](REFERENCE_REVIEW.md) for the image audit, clearance checks and final inventory.

The final high-detail inventories contain 1,720 fewer triangles per prototype: GP-R1 changes from 109,337 to 107,617, and GP-R2 from 101,636 to 99,916. Material and texture object counts are unchanged. Exact geometry and pose hashes match the baseline across 12 non-GP variants, and chain hashes match across all six GP model/detail variants. These are asset and transform checks, not rendered frame-rate measurements.

## Guidance that follows the corner

The existing GP card now shows an ENTRY / APEX / EXIT strip. Circuit curvature determines the corner window, replacing the fixed 24 m post-apex cutoff. At Aurel, NORTH HOOK retains its sampled 148 m exit; a deeply leaned rider at +85 m still receives HOLD YOUR LINE for that corner. At Poggio Alto, PRIMA remains identified at +36 m, and VIGNA leads into LINK THE TURNS with the next right-hand PIEVE identified before the handover.

Control priority remains meaningful after the apex. A held front lever still produces TRAIL BRAKING; rear-pedal feedback and marshal/control warnings retain their priority. A low-lean rider applying throttle can receive DRIVE OUT. These cues describe the current ride and upcoming road. They do not award a score or alter grip, assists or controls.

Phase and progress come from the presented frame and cached circuit geometry, so revisiting a recorded pose restores the same guidance. The [guide receipt](guide-validation.json) records 23 passing tests, including a real GP-R1 simulation through North Hook, and the prepared responsive-layout and held/rewind browser assertions.

## Assisted drive respects the current rear contact

Under front braking, drive itself changes rear load. The earlier TC pass could leave excessive rear demand when the rear contact had less grip than the front. GP traction control now checks commanded engine drive against the current combined rear force budget, including the load transfer caused by front braking and the permitted drive. It reduces engine drive and reports the resulting cut through the existing intervention channel. Braking and the underlying friction solver remain active; TC-off Raw riding keeps its deliberate over-demand behavior.

The [traction comparison](traction-comparison.json) contains 960 controlled split-contact cases at 120 and 240 Hz, across both prototypes, three TC maps, four front/rear grip pairs, and multiple lean and lever inputs:

| Recorded comparison                            | Baseline |  Updated |
| ---------------------------------------------- | -------: | -------: |
| Cases with rear force-circle use above 1.01    | 88 / 960 |  0 / 960 |
| Maximum final rear-use diagnostic              | 1.490697 | 1.000256 |
| Crashes during the half-second overlap fixture |        0 |        0 |

The remaining maximum diagnostic excess is 0.02565%: the force bound is solved before speed and roll integration, while the reported use includes that final sample. In the representative GP-R1 case, drive falls from 543.63 N to 264.07 N while the same 1,690.31 N front braking force remains applied; rear use falls from 1.368 to 0.946 and the reported intervention increases accordingly.

All 144 ordinary control traces matched their baseline hashes across nine motorcycle models, Sport/Raw assists, shared grip coefficients 1.0/0.4, two lean inputs and both timesteps. The 16 Raw split-contact controls also matched. This comparison covers the 16 solver channels listed in the receipt over the declared settled-corner and half-second input profile. Other motorcycle families do not opt into the new drive limiter. The tests also verify the production snapshot intervention, POWER LIMITED feedback, and replay sampling of those existing fields.

The GP limiter introduced physics version 6, following the project’s solver-version policy. The concurrently published Motocross update already assigned version 5 to the shared solver identity, including GP laps produced before this limiter; keeping version 5 would mix those earlier GP records with the new solver. The subsequent Motocross deep-contact recovery fix advances the shared category to version 7 while retaining this GP version-6 history. Previous physics categories keep separate leaderboard keys, and old GP ghosts are rejected by the current category validator.

## Replay seek preparation

A seek now begins loading its required storage page immediately, allowing that work to overlap an outstanding GPU frame. The normal sampling and presentation path still determines which pose is shown. Preparation retains the existing bounds of two pending reads and four cached pages, and services the latest scrub target as reads finish.

Reads capture the metadata object for their page. Flashback truncation replaces or removes metadata for reopened and discarded pages, so late results and errors from the old future cannot enter the cache or poison the current recording. Reads of unchanged earlier pages remain useful. Regression cases cover late resolution, late rejection, continuing recording after truncation, and reusing a page number on the new timeline. The independent deferred-read reproduction now finishes with no replay error or failed page.

## Menu presentation and enlarged HUD

The first published browser review exposed a menu-entry stall that also occurs on the direct parent revision, before a GP bike is selected. A slow showroom frame could consume the entire old frame interval and immediately trigger another GPU submission in the same callback. Menu presentation now waits for actual GPU completion, starts the existing 1/15-second quiet interval from that completion, and leaves the completion callback plus at least one following callback available for browser painting. Startup reveals its controls after the first menu frame completes. Racing and replay retain their existing GPU gate and workloads. Exact-d072 browser runs still fail the first normal Garage click; this initial handoff change does not close that issue. The follow-up timing fixture is intended to identify the blocked stage before another production change.

The enlarged motorcycle card also needed 18 px of accumulated vertical spacing removed. Four existing spacing declarations change; text, readouts, card width, anchors, breakpoints and phase information remain. The observed 1.35-scale top was 393.984375 px against the original >405 px bound. The spacing predicts a top of 411.984375 px, which still requires the actual browser assertion. See the [menu pacing and camera receipt](menu-pacing-validation.json) and [HUD layout receipt](hud-layout-validation.json).

## Verification status

The follow-up reviewed source is [`d0720d8`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/d0720d8ab52de0d7ae4b792e1ae65bc07f8949e4). Production builds and the focused unit checks passed locally and in exact-commit CI. Browser acceptance remains open: the separate settings workflow on this same source still fails normal menu clicks, and the focused menu-entry group reproduced the same three failures. Four visual/riding groups remain queued at the 19:18 UTC checkpoint on 19 October 2026.

| Verification                        | Exact-source outcome                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local production build              | **Passed**, exit 0 under the source-stability guard, Node 24.19.0; 288.73 seconds for the guarded command. The worktree remained clean.                                                                                                                                                                                                                                                                   |
| CI production build                 | **Passed**, job `118237287906`; 716 modules, Vite build 16.54 seconds. Build artifact `12213288392` is recorded with its archive hash in the [follow-up receipt](ci-review-d072.json).                                                                                                                                                                                                                    |
| Local focused units                 | **339 / 339 passed**, 30 test files, zero pending; 345.42 seconds for the guarded command. The worktree remained clean.                                                                                                                                                                                                                                                                                   |
| CI focused units                    | **339 / 339 passed**, the same 30 test files, zero pending; 45.20 seconds, job `118237287388`. Covers GP geometry, traction, guidance, recording/replay, presentation continuity, menu/GPU ownership and settings contracts.                                                                                                                                                                              |
| Independent settings browser review | **3 / 6 failed**, run `39304317759`, job `118237285832`. All three real menu-entry cases exceeded the unchanged 15-second action deadline at **GARAGE & SETTINGS**. The menu change is not accepted as fixed.                                                                                                                                                                                             |
| Focused menu-entry browser review   | **3 / 6 failed**, job `118244611834`; the same three normal Garage clicks exceeded 15 seconds. Static menu reachability and both real WebGL asynchronous-fence controls passed.                                                                                                                                                                                                                           |
| Remaining focused browser review    | **Pending**, [run `39304318127`](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39304318127): presentation, rider contact, dry riding and wet riding. The HUD spacing, GP-R1 draw-call repair and complete riding/replay/effect journeys still require their actual browser assertions. Original viewports, UI scales, riding deadlines, graphics workloads and draw-call limits remain. |

The [follow-up receipt](ci-review-d072.json) separates local command timings from CI test/build timings and records the exact jobs, artifacts and source. The CI reporter counts 63 nested suites within the 30 test files; these are not 63 separate files. This checkpoint does not claim a completed combined browser gate.

The [first published CI receipt](ci-review-9d5.json) remains unchanged, retaining the original `9d5c558` passes, failures and failure stages. Earlier controlled traction, geometry, guide and replay receipts keep their stated source boundaries. The current clean recording and presentation unit tests do not retroactively change those historical results.

Earlier local browser attempts failed before execution because the expected Chromium executable was absent. Chromium 1193 has since been discovered; a local SwiftShader probe is under investigation, with no completed local browser pass recorded at this checkpoint. Retained Mesa CI images and future software-rendered checks remain separate from physical-hardware frame-rate measurements.

The diagnostic follow-up changes only test imports and adds a bounded timing fixture. Original test bodies, clicks, deadlines and graphics workloads are unchanged. Its evidence attaches from Node during teardown, so a blocked page does not prevent collection. This adds no production menu fix or browser pass.

## Try the changes

Choose GP-R1 or GP-R2 in Practice at Aurel for the extended North Hook exit, or Poggio Alto for linked bends. Use the existing W throttle, S/Space front brake and Left Shift rear pedal controls; G toggles demo driving. Watch the guide through the apex while easing off the front lever, standing the bike up and feeding in throttle. The rear construction is easiest to assess in the prepared close rear review views.
