# Development checkpoints

These are point-in-time observations, not final acceptance claims.

## Baseline

Source `b527a7e01ea247f0233a2ec4f2850639bafbd887`, including the earlier engine and motocross animation work.

- Nine focused suites: 100 tests passed.
- Existing offroad calibration: 20 surveyed jump runs, zero failed bands; launch times MX450 4.53 s, MX250 4.50 s, SM450 4.43 s.
- TypeScript exceeded the default 2.2 GiB Node heap. It passed when executed with an explicit 5 GiB heap; no source workaround was needed.

## Waves 1–2: audited defects and first implementation

Assignments 01–06 audited physical contacts, suspension timing, motion controllers, snapshot transport, camera/control continuity and live verification paths. Assignments 07–12 implemented coupled stops, continuous posture, camera ramp integration, passive yaw coordinates, common presentation coherence and interrupted-shift velocity continuity.

The coordinator integrated the controllers into the existing motocross adapter, synchronized suspension publication with the current pose, cleared stale explicit-placement landing state, and advanced the simulation identity to v40.

Integration initially exposed competing automatic-body writers: the ground posture controller restored the launch pose while the airborne aid tried to advance it. The corrected implementation advances stance and airborne body demand separately, once per solver tick. The existing rider-weight and landing-prediction suites then passed all 26 tests without changing their assertions.

Focused observations after this correction:

- Coupled stops: eight new/existing tests; the reproduced flat two-contact impact leaves no residual closing speed.
- Ground passivity: 21 tests across new passivity, existing ground and thermal suites; the unloaded yaw probe preserves 46,000 J within floating-point error.
- Camera: 22 new/existing cases; the continuous-turn bearing agrees across 30/60/144/240 Hz to floating-point error.
- Shift animation: 34 new/existing cases, including production boot/selector integration.
- Optional motion boundary: ten new/existing cases.
- Contact/posture/passivity integration: 31 cases.
- Session identity: 98 cases, including separation from v39 records.
- Existing offroad calibration: 20 runs, zero failed bands.

These overlapping counts are not additive and do not replace the final integrated suite.

The contact-traction test was updated for the intentional endpoint-travel contract: it now checks initial dive within 1% of full fork travel instead of treating a 20 ms delayed visual stroke as physical travel. Its force-support and rider-weight ordering requirements remain. The continuous brace introduces nanometre-scale differences into the unloaded-front comparison; that comparison now uses explicit 1e-8-scale tolerances while still requiring exactly zero front brake force.

## Waves 3–4: live trajectories and boundary corrections

The dynamic suspension matrix covers MX250/MX450 on outdoor/stadium courses at 120/240 Hz. Its independent oracle checks incoming forces separately from outgoing fork/shock travel. Lifecycle tests exposed stale immediate-reset tyre telemetry and a stopped remounted wheel briefly inheriting pre-crash angular velocity. Those adapter paths were corrected and the 13 new lifecycle cases passed.

Unsupported motocross heave now uses exact constant-gravity displacement. Horizontal quadratic drag subsequently gained an analytic speed/distance update shared with the first-tyre predictor. The new drag suite passed 20 cases; production flight subdivision position differences were below 2.18e-10 m in its measured matrix. The existing calibration still passed all 20 jump bands after that change.

Landing regressions then identified three distinct observation errors: a closing initial tyre overlap treated like a separating overlap, suspension travel crossing its stop within a tick without updating the landing record, and forecast deadlines drifting by one physics tick. Assignment 19 corrected those paths without changing the traced physical endpoint of the bottoming fixture or its crash verdict. Its requested four-suite run passed 48 cases.

Machine interpolation now admits a mechanically bounded reversal when signed measured rates and continuity checks support it. Across eight real traces, 301 interior extrema were recovered and aggregate interpolation error fell 10.44%. Standing/dab derivatives are also transported through the existing optional contact-tail extension and consumed by the existing pose path.

