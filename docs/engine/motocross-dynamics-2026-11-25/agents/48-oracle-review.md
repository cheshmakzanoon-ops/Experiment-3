# Assignment 48 — independent test and physical-oracle review

## Decision and ownership

**No blocking, unsupported relaxation of the existing crash, tyre-grip, landing-severity, or momentum checks was found.** This review examined every changed pre-existing test file against `b527a7e01ea247f0233a2ec4f2850639bafbd887`, then examined the major new physical oracles and their actual production consumers. Passing counts alone were not treated as evidence that the changed behavior was correct.

One nonblocking independence gap was found in the revised held-whip assertion: it derived its expected touchdown basis from the same recorded yaw that it intended to validate. With the coordinator's permission, this assignment strengthened only `tests/motocross-riding.test.ts` to observe the actual first-contact heading and yaw before the record is written. All 27 riding cases, focused ESLint, and the owned-file whitespace check passed. The test is frozen; its physical inputs and existing numerical limits are unchanged.

This assignment changed no production source, authored model, mesh, environment, terrain, vehicle specification, acceptance policy, git index, branch, or history. Its only repository writes are that explicitly authorized test improvement and this report. It spawned no agents. The final combined suite, browser acceptance, protected-scope checks, commit and publication belong to the coordinator and subsequent assignments.

## Exhaustive review of changed existing tests

The baseline comparison lists exactly the following nine existing test files. New files are assessed separately below.

| Existing test | Changed expectation or fixture | Retained protection and assessment |
| --- | --- | --- |
| `motocross-collision.test.ts` | The synthetic planted-foot fixture resets the new authoritative posture controller, then advances both comparison bikes through two matched ticks. Roll travel is the largest individual tick's increment. | The former write to the public `dab` mirror was overwritten by the controller and no longer established the intended fixture. Two ticks let the critically damped foot cross its existing support threshold. Foot placement, reduced lean rate, the original per-tick roll bound, angular/heave limits, and exact recovering/lifting comparisons remain. This is a support-law fixture, not a claim about every naturally driven foot-plant transition. |
| `motocross-contact-traction.test.ts` | Unloaded-front translation changes from bit equality to eight-digit agreement; short braking fork movement changes from 1 mm to 1% of fork travel, which is 3 mm for MX450. | Front load and front braking force still must be exactly zero on every unloaded tick. Rear-brake contrasts, manual-body grip ordering and every-tick friction ceilings remain. The fork measurement now describes physical outgoing geometry instead of its former 20 ms visual filter. The independent probe below verifies both distinctions. The 3 mm check is a local smoke bound; the separate geometric and constitutive checks provide the stronger physical contract. |
| `motocross-control-animation.test.ts` | An intermediate selector angle uses the authoritative recorded trajectory instead of a linear average of endpoint angles. | Original boot positions, clearance, lift, reset and opposite-foot invariance remain. Agreement with the controller is a consumer-consistency check; it does not independently establish that the controller itself is mechanically bounded. Canonical goldens, rate limits and unchanged actual-mesh clearance checks supply that different evidence. |
| `motocross-landing-prediction.test.ts` | Incoming speed, position, pitch and terrain normal are evaluated at the actual contact time rather than at the outer tick endpoint. A real overshoot fixture phases its contact step just before the observed crossing. | Independent analytic drag/gravity and terrain samples replace the obsolete Euler/endpoint oracle. Existing eight-digit comparisons and minimum normal impact remain. The overshoot retains its air-time, normal-speed, bottoming, nose-down, one-crash and `crash-front` assertions. Its timing adjustment is necessary to leave supported time inside the coarse tick after a swept contact; it does not lower the crash threshold. |
| `motocross-machine-animation.test.ts` | Unconditional endpoint monotonicity becomes mechanical travel bounds plus monotonicity where the measured endpoint rates have the same sign. | Opposed rates can describe a genuine interior reversal. The test now requires an observed real reversal and checks its error against intervening actual solver ticks. Both reversal and overall reconstruction still must improve on linear interpolation by the original 0.85 factor. Wheel-length and compression consistency remain. |
| `motocross-riding.test.ts` | Final body-frame slide and first-contact recorded lateral speed use their respective heading timestamps. This assignment additionally observes the first-contact basis independently. | The original normalized world-momentum cross-product limit of `1e-6`, held yaw and lateral-speed minima, forward-speed fraction, next-tick `crash-side`, and exactly one crash remain. The record projection still uses eight-digit agreement; the new yaw observation uses the same precision. |
| `motocross-wheel-pickup.test.ts` | Unsupported-flight expectations use analytic quadratic-drag speed/distance and constant-gravity displacement. | The 12-digit speed and 10-digit position precision and unsupported-force checks remain. The separate pickup convergence allowance stays 0.03 m/s. This changes the expected integrator, not its required numerical precision. |
| `session-identity.test.ts` | The expected simulation version changes from 39 to 40; version 39 is added to incompatible historical categories. | This strengthens separation of old input records from the changed physics. Protocol 17 and entrant stride 331 are unchanged. Unchanged vehicle/network hashes do not bypass the physics-version distinction. |
| `wheel-contact-recording.test.ts` | The complete 33-slot expected MX placement tail explicitly includes the legitimate foot marker and reset event. | Exact equality over all 33 slots remains. GPR1 remains all zero. Zero car mask, absent road tag, schema acceptance and all four neutral car readers are checked. Poisoned inherited car state and stale NaNs add isolation coverage; no arbitrary nonzero tail is accepted. |

