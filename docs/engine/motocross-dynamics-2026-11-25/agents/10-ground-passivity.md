# Assignment 10 — passive yaw coordinates

## Change

`src/simulation/offroad/mx-ground-physics.ts` now separates actual tyre/drag/grade acceleration from the rotation of the chassis coordinate frame. After applying the physical impulses and advancing yaw rate, it rotates the forward/lateral velocity pair by the same yaw increment used for heading.

The former explicit update of `(+yawRate*lateralSpeed, -yawRate*speed)` increases the squared speed by an order-`dt²` term even when both wheels carry zero load. An orthogonal rotation preserves that norm and preserves world velocity when no external translational force acts.

The existing supported camber-steering increment remains separate: it deliberately bends the rolling path. Tyre stiffness, contact substep frequency, force averaging, yaw damping, actuator limits, brake heating, and vehicle tuning remain unchanged. The existing forward-only speed constraint is retained. If a freely yawing body rotates past sideways, that unilateral constraint may remove energy; this patch does not introduce signed reverse driving.

## Reproduction and result

The audited unloaded case has mass 184 kg, initial forward/lateral speed 20/10 m/s, yaw rate 2 rad/s, no drag or tyre forces, and 120 calls at `dt=1/120` s.

| Observation | Baseline | Candidate |
| --- | ---: | ---: |
| Initial translational energy | 46,000 J | 46,000 J |
| Energy after one second | 46,215.162546 J | 46,000.000000000284 J |
| Final world velocity X/Z | Not invariant | 9.999999999999986 / 20.00000000000008 m/s |
| Integrated displacement X/Z | Not invariant | 10.000000000000012 / 20.000000000000068 m |

The baseline energy was reproduced by the coordinator before implementation. Candidate measurements were executed against the modified production module; they are numerical checks, not real-bike measurements.

## Verification

Executed:

```sh
npx vitest run tests/motocross-ground-passivity.test.ts tests/motocross-ground-physics.test.ts tests/motocross-thermal.test.ts
npx eslint src/simulation/offroad/mx-ground-physics.ts tests/motocross-ground-passivity.test.ts
git diff --check -- src/simulation/offroad/mx-ground-physics.ts tests/motocross-ground-passivity.test.ts
```

All **21 tests across three files passed**, including five new physical-invariant regressions. Coverage includes free world momentum and displacement, both yaw directions and the leaned adapter, passive behavior at the forward-only stop, loaded tyre/yaw/wheel energy with force budgets, and identical results when subdividing at the same contact cadence. Lint and whitespace checks passed.

The existing ground and thermal contracts passed unchanged. Broader integrated motocross acceptance remains the coordinator's responsibility. No adapter, model, geometry, environment, asset, or other-mode source was edited by this assignment. No git mutations were performed.
