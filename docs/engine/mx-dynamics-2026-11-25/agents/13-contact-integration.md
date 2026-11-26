# Agent 13 — player MX contact integration and endpoint publication

## Status and ownership release

Implemented and verified the assigned local contact/publication changes. Root subsequently reported concurrently published upstream `main` at `39d9d497880e92801a7d77de6af2639b4186bfcc`, including overlapping impact/contact-time/endpoint work, and instructed this agent to finish the current tests/report and release ownership for reconciliation. This report records the local implementation as tested; it is **not** a claim that the upstream overlap has been merged or that all integration gates pass.

Files owned and changed by this task:

- `src/simulation/offroad/dirt-bike-vehicle.ts`
- `tests/motocross-contact-consistency.test.ts`
- `docs/engine/mx-dynamics-2026-11-25/agents/13-contact-integration.md`

The adapter already contained agent 07's landing-momentum change when this task began. That change is retained. No AI, ground solver, contact helper, models, characters, geometry, materials, environment, version, or existing test assertions were edited. No install, npm/package hook, commit, or push was run. Agent 16's separately requested Sport drive-reserve wiring has **not** been applied, following root's newer instruction to defer it until the upstream reconciliation.

## Implemented behavior

### Simultaneous projected stops for player MX

The projected-contact branch now uses agent 10's `coupledHardStopImpulses()` when `playerMotocross` is true. Front and rear records are both constructed from the same incoming travel-frame horizontal/lateral/vertical velocity, pitch rate, and yaw rate. Both bottomed contacts participate according to their actual compression after the existing deep-contact position correction. An initially separating bottomed contact is included because the other axle's impulse can make it close.

The returned front/rear impulses are summed into linear and angular momentum once. The existing scalar front-then-rear loop remains in the non-player branch. The outgoing yaw-state publication, existing speed-storage conversion, and agent 07's touchdown conversion remain in place.

Five instance-owned records hold the velocity, inertias, front/rear Jacobians, and result. The new solver path does not construct per-step contact objects, arrays, or result objects. The previously existing local slope/rate functions are unchanged.

### Mechanical travel at the integrated pose

For player MX, `compressionFront` and `compressionRear` are recalculated after the semi-implicit heave/pitch integration using the final `cgY` and bounded final `pitch`, then clamped to each axle's real travel. The equations use the same fixed free-wheel hard points and reference sag as the physical contact model.

The contact forces `FF/FR` still describe the forces actually integrated from the incoming compressed state and post-impact shaft velocities. They are **not** recomputed from the final presentation travel, added to the impulse, or applied a second time. Landing classification retains the incoming contact/compression information.

For a riding player MX bike, `fork` and `shock` now equal that endpoint travel directly. The additional 20 ms exponential travel filter is retained for the legacy path. The existing machine-motion rates and snapshot interpolation remain responsible for continuous motion between recorded endpoints; no renderer or model changes were needed.

## New invariant coverage

`tests/motocross-contact-consistency.test.ts` adds 16 cases, with internal sweeps over MX250/MX450, timestep, pitch, local terrain grade, and cross-grade.

- Finite adapter steps at 120, 240, and 480 Hz, independently recovering the instantaneous impact from the measured spring/gravity increment and pitch damping.
- Nonnegative impulses, nonclosing active stops, complementarity, normal linear/angular momentum balance, nonincreasing **impact** kinetic energy, and the inelastic impact-work identity.
- A realistic MX inertia case with an initially separating front stop on opposing local slopes, where both impulses must be positive. The flat helper example from report 10 does not activate both stops with the production MX inertia, so this test uses the actual definitions and a terrain configuration that does.
- Single front and single rear bottomed contacts; deep-contact displacement and release of the projected stroke when it returns within travel.
- Physical axle exchange, including unequal front/rear arms, springs, damping, travel and free lengths. The transformed final momentum is invariant to which physical contact occupies the front slot.
- Final-pose compression at extension, in-travel support, and the actual ±1.2 rad pitch bound.
- Explicit retention of the non-player scalar helper composition for MX250, MX450, and SM450.
- Full `Simulation.step()` and frame publication at 120, 240, and 480 Hz: suspension travel, tyre compression, worker snapshot values and final mechanical pose agree; tyre loads still publish the integrated numerical forces.
- Bounded continuous interpolation between the corrected endpoints, coherent wheel compression/length, exact endpoints, and immutable source snapshots.

The impact-energy assertions intentionally remove the separate compliant force step. Compressed springs can do work after impact; full-step kinetic energy alone is not a valid passivity test for the impulse solve.

