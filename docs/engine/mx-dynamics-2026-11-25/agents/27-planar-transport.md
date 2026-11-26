# Agent 27 — player MX planar transport

Date: 2026-11-25. Wave 5. Checkout: `/home/agent/motobound-579b454ae846`.

## Release and ownership

**Production ownership released to root.** All 16 new planar-transport tests
pass. The selected ground, slope, contact, gravity, steering-authority and
drive-budget suites pass. Two existing body-transport assertions still fail
on exactly the same floating-point residuals with and without this change;
the isolated baseline evidence is recorded below. No assertion was loosened.

Owned edits are limited to:

- `src/simulation/offroad/mx-ground-physics.ts`: the optional
  `MxGroundParameters.forwardProjection` field and the two microstep
  displacement accumulations.
- `src/simulation/offroad/dirt-bike-vehicle.ts`: the matching solver argument
  and the final ground-displacement cosine block.
- `tests/motocross-planar-transport.test.ts`: the new 16-case suite.
- This report.

Agent 25 released the shared source after its two-lap diagnostic before any
production edit by this agent. Its actuator-budget flag and torque fields
remain untouched. Agent 22's lateral-gravity implementation, all forces and
momenta, rotor work, models, characters, assets, surfaces, course geometry,
venues, materials and vehicle specifications remain outside this change.
Only narrow `apply_patch` source edits were used. No package installation,
npm hook, full TypeScript build or git mutation was run.

## Defect and formula

The grounded player stores forward speed `u` along the sampled road pitch,
but stores slide `w` in horizontal metres per second. With heading `theta`,
the horizontal forward and left unit vectors are

```text
forward(theta) = (sin(theta), cos(theta))
left(theta)    = (cos(theta), -sin(theta))
c             = cos(roadPitch)
worldVelocity = c * u * forward(theta) + w * left(theta)
```

`writeBody()` already publishes that velocity. The old ground integrator
instead accumulated `h * (u * forward + w * left)` and the adapter multiplied
the entire resulting displacement by `c`. The resulting motion shortened
the already-horizontal slide by the same cosine. At unchanged heading, the
missing horizontal distance was `(1 - c) * w * dt` along the left axis.

For a grade of 0.6, `c = 1 / sqrt(1 + 0.6^2) = 0.8574929257`. A 3 m/s
slide therefore lost approximately 0.42752 m/s of horizontal travel, although
the published body velocity still contained the full 3 m/s slide.

Before the production patch, the new real public-step test failed for both
MX250 and MX450, in Raw and Sport. With a one-microsecond step, it measured
`4.2752875875019417e-7` m error for MX250 and
`4.275287629317979e-7` m for MX450. The post-change test requires both the
incoming-velocity and published-endpoint-velocity comparisons to stay below
`2e-10` m over the same step and passes all grade, heading and slide signs.

## Correction

The solver accepts an optional `forwardProjection`. Each existing
semi-implicit contact microstep now transports

```text
planarSpeed = speed * (forwardProjection ?? 1)
dx += h * (sin(heading) * planarSpeed + cos(heading) * lateralSpeed)
dz += h * (cos(heading) * planarSpeed - sin(heading) * lateralSpeed)
```

The adapter supplies `cos(roadPitch)` only at its player-MX ground solve. The
projection is applied after the existing yaw-coordinate rotation and camber
heading update, so each displacement uses that microstep's actual heading.
Projecting only an outer-step endpoint direction would lose this information
in a turning slide.

The adapter no longer performs the subsequent whole-vector cosine when the
MX ground solve ran. It retains the original cosine block if `mxGround` is
false or the shared core changed out of the riding state before the MX solve
could run. This distinction also preserves the core's fallback path on a
fall transition.

The optional factor defaults to one. Omission, explicit `undefined`, explicit
one and both signs of zero pitch have exactly equal complete solver results.
An explicit factor of zero deliberately removes only forward displacement;
it does not mean zero pitch and does not erase slide or change stored speed.

## Boundary audit

### Yaw and camber

The existing exact yaw rotation of speed/slide, yaw acceleration/damping,
leaned-cone camber force and camber yaw remain unchanged. Only the spatial
readout after those updates is projected. The new oracle obtains physical
states from independent one-microstep force solves and integrates the
represented world velocity itself; it never uses returned `dx`/`dz` as its
spatial expectation. Both yaw signs, steered and leaned/unleaned cases,
mirrored grades, arbitrary headings, and signed slide are covered.

### Flight, departure and touchdown

Already-airborne motion skips the ground branch. It continues to use
horizontal `flightSpeed`, its existing quadratic-drag distance and separate
horizontal slide. Chassis whip remains separate from the travel heading.
The new tests check the analytical flight displacement and endpoint velocity
over either grade while the chassis yaws. Existing slope/departure and
contact-time suites also pass unchanged. No departure conversion, touchdown
impulse, swept-contact calculation or flight continuation was edited.

