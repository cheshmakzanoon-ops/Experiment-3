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

The first published browser review exposed a menu-entry stall that also occurs on the direct parent revision, before a GP bike is selected. A slow showroom frame could consume the entire old frame interval and immediately trigger another GPU submission in the same callback. Menu presentation now waits for actual GPU completion, starts the existing 1/15-second quiet interval from that completion, and leaves the completion callback plus at least one following callback available for browser painting. Startup reveals its controls after the first menu frame completes. Racing and replay retain their existing GPU gate and workloads.

The enlarged motorcycle card also needed 18 px of accumulated vertical spacing removed. Four existing spacing declarations change; text, readouts, card width, anchors, breakpoints and phase information remain. The observed 1.35-scale top was 393.984375 px against the original >405 px bound. The spacing predicts a top of 411.984375 px, which still requires the actual browser assertion. See the [menu pacing and camera receipt](menu-pacing-validation.json) and [HUD layout receipt](hud-layout-validation.json).

## Verification status

The controlled before/after traction receipt uses baseline `9e5ff534`; the shared checkout subsequently incorporated wheel-momentum commit `d099215`, Festival lighting/airtime commit `794c90c`, the Horizon workflow correction, continuous-collision/animation commit `14270a4`, its formatting follow-up `5ba247c`, and Motocross contact/roost commit `c182751`. The engine integration used clean three-way merges of its two overlapping files. The later Motocross integration preserved its off-road load readouts and tests, retained its version-5 history, and assigned the GP change a distinct version 6. Later Festival evidence and the Motocross deep-contact recovery fix were preserved through `cc7cb7f`; that fix advances the shared simulation identity to version 7 without changing the GP limiter.

| Verification                          | Status                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First published production build      | **Passed** locally and in exact-commit CI for `9d5c558`; TypeScript and Vite production build, 715 modules; source-stability guard passed.                                                                                                                                                            |
| First published focused units         | **253 / 255 passed**, 24 / 25 files. All GP driving, geometry, guidance, recording, flashback, physics-v6 identity and interpolation suites passed. Two stale followed-camera fixture expectations failed; this was not a clean combined gate.                                                        |
| Camera fixture repair                 | **27 / 27 passed**, exit 0, across race-view continuity and snapshot interpolation. Both coherent motion and the original zero-speed discontinuity now have explicit expected presented poses/times; [receipt](menu-pacing-validation.json).                                                          |
| GP fixed-finish batching repair       | **46 / 46 passed**, six affected files, exit 0 under the source-stability guard. Exact UV/colour/topology, material response and posed surfaces are preserved. GP-R1 high meshes fall from 114 to 109; [batch receipt](rear-rigid-batch-validation.json).                                             |
| Menu handoff repair                   | **81 / 81 passed**, five files, exit 0 under the source-stability guard. Includes GPU ownership, menu preview, covered settings, reset/disposal and original settings contracts; [receipt](menu-pacing-validation.json).                                                                              |
| First published presentation browsers | GP-R2 rear passed every gate. GP-R1 reference/rear and one rider-contact case exceeded the unchanged draw-call limit (227 versus <220); six other rider-contact cases passed. The enlarged HUD failed its original vertical bound. Repairs are prepared; their original browser gates remain pending. |
| First published dry/wet journeys      | Both reached the original 300-second deadline during menu/race-entry setup. Riding, replay and wet effect assertions were not established. Parent settings traces confirm the same pre-existing menu bottleneck.                                                                                      |
| Follow-up integrated review           | **Pending exact-commit CI**: production build, 30 focused unit files and five browser groups, including original menu/settings entry tests. Original viewports, 300-second riding deadlines, graphics workload and draw-call limits remain.                                                           |

The [first published CI receipt](ci-review-9d5.json) records the exact jobs, artifacts, passing controls and failure stages. Its clean recording assertions supersede the earlier local recording timeouts in the [historical replay receipt](replay-validation.json). The local browser could not launch because Chromium was absent; the actual presentation results above come from the retained exact-commit Mesa CI run. Neither geometry counts nor software-rendered browser results are hardware frame-rate measurements.

## Try the changes

Choose GP-R1 or GP-R2 in Practice at Aurel for the extended North Hook exit, or Poggio Alto for linked bends. Use the existing W throttle, S/Space front brake and Left Shift rear pedal controls; G toggles demo driving. Watch the guide through the apex while easing off the front lever, standing the bike up and feeding in throttle. The rear construction is easiest to assess in the prepared close rear review views.