The manual/automatic body blend received a local C1 join within ±0.15 manual travel. Its mapping outside that range, full throws and automatic neutral remain unchanged. The new exact derivative observes both moving inputs without changing the finite manual momentum stroke. Assignment 21 passed 39 focused cases; its actual airborne state comparison against the previous blend remained exact.

### Explicit open integration findings at this checkpoint

- **Contact-time convergence:** after exact drag, the unchanged wheel-pickup convergence test reports 0.0304897609 m/s against its 0.03 m/s limit. Assignment 22 traced 94.4% of that difference to touchdown. Terrain is sampled at endpoint X/Z while the vertical solve tests incoming Y/pitch, so two subdivisions can classify contact differently at the same physical endpoint. Assignment 25 owns the coherent-time investigation; this is not declared accepted.
- **Rendered interrupted shifts:** the controller now preserves clearance ordering and passes 40 focused cases, including 2,252 actual rig poses. Independent interpolation of the three foot channels still skips that safe route: the reproduced overlap is 5.924 mm at nominal 60 Hz snapshots and 14.541 mm at 30 Hz. The next presentation assignment must address the live reader as well as the exact controller. No model definition changes are required or authorized.
- **Spring geometry:** assignment 18's closed-loop work probe demonstrates an existing conservative-force inconsistency. A temporary isolated torque correction failed eight previously successful jumps. The runtime correction was not retained; its coordinated redesign requirement remains documented in the architecture and report.

These findings are tracked openly so an earlier focused pass cannot be mistaken for final integrated acceptance.

## Waves 5–6: contact timing, recorded motion and broad integration

The player motocross solver now finds the first closing tyre contact within a tick, advances unsupported motion to that event, and solves the supported remainder. An independent time-of-contact oracle replaces comparisons between incoming height and endpoint terrain. Wheel-pickup subdivision disagreement fell from 0.030489761 to 0.000974387 m/s; the unchanged 0.03 m/s requirement passes. Stiff supported motion uses bounded local refinement when contact travel or stop frequency requires it; the physical spring, damping and crash criteria remain unchanged. Four 240 Hz six-second traces stayed bit-identical, while coarse supported impacts converged toward the high-rate reference.

Accepted gear strokes now record their complete trajectory seed in twelve previously reserved optional fields. The existing rig and PresentedFrame reconstruct the same safe clearance/cover/angle route. No model construction was changed. The interrupted-shift live-rig matrix observed at most 1.083 mm boot/selector overlap, inside the unchanged 3 mm allowance. Legacy unmarked frame pairs retain their former linear behavior.

The first broad run exposed six integration failures: 1,234 of 1,240 tests passed across 124 motocross files. All six unchanged tests passed on the original baseline, so they were treated as introduced issues. The touchdown solver had preserved horizontal velocity before a final terrain resample, but published its along-slope speed using the new slope without re-expressing that velocity. Re-expressing the existing horizontal momentum after the final sample corrects the held-whip direction error. Removing only that correction reproduces both full-lap crashes exactly; keeping it passes all 18 unchanged forgiving-handling cases, including two player-solver laps on each venue.

Two related fixture contracts were updated without loosening their existing limits. The held-whip oracle projects the final conserved world velocity into the recorded first-contact heading, because the chassis continues rotating during the remainder of the tick; its 1e-6 direction and eight-digit lateral checks remain. The boot-support fixture seeds the authoritative finite-response posture controller, then advances both matched riders two ticks from the same .49 foot position. It retains the .5 load crossing, per-tick roll bound, recovery equality and body-velocity bounds. The riding/collision suites pass all 41 tests.

The independent extended display benchmark preserves all original comparisons and adds real-controller shifts, reverse seeks, repeated pause poses and detail-level changes. Its 93,936 matrix and 79,344 scalar comparisons all report zero difference; it evaluated 36,192 actual rig poses. These are CPU transform and recording-consistency results, not physical-GPU frame-rate measurements.

