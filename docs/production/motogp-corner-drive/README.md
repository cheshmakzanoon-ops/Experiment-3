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

The GP limiter introduced physics version 6, following the project’s solver-version policy. The concurrently published Motocross update already assigned version 5 to the shared solver identity, including GP laps produced before this limiter; keeping version 5 would mix those earlier GP records with the new solver. The subsequent Motocross deep-contact recovery fix advanced the shared category to version 7 while retaining this GP version-6 history. The later shared axle-force and angular-presentation engine update (`f476cee`) advanced the category to version 8. The preserved Motocross update (`2509d00`) then advanced it to version 9 for independently sampled player front/rear contact grip; the retained GP comparison receipts keep their original source and version boundaries. Previous physics categories keep separate leaderboard keys, and old GP ghosts are rejected by the current category validator.

## Replay seek preparation

A seek now begins loading its required storage page immediately, allowing that work to overlap an outstanding GPU frame. The normal sampling and presentation path still determines which pose is shown. Preparation retains the existing bounds of two pending reads and four cached pages, and services the latest scrub target as reads finish.

Reads capture the metadata object for their page. Flashback truncation replaces or removes metadata for reopened and discarded pages, so late results and errors from the old future cannot enter the cache or poison the current recording. Reads of unchanged earlier pages remain useful. Regression cases cover late resolution, late rejection, continuing recording after truncation, and reusing a page number on the new timeline. The independent deferred-read reproduction now finishes with no replay error or failed page.

## Menu presentation and enlarged HUD

The first published browser review exposed a menu-entry stall that also occurs on the direct parent revision, before a GP bike is selected. The d072 handoff change waits for actual GPU completion, starts the existing 1/15-second quiet interval from that completion, and leaves the completion callback plus at least one following callback for browser painting. Startup reveals its controls after the first menu frame completes. Exact-d072 browser runs still fail three normal Garage clicks, so that handoff change is not accepted as a complete repair. The later original 5235 local case failed even earlier: the initial menu remained hidden and no normal click was reached. Its retained evidence does not establish the cause of the first callback delay or validate a pacing repair.

Adaptive menu recovery and a receipt identifying the actually presented menu machine are implemented as separate production candidates on top of the preserved Festival, shared-engine and Motocross history. Their guarded local production build, scoped lint and distinct unit/integration checks have passed. Their current browser run has not been performed; neither a complete menu repair nor a first cold-startup repair is claimed. The historical d072 and 5235 results below retain their original source boundaries.

The enlarged motorcycle card also needed 18 px of accumulated vertical spacing removed. Four existing spacing declarations change; text, readouts, card width, anchors, breakpoints and phase information remain. The original responsive and corner-phase bounds now pass in exact-d072 Mesa browser verification at all three viewports and both UI scales. The earlier predicted top of 411.984375 px was not retained as an actual phase coordinate and must not be reported as measured. See the [menu pacing and camera receipt](menu-pacing-validation.json), [HUD layout receipt](hud-layout-validation.json), [retained responsive measurements](evidence/hud-layout-measurements-d072.json) and [final browser results](ci-review-d072-final.json).

## Verification status

The completed focused review of [d0720d8](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/d0720d8ab52de0d7ae4b792e1ae65bc07f8949e4) passed production builds and **339/339 focused tests**. Its original browser groups finished with **15/19 cases passed**: presentation, rider contact and dry riding passed, while three menu-entry clicks and the wet-entry journey failed. The combined browser gate remains open. Exact jobs, all seven artifact digests and the 19 outcomes are recorded in [the final d072 receipt](ci-review-d072-final.json).

