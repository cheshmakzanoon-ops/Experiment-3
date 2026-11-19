# Engine replay and control ownership

## Scope

Assignment 21 of the graphics and engine advancement reviewed deterministic continuation for the new road motorcycle contact/thermal state and catalogue hardware response, the actual flashback input boundary, and the remaining motocross player/AI model split.

Flashback rebuilds a `Simulation` from its session options and applied input journal at the fixed 120 Hz tick. It does **not** restore physics from the interpolated presentation frame. The new suspension and contact-controller state therefore require deterministic construction and integration, rather than additional presentation fields or a second hidden-state serialization format.

## Corrected defect: a held input after AI handback

`InputLog` previously compared a new input only with the preceding recorded player message. The live simulation's input object is mutable: the AI, grid holds and consumed shift commands can change it between messages. An identical player message can consequently be a necessary physical write even though its payload has not changed.

A production GP reproduction used a held throttle of 0.18, input messages every two physics ticks, AI control enabled at tick 60 and disabled at tick 180, and a target of 300 ticks. The former journal retained only the initial input and the two AI toggles. It omitted the player's handback input, leaving the replay on the last AI throttle and steering.

| Observation                              |         Former journal |      Corrected journal |
| ---------------------------------------- | ---------------------: | ---------------------: |
| Live speed at tick 300                   | 10.994665472200218 m/s | 10.994665472200218 m/s |
| Re-simulated speed                       | 17.592465456430816 m/s | 10.994665472200218 m/s |
| Different presentation fields            |                    110 |                      0 |
| Retained entries for this input schedule |                      3 |                     63 |

The larger corrected journal retains writes made after the AI has overwritten controls. A normal held state still compresses: sixty identical messages with an unchanged applied state retain one entry.

### Implementation

- `applyLoggedInput` is now the shared live input boundary used by the actual physics worker and the new production tests. It inspects the vehicle's current controls **before** applying the incoming message.
- `InputLog.input` suppresses a repeated held value only when both the preceding message and the supplied current controls agree with it.
- Repeated shift, DRS and overtake requests are retained as edge commands. A consumed command must be applied again when a new message requests it again.
- Re-simulation continues to use `applyEntry` and never logs its own reconstruction. Branch truncation and target-tick ownership remain unchanged.

The low-level `InputLog.input` method still accepts callers that provide only a scripted change list. Live mutable simulations must use `applyLoggedInput`, or explicitly supply their current controls. The worker uses the shared helper for ordinary messages, pause input reset and the stale-input watchdog.

No grip, force, handling constant, AI pace setting, snapshot layout or network encoding changed in this correction. Previously omitted historical input events cannot be reconstructed from an incomplete journal; this fix preserves the necessary events as they occur.

## State and continuation evidence

`tests/engine-flashback-state.test.ts` exercises GP-R1, SBK-1000, MX-450 and SC-7 through the production worker input boundary. It includes AI handback, steering/pedal/rider-weight changes, four checkpoints through 1,200 ticks, continuation after reconstruction and a replacement branch from tick 900. Re-simulation uses different slice sizes from the live run.

Each checkpoint compares the complete Float32 presentation frame bitwise and selected unrounded physical state:

- Road suspension height, vertical velocity, pitch/rate, acceleration, front/rear support, compression and gaps.
- GP forward/lateral momentum state, yaw, steering trim, lean target, load demand, wheel speeds, slips and contact work.
- MX heave/pitch, air attitude, wheel speeds, support, rider posture, landing count and the deformed-terrain hash.
- All physical tyre reservoir temperatures, pressure, wear, work, wheel speeds and contact forces, including the four ABI aliases.
- Catalogue intake/boost state, shift timing, engine output and suspension link loads.

Continuing both the live and reconstructed simulations for another 180 ticks verifies that matching snapshots did not conceal divergent controller or contact memory. Reconstructing the new branch verifies that discarded future inputs cannot leak back into the resumed timeline.

Every vehicle case also removes only the tick-180 handback write from a copy of the correct journal. That negative control must diverge by tick 300. A separate production gearbox test applies two identical upshift messages thirty ticks apart: the correct journal reaches third gear, while deleting the second edge leaves second gear. The checks therefore exercise meaningful input effects rather than merely comparing stationary scenes or journal array sizes.

### Completed checks

| Suite                                                           | Passed tests |
| --------------------------------------------------------------- | -----------: |
| New engine flashback and control ownership                      |           10 |
| Actual worker pause/recording barrier                           |            5 |
| Existing Formula flashback determinism                          |            2 |
| Flashback recording and truncation                              |            4 |
| Motocross rider-input journal/codec                             |           10 |
| Actual motocross landing wheel pickup, including reconstruction |           11 |
| Session identity and incompatible old records                   |           40 |
| Network control/snapshot codec                                  |            9 |
| Session recording                                               |           37 |
| Wheel contact recording                                         |           10 |
| Wheel winding recording                                         |            6 |
| **Total, eleven files**                                         |      **144** |

Full TypeScript checking, scoped ESLint, new-file/core formatting and diff whitespace checks passed. The worker edit was kept to its import and shared input call; unrelated existing formatting was preserved. No existing acceptance threshold was changed.

At this assignment-21 checkpoint, the pending physics batch used simulation identity v26 and presentation protocol v16. The final combined model retains simulation v26 and advances presentation to v17 for the explicit [road-bike sprung-pose contract](road-bike-presentation-contract.md). Existing tests reject v25 ghosts, competitive categories and network identities. The control-history correction itself does not add a packet or record format; the test results above describe its own checkpoint.

## Motocross model boundaries

The thermal integration consistently advances two physical tyre/rotor reservoirs and mirrors their state into the existing four-slot vehicle ABI. Contact work is load-gated, engine braking is excluded from rotor heating, and airborne friction brakes can heat a rotor only through finite wheel rotation.

The player and AI do **not** yet use identical ground dynamics:

| Path                                          | Ground-force/control model                                                                                                | Thermal input                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Player MX-250/MX-450 on MX/SX terrain         | Dedicated wheel-speed and coupled ground-contact solver; independent rear pedal; separate current front/rear soil grip    | Solved contact slip power and friction-brake work from the actual wheel integration                                       |
| AI MX and the retained supermoto/reduced path | Shared reduced bike core with its calibrated linked-brake and common-grip behavior                                        | Measured wheel/ground longitudinal mismatch where represented, rolling work, and the reduced contact-force brake estimate |
| Airborne dirt bike                            | Finite wheel rotation and chassis pitch/attitude integration; AI and player controls retain their respective aid policies | Finite friction-brake wheel work; no unsupported tyre contact heat                                                        |

The reduced path does not invent lateral tyre heating from a kinematic cornering force. Its absence of a fully resolved lateral slip state is a modelling limit, not proof that the physical real-world tyre would dissipate no heat.

The new MX state tests exercise both player and AI modes and reproduce their handovers exactly. That establishes deterministic behavior, **not** force parity or a validated physical transition between identical solvers. This assignment made no wholesale MX migration and did not change the existing force models, riding aids or crash tolerances.

## Limits

These checks establish deterministic reconstruction for the tested source, runtime, inputs and machines. They do not certify cross-engine floating-point identity, every possible input history, manufacturer correlation, console parity or GPU performance. Visual replay remains presentation interpolation, distinct from authoritative flashback re-simulation. The final combined engine source still requires its independent race/scenario acceptance checks.
