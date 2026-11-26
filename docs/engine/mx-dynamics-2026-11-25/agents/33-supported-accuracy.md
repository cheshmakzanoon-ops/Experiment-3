# Assignment 33 — supported suspension accuracy and contact coupling

## Disposition

Retained the bounded player-MX contact refinement and event-aware supported midpoint solver. The original strict landing convergence test now passes without changing its 0.1 m/s overall error limit, 0.01 m/s fine-reference limit, 0.001 m/s normal-speed limit, outcomes, or no-fall assertions. The owned focused validation passes **100 tests in 7 suites**. Source and owned test pass focused ESLint and targeted strict TypeScript checks.

**Handoff is conditional on the campaign's independent contact-timestamp review:** five pre-existing assertions in three other landing/contact suites still reconstruct one physical interval from a now-refined public call. They are listed below and remain untouched. Assignment 39 is to distinguish observer migration from any real final-contact invariant regression. Assignment 37 independently owns the lifecycle/publication regression suite and the narrow outer mean-channel aggregation.

No models, character definitions, mesh assets, venue definitions, or authored terrain/environment definitions were edited. No git mutation, installation, npm lifecycle hook, or full-project typecheck was used.

## Changed files and ownership

- `src/simulation/offroad/dirt-bike-vehicle.ts`: assignment 33 adds bounded complete contact intervals; preserves public collision, launch debounce, automatic shift and pending-landing decision boundaries; integrates supported suspension at second order with bounded contact/full-travel event splits. Assignment 37 adds public mean tire force/power and gLong aggregation in the wrapper.
- `tests/motocross-supported-convergence.test.ts`: preserves the three existing tests and adds eight strict near-stop/deep-stop cases against independent fine RK4 reference equations.
- This report and [33-supported-accuracy-data.json](33-supported-accuracy-data.json): numerical evidence and explicit source hashes.

Baseline adapter SHA256: `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272`.

Retained adapter SHA256, including assignment 37's mean publication insertion: `02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4`.

The ground solver was held at assignment 32's accepted version throughout the final causal and paired comparisons; its hash is included in the evidence JSON.

## Result on identical airborne checkpoints

For each bike/venue, construct the same real 120 Hz approach, takeoff and airborne state using the baseline adapter. Then continue that exact checkpoint with either baseline or retained integration at 120, 240, 480, 960, 1920 and 3840 Hz. These are ordinary player controls, not AI-marked trajectories or prescribed touchdown states. The table reports the largest bottom-speed difference from each method's 3840 Hz reference.

| Bike / real jump | Baseline maximum error | Retained maximum error | Baseline spring calls at 120 Hz | Retained spring calls at 120 Hz |
| --- | ---: | ---: | ---: | ---: |
| MX250 / Valley RIDGE TABLE | 0.140211 m/s | 0.023581 m/s | 102 | 180 |
| MX250 / Arena TABLETOP | 0.188336 m/s | 0.029325 m/s | 181 | 231 |
| MX450 / Valley RIDGE TABLE | 0.150813 m/s | 0.019099 m/s | 101 | 179 |
| MX450 / Arena TABLETOP | 0.263418 m/s | 0.019306 m/s | 166 | 235 |

All 48 paired continuations remained ridden, produced zero falls, and recorded `bottomed`. Each paired method/cadence starts from the same checkpoint, so the improvement is not explained by a different takeoff. Spring-call counts are over the same defined post-checkpoint continuation window; they are force-evaluation counts, not claims of wall-clock speedup.

### Current complete production approach

A separate matrix generates the initial 120 Hz approach using the retained adapter itself, then varies only the continuation cadence. This guards against fixing an old trajectory while introducing a new difficult landing.

| Bike / real jump | Largest bottom-speed error | 1920→3840 Hz difference | 120 Hz spring calls | Largest complete intervals per 120 Hz call |
| --- | ---: | ---: | ---: | ---: |
| MX250 / Valley RIDGE TABLE | 0.017823 m/s | 0.000491 m/s | 184 | 3 |
| MX250 / Arena TABLETOP | 0.034551 m/s | 0.002793 m/s | 230 | 3 |
| MX450 / Valley RIDGE TABLE | 0.016985 m/s | 0.001638 m/s | 185 | 3 |
| MX450 / Arena TABLETOP | 0.014853 m/s | 0.001897 m/s | 220 | 3 |

