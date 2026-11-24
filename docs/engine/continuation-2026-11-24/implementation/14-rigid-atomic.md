# Agent 14 — failure-atomic rigid-body integration

Date: 2026-11-24. Assignment: wave 3, agent 14 of the continuation.

## Outcome

`RigidBody.integrate` now stages the entire candidate step and commits it only after the solver and finite-state checks succeed. Invalid initial position or velocity is rejected before calculation. A singular Jacobian, exhausted midpoint solve, or invalid candidate leaves the previously accepted public state unchanged.

Owned changes:

- `src/simulation/rigid.ts`
- `tests/rigid-atomic-step.test.ts` (new)

No models, character definitions, authored environments, vehicle tuning, tracks, assets, package files, or git refs were changed. The report is an intermediate handoff to the coordinator.

## Implementation decisions

Five reusable candidate vectors and one reusable quaternion hold position, velocity, angular velocity, acceleration, angular acceleration, and orientation. They are allocated with the body, and the successful integration path creates no new objects. All candidate arithmetic retains the original order. The final inertia transform uses the candidate orientation, reproducing the original inverse-rotation, component division, and world rotation without prematurely publishing the quaternion.

After validation, values are copied into the existing public vectors and quaternion. Callers retaining those object references continue to observe the same objects. Initial position and velocity use the same finite-vector predicate as the existing engine. Candidate checks additionally cover both derived acceleration vectors, including the extreme tiny-timestep case where angular acceleration overflows even though the pose itself is finite.

The solver retains its existing twelve-correction limit, tolerance, midpoint equations, rotor-endpoint coupling and Cayley rotation. The separate final-correction residual issue is deliberately unchanged for agent 18. No clamping, extra solver iterations, timestep policy, or normal-range dynamics changes were introduced.

This change adds fixed scratch storage and copy/check work to make failure semantics reliable; it does not claim an integration-speed or gameplay-FPS improvement.

## Regression evidence

The new suite contains 29 cases:

- Seventeen preflight rejection cases cover position, velocity, mass, inertia, force, torque, angular state, orientation, timesteps, and rotor endpoints.
- Seven candidate failure cases cover a genuinely singular Jacobian, bounded nonconvergence, position/velocity overflow, non-finite acceleration, derived angular-acceleration overflow, and quaternion overflow.
- Each rejection case first performs an accepted step, records every public state value and vector identity, retries the rejected call twice, then corrects the input and compares the next result with a fresh body. This checks dirty scratch recovery as well as immediate rollback semantics.
- A frozen baseline regression reproduces the previous partial translation after nonconvergence and verifies that the revised body does not advance.
- At 60, 120 and 240 Hz, 128 seeded initial states per rate each run sixteen successful steps: **6,144 exact step comparisons** against the frozen original implementation from `5edead7a44c8ccb5a187b22b750ce2bda7715128`. Cases vary full orientation, inertia, mass, forces, torques and rotor endpoints.
- A dedicated successful-step check preserves signed-zero arithmetic and public object identities. The seeded comparison also verifies that all existing vector/quaternion scratch objects retain their identities across repeated steps.

## Executed validation

All four selected suites passed: **68/68 tests** in 10.95 seconds.

| Suite | Passed |
|---|---:|
| `rigid-atomic-step.test.ts` | 29 |
| `physics.test.ts` | 21 |
| `wheel-momentum.test.ts` | 12 |
| `rotation.test.ts` | 6 |

The existing physics suite verifies identical seeded serialization and independence from rendering rates between 24 and 144 FPS. The existing wheel-momentum suite preserves its world-momentum and energy tolerances, changing rotor endpoints, and actual airborne Vehicle braking impulse.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/rigid-atomic-step.test.ts tests/wheel-momentum.test.ts tests/rotation.test.ts tests/physics.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/simulation/rigid.ts tests/rigid-atomic-step.test.ts
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/prettier --check src/simulation/rigid.ts tests/rigid-atomic-step.test.ts
```

Scoped ESLint, formatting and whitespace checks passed. No npm hooks, full-project compiler, full browser suite, or complete multi-mode determinism run was executed by this agent. Those broader integration gates remain with the coordinator.

Verified handoff hashes (before the separate agent-18 solver change):

| File | SHA-256 |
|---|---|
| `src/simulation/rigid.ts` | `975b4717d31482a84dccacf56ba3cce0d5f36dedb2d10fec0f1094bd9dd1e9b4` |
| `tests/rigid-atomic-step.test.ts` | `45b48f2b24cb2986c614cdedb532f840665b8c7694043e2929502c7e4feeb398` |
