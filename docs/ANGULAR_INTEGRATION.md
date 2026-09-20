# Angular integration: conservation regression

## Reproduced defect

The preceding explicit body-frame gyroscopic update was unstable for a freely spinning anisotropic chassis. With diagonal inertia `[510, 1220, 1080]` kg m², initial world angular velocity `[10, 15, 25]` rad/s, no external torque, and a 1/240-second step, it reached a non-finite state after 2,464 updates (approximately 10.27 seconds). This is a numerical defect, not physical crash energy, and must not be hidden with angular-velocity caps or invented damping.

## Update and invariants

Translation remains semi-implicit Euler. Rotation uses an implicit body-frame midpoint drift between two half-step world-torque impulses. Write body angular velocity as `w`, diagonal inertia as `I`, and angular momentum as `l = I w`. For the torque-free drift:

```
I (w1 - w0) = -h * (wm × I wm)
wm = (w0 + w1) / 2
```

A twelve-iteration Newton solve uses the analytic three-by-three Jacobian, a relative residual tolerance, and explicit failure on nonconvergence or a singular Jacobian. The implementation reuses per-body vectors rather than allocating solver objects in each update. Large timesteps are not declared universally safe.

Taking the dot product with `wm` proves that the change in kinetic energy is zero in exact arithmetic. Taking the dot product with the average body momentum proves preservation of its squared magnitude. With the skew-symmetric cross-product matrix `W = [wm]×`, the momentum update is:

```
(1 + h W / 2) l1 = (1 - h W / 2) l0
```

The normalized quaternion increment `[1, h wm / 2]` represents the corresponding Cayley rotation. Updating orientation with that midpoint rotation therefore preserves the **world momentum vector**, not merely its magnitude. Using the endpoint angular velocity instead would break this compatibility. The code converts the midpoint to world coordinates before using the existing quaternion update helper.

Each outer half kick changes world momentum by `torque * h/2`, using the inertia in the orientation at that kick. Hence the two kicks and momentum-preserving drift reproduce the total applied world-torque impulse. These statements concern the isolated rotation update. Contacts, tires, aero forces and a changing mass distribution can exchange or dissipate energy and are not claimed to conserve chassis kinetic energy.

## Evidence

`tests/rotation.test.ts` covers three sixty-second torque-free cases, applied world torque, principal-axis acceleration, and invalid parameters. `scripts/rotation-benchmark.ts` records the maximum relative energy and world-momentum-vector errors and hashes of the exact numerical source files. The acceptance threshold is `1e-8`; the report contains the measured values rather than a substituted threshold.

The remaining AI endurance trials are separate tests: conservation of a freely spinning body does not establish successful racecraft or collision-free pit traffic.

## External context and implementation scope

MuJoCo's official [numerical-integration documentation](https://mujoco.readthedocs.io/en/3.8.0/computation/index.html#numerical-integration) discusses velocity-dependent forces and integration choices. It is contextual research, not a dependency or evidence that APEX's solver is equivalent to MuJoCo. The equations, coupling and invariants above describe this repository's implementation and are checked by its own tests. No external physics engine has been introduced.
