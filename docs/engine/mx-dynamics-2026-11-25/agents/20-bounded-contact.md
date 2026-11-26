# Agent 20 — reconciled coupled-stop invariants and forward-bound projection

Date: 2026-11-25. Wave 4. Work began against root's reconciled local checkpoint `61434f1`.

## Delivered and ready for adapter integration

- Kept the upstream positional `coupledHardStopImpulses()` API, optional velocity/contact components, default `yawInertia = Infinity`, and numerical kernel.
- Added an optional reusable result as argument 7 and exported its `HardStopImpulses` type.
- Adapted the earlier assignment's ten stronger invariant tests to that API in `tests/motocross-coupled-invariants.test.ts`.
- Added `boundedHardStopImpulses()`, which solves the two unilateral normal stops and one nonnegative-forward-speed constraint in the same generalized mass metric. The bound can use an arbitrary horizontal axis so it can refer to the actual final tyre frame after yaw.
- Added thirteen bounded-stop tests, including 1,600 seeded impacts and the exact uphill reclosure from reports 13/17.

Files owned and changed:

- `src/simulation/offroad/contact-impulse.ts`
- `tests/motocross-coupled-invariants.test.ts`
- `tests/motocross-bounded-stops.test.ts`
- This report.

The upstream `tests/motocross-coupled-stops.test.ts` is retained unchanged. The adapter is owned by root and was not edited here. No model, environment, authored vehicle specification, routing, git operation, package lifecycle hook or full-project type check was changed or run by this task.

## Reconciliation evidence

After adapting only the copied test API and adding output reuse, the upstream kernel passed all ten strong invariants, its five existing tests and the three scalar-helper tests: **18/18 passed**. In particular, the near-redundant rows, passive impact-work identity, horizontal frame rotation and 1,200 seeded physical impacts passed. There was no evidence requiring replacement of its squared-minor determinant and sum/difference solve, so that kernel was retained.

The original scalar `hardStopImpulse()` and `landingNormalSpeed()` implementations are unchanged. Existing callers of the coupled helper receive the same two result properties and use the same six arguments. The bounded projection is opt-in; it does not silently change AI or supermoto callers.

## Exact public API

```ts
interface HardStopImpulses {
  front: number;
  rear: number;
}

function coupledHardStopImpulses(
  velocity: Readonly<HardStopVelocity>,
  mass: number,
  pitchInertia: number,
  front?: Readonly<HardStopContact>,
  rear?: Readonly<HardStopContact>,
  yawInertia?: number, // defaults to Infinity
  out?: HardStopImpulses,
): HardStopImpulses;

interface HardStopForwardAxis {
  horizontal: number;
  lateral?: number;
}

interface BoundedHardStopImpulses extends HardStopImpulses {
  forward: number;
}

function boundedHardStopImpulses(
  velocity: Readonly<HardStopVelocity>,
  mass: number,
  pitchInertia: number,
  front?: Readonly<HardStopContact>,
  rear?: Readonly<HardStopContact>,
  yawInertia?: number, // defaults to Infinity
  forwardAxis?: Readonly<HardStopForwardAxis>,
  out?: BoundedHardStopImpulses,
): BoundedHardStopImpulses;
```

All listed interfaces/functions are exported. `HardStopVelocity` and `HardStopContact` retain the upstream optional lateral/yaw/cross-grade/yaw-arm fields, which default to zero. Missing contacts use `undefined`, preserving the positional API rather than restoring the old inertia-object/null contract.

The new axis defaults to `(1, 0)` and is normalized internally. A finite nonzero axis is required; a zero or nonfinite direction throws `RangeError`. The returned `forward` is the nonnegative **linear impulse along that unit axis, in N s**. It is not a normal impulse, speed, torque, or force. When the bound is inactive it is zero and the normal impulses are exactly those of the existing helper.

Both helpers overwrite and return a supplied `out`, including absent and separating cases. Output reuse avoids result allocation. The rare active-bound branch currently creates small reduced velocity/contact records for the common kernel; it is not claimed to be an entirely allocation-free path. Inputs and the axis are not mutated.