All 24 continuations remain ridden with zero falls and `bottomed` outcomes. At 240 Hz these cases require at most two complete intervals; at 480 Hz and above they require one. The largest observed spring count in a single public call is 76, on the Arena MX250 path at 240 Hz; this includes the existing swept-contact/projection work as well as the supported force solve.

The existing dedicated Arena MX450 test uses a later, 1.3-second airborne checkpoint. Its original assertions remain unchanged and pass. The corresponding current-path isolation improved the coarse discrepancy from 0.155100 to 0.015145 m/s after restoring the automatic gear decision boundary, with a 1920→3840 Hz difference of 0.000596 m/s.

## Causal isolation

Three different effects mattered. Treating them as one spring-stiffness problem gave misleading results.

1. **Nonsmooth suspension branch activation.** A second tyre starts carrying damping at compression zero. The stiff bump damping activates at full travel. A high-order force preview that crosses either branch does not by itself locate the event accurately. Unsplit midpoint and RK4 could report worse bottom-speed convergence despite smoother pose integration.
2. **Outer tyre/suspension feedback.** Vertical-only refinement continued to use the outer longitudinal tyre force for pitch torque. The fast pickup of the second rotor therefore remained at the old outer cadence. From a bit-identical supported touchdown, event-aware midpoint alone retained a 0.145366 m/s error. Suppressing tyre pitch torque only in the diagnostic reduced this to 0.031273 m/s. Suppressing rider torque as well gave 0.031147 m/s. Suppressing terrain-rate terms left 0.145376 m/s. This nearly flat landing therefore identified tyre-pitch feedback, not held terrain sample phasing, as the remaining dominant error.
3. **Counted controller/lifecycle boundaries.** Refining the complete step initially caused automatic shift selection, launch debounce and pending-landing judgment to run at extra internal boundaries. These were not numerical spring errors and are now explicitly preserved at the original public-call boundary.

The final automatic-shift isolation was particularly clear. At 120 Hz an extra internal decision selected gear 2 during rotor pickup, cutting drive through compression; its longitudinal force was about 7 N. The middle/fine cadences remained in gear 3 through the peak and produced about 830 N. Bottom speeds split near 6.284 and 6.439 m/s. Restricting automatic gear selection to the original one decision per public call removed this split without changing spring constants, shift thresholds, or refinement constants. RPM, torque, and the cut clock still integrate over every physical interval.

### Rejected alternatives

- Tightening the original stiff-stop phase from 0.3 to 0.05 did not solve the real landing error.
- A vertical-only minimum 960 Hz step increased the early benchmark's spring evaluations from 173 to 520 while leaving about 0.143 m/s error.
- A first midpoint experiment appeared to reduce that early single-case error to 0.064 m/s, at 252 rather than 173 evaluations. It was rejected: predicted midpoint forces were incorrectly allowed to mutate the actual bottoming extremum, and the broader bike/venue matrix failed.
- Correctly unobserved midpoint previews still need event splits. Merely raising the order to RK4 did not resolve the discontinuous full-travel observation.
- Adding an elastic-force-change criterion increased work without materially improving the remaining outer feedback error.
- A fixed complete 960 Hz control was substantially more expensive than targeted contact refinement for comparable coarse accuracy.
- Complete refinement alone with 1/24 travel produced good coarse errors but left the existing fine-reference gate failing because the first-order supported integration was unchanged.
- Stronger final complete-step criteria, 1/16 and 1/24 travel, increased evaluations without a consistent improvement over 1/12 once the supported event integration was correct.

None of these exploratory alternatives was left in the production code.

## Retained numerical design

### Complete contact intervals

