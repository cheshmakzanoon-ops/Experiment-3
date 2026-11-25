# Motocross engine physics and fluid animation

## Current handoff

This engine update improves motocross contact dynamics, suspension timing, rider response, gear-foot motion, recording reconstruction and camera continuity while retaining the existing bikes, riders and courses. The published source passes the combined **1,836-case acceptance selection**, the complete **eight-race matrix**, the existing **20-configuration calibration**, and the dense display-cadence comparison. The product build, TypeScript check and lint gates also pass.

The engine source is published to `main` in [commit 39d9d497880e92801a7d77de6af2639b4186bfcc](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc). Its tree exactly equals the accepted source/test/benchmark candidate.

**Final native-browser acceptance failed and remains open.** One completed invocation on the final build encountered `page.evaluate: Target crashed` after ten captures. The isolated unchanged diagnostic then reached its original 20-minute limit during APPLY & SAVE, ending with `locator.click: Target crashed` before venue entry. Low quality was selected but not successfully applied in that diagnostic. Two GPU-process exits were recorded; the cause is unproven. All 1,734 captured inputs and 266 built files remained unchanged. The earlier A37 complete pass predates four final runtime fixes and does not replace final-source acceptance. This is the requested engine development publication, with no completed final-browser, hardware-performance or release-certification claim. [Native attempt history](agents/50-final-native.md) · [Compact native evidence](evidence/50-final-native.json) · [Build provenance](BUILD_PROVENANCE.md)

The work used **60 distinct agents in ten waves of six**. The [agent ledger](AGENT_LEDGER.md) records every actual assignment and its outcome, including rejected experiments and failed acceptance. [Assignment 60](agents/60-publication-verification.md) independently verified actual code publication and source equality; the coordinator separately publishes and verifies the documentation containing that report.

| Read next | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Numerical contracts, live consumers, controller ownership, payload layout and lifecycle boundaries |
| [Build and source provenance](BUILD_PROVENANCE.md) | Exact accepted source, artifact identity, staged-tree equivalence and postpublication checks |
| [Limitations](LIMITATIONS.md) | Remaining physical-model, sampling, compatibility and graphics limits |
| [Agent ledger](AGENT_LEDGER.md) | Actual ten-wave assignments, authored reports and delivery status |
| [Production-change coverage](CHANGE_COVERAGE.md) | Every changed runtime module mapped to behavior, ownership and executed regression tests |
| [Published-code verification](agents/60-publication-verification.md) | Independent remote observations, immutable Git-blob checks and reusable local verifier |
| [Development checkpoints](CHECKPOINTS.md) | Preserved intermediate failures, causal investigations and subsequent resolutions |
| [Original plan](PLAN.md) | Scope, protected content and coordination rules |

## What changes in the engine

### Contacts and landing integration

Front and rear hard stops are resolved together with a unilateral coupled impulse solve. A front-then-rear correction could reopen the first contact; the new active-set solve handles absent, single, simultaneous and nearly redundant supports without adding restitution or penetration-bias velocity. Independent review checks complementarity, axle-order symmetry, mass scaling and passivity. The ground solver also rotates its velocity coordinates exactly when heading advances, eliminating artificial translational energy introduced by the former explicit coordinate update. [Contact implementation](agents/07-coupled-stops.md) · [Ground passivity](agents/10-ground-passivity.md) · [Independent physics review](agents/43-physics-review.md)

Unsupported motocross translation uses exact constant-gravity displacement and an analytic quadratic-drag speed/distance step. The ridden player MX250/MX450 path locates a first closing tyre contact inside an endpoint-bracketed interval, advances the free state to that event, and applies support for the remaining duration. Incoming impact observations now share an event timestamp. Final slope resampling re-expresses the resolved planar velocity in the new basis, preserving the held-whip momentum contract. Rotor updates are not duplicated across the split. [Ballistics](agents/15-ballistic-integration.md) · [Drag](agents/22-air-drag.md) · [Contact timing](agents/25-contact-time.md) · [Full-lap regression repair](agents/36-full-lap-regressions.md)