The broader 38-file recording/session/contracts follow-up passed 577 of 578 tests. Its remaining failure expects the entire MX placement tail to be zero, while the new foot trajectory intentionally records its valid marker and event identity there. The car-contact mask remains zero, the road-bike reader rejects the tail, and the rest of that placement payload is zero. This tagged-metadata test contract awaits independent review before final acceptance.

### Limits retained for follow-up

- The reduced spring geometry still has the conservative-force discrepancy documented by assignment 18; the isolated torque patch was rejected because it broke previously successful jumps.
- A forward-only scalar speed constraint can leave residual closing velocity after a slope impact whose coupled solution would move backward (assignment 26). The helper remains passive, but a general reverse-motion constraint formulation is outside this patch.
- Existing course discontinuities can move sampled terrain sharply between fixed ticks. The reduced force-point geometry also differs from authored suspension geometry on steep pitches. Assignment 32 separates these effects from interpolation error; it does not claim exact rendered tyre/terrain contact everywhere.
- The 105-run player scenario matrix covers controlled flights, braking, rain and adverse landings. It is complementary to the full-lap checks, not a complete certification of every input history.

## Runtime preparation

The system Chromium launcher existed but its executable was absent. A task-local Playwright Chromium installation successfully created a real WebGL2 context with the SwiftShader backend. This is environment readiness, not a passed game journey or hardware performance measurement.

## Waves 7–8: native acceptance and independent review

The direct product build passed without running model-generation hooks. Assignment 37's unchanged native browser journey passed on Low/SwiftShader: both MX450/Valley Ridge and MX250/Arena Nord completed menu selection, eight-rider gate, manual body/throttle controls, AI demonstration flight and touchdown, chase/cockpit views, pause and return to paddock. Twelve game images and source/build manifests were retained. This was a fingerprinted working-tree build with `commit: null`; it is not retrospectively described as a committed build or hardware-performance measurement.

The original full-grid sweep classified all 96 entrant starts but passed only seven of eight acceptance cases. Arena Nord clear seed 60724 gave rider 7 two crashes, against zero in the untouched baseline. Assignment 40 isolated the route failure: an existing AI shoulder guard stopped checking an outward lane-crossing trajectory above a binary front-load cutoff, despite its control response already scaling continuously with support. Removing that redundant eligibility gate keeps the new body physics and existing threat/control formulas. The exact race then passes its original limits: all twelve classified, rider 7 has no crashes, and one other rider has one allowed crash. Seven focused suites pass 112 tests, and both complete player two-lap trace artifacts remain byte-identical before/after the AI-only repair. The final eight-case matrix is still required.

Assignment 41 resolves the recording-contract finding. The test still compares all 33 optional-tail slots exactly, explicitly recognizes the neutral MX trajectory marker/event, poisons inherited car measurements and a stale output buffer, and verifies that all four car readers and the road-bike reader reject the MX payload. Its three focused suites pass 29 tests. No production clearing or schema weakening was needed.

Assignment 42 independently reproduces the four unrelated inherited CI failures on both original and current source: car-wing material, fourteen missing GP brake translations, GP catalogue identity, and its stale saved calibration. Both selections return 48 passed and four failed. The 339 protected inputs are byte-identical. These out-of-scope issues remain visible; this task does not claim globally green CI.

Assignment 43 independently checks coupled contact projection, passivity, mass scaling, exact start/interior/end contact boundaries and nonuniform drag subdivision. Its 4,096 contact cases have no energy gain and at most 1.954e-14 m/s residual closure. The finite end-of-tick contact executes one zero-duration supported boundary and records one landing. These results complement the real driving traces.

Assignment 44 found an additional motion defect during review: an interrupted selector near a travel limit could shorten the entire distant-target bridge, producing excessive speed and Float32 reconstruction error. The revised construction retains the full handoff duration and confines the incoming tangent correction to the available local travel. Existing shift/rig/recording suites pass 22 cases; the new extremum, serialization and actual-rig regressions are still being completed at this checkpoint. Final source acceptance will supersede these intermediate results.