Only eligible, ridden player motocross on MX/SX uses the new refinement. An axle's estimated compression rate includes vertical chassis velocity, pitch motion, forward/cross-slope motion and contact yaw motion. The budget limits predicted shaft sweep to **1/12 of its travel**, with at most **8 complete intervals** per public call.

Already-supported motion is eligible. Free flight remains single unless the local clearance/rate/gravity forecast places a tyre near contact within the call. The existing swept first-tyre event still owns actual collision detection; the cheap forecast only selects work. Slow settled/braking calls remain single in the existing physical-force oracle tests.

Each complete interval refreshes tyre loads, rotor pickup, longitudinal/lateral/yaw state, suspension force, pose, posture and thermal work coherently. It does not reuse a frozen tyre pitch moment for an entire rapidly changing outer landing.

### Supported midpoint and branch events

The original supported travel/stop-phase criterion and **16-stage** limit remain. The same spring, regularized damper, bump stiffness, bump damping and calibrated reduced pitch arms are evaluated on the current state. On a supported non-projected player interval, a midpoint force evaluation advances both velocity and pose at second order.

Before entering positive compression or full travel, a local gap root ends the current interval at that branch boundary. Four event bits track the two axle contact onsets and two full-travel onsets. Each root uses 16 bounded bisections; the stage loop is capped at 16 and finishes its remaining time without introducing recursive adaptation. Existing first-flight contact handling is unchanged as a separate bounded event path.

A preview force may not publish `bottomPeak`. Only actual visited support states and the actual incoming-to-final full-travel crossing observation contribute to that extremum. This distinction prevents a predicted midpoint from falsely creating a harsher landing record.

The incoming force/compression publication inside `vertical()` remains intact. All force law and crash/bottoming thresholds remain intact. The free-flight, projected impulse and calibrated AI/supermoto/non-MX numerical branches retain their prior update equations.

### Work bound and measured cost

The new loops are bounded by 8 complete intervals and 16 supported stages per interval. A two-axle supported midpoint stage uses up to four spring evaluations, so the added supported work is bounded by 512 spring evaluations per public call, in addition to the separately bounded pre-existing contact projection/search work. Actual surveyed cases are far below this bound: at 120 Hz they use at most three complete intervals, and the worst public spring count over the current 24-case matrix is 76 at 240 Hz.

This is an accuracy improvement with a measured cost increase during rapid contact. It is not presented as a free performance improvement. Ordinary static/braking calls and fine-cadence calls keep the single complete-interval path.

## Public-call and publication contracts

- Absorb external collision impulses once, on the first physical interval.
- Consume an explicit shift edge once through the existing drive input path.
- Select an automatic gear once per public call; integrate RPM, engine torque and cut duration continuously on each interval.
- Spend at most one `freeSteps` launch-debounce increment per public call, while resetting it immediately when support returns. The existing counted threshold is unchanged.
- Judge a pending landing on the first physical interval only. A new touchdown can finish its first public-call compression before the next call judges pitch/crash severity.
- Advance clocks, fuel, heat, wear and physical animation over each interval exactly once. Assignment 37 checks this independently.
- The spring force/compression fields describe the **incoming state of the final physical interval** when refinement runs. They are not relabelled as public-call start values or averaged, because the next solve requires their physical phase. Unrefined ordinary braking keeps the existing public-start force timestamp.
- Public tire `fx`, `fy`, slip-power `energy`, and `gLong` are time means over the original public call. Assignment 37's equal-duration accumulation preserves their impulse/work meaning. Private force/power state and `dynamics.longitudinal` retain their final physical phase.
- Flexible modes evolve on every interval; published fork, shock and steering rates remain the endpoint pose difference divided by the public dt.

## Independent references and adverse states

The independent reference implements the current two-degree-of-freedom constitutive equations separately and integrates them with fine RK4. It intentionally retains the existing reduced pitch arms: this is a numerical integration check, not a claim to solve the work-conjugacy limitation identified by assignments 28 and 30.