## Solve and momentum accounting

Use generalized velocity `v = [horizontal, lateral, vertical, pitchRate, yawRate]` and mass `M = diag(m, m, m, Ip, Iy)`. Each normal row is the existing

```text
Ji = [-grade_i, -crossGrade_i, 1, lever_i, -yawArm_i].
```

For normalized horizontal direction `b = (bx, bz)`, the forward bound is the third unilateral row

```text
B = [bx, bz, 0, 0, 0],   B v_after >= 0.
```

The algorithm uses fixed work, with at most three active constraints:

1. Solve the two normal contacts with the existing exact small active-set kernel.
2. If that projected velocity already satisfies the forward bound, return it with zero bound reaction.
3. Otherwise set the bound's outgoing coordinate to zero, rotate the remaining horizontal coordinate perpendicular to the bound and solve the two reduced normal contacts with the same kernel.
4. Recover the forward reaction from momentum and validate that it is nonnegative.

For step 3, the perpendicular input speed is `-bz * horizontal + bx * lateral`. Each reduced contact has `grade = 0` and `crossGrade = -bz * grade + bx * crossGrade`; vertical, pitch and yaw values/inertias are unchanged. This removes the along-bound mobility, rather than imposing a clamp after a solve that still relied on that mobility.

Let `u = bx * incomingHorizontal + bz * incomingLateral` and `gi = bx * grade_i + bz * crossGrade_i`. The recovered bound impulse is

```text
qBound = gf * qFront + gr * qRear - m * u.
```

A genuinely negative recovered reaction rejects that active set with `RangeError`; roundoff at zero is tolerated and rounded to zero. Tests independently verify the nonnegative reaction, all constraint residuals and complementarity.

The complete generalized momentum increment is:

```ts
horizontal += (bx * q.forward - gfOriginal * q.front - grOriginal * q.rear) / m;
lateral += (bz * q.forward - sfOriginal * q.front - srOriginal * q.rear) / m;
vertical += (q.front + q.rear) / m;
pitchRate += (lf * q.front + lr * q.rear) / pitchInertia;
yawRate -= (yf * q.front + yr * q.rear) / yawInertia;
```

Here `gfOriginal/grOriginal` and `sfOriginal/srOriginal` are the original forward and cross-grade coefficients in the same incoming frame. Missing contacts contribute zero. Apply the summed momentum once to the common incoming state.

The passive impact-work identity includes the bound:

```text
E_before - E_after = 0.5 * (qFront * closingFront + qRear * closingRear - qBound * u).
```

The bound reaction may oppose the work done by the normal reactions, so omitting its term is incorrect. This identity applies to the instantaneous combined impact; subsequent spring, gravity, rider and damping work remain separate.

### Evidenced numerical boundary and its fix

A dedicated added test exposed a degenerate active-set boundary in the first wrapper version. Two contact rows with identical cross-grade/pitch/yaw components but different forward grades become identical after the bound coordinate is eliminated. The normal-only solver returned a physically valid zero forward velocity rounded to `-2.220446049250313e-16 m/s`. Entering the active-bound branch at that rounded zero selected a different nonunique axle-impulse split and recovered a negative bound multiplier.

The wrapper now retains the existing normal-only active set within a scale-aware `64 * Number.EPSILON` velocity tolerance. This is a floating-point activity test based on incoming/projected momentum terms, independent of timestep or iteration count. Finite penetration speeds still take the active-bound solve. The explicit reduced-duplicate test covers zero, small and large bound reactions, while the reaction-sign guard remains in place. The upstream two-contact kernel was not altered to fix this wrapper issue.

## Adapter integration plan

### Current travel frame

For an already grounded player MX step, use the default axis and replace only the opted-in coupled call with `boundedHardStopImpulses()`. In the common momentum sum, add `q.forward / m` to `vh`. Preserve the same bottomed-contact selection, masses, pitch and yaw arms, incoming velocity and post-impact yaw publication. Both normal contact rows must be selected by bottoming, including an initially separating one.