| Verification | Exact-source outcome |
|---|---|
| Production build | **Passed on d072** locally under the source-stability guard and in CI job 118237287906. Local guarded command: 288.73 s. CI: 716 modules, Vite build 16.54 s. |
| Focused units | **339/339 passed across 30 files** locally and in CI job 118237287388; zero pending. Local guarded command: 345.42 s; CI tests: 45.20 s. These focused counts are separate from full-repository benchmarks and controlled traction samples. |
| Presentation | **4/4 passed**, job 118244612006. The actual rear and full corner views measure **217 GP-R1 / 215 GP-R2 draw calls**, within the unchanged <220 bound; expanded inventories are 107,617 / 99,916 triangles. Rear GL, same-instance, resource and repeated/rewound hash checks pass. |
| Responsive HUD and corner phases | **Passed within the presentation case**, at 1440×900, 960×600 and 390×844 with UI scales 1 and 1.35. Original bounds, corner phase restoration and held-DOM checks pass. The precise phase Y coordinate was not retained; 411.984375 px remains a former prediction, not a measurement. |
| Rider contact | **7/7 passed**, job 118244611803: both GP models' grip, peg and corner held/wet/rewound checks, plus the GP-R1 recovery pose. |
| Dry riding | **1/1 passed**, job 118244611832, in 250.481 s under the original 300 s deadline. Actual manual throttle/rear-pedal controls, demo switching, cockpit, pause, recorded replay seeking, guide restoration and resume were exercised. The recorded guide remained in APPROACH; complete corner phases are established by their separate checks. |
| Menu entry | **3/6 failed**, job 118244611834. All three normal Garage clicks exceeded the unchanged 15 s action limit. Static reachability and both real WebGL asynchronous-fence controls passed. The separate same-source settings workflow also had 3/6 failures. The production menu issue remains unresolved. |
| Wet riding | **0/1 passed**, job 118244611859. The original 300 s deadline expired around finishRaceEntry after extended menu/Garage waits. Wet driving and effect assertions were not reached, so this is an incomplete wet journey rather than evidence of a wet-physics defect. |

The final screenshots and repeated-state receipts use **ANGLE/Mesa llvmpipe software WebGL2**. All original viewports, UI scales, deadlines, graphics workloads and draw/triangle limits remained. The GP-R1 high dry front image and all three GP-R2 rear images are byte-identical to the corresponding earlier 9d5 captures after the rigid batching repair. These are component-rendering and journey results, not physical-device frame-rate measurements. The dry setup screenshot contains GP labels over the preceding Formula preview; the live riding captures show the actual GP bike.

### Later diagnostic and publication sources

The diagnostic revision **54b240a** failed its build/type gate before a diagnostic browser ran: the timing helper selected an ambient WebGPU overload through `Parameters`/`ReturnType`, producing TS2367 and TS2352. **5235c24** corrects only those type annotations. The project `tsc --noEmit` command passed under the source-stability guard in 152.23 s on the corrected helper; its emitted JavaScript is byte-identical to the preceding helper. This is a typecheck repair, not a production menu fix.

The separate [5235 focused CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39316678507) has now completed. Its production build passed (job 118279843852, 716 modules, Vite 18.58 s), as did 339/339 focused tests across 30 files (job 118279843428). Its browser groups finished with **14/19 cases passed and five failed**, separately from d072's 15/19 result. All five groups passed setup and the exact-source build check. The final receipt records all seven later artifact IDs, sizes and SHA-256 digests from verified metadata; this bundle assembler did not download or rehash those complete later archives.

| Later 5235 browser group | Completed outcome and reached scope |
|---|---|
| Presentation | **4/4 passed**, job 118293935528. These later results are separate from the eight retained d072 images. |
| Rider contact | **7/7 passed**, job 118293935356. |
| Menu entry | **3/6 passed**, job 118293935391. Three original normal Garage clicks failed their 15 s limit; the interface component case and two real GPU-fence controls passed. |
| Dry riding | **0/1 passed**, job 118293935472. The initial `#menu` remained hidden for the original 180 s visibility assertion at `e2e/motogp-riding-flow.spec.ts:87`; Garage, GP selection and riding were not reached. The reported 4.9-minute case also includes later teardown. |
| Wet riding | **0/1 passed**, job 118293935469. This attempt reached live wet riding, spray, cockpit and held-pause assertions. The unchanged 300 s total deadline expired at the final resume progress poll, `e2e/motogp-wet-riding.spec.ts:125`: tick 1263 was observed after paused tick 1244, short of the required >1304. The final empty-error assertion and diagnostics attachment were not reached. |

