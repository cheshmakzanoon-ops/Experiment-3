# Race timing, classification and pit response

## Timing and the legal boundary

Each completed lap still requires the eight ordered forward checkpoints. Sector boundaries and the finish crossing now interpolate within the fixed simulation step; the third sector is closed at the finish and the preceding three-sector record survives the next lap reset. Their sum equals the completed lap time. Invalid laps retain their measured sectors without becoming a valid best lap. Discontinuous location changes do not award classification progress, and reversed/non-finite timing samples fail explicitly.

The track-limit policy uses the outer edge of the authored asphalt/paint ribbon. Outer kerbs and painted runoff do not expand that legal boundary. Four independent wheel samples carry the local ribbon half-width. A tread that still overlaps the boundary counts as on-track; a violation requires all four to be wholly outside. This is a wheel-tread-width approximation, not a deformable three-dimensional contact-patch calculation. Pit-lane traversal is excluded from racing-surface violations. The old fixed 9.7-metre chassis-independent threshold is removed.

## Finishing the entire field

The first valid driver crossing after the configured lap distance starts the chequered period. Same-tick first crossings are ordered by interpolated time, not vehicle array index. Remaining drivers finish on their next valid finish crossing, including lapped drivers; their completed-lap counts remain distinct. Classification sorts completed laps first and then penalty-adjusted finish time. Finished drivers perform an AI-controlled cooldown instead of parking across the racing line. Their timing records stop changing.

Results are shown only when the whole field has finished or retired. A 180-second simulated grace period after the first finish prevents a stopped competitor deadlocking the session; expiry creates an explicit DNF with no fabricated finish time. An all-retired race also terminates without inventing a winner. These are this original simulator's session rules, not a claim to implement every real championship regulation.

## Physical pit response

The finite-inertia clutch exposed a pit-controller weakness: the old braking envelope assumed the pedal controller reached its target speed immediately. The target now reserves 0.8 seconds of response distance using `d = v*tau + v²/(2a)`, and following cars reserve speed-dependent headway. A missed box takes the actual exit and retries a later legal entry instead of reversing into a queue. It does not count a service or teleport the car.

Four ground-contact jack feet provide a finite support polygon and bounded tangential friction while raised. Forces act at physical attachment points; the solver does not clamp the chassis position or velocity. These remain rigid contact approximations rather than a multibody animated mechanic/jack model.

## Executable evidence

`tests/race-control.test.ts` checks interpolated sectors, invalid laps, discontinuity rejection, four-wheel boundaries, lapped finishes, same-tick ordering, penalties, explicit timeout DNFs, all-retired termination, pit retry and jack support. `scripts/race-classification.ts` runs two actual ten-car, three-lap races, clear and changing-weather, verifies the entire field finishes and sector sums agree, and requires every car to service in the changing-weather race. The browser race test now finishes three actual competitors and rejects a results table containing RUNNING entries.

`tests/clutch.test.ts` and `tests/calibration.test.ts` cover the associated physical torque/input path. The weather runner now persists current failures rather than leaving an old passing report behind. The longer endurance gates and final combined audiovisual scenario are separate acceptance requirements; none is inferred from unit-test counts.
