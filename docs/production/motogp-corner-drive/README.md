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

| Recorded comparison | Baseline | Updated |
| --- | ---: | ---: |
| Cases with rear force-circle use above 1.01 | 88 / 960 | 0 / 960 |
| Maximum final rear-use diagnostic | 1.490697 | 1.000256 |
| Crashes during the half-second overlap fixture | 0 | 0 |

The remaining maximum diagnostic excess is 0.02565%: the force bound is solved before speed and roll integration, while the reported use includes that final sample. In the representative GP-R1 case, drive falls from 543.63 N to 264.07 N while the same 1,690.31 N front braking force remains applied; rear use falls from 1.368 to 0.946 and the reported intervention increases accordingly.

All 144 ordinary control traces matched their baseline hashes across nine motorcycle models, Sport/Raw assists, shared grip coefficients 1.0/0.4, two lean inputs and both timesteps. The 16 Raw split-contact controls also matched. This comparison covers the 16 solver channels listed in the receipt over the declared settled-corner and half-second input profile. Other motorcycle families do not opt into the new drive limiter. The tests also verify the production snapshot intervention, POWER LIMITED feedback, and replay sampling of those existing fields.

Lap records now use physics version 6 for the GP limiter, following the project’s solver-version policy. The concurrently published Motocross update already assigned version 5 to the shared solver identity, including GP laps produced before this limiter; keeping version 5 would mix those earlier GP records with the new solver. Previous physics categories keep separate leaderboard keys, and old GP ghosts are rejected by the current category validator.

## Replay seek preparation

A seek now begins loading its required storage page immediately, allowing that work to overlap an outstanding GPU frame. The normal sampling and presentation path still determines which pose is shown. Preparation retains the existing bounds of two pending reads and four cached pages, and services the latest scrub target as reads finish.

Reads capture the metadata object for their page. Flashback truncation replaces or removes metadata for reopened and discarded pages, so late results and errors from the old future cannot enter the cache or poison the current recording. Reads of unchanged earlier pages remain useful. Regression cases cover late resolution, late rejection, continuing recording after truncation, and reusing a page number on the new timeline. The independent deferred-read reproduction now finishes with no replay error or failed page.

## Verification status

The controlled before/after traction receipt uses baseline `9e5ff534`; the shared checkout subsequently incorporated wheel-momentum commit `d099215`, Festival lighting/airtime commit `794c90c`, the Horizon workflow correction, continuous-collision/animation commit `14270a4`, its formatting follow-up `5ba247c`, and Motocross contact/roost commit `c182751`. The engine integration used clean three-way merges of its two overlapping files. The later Motocross integration preserved its off-road load readouts and tests, retained its version-5 history, and assigned the GP change a distinct version 6.

| Verification | Status |
| --- | --- |
| Focused GP traction, pedal, engine-braking and bike suites | 52 tests passed before incoming integration; scoped ESLint passed |
| Guide phases, riding cues and control feedback | 23 tests passed; scoped ESLint passed; [receipt](guide-validation.json) |
| GP rear assembly, occupied boot clearance and chain | Final rear suite: 10 tests passed, exit 0, including actual production-arm chain checks and the 4 mm full-travel boot sweep. The preceding rear/chain command passed 20 tests, exit 0. Independent sweep: zero overlap across 9,533 compared columns; [final receipt](rear-chassis-validation.json) and [reference review](REFERENCE_REVIEW.md) |
| GP traction with incoming wheel momentum, session identity and rigid/integrator suites | 59 assertions reported passed across six suites; command exited with two worker RPC timeouts. Clean gate pending; [integration receipt](traction-integration.json) |
| Final physics-v6 category and GP ghost compatibility | 9 identity tests passed with exit 0 after preserving incoming Motocross physics; prior versions 2–5 and the GP ghost boundary 5→6 are covered. Historical checks remain in the [integration receipt](traction-integration.json). |
| Replay preparation and flashback isolation | 13 tests passed with exit 0; 12 renderer/grid checks also passed. The separate recording contract run has unresolved local timeouts; [complete receipt](replay-validation.json) |
| Combined production build and static checks | Final merged-source scoped ESLint, Prettier and whitespace checks passed. Production build pending exact-commit CI. |
| Combined production browser review | **Pending**; includes close rear views, dry/wet riding, responsive guide layouts, and held/rewind behavior |

The local browser launch was blocked before any presentation test executed because Chromium was absent. The prepared CI review builds the exact source revision and retains screenshots and traces; its result must replace the pending entries above before treating browser review as complete.

## Try the changes

Choose GP-R1 or GP-R2 in Practice at Aurel for the extended North Hook exit, or Poggio Alto for linked bends. Use the existing W throttle, S/Space front brake and Left Shift rear pedal controls; G toggles demo driving. Watch the guide through the apex while easing off the front lever, standing the bike up and feeding in throttle. The rear construction is easiest to assess in the prepared close rear review views.
