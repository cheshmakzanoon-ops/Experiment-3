# Acceptance limits and remaining engineering work

## What this delivery establishes

The motocross changes improve the internal consistency of contact dynamics, physical-to-visible suspension timing, rider response, recorded motion and camera lifecycle. The accepted tests establish specific numerical and gameplay contracts. They do not turn the existing reduced motorcycle model into a validated multibody model, establish exact tyre contact on every terrain feature, or measure physical-GPU performance.

The published source commit is `39d9d497880e92801a7d77de6af2639b4186bfcc`, with accepted Git tree `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`. Assignment 57 independently read the underlying final result files and recomputed the counts below; it did not rerun the tests or add historical overlapping executions to them. The coordinator subsequently reconciled the terminal native outcome and actual code publication. The definitions of the source fingerprint, working-tree build and publication identity are in [BUILD_PROVENANCE.md](BUILD_PROVENANCE.md).

| Evidence | Supported statement | Boundary of that statement |
| --- | --- | --- |
| [A49 final combined units](agents/49-final-units.md) | 165 unique files and 1,836 passed assertions: 128 motocross files/1,278 cases plus 37 contract files/558 cases; no failed or other assertion statuses. | This is the selected acceptance suite, not all repository tests or global CI. Focused runs and local diagnostic cases overlap it and are not additional distinct tests. |
| [A52 final races](agents/52-final-races.md) | Eight two-lap cases, 96 finished entrant starts and 192 classified rider-laps; zero retirements, nine total crashes, at most one crash per rider per race, maximum stop 14.60 s. | These are AI-controlled races at the specified venues, seeds, weather selections and timestep. Finishing every race is not crash-free riding or exhaustive player acceptance. |
| [A52 calibration](agents/52-final-races.md) | Twenty configurations pass the unchanged runner's applicable checks: 17 clean and three allowed bottomed hold-speed outcomes, twenty successful rolling checks, twelve gap-window configurations with both short/long outcomes accepted. | The distance-ratio band excludes kickers. These are existing game-design checks, not measured real-bike calibration. Standing-start timings cover 60 metres; they are not 0–60 km/h times. |
| [A54 final display cadence](agents/54-final-cadence.md) | 93,936 matrix and 79,344 presented-field comparisons have zero measured difference across the prescribed playback queries; 36,192 actual rig poses, eight recordings and 48 accepted supplemental shifts are exercised. | Equal poses at common requested times establish CPU playback consistency. They do not establish zero error against unobserved physical events, GPU submission, display FPS or continuously perceived smoothness. |
| [Static gates and build](BUILD_PROVENANCE.md) | The complete TypeScript check, full lint plus the sole later test's focused lint, and product/full build pass on the accepted source. | The retained build has `commit: null` and an independently verified content fingerprint. It must not be relabelled as a postcommit build; the manifests are not a complete hermetic dependency-installation certificate. |

**Final native acceptance failed and remains open.** The completed A50 invocation on the final build failed with `page.evaluate: Target crashed` after ten captures. Its isolated unchanged diagnostic subsequently exited 1 at 20:42:04 UTC after 1,205.098 seconds, hitting the original 1,200,000 ms test timeout with `locator.click: Target crashed` during APPLY & SAVE. Low quality had been selected but not applied, and no venue/gameplay captures were reached. Two GPU-process exit-code-9 events were retained. All 1,734 captured inputs and 266 built files remained identical, and all test/browser processes ended. A37's earlier complete journey predates four final runtime edits. Neither that pass nor partial final-build screenshots supply a completed final-source journey. [A50](agents/50-final-native.md) and its [compact evidence](evidence/50-final-native.json) preserve all attempts; the diagnostic observations do not prove a production physics defect or an environmental cause.

## 1. Compliant suspension forces remain inconsistent with their gap geometry

The current [vertical solver](../../../src/simulation/offroad/dirt-bike-vehicle.ts) uses the signed axle arm `a`, free vertical offset `H`, chassis height `y`, pitch `θ` and terrain height `g` to obtain compression:

`c = g − y − a sin(θ) + H cos(θ)`.

Its gap-rate and hard-stop Jacobian use the complete pitch lever `a cos(θ) + H sin(θ)`. The compliant pitch moment still uses the shorter `a cos(θ)` lever. For front/rear forces `FF` and `FR`, the missing generalized moment is:

`Δτ = sin(θ) × (HF × FF + HR × FR)`.

The two offset terms do not cancel. For a spring potential defined from the current compression law, the isolated elastic power residual is `−Δτ × pitchRate`. The damping force also uses a compression rate and applied pitch lever that are not work-conjugate. Correct hard-stop impulses therefore do not prove conservative elastic work or passive damping for the complete compliant model.

[A18's controlled diagnostic](agents/18-spring-geometry.md) measured **+1.744832 J for MX250 and +1.839400 J for MX450** around a small closed heave/pitch loop; the complete geometric derivative reduced that local residual to approximately `1e−9 J`. Those are identified mechanism probes, not whole-vehicle energy totals or a new A57 simulation. The current source retains the same mismatch. [A43](agents/43-physics-review.md) and the final source inspection confirm the unchanged distinction between the complete contact Jacobian and the shortened compliant arm.

The torque-only counterfactual in A18 changed all eight of its previously successful sampled jump cases to rear crashes. That was an earlier source sensitivity experiment, not the final eight-race matrix and not a shipped fix. A safe correction requires a coordinated force/geometry choice, static equilibrium and reset placement, wheelie/loop-out behavior, rider/control response and jump acceptance. Changing only the torque expression or broadening the landing tolerances would not complete that work.

## 2. The forward-only speed representation can invalidate contact closure after a valid solve

The coupled solver produces generalized impulses satisfying its unilateral contact constraints. The adapter subsequently publishes forward travel with `Math.max(0, ...)`. If the mechanically resolved velocity points backward, that extra clipping can produce a new closing normal velocity even though the original coupled result was feasible.

[A26's controlled uphill example](agents/26-stop-integration.md) resolves to horizontal velocity **−2.6103646833 m/s** and vertical velocity **−1.4357005758 m/s**, tangent to the plane. Publishing zero horizontal speed leaves **+1.4357005758 m/s** of normal closure. This clipping removes kinetic energy; it does not create it. The final integration tests retain passivity and distinguish this representation limit from the unconstrained coupled solve. The current adapter still contains that publication step.

The ordinary coupled cases, near-redundant projection review and naturally reached impacts remain useful evidence. They cannot certify full complementarity after every downstream velocity constraint. A future correction needs an explicit decision about signed travel or inclusion of the forward-travel constraint in the same constrained solve, followed by hill, low-speed, recovery and mode-transition tests. Position projection, gravity and compliant forces also exchange energy outside the isolated impulse identity. [Independent projection review](agents/43-physics-review.md)

## 3. Contact search and supported refinement have bounded coverage

The ridden player path searches for initial supported overlap or an axle gap that starts positive and ends nonpositive. It then performs 32 bisections per crossing axle. A thin feature entered and left between two positive endpoint gaps is outside that detection contract. With a nonmonotonic gap containing multiple crossings, refining a sign-changing bracket alone also does not certify that the returned root is the earliest physical crossing. These are consequences of the current [search conditions](../../../src/simulation/offroad/dirt-bike-vehicle.ts), not newly measured tunnelling cases in this audit.

The real start, interior and exact-end contact tests establish correct timing, duration partition and single-update behavior for their fixtures. They do not establish general continuous collision detection over arbitrary terrain. The constant-gravity translation and constant-parameter quadratic drag step are analytic; the sampled, damped angular rule and complete vehicle trajectory are not thereby exact. [A25](agents/25-contact-time.md) · [A43](agents/43-physics-review.md)

Supported refinement refreshes the local heave/pitch spring, damper and stop forces. The terrain patch and outer controls remain sampled, and horizontal soil forces, rider controllers and the outer state machine are not all rerun internally. The one-sixth-stroke and 0.3-radian estimated stop-phase criteria are capped at sixteen stages. They bound work and improve the measured convergence case; they are not a local error certificate for arbitrary timesteps or an assurance of monotonic convergence at every intermediate resolution. [A28](agents/28-supported-accuracy.md)

Future work should test narrow and nonmonotonic terrain crossings explicitly, select a bounded sweep that can establish earliest contact over its declared geometry, and give coarse supported advances an error/coverage policy. It must retain consistent event timestamps and preserve the single rotor/control advance across any new partition.

## 4. Sparse recordings cannot recover every unrecorded physical transition

The shared readers make the scalar presentation and existing articulated rig agree on the pose being requested. That is different from knowing the true intervening physical pose from sparse endpoints. A54's zero cadence differences compare the same reconstruction at common requested times; they are not a zero-error comparison against a continuously observed physical trajectory.

[A32](agents/32-live-pose-coherence.md) measured average world-hub reconstruction errors of 0.723 mm from 30 Hz snapshots and 0.152 mm from 60 Hz snapshots on its eight moving traces, but its largest 30 Hz residual was **54.773 mm**. The diagnostic showed a **122.526 mm terrain-height change within one 8.33 ms physical step** that the publication interval did not locate. Interpolation spread that change before the observed step. These are named development-stage measurements, not a newly remeasured final-source maximum or a universal bound.

The final acceptance includes the current live-pose tests, and the consumers consistently apply the chosen reconstruction. It remains possible for sudden contact transitions, terrain discontinuities or commands absent from the retained interval metadata to be under-resolved. Additional event timing or denser snapshots can address that information gap; a smoother curve alone cannot infer missing events. Exact paused/seek poses do not establish perceptual quality on every display.

## 5. Reduced contact patches and the existing drawn wheels use different geometry

The force patch uses fixed horizontal CG-to-axle arms, while the drawing rotates the complete articulated hub offsets and applies its existing posture/crown root mapping. Consequently, a correctly published suspension stroke can still place the visible wheel differently from the reduced force-contact convention on a steep face.

The analytic rounded-tread support diagnostic in [A32](agents/32-live-pose-coherence.md) reported a worst terrain-height residual of **−364.167 mm** in its measured steep MX450/Arena trace. Its signed force-normal discrepancy was **−316.298 mm**, decomposed into **−311.568 mm** from the reduced-force versus articulated-wheel geometry and **−4.731 mm** from posture/crown mapping. This is a substantial modeling limitation, not a claim of acceptable exact tyre contact. It is also an analytic support calculation, not a GPU/triangle penetration measurement or the maximum on an independently rerun baseline trajectory.

The existing geometric conventions and authored model definitions were retained. [A51](agents/51-protected-scope.md) proves the protected bytes and modes are unchanged; it does not prove identical animated transforms or exact tyre/terrain agreement. Future engine work should reconcile contact sampling, gap geometry and the existing articulated wheel kinematics together, with independent graded-terrain contact tests. Altering protected meshes or merely filtering the displayed stroke would not resolve the physical mismatch under this task's scope.

## 6. Local foot timing does not extend the precision of the global replay clock

The split foot clock and relative event age preserve evaluation of a recorded stroke at a supplied interpolation fraction. The whole pose still uses the existing Float32 `H.TIME` header. The shared [presentation gate](../../../src/rendering/snapshot-interpolation.ts) holds the older pose when adjacent header timestamps are equal; a precise foot seed cannot override that whole-scene timing decision.

[A45](agents/45-protocol-review.md) tested controlled large time origins without simulating days of riding. At origins 131,072/262,144/524,288/1,048,576 seconds, repeated adjacent headers were observed at 120/60/30/15 Hz respectively. These are tested examples, not universal first-failure session durations. Header quantization changes interval widths before timestamps repeat, and higher publication rates can also repeat at the later origins.

Future long-session work needs a clock/recording contract such as a compatible time origin or higher-precision tick representation, with seek, pause, reset and old-record handling tested together. Optional marker-zero pose compatibility also does not imply compatible resimulation of old input journals: simulation identity intentionally advances to 40 while the snapshot protocol stays 17. Future incompatible changes to a marked trajectory evaluator must consider decoder compatibility even if its numeric payload stride stays unchanged. [Architecture](ARCHITECTURE.md) · [Protocol review](agents/45-protocol-review.md)

## 7. Preserve the distinctions between historical findings, final gates and unchanged scope

Historical reports intentionally retain their original source hashes and pending observations. A34's unit failures, A38's one failed race, A43's then-pending integration and A45's mudguard endpoint defect are not all current open defects: the final unit/race receipts and the A47 range-validation repair supply their later dispositions. Conversely, A18's rejected torque experiment did not become a production correction. [Checkpoints](CHECKPOINTS.md) · [A47](agents/47-replay-boundaries.md) · [A49](agents/49-final-units.md) · [A52](agents/52-final-races.md)

The final test contract is stronger than a claim that no assertion changed. Nine existing test files have reviewed contract migrations. For example, the old filtered-display initial-dive smoke bound changed from 1 mm to 3 mm because the published quantity became the physical endpoint; the independently observed endpoint movement was 1.816–1.985 mm. The independent force, geometry, friction, event-time and momentum oracles are the relevant justification. Do not describe every tolerance as unchanged. The physical crash/grip policy and protected specifications were retained. [A48's complete oracle review](agents/48-oracle-review.md)

The earlier scope matrix found nine exact non-MX physical traces, while two MX-on-road placement cases retained documented telemetry/optional-metadata differences. It did not exhaust every vehicle, mode or record. Likewise, the four changed final runtime files after A37 require current-source attribution; the earlier browser pass cannot be silently promoted to a later build. [A30](agents/30-scope-isolation.md) · [Build provenance](BUILD_PROVENANCE.md)

The unchanged four-file baseline CI comparison remains **48 passed / 4 failed out of 52** on both checkouts. Its failures concern the car-wing material expectation, fourteen GP rear-brake translation entries and two views of the GP-R1 catalogue/calibration hash mismatch. This establishes inherited status in that selected comparison. It is neither a green global run nor proof that these are the only possible failures in unselected tests. [A42](agents/42-baseline-ci.md)

## Priorities for a subsequent engine revision

These are proposed engineering tasks, not completed parts of this delivery. They preserve the current evidence rather than broadening claims beyond it.

| Priority | Work | Acceptance needed before a stronger claim |
| --- | --- | --- |
| 1 | Reconcile force/contact geometry, compliant generalized forces and static equilibrium. | Closed-loop/potential derivative and damper-power identities; independent static equilibrium; hill, takeoff, wheelie and landing gates with unchanged crash policies and explicit model scope. |
| 2 | Resolve forward-travel constraints inside a coherent impact/travel representation. | Joint momentum, passivity and post-publication closure, including the adverse uphill fixture, zero-time repetition and mode transitions. |
| 3 | Establish bounded earliest-contact coverage and a coarse-step accuracy policy. | Thin/multiple-crossing terrain cases; explicit work budget; sampled-versus-refined errors; unchanged duration, control and rotor accounting. |
| 4 | Improve event reconstruction and long-session time representation. | Physical event-time comparisons, large-clock headers and real recorder/seek/hold paths, plus explicit compatibility for existing records. |
| 5 | Resolve native-browser instability and measure actual graphics/perceptual behavior. | Preserved terminal diagnostic evidence and a completed final-source journey; then declared hardware/quality/load conditions and measured frame-time distributions. A process exit or host-memory correlation alone is not a cause diagnosis. |
| 6 | Calibrate against measured motorcycle/rider behavior if that level of realism is required. | External measurements with parameter identification, uncertainty and cross-validated riding cases. Current game-design bands and controller response constants do not supply that evidence. |
