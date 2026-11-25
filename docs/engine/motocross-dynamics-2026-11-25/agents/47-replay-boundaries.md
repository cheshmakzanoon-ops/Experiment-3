# Assignment 47 — bounded optional motion at replay endpoints

## Result and scope

The pre-existing mudguard endpoint gap identified by assignment 45 is repaired in the optional machine-motion reader. A marked payload with front or rear flex outside **−0.32…1** now takes the existing legacy fallback consistently at exact endpoints, interpolation, pause, and held reset boundaries. Its source recording remains unchanged.

The repair changes only `src/rendering/offroad/mx-machine-pose.ts`. It adds the controller's existing displacement envelope to the shared validation predicate and routes all existing readers through that predicate. It does not change the force solver, motion controller, authored model, mesh bounds, materials, environment, vehicle specifications, snapshot schema, or primary chassis/rider state. The check uses scalar comparisons and adds no per-read allocation.

The owned boundary test file gains four cases, including separate MX250 and MX450 live-rig regressions. No child agents or git operations were used. Source and tests were frozen before the coordinator's final combined acceptance; only this report was written afterward.

## Contract and repair decision

`FenderFlex.update()` already limits the physical motion controller to **−0.32…1**, and its comment states that the existing mesh bounds cover that envelope. Float32 publication of the lower stop is `−0.3199999928474426`, which remains inside the same closed interval. The upper stop is exactly representable as `1`.

The previous reader checked finiteness but returned an arbitrary finite displacement unchanged at an exact endpoint. Its interior cubic was clamped, producing inconsistent handling between a paused or fully sampled frame and an interpolated frame. A value such as `1e30` could therefore reach the actual mesh's morph influence even though it did not make the world matrix non-finite.

The existing optional extension is explicitly all-or-nothing: a malformed marked block already falls back as a whole for non-finite values. The new range validation follows that contract instead of inventing a separate partial repair. For an invalid block:

- Direct fender and joint readers decline the optional motion.
- `PresentedFrame` clears its copied optional machine marker and eight machine fields, allowing the existing legacy presentation path to supply the pose.
- The original replay/worker frame is not edited.
- A valid older endpoint remains exact even when an unused future endpoint is corrupt.
- Unmarked legacy payloads and other vehicle contracts retain their existing interpretation.

The chain's real consumer already clamps its separate signed pull to **−1…1**. This assignment leaves that behavior unchanged and does not expand the repair to primary positions or arbitrary rate limits.

## Red/green and actual replay verification

The same nine-test boundary file was run before and after the production change. Before the change it returned **six passed / three failed**. The failures expose the finite-range fallback and the two actual-bike replay comparisons. Its new valid-limit/legacy-preservation case already passed before the repair, as expected.

On the final source, the focused acceptance result is:

| Test file | Passed | Failed |
| --- | ---: | ---: |
| `motocross-motion-boundary.test.ts` | 9 | 0 |
| `motocross-machine-animation.test.ts` | 5 | 0 |
| `motocross-joint-reversal.test.ts` | 30 | 0 |
| **Distinct total** | **44** | **0** |

The existing machine-animation and joint-reversal assertions were not modified. Earlier and repeated runs are not added to this count. Focused ESLint also passes on the final reader and boundary test.

The new malformed-frame matrix covers both mudguard fields with values `−1e30`, `−0.320001`, `1.000001`, and `1e30`. It checks normal interpolation, exact selected endpoints, repeated pause samples, a held teleport/reset boundary, source immutability, and the valid endpoint adjacent to a corrupt future frame. Exact valid displacement limits remain byte-identical, and an unmarked legacy payload remains untouched even if unused optional bytes contain a large value.

The actual-rig tests record malformed finite frames through `ReplayRecorder`, seek them in forward, reverse, and repeated order, and inspect the existing named front and rear mudguards through `BikeShells`. For both MX bikes, the rendered morph values stay within the existing envelope and their transforms/morphs exactly match a reference with the optional block explicitly absent. The presented full frame also exactly matches that legacy reference. Across both bikes and both corrupted fields, the eight seek fractions produce **64 actual rig updates**, including the reference updates. No model definition is changed to obtain the result.