This search is bounded to 32 bisections per crossing axle. It refines an endpoint sign bracket; it does not guarantee the earliest crossing through arbitrary nonmonotonic or thin terrain features inside the interval.

### Suspension forces and the pose shown to the player

Incoming suspension force and compression describe the state on which the force solve acts. Displayed fork/shock travel describes the outgoing chassis pose. Publishing those separate timestamps intentionally removes the former delayed visual stroke. Consumers must not reconstruct incoming force from the displayed endpoint travel.

The player path locally refines stiff supported motion when predicted shaft sweep or bump-stop phase needs it. Each stage refreshes the existing spring, damper and stop law. Work is capped at 16 stages; observed 120 Hz fixtures used two stages on only 8–9 outer calls over six seconds, and the four measured 240 Hz traces remained bit-identical. This is bounded numerical refinement, not a universal error-controlled integrator. Existing spring specifications and landing/crash criteria remain. [Suspension coherence](agents/13-suspension-coherence.md) · [Supported integration](agents/28-supported-accuracy.md)

### Continuous rider and gear motion

Automatic standing, dab and body response advance once on the fixed simulation clock with bounded critically damped response and continuous targets. The manual/automatic body blend has a local continuous-value-and-rate join near neutral, while the finite manual momentum stroke remains intact. Measured stance and body derivatives are recorded so sparse snapshots can reconstruct motion with bounded Hermite curves, including genuine direction reversals. [Posture controller](agents/08-posture.md) · [Manual blending](agents/21-rider-blending.md) · [Posture transport](agents/16-posture-transport.md) · [Body transport](agents/23-body-transport.md)

Accepted shifts publish their complete foot-trajectory seed, event identity, relative age and split local clock. The live bike reader and `PresentedFrame` evaluate the same controller route. They retain the clearance waypoint between snapshots instead of interpolating selector, cover and clearance independently through it. The final interrupted-shift construction preserves the full target-movement duration and bounds the short incoming-tangent correction near a travel limit. Canonical isolated strokes retain their original 260 ms timing and sampled values. [Foot reconstruction](agents/27-foot-reconstruction.md) · [Final motion review](agents/44-motion-review.md)

### Recording, lifecycle and camera continuity

Suspension, posture and foot readers share the same snapshot interpretation across live presentation, replay, pause, reverse seeks and detail changes. Optional payloads have marker, finite-value, range and lifecycle checks. Unmarked legacy data keeps its established fallback; malformed data cannot silently become a new authoritative controller state. Synthesized interior `PresentedFrame` foot values clear the copied trajectory marker.

Reset, placement and remount paths clear stale contact/landing state and refresh immediate tyre telemetry. The camera integrates moving heading, roll and gaze targets consistently across observation intervals. A new flight's recorded timer replaces the preceding flight timer, preventing an unseen touchdown/relaunch from lending a tiny hop a false landing kick. [Reset review](agents/14-reset-lifecycle.md) · [Replay boundaries](agents/47-replay-boundaries.md) · [Camera ramps](agents/24-camera-motion.md) · [Camera flight origins](agents/46-camera-lifecycle.md)

The narrow AI integration repair removes the binary front-load eligibility cutoff from the existing supercross shoulder guard. Its geometric threat calculation and support-scaled control formulas remain. This keeps the established recovery response available while load changes continuously; it does not add grip or relax crash limits. [Causal grid repair](agents/40-grid-regression.md)

## Measured improvements

These are specific reproductions made at the named development stages. “Before” means the source identified by the linked report; some comparisons are against an intermediate implementation, not the original task baseline. They are not game-wide improvement percentages. The final acceptance below separately checks the integrated frozen source.

