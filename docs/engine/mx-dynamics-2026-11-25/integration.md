# Integration findings and acceptance record

The retained engine candidate is frozen at
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`.
This register replaces the earlier wave-5 pending dispositions. Individual
assignment reports remain checkpoint-specific evidence; their earlier pending
labels do not override the later dispositions here. At the final pre-publication boundary,
the final MX/offroad and disjoint shared-core unit sets, original race gates,
unchanged default eleven-scenario matrix, types, lint and production build all
pass locally. Independent source and oracle reviews, the publication manifest
and exact-tree preflight pass. Main-branch publication remains pending;
browser/GPU and new-source hosted-CI acceptance are not established.

## Provenance and source boundaries

The task began at `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`, simulation 39.
Incoming main work at `39d9d497880e92801a7d77de6af2639b4186bfcc` introduced
simulation 40 and overlapping contact/motion improvements. It was inspected and
integrated; later report-only main updates through `c9c94c7` were retained.
This task advances deterministic simulation identity to **41** and changes nine
runtime files relative to that integrated main. Protocol 17 and the 331-float
entrant stride are unchanged by this task.
[Reconciliation](reconciliation.md), [exact scope audit](agents/50-preservation-audit.md)

The earlier combined candidate was fingerprinted `a153c34d…`. Assignment 49 then
changed only the new shoulder controller's traffic-priority condition in
`src/simulation/offroad/ai.ts`, producing final candidate `4c041cb3…`. Tests and
report edits after that boundary do not alter the source fingerprint, but their
own hashes still belong in final test receipts.

The local checkpoints in historical reports preserve experimental provenance.
They are not the published GitHub API commit identities. Root owns publication,
will retain the latest remote parent, and will verify the final remote tree;
there is no claim here that publication has already happened.

## Retained production dispositions

| Finding | Accepted correction | Relevant evidence / boundary |
| --- | --- | --- |
| Compliant touchdown counted vertical momentum again in forward speed. | Preserve horizontal momentum while vertical suspension retains its own velocity. | [07](agents/07-landing-momentum.md), completed with the later final-frame solve in [30](agents/30-final-contact-frame.md). |
| Unsupported front contact retained artificial steering authority. | Continuously bound bar-steering authority by actual front support. | [08](agents/08-front-steering.md); unsupported-front and real wheelie contracts retained. |
| Gate bookkeeping could disagree with the actual starting positions. | One complete, distinct, integer in-range gate set drives both placement and bookkeeping; invalid sets fall back as a whole. | [11](agents/11-gate-placement.md). |
| Rider recovery used per-axis motion and abrupt heading or seat handoff. | Bound vector speed/turns, include actual distance and height travel, and wait for the real seat/heading endpoint. | [12](agents/12-remount-motion.md), [23](agents/23-remount-handoff.md). |
| Displayed wheel speed disagreed with displayed wheel phase. | Share winding, limiting and fallback selection; differentiate the actual interior curve while preserving selected measured endpoints. | [19](agents/19-wheel-motion-consistency.md). |
| A late no-reverse clamp invalidated coupled stop constraints. | Include the bound in the same active-set solve and re-evaluate in the final yawed contact frame. | [20](agents/20-bounded-contact.md), [30](agents/30-final-contact-frame.md). |
| A shoulder approach followed a different terrain profile from the surveyed face. | Apply the narrow held-lane recovery only to an actual out-of-profile tyre footprint. Respect traffic ownership through the final guard. | [21](agents/21-jump-guidance.md), [49](agents/49-wet-race-regression.md). |
| Supported cross-bank gravity was missing from planar contact. | Add the supported world-fixed horizontal acceleration and a feasible static brush preload inside existing friction circles. | [22](agents/22-cross-slope.md); reduced load convention explicitly retained. |
| Ground pitch used the wrong geometric inverse; mode/departure conversion changed momentum. | Use horizontal-run `atan2` for the player plant and preserve the represented horizontal component through scope/flight handoff. | [24](agents/24-slope-momentum.md). |
| Sport drive was limited twice and inferred from imperfect telemetry. | Pass exact gross assisted drive and explicit limiter ownership; keep finite tyre grip and wheel inertia active. | [25](agents/25-launch-traction.md), independent [26](agents/26-drive-budget-review.md). |
| A ground cosine scaled already-horizontal lateral motion. | Project only forward travel inside each heading microstep. | [27](agents/27-planar-transport.md); the isolated 3 m/s slide error was 0.42753 m/s on grade 0.6. |
| Brake aids' gross ceilings were lost at the rotor boundary. | Forward separate front/rear ceilings and combine them with live slip ABS by the tighter bound; preserve free-rotor braking and engine/friction heat ownership. | [29](agents/29-brake-budget.md). |
| A short rebound could cancel or renew the original clear's settling allowance. | Keep the first qualifying landing time on the locked plan; upstream traffic/flag caps still win. | [31](agents/31-ridden-controller.md), preserved by [49](agents/49-wet-race-regression.md). |
| Finite-work correction stole valid grip from the other axle. | Correct each offending contact independently and recheck the coupled work result; retain feasible static support. | [32](agents/32-contact-work.md). |
| Vertical-only accuracy work left fast tyre/pitch feedback at public cadence. | Refine complete player contact intervals, then use bounded midpoint/support events with unchanged force and crash laws. | [33](agents/33-supported-accuracy.md). |
| Internal refinement could repeat decisions or mispublish the last interval as the whole tick. | Preserve public lifecycle decisions; publish correct force/power means and outer endpoint rates while retaining phase-local private state. | [37](agents/37-coupled-lifecycle.md), [architecture](architecture.md). |
| Terrain resampling and unsupported debounce imposed phantom horizontal impulses. | Re-express speed/reference at chord changes and use free horizontal translation during zero-load intervals. Player automatic downshift also requires low shaft and road RPM. | [40](agents/40-ridden-flow.md); existing early drive dispatch preserves non-player scope. |
| Front-rotor inertia changed between ground and flight accounting. | Use the live front inertia for player-flight brake heat and pitch reaction. | [42](agents/42-rotor-energy.md); no angular-deceleration, drag, rear-inertia or legacy-branch retune. |

### Concrete integration outcomes

The gross-drive diagnosis reproduced an equilibrium at **60.2855% of rear grip**
under the duplicated limiter. The accepted command wiring removes that duplicate
ownership; twelve native hill starts move without a fall. This is evidence for an
actuator defect, not a blanket increase in grip or a tuned acceleration multiplier.
[25](agents/25-launch-traction.md), [26](agents/26-drive-budget-review.md)

The frame-transport diagnosis observed a **0.328481 m/s horizontal speed loss in
one 120 Hz call with both wheels unloaded**. Correcting the coordinate and support
contracts also restores the original shoulder CG bounds and complete feedback
laps. The positive shoulder margin remains only **0.001086696 m** below its upper
bound, so this fixture is not described as broadly robust to arbitrary inputs.
[40](agents/40-ridden-flow.md)

Rotor accounting at a 30 rad/s front-wheel state should begin with the physical
270 J energy associated with the live 0.60 kg m² inertia. The old flight path used
0.65/0.70 kg m², producing about 21.5/43.0 J excess combined heat/bearing work in the
specified stops. The retained phase-continuous inertia gives maximum audited
residuals below **4.81e-9 J** and an independently measured chassis angular-impulse
residual below **5.33e-15 N m s**. These are component-level ledger checks, not a
claim that every port of the reduced motorcycle is globally conservative.
[42](agents/42-rotor-energy.md)

The final wet-race investigation found a real newly introduced control regression.
At 20.541667 s, rider 7's shoulder correction changed steering while the traffic
planner reported `ABORT / FOLLOW`. A later blocked approach changed a +0.499622
lip-alignment request to -0.5. Reverting only that shoulder behavior restored
acceptance; reverting only the landing latch did not. The retained guard applies
extra recentering only under `RACING LINE`, consistent with the existing rhythm
controller's traffic ownership. Five new ownership regressions fail before and
pass after. The original eight races and exact four-lap event then pass on the
final source. [49](agents/49-wet-race-regression.md)

## Alternatives not retained

| Assignment / experiment | Disposition and reason |
| --- | --- |
| [09 global rider blend](agents/09-rider-blend.md) | Superseded by incoming local C1 composition and its matching rate. Combining the alternatives would change outer authority and derivative semantics. |
| [10 alternative stop kernel](agents/10-coupled-stops.md) | Superseded by the reconciled incoming solver. Independent seeded invariant coverage remains; the separate forward-bound defect was fixed in 20/30. |
| [15 broad corridor/clear policy](agents/15-jump-corridor.md) | Rejected because it regressed existing clear-jump cases. The later narrower guidance and traffic guard do not retune jump targets. |
| [28 isolated full spring-force arm](agents/28-spring-work.md) | Rejected: the complete player-scoped experiment regressed four of four sampled table jumps and an MX450 wheelie transition. The real virtual-work mismatch remains documented. |
| [34 alternative flight controllers](agents/34-flight-control.md) | Rejected: treating the existing velocity gain as a dimensional bug did not survive complete riding checks. Existing control calibration remains. |
| [35 C2 neutral blends](agents/35-rider-acceleration.md) | Rejected: smoother algebra did not reduce measured sampled acceleration; the retained C1 model and its curvature corner are stated honestly. |
| [40 throttle-floor/heading-guard variants](agents/40-ridden-flow.md) | Rejected after introducing actual riding falls. Coordinate and unsupported-contact defects were corrected instead. |
| [49 extra gearbox scope guard](agents/49-wet-race-regression.md) | Rejected as unnecessary: complete method inspection found the existing non-player early return, and the diagnostic guard produced no state change. |

An audit finding is not itself an implementation, and a rejected experiment is
not counted as an engine improvement. The [ledger](README.md#ten-wave-assignment-ledger)
records those distinctions for all assignments.

## Why test observations changed

The retained tests continue to enforce physical bounds, but a correct numerical
refinement changes when an observation exists. These migrations are explicit so
that a future reader can distinguish valid contract repair from merely editing an
expected value after a failure.

| Test family | Causal issue and retained acceptance |
| --- | --- |
| Stationary posture, isolated braking and unsupported-front equality | A real 1% cross-bank and changing automatic body brace coupled other physical effects into one-dimensional assertions. Analytic in-memory level patches and a converged held rider stroke isolate the intended contract. Authored terrain is unchanged; original force/trajectory assertions remain. [Reconciliation](reconciliation.md) |
| Long remount | A fixed five-second completion assumption required the removed teleport. The distance/turn/seat budget and actual readiness replace it; per-tick motion bounds and course completion remain. [23](agents/23-remount-handoff.md) |
| Landing identity and first-contact geometry | Actual thresholds and the exact swept first contact replace obsolete fixed labels or later public-state observations. Adverse inputs are kept explicit. [38](agents/38-landing-oracles.md), [39](agents/39-contact-oracles.md) |
| First-contact duration and rotor spending | A public call can contain free flight, first impact and later supported intervals. A time/impulse ledger certifies each, retaining no-double-update and strict work bounds. [41](agents/41-contact-time-contract.md) |
| Departure/touchdown momentum | Compare momentum at the transition, then integrate subsequent real drag, force and rotor work separately. Complete observed/unobserved twins verify transparency. [43](agents/43-transition-oracles.md) |
| Wheel pickup | The brush solves against the incoming chord, before a momentum-preserving speed-coordinate change. The unchanged 0.01 m/s band is measured at that force endpoint; original pickup time, increment, wet/dry, force and survival assertions remain. [45](agents/45-wheel-pickup-contract.md) |
| Complete-riding pose/suspension/joint traces | An original held-throttle MX450 trajectory now has a converged physical flat crash. The existing public-flight-feedback rider keeps all original animation assertions meaningful; a separate six-cadence test preserves the original adverse input and unchanged crash threshold. [48](agents/48-animation-contract.md) |
| Analytic drag | Fuel mass changes between complete intervals. Compose the independent drag solution using each actual interval's mass, with all original precision retained; 200 paired states verify the observer. [Root reconciliation](reconciliation.md#final-integration-airborne-drag-and-changing-fuel-mass) |
| Hard-stop and median collision contracts | Every impulse uses its actual interval, mass and geometry with the original tolerances. Original 240 Hz median controls now require one independently classified Raw loop-out and active Sport aid survival. Release/hold journals require exact 0/1 crashes and both exact replay frames. All 29 tests pass. [51](agents/51-contact-contracts.md) |

The eight complete-riding pose cases still inspect real articulated joints at
30/60 Hz publication, including LOD, pause and out-of-order queries. Their mean
interior hub errors are 0.616–0.741 mm and 0.124–0.160 mm, but sparse impact maxima
are 40.853 mm and 18.911 mm. The former cannot be quoted without the latter as a
universal visual-accuracy claim. [48](agents/48-animation-contract.md)

## Acceptance register

### Evidence already complete on the final runtime

| Gate | Result | Source / receipt |
| --- | --- | --- |
| Complete MX/offroad unit sweep | 155 distinct files, 1,736/1,736 tests pass; zero failures, skipped/pending or todo. All 1,556 observed inputs unchanged; no retry. | Final `4c041cb3…`, [46 final receipt](evidence/46-final-engine-units.json). |
| Unchanged default offroad race matrix | 11/11 scenarios pass locally; exit 0; 458.699 s; no failures or changed inputs; `OFFROAD_RACE` unset, no full-grid flag. | Final `4c041cb3…`, [receipt](evidence/final-default-offroad-receipt.json), [raw results](evidence/final-default-offroad-races.json). |
| Eight original full-grid races | 8/8 pass; 96/96 finishers; no retirements; all riders inside the original one-crash limit. | Final `4c041cb3…`, [49](agents/49-wet-race-regression.md). |
| Exact original Valley four-lap event | Pass; 386.67 s; 10/10 finishers; one total crash; 13.26 s maximum stop. | Final `4c041cb3…`, [49](agents/49-wet-race-regression.md). |
| Focused player/traffic gate | 66/66 distinct cases across five files; includes the original two player laps, 14 corridor cases, 20 player-dynamics cases and nine landing-latch cases. | Final `4c041cb3…`, [49](agents/49-wet-race-regression.md); overlaps broad-unit coverage. |
| Animation fixture gate | 53/53 across three suites, including the separately preserved adverse trajectory. | Final `4c041cb3…`, [48](agents/48-animation-contract.md); overlaps broad-unit coverage. |
| Air-drag gate | 22/22 with unchanged precision and two observer comparisons. | Final `4c041cb3…`, [root receipt](evidence/root-air-drag.json). |
| Immutable non-MX refresh | Five cases, 6,005 complete snapshots, 16,477,720 bytes; zero mismatches with only 39→41 identity normalization. | Final `4c041cb3…`, [final receipt](evidence/final-preservation.json), [snapshot evidence](evidence/final-non-mx-snapshots.json). |
| Strict production and changed-code types | All required production/changed dependency groups pass; the earlier resource-blocked attempts remain recorded. | Final `4c041cb3…`, [52](agents/52-tooling-runtime-cost.md). |
| Direct production build | Vite success: 1,106 modules, 15.19 s. | Final `4c041cb3…`, [52](agents/52-tooling-runtime-cost.md). |
| Contact contract gate | 29/29 tests; original momentum/passivity/safety precision retained, with 2,592 selected physical states comparing exactly in observer checks. | Final `4c041cb3…`, [51](agents/51-contact-contracts.md); overlaps broad-unit coverage. |
| Shared-core gate | 181/181 distinct tests in seven files, zero failures/skipped/todo. The 155-file MX/offroad set and these seven files have no path overlap; all 162 test hashes match their final receipts. | Final `4c041cb3…`, [52](agents/52-tooling-runtime-cost.md), independently reconciled by [58](agents/58-acceptance-reconciliation.md). |
| Changed-code lint | 62 files, no diagnostics; all 62 input hashes independently reconfirmed. | Final `4c041cb3…`, [52](agents/52-tooling-runtime-cost.md), [58](agents/58-acceptance-reconciliation.md). |
| Independent source and oracle reviews | No new concrete release blockers; two phase/frame documentation clarifications retained. | Final `4c041cb3…`, [55](agents/55-source-review.md), [56](agents/56-claims-oracle-review.md). |

The maximum full-grid stop is **19.15 s against the unchanged 20 s bound**.
The longest race is 516.14 s against 600 s. These are passing but finite scenario
margins. The original scripts, seeds, field sizes, lap configurations, force laws,
jump targets and crash limits were not weakened to obtain acceptance.
[49](agents/49-wet-race-regression.md)

### Historical evidence that must not be misattributed

The completed assignment 46 broad run used `a153c34d…`: **154 files, 1,723 tests,
1,710 passes, 13 failures in six files**, no skipped/todo cases. All initially
captured inputs remained unchanged. One missing sparse-checkout reference JSON
was restored byte-for-byte from its tracked Git blob before its dependent suite
ran. The interrupted earlier attempt contributes no extra tests.
[46](agents/46-full-engine-units.md)

That broad run correctly exposed the remaining old observation/control assumptions.
It is a failure map, not final green acceptance. Later targeted results must be
reconciled by file and source identity; adding 66 + 53 + 22 to the broad test count
would double-count overlapping cases. The later completed sweep on frozen
`4c041cb3…` passes **1,736/1,736 tests across 155 distinct files**, with every
historically failing file passing. Its [final receipt](evidence/46-final-engine-units.json)
is the acceptance record; the earlier 1,710/1,723 result remains historical.
The separate shared-core receipt passes 181/181 in seven disjoint files. Targeted
repair/observer reruns are never added to either full-suite count.

Assignment 47's calibration passes at `a153c34d…`: 20 jump holds (17 clean, three
bottomed), 20 walking checks, 24 deliberate short/long gap probes and three standing
starts. Its original full-grid run was **7/8**, and an exact unchanged-upstream
replay proved the wet Arena failure was new. Those red results remain visible.
Assignment 49's accepted guard repairs that failure and reruns the original race
gates at `4c041cb3…`. The later AI branch is not called by the calibration driver.
[47](agents/47-race-calibration.md), [49](agents/49-wet-race-regression.md)

Assignment 50 proves exact complete-tree preservation at `a153c34d…`: all 291
asset/reference files match the initial baseline; 1,117 other runtime files,
714 rendering files outside wheel-pose, explicit course/definition files and
configuration remain unchanged from integrated main. Categories overlap.
Its working-file audit independently verifies 1,381 materialized modes/blob IDs
and 36 legitimate sparse entries. Only the allowed AI source changed afterward;
assignment 59 independently refreshed the protected mode/blob checks and exact
code-tree scope. [50](agents/50-preservation-audit.md), [59](agents/59-publication-preflight.md)

### Hosted CI and pending final release work

Assignment 54 attributes the existing failed hosted workflow at
`2578271913c264f5ffd6131afea30723df14b65b`; the later integrated main at
`c9c94c7029dbc3e29b18101ef7ccea0a897184d1` differs only in 24 CI-report paths.
The four old global-unit signatures concern APX01 wing material, two GP-R1
calibration/hash assertions and 14 missing GP rear-brake translations. Those test
files and the relevant canonical/hash implementation are unchanged here. Their
attribution does not constitute a new run of the entire global suite. Baseline
browser/owner-QA failures were not individually rediagnosed. No required branch
checks or rulesets were active at the recorded lookup.
[54](agents/54-ci-attribution.md), [baseline workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45700444387)

The previously uncovered default offroad matrix is now complete: all eleven
original scenarios pass locally, including Valley moto 2, the longer Arena event,
supermoto, rallycross and stage cases. This closes that local scenario-coverage
gap without claiming hosted-workflow success or playable-site deployment.
[Final default-matrix receipt](evidence/final-default-offroad-receipt.json)

- Assignment 57's exact publication manifest and assignment 59's preflight pass,
  including the protected-tree comparison. Root will regenerate the payloads after
  final documentation edits. Source/claim reviews 55–56 and reconciliation 58 are complete.
- Root will publish the authorized changes and record the actual API commit/tree
  identities. Historical local checkpoints must not be substituted for those IDs.
- Assignment 60 has been spawned and prepared the independent remote-verification
  procedure. Its actual pushed commit/tree and hosted-check verification awaits
  publication. All 60 distinct assignments are now spawned. Main publication is
  authorized but is not yet recorded as complete.

The pre-publication main lookup records tree
`5e9fea61ed17d0709a192e2106ef20e161788ffc` at `c9c94c7…`. It is a baseline observation,
not the pending publication's tree or CI result.

Assignment 52's final CPU audit measures 14,400 uninstrumented public steps, with
case medians 0.02249–0.03745 ms and p99 0.38225–0.51140 ms on the shared executor.
Its 2,880 instrumented/uninstrumented endpoint states match exactly. Current safe
flight traces observe up to **four complete intervals and 80 spring evaluations**;
these supersede earlier trajectory-specific maxima, while algorithmic caps remain
8/16. This is not a before/after performance comparison, a full-world-step budget,
a graphics/FPS result, or a physical-device guarantee.
[52](agents/52-tooling-runtime-cost.md)

## Visual acceptance and remaining model limits

The local production build succeeded, but Chromium startup did not reach a page.
The installed binary aborted at `socket() failed: Operation not permitted` in its
process-singleton setup. No renderer identity, framebuffer assertion, gameplay
assertion, screenshot or GPU measurement ran. The failure is retained in the
[44 browser record](agents/44-native-browser.md); no permission workaround or
additional browser attempt is part of this release.

The reduced spring-work mismatch, separate tiny yaw-damper reversal work, retained
C1 neutral curvature corner, sparse impact reconstruction limits, Float32 global
time precision and force-versus-drawn geometry distinction remain documented in
the [architecture](architecture.md) and [known limits](README.md#known-limits-retained-openly).
The complete median approach also remains sensitive to outer cadence: both assists
rear-crash at 120 Hz, while 240/480/960 Hz consistently produce Raw loop-out and
Sport survival with bounded safety envelopes. This is distinct from identical
airborne-checkpoint convergence. [51](agents/51-contact-contracts.md)

Numerical convergence of a held-input crash does not make that input safe, and a
successful finite scenario set does not establish all-seed or all-device behavior.