These are CPU-rig and replay-contract checks. They do not establish GPU performance or a visual judgment of every malformed primary snapshot.

## Valid generated motion is unchanged

A separate before/after diagnostic runs the actual `Simulation` with both MX bikes on both venues. It uses four-second controlled suspension fixtures: the initial chassis is raised by 0.13 m with −1.1 m/s heave, then ordinary throttle, brake, and steering input advances the real solver. This is a bounded component excitation, not a claim of a naturally driven full lap.

The four runs produce **1,924 authoritative snapshots**, of which **1,920 carry measured machine motion**, and **2,400 presented samples** across 30 Hz frame intervals. The diagnostic hashes complete authoritative snapshots, complete `PresentedFrame` buffers, and the seven direct position/rate/joint reader results. **Every per-run hash and measured result is exactly equal before and after the repair.** One run reaches the published lower displacement stop, so the comparison also verifies that Float32 rounding at that physical bound is accepted.

| Venue / bike | Minimum measured flex | Maximum measured flex | Presented samples | Before/after |
| --- | ---: | ---: | ---: | --- |
| Valley Ridge / MX250 | −0.246418804 | 0.520012200 | 600 | Exact |
| Valley Ridge / MX450 | −0.319999993 | 0.619195998 | 600 | Exact |
| Arena Nord / MX250 | −0.246559978 | 0.518086791 | 600 | Exact |
| Arena Nord / MX450 | −0.319641441 | 0.619654059 | 600 | Exact |

This isolates the change to malformed optional flex. It does not substitute for the coordinator's final full regression suite or the separate native browser journey.

## Reproduction, receipts, and source identity

Run the committed focused regressions without asset-generation hooks:

```sh
node_modules/.bin/vitest run \
  tests/motocross-motion-boundary.test.ts \
  tests/motocross-machine-animation.test.ts \
  tests/motocross-joint-reversal.test.ts
node_modules/.bin/eslint \
  src/rendering/offroad/mx-machine-pose.ts \
  tests/motocross-motion-boundary.test.ts
```

Task-local receipts are in `test-results/a47-replay-boundaries/`: `red.json`, `final.json`, their logs, `summary.json`, the exact pre-repair helper copy, `valid-trace.ts`, and the before/final trace JSON and logs. The trace JSON stores every full snapshot/presentation/scalar digest. An intermediate allocation-equivalent implementation and its passing results are retained separately; the final acceptance and identities below refer to the scalar range check.

| File or state | SHA-256 |
| --- | --- |
| Machine reader before this repair | `f80b5f0116fc6c202c47eef3bd93c0ce17498016a50d066c16e2deb02eec74db` |
| Final machine reader | `361ad30ee2e7ae5a3c0202ae471c7423f0e0db14bf98639d390364d83403dc9e` |
| Final boundary test | `64f7bb33545a2a60946fc06f880329dbeff9a8991af04cb716fdcaf4901cffa9` |
| Unchanged actual rig consumer, `bike.ts` | `63363c3e43e471398a55267188a791a81bfb9c58fba7a85eb5d51cc59aeae748` |
| Unchanged authored dirt-bike model | `0eedfe6ff1db8d68de14c4855a6204f1503fadc532268622f71f455987b83566` |
| Unchanged physical machine-motion controller | `435aa0136a1d6930b0190722d24b8f4dd4400ef1e9f147221fe4a327dd948a3e` |
| Unchanged `PresentedFrame` implementation | `3f3a05f7d07df1c02eacd9d8f6817edeee1005ae0a39161ae7f65c7ef8b5c2ec` |

The last four hashes match their captured pre-repair values. The final focused tests, lint, and before/after trace comparison completed successfully. No validation process remains running; production and test ownership are returned to the coordinator.
