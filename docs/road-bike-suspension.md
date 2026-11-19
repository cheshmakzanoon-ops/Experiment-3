# Road motorcycle heave, pitch and contact support

The road motorcycle adapter advances a sprung chassis before it advances the existing rider and tyre controller. `RoadBikeSuspension` supplies independent nonnegative front and rear loads, chassis height and vertical velocity, pitch and pitch rate, and fork/shock compression. The production body pose consumes those integrated coordinates. A crest can therefore unload both tyres and launch the bike; sampling a lower road height does not pull it downward.

## Force model

Each end has the machine definition's spring rate and travel, a setup preload, and an authored damper. The fixed mechanical extension length comes from reference-mass static sag. Fuel burn changes equilibrium rather than changing the fork's extension length.

For geometric spring compression `c`, compression velocity `v`, preload `p`, travel `t`, spring rate `k` and damper `d`, the vertical contact force is zero outside suspension reach. Within reach it is:

```text
b = max(0, c - t)
N = max(0, k * (c + p + 8*b + 120*b*b) + d*v)
```

The progressive term represents bump rubber and residual tyre compliance beyond nominal suspension travel. Fork/shock telemetry remains bounded by mechanical travel. The damper uses a reference damping ratio of 0.9, the contact's effective heave/pitch mass, and the existing setup damping multiplier. These are authored values, not measurements of a manufacturer motorcycle.

The chassis obeys `y'' = (N_front + N_rear - downforce)/mass - g`. Pitch acceleration comes from both contact moments, the preceding interval's transmitted longitudinal tyre forces acting below the CG, and the configured aerodynamic load split. An unsupported tyre contributes no longitudinal moment. Integration uses intervals no larger than 1/480 second and linearly advances the sampled road endpoints over each external interval.

The model is intentionally reduced: forces are vertical-equivalent support for a heave/pitch chassis, coupled to the existing road-slope dynamics and the contact reaction's roll moment. It does not claim unsprung wheel masses, measured damper curves, a deformable tyre contact patch, or a complete six-degree-of-freedom frame and rider model.

## Coupling to the existing motorcycle controller

- `Bike.contactLoads` opts production road bikes into supplied support. The standalone research model and `DirtBikeVehicle` keep their existing paths when that field is absent.
- The core limits drive/braking using actual contact loads and does not add a second algebraic load-transfer calculation to them. Existing conservative transfer predictions remain useful inside ABS/traction assistance; those predictions can only reduce an already contact-limited force.
- Ordinary road bikes bound realised curvature by the two actual friction circles. GP prototypes retain their front/rear camber and slip solver, with a lean target bounded by supported lateral grip.
- The GP opt-in continues the rear tyre's force and yaw moment when the front unloads. Front force and front road-steering authority are zero in that state. Existing yaw and lateral momentum are not erased at contact transitions.
- With both contacts absent, tyre forces and rolling resistance vanish. Vertical motion remains ballistic with the configured downforce. The GP's body-frame forward/lateral velocities rotate as a pair so changing heading does not create horizontal momentum. Roll continues without the grounded controller's contact-line gravity/gyro torque. An unloaded wheel no longer relaxes its angular velocity to road speed.
- The existing supported roll degree of freedom moves the CG about the tyre crowns. Its geometric lowering is rebased separately from suspension stroke, avoiding false extension simply because the rider leans. The roll contribution to vertical velocity is retained on takeoff. In flight, changing lean cannot translate the free CG.

## Roll control and motorcycle approach planning

Gravity acts through the free CG; the vertical contact reaction supplies the overturning moment about it. For the opted-in road model, the ordinary roll equation therefore uses `(N_front + N_rear)/mass` in its equilibrium term, rather than assuming `N = mass*g` until the last contact disappears. This gives a continuous transition through partial support at a crest. The GP roll plant and its inverse use the same reaction. Vertical gravity is unchanged. The standalone and motocross paths retain their previous steady-support approximation.