The angular contact oracle still follows the engine's declared sampled, damped angular rule. It does not establish an exact continuous angular solution. Likewise, using published loaded-axle forces to select event normals is appropriate to the simple fixtures reviewed here; it is not a universal oracle for every complex multi-contact transition.

## Independent fork-travel and unloaded-front measurements

The task-local `contracts.mjs` probe reproduces the relevant contact-traction fixtures with the actual adapter, definitions, controls and track. It does not edit or substitute the force solver. Its before/after hashes show that all six selected input files remained unchanged during the measurement.

For braking, MX450 settles for 480 ticks at 240 Hz, then starts at 15 m/s in third gear with the same front-lever command as the existing test. The probe advances four ticks for manual body lean −1, 0 and +1. It independently computes outgoing geometric fork stroke and also evaluates the former 20 ms output filter against the observed incoming compression. The filtered value is diagnostic only and is never written back into physics.

| Manual lean | Actual outgoing fork movement | Former filtered movement on the same incoming compression | Maximum geometric residual | Excess above incoming tyre-friction budget |
| --- | ---: | ---: | ---: | ---: |
| −1 | 1.816075 mm | 0.586271 mm | Exactly 0 m | Exactly 0 N |
| 0 | 1.901647 mm | 0.599227 mm | Exactly 0 m | Exactly 0 N |
| +1 | 1.985174 mm | 0.611584 mm | Exactly 0 m | Exactly 0 N |

The old 1 mm assertion would therefore reject the correct current endpoint while accepting the delayed display value. The new 3 mm smoke bound is supported by a change in the quantity being published. Crucially, the separate 14-case dynamic-suspension suite independently checks outgoing geometry, incoming spring/damper forces and their different timestamps; the larger bound is not the only suspension oracle.

For unloaded-front braking, both MX bikes reach the real wheelie fixture after 84 throttle ticks. Coast and front-lever runs then advance four more ticks. Every sampled front load and front braking force remains **exactly zero**, with no crashes. Final differences are:

| Bike | Speed difference | X-position difference | Z-position difference |
| --- | ---: | ---: | ---: |
| MX250 | `6.218763282106465e-10` m/s | `4.035882739117369e-12` m | 0 m |
| MX450 | `1.829496554250909e-9` m/s | `1.0240874814826384e-9` m | 0 m |

Vitest's eight-digit absolute agreement bound here is `5e-9`, not `1e-8`. These are nanometre-scale differences in the coupled calculation, not evidence of a concealed front-contact force. The report does not describe them as literal machine epsilon. The exact force assertions retain the stronger protection against braking an unsupported tyre.

The probe exited zero with an empty failure list. These bounded diagnostic runs are not new Vitest cases and are not added to any integrated-suite test count.

## Held-whip oracle improvement

Before this assignment's test change, the revised record projection reconstructed touchdown heading as incoming travel heading plus `contact.yawError`. That correctly distinguished first contact from the end of the tick, but a correlated error in recorded yaw and recorded lateral speed could satisfy the assertion. The unchanged world-momentum direction check still protected the main physical invariant, so this was a test independence gap rather than a reproduced production defect.

