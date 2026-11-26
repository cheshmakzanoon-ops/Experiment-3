# Agent 08 — front-contact handlebar steering authority

Date: 2026-11-25. Shared checkout baseline: `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.

## Change

Implemented the P1 unsupported-front steering defect from `02-traction-audit.md` in `src/simulation/offroad/mx-ground-physics.ts`.

The lean-coupled bar curvature is multiplied by a cubic smoothstep of current front load. The band runs from zero to 10% of the geometry-derived static front load, `mass * G * rearArm / wheelbase` (about 89 N for the audit fixture). Authority is exactly zero at zero/negative front support and exactly one at and above the band. The smoothstep has zero endpoint derivative, so pickup and unloading have no authority jump.

Only bar-derived rolling-path demand changes. Incoming yaw and sideslip still reach the tyre brush and yaw integrator. Rear drive/brake force and free-front rotor braking are unchanged. Existing front/rear combined-friction-circle clamps still bound the demand at each patch; no additional reserve multiplier or general steering rewrite was introduced. Cross-slope gravity is deferred to its separate wave.

## Regression evidence

Added `tests/motocross-front-steering-authority.test.ts` with 12 cases covering:

- Exact equality to straight coasting for both signs of steer at zero front support and `lean: 0`. The audit's previous +/-1273.760492 N rear force and +/-0.003605526756 rad heading change are now exactly zero.
- Mirrored steering/lean, monotonic pickup through the authority band, smooth endpoint approach, and restoration of the existing force distribution above the band.
- Exact full-result equality to a supported combined-braking fixture captured from the original solver before the production edit, including rotor work and contact-force channels.
- Front and rear combined-circle bounds through pickup under braking and initial yaw/sideslip.
- Retention of nonzero incoming yaw, rear-patch slip reduction, positive slip dissipation, and decreasing mechanical energy in both mirrored directions.
- Exact steer-independent rear drive/braking results with the front free, including its separate finite rotor response.
- Controls-only MX-250 and MX-450 wheelies: 84 acceleration ticks lift the front through the production suspension, then four 240 Hz ticks with either steering direction retain heading, lateral slip, and cross-track travel while front load stays exactly zero and actual handlebar angle changes. Initial pre-fix tests failed on both bikes (spurious heading changes approximately 0.001569 and 0.001353 rad). Longitudinal position is intentionally not required to be identical: steering intent can change roll and rear support even while it cannot create an unsupported-front path force.

Final focused run, without npm lifecycle hooks:

```sh
node_modules/.bin/vitest run tests/motocross-front-steering-authority.test.ts tests/motocross-ground-physics.test.ts tests/motocross-contact-traction.test.ts tests/motocross-cornering-reserve.test.ts tests/motocross-rider-weight.test.ts
```

Result: **5 files / 59 tests passed**. Existing contact-traction corner-entry/reversal and wheelie brake checks remain intact.

```sh
node_modules/.bin/vitest run tests/motocross-forgiving-handling.test.ts -t 'motocross low-speed balance|motocross grip-loss allowance'
```

Result: **16 tests passed**, the two separately investigated full-lap tests excluded by the filter. Whitespace/diff check passed.

## Integration gates still requiring follow-up

The unfiltered `motocross-forgiving-handling.test.ts` run in the shared checkout did **not** pass its two full ridden-lap assertions. Both this steering change and concurrent landing-momentum work were present. No existing lap assertion was changed.

| Shared-checkout configuration | Valley Ridge | Arena Nord |
| --- | --- | --- |
| Front authority enabled; current landing adapter | `crash-front`, s=612.2101, t=77.4583; later `grip-lowside`, s=362.6918, t=159.9625 | `crash-flat`, s=466.9213, t=133.8042 |
| Only the authority multiplication temporarily bypassed; current landing adapter | `grip-lowside`, s=580.8053, t=133.5958 | Pass |

The isolated comparison used the two ridden-lap tests directly. The authority multiplication was immediately restored, and the final 59-test run above verified the restored implementation. This comparison establishes an integration sensitivity and a Valley Ridge failure that remains without this change; it does not independently attribute every lap failure to either concurrent patch. Parent and adapter owner were notified for the next integration wave.

Owned changes are only the solver, the new steering test, and this report. No model, character, geometry, material, venue, environment, adapter, or rider-composition file was edited. No install, commit, push, or npm hook was run.
