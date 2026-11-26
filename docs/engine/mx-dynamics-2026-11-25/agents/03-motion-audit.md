# Agent 03 — MX motion and recovery audit

Date: 2026-11-25. Wave 1/10. Read-only audit of `main` at `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.

## Scope and result

Inspected `mx-machine-motion.ts`, `rider-weight.ts`, `rider-recovery.ts`, pure MX pose sampling, recovery sampling, and their simulation/rendering callers. No production files, models, characters, geometry, materials, or environments were changed. This report is the only authored file.

Two confirmed fluidity defects merit bounded simulation fixes. A related recovery speed defect is also reproducible. The analytic spring integrators themselves did not show a defect in this audit.

## 1. P2 — Rider weight composition introduces a velocity discontinuity at neutral

**Location:** `src/simulation/offroad/rider-weight.ts:36-40`.

`RiderWeight.step()` is an analytic critically damped response, but `pose(automatic)` composes its smooth state using:

```text
body(p, a) = a + p - a * abs(p)
```

At `p = 0`, the left derivative with respect to rider position is `1 + a`; the right derivative is `1 - a`. A reversal crosses neutral with nonzero spring velocity, so the composed body velocity jumps by `-2 * a * velocity` even though the spring's position and velocity are continuous. This is a derivative defect rather than a position jump.

**Affected callers:**

- `src/simulation/offroad/dirt-bike-vehicle.ts:846-847` and `1215-1222` compose the automatic and manual rider command.
- `src/simulation/offroad/dirt-bike-vehicle.ts:1379` uses that value in supported weight-shift torque.
- `src/rendering/rider.ts:1617,1634` consumes the same recorded body value for pelvis displacement and torso pitch. These character files need no edits to correct the source signal.

**Read-only numeric reproduction:** Initialize a `RiderWeight`, hold `-1` for two seconds at 240 Hz, then hold `+1` with `automatic = 0.45`. On the crossing tick:

```json
{
  "position": 0.013525470076805934,
  "springVelocity": 3.7266516255845494,
  "previousBodyVelocity": 5.486344381172721,
  "bodyVelocity": 2.509853276427765,
  "bodyAcceleration": -714.3578651387894
}
```

Finite differences at `p = +/-1e-7` give slopes `1.45` and `0.55` for `automatic = 0.45`, and `1.8` and `0.2` for `automatic = 0.8`. The ordinary automatic ground target can reach `0.45` under full throttle (`dirt-bike-vehicle.ts:1217`), so the defect does not depend on extreme test values.

**Bounded fix:** Make only the command-composition function continuously differentiable at neutral, while preserving `pose(0) = automatic`, full negative/positive command endpoints, monotonicity, and the `[-1, 1]` bound. Retain the exact `RiderWeight.step()` state and the existing airborne displacement/momentum coupling. Do not substitute an unconstrained polynomial that overshoots when the automatic target is near an endpoint.

**Tests:** Extend `tests/motocross-rider-weight.test.ts` with one-sided derivative checks around neutral for positive/negative automatic commands, reversal traces at 120/240/480 Hz, and the existing neutral/full-throw/boundedness contracts. Existing tests verify spring cadence and position bounds, but not continuity of the composed body's derivative.

## 2. P2 — Recovery remount snaps rider heading to the bike in one tick

**Location:** `src/simulation/bike-vehicle.ts:947-960`, specifically `this.riderHeading = h` at line 959.

The preceding on-foot phase limits yaw to `4 * dt` (`bike-vehicle.ts:910-912`) while the rider walks toward the machine. Upon entering `remount`, the heading is assigned directly to the motorcycle's heading. Approaching a fallen bike from its front or side therefore produces an instantaneous turn. `riderAlpha()` deliberately holds rider fields across state changes (`src/rendering/snapshot-interpolation.ts:80-89`), so interpolation does not smooth the discontinuity.

**Full simulation reproduction:** With MX450 on `valley-ridge-mx`, place at station 35; set a stopped, separated bike (`stateClock = 2.1`, lean `1.3`); put the rider two metres in front of the bike at local ground + `0.14`, facing back toward it; advance the normal `DirtBikeVehicle.step(1/240, track)` until it remounts. This uses the ordinary recovery state machine, rise, walk, and remount functions. The transition produced:

```json
{
  "tick": 378,
  "headingStep": -1.5708527449088292,
  "angularSpeed": 377.004658778119,
  "riderDistanceToBike": 0.5308442432927194
}
```

The rider turns approximately 90 degrees in 4.17 ms, following an on-foot phase capped at 4 rad/s. An isolated call to the same remount branch with the bike facing away reproduces a full pi-radian change.

**Bounded fix:** Approach the bike's yaw through the shortest angular difference with a finite per-second turn rate during remount. Keep the behavior local to the intended MX recovery path if preserving other motorcycle recovery calibration is required. No character rig or asset changes are needed. Preserve deterministic state-derived output and hand-grip reach handling.

**Tests:** Extend `tests/motocross-rider-recovery.test.ts` past the separated-to-remount boundary, with front/side/rear approaches and headings crossing `+pi/-pi`. Assert bounded angular change on every tick, completion within the existing recovery budget, and identical held/replayed poses. The existing recovery test stays in `separated`, then explicitly sets `highside`; it never covers remount.

## 3. P2 — Remount translation is axis-limited rather than speed-limited

**Location:** `src/simulation/bike-vehicle.ts:955-956`.

The remount branch independently approaches rider X and Z by `BIKE_RECOVERY.jogSpeed * dt`. A diagonal approach therefore travels `sqrt(2) * jogSpeed`, unlike the vector-normalized on-foot movement at lines 915-918.

**Reproduction:** Invoke the ordinary remount update with both X and Z errors larger than one per-axis step. At 240 Hz and the configured 4 m/s jog speed, measured displacement is `5.65685424949236 m/s`. This is a deterministic vector-magnitude defect; no rendering is needed to reproduce it.

**Bounded fix:** Limit the XZ displacement vector to `jogSpeed * dt` while maintaining its direction toward the existing beside-bike target. This can share the small recovery patch with finding 2.

**Tests:** Add diagonal and cardinal target cases to `tests/motocross-rider-recovery.test.ts` and compare the actual planar displacement norm. Keep the assisted-restart completion check in `tests/motocross-push-gait.test.ts`; long recovery paths must still complete under the existing budget.

## Verified behavior and intentionally deferred observations

- `MxMachineMotion`'s two fender modes use a correct closed-form underdamped update for the configured damping values. Chain pull uses exponential take-up. Existing cadence tests pass at 60/120/240 Hz.
- `RiderWeight.step()` preserves its exact displacement/rate response across the tested cadences. The issue is in `pose()`, not this integrator.
- The recovery step curve matches endpoint position/velocity at swing/stance boundaries. No replacement gait curve is proposed.
- MX joint snapshot tangents are intentionally limited to the interval's endpoint range. This can suppress unresolved extrema, but the current monotone contract and tests are explicit. This audit did not establish a sufficiently bounded replacement to recommend changing it.
- `DirtBikeVehicle.posture()` still uses `approach()` and binary stand-up decisions at lines 1192-1194. This remains a possible transition-smoothing work item; the earlier in-flight posture work cannot be assumed present in this checkout. It is not counted as an additional proven bug here.
- Camera landing boundaries were outside this audit's ownership.

## Validation

Executed the installed test runner directly, bypassing npm lifecycle hooks and model generation:

```sh
node_modules/.bin/vitest run tests/motocross-rider-weight.test.ts tests/motocross-rider-recovery.test.ts tests/motocross-machine-animation.test.ts tests/motocross-push-gait.test.ts
```

Result: **4 files passed, 23 tests passed**, duration **12.68 seconds**. Inline read-only Node probes confirmed the three findings above; no probe source was saved in production or tests. The focused suite passing confirms that the reported boundary contracts are currently missing, not that these defects are already covered.