The accepted test now wraps the real `vertical()` entry point and records heading, airborne yaw and boundary time only when the actual first-contact boundary is supplied. The wrapper immediately invokes the original method with exactly the same duration and boundary; it changes no input, state or returned result. `finally` restores the original method. The helper requires exactly one observation and exact equality with the landing record's event time.

The held-whip assertions then compare recorded yaw to observed yaw and project the real world velocity into the independently observed event heading. They also retain the separate final-heading projection into live `bike.slide`. Both timestamps are therefore checked without deriving the expected event basis from the record under test.

All existing physical controls, scenario durations, strict bounds and crash outcomes remain intact. The focused final result is **27 passed / 0 failed**. Focused ESLint and `git diff --check` also exit zero. The coordinator subsequently reported that its final TypeScript/lint gates passed on this frozen test; those are coordinator results, not additional executions by this assignment.

## Independence of the major new physical oracles

| New oracle group | Independent evidence reviewed | What it does not establish |
| --- | --- | --- |
| Dynamic suspension | Independently reconstructed free-wheel geometry, factory sag, actual endpoint pose, progressive spring and digressive damping equations. Real departure/landing traces cover both MX bikes, both venues and two rates. Wrong-timestamp force reconstruction must differ materially. | Exact mesh-to-terrain contact or a complete conservative multibody suspension. |
| Contact-time coherence | Actual first-contact observation, independently sampled tyre gaps and normals, analytic free flight, duration partition, single supported impulse and rotor update. Same-pickup-duration and same-elapsed-time comparisons retain the 0.03 m/s limit. | A general continuous sweep through arbitrarily thin features whose endpoint gaps are both positive. |
| Supported convergence | Real matched checkpoints across 120–3,840 Hz plus a separate fine RK4 reference using independently written constitutive equations on a controlled plane. The fine reference's own refinement and improved error against a single-force advance are checked. | Correction of the existing reduced spring torque geometry or an error certificate for every large timestep. |
| Coupled stops and real consumer | Unilateral/complementarity, energy, momentum, axle-order and nearly duplicate-row invariants; independently applied generalized impulses; actual consumer capture and finite-difference geometric Jacobians. | Full complementarity after a separate forward-only speed clamp, or whole-vehicle energy conservation after gravity, position projection and compliant forces. |
| Air drag and ballistic timing | Reciprocal speed and integrated distance identities, unequal subdivision, passivity, zero-drag limits, exact gravity and actual player/AI/riderless trajectories with zero airborne contact forces. | Overflow-safe arithmetic for arbitrary values near JavaScript's largest finite numbers, or exact continuously varying mass during a sampled fuel update. |
| Landing observability | Actual stage durations and independently reconstructed force bookkeeping for a real coarse overshoot; separating overlap does not gain a forecast impulse. Bottoming and severe-crash protections remain. | A standalone external physics reference. Stage bookkeeping complements, rather than replaces, the independent RK4 and momentum checks. |
| Player dynamics | Real control-driven positive and adverse scenarios, unchanged landing/crash policies, observed recovery and deterministic repeated traces. Higher-rate adverse cases preserve verdicts. | A complete-race or laboratory calibration certificate. |
| Shift extrema | Exact pre-fix canonical golden values, rate envelopes derived from travel and duration, mechanical bounds, continuity checks, actual Float32 writer/reader and existing-mesh clearance controls. | Biomechanical calibration or unlimited global replay-clock precision. Writer/reader agreement alone is consistency evidence because they share the evaluator. |

Assignment 43 supplies a genuinely separate coupled-stop oracle: mass-weighted projection using orthogonalized rows rather than the production Gram solve. Its 4,096 randomized cases, mass-scaling and axle-swap checks, 24 exact contact-boundary cases, and 120 unequal-drag-subdivision checks were reviewed as existing evidence. They were **not rerun or counted as this assignment's measurements**. The adapter hash used there matches the adapter hash measured here. The later AI repair changed the planner, not that adapter.

Assignment 44's nine new extrema tests demonstrably fail against its exact previous helper and pass after the bounded continuation repair, while existing assertions remain intact. Their golden trace protects 32,412 canonical values. Their independent rate and mechanical limits supply the physical protection that the changed control-animation consumer-agreement assertion cannot provide by itself.

