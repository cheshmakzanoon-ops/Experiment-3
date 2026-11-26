# Agent 09 — Smooth rider-weight composition

Date: 2026-11-25. Wave 2. Addresses finding 1 in `03-motion-audit.md`.

## Change

Changed only `RiderWeight.pose()` in `src/simulation/offroad/rider-weight.ts`. Added `tests/motocross-rider-blend.test.ts`; existing tests were not edited. No adapter, ground solver, model, character, geometry, material, venue, or environment changes belong to this patch.

The former composition `a + p - a * abs(p)` had different neutral slopes, `1 + a` and `1 - a`. The replacement is

```text
g(a)   = 3 * (1 - a²) / (3 + a²)
B(p,a) = a * (1 - |p|³) + g(a) * p + (1 - g(a)) * p³
```

Here `p` is the analytic manual stroke and `a` is the existing normalized automatic posture. The exact zero-stroke return is retained, including signed zero. A final clamp guards floating-point roundoff; the curve itself is bounded by its monotonicity, rather than relying on clipping an overshooting polynomial.

## Response and bound

- `B(0,a) = a`: unchanged automatic neutral posture.
- `B(-1,a) = -1` and `B(1,a) = 1`: full manual authority at both endpoints, including saturated automatic posture.
- `B(p,0) = p`: unchanged linear manual response when automatic posture is neutral.
- `B(-p,-a) = -B(p,a)`: symmetric forward/backward behavior.
- Both neutral first derivatives equal `g(a)`; both neutral second derivatives are zero. The composition is C2 at neutral and smooth in `a` throughout its normalized range.

For either half-stroke, let `s = sign(p)` and `x = |p|`. Its manual derivative can be written as

```text
dB/dp = (1 - x²) * g(a) + x² * 3 * (1 - s*a)³ / (3 + a²).
```

Both terms are nonnegative for `|a| <= 1`, with weights summing to one. The response is therefore monotone over the entire stroke and stays within its exact endpoint values. This also covers automatic values arbitrarily close to saturation.

The intermediate control response changes deliberately: neutral gain is the same from both directions and decreases continuously as automatic posture approaches an endpoint. It remains positive for every unsaturated automatic value. At saturation, a zero neutral derivative is required by a smooth monotone response that already equals an endpoint. The curve keeps full opposite-direction authority without a singular denominator or a neutral velocity kink.

`step()`, its analytic integration, spring velocity, displacement, reset behavior, and every airborne displacement/momentum caller are untouched. Calling `pose()` remains a pure observation of the stroke.

## Verification

Executed the installed runner directly, without npm lifecycle hooks:

```sh
node_modules/.bin/vitest run tests/motocross-rider-blend.test.ts tests/motocross-rider-weight.test.ts
```

Result: **2 files passed, 29 tests passed** (15 new composition tests plus 14 existing rider-weight tests), **4.47 seconds**.

The new coverage checks one-sided first and second neutral derivatives, exact neutral/endpoints, the linear unassisted stroke, symmetry, dense monotonic/bounded samples including near saturation, both reversal directions at 120/240/480 Hz, identical stroke/body values at common sample times, and unchanged state after pose sampling. The existing suite retains actual takeoff/air correction/landing, neutral/AI/supermoto, reset, and input-journal replay coverage.

An inline numeric reproduction of the audit's two-second backward hold followed by full forward reversal at `a = 0.45` measured the maximum adjacent finite-difference acceleration around the neutral crossing:

| Cadence | Previous composition | Smooth composition |
| --- | ---: | ---: |
| 120 Hz | 236.362 | 7.857 |
| 240 Hz | 714.358 | 7.098 |
| 480 Hz | 1203.791 | 6.965 |

Units are normalized body command per second squared. The new per-tick velocity change shrinks with timestep; the previous discontinuity does not. The two authored TypeScript files were formatted with the installed Prettier executable. No commits or pushes were made.
