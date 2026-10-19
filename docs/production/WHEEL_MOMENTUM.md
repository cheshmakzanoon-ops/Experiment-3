# Wheel and chassis angular momentum

The car solver includes the signed angular momentum of every wheel, including
airborne wheels. Each wheel contributes its inertia times its angular speed along
its steered and cambered axle. Accelerating or braking a wheel, steering its axle,
and changing camber therefore exchange angular impulse with the chassis.

`Vehicle` samples this momentum before alignment and tyre updates and immediately
before rigid-body integration. Two reused vectors hold these samples. The samples
are derived from existing physical state and do not add recording fields.

`RigidBody.integrate` accepts the two body-coordinate momentum endpoints. It splits
their difference into two equal internal angular impulses around the existing
implicit midpoint drift. That drift solves the gyrostat equation

`I * omegaDot = -omega cross (I * omega + hMid)`.

The analytic Newton Jacobian includes the rotor term. The existing Cayley
quaternion update rotates the body with the midpoint angular velocity, preserving
the world angular momentum vector. External world torque still uses symmetric
half kicks. Both supplied rotor endpoints are checked for finite values before
translation. Callers that omit the endpoints retain the ordinary rigid-body
equations, and no rotor momentum is cached between calls.

## Scope and approximations

The production coupling applies to the four-wheel car model. It does not add an
engine-crank gyro, a flexible chassis, or a motorcycle multibody solver. The tyre
drive/brake/contact equation is still solved separately from chassis rotation.
In particular, wheel axial acceleration is not solved as a fully coupled free
bearing degree of freedom; this is an operator-split approximation. The tyre
contact force is not applied a second time as a separate rotor torque.

These solver changes advance physical-model compatibility to version 4. Existing
records from versions 2 and 3 remain in their original categories. Snapshot
protocol 13 and network protocol 2 are unchanged.

## Regression coverage

`tests/wheel-momentum.test.ts` checks signed axle geometry, ten-second conservation
at 60/120/240 Hz, changing internal momentum and external world torque, precession
direction, stateless optional rotor inputs, invalid endpoints, and actual airborne
braking in the production vehicle substep. The existing integrator suite covers
energy dissipation on suspension drops, coast-down, braking/steering consistency,
and kerb impacts across timestep rates.

This implementation was reconstructed after an execution-environment reset.
Validation recorded before that reset refers to the earlier source tree; fresh
test results are required for this version and are reported separately.

Fresh verification passed: 24 tests across three files, plus scoped ESLint.
The Vitest run took 27.64 seconds. Exact commands and logs are retained in
[wheel-momentum-validation.json](./wheel-momentum-validation.json).
