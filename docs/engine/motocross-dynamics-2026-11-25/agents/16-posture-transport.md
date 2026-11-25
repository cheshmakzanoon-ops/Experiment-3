# Assignment 16 — Recorded motocross rider posture

## Change

Added optional fixed-tick standing/dab tangents to the existing zero-mask motocross contact tail. `MX_POSTURE.RECORDED`, `STANDING_RATE`, and `DAB_RATE` occupy relative contact offsets +17, +18, and +19. `CAR_STRIDE` remains 331 and `PROTOCOL_VERSION` remains 17. The ordinary off-road channels remain the authoritative positions.

`writeWheelContact` records the actual `postureMotion` rates only when the live motocross rider/controller is available and both rates are finite after Float32 conversion. Its existing block clear removes stale optional bytes for other courses, supermoto, and recovery. Cars and road motorcycles retain their separate contact contracts.

The shared `sampleOffroadField` reader now reconstructs recorded stance and dab with cubic Hermite interpolation. Equivalent Bézier control points are bounded to standing 0..1 and dab -1..1. Signed tangents preserve real direction reversals, including movement between equal endpoint poses; recorded endpoint positions remain exact. Sampling uses snapshot time only and does not integrate presentation state.

Recorded poses hold at pause, equal/backward time, placement/teleport, vehicle changes, crash counts, rider-state changes, and rider-clock resets. Missing markers, invalid optional rates, or gaps over 125 ms retain the exact legacy linear fallback. Existing legacy rider-discontinuity behavior is retained when neither endpoint has the optional recorded contract. No model, mesh, asset, material, environment, tuning, adapter, frame-state, or git changes were made.

## Files

- `src/simulation/protocol.ts`
- `src/simulation/wheel-contact-state.ts`
- `src/rendering/snapshot-interpolation.ts`
- `src/rendering/offroad/mx-rider-pose.ts` — new
- `tests/motocross-posture-transport.test.ts` — new
- This report

## Measured reconstruction error

Production simulations run at 240 Hz. Each 30 Hz endpoint pair is sampled at its seven intermediate physics ticks, covering a fast standing response and a slow steering/dab reversal. Each row includes 203 interior samples. Errors use normalized pose units against the actual intermediate worker snapshots.

| Vehicle / course | Channel | Linear mean absolute error | Recorded mean absolute error | Linear peak error | Recorded peak error | Mean error reduction |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| MX450 / Valley Ridge | Standing | 0.002059127 | 0.000029471 | 0.022177815 | 0.000553493 | 98.57% |
| MX450 / Valley Ridge | Dab | 0.000718299 | 0.000092659 | 0.011417533 | 0.003968199 | 87.10% |
| MX250 / Arena Nord | Standing | 0.002059127 | 0.000029471 | 0.022177815 | 0.000553493 | 98.57% |
| MX250 / Arena Nord | Dab | 0.000421111 | 0.000081747 | 0.006722213 | 0.003395505 | 80.59% |

These are the exercised trajectories, not a claim about every possible rider command. Coarse endpoint data cannot recover an unrecorded command transition exactly.

## Verification

The focused test verifies actual `Simulation.makeFrame` writer values, agreement between the direct renderer reader and `PresentedFrame`, endpoint positions/slopes, equal-position reversals, bounded extreme finite tangents, discontinuity holds, malformed/unmarked/long-gap fallback, compact replay transport and deterministic seeks, and unmodified legacy/other-vehicle interpretation.

Passed 67 tests across seven focused and adjacent files:

```text
node_modules/.bin/vitest run tests/motocross-posture-transport.test.ts tests/motocross-posture-dynamics.test.ts tests/snapshot-interpolation.test.ts tests/motocross-motion-boundary.test.ts tests/motocross-machine-animation.test.ts tests/motocross-push-gait.test.ts tests/road-bike-presentation.test.ts
```

Focused ESLint passed for all five source/test files. A started full `tsc --noEmit` was interrupted without diagnostics when root assigned the integrated typecheck to its 5 GiB run; no local full typecheck result is claimed.

## Replay handoff

The compact recorder already copies the full contact tail and the focused test proves the new fields survive expansion; zero-filled old optional slots remain linear. The later replay owner should include +17..+19 in full-session persistence/seek checks without a stride or version change.