## Publication method

Native command-line push lacks credentials in this workspace. Publication uses the authorized GitHub connector's Git data operations, verifies the exact staged tree, and updates `main` with its expected previous head. Concurrent upstream commits must be integrated before retrying a rejected head lease. No force update is authorized or needed.

Before publication, upstream advanced from the task baseline to `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. That commit only updates CI receipts from the earlier handoff. It was preserved by a normal fast-forward; the task's source edits remained intact. The comparison worktree remains pinned to the original task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887`.

## Final-resolution appendix — 2026-11-25 UTC

This appendix reconciles the earlier checkpoints with the frozen final source. Earlier failed and incomplete runs above remain historical evidence; a later pass does not rewrite their outcome. The coordinator's terminal update records failed final native acceptance and completed code publication, with those outcomes kept distinct.

### Resolved implementation and integration findings

| Earlier finding | Final disposition |
| --- | --- |
| Sequential axle stops and unloaded yaw energy gain | Coupled unilateral stops and exact velocity-coordinate rotation are integrated. A43 independently checks 4,096 contact cases, passivity and contact-time boundaries; A49 includes the committed regression suites. |
| A22/A25 wheel-pickup timing disagreement | Player contact is resolved at an endpoint-bracketed event before the supported remainder. The unchanged 0.03 m/s pickup gate passes; A48 independently strengthens the actual event-basis observer. |
| A20 rendered interrupted-shift overlap | A27 records and reconstructs the complete accepted foot route in both live readers. A44 additionally bounds near-limit incoming tangents without compressing the distant target movement. The existing mesh/trajectory regressions and the new extrema suite pass. |
| Coarse supported Arena landing incorrectly crosses the crash threshold | A28 refreshes the unchanged force law through bounded supported stages. The measured 120 Hz bottoming result converges toward the refined reference without a new crash allowance. |
| Six failures in A34's initial motocross batch | The final terrain resample preserves the resolved world-velocity basis; related physical fixture/oracle contracts are reviewed in A48. Final A49 passes riding 27/27, collision 14/14 and forgiving handling 18/18, including unchanged player full laps. |
| Optional MX placement metadata expected to be entirely zero | A41 keeps an exact comparison of all 33 tail fields while explicitly recognizing the marker/event. Poisoned-car and stale-buffer cases preserve vehicle separation. A49 passes wheel-contact recording 10/10. |
| A38 full grid passes seven of eight cases | A40 removes the redundant binary front-load eligibility cutoff from the existing shoulder guard. Final A52 passes the complete eight-case matrix; the original failing case has rider 7 at zero crashes and one permitted crash by rider 6. |
| A44 additional extremum/serialization tests still pending | Final targeted review passes 60 distinct cases across five files, including all nine new extrema cases. Those new cases also pass inside A49's final combined run. |
| A45 malformed fender endpoint range gap | A47 checks the actual optional controller range consistently at endpoints and interior samples. Invalid marked data takes the existing fallback. Its final nine-case boundary suite passes in A49. |
| Camera inherits a preceding flight's timer through a hidden landing/relaunch | A46 adopts the current recorded flight origin, removing the observed false kick while retaining ordinary spring decay. All three new regression cases pass in A49. |
| A42 unrelated inherited CI failures | Still present and explicitly out of scope: both baseline and candidate produce 48 passes/four failures in the same 52-case selection. This task does not claim globally green CI. |

[A43](agents/43-physics-review.md) · [A44](agents/44-motion-review.md) · [A46](agents/46-camera-lifecycle.md) · [A47](agents/47-replay-boundaries.md) · [A48](agents/48-oracle-review.md) · [A49](agents/49-final-units.md)

### Final frozen-source acceptance completed