| Reproduced problem | Before | After | Evidence and meaning |
| --- | ---: | ---: | --- |
| Flat two-contact drop, −6 m/s | 3.6922068915 m/s residual front closing speed after sequential stops | Zero closing, vertical and pitch speed | [A07](agents/07-coupled-stops.md); coupled contact resolution |
| Unloaded yaw, initially 46,000 J | 46,215.162546 J after one second | 46,000.000000000284 J | [A10](agents/10-ground-passivity.md); removes coordinate-update energy gain |
| Wheel-pickup exit-speed disagreement, 240/480 Hz continuation | 0.0304897609 m/s | 0.0009743872 m/s | [A25](agents/25-contact-time.md); touchdown-relative comparison, unchanged 0.03 m/s gate |
| Same contact comparison at common elapsed time | 0.0212062438 m/s | 0.0036787893 m/s | [A25](agents/25-contact-time.md); separates event timing from elapsed-time comparison |
| Arena MX450 bottoming speed at 120 Hz | 7.062512 m/s | 6.628231 m/s | [A28](agents/28-supported-accuracy.md); 3840 Hz reference 6.648376 m/s, retained crash threshold |
| Standing reconstruction from 30 Hz endpoints, measured MX450/Valley trace | 0.002059127 mean absolute pose error | 0.000029471 | [A16](agents/16-posture-transport.md); 98.57% reduction in that normalized channel |
| Repeated downshift at 27/240 s, peak selector rate | 86.2226 rad/s | 8.91892 rad/s | [A44](agents/44-motion-review.md); normal-clock interruption, full-stroke diagnostic |
| Natural short-hop camera observation | 19.523012 mm false added landing displacement | No new kick; existing spring decay retained | [A46](agents/46-camera-lifecycle.md); actual recorded Arena/MX450 sequence |

The foot-path reproduction separately found 14.541 mm overlap in its 30 Hz mid-detail endpoint interpolation. Reconstructing the accepted route clears those sleeve rays laterally. The broader A27 matrix's worst overlap was 1.083 mm, inside the existing 3 mm allowance; later A44 reran the existing dense mesh and trajectory checks unchanged. These measurements concern the existing rig and sampled contact rays, not modified geometry. [Foot-path evidence](agents/27-foot-reconstruction.md)

## Final acceptance on the frozen candidate

| Gate | Completed result | Scope and qualification |
| --- | --- | --- |
| Combined units/contracts | **165 files, 1,836 passed, 0 failed/skipped/pending/todo** | 128 motocross files plus 37 recording/session/replay/transport files; one deduplicated invocation. [A49](agents/49-final-units.md) |
| TypeScript | Pass | Full check with an explicit 5 GiB Node heap; the baseline also exceeded the default heap. [Provenance](BUILD_PROVENANCE.md) |
| ESLint | Pass | Full source/test/e2e/script check, followed by focused lint of the sole later test-only oracle edit. [Provenance](BUILD_PROVENANCE.md) |
| Product/full build | Pass | Direct Vite build with IP guard; no npm asset-generation hook. Retained working-tree identity has `commit: null`. [A50](agents/50-final-native.md) |
| AI full-grid races | **8/8 pass** | Two laps, twelve alternating MX450/MX250 riders, two venues, two weather selections and two seeds: 96 classified starts, 192 rider-laps, zero retirements, nine total crashes, at most one per rider per race, max stop 14.60 s. [A52](agents/52-final-races.md) |
| Existing calibration | **20 configurations within unchanged bands** | 17 clean and three permitted bottomed hold-speed outcomes; 20 rolling checks and twelve applicable gap-window configurations pass. These are not twenty perfectly clean landings. [A52](agents/52-final-races.md) |
| Dense display cadence | **93,936 matrix and 79,344 field comparisons; all deltas zero** | Eight recordings, 36,192 actual rig poses, 48 accepted supplemental shifts; 30/60/120/144/240 Hz, fractional sampling, reverse seek, pause and high/mid/far detail changes. CPU transform/recording consistency. [A54](agents/54-final-cadence.md) |
| Final native journey | **Failed; open acceptance limitation** | Final-build attempt crashed after ten images; isolated diagnostic timed out with a target-crash error while applying Low, before venue entry. SwiftShader GPU exits are recorded without a proven cause. [A50](agents/50-final-native.md) |
| Code commit and main publication | **Published and independently verified** | `39d9d497880e92801a7d77de6af2639b4186bfcc`, exact accepted tree and preserved parent. A60 verified the actual remote code commit and its source-equivalent CI-only successor `6dc4c705…`; the coordinator retained that successor with a normal fast-forward. [A60](agents/60-publication-verification.md) |

