# Continuous chassis collisions

The chassis solver detects vehicle pairs that collide between the two integrated
poses of a physics substep. Endpoint-only overlap can miss a narrow motorcycle
crossing a corner at speed, even when the ordinary simulation runs at 240 Hz.

The implementation is in [collision.ts](../src/simulation/collision.ts) and
[obb.ts](../src/simulation/obb.ts). It preserves the existing rigid-body impulse
response and each vehicle family's force integrator.

## Captured motion and production integration

Every production vehicle substep follows this sequence:

1. `CollisionSolver.beginStep(cars)` captures each body's pose, speed, spin, and
   object identity immediately before integration.
2. Each vehicle integrates its existing forces for half the 120 Hz world tick.
3. `CollisionSolver.solve(cars, track, dt)` resolves swept chassis contacts, then
   ordinary endpoint contacts and track boundaries.

The circuit/offroad world and open-world session both capture before each of
their two substeps. The physics-cost fixture uses the same sequence, so its total
timing includes the production collision work.

Captures are consumed once. The count, order, and actual vehicle objects must
match, so a replacement entrant cannot inherit the old car's path merely by
reusing its ID. A call without a fresh capture, or without a positive finite
substep duration, retains the older endpoint-only API.

Recovery and placement before capture start a fresh path. For adapters that reset
within their step, motion is excluded from the sweep when centre travel exceeds
the greater endpoint speed times `dt`, plus 0.05 m, or orientation travel exceeds
the greater endpoint spin times `dt`, plus 0.05 rad. These small allowances admit
ordinary suspension/contact corrections. Endpoint collision remains active for
an excluded body. This guard recognizes implausible discontinuities; it does not
limit vehicle speed.

## Continuous geometric query

The same oriented chassis box used by the endpoint solver supplies all 15
separating axes: three face normals from each box and nine edge cross products.
Its maximum separating-axis gap is a conservative lower bound on separation.

Between captured poses, centres move linearly and orientations follow the
shortest quaternion arc. Quaternion sign changes do not introduce an extra turn.
Conservative advancement divides the current separating gap by a bound on how
quickly that axis can close. The bound includes relative translation and each
box's angular travel multiplied by its bounding-sphere radius.

Swept bounding spheres around the centre segments reject distant pairs before
the more expensive oriented query. They also contain rotating corners outside
the endpoint axis-aligned bounds. Stable vehicle-ID ordering makes tied candidate
processing repeatable, and query scratch belongs to each solver instance.

The contact tolerance is 0.00001 m. A query has at most 80 advancement iterations;
`SweptBoxContact.exhausted` distinguishes a spent budget or numerical stall from
a proven geometric miss. This bounded algorithm is not an unconditional
no-tunnelling guarantee for every possible motion or grazing configuration.

Initially touching or overlapping pairs are admitted at time zero only when the
interpolated contact-point motion is approaching. Resting and separating pairs
remain the endpoint solver's responsibility. This avoids losing a full crossing
that begins exactly at contact while also avoiding repeated resting impulses.

## Collision response

The solver selects the earliest approaching event, advances every candidate's
geometric start to that time, applies the existing impulse at the contact, and
updates the affected endpoints by the velocity change times the remaining
substep duration. It then searches the changed paths again. A struck vehicle can
therefore hit another vehicle during the same substep.

The force integrator is not run again. During the impulse, centres are at their
event positions and inertia retains the already integrated orientation. The
impulse changes angular velocity immediately; its additional rotational drift is
integrated in the following substep. This is an explicit split-step
approximation, rather than a repeated full rigid-body integration at every event.

The established response keeps restitution 0.08 and Coulomb friction 0.3.
Effective mass includes both inverse mass and world-space inverse inertia. The
equal and opposite impulses use a common contact point, including frictional
angular impulses. Mechanical regressions check complete linear and angular
momentum and dissipated kinetic energy; normal restitution is not approximated
with an arbitrary speed cap.

An actual contact-point velocity check rejects a geometric event that has become
separating after an earlier impulse. The event budget is `max(8, 2 * carCount)`.
Reaching it is reported explicitly; remaining endpoint collision is still run.
Endpoint boxes are refreshed after depenetration, with candidate extents frozen
for that pass to preserve the broad-phase sort's early-out ordering.

Each solve resets these diagnostics:

| Field                  | Meaning                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `sweptContacts`        | Accepted continuous collision events                       |
| `sweepQueries`         | Oriented swept-pair queries                                |
| `sweepIterationLimits` | Queries that exhausted their advancement budget or stalled |
| `sweepLimitReached`    | The per-substep event budget was reached                   |

## Verification and fidelity boundaries

[collision-continuous.test.ts](../tests/collision-continuous.test.ts) covers an
analytic first-contact time, rotating corners, true near misses, quaternion sign
equivalence, approaching/resting/separating time-zero contacts, and a real GP
chassis corner glance at 85 m/s per machine (306 km/h), using the production
1/240-second substep. A separate 250 m/s full-crossing stress case deliberately
exceeds ordinary motorcycle speeds. The tests also cover a three-body impact
chain, an explicitly reported event limit in a tight inelastic cascade, unequal
rotating masses, immovable walls, energy/momentum invariants, teleport rejection,
replacement entrants, consumed captures, and deterministic solver-local scratch.

Run the focused suite with:

```sh
npx vitest run tests/collision-continuous.test.ts tests/physics.test.ts tests/contact.test.ts tests/motocross-collision.test.ts
```

The collision proxy remains one oriented chassis box, with one response point
per pair. Wheels, wings, rider limbs, deformable bodywork, and articulated contact
manifolds are not added by this change. Static-world colliders, rail probes, and
kinematic ambient traffic retain their existing collision paths. These limits,
the bounded query/event budgets, and the rotational split are part of the model's
documented scope.