The later integration reviews also retain meaningful negative controls. Assignment 40 repairs the AI's binary front-load eligibility without loosening full-grid crash limits. Assignment 46 reproduces a stale camera flight origin and adds three red/green cases without changing its older camera assertions. Assignment 47 validates the optional mudguard's existing finite displacement envelope; its malformed-frame regressions coexist with exact valid-motion before/after traces and unchanged machine-animation/joint-reversal tests. These are reviewed reports and receipts, not fresh executions or whole-source certifications by assignment 48.

## Coverage limits and acceptance boundary

The audit found no reason to request another production change or to reject the nine existing-test contract migrations. It also does not turn the engine into a calibrated full motorcycle dynamics model. The following limitations remain material and are already documented by their owners:

- Compliant pitch torque retains a reduced arm while gap rates and hard-stop Jacobians use the full geometric derivative. Impact passivity does not prove the entire compliant model is conservative.
- The forward-only speed publication can dissipate energy and can reintroduce closure after an otherwise valid coupled projection. Tests correctly separate that constraint from the unconstrained impulse solve.
- First-contact search requires the relevant initial overlap or endpoint-bracketed crossing. Supported force refresh uses sampled terrain and controls and caps its work at 16 stages; this is bounded computation, not arbitrary-step accuracy.
- Some fixtures deliberately isolate a mechanism: planted-foot initialization, controlled compression on a plane and coarse-step contact phasing are not substitutes for naturally driven full laps. Separate player, grid and browser evidence is needed.
- Preserving finite optional metadata and bounded CPU rig transforms does not certify every malformed primary snapshot, every continuous mesh contact, perceived animation quality, or physical-GPU performance.
- The split local foot clock does not eliminate the existing whole-chassis hold when adjacent Float32 header times become equal. Recorded evaluator compatibility remains an explicit concern for future incompatible decoder releases.

The final combined acceptance is intentionally left to the already scheduled integrated run. No duplicate broad test sweep was performed, and no full-suite pass is claimed by this report.

## Reproduction and exact reviewed versions

Task-local receipts are under `/workspace/scratch/e91efca799c8/validation/oracle-review-a48/`:

- `contracts.mjs` and `contracts.json`: independent fork/force and unloaded-front measurements, including selected before/after input hashes.
- `riding-final.json`: the actual final 27-case Vitest report.
- `acceptance.json`: owned test identity, command/result summary and probe failure list.
- `existing-tests.diff`: the exhaustive final diff of existing tests against the original baseline.
- `reviewed-inputs.json`: path-specific current SHA-256 hashes, baseline SHA-256 hashes for all nine existing tests, capture time and current HEAD.

Commands used by this assignment, without model-generation lifecycle hooks:

```sh
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/oracle-review-a48/contracts.mjs
node_modules/.bin/vitest run tests/motocross-riding.test.ts \
  --reporter=default --reporter=json \
  --outputFile=/workspace/scratch/e91efca799c8/validation/oracle-review-a48/riding-final.json
node_modules/.bin/eslint tests/motocross-riding.test.ts
git diff --check -- tests/motocross-riding.test.ts
```

At the path-manifest capture, HEAD was `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`, preserving the incoming CI-report commit. Reviewed task changes were still uncommitted. The versions below identify the actual reviewed inputs; they do not imply an atomic repository freeze while other assignments were finishing. All this assignment's validation processes have ended, and source/test ownership has been returned to the coordinator.

### Changed existing tests