The wet job's terminal line and sequential original spec establish that it had already checked positive front/rear water and live spray, presentation-time advancement, all four GP riders moving without retirement, the presented chase/cockpit cameras, acknowledged pause and unchanged held tick/time/particle/catchup state. Three wet chase/cockpit/pause PNG attachments are listed in its log, but they were not visually reviewed or selected during this bundle update. This partial 5235 journey is distinct from the earlier d072 wet-entry failure; complete wet acceptance remains outstanding.

All production `src` files and both original riding specs are unchanged between d072 and 5235. The completed d072 dry journey remains an actual historical pass, while the later 5235 dry attempt was blocked at startup before any GP behavior could be exercised. The differing run outcomes do not by themselves identify a timing cause or establish a GP riding regression.

The [native 5235 menu timing receipt](evidence/menu-ci-5235-timing.json) separates the failed clicks from cold startup. In all three menu failures, the first full frame did complete after approximately 30.613 / 57.555 / 50.976 s, its real fence completed, and the menu revealed. A second automatic frame began about 73–91 ms after reveal, returned about 154–173 ms later, and its last native fence query returned `TIMEOUT_EXPIRED`. No later query was retained during the RAF silence, so its actual GPU completion time is unknown. The normal click started about 0.94–1.02 s after reveal. During its 15 s stable wait, timers continued with no active callback, while retained native RAF and screencast frames did not advance. This supports recovery around those repeated automatic submissions; it does not show a synchronous draw callback still running during the clicks or validate the new candidate.

The one original **local** 5235 menu case closed separately with **0/1 passed**, exit 1, under its source-stability guard. It used the unchanged d072 production build, Chromium 1193 and explicitly labelled SwiftShader at 640×400. The initial `#menu` visibility assertion expired at its unchanged 180-second deadline, before any Garage click; the case retained its 240-second deadline. The [local startup receipt](evidence/local-menu-5235-validation.json) separates report, teardown and wrapper durations.

That local attempt retained the first callback named `frame` at +164.6713 s, with no later retained callback end or timer and no native fence or click event. Its last saved image still showed ALMOST READY / 90%; earlier startup included a 19.149-second browser long task and an 18.2453-second exact adjacent native RAF gap. This unmatched callback does not identify CPU, shader, GL or GPU blocking, establish its duration, or supply a completed frame for a first cold-startup repair. The source guard closed; an ownership check found no remaining owned browser, so no termination signal was sent. The redundant local SwiftShader presentation attempt remains separately **interrupted/incomplete** (exit 130, no completed case or inferred local pass).

The subsequent **e4d07ad** Festival room-depth/slipstream work is preserved, followed by **f476cee** shared axle-force/angular-presentation work and **2509d00** Motocross rider/soil/jump work. The shared category is now physics **9**, retaining the GP limiter's version 6 origin, Motocross deep-contact version 7 and shared-engine version 8 history. Because these later commits change shared presentation or vehicle behavior, the d072 images and earlier browser passes remain historical evidence for their stated source.

### Current candidate source checks

The frozen menu candidates have a separate local validation record. **392/392 tests across 32 files passed on f476 plus the candidate**, followed by a scoped ESLint pass on five TypeScript paths. After the disjoint 2509 integration, **36/36 targeted GP/shared-rider checks across five files passed** with the same six candidate input hashes. These counts describe distinct, overlapping runs and must not be added together. Their guards reported no input changes. See the [392-test receipt](evidence/menu-candidate-units-f476.json), [scoped lint receipt](evidence/menu-candidate-lint-f476.json) and [post-MX integration receipt](evidence/menu-candidate-integration-2509.json).

