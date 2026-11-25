# Assignment 17 — bounded motocross joint reversals

## Reproduction and result

The previous `sampleMxJoint()` clipped endpoint rates against the interval displacement and flattened equal-position endpoints. Real rebound extrema were consequently lost. A production MX250 Valley Ridge jump approach at 0.300–0.333 s demonstrates it: fork endpoints 74.732/74.066 mm, rates −1.106/+1.169 m/s, and a true 120 Hz midpoint of 61.055 mm. The old midpoint was 74.150 mm; the new bounded Hermite midpoint is 64.921 mm. Error falls from **13.095 to 3.866 mm** without exceeding physical travel.

Across eight six-second production jump/whoop traces, **301 measured interior-extremum samples are recovered**. Total absolute error across 8,592 fork/shock comparisons falls from **4.83530 to 4.33032 m (10.44%)**. Each case improves:

| Bike | Trace | Previous MAE | New MAE | Recovered extrema |
| --- | --- | ---: | ---: | ---: |
| MX250 | Valley Ridge jump | 0.6753 mm | 0.6043 mm | 51 |
| MX250 | Valley Ridge whoops | 0.5788 mm | 0.4255 mm | 77 |
| MX250 | Arena Nord jump | 0.5145 mm | 0.5011 mm | 17 |
| MX250 | Arena Nord whoops | 0.5555 mm | 0.5357 mm | 23 |
| MX450 | Valley Ridge jump | 0.6080 mm | 0.5335 mm | 43 |
| MX450 | Valley Ridge whoops | 0.5865 mm | 0.4972 mm | 46 |
| MX450 | Arena Nord jump | 0.6045 mm | 0.5703 mm | 18 |
| MX450 | Arena Nord whoops | 0.3789 mm | 0.3643 mm | 26 |

The rig uses production tracks, vehicles, `rideLine()` controls, adapter stepping at 120 Hz, and the production snapshot writer. Only the snapshot clock is supplied by the direct adapter rig. Recorded 30 Hz pairs are compared with their three intervening solver samples. Jump approaches use RIDGE TABLE at 13.5 m/s and TABLETOP at 13 m/s; whoops use 8 m/s, starting 12 m before the surveyed section. No crashes occur. Old errors were measured with the exact previous interpolation expression in a read-only diagnostic.

## Implementation and safety boundary

`src/rendering/offroad/mx-machine-pose.ts` admits signed Hermite only for opposed measured rates whose integrated displacement is coherent and whose interval has no detected contact/impact/reset discontinuity. Checks cover vehicle and crash changes, state/air-clock rewind, airborne state, front/rear load activation, skid contact, changed landing speed/pitch, increased bottoming/impact, and implausible displacement.

Both endpoints and equivalent Bézier control points must fit within the vehicle's actual fork/shock travel or steering lock. Their convex hull bounds the entire cubic. Safe intervals retain both observed endpoint velocities; unsafe controls or discontinuities retain the previous monotone fallback. Bounds match the Float32 representation of recorded hard stops; position clamping handles arithmetic round-off. Presented velocity remains the derivative of that same curve.

Assignment 11's finite optional-payload guards, exact/paused endpoints, legacy fallback, and coarse/invalid-time fallback remain intact. No physics force law, specifications, models, geometry, assets, environment, protocol layout, or git state changed.

## Tests and assertion correction

The new `tests/motocross-joint-reversal.test.ts` has 30 cases: all three joints at equal/nearly equal positions, both reversal directions, endpoint velocity continuity, mechanical stops, incompatible rates, twelve discontinuity markers, legacy/time fallback, and eight live traces.

With coordinator authorization, `tests/motocross-machine-animation.test.ts` retains endpoint-monotonicity assertions for same-direction rates. Opposed-rate intervals instead require physical bounds and improved error against the intervening production samples. The old unconditional endpoint bounds failed on both genuine production reversals. Existing aggregate accuracy, wheel/slider coherence, fender, replay/camera-cut, and other-vehicle checks remain.

Final validation:

- `node_modules/.bin/vitest run tests/motocross-joint-reversal.test.ts tests/motocross-machine-animation.test.ts tests/motocross-motion-boundary.test.ts` — **40/40 passed**, three files, 8.73 s.
- Focused ESLint on the changed production file and both test files — **passed**.
- A previously started plain `tsc --noEmit` exited 134 at Node's approximately 2 GB heap limit; it produced no completed typecheck result. The coordinator owns full TypeScript verification; no retry was run.

The improvement is bounded reconstruction of observed reversals, not inferred contact timing or additional spring simulation. C1 continuity is deliberately not promised across fallback boundaries. Measurements use higher-frequency production state; no GPU or subjective visual result is claimed.
