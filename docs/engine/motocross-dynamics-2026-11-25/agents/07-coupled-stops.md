# Assignment 07 — coupled suspension hard stops

Implemented a two-contact unilateral impact solve in `src/simulation/offroad/contact-impulse.ts`, with focused physical regressions in `tests/motocross-coupled-stops.test.ts`. The existing single-contact helper remains compatible. This assignment does not modify the vehicle adapter, geometry, models, assets, environments or git history.

## Behavior

`coupledHardStopImpulses(velocity, mass, pitchInertia, front?, rear?, yawInertia = Infinity)` returns `{ front, rear }` impulses. The velocity record contains `horizontal`, `vertical`, `pitchRate`, and optional `lateral`/`yawRate`. Each contact contains `grade`, `lever`, and optional `crossGrade`/`yawArm`. Omit a contact when its suspension has not reached the stop.

The solver evaluates the zero-, single- and simultaneous-contact active sets of `A = J M⁻¹ Jᵀ`. A contact initially separating can receive support only when the other axle's impact would otherwise push it closed. Redundant contacts share the response symmetrically. The Gram determinant is computed from squared minors and the simultaneous solve uses sum/difference coordinates, avoiding cancellation of the common vertical term for nearly coincident supports. No restitution or penetration-bias velocity is introduced.

The reproduced flat drop at −6 m/s now finishes with zero vertical and pitch speed. Its impulses sum to 1,104 N·s and have zero net pitch moment. The former front-then-rear pass leaves 3.6922068915 m/s of front closing velocity.

## Adapter integration

The coordinator owns `DirtBikeVehicle.vertical()`. In its projected-contact branch:

1. Build front/rear descriptors only where compression is at least the corresponding travel.
2. Use the current geometry levers `fa*cos + HF*sin` and `-ra*cos + HR*sin`, current slopes/cross slopes, and current yaw arms/rate/inertia.
3. Solve once from the incoming velocities.
4. Apply summed axle impulses: forward/lateral subtract grade/cross-grade impulse divided by mass; vertical adds total impulse divided by mass; pitch adds lever-weighted impulse divided by pitch inertia; yaw subtracts yaw-arm-weighted impulse divided by yaw inertia.
5. Preserve the existing airborne/grounded speed publication and compliant suspension path.

The helper is not considered live-game acceptance until that integration is completed and tested.

## Verification executed

- `npx vitest run tests/motocross-coupled-stops.test.ts tests/motocross-contact-impulse.test.ts`: **2 files / 8 tests passed**. New contracts reproduce the sequential defect; check absent/single/separating contacts; exercise a second contact activated by coupling; verify axle-order independence, complementarity and physical energy loss on banked/pitched impacts; and cover duplicate/near-coincident supports.
- `npx eslint src/simulation/offroad/contact-impulse.ts tests/motocross-coupled-stops.test.ts`: passed.
- A deterministic 10,000-case numerical probe varied velocities, grades, cross grades, pitch/yaw arms and near-coincident geometry. No nonfinite impulse, closing-speed residual above 1e−7 m/s, or kinetic-energy gain above 1e−7 J was observed. Maximum closing residual was **2.8866e−14 m/s**; maximum energy gain was **0 J**. This extra probe was a local diagnostic, not a checked-in benchmark or substitute for integrated vehicle scenarios.
- `git diff --check` on the owned production/test paths: passed.

No claim of real-bike calibration or browser acceptance is made by this contact-helper assignment.