The [current guarded production build](evidence/menu-candidate-build-2509.json) also passed on 2509 plus those six frozen inputs: **720 modules**, Vite **1m 33s**, **204.877 s** for the complete guarded command. Its build identity correctly retains a **null commit** and source fingerprint `fd28db0d13f190a36ea308ae001d89b64b40772c4c1cbc61375f7cd0680f40c2`. The separately staged code tree is `022b5c3d25f3e26fd80ac8c546123fa20ac83524`, before this evidence is added. Neither identity is presented as the eventual documentation-inclusive commit.

**The current candidate browser run has not been performed.** The candidate scope is recovery after measured gaps between active RAF callbacks plus a receipt of the actual presented preview. No current browser pass, complete menu repair, stale-preview repair or first cold-startup fix is claimed. Subsequent browser verification is recorded separately against its published source.

The [first 9d5 receipt](ci-review-9d5.json) and [earlier d072 checkpoint](ci-review-d072.json) remain unchanged as history. Their original failures and then-pending jobs are retained; this final receipt adds later completed outcomes in separate fields. The d072 reporter's 63 nested suites represent 30 files, while the candidate's 68 nested suites represent 32 files. Controlled traction samples and earlier geometry/guide/replay evidence keep their original source and counting scopes.

## Retained screenshots

All eight PNGs below are unedited, exact-byte copies of d072 CI attachments. The [evidence manifest](evidence-manifest.json) records original test, job, archive, dimensions, scope and SHA-256 for each image. The real-game, component and DOM fixtures have distinct acceptance scopes.

| Image | Original scope |
|---|---|
| [GP-R1 static dry rear](evidence/gpr1-rear-static-dry.png) | High-detail production BikeModel component fixture: rear mechanical overview. |
| [GP-R1 loaded dry rear](evidence/gpr1-rear-loaded-dry.png) | Same camera, loaded suspension pose; isolates geometry/pose from wet material response. |
| [GP-R1 loaded wet rear](evidence/gpr1-rear-loaded-wet.png) | Same loaded component pose with presented wet material response. |
| [GP-R2 loaded wet rear](evidence/gpr2-rear-loaded-wet.png) | Second production model's loaded/wet component view. |
| [Poggio practice chase](evidence/gp-poggio-practice-chase.png) | Lead actual-game image: four-GP-R1 dry practice at Low, named T1 braking guidance. |
| [Recorded cockpit](evidence/gp-poggio-recorded-cockpit.png) | Actual game's recorded cockpit and replay timeline; T1 approach guide. |
| [Desktop corner-phase HUD](evidence/gp-corner-phase-1440.png) | Production DOM/HUD with synthetic telemetry, 1440×900, UI scale 1; no 3D scene. |
| [Mobile corner-phase HUD](evidence/gp-corner-phase-390.png) | Production DOM/HUD with synthetic telemetry, 390×844, UI scale 1; no 3D scene. |

The wet rear images establish component material/pose presentation; they do not convert the failed full wet journey into wet-driving acceptance. The phase images were captured at UI scale 1. Scale 1.35 passed its original bounds assertions but has no retained phase screenshot or exact phase-top measurement.

Detailed receipts: [rear visual review](evidence/visual-review-d072.json), [GP-R1 rear states](evidence/gpr1-rear-chassis-receipt.json), [GP-R2 rear states](evidence/gpr2-rear-chassis-receipt.json), [responsive HUD review](evidence/hud-guide-review-d072.json), [real dry riding review](evidence/dry-riding-review-d072.json).

## Try the changes

Choose GP-R1 or GP-R2 in Practice at Aurel for the extended North Hook exit, or Poggio Alto for linked bends. Use the existing W throttle, S/Space front brake and Left Shift rear pedal controls; G toggles demo driving. Watch the guide through the apex while easing off the front lever, standing the bike up and feeding in throttle. The rear construction is easiest to assess in the prepared close rear review views.