### AI, supermoto and other courses

These callers do not enter the dedicated player-MX solve. The legacy core
still gets its original forward cosine followed by its separately integrated
slide. Tests observe the actual core endpoint in real public steps and require
exact equality with that original arithmetic for AI MX250, AI MX450, SM450
on an MX course, MX250 on Aurel and MX450 on Kestrel RX. Those checks passed
before and after the patch.

## Verification

All test commands used the local executable directly, with one worker:

```sh
node_modules/.bin/vitest run tests/motocross-planar-transport.test.ts --maxWorkers 1 --minWorkers 1
```

Result: **16/16 passed**. The cases include:

- Analytical coasting with zero/positive forward speed and negative/zero/
  positive slide, five headings and five mirrored grades; no acceleration,
  invented contact heat or extra kinetic energy.
- Exact default/zero-pitch compatibility.
- Independent integration of yawed and cambered microstep world velocities.
- Thirty-step exact equality of every non-displacement result under braking,
  driven spin, drag, slope and both cross-gravity directions. This covers
  acceleration, both contact-force records, yaw, rotor speeds, brake work,
  lateral-gravity work and mechanical energy.
- Both bikes and both aids on analytical planes through real public `step()`
  calls, including ordinary 120/240/480 Hz tick rates and a one-microsecond
  finite-difference check against published body velocity.
- Exact legacy-family arithmetic and analytical yawing-flight kinematics.

The targeted regression command was:

```sh
node_modules/.bin/vitest run \
  tests/motocross-planar-transport.test.ts \
  tests/motocross-ground-physics.test.ts \
  tests/motocross-ground-passivity.test.ts \
  tests/motocross-contact-consistency.test.ts \
  tests/motocross-contact-time-coherence.test.ts \
  tests/motocross-contact-traction.test.ts \
  tests/motocross-slope-momentum.test.ts \
  tests/motocross-body-transport.test.ts \
  tests/motocross-cross-slope.test.ts \
  tests/motocross-drive-budget.test.ts \
  tests/motocross-front-steering-authority.test.ts \
  --maxWorkers 1 --minWorkers 1
```

The first run recorded **212/215 passing** in 20.67 seconds. One failure was
root's concurrent MX450 wheelie-pedal fixture experiment; root completed
that fixture without changing assertions. A subsequent direct run of
`motocross-contact-traction.test.ts` with the planar change present passed
**17/17**. The resulting selected-suite status is **213/215**, with only the
following pre-existing body-transport failures unresolved:

| Test | Exact assertion | Received with new projection | Received without projection change |
| --- | --- | --- | --- |
| MX250 real manual reversals/body transport | `bike.speed === 0` | `8.673617379884046e-20` | `8.673617379884046e-20` |
| MX450 real manual reversals/body transport | `bike.speed === 0` | `7.228014483236678e-20` | `7.228014483236678e-20` |

The baseline run used an isolated source mirror, removing only the exact
projection hunks and copying the unchanged body-transport test. No shared
production source was toggled. Its restored ground and adapter hashes match
agent 25's released pre-projection source exactly:

```text
ground:  50a7761f89e7c77a602b14a80eb2b98eb16909b03864d8392238d0fe404084a9
adapter: 74df162bfee32214260d44db856d5d6085595d98ba14165fc61f59520b89d042
```

The baseline's two failures occur at the same body-transport line 145 and
have identical values. The remaining 19 body-transport cases passed in the
full selected run. These residuals are reported to root, without changing
the existing exact-zero assertions or expanding this task into gravity work.

`git diff --check` passed. The shared production hashes at release were:

```text
ground:  9b918fe8d0d9479c6b581c0fe0ef6a5e0174a256023d2d75d979dd1f38845c33
adapter: dfb25f5b373bf9695b7ac49c7111619e3d3ea869d05075fb0e11372987c52fad
```

## Limits

This is a displacement-basis correction, not a new three-dimensional force
metric. Existing along-slope/horizontal momentum coordinates, their yaw
rotation, tyre work accounting, supported cross-slope gravity and wheel
constraints are preserved exactly. `roadPitch` remains the sampled entry
pitch over each outer ground solve; endpoint terrain resampling and vertical
contact impulses retain their existing update order. The microscopic
public-step check validates agreement in the limit, while the ordinary-rate
oracle validates the exact existing semi-implicit microstep rule.

Corrected trajectories can subsequently sample different real terrain or
contacts during a sliding run; that is the expected consequence of restoring
the already-published horizontal slide. This report does not claim a full
project test pass or resolve the independently reproduced static-bank
roundoff in the body-transport fixtures.