Exploration covered 24 combinations: both bikes; equal axle compression 0.29, 0.2999, 0.3001 or 0.38 m; and initial vertical velocity −0.05, −8 or −25 m/s. The 16,384- versus 32,768-step references agree within 0.0001 m/s. All incoming force channels remained exact to numerical tolerance and all states remained finite. Maximum observed velocity error was 0.098776 m/s and position error 1.783 mm. The original 0.29 m/−8 m/s cases have velocity errors 0.038302 m/s for MX250 and 0.029710 m/s for MX450, versus the single incoming-force Euler errors of 4.291360 and 4.213877 m/s.

Eight near-stop/deep-stop cases are now permanent regressions in addition to the original two constitutive tests. They require <0.1 m/s velocity error, <2 mm position error (under 0.7% of travel), exact incoming force publication, finite state, a converged independent reference and at most 64 spring calls for the supported solve. The initial guessed 1 mm position budget was below the measured 1.1–1.2 mm near-stop error; the retained new budget is explicitly 2 mm. No pre-existing tolerance was weakened.

A separate retained-source public stress matrix covers both bikes at 120, 240, 480, 960 and 3840 Hz for slow near-stop release, an 8 m/s near-stop compression, a deeply compressed 25 m/s initial state, and a 12 m/s drop at 0.01 m/s road speed: **40 runs**. Every state stays finite. The deep-stop case reaches the intended eight-interval cap; it does not create a new cadence-specific fall. The severe drop produces exactly one `crash-flat` at every cadence for both bikes, retaining the adverse classification. The largest observed public spring count in this matrix is 72. These are prescribed diagnostic initial states, not descriptions of ordinary surveyed riding.

## Validation and pending independent review

Final owned focused command used installed Vitest directly with `--maxWorkers=1`, covering:

- Supported convergence and independent references: 11/11.
- Contact consistency: 20/20.
- Dynamic suspension timestamps and real jumps: 14/14.
- Player riding/flight control: 27/27.
- Landing challenge: 17/17.
- Ground passivity: 5/5.
- Per-contact work isolation: 6/6.

Total: **100/100**. Focused ESLint and a 512 MB strict TypeScript dependency-graph check of the adapter and owned test pass. The temporary TypeScript configuration lives under ignored `test-results/`; no compiler policy or dependency was changed.

The following five existing assertions remain unchanged for assignment 39's independent review:

| Suite / case | Observed mismatch | Review question |
| --- | --- | --- |
| final-contact-frame, MX250 bottomed continuing yaw | Reconstructed signed forward speed −0.07834094 m/s versus fixture requirement <−0.1 m/s | Does the reconstruction mix first-interval velocity and final-public heading, or did the final hard-contact invariant regress? |
| final-contact-frame, MX250 partial touchdown | Public heading delta −0.00719666518 versus first-interval prediction −0.00247129679 rad | Observe the same physical transaction and separately retain the final-public invariant. |
| final-contact-frame, MX450 partial touchdown | Public heading delta −0.00719654922 versus first-interval prediction −0.00247135802 rad | Same timestamp distinction. |
| landing-observability, stop before next pitch judgment | Final incoming compression 0.3 m versus first-interval requirement <0.3 m | The final internal incoming state may already be at full travel; verify the earlier actual crossing instead of weakening the physical bound. |
| landing-prediction, MX450 incoming impact | Recorded slope −0.0341842772 versus a NaN reconstruction from final-public support flags | The landed axle must be identified at actual contact, not inferred from a later unloaded endpoint. |

The broader campaign must not claim these suites pass until that independent review is complete. Assignment 37 also identified that an old public-endpoint rotor thermal estimate cannot stand in for summed interval work; its observer migration retains the existing 1e−7 J limit rather than loosening it.

## Remaining limits

The original reduced pitch moment arms and per-interval held terrain sampling remain. This work does not claim a fully work-conjugate articulated rigid-body suspension model, a new terrain constitutive law, or a solution to every route/low-speed control issue. Root's subsequent stable-source two-lap run reports both venues without falls, while an Arena low-speed stall remains a separate campaign task. No riding/crash threshold or authored course geometry was adjusted to obtain the convergence result.
