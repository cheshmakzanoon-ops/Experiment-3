# Assignment 51 — Contact-stage observations and physically classified median recovery

Wave 9. **All 29 tests in the two owned suites pass.** This resolves the
seven failures identified by assignment 46 without changing production
physics, assist calibration, crash thresholds, approach inputs, or terrain.
The retained runtime fingerprint is
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`.

Owned files are `tests/motocross-hard-stop-integration.test.ts` and
`tests/motocross-collision.test.ts`. Machine-readable observations and test
identities are in [51-contact-contracts.json](../evidence/51-contact-contracts.json).

## Coupled stops belong to physical intervals

The old consumer test assumed one stop evaluation per public call. The
refined contact update performs two complete physical intervals in its flat
fixture. Between them, actual compliant spring, gravity, tyre and fuel work
advances. A second stop is therefore a new physical projection, not a second
application of the first impact.

The observer now records physical interval membership and captures the
contemporaneous body and dynamics mass at each solver call. It requires one
coupled solve in the initial interval, at most one per relevant interval,
and the original total public duration. Every observed impact is certified
independently against its own pre/post velocity, finite-difference geometry,
normal/forward constraints, impulse, kinetic-energy change and contact work.
The first impact still dissipates positive energy; later impacts cannot
reuse its state or mass.

The median failures were an exact mass-phase mismatch. Their first examples
were:

| Machine | Mass at the earlier impact | Later public-endpoint mass |
| --- | ---: | ---: |
| MX250 | 177.99991401255608 kg | 177.9999135958894 kg |
| MX450 | 184.49983629682907 kg | 184.49983444863014 kg |

Fuel changes between complete intervals. Comparing an earlier solver
argument to the later public state was invalid. The test still requires
exact equality to both live mass channels, sampled at the
impact itself.

All original physical tolerances remain: non-closing velocity at most
`2e-9 m/s`, linear momentum at eight decimal places, pitch momentum at six,
yaw momentum at eight, passivity within `1e-8 J`, and impact-work equality
at five decimal places. The axle-order, repeated zero-time, separating
contact, non-contact, forward-bound, AI and legacy supermoto/road cases are
retained.

## The unchanged median approach now has a different physical outcome

The original direct fixture remains a 10 m/s free placement, gear 2,
0.2 held throttle, the same Arena median, the same assists, five seconds,
and 240 Hz. Its original safety bounds still pass:

| Assist | Maximum CG height | Maximum absolute vertical speed | Retained physical result |
| --- | ---: | ---: | --- |
| Raw | 3.166230 m | 5.228038 m/s | One loop-out |
| Sport | 3.149032 m | 5.228094 m/s | Rider remains mounted |

The limits remain **6 m** and **9 m/s**, with finite final position, no
retirement, and no lingering airborne state.

An untouched upstream `2578271913c264f5ffd6131afea30723df14b65b`
source archive reproduces the former `crash-rear` outcomes. Its later
launch speed was 10.587961 m/s in Raw and 10.563833 m/s in Sport. The
integrated contact trajectory has corresponding takeoff speeds of
6.433395 and 6.339187 m/s. Both are below the unchanged 6.5 m/s rolling-hop
threshold, so the landing-pitch rule no longer supplies that crash. This
comparison establishes the changed trajectory and classification; it does
not attribute the whole change to a single isolated production patch.

Raw still incurs a real fall. At 1.8625 s, the front tyre carries zero load,
the rear carries 1,475.67 N, and pitch is still rotating backward at
0.728254 rad/s. An independently calculated CG projection is **0.642567 m
behind** the rear support. The retained test requires exactly one
`loop-out`, positive pitch rate, positive rear support and that negative
CG projection. It does not accept an arbitrary crash label.

Sport cuts the entire 0.2 throttle request and reaches rear-brake command
1. A diagnostic instance with **only the existing wheelie aid disabled**
then loops out once; no source or retained assist setting was modified.
The retained Sport test requires zero crashes, a mounted rider, no loop-out
event, and actual throttle-cut/rear-brake activity. The original hazardous
control input was preserved rather than replaced with an easier approach.

### Cadence limitation

The whole direct approach at 120 Hz still produces a rear-first crash in
both assists. The 240, 480 and 960 Hz direct runs consistently produce Raw
loop-out and Sport survival. This is an explicit native-approach sensitivity;
the test migration concerns the original 240 Hz fixture. It does not claim
identical crash classifications across all outer cadences or alter any
threshold to conceal the distinction.

## Keep both a safe replay and a real crash replay

The original logged case releases throttle at tick 48. With the current
physics it has zero crashes, and its deep-contact projection is still
observed at **tick 30**, with maximum correction **0.175159 m**. Both its
rewind frame and final replay frame reproduce exactly.

The same test now also covers held 0.2 throttle. The initial deep contact is
identical; the held case subsequently has exactly one loop-out at
1.854167 s. It too must reproduce both complete Float32 frames exactly.
The parameterized contract therefore requires exact **0 / 1** crash counts
for release / hold, retains the original control-release path, and includes
an actual current crash/recovery replay.

## Observer transparency and verification

Four parameterized transparency tests compare **2,592 selected unrounded
physical states** exactly: chassis motion, support/rotor/fuel channels and
body position/velocity. Observer methods are restored afterward. These are
CPU physics checks, not GPU rendering or complete-world serialization
claims.

The final distinct result is **29 / 29**: 12 hard-stop integration tests and
17 collision tests. Earlier diagnostic runs are not added to that total.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-hard-stop-integration.test.ts \
  tests/motocross-collision.test.ts --maxWorkers=1
```

Assignment 52 confirmed that strict TypeScript verification passes for both
released files and owns the final changed-file lint gate. No source, assets, authored environments, models, character
geometry, dependencies, Git index, commits or branches were changed by 51.