The final `vh` must be the same value used for damper-rate calculations and storage conversion. A storage `Math.max(0, ...)` may remove floating-point signed zero; it must not discard a finite negative normal-only velocity while retaining incompatible vertical/pitch impulses.

The demonstrated production numbers are resolved as follows:

| Incoming/common grade | Normal-only horizontal | Normal-only vertical | Post-clamp contact closure | Combined bounded horizontal/vertical | Bound impulse divided by mass |
| --- | ---: | ---: | ---: | ---: | ---: |
| `horizontal=0.1`, `vertical=-10`, grade `+0.5` | −3.92 | −1.96 | 1.96 | 0 / 0 | 4.9 |
| Same input, grade `−0.5` | 4.08 | −2.04 | Approximately zero | 4.08 / −2.04 | 0 |

The uphill combined total normal impulse is `10 * m`, with the front/rear split balancing pitch; it is not the old normal-only impulse followed by an independent horizontal clip.

### Touchdown yaw and later partial-interval yaw

`landingTyreVelocity(h, lateral, yaw)` stores forward speed `cos(yaw) * h + sin(yaw) * lateral`. Therefore a solve still expressed in the incoming travel frame must pass `{ horizontal: Math.cos(yaw), lateral: Math.sin(yaw) }` to constrain that **final** forward coordinate. Add the returned bound momentum to both incoming horizontal components, then perform the orthogonal storage rotation. Do not first clamp the old frame's horizontal coordinate; the arbitrary-axis solve constrains the final frame, not both frames simultaneously.

Alternatively, perform the orthogonal velocity rotation first, transform the contact grades/cross-grades into that same new frame, and call the helper with its default axis. These are equivalent and the frame-rotation test covers that equivalence.

Upstream also rotates the tyre basis by `mxYawRate * remaining` after the supported partial interval. That angle depends on the evolved state. A bound solved only against the earlier touchdown frame cannot guarantee nonnegative speed in this later frame. At that actual storage boundary, root must either preserve signed intermediate velocity until the final combined projection, or perform another physically current combined projection using the bottomed contacts, mass metric and geometry at that boundary. The latter accounts for a new active speed bound after actual yaw/support evolution; it should not repeat an earlier normal impulse unconditionally. The sampled contact rows, current pitch/yaw arms and velocity must all refer to that same boundary/frame.

Whole-adapter `vertical(0)` and final-publication checks remain root's integration acceptance. This task establishes the reusable combined projection and its final-frame contract; it does not claim the adapter has already adopted it.

## Verification

Executed directly without package hooks:

```bash
node node_modules/vitest/vitest.mjs run tests/motocross-bounded-stops.test.ts tests/motocross-coupled-invariants.test.ts tests/motocross-coupled-stops.test.ts tests/motocross-contact-impulse.test.ts --maxWorkers=1
```

Final result: **4 files passed, 31 tests passed**. The last complete run took 1.97 seconds. Coverage includes:

- Zero, no-contact, separating, either isolated axle, both active, initially separating/activated and initially closing/unloaded active sets.
- Exact uphill clamp reproduction and downhill/nonbinding controls.
- Nonnegative reaction/normal impulses, nonclosing contacts, complementarity, full momentum, energy loss and impact work including the bound.
- Cross-grade, pitch, yaw momentum, a yawed final storage frame, axis normalization and horizontal frame rotation.
- Exact duplicates, nearly redundant contacts down to `1e-12`, and contacts that become duplicates only after bound activation.
- Contact-order symmetry, immutable inputs, optional component defaults, valid infinite yaw inertia and reusable output clearing.
- The retained upstream five cases, 1,200 existing seeded normal-contact cases and 1,600 new seeded bounded cases.

A focused strict type check of the owned helper and two owned test files passed:

```bash
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --strict --target ES2022 --moduleResolution Bundler --module ESNext --allowImportingTsExtensions src/simulation/offroad/contact-impulse.ts tests/motocross-coupled-invariants.test.ts tests/motocross-bounded-stops.test.ts
```

The three source/test files have final newlines and no trailing whitespace. A full-project type check, whole-vehicle integration tests and full motocross/race gates remain the integration owner's responsibility.
