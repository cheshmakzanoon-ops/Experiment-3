# Wave 3 / Agent 14 — contact reset and recovery lifecycle

## Result

Added `tests/motocross-contact-reset.test.ts`: 13 deterministic tests using the production motorcycle, production Valley Ridge terrain, real surveyed jumps and ordinary rider controls. Both MX250 and MX450 are covered. No private physics state is written, no private solver method is invoked, and no model, asset, environment, terrain or specification is modified. This assignment changed only the new test and this report; Agent 15 implemented the coordinated adapter corrections.

## Reproduction and discovered boundaries

The fixture overshoots **SKY TRIPLE** at `jumpHoldSpeed(jump) + 2.6 m/s`. It stops during the real suspension stroke when the still-riding bike's pending landing record already exceeds its bottom-out limit, before the following tick grades it. The flight lasts over one second and arrives with more than 8 m/s normal speed. A control test advances exactly one tick and verifies a `crash-flat` verdict, one new crash, and the matching crash-cause entry. Thus the placement tests abandon a real fatal judgement rather than an invented record.

Four boundary operations are exercised at that point: `place`, `placeFree`, ordinary `restart`, and `restart('wrong-way')` assisted remount. Root's earlier pending-verdict reset prevented the old landing from crashing a new placement. Two additional gaps were reproduced:

1. **Immediate tyre publication remained from the previous landing.** Placement reset the physical wheel spins and suspension to their settled values, but tyre omega and compression retained the previous jump until another step. The MX450 example published front omega **43.316 rad/s** after its physical front spin was reset to zero, and rear compression **0.300 m** after shock travel became approximately **0.0807 m**. Free placement and restart could also retain old tyre force telemetry.
2. **Natural remount completion bypassed contact reset.** After the real crash, the production recovery proceeded through `lowside → separated → remount → riding`. Both displayed wheels were stopped immediately before riding resumed. On the completion tick, stale pre-crash spin returned: approximately **42.332 / 43.559 rad/s** for MX250 and **43.284 / 44.538 rad/s** for MX450. Bottoming peak, settlement clock and landing prediction also survived. A subsequent speed-reference check could remove the rotor mismatch one tick later, but the recovery boundary itself published the wrong motion.

Agent 15 coordinated the fix in `src/simulation/offroad/dirt-bike-vehicle.ts`: completed remounts now refresh their current contacts and settle before body publication; MX reset synchronizes tyre spin, compression, length, contact forces, slip and loaded state. Non-riding assisted pushes publish zero tyre load, matching ordinary tyre publication. Reset does not advance wheel rotation/turn count or tyre/disc temperatures.

## Contracts preserved

- A pending fatal landing cannot be consumed after relocation or explicit restart. Each case runs beyond the abandoned quarter-second settlement window.
- Bottoming intensity, wheelie age/torque, flight state and landing prediction start from the new contact history. A separate real raw-throttle gate wheelie verifies that nonzero wheelie age and drive pitch torque are actually cleared.
- The body's written position, velocity and angular velocity match its published pose, with zero reset angular derivatives. Elastic-machine motion resets immediately.
- Observed standing, dab and body posture remain continuous; their stored posture tangents reset to zero. The test does not require an artificial seated snap during a push.
- `lastLanding` retains the original record and object identity; cumulative landings, crashes, crash-cause history and the adapter clock are preserved. Natural recovery supplies a real nonzero crash history for this assertion.

## Validation

- Before Agent 15's corrections: **3 passed / 10 failed** in the new suite. The failing assertions isolated stale tyre publication and stale rotor momentum on natural remount.
- After the corrections: **13 / 13** reset tests pass.
- Combined run with `motocross-rider-recovery.test.ts` and `motocross-machine-animation.test.ts`: **20 / 20**, three files.
- Focused ESLint on the new test: pass. A scoped TypeScript check of the new test and its imports also passed.
- A broader exploratory run found three existing `motocross-wheel-pickup.test.ts` failures associated with the concurrent exact-ballistic integration: two assertions still expected semi-implicit gravity, and one substep speed comparison measured 0.030288 m/s against a 0.030 m/s bound. Those findings were reported to Root and Agent 15 for their integration task; this assignment did not edit that file.

Root owns the combined integration gate. No git mutation was performed.