- **Combined tests:** one invocation, 165 distinct files and 1,836 passing cases, no failures, skips, pending cases, todos or duplicate/missing files. All 2,710 captured inputs are unchanged.
- **Full grid:** eight of eight cases pass, 96 entrant starts classify, 192 rider-laps finish, no retirements, nine total crashes, at most one per rider per race, maximum stop 14.60 seconds. The previous incomplete executor attempt is excluded from acceptance.
- **Calibration:** all 20 surveyed configurations pass existing bands; hold-speed outcomes are 17 clean and three permitted bottomed. All 20 rolling checks and twelve applicable gap-window configurations pass. The tracked calibration JSON is unchanged.
- **Final display cadence:** 93,936 matrix comparisons and 79,344 presented-field comparisons have exactly zero measured differences across five display rates, fractional samples, reverse seeks, pauses and detail changes. The run evaluates 36,192 actual rig poses and retains all 48 accepted supplemental shifts. This is CPU pose/recording evidence, not GPU FPS.
- **Build/static gates:** the product/full Vite build and IP guard pass; the full TypeScript check passes with the explicit 5 GiB heap. Full ESLint passes, and the sole subsequent test-only change receives its own focused lint pass.
- **Protected scope:** A51 independently verifies all 1,772 protected files and their modes against the original baseline; permitted inverse reader edits restore the entire original `bike.ts`. No authored model, environment, terrain, material or specification edit is hidden in the engine work.

The final source/test/benchmark tree is `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`. A53 proves the actual staged Git blobs match the accepted source and reproduce the retained product fingerprint `d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`. Source commit `39d9d497880e92801a7d77de6af2639b4186bfcc`, with parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`, was subsequently published using an expected-parent update with no force. A fresh GitHub ref read at 20:44:23 UTC confirmed actual `main` publication. Fetching that commit confirmed the same accepted tree before local HEAD was aligned without changing any working files.

### Terminal native outcome and code publication

A37's earlier complete Low/SwiftShader browser pass remains valid for its own earlier source. A50 built the final source successfully, then preserved one interrupted attempt and a completed `page.evaluate: Target crashed` failure after ten game captures. The isolated unchanged diagnostic exited 1 at 20:42:04 UTC after 1,205.098 seconds, reaching its original 1,200,000 ms timeout with `locator.click: Target crashed` during APPLY & SAVE. Low was selected but not applied, and no venue/gameplay captures occurred. Two GPU-process exit-code-9 events were retained with an unproven cause. All 1,734 captured inputs and 266 built files remained identical; all browser, preview, Playwright and observer processes ended. Final native acceptance therefore **failed and remains open**. Neither earlier screenshots nor A37's older pass fill the missing stages.

No physical-GPU performance, High/Ultra quality or real-motorcycle calibration claim is made. The conservative spring-work discrepancy, forward-only impact constraint, endpoint-bracketed contact coverage, coarse terrain/force-point geometry and global Float32 header-clock limits remain documented.

Actual code publication and A60's independent verification are complete. A60 observed code commit `39d9d497…`, rehashed the accepted content, and then observed direct CI-only child `6dc4c70515bfde48b27e2794bd97cdf1e1bd681d`. The coordinator confirmed only `ci-reports/benchmark-smoke.md` changed and preserved that child by normal fast-forward at 20:51:56 UTC. All sixty distinct agents are recorded in ten waves of six. The final documentation commit includes their reports and completed ledger; its actual ref update is verified separately by the coordinator after creation, without attributing that future verification to A60. This development publication does not claim a completed final native journey or release certification. [Handoff](README.md) · [Build provenance](BUILD_PROVENANCE.md) · [Published-code verification](agents/60-publication-verification.md) · [Agent ledger](AGENT_LEDGER.md) · [Native evidence](agents/50-final-native.md) · [Race/calibration evidence](agents/52-final-races.md) · [Final cadence](agents/54-final-cadence.md)