| Reviewed path | SHA-256 |
| --- | --- |
| `tests/motocross-collision.test.ts` | `79633e0b9f15025a2df0fe9292ace1a46038534501ffae3654e04855fcfd2b71` |
| `tests/motocross-contact-traction.test.ts` | `b1164f229b06b52e9b8b1f20398d1c7e02db9a02c2fa7209cf0337efe9b2c958` |
| `tests/motocross-control-animation.test.ts` | `d0b4536f360f0be7dcc3a5646727b26c4a8f6641b48d49ada7aec97f07fe74c0` |
| `tests/motocross-landing-prediction.test.ts` | `c14c0b93cf40ed4f20a174d5126da9250a9c09d92e8bdc51c00a45b895d51dab` |
| `tests/motocross-machine-animation.test.ts` | `21e2a94c436375e34f623070e36df3f71bb8541b516025f71b06783fa09e6f88` |
| `tests/motocross-riding.test.ts` | `f1d51d886210baadd8a85dd5b3828178b4954efca4a85b9108a91080c980f468` |
| `tests/motocross-wheel-pickup.test.ts` | `941e2688b1b2d1c2e466e50bec76b3eb2a505ea2871f2cb0751f2caf15493fc5` |
| `tests/session-identity.test.ts` | `b67a9f6ecf288638e5b44d58e2205a6353cfa048a6cd683fe26709fb43f07b2c` |
| `tests/wheel-contact-recording.test.ts` | `81b0aa15de2f84b18c57d278235554d8f25f10ee46eb5c3116ffd20d9ec184f7` |

### Major new physical oracles

| Reviewed path | SHA-256 |
| --- | --- |
| `tests/motocross-dynamic-suspension.test.ts` | `1382e10b46d403b8ba5d208015983b1c8ed13111d6ccb78367afabdf8edb3207` |
| `tests/motocross-contact-time-coherence.test.ts` | `d72ff2eb23860efe58ee20e877cd83536ee7ad3ceb8f86b7fdc61d161d40243d` |
| `tests/motocross-supported-convergence.test.ts` | `2001116a772ad6fdfa1a014d065f8bcf2098a3e10b7562e9cc6b044909122138` |
| `tests/motocross-coupled-stops.test.ts` | `4abe5041e84fe3ba048a5be873279e6cfdd182bf08fda3787bd40327bae2b4ed` |
| `tests/motocross-hard-stop-integration.test.ts` | `0d746a093c3c2a0ea98f46a3754a9b737cf7780b63fec52255e96521b316c496` |
| `tests/motocross-air-drag.test.ts` | `1af97f2545defc68fa37ea527fe0cf6db990c54fc583ce45b3c9e13bdf3bf0cb` |
| `tests/motocross-ballistic-timing.test.ts` | `6300d40039ee9077d14ad54253bd231206fed8e5c1a9e50de07f887abcfd9d10` |
| `tests/motocross-landing-observability.test.ts` | `902757b3e337c52386c4568ca3d2cb7676e745cbffdcbd37fd413b56ebd66a46` |
| `tests/motocross-player-dynamics.test.ts` | `2759f5f1537e2b119de31ca7baced665f8dbefb43a1499b90e0c1f1aad4d81e1` |
| `tests/motocross-shift-extrema.test.ts` | `ce3f5ed0edc32e806509f2e34878d0f4f69f6cb562b2e32b85932e3a3a7cdecf` |

### Production sources used in the review

| Reviewed path | SHA-256 |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` |
| `src/simulation/offroad/contact-impulse.ts` | `7c33205a27a5e271ffc1569ca2785aac234e5f4165aa6fe1f920c783fdd685e6` |
| `src/simulation/offroad/air-drag.ts` | `f9b4ffcfe58372c08fb2dabfacdea4a94dfe63902a6232b6889e7dbc6384846d` |
| `src/simulation/offroad/mx-ground-physics.ts` | `f63a9f4389c27e191a8cd638774e7d5f2f35e60fd557d2285a9bdbbaab982c4d` |
| `src/simulation/offroad/suspension-geometry.ts` | `12fddb8870154e0a2ca5e833202c1796710274fc530ab28beb20de489befcf86` |
| `src/simulation/offroad/mx-rider-posture.ts` | `75974e3b93c60cb9f6574b99e8f6bf99280d76a625b5e44fcb06aa171795b6d6` |
| `src/simulation/offroad/rider-weight.ts` | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| `src/simulation/offroad/mx-gear-stroke.ts` | `b2d6e6f437835bc52e9f55c43a6ee9e073e552314f6b9ae82d3d06adbbd5f91f` |
| `src/simulation/offroad/ai.ts` | `c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e` |
| `src/simulation/wheel-contact-state.ts` | `a2e64a4b27d4d0d11c86697836e6487a616691a35bf8976cf866c60072a4077d` |
| `src/core/session-identity.ts` | `9c2873cd5420281e2d117242bb3a068a5e02be900543a590b6c5514d996d42d5` |
