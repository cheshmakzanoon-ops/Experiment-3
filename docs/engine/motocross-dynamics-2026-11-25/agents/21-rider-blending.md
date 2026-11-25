# Assignment 21 — Continuous automatic/manual rider blending

## Outcome and scope

`RiderWeight.pose()` now uses a bounded, monotone cubic Hermite join within manual travel `|x| < 0.15`. The previous mapping remains exact outside that interval. Neutral retains the automatic pose, full manual throws retain ±1 authority, and zero automatic pose retains the exact manual mapping. Added `poseRate(automatic, automaticRate = 0)` to expose the exact combined tangent for the subsequent snapshot transport assignment.

Only `src/simulation/offroad/rider-weight.ts`, the new `tests/motocross-rider-blending.test.ts`, and this report were changed by this assignment. No adapter, protocol, rendering/model, terrain, environment, material, spec, or asset changes were made. No commit or publication was performed.

The existing adapter advances nonzero manual stroke only for player MX250/MX450 on motocross/supercross courses. Neutral strokes remain exactly automatic, preserving the existing AI/supermoto path. The new tangent method is read-only; no caller is wired here.

## Evidence and choice of curve

The previous mapping was `f(a,x) = a + x - a|x|`. Its manual derivatives at neutral are `1+a` from the negative side and `1-a` from the positive side. Thus a continuous manual stroke with nonzero velocity gets a pose-rate jump of magnitude `2|a * xRate|`. This is a pose derivative corner, not a defect in the critically damped manual stroke itself.

The proposed full-range piecewise quadratic was evaluated. It is monotone and C1, with the desired neutral derivative `1-a²`, but changes the previous mapping by as much as **0.5 normalized pose units** at an opposing half-throw when `|a|=1`. At that extreme, the manual stroke needed to cross a neutral body pose moves from 0.5 to approximately 0.707. The local join avoids that broad control-response change.

For `ε = 0.15`, `s = sign(x)`, `m = 1-sa`, and `u = |x|/ε`, the implemented join is:

```text
|x| >= ε:  f = a + mx
|x| <  ε:  f = a + mx + am|x|(1-u)²
x = 0:    f = a exactly
```

The correction and its manual derivative vanish at ±ε. At neutral, both manual derivatives equal `1-a²`. For `b=sa`, the manual derivative inside the join is:

```text
f_x = (1-b) [1 + b(1-u)(1-3u)]
```

On `u∈[0,1]`, `(1-u)(1-3u)∈[-1/3,1]`. With `a∈[-1,1]`, this gives `0 <= f_x <= 8/3`. Combined with the unchanged endpoints ±1, the mapping is monotone and bounded without an output clamp. Its automatic derivative is also nonnegative:

```text
f_a = 1-|x| + (1-2b)|x|(1-u)²      inside the join
f_a = 1-|x|                       outside the join
f_a = 1                           at neutral
```

The join's automatic derivative is at least `1-2ε=0.7`. The maximum possible pose correction is `8ε/27 = 0.0444444444`; the maximum occurs at `|x|=ε/3` with opposing unit automatic pose. The same derivatives feed `poseRate = f_x * velocity + f_a * automaticRate`.

## Actual control traces

Both MX250 and MX450 were placed at Valley Ridge distance 35, braked at rest, held at a full manual throw for five seconds, then reversed for 0.6 seconds. The production automatic controller settled to `a=-0.55`; the real suspension and manual controller continued stepping. No physical pose, velocity, airborne flag, or contact state was fabricated. Both bikes remained riding, stationary and grounded, with zero crashes. Their pose traces matched at the precision shown.

The table measures the absolute difference between pose-speed secants immediately before and after the interval in which manual travel crosses zero. The mixed crossing interval is excluded. Units are normalized pose units per second.

| Manual reversal | Physics rate | Previous rate gap | New rate gap | Maximum pose change |
| --- | ---: | ---: | ---: | ---: |
| +1 → -1 | 120 Hz | 4.291857877 | 3.115708285 | 0.018944336 |
| +1 → -1 | 240 Hz | 4.196488078 | 1.322016324 | 0.018944336 |
| +1 → -1 | 480 Hz | 4.168911469 | 0.751275999 | 0.018944336 |
| -1 → +1 | 120 Hz | 3.988729003 | 2.634846976 | 0.018748874 |
| -1 → +1 | 240 Hz | 4.043916363 | 1.772252633 | 0.018748874 |
| -1 → +1 | 480 Hz | 4.092831067 | 0.893949947 | 0.018925735 |

The previous derivative gap persists as the timestep shrinks. The new sampled gap decreases, consistent with the C1 proof and independent one-sided derivative checks. At 480 Hz it is approximately 82.0% smaller for +1 → -1 and 78.2% smaller for -1 → +1. These finite secant gaps need not be zero: the continuous curve still has acceleration.

The deliberate tradeoff is briefly greater speed away from neutral within the join. At the 480 Hz sample points, exact tangent peaks change from **6.842558 to 7.311526** (+6.85%) in the +1 → -1 trace and **5.806104 to 6.434176** (+10.82%) in the reverse trace. The mapping is C1, not C2; acceleration can change at the join boundaries. It adds no time filter or state, and does not delay the underlying control.

## Physical invariants

`step()`, `position`, `velocity`, `displacement`, reset, and the existing finite airborne exchange are unchanged. Grounded weight transfer follows the slightly adjusted combined pose only inside the neutral join.

A dedicated regression launches each MX bike from the actual Ridge Table using ordinary approach inputs, then uses front/rear braking, throttle, and a forward/back/release manual sequence during 0.8 seconds of uninterrupted free flight. The test reruns this trajectory with only `pose()` replaced by the previous mapping. All recorded distance, horizontal position, height, vertical velocity, pitch, pitch rate, and front/rear wheel spin samples are exactly equal, while body poses measurably differ. This verifies that the visual/ground blend does not introduce perpetual airborne torque or change the finite manual momentum exchange.

The existing rider-weight regressions also retain their checks for grounded weight distribution, finite air correction/release, both MX bikes and assists, clean landings, AI/supermoto/neutral behavior, placement, takeover, timestep convergence, and deterministic replay. Existing traction assertions and thresholds were not edited by this assignment.

## Verification

Before the source change: **31/31** existing rider-weight and contact-traction tests passed.

After the source change: **39/39** tests passed across three files:

```text
./node_modules/.bin/vitest run tests/motocross-rider-blending.test.ts tests/motocross-rider-weight.test.ts tests/motocross-contact-traction.test.ts
```

The eight new cases cover exact neutral/end/outer behavior, bounded monotone behavior across 80,601 input pairs, maximum correction and manual slope, both one-sided rates at all three joins, finite differences of combined automatic/manual motion, real bidirectional reversals at 120/240/480 Hz on both bikes, and exact airborne physical equivalence.

Focused ESLint and whitespace verification passed:

```text
./node_modules/.bin/eslint src/simulation/offroad/rider-weight.ts tests/motocross-rider-blending.test.ts
git diff --check -- src/simulation/offroad/rider-weight.ts tests/motocross-rider-blending.test.ts
```

Full TypeScript checking remains with root as assigned. No visual/manual playtest or global handling improvement is claimed; evidence is restricted to the analytic contracts and exercised production trajectories. The snapshot owner must use `poseRate()` with the automatic controller's actual body rate to transport the new combined tangent.
