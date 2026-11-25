# Assignment 13 — live suspension coherence

## Result

Added `tests/motocross-dynamic-suspension.test.ts`: 14 focused regressions covering final-pose publication, incoming physical force evaluation, immediate reset snapshots, and the supermoto presentation boundary. No production source, models, materials, terrain, venue definitions, or vehicle specifications were changed by this assignment. No git operations were performed.

## Live production coverage

Eight runs combine MX250/MX450, Valley Ridge/Arena Nord, and 120/240 Hz. Each uses a production `Simulation` vehicle and track, with ordinary placement and approach speed followed by `rideLine()` controls and `DirtBikeVehicle.step()`. Neither contact state nor chassis pose is fabricated.

| Production feature | Approach target | Duration | Coverage in every bike/rate combination |
| --- | ---: | ---: | --- |
| Valley Ridge — RIDGE TABLE | 13.5 m/s | 6 s | Takeoff, one-axle support, landing, both 300 mm travel limits, rebound below half travel |
| Arena Nord — TABLETOP | 13 m/s | 6 s | Takeoff, one-axle support, landing, both 300 mm travel limits, rebound below half travel |

Across 8,640 solver ticks, the tests require fork/shock to agree with the final clamped geometric gap to approximately 5e-12 m, finite pose/velocity/load/travel values, coherent machine-motion stroke rates, and zero crashes. Both wheels also reach full extension. The scenarios intentionally distinguish incoming compression from final travel by more than 10 mm.

The actual production frame writer is checked at 60 Hz: 2,880 live snapshots plus eight immediate reset snapshots. Bike travel, all four wheel compression/length channels, chassis Y, and recorded stroke rates must agree with the same authoritative state; float32 conversion is explicit.

## Force timestamp remains physical

A separate 0.3 s real front-brake transient at Valley Ridge s=35 evaluates the progressive spring and digressive damper law using the incoming heave/pitch and measured contact gradient. It stays below the hard stop and has no steering, lateral motion, or fabricated terrain. All four MX bike/rate combinations match their actual forces within 5e-9 N; diagnostic residuals were below 5e-13 N.

Substituting the displayed final gap into the same force calculation instead produces peak errors of 23.51–48.90 N. The tests require this distinction to exceed 20 N. This protects the incoming force calculation without incorrectly requiring physical compression/force and presentation travel to share a timestamp.

Two supermoto cases independently verify that the existing 20 ms exponential travel filter remains active at 120/240 Hz. Their filtered fork differs measurably from the current geometric gap, so the check detects accidental expansion of the MX publication path.

## Reset finding and repair verification

The first run passed every live trajectory and force/filter assertion, then failed all eight immediate reset snapshots. `settle()` had reset `fork`/`shock` while leaving tyre `compression`/`length` at the preceding stroke. One MX450 braking reproduction retained front/rear tyre compression of 139.80/16.89 mm after the bike reset to 81.65/80.71 mm.

The finding was sent to the adapter owner (assignment 15), who synchronized tyre travel/length in the motocross reset branch. The same eight previously failing snapshot assertions now pass. The reset checks also require supported static weight, zero heave/pitch velocities, and zero stroke rates before any subsequent solver tick.

## Independent contact-test oracle review

Reviewed `tests/motocross-contact-traction.test.ts`, particularly the changed initial-braking travel bound in the forward-rider-stroke test. The 1%-of-travel bound is justified after removing the 20 ms publication filter. Independent measurements after four 240 Hz ticks were:

| Rider position | Published fork movement | Front brake force |
| --- | ---: | ---: |
| Back | 1.816 mm | 972.67 N |
| Neutral | 1.902 mm | 1,110.17 N |
| Forward | 1.985 mm | 1,246.99 N |

All remain below the 3 mm bound, while the pre-step contact-load friction ceiling continues to hold on each tick. Forward support still adds more than 100 N over neutral, and neutral over back. A sub-millimetre presentation-based bound would no longer describe the physical endpoint. No concrete error was found; that file was not changed by this assignment.

## Validation and limits

`node_modules/.bin/vitest run tests/motocross-dynamic-suspension.test.ts tests/motocross-contact-traction.test.ts tests/motocross-reference-geometry.test.ts` — **41/41 passed across three files**, 9.07 s on the final run.

`node_modules/.bin/eslint tests/motocross-dynamic-suspension.test.ts` — **passed**.

The new suite verifies engine state and production snapshot publication. It does not claim validation of rendered axle geometry, interpolation between frames, 480 Hz behavior, arbitrary hard-stop force laws, or all supermoto dynamics. Those are separate ownership/coverage areas; no broader changes were needed here.
