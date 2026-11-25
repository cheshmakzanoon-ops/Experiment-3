# Production-change coverage and review map

**Final coverage closure: 2026-11-25 20:55:40 UTC.** Every one of the **18 changed/new runtime files** has a concrete behavior, an accountable implementation/review path and relevant executed regressions below. No additional runtime path or unreviewed shipped module was found. This is a semantic ownership and regression map, **not measured line or branch coverage**, a proof of all possible inputs, or full native-release acceptance.

The published [source commit `39d9d497880e92801a7d77de6af2639b4186bfcc`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc) has immutable tree **`b7f379a7aaea0f807b5623b2c981190c6d1a3a17`**, containing **10,467 entries**. It changes exactly the **59 inventoried runtime/test/benchmark files** relative to sole parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`; every corresponding current file equals its committed blob. Runtime membership remains **14 modified and four new files**, with **37 tests and four benchmarks**. [A60](agents/60-publication-verification.md) independently verified the actual remote publication. Its later observed CI child `6dc4c70515bfde48b27e2794bd97cdf1e1bd681d` has complete tree `9fc26764430e29c7e0283be435b117682dd77fdf` and preserves all accepted source. At this final closure check, local HEAD/index equal that CI tree; only `ci-reports/benchmark-smoke.md` differs from the code commit. Staged and source/test/script working differences are empty. The documentation commit is a later coordinator action, outside these publication-verification reports.

The raw A49 JSON reporter independently confirms **165 unique files / 1,836 passed assertions**, no other assertion status. The test files named in this matrix form a deduplicated subset of **41 files / 590 passed assertions** within that same invocation. All 37 changed test files occur in this directly mapped subset; the other four are existing regression files. A test reused by several runtime rows is counted only once in that subset. Historical audits, repeats, matrix elements and benchmark samples are not added to the 1,836 figure.

## Evidence keys and boundaries

| Evidence | What it establishes for this source | Boundary |
| --- | --- | --- |
| [A49 final units](agents/49-final-units.md) | The complete selected motocross and recording/session/transport contracts passed on unchanged input files. | Selection-wide pass; not a full-repository green-CI claim. |
| [A52 final races/calibration](agents/52-final-races.md) | Eight complete 12-rider races and 20 configurations passed existing checks. | AI races include nine crashes; calibration includes three allowed bottomed outcomes. It does not replace player-path contact tests. |
| [A54 final cadence](agents/54-final-cadence.md) | Identical requested CPU poses under display rates, seeks, pauses and detail changes; actual rigs and active controllers. | No GPU/frame-rate, continuous visual perception or stateful chase-camera claim. |
| [A51 protected scope](agents/51-protected-scope.md) | Authored model/environment/specification bytes and modes remain unchanged; permitted bike-reader patch is independently reversible. | Physical behavior and driven model poses intentionally change. |
| [A53 provenance](agents/53-build-provenance.md) | Final test/build inputs equal candidate Git blobs; Vite fingerprint recomputed from those blobs. | Retained artifact is a working-tree product build with `commit: null`; it is not relabeled as a later release build. |
| [A50 native record](agents/50-final-native.md) | Final build passed; both completed failed browser invocations and the interrupted first attempt are preserved. | Final native acceptance failed. The diagnostic timed out during settings-save before venue entry; cause remains unproven. A37's earlier pass cannot fill this gap. |
| [A59 publication preflight](agents/59-publication-preflight.md) | Independent scope, complete candidate/index, protected bytes and actual acceptance-receipt checks passed. | The preflight preceded the branch update and explicitly retained failed native acceptance. |
| [A60 publication verification](agents/60-publication-verification.md) | Independently observed the code commit on main and its CI-only child; verified published content, fingerprint, protected files and retained build. | Verifies code publication for its recorded observations, not the later documentation commit or a passing native gate. |

All test-file references in the following sections were checked against the **actual A49 assertion results**, not merely the filesystem. Paths are relative to the repository root. Assignment numbers refer to the linked [agent ledger](AGENT_LEDGER.md).

## Physical state and contacts

### 01. [src/simulation/offroad/contact-impulse.ts](../../../src/simulation/offroad/contact-impulse.ts)

Coupled nonnegative front/rear impulses from one incoming velocity, stable near redundant supports; retain single-contact compatibility.

**Implementation/review:** 7, 26, 43; root consumer integration. **Relevant executed regression files:** [motocross-coupled-stops.test.ts](../../../tests/motocross-coupled-stops.test.ts) (5 passed); [motocross-hard-stop-integration.test.ts](../../../tests/motocross-hard-stop-integration.test.ts) (10 passed).

Complementarity, no added impulse energy, axle-order symmetry, natural adapter contact, and the separate forward-only-clamp limitation are exercised. A43 adds an independent mass-weighted projection oracle.

### 02. [src/simulation/offroad/dirt-bike-vehicle.ts](../../../src/simulation/offroad/dirt-bike-vehicle.ts)

Integrate coherent flight/contact timing, current-pose suspension output, bounded supported stages, posture ownership and clean transient resets.

**Implementation/review:** Root; 8, 15, 19, 22, 25, 28; 13, 14, 26, 36, 43, 48 review. **Relevant executed regression files:** [motocross-dynamic-suspension.test.ts](../../../tests/motocross-dynamic-suspension.test.ts) (14 passed); [motocross-ballistic-timing.test.ts](../../../tests/motocross-ballistic-timing.test.ts) (13 passed); [motocross-contact-reset.test.ts](../../../tests/motocross-contact-reset.test.ts) (13 passed); [motocross-contact-time-coherence.test.ts](../../../tests/motocross-contact-time-coherence.test.ts) (13 passed); [motocross-hard-stop-integration.test.ts](../../../tests/motocross-hard-stop-integration.test.ts) (10 passed); [motocross-supported-convergence.test.ts](../../../tests/motocross-supported-convergence.test.ts) (3 passed); [motocross-landing-observability.test.ts](../../../tests/motocross-landing-observability.test.ts) (9 passed); [motocross-landing-prediction.test.ts](../../../tests/motocross-landing-prediction.test.ts) (12 passed); [motocross-wheel-pickup.test.ts](../../../tests/motocross-wheel-pickup.test.ts) (11 passed); [motocross-riding.test.ts](../../../tests/motocross-riding.test.ts) (27 passed); [motocross-forgiving-handling.test.ts](../../../tests/motocross-forgiving-handling.test.ts) (18 passed); [motocross-player-dynamics.test.ts](../../../tests/motocross-player-dynamics.test.ts) (20 passed); [motocross-contact-traction.test.ts](../../../tests/motocross-contact-traction.test.ts) (17 passed).

The adapter has several independent state/timing contracts; the detailed submatrix below separates them. A52 exercises the AI matrix but does not replace the independent-player tests.

### 03. [src/simulation/offroad/air-drag.ts](../../../src/simulation/offroad/air-drag.ts)

Evaluate speed and travel for the same constant-coefficient quadratic-drag interval, including zero/subnormal coefficients and rejected invalid inputs.

**Implementation/review:** 22; 43 review. **Relevant executed regression files:** [motocross-air-drag.test.ts](../../../tests/motocross-air-drag.test.ts) (20 passed); [motocross-ballistic-timing.test.ts](../../../tests/motocross-ballistic-timing.test.ts) (13 passed).

Analytic and subdivision identities plus authoritative ridden/riderless free-flight consumers. This does not make the angular integrator exact.

### 04. [src/simulation/offroad/mx-ground-physics.ts](../../../src/simulation/offroad/mx-ground-physics.ts)

Apply physical tyre forces separately from an orthogonal rotation of forward/lateral velocity coordinates.

**Implementation/review:** 10; 30, 43 review. **Relevant executed regression files:** [motocross-ground-passivity.test.ts](../../../tests/motocross-ground-passivity.test.ts) (5 passed); [motocross-ground-physics.test.ts](../../../tests/motocross-ground-physics.test.ts) (13 passed); [motocross-player-dynamics.test.ts](../../../tests/motocross-player-dynamics.test.ts) (20 passed).

Zero-load world momentum and speed norm, supported-ground regressions and real player controls. No whole-vehicle conservation claim follows.

### 05. [src/simulation/offroad/ai.ts](../../../src/simulation/offroad/ai.ts)

Remove only the binary front-load eligibility cut from the existing geometric supercross shoulder guard.

**Implementation/review:** 40; 51 review. **Relevant executed regression files:** [motocross-shoulder-load-continuity.test.ts](../../../tests/motocross-shoulder-load-continuity.test.ts) (2 passed).

Sport/Raw continuity and benign-route assertions, then A52 complete eight-race revalidation. Geometry, support-scaled control formulas and crash/grip limits remain unchanged.

## Controller motion

### 06. [src/simulation/offroad/mx-rider-posture.ts](../../../src/simulation/offroad/mx-rider-posture.ts)

Smooth speed/lean/climb targets and analytically damped fixed-step standing, dab and automatic body position/rate.

**Implementation/review:** 8; root integration; 44 review. **Relevant executed regression files:** [motocross-posture-dynamics.test.ts](../../../tests/motocross-posture-dynamics.test.ts) (9 passed); [motocross-posture-transport.test.ts](../../../tests/motocross-posture-transport.test.ts) (15 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed); [motocross-collision.test.ts](../../../tests/motocross-collision.test.ts) (14 passed).

Bounded held/reversed targets, finite durations, source-to-snapshot derivatives, input-log resimulation and the actual planted-boot roll-moment consumer. The collision fixture seeds the authoritative posture controller; A48 independently reviewed that contract migration. Response frequencies are engine choices, not measured physiology.

### 07. [src/simulation/offroad/rider-weight.ts](../../../src/simulation/offroad/rider-weight.ts)

Use a local differentiable automatic/manual pose join and publish its exact tangent without changing finite physical rider momentum.

**Implementation/review:** 21; 23 consumer; 44 review. **Relevant executed regression files:** [motocross-rider-blending.test.ts](../../../tests/motocross-rider-blending.test.ts) (8 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-riding.test.ts](../../../tests/motocross-riding.test.ts) (27 passed).

Neutral/edge derivatives, manual authority, finite physical stroke and held-whip momentum. Does not establish anatomical acceleration limits.

### 08. [src/simulation/offroad/mx-gear-stroke.ts](../../../src/simulation/offroad/mx-gear-stroke.ts)

Carry accepted-event positions/rates; coordinate sleeve clearance; bound near-limit tangent continuation while preserving isolated strokes.

**Implementation/review:** 12, 20, 27, 44. **Relevant executed regression files:** [motocross-shift-continuity.test.ts](../../../tests/motocross-shift-continuity.test.ts) (5 passed); [motocross-interrupted-shift-contact.test.ts](../../../tests/motocross-interrupted-shift-contact.test.ts) (6 passed); [motocross-shift-extrema.test.ts](../../../tests/motocross-shift-extrema.test.ts) (9 passed); [motocross-control-animation.test.ts](../../../tests/motocross-control-animation.test.ts) (29 passed).

Legal interruptions, continuous joins, exact canonical-stroke values, near-extremum Float32 replay and actual boot/selector contact. A54 exercises 48 accepted input-driven shifts.

## Snapshot and common presentation

### 09. [src/simulation/protocol.ts](../../../src/simulation/protocol.ts)

Name optional posture/event slots and eligibility without changing protocol 17, header 24, stride 331 or the 33-float contact tail.

**Implementation/review:** 16, 23, 27; 41, 45, 51 review. **Relevant executed regression files:** [motocross-posture-transport.test.ts](../../../tests/motocross-posture-transport.test.ts) (15 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-foot-reconstruction.test.ts](../../../tests/motocross-foot-reconstruction.test.ts) (11 passed); [wheel-contact-recording.test.ts](../../../tests/wheel-contact-recording.test.ts) (10 passed); [session-identity.test.ts](../../../tests/session-identity.test.ts) (98 passed).

Actual writer/reader payloads, non-MX discrimination, compact recording and layout bounds. The local split clock does not repair global Float32 header time.

### 10. [src/simulation/wheel-contact-state.ts](../../../src/simulation/wheel-contact-state.ts)

Clear/write the existing contact block, serialize actual posture derivatives and full accepted-foot initial conditions with split clock.

**Implementation/review:** 16, 23, 27; 41, 45 review. **Relevant executed regression files:** [motocross-posture-transport.test.ts](../../../tests/motocross-posture-transport.test.ts) (15 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-foot-reconstruction.test.ts](../../../tests/motocross-foot-reconstruction.test.ts) (11 passed); [motocross-shift-extrema.test.ts](../../../tests/motocross-shift-extrema.test.ts) (9 passed); [wheel-contact-recording.test.ts](../../../tests/wheel-contact-recording.test.ts) (10 passed).

Actual Float32 writers, stale-buffer clearing, finite eligibility, idle metadata, arbitrary replay-page order and optional data preservation.

### 11. [src/rendering/offroad/mx-rider-pose.ts](../../../src/rendering/offroad/mx-rider-pose.ts)

Reconstruct bounded measured posture; decline unsafe body interpolation at flight/lifecycle boundaries.

**Implementation/review:** 16, 23; 45 review. **Relevant executed regression files:** [motocross-posture-transport.test.ts](../../../tests/motocross-posture-transport.test.ts) (15 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed).

Real controller reconstruction and invalid/legacy/reset paths, with A54 final scalar/rig consistency. No second render-time posture simulation is introduced.

### 12. [src/rendering/snapshot-interpolation.ts](../../../src/rendering/snapshot-interpolation.ts)

Route eligible posture fields through the shared reader with existing presentation/rider lifecycle gates.

**Implementation/review:** 16, 23; 45 review. **Relevant executed regression files:** [motocross-posture-transport.test.ts](../../../tests/motocross-posture-transport.test.ts) (15 passed); [motocross-body-transport.test.ts](../../../tests/motocross-body-transport.test.ts) (21 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed); [snapshot-interpolation.test.ts](../../../tests/snapshot-interpolation.test.ts) (20 passed).

Legacy and other-vehicle interpretation, placement/crash/remount/rewind holds and real recorded resimulation. A54 adds order/pause/detail probes.

### 13. [src/rendering/frame-state.ts](../../../src/rendering/frame-state.ts)

Sanitize optional motion on presented copies even at exact endpoints and held reset boundaries.

**Implementation/review:** 11, 27; 47 review. **Relevant executed regression files:** [motocross-motion-boundary.test.ts](../../../tests/motocross-motion-boundary.test.ts) (9 passed); [motocross-foot-reconstruction.test.ts](../../../tests/motocross-foot-reconstruction.test.ts) (11 passed); [motocross-foot-boundary.test.ts](../../../tests/motocross-foot-boundary.test.ts) (8 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed).

Endpoint, paused and interpolated malformed payloads cannot poison the shared displayed pose; original worker/replay buffers stay unchanged.

## Existing-rig readers and camera

### 14. [src/rendering/offroad/mx-foot-pose.ts](../../../src/rendering/offroad/mx-foot-pose.ts)

Share accepted-event trajectory reconstruction between real rig and PresentedFrame, with coherent complete-pose fallback and legacy release.

**Implementation/review:** 27, 31; 44, 45 review. **Relevant executed regression files:** [motocross-foot-reconstruction.test.ts](../../../tests/motocross-foot-reconstruction.test.ts) (11 passed); [motocross-foot-boundary.test.ts](../../../tests/motocross-foot-boundary.test.ts) (8 passed); [motocross-shift-extrema.test.ts](../../../tests/motocross-shift-extrema.test.ts) (9 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed).

Same-event and single-boundary reconstruction, missing/reset/invalid events, long local clocks, coordinated foot channels and unmarked rider edges. A54 verifies final playback order independence.

### 15. [src/rendering/offroad/mx-machine-pose.ts](../../../src/rendering/offroad/mx-machine-pose.ts)

Keep resolved joint reversals inside mechanical travel; validate marked flex as a complete block and write common wheel/joint/foot state.

**Implementation/review:** 11, 17, 27, 47; 32, 45 review. **Relevant executed regression files:** [motocross-joint-reversal.test.ts](../../../tests/motocross-joint-reversal.test.ts) (30 passed); [motocross-machine-animation.test.ts](../../../tests/motocross-machine-animation.test.ts) (5 passed); [motocross-motion-boundary.test.ts](../../../tests/motocross-motion-boundary.test.ts) (9 passed); [motocross-live-pose-coherence.test.ts](../../../tests/motocross-live-pose-coherence.test.ts) (8 passed).

Actual rebound extrema, control-hull bounds, finite out-of-envelope endpoints, legacy fallback and actual fork/wheel/swingarm matrices. A54 covers final cadence; it does not prove arbitrary inter-tick terrain accuracy.

### 16. [src/rendering/bike.ts](../../../src/rendering/bike.ts)

Replace exactly three foot-field reads and their imports; drive the existing authored rig from the shared recorded trajectory.

**Implementation/review:** 27; 32, 44, 47, 51 review. **Relevant executed regression files:** [motocross-foot-reconstruction.test.ts](../../../tests/motocross-foot-reconstruction.test.ts) (11 passed); [motocross-shift-extrema.test.ts](../../../tests/motocross-shift-extrema.test.ts) (9 passed); [motocross-live-pose-coherence.test.ts](../../../tests/motocross-live-pose-coherence.test.ts) (8 passed); [motocross-machine-animation.test.ts](../../../tests/motocross-machine-animation.test.ts) (5 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed).

Tests pose the actual models; A54 constructs 36,192 actual rig poses. A51 independently reverses only the permitted reader/import patch to reproduce the complete baseline file byte for byte.

### 17. [src/rendering/offroad/chase-camera.ts](../../../src/rendering/offroad/chase-camera.ts)

Integrate measured heading/roll/gaze ramps and use the current recorded flight origin across hidden touchdown/relaunch.

**Implementation/review:** 9, 24, 46. **Relevant executed regression files:** [motocross-camera-ramp.test.ts](../../../tests/motocross-camera-ramp.test.ts) (6 passed); [motocross-camera-motion-ramp.test.ts](../../../tests/motocross-camera-motion-ramp.test.ts) (15 passed); [motocross-camera-flight-origin.test.ts](../../../tests/motocross-camera-flight-origin.test.ts) (3 passed); [motocross-camera.test.ts](../../../tests/motocross-camera.test.ts) (16 passed).

Affine-response, angle wrap, held-time/discontinuity/reset/motion controls and the short-hop false-recoil regression. A54 camera positions are LOD probes and do not certify this stateful path.

## Deterministic identity

### 18. [src/core/session-identity.ts](../../../src/core/session-identity.ts)

Advance deterministic simulation identity from 39 to 40 while retaining the separate numeric protocol layout.

**Implementation/review:** Root; 41, 45, 53 review. **Relevant executed regression files:** [session-identity.test.ts](../../../tests/session-identity.test.ts) (98 passed); [wheel-contact-recording.test.ts](../../../tests/wheel-contact-recording.test.ts) (10 passed); [motocross-dynamics-replay.test.ts](../../../tests/motocross-dynamics-replay.test.ts) (10 passed).

Version-39 record/ghost/network separation across vehicle identities, block layout and compatible current replay behavior. Intentional global identity change is not a promise that every old record byte is equivalent.

## Adapter subcontracts that must remain separate

The large vehicle adapter is not treated as covered merely because the game can complete an AI race. Its independent-player, telemetry and lifecycle changes have different oracles.

| Adapter behavior | Direct contract exercised | Final regression evidence |
| --- | --- | --- |
| Incoming spring/damper state versus outgoing visible stroke | Physical force remains based on incoming compression; published fork/shock matches the final chassis/contact timestamp. | Dynamic-suspension, contact-traction and live-pose-coherence files. |
| Ridden/riderless unsupported flight | Gravity displacement and quadratic-drag travel/speed share an interval; unsupported wheels do not manufacture ground work. | Ballistic-timing, air-drag and player-dynamics files. |
| First-contact split and remainder | Record incoming event once, integrate supported remainder once, preserve rotor/pickup and world velocity across terrain-basis resampling. | Contact-time-coherence, wheel-pickup, riding and hard-stop-integration files; A48 independently observes the incoming event basis. |
| Supported stiff-stroke refinement | Refine local force work within the cap, preserve outer force telemetry and unchanged landing verdicts. | Supported-convergence and landing-observability files; ordinary 240 Hz trace comparisons are described in A28. |
| Posture controller ownership | Ground advances the complete automatic pose once; flight stance and body ownership are separate; finite manual motion remains independent. | Posture-dynamics, body/posture transport, rider-blending, riding and dynamics-replay files. |
| Placement/remount | Clear transient queued landing and forecast history and immediately synchronize actual wheel spin/load/compression. | Contact-reset and dynamic-suspension files. |
| Complete independent-player riding | Hold real inputs through original full-lap and adverse control paths without bypassing the player solver. | Forgiving-handling, riding and player-dynamics files; A36 causal regression evidence. |

The first-contact method refines an **endpoint sign bracket**. Thirty-two bisections do not prove the earliest crossing of arbitrary nonmonotonic terrain, nor detect every enter/exit feature with positive gaps at both ends. The supported method is capped at sixteen local stages over held terrain patches; it is not a general adaptive error-controlled integrator. These are model/algorithm limits, not omissions to conceal with a broad pass label.

## Test-oracle and compatibility review

[A48](agents/48-oracle-review.md) reviewed all nine changed existing test files. Its independent event observer improves the held-whip assertion rather than deriving the expected heading from the record under test. The fork-motion bound change is tied to the corrected timestamp, and the planted-foot fixture seeds the actual new controller state. This map does not claim that every historical numeric assertion stayed textually unchanged.

[A41](agents/41-recording-contract.md) retains a strict complete-tail oracle while allowing intentional idle event metadata. It does not exempt arbitrary bytes. [A45](agents/45-protocol-review.md) checks actual Float32 transport and malformed optional boundaries; the specific finite-flex endpoint defect it found is repaired and retested by [A47](agents/47-replay-boundaries.md). Protocol 17 and stride 331 remain unchanged, while simulation identity 40 intentionally separates earlier deterministic physics.

[A30](agents/30-scope-isolation.md) provides real non-MX comparisons and the legacy multiplication-order repair. Its measurements are historical scoped traces, not universal proof that every vehicle/mode record is byte-identical. MX road-practice placement telemetry and optional foot data remain deliberate exceptions; identity changes globally. [A51](agents/51-protected-scope.md) separately proves protected source/asset equality.

## Review gaps and remaining limits

No runtime file lacks an implementation/review owner or a directly relevant executed regression in this matrix. The independent source map found no additional production correction justified before publication. That conclusion does not convert the following limits into passes:

- Final-source browser acceptance **failed** in A50. The partial gameplay invocation lost its target after ten captures; the isolated diagnostic ended at the unchanged 20-minute limit while applying settings, before venue entry. Its GPU exits do not establish a cause. Earlier source acceptance, CPU rig checks and partial final gameplay are distinct evidence.
- Conservative spring work still uses a reduced torque geometry; the isolated correction was deliberately rejected in A18. Coupled stop passivity does not establish whole-vehicle conservation.
- The separate forward-only speed clamp can restore residual closure after the mathematically valid coupled solve. A26 records this consumer limitation.
- Unobserved within-tick terrain discontinuities, the reduced physical-contact versus literal mesh geometry, and global Float32 header precision limit reconstruction claims.
- A42's baseline/current comparison still contains four pre-existing failures in its 52-case scope. No global green-CI claim or unrelated asset repair is implied.

[ARCHITECTURE.md](ARCHITECTURE.md) defines the required contracts. [LIMITATIONS.md](LIMITATIONS.md) records their physical and evidential limits. The exact source publication and source-equivalent CI successor are independently verified by [A60](agents/60-publication-verification.md). Its [read-only verifier](evidence/60-verify-publication.py) checks the immutable published content without requiring a later CI/documentation index to equal the original code tree. Source publication remains separate from the later documentation commit and the failed native acceptance gate.