Road-bike normalized lean intent keeps a stable surface-dependent scale. The assist applies the instantaneous contact bound after decoding that intent. The high-speed road controller limits roll rate using the opposing moment available to stop that roll, with the existing 72% nominal grip target and up to 96% of the actual contact capacity for transient recovery. Its handover blends above walking pace. TC, wheelie control and ABS reserve the original intent and the uncapped roll-arrest demand; a transient zero realised curvature must not erase the load needed to regain steering.

The approach planner also accounts for the normal load that braking removes from the rear. With wheelbase `L`, CG height `h`, CG distance behind the front contact `a`, total longitudinal braking force `Fx`, and rear lateral demand `FyRear`:

```text
Nrear = Nrear0 - Fx*h/L
Nrear >= FyRear/(0.85*mu)
Fx <= (Nrear0 - FyRear/(0.85*mu))*L/h
```

This linear load-transfer bound can be tighter than the shared friction ellipse. `motorcycleApproachProfile` adds it to the shared backward profile before the existing grade term. GP machines pass their recovery reserve multiplier; ordinary motorcycles additionally account for the offset rider. Positive grade means uphill, and downhill reduces available deceleration. Ordinary riders keep a separate pedal/planning stage; GP, pit, off-track, reversed and unrelated vehicle controller contracts remain distinct.

## Placement, recovery and presentation

Placement and marshal restart explicitly reset the suspension boundary. Crash/recovery continues through the existing bike state machine; a completed remount cannot read a stale pre-crash pitch as a new loop-over. MX owns its own step and pose overrides and does not activate this road solver.

Front/rear samples retain the current ground-layer height hint for bridge and open-world queries. Fork/shock presentation consumes actual solved compression rather than a smoothed load target. The existing snapshot layout is unchanged; its load, compression, pose, velocity and vertical-support fields now describe the integrated model. Replay compatibility must be advanced with the physics identity when shipping this behaviour change. Flashback remains deterministic resimulation from the same inputs.

Zero-duration pose writes remain explicit placement/prescribed-pose boundaries. The real runtime integration is `BikeVehicle.step`; production physics tests exercise that method, not only a standalone helper or pose writer.

## Verification

`tests/road-bike-suspension.test.ts` covers:

- Static equilibrium and sag for GP-R1, GP-R2 and SS-600.
- A 30 m/s approach to the analytic road `h(z) = 2*exp(-(z/10)^2)`, including unloading, zero airborne tyre force, the gravity/downforce acceleration bound, flight and landing.
- One-metre drops and suspension travel limits for GP-R1 and SS-600.
- Ordinary braking, with fork dive, rear unloading, and no duplicate transfer in published loads.
- Flight with nonzero yaw and lateral velocity, testing world horizontal momentum independently of the production rotation implementation.
- Conservation of airborne roll motion and the absence of front steering force during rear-only support.
- Consistency at 120, 240 and 480 Hz, and explicit reset from flight.

The existing front-contact test retains launch/release flashback equality and now requires zero normal/brake force while a wheel is geometrically above the road. The seamless-braking fixture settles the physically loaded corner and rider hang-off before its steady assertions, while checking finite, nonnegative forces and both friction-circle uses throughout setup; the separate downshift-edge test still checks the immediate engagement transitions.

The analytic surfaces isolate force/trajectory correctness. Real circuit AI, kerb transitions, mixed fields, pit/recovery and open-world autopilot remain separate integration gates. Severe landings and unusual setup extremes require further ride calibration; this change is a physical foundation, not a claim of measured real-bike landing behaviour.

`tests/road-bike-control-reserve.test.ts` independently balances a leaned bike at 2%, 10%, 40% and 100% static support, then exercises full-throttle turns followed by hard braking and a lean reversal on the production SBK-1000 and SS-600 adapters. `tests/motorcycle-braking-plan.test.ts` verifies the closed-form rear-load bound, class-specific reserves, and the shared grade sign. The seeded two-lap GP/superbike race retains its existing incident, finish, stopped-time and class-pace limits.