The final unit run hashes 2,710 inputs before and after; none changed. The race/calibration runs preserve all 1,131 captured inputs. The cadence run preserves all 1,132 captured inputs. These scopes overlap and are not added together as distinct coverage.

The race runner uses AI-controlled entrants. Player-solver evidence comes from the separate player scenarios, contact/stop tests and unchanged full-lap cases, including two player laps at both venues with no crashes in the accepted A36 traces. The final 1,836-case run includes the relevant player and full-lap regressions. [Player scenarios](agents/33-player-scenarios.md) · [Full laps](agents/36-full-lap-regressions.md)

Test changes are documented rather than hidden. The force-versus-pose timestamp change required replacing an old filtered-stroke initial-dive bound with 1% of full travel (3 mm); independently measured physical travel was 1.816–1.985 mm. The event-local momentum oracle now observes heading/yaw before the landing record, and the support fixture initializes the authoritative finite-response controller. The independent review retains force, friction, crash and momentum checks and explains every changed existing test. [Oracle audit](agents/48-oracle-review.md)

### Inherited CI failures remain visible

A separate comparison ran the same four unchanged files on baseline and candidate: **48 passed and four failed out of 52 on both**. The failures are the car-wing material expectation, fourteen missing GP rear-brake translations, GP-R1 catalogue identity, and its stale saved calibration identity. This establishes their inherited status in that selection; it does not establish globally green CI or count all possible failures outside this task. [Baseline comparison](agents/42-baseline-ci.md)

## Protected content and compatibility

The task changes **59 runtime/test/benchmark paths**: **18 runtime files, 37 test files and four benchmarks**, plus this documentation. The independent protection audit verifies **1,772 files, 264,155,763 bytes**, with identical contents and Git modes against task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887`. Authored character/bike models, meshes, materials, environments, terrain/course definitions and vehicle specifications remain unchanged. Reversing only the permitted imports and three motion-reader calls restores the entire original `src/rendering/bike.ts` byte for byte. [Protected-source audit](agents/51-protected-scope.md)

The intended deterministic physics change advances `SIMULATION_VERSION` from **39 to 40**. Snapshot `PROTOCOL_VERSION` remains **17**, header **24**, entrant stride **331**, and the existing contact tail remains base **298**, size **33**. Optional posture derivatives and foot-trajectory data occupy reserved MX fields inside that tail. Legacy zero-marker recordings retain their established interpretation; simulation-identity checks prevent silently treating v39 resimulation as v40. [Architecture](ARCHITECTURE.md) · [Protocol review](agents/45-protocol-review.md)

The earlier scope matrix found nine exact 48-second non-MX traces. The two accepted MX-on-road scenarios retain eight differing tyre telemetry values at initial placement and new optional foot metadata; subsequent measured physical snapshots were exact. This is qualified evidence for that matrix, not a claim that every other vehicle/mode snapshot is byte-identical. [Scope isolation](agents/30-scope-isolation.md)

The verified candidate tree is `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`, based on `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. The latter preserved 24 incoming CI-receipt changes after the original task baseline. The accepted Vite fingerprint is `d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`. Candidate Git blobs reproduce that fingerprint exactly. It excludes public assets and some supporting scripts, whose separate manifests provide additional evidence; it is not a hermetic environment identity. The retained artifact must not be relabelled as a postcommit build. [Exact identity definitions](BUILD_PROVENANCE.md)

## Reproduce without generating models

These commands assume the repository's dependencies and the required browser are already installed. Run from the repository root unless a block explicitly changes directory. Use the installed tools directly: this repository's `pretest` and `prebuild` hooks invoke player-model generation.

### Static gates and product build

```sh
node --max-old-space-size=5120 node_modules/typescript/bin/tsc --noEmit
node_modules/.bin/eslint src tests e2e scripts
node_modules/.bin/vite build
```

