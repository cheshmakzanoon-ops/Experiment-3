# Driver decisions, measured lap delta and physical pit presentation

This is an implementation checkpoint against directive sections 43–50, 80, 88, 90 and 91, not a claim that the master directive's final audits or presentation standard are complete.

## Driver personalities change decisions, not physical capability

The strategy layer samples actual tire wear and temperature, local session wetness, battery reserve and nearby traffic at 2 Hz. Tire-management preference reduces pace under heat/wear and changes service timing; wet skill adjusts the driver's requested margin. Aggression changes deployment choices during a real passing opportunity. Consistency affects reaction timing and error magnitude. Overtaking skill changes lane-transition cost, while defensive bias controls an early, committed inside-line preference. The normal swept traffic planner can reject that preference when occupied. No trait multiplies tire grip, teleports a car or changes its engine specification.

The seeded error model produces correlated, bounded steering/pedal request offsets. Pressure, worn tires, wetness and heat increase its event hazard. Event rate is an original game calibration, not a measured human-driver statistic. Errors do not disable emergency braking and are suppressed during pit service, caution and unsafe recovery paths. The three strategic/tactical/control rates remain distinct.

A defense commits to one line early in an approaching corner and has a cooldown. It does not choose a new late block against an already overlapping challenger. This is a conservative racing heuristic; it is not proof of championship-grade racecraft in every traffic arrangement.

## Reproduced wet-pit deadlock and repair

Changing driver pace exposed a queue failure hidden by the previous spacing. A car waiting for a later service bay advanced alongside a car already receiving service. Their current lateral separation looked safe, but the waiting car's *future* bay approach crossed the occupied bay. The service car could not release, while the waiting car could not move forward.

The repair checks the upcoming service corridor as well as current lateral overlap. Fast-lane cars queue in longitudinal order, leaving a serviced car room to leave. A latched pit-preparation intent also prevents falling speed from shrinking the lookahead and cancelling a lane change; a new pit purpose supersedes the old racing-line commitment without bypassing collision prediction. Stop distance still includes controller response, and missed boxes remain drive-through retries rather than reverse maneuvers through a queue.

A focused physical regression starts with the previously problematic bay/queue geometry. Both vehicles complete service and exit without contact. The whole-field clear and changing-weather three-lap fixtures finish all ten cars with no contact, retirement or artificial finish times. In the changing-weather fixture every car makes a physical tire stop; the session finishes at approximately 307.917 simulated seconds. The ten-car simultaneous service fixture exits all ten cars in 196.767 simulated seconds with zero contact. See the executable tests and current generated JSON reports; these are fixture-specific results, not universal guarantees.

## Actual reference-lap timing

Each car stores 257 crossing-time samples at equal distances for the current lap and best complete valid lap. The reference uses interpolated physical crossing times, not an invented constant-speed trace derived from the total lap time. Missing samples and invalid laps cannot replace the reference. Stopping adds real elapsed time. A slower accepted trace cannot overwrite an existing faster one.

The HUD and cockpit display show a delta only after a complete valid reference exists. The physical wheel also displays brake bias, power differential setting, deployment mode and battery state; individual shift LEDs follow measured engine RPM. At that checkpoint, protocol version 5 added the service clock, actual delta/reference availability and driver-decision diagnostics. The fixed snapshot stride is 224 floats per car and that checkpoint had 197 uniquely named channels. Weather protocol 6 now appends two wind channels (199 total), retaining the same stride. Recording and replay use the same state.

## Service visuals are consumers of the physical state

The old independently animated single pit person is removed. Four wheel mechanics and two jack operators are rendered for each physically stopped service car through four bounded instanced batches. A loaded wheel cannot be drawn off its hub. Wheel removal/installation use the real service phase and clock, with tire-state replacement still performed by the physics service state machine. Wheels slide away from the hub without moving the suspension upright, brake disc or contact solver. Ground/tool placement follows the actual car and jack height. The same clock makes replay seeking deterministic.

The browser fixture first drives a real car into its pit box with the normal AI and vehicle solver, captures its unloaded removal phase, then renders the production car and crew in an isolated inspection scene. It verifies the four wheel offsets and retains a screenshot. This is a rendering-assembly check using actual physical state, not a substitute for a complete user-driven pit browser workflow or a full professional crew animation system.

## Validation boundaries

The local suite contains 235 passing unit/property tests, including personality decisions, seeded error behavior, fixed-length driver limbs, complete reference-lap timing, display values, pit-scene capacities and physical queue regressions. Lint, strict TypeScript and the Vite build pass. Weather, dynamics, obstruction, physical pit and whole-field race scripts remain active acceptance gates.

Full-game Chromium and the new isolated pit rendering test run in GitHub Actions because local WebGL context creation is unavailable. Publication is conditional on their success. Long-run endurance reports must be attributed to their recorded simulation fingerprint; earlier marshal-only reports must not be used as evidence for these changed AI decisions.
