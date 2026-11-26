# Assignment 43 — takeoff and touchdown phase contracts

Wave 8; 25 November 2026.

## Result and scope

**All 59 tests in the two owned transition suites pass.** The unchanged
production candidate initially produced 16 failures and 43 passes in these
suites. The changes correct comparisons between different physical times;
they do not change production physics or loosen a tolerance.

Owned changes:

- `tests/motocross-slope-momentum.test.ts`
- `tests/motocross-landing-momentum.test.ts`
- This report.

The 24 real takeoff cases and 108 analytical sloping-touchdown combinations
remain. All other isolated transition, placement, handoff and legacy checks
remain intact. No model, character, material, authored environment, vehicle
definition, physical threshold, integration count or runtime source changed.
No child agents, git mutations, dependency installation or npm lifecycle
hooks were used.

## Why the old endpoint comparisons failed

Assignment 33 permits several complete physical intervals within one public
`step`. A transition can occur before that public call ends. Assignment 40
preserves ground-frame momentum between terrain samples, so the precise
transition interval can also differ from an older trajectory.

The original takeoff observer captured the incoming state immediately before
`vertical`, then compared it to the later public endpoint. Fourteen current
native approach cases included later airborne motion. Their horizontal
velocity differences, roughly 0.00071–0.00201 m/s, were consistent with real
quadratic air drag during those remaining intervals. Gravity and rotor motion
also continue over their actual elapsed time.

The original touchdown fixture starts with both tyres already overlapping a
compliant patch, so its first swept contact is exactly at time zero. That
contact preserves horizontal momentum, but subsequent ground intervals pick
up the stationary front wheel and change the overspeed rear wheel. The old
test compared those later wheel and world velocities with the initial event,
including a roughly 0.016 m/s horizontal difference in its first failing
example. Its rear-coast equation incorrectly used the whole public duration.

The preceding pre-assignment-40 candidate also failed this family: the parent
reported eight departure and two touchdown failures in its retained baseline.
My independently executed current-source baseline was **16 failed / 43 passed**.
These findings therefore distinguish historical oracle problems from a claim
that every observed difference was introduced by the latest runtime change.

## Takeoff: conversion, then actual free motion

The scoped observer captures both sides of the actual grounded-to-airborne
`vertical` transition and every complete physical interval. At the transition
it requires:

- Unchanged world horizontal velocity to the original 10-decimal precision.
- Correct conversion of along-slope storage to horizontal flight storage to
  11 decimal places.
- Exact unchanged front and rear rotor values across the conversion.
- Gravity acting for the actual local duration, and the matching recorded
  takeoff speed, to 11 decimal places.
- The corresponding kinetic-energy change accounted for solely by that
  gravitational velocity change.
- The existing greater-than-0.005-radian road/last-face discrepancy, keeping
  this a meaningful guard against using the wrong slope basis.

For each subsequent free interval, an independent analytic oracle evaluates
quadratic-drag speed and travel, lateral translation and the ballistic vertical
arc. It uses that physical interval's actual mass; fuel consumption can change
mass between complete intervals. It additionally checks:

- Both axles remain unloaded, with unchanged ballistic heading and slide.
- Gravitational potential plus kinetic-energy change equals independently
  computed nonpositive drag work.
- Front exponential coasting and rear angular impulse, with actual body and
  front-brake reaction ports accounted for separately.
- Air time advances by exactly the interval duration.
- The interval durations sum to the requested public duration, and the final
  state and public horizontal velocity match the resulting physical endpoint.

All eight 120 Hz native examples must actually contain later free intervals;
the ledger cannot pass by observing only the last public phase. The next
ordinary public flight call is checked the same way, starting from the current
endpoint and accounting for its own mass and subdivision.

Published body vertical velocity is a pose secant, including lean-height
motion. The test checks that secant directly. Physical CG `vy` is separately
checked against the gravity tangent; equating these two channels would create
a new incorrect oracle. Published pose, velocity and chassis state must be
finite.

## Touchdown: event momentum and later wheel pickup

Both motorcycles retain the full matrix of three grades, two cross-slopes,
three yaw angles and 120/240/480 Hz public updates. The existing sampled
analytical-plane fixture is unchanged.

The observer records the actual nested supported event, the completed
`firstFlightContact` call, and subsequent complete ground intervals. It
requires exactly one event, both event tyres, an exact time-zero timestamp,
and exact incoming position and physical velocity.

World horizontal momentum remains continuous through the supported boundary
and through first-contact completion to the original 10-decimal precision.
The first interval's front wheel remains stationary and its rear wheel coasts
by `2 × firstIntervalDuration`, to the original 12-decimal precision. The
rotor phase occurs before the swept contact search and advances once for the
containing physical interval; the observer does not mislabel that completed
rotor state as a historical time-zero rotor value.

Every subsequent ground interval must start and end grounded. With actual
front brake, rear brake, drive and engine braking all zero, each rotor obeys
the independent angular-impulse contract:

```text
inertia × (omegaAfter − omegaBefore) = −tyreFx × radius × duration
```

The front check uses the live tyre inertia and the rear check uses its real
rotor inertia. Both retain 11-decimal precision. The independently summed
front/rear longitudinal force impulses must equal each public mean force
times the public duration. Adjacent physical states are exactly continuous,
and the public endpoint equals the last physical endpoint.

At 120 Hz, multiple complete intervals and real front-wheel pickup are
required. The public call must still finish riding and grounded, without
projected hard contact or a crash, with exactly one landing and the original
greater-than-4 m/s normal-speed bound. Public velocity must match the current
physical endpoint and the body-height secant. Relevant motion, spring, load
and rotor values must all remain finite.

## Observation transparency

Four native Sport takeoff cases (both motorcycles and both venues at 120 Hz)
run an identical unobserved motorcycle through the complete ordinary approach.
Physical motion agrees exactly after every public call. Full comparisons at
departure, on the next free call and through 32 further updates include
dynamics, tyre state, rigid body, machine motion, fuel, gear, RPM, rider pose
and rate, pitch, yaw, suspension and support loads.

Two sloping/yawed 120 Hz landing cases independently compare observed and
unobserved machines at contact and for 32 subsequent ordinary updates. Their
future physical and latent state must agree exactly. The later severe-fixture
trajectory is not forced to stay riding; any natural evolution must be the
same with or without observation. Every observer restores its original
method in `finally`.

## Verification and fingerprints

Final focused run:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-slope-momentum.test.ts \
  tests/motocross-landing-momentum.test.ts --maxWorkers=1
```

**59/59 passed in 4.55 s**, with 48 slope/departure and 11 landing tests.
Log: `/home/agent/motobound-agent43-transitions.log`.
Initial baseline: `/home/agent/motobound-agent43-baseline.log`.

Strict targeted types and lint both exited zero:

```sh
node --max-old-space-size=512 node_modules/typescript/bin/tsc \
  --project test-results/agent43-tsconfig.json --pretty false
node node_modules/eslint/bin/eslint.js \
  tests/motocross-slope-momentum.test.ts \
  tests/motocross-landing-momentum.test.ts
```

The ignored typecheck configuration extends the repository's strict
configuration and includes only the two owned roots and their imports.
Type/lint logs are `/home/agent/motobound-agent43-types.log` and
`/home/agent/motobound-agent43-lint.log`. Scoped `git diff --check` is clean.

Production fingerprints before and after the owned verification:

| Runtime source | SHA256 |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |

These checks establish the two scoped transition contracts. They do not
substitute for the parent's broad integration suite, campaign acceptance,
rendered playability review or final publication.
