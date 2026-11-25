# Assignment 12 — continuous interrupted gear strokes

## Change

`src/simulation/offroad/mx-gear-stroke.ts` now retains both position and velocity when an accepted shift interrupts an active selector/boot stroke. A cubic Bézier bridge joins each channel to the existing canonical shift curve with the same endpoint velocity. The bridge control points stay inside the original selector range (−0.24 to +0.22 radians) and boot channels (0 to 1), so bounds do not require derivative-breaking clipping.

The selector bridge lasts at most 45 ms, boot-cover bridge 22 ms, and clearance bridge 30 ms. A moving channel near a travel limit shortens its bridge to keep the incoming tangent within travel. These are bounded animation transitions, not claims of measured anatomical acceleration. Isolated shifts preserve their existing curves and contact timing. Rapid shifts rejoin those curves within 45 ms and still complete within the existing 260 ms stroke. Gear acceptance and shift-cut timing are unchanged.

The three analytic rate fields are exposed on `MxGearStroke` for inspection. Existing consumers continue reading the same angle, cover and clearance positions. Sampling remains absolute on the recorded simulation clock; no frame clock, numerical integration or new model state is introduced.

## Reproduced improvement

| Interruption | Incoming rate | Rate immediately after accepted command |
| --- | ---: | ---: |
| Downshift → upshift at 90 ms, selector | +7.817898248869759 rad/s | +7.817898248869760 rad/s |
| Downshift → upshift at 63 ms, clearance | −52.22399999999999 /s | −52.22399999999999 /s |

The baseline reset both rates to zero. The new bridge retains them to floating-point precision and then decelerates into the next stroke.

## Verification

Command:

```sh
npx vitest run tests/motocross-shift-continuity.test.ts tests/motocross-control-animation.test.ts
```

**34 tests passed in two files**: five new continuity regressions and 29 existing control/rig tests. The new tests cover accepted 60–259 ms repeated/reversed commands, value and rate continuity, 160 repeated requests with bounded channels, canonical-curve rejoining, original completion timing, pause, out-of-order seeking and reset. The existing suite verifies accepted gear recording/replay for MX250/MX450, isolated selector-clearance ordering and actual boot/sleeve contact at both tested detail levels.

Focused ESLint and whitespace verification passed. The first new numerical-derivative assertion used an interval too broad for a deliberately shortened near-limit bridge; it was corrected to sample the local derivative. The implementation also normalizes the selector's neutral signed zero to preserve its original endpoint representation.

## Scope and limits

Only the shift controller, its new regression suite, and this report belong to this assignment. No model, geometry, environment, vehicle tuning, shift acceptance, or git-history changes were made. Existing single-shift contact contracts pass; these checks do not certify every interrupted boot-to-mesh contact or physical hardware frame rate. Integrated motocross acceptance remains the coordinator's responsibility.
