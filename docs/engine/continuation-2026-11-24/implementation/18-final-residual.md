# Agent 18 — accept a converged final Newton correction

Date: 2026-11-24. Assignment: wave 3, agent 18 of the continuation.

## Outcome

`RigidBody.integrate` now evaluates the residual after its twelfth permitted Newton correction before declaring nonconvergence. The same three scalar residual expressions and the same strict tolerance comparison are used. No thirteenth correction is taken. Ordinary earlier convergence skips the additional branch entirely.

Owned changes:

- `src/simulation/rigid.ts`: one scalar final-residual branch immediately before the existing nonconvergence error.
- `tests/rigid-final-correction.test.ts`: ten focused cases.

The candidate-state staging from agent 14 is preserved. Removing only the new branch reproduces agent 14's handoff source SHA-256 exactly: `975b4717d31482a84dccacf56ba3cce0d5f36dedb2d10fec0f1094bd9dd1e9b4`.

No solver tolerance, correction limit, timestep policy, successful Newton arithmetic, rotor coupling, Cayley rotation, vehicle tuning, model, character, authored environment, asset, package, or git ref was changed. The branch uses scalar locals and introduces no allocations or new persistent state.

## Reproduced defect and numerical evidence

Before editing, the exact audit fixture still threw `Rigid-body midpoint solve did not converge`: default inertia `[510, 1220, 1080]`, timestep `1/240`, initial angular velocity `[s, 0.7*s, 0.3*s]`, with `s = 986939.7654675277`.

Its initial residual and the following eleven residual evaluations remained outside tolerance. The last residual tested by the old code was `0.00013616331852972507`. After correction twelve, the residual is `1.30385160446167e-8`, below the unchanged tolerance `0.0000019738795309350553`. The previous implementation rejected that untested, already-converged candidate.

The revised code accepts the twelfth correction. Three additional variants using a constant rotor, changing rotor endpoints, or external torque also first satisfy the existing tolerance at this final correction. Tests observe the existing residual norm reductions without replacing solver arithmetic: all twelve preceding residuals fail the tolerance, and the thirteenth evaluation accepts the result of correction twelve.

An independent residual oracle reconstructs the drift endpoints from public world-space state, removes the final torque kick and rotor exchange, and forms the gyrostat equation using the vector cross product `(I*m + h) cross m`. Its reconstruction check permits a factor of two solely for world/body transformation and expression-grouping roundoff at the extreme angular speed. The actual solver acceptance is separately asserted against the original, unscaled strict tolerance.

Reversing all three initial angular-velocity components produces a final residual of approximately `0.00406268192455`, still outside tolerance. It remains rejected after twelve corrections with public state unchanged. A converged final angular correction paired with overflowing translation also remains rejected atomically; correcting that input then matches a fresh body's result exactly.

These are extreme numerical regression fixtures. They establish solver termination semantics, not the prevalence of such spins in gameplay, physical fidelity at those speeds, or a gameplay performance improvement.

## Executed validation

All three selected suites passed: **51/51 tests** in 2.50 seconds.

| Suite | Passed |
|---|---:|
| `rigid-final-correction.test.ts` | 10 |
| `rigid-atomic-step.test.ts` | 29 |
| `wheel-momentum.test.ts` | 12 |

The ten new cases cover four final-correction acceptance variants; genuine remaining nonconvergence; invalid translation after final angular convergence and a successful retry; singular/non-finite Jacobians; immediate convergence with one residual evaluation; and ordinary rotor exchange with three residual evaluations and no extra work after early convergence.

The atomic-step suite re-ran all **6,144 exact successful-step comparisons** against the frozen original solver, alongside its failure-state and identity checks. The existing wheel-momentum suite retained its world-momentum and relative-energy tolerances, changing rotor endpoints, and production airborne-vehicle braking test.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/rigid-final-correction.test.ts tests/rigid-atomic-step.test.ts tests/wheel-momentum.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/simulation/rigid.ts tests/rigid-final-correction.test.ts
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/prettier --write src/simulation/rigid.ts tests/rigid-final-correction.test.ts
```

Scoped ESLint passed. Prettier left the production file unchanged and formatted the new test. Source-only checksum verification confirms that all agent-14 changes survived intact. No npm hooks, full-project typecheck, browser suite, commit or push was run by this agent; broader integration validation remains with the coordinator.

## Verified handoff hashes

| File | SHA-256 |
|---|---|
| `src/simulation/rigid.ts` | `eb0caeec3e61745282a3b1fbde6950f7fa64fcfe8ea0072626fdeb95ab41324a` |
| `tests/rigid-final-correction.test.ts` | `deb8702ca9c372d339ea0323ea5bbf3a31329affc1c881b9761a7db33b98fe5d` |