The complete reproducible **165-file combined unit command** and exact selected-file inventory are in [A49, Execution and configuration](agents/49-final-units.md#execution-and-configuration). Its motocross glob alone covers 128 files and 1,278 cases in this revision; do not report a motocross-only rerun as the full 1,836-case acceptance.

### Dense pose reconstruction

```sh
node_modules/.bin/vite-node --script scripts/bench/motocross-field.ts --cadence
```

This constructs and poses the actual existing rigs on the CPU. It does not measure submitted GPU frames or display refresh performance.

### Full grid and calibration

Use a fresh output directory so the calibration runner cannot overwrite the tracked calibration receipt. Remove the runner's optional race filter for the complete eight-case matrix.

```sh
MOTO_REPO=$(pwd)
MOTO_VALIDATION=$(mktemp -d)
mkdir -p "$MOTO_VALIDATION/docs"
cd "$MOTO_VALIDATION"
env -u OFFROAD_RACE node --experimental-transform-types "$MOTO_REPO/scripts/offroad-races.ts" --mx-full-grid
node --experimental-transform-types "$MOTO_REPO/scripts/offroad-calibration.ts"
```

### Native game journey

Return to the repository root and use an installed Playwright Chromium. If its cache is outside Playwright's default location, set `PLAYWRIGHT_BROWSERS_PATH` to that existing cache; the recorded cache path is in A50.

```sh
APEX_BROWSER_BACKEND=swiftshader \
APEX_MOTOCROSS_JOURNEY_QUALITY=low \
APEX_MOTOCROSS_JOURNEY_PROGRESS=1 \
node_modules/.bin/playwright test e2e/45-motocross-gameplay.spec.ts \
  --config playwright.motocross.config.ts
```

The configuration uses one worker, zero retries and a fresh preview on port 4197. Run this separately from heavy simulation/build workloads. Preserve every attempt's exit status, trace, screenshots and source/build identities; a partial capture sequence is not a completed journey. The isolated diagnostic additionally enables browser stderr and bounded resource observations without changing acceptance.

### Further investigation tools

```sh
node --experimental-transform-types scripts/bench/motocross-player-dynamics.ts
node --experimental-transform-types scripts/bench/motocross-spring-work.ts
node --experimental-transform-types scripts/bench/motocross-scope-isolation.ts --baseline ../motobound-baseline --candidate .
python docs/engine/motocross-dynamics-2026-11-25/evidence/51-protected-scope.py
```

The scope comparison needs an actual untouched checkout at the stated baseline. Its intentionally strict whole-frame physical comparison reports the known initial MX-on-road tyre telemetry differences; that nonzero result must be read with A30, not hidden. The spring-work command includes a clearly labelled in-memory torque-only counterfactual; it is a diagnostic of a remaining model inconsistency, not a shipped fix. The protection script writes only its evidence JSON and does not stage or publish anything. It intentionally pins this historical candidate and its inherited CI-receipt head; later unrelated CI-receipt changes can fail that original inventory assertion. Use the read-only postpublication recipe in BUILD_PROVENANCE.md to compare published source identity.

## Remaining engineering limits

The reduced spring/torque geometry retains a conservative-work inconsistency. A torque-only correction was measured and rejected after it broke eight previously successful jumps; a coordinated force, geometry, initialization and calibration redesign is needed. A forward-only scalar speed constraint can retain residual closing speed when a coupled impact would require reverse motion. Course discontinuities and the difference between reduced force-point geometry and authored suspension geometry also limit exact tyre/terrain agreement. These are documented model limits, not repaired by interpolation. [Spring investigation](agents/18-spring-geometry.md) · [Integrated stops](agents/26-stop-integration.md) · [Live-pose geometry](agents/32-live-pose-coherence.md)

The first-contact search cannot guarantee every unbracketed interior collision. Bounded supported refinement is not a general error estimator. A split local foot clock protects the recorded foot event calculation, but it cannot recover whole-scene timing after the unchanged Float32 `H.TIME` header loses distinct timestamps in very long sessions. Hidden commands or impacts between coarse observations also cannot be reconstructed without sufficient metadata. [Independent review](agents/43-physics-review.md) · [Protocol limits](agents/45-protocol-review.md)

CPU transform equality, deterministic tests and software WebGL2 execution do not establish hardware-GPU FPS, High/Ultra rendering quality, perceived continuous smoothness on every display, or calibration against measured real motorcycles and riders. The detailed limitations and next engineering priorities belong in [LIMITATIONS.md](LIMITATIONS.md).
