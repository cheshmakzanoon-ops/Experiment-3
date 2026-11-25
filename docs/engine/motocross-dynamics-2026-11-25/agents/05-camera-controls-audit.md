# Assignment 05 — motocross camera and control-motion audit

Baseline inspected: `b527a7e0`. Read-only production audit; no models, materials, geometry, environments or production files changed.

## 1. Accepted rapid shifts erase selector and boot velocity

`src/simulation/offroad/mx-gear-stroke.ts`, `MxGearStroke.engage()` samples the active stroke and carries its three positions into a new stroke. It does not carry their derivatives. Every new `smooth()` envelope, including the carry envelope, has zero initial derivative. The accepted command therefore sets all three physical animation rates to zero instantaneously, even though positions remain continuous.

This occurs at legal shift intervals: `src/simulation/offroad/dirt-bikes.ts` specifies a 60 ms shift cut, and `DirtBikeVehicle.shiftPlayerGear()` accepts the next request once that clock expires. A 90 ms or 63 ms reversal does not require bypassing the shift guard.

Direct production-class reproduction (backward/forward differences with epsilon `1e-7` s): begin a downshift at clock 1, sample just before the interruption, call `engage(1, 1 + interval)`, sample just after it.

| Interruption time | Channel | Incoming derivative | Outgoing derivative |
| --- | --- | ---: | ---: |
| 90 ms | selector angle | +7.817881 rad/s | −0.000044 rad/s |
| 63 ms | boot clearance | −52.223827 /s | −0.000112 /s |

The tiny outgoing numbers converge to zero as epsilon decreases. Existing `motocross-control-animation.test.ts` checks same-position restart at 63 ms, but not rate continuity.

**Suggested implementation:** retain incoming channel derivatives and blend through a bounded Hermite transition, preserving the existing sleeve-clearance/cover contact ordering. Do not change shift acceptance, gear timing, mesh geometry, or foot-controller consumers. A stateful analytic channel can still be sampled deterministically on the simulation clock. Test value and derivative continuity at legal repeated upshifts, downshifts and reversals, and retain the existing actual-boot/sleeve contact tests. The engine change belongs entirely in `mx-gear-stroke.ts` and focused tests.

## 2. Camera heading response varies with refresh rate during a smooth turn

`src/rendering/offroad/chase-camera.ts`, `MotocrossChaseCamera.update()`, integrates heading as an exponential response to the newest target held across the whole redraw interval. Its heave path already accounts analytically for the line between consecutive measured target heights; heading does not.

Direct production-class reproduction on a flat track: initialize at heading zero, then for one second present a heading ramp `heading = 0.8 * seconds`, fixed speed 18 m/s, and an unchanged anchor. All rates follow the same physical heading samples at common times.

| Refresh | Final camera bearing |
| --- | ---: |
| 30 Hz | 0.724669450645 rad |
| 60 Hz | 0.718507564934 rad |
| 120 Hz | 0.715300795271 rad |
| 144 Hz | 0.714758158868 rad |
| 240 Hz | 0.713665874740 rad |

The 30 versus 240 Hz result differs by 0.011004 rad, about 6.4 cm at the camera eye and 16.4 cm at the gaze target in this case. Existing heading tests cover a held target and high-frequency jitter; a held-target exponential is already partition invariant, so those tests cannot reveal moving-target bias.

**Suggested implementation:** integrate a linearly changing unwrapped heading target analytically, using the same stable small-interval coefficient pattern as `filteredY`, while preserving intentional snap/rejoin behavior, flight-bearing handoff, and takeoff/touchdown edge timing. Review roll and gaze-height targets for the same endpoint bias. Add ramp, angle-wrap and changing-target cadence tests; preserve existing missed-redraw landing/camera tests. The change belongs in the pure camera controller, with no renderer/model changes needed.

## 3. Lower-priority rider-weight mapping continuity consideration

`RiderWeight.step()` itself is analytically integrated and well covered for bounded reversal and timestep partition invariance. It should not be replaced with another spring.

`RiderWeight.pose(automatic)` uses `automatic + position - abs(position) * automatic`. At nonzero automatic posture it has a derivative corner as the manual stroke passes through zero. For automatic posture 0.6, slope against manual position changes from 1.6 to 0.4. This is a real mathematical discontinuity, but its perceptual impact and alternative control feel need an integrated reproduction before treating it as a priority bug. A replacement mapping must preserve full manual ownership, neutral automatic posture, bounded output and existing finite-air-stroke momentum semantics.

## Validation boundary

The numeric observations above were executed with the production TypeScript classes through Node's TypeScript transformation. This audit does not claim real-time browser perceptual acceptance or measured real-rider motion. It identifies finite, independently implementable engine defects rather than introducing new authored animation or changing the character/bike models.