## Verification results

Executed directly without package hooks:

```bash
node node_modules/vitest/vitest.mjs run tests/motocross-landing-momentum.test.ts tests/motocross-coupled-stops.test.ts tests/motocross-machine-animation.test.ts --maxWorkers=1
```

Result: **26/26 passed** across three files, including all 11 landing-momentum tests and all 10 coupled-stop helper tests.

```bash
node node_modules/vitest/vitest.mjs run tests/motocross-contact-consistency.test.ts tests/motocross-sprung-pose.test.ts tests/motocross-contact-traction.test.ts tests/motocross-machine-animation.test.ts --maxWorkers=1
```

Result: **62/63 passed** across four files:

| Suite | Result |
| --- | --- |
| New contact consistency | 16/16 passed |
| Existing sprung pose | 25/25 passed |
| Existing machine animation | 5/5 passed |
| Existing contact traction | 16/17 passed |

The single unchanged failure and the bounded-speed limitation below must be reconciled before treating this integration as complete. `git diff --check` passes for the owned production/test files.

`node node_modules/typescript/bin/tsc --noEmit` exhausted the Node process's default approximately 2 GB heap and exited 134, without reporting a TypeScript diagnostic. A successful full type check remains required after reconciliation; this attempt is not a type-check pass.

## Open integration issues

### Existing traction timing assertion assumes filtered travel

The existing test `makes a real forward body stroke support front-brake grip before the fork settles` checks:

```ts
expect(Math.abs(bike.fork - initialFork)).toBeLessThan(0.001);
```

It observes four 240 Hz brake steps, or 16.7 ms. With the actual final-pose travel published directly, the measured displacement is **0.0018160741371849587 m**. Its per-step tyre-force/load-budget assertions pass before reaching that condition. The failing value is a physical endpoint travel change exposed by removing the stale endpoint and extra filter; the test's `<1 mm` premise no longer follows from the requested publication semantics.

No existing assertion was changed. Root was notified, including the corrected four-step duration. The new direct endpoint contract and this existing filtered-travel assumption cannot both be asserted against `bike.fork` without a deliberate integration decision. Review the incoming upstream publication/test changes first; do not hide the disagreement by modifying springs or force budgets.

### Nonnegative forward-speed clamp can break the impact constraint

The helper's generalized-velocity solve is passive and complementary before the adapter's existing forward-speed clamp. The clamp is a separate actual bound that the new helper does not include.

A direct production-adapter diagnostic used MX450 at pitch zero, both axles 0.4 m past travel, mass from the definition, incoming horizontal speed 0.1 m/s, vertical speed −10 m/s, zero pitch/yaw/slide, `playerMotocross = true`, and `vertical(0)` to isolate impact from force integration:

| Local grade at both axles | Published forward speed | Vertical speed | Front/rear closing speed |
| --- | ---: | ---: | ---: |
| −0.5 | 4.079999999999999 m/s | −2.040000000000001 m/s | ≈1.33×10⁻¹⁵ m/s |
| +0.5 | 0 m/s | −1.959999999999999 m/s | 1.959999999999999 m/s |

On the uphill case, the unconstrained normal impact would reverse the horizontal velocity. The adapter retains the upward impulse but clamps that negative horizontal result to zero, so both stop rows close again. The clamp removes kinetic energy, but it does not preserve the contact complementarity guarantee. This is pre-existing bounded-coordinate behavior exposed by the integration audit, not a reason to apply the same normal impulses again as a force.

Root was notified before ownership release. A complete follow-up should include the no-reverse speed constraint in the same impact projection (or deliberately adopt a signed physical speed convention). With the current helper API, a rare active-bound branch could solve the remaining heave/lateral/pitch/yaw coordinates at fixed horizontal zero and then account for the speed-bound reaction; it must select that active set consistently and apply the final momentum only once. This was **not implemented** after root directed the agent to stop broadening and reconcile upstream first.

### Scope of endpoint contact geometry

The endpoint regression guarantees consistency with the adapter's existing reduced vertical wheel-gap equations at final `cgY/pitch`. It does not claim a new exact rigid multibody suspension geometry, change the renderer's raked fork/circular swingarm, or remove the pre-existing automatic rider-pose pitch term. Deep-contact correction retains the existing 15 mm compliant allowance; ordinary nonprojected bump-stop overtravel remains calibrated behavior.

Full ridden-lap failures are owned by the separate AI corridor/assist investigations. This task did not alter their assertions or reroute the AI physics path.
