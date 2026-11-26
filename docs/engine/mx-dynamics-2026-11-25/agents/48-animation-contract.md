# Assignment 48 — Complete-riding animation traces and an adverse landing

Wave 8. **53/53 targeted tests pass across three suites.** All 52 existing
tests and their assertions remain; one new test preserves the original
held-input adverse landing at six continuation rates. This assignment
changes test controls only. It changes no runtime, physical threshold,
model, character, material, texture or authored environment.

## Diagnosis

The final broad sweep found the same MX450 Valley Ridge jump in three
contracts: live articulated pose, current suspension publication at 120 and
240 Hz, and joint-reversal reconstruction. Their fixed launch controls were
held through flight. The newly corrected momentum/integration path produces
a real flat crash before the complete-riding animation assertions finish.

The first 120 Hz crash is at **2.85 s**, with bottoming speed
**7.100861666 m/s**, above the unchanged **7 m/s** threshold. The takeoff
controls are throttle **0.4437776935**, front brake **0**, rear brake **0**,
and steering **−0.0005005556**. This is **not a held-front-brake failure**:
releasing the already-zero brake gives the identical trajectory. Releasing
steering changes bottoming speed by only approximately 2.3e−6 m/s and still
crashes. The diagnostic results and all cadence records are in
[48-animation-contract.json](../evidence/48-animation-contract.json).

| Continuation rate | Bottoming speed | Outcome |
| --- | ---: | --- |
| 120 Hz | 7.100862 m/s | Crash-flat |
| 240 Hz | 7.077238 m/s | Crash-flat |
| 480 Hz | 7.076880 m/s | Crash-flat |
| 960 Hz | 7.056598 m/s | Crash-flat |
| 1920 Hz | 7.062939 m/s | Crash-flat |
| 3840 Hz | 7.063701 m/s | Crash-flat |

Each continuation begins at the exact same real 120 Hz airborne checkpoint.
The new regression requires that equality, one crash, the flat-crash
classification, and bottoming above the actual specification threshold.
It also retains the established convergence bounds: less than 0.1 m/s
bottom-speed error, less than 0.001 m/s first-contact normal-speed error,
and less than 0.01 m/s for the final fine pair. It does not bless a coarse
numerical crash by changing the physical threshold.

## Retained fixture correction

The three complete-riding animation traces now use the existing
`motocross-player-dynamics.ts` public-landing-forecast rider during jump
flight. A shared test-only helper, `tests/motocross-flight-controls.ts`,
applies the same throttle/rear-brake pitch feedback. It uses only ordinary
rider inputs; it never selects AI physics or writes a pose, force, speed,
wheel state or suspension value.

Approach speed, initial gear, placement, duration and physical constants are
unchanged. Manual body input remains neutral, preserving the original
automatic-posture algebra. The whoops control traces, incoming braking
force tests and supermoto filter tests are unchanged. Every original
assertion is retained, including full extension, both full-travel events,
both rebounds, incoming-versus-current force timestamps, actual joint
matrices, sparse-publication accuracy, travel bounds, LOD independence,
pause/out-of-order invariance, and zero crashes for the complete-riding
fixtures. The diff removes no line from these three existing test files.

A coast-only diagnostic also survives the formerly failing jump, but no
new tuned throttle constant was introduced. The retained helper reuses an
already exercised feedback policy. The original held-input failure remains
an explicit adverse regression in `motocross-live-pose-coherence.test.ts`.

## Verification and practical limits

| Suite | Result |
| --- | ---: |
| Live pose coherence, including the added adverse check | 9/9 |
| Dynamic suspension timestamps | 14/14 |
| Joint reversal | 30/30 |
| **Distinct targeted total** | **53/53** |

The eight pose traces execute **12,256 CPU rig queries** at 30 and 60 Hz
publication, including LOD and out-of-order checks. Maximum articulated-rig
algebra error is 1.62e−8 m; maximum native endpoint hub error is 4.26e−6 m,
including Float32 root quantization. Mean interior hub error is
0.616–0.741 mm at 30 Hz and 0.124–0.160 mm at 60 Hz. Sparse impact intervals
still have larger local errors: maxima are **40.853 mm** and **18.911 mm**,
respectively. These CPU mathematical checks do not establish framebuffer
quality, physical-device frame rate or a browser/GPU pass.

The targeted run took 23.17 s wall time, including 18.10 s of tests. ESLint
and whitespace checks pass. A concurrent strict dependency-graph TypeScript
run with a 1 GB heap cap was killed with exit 137 and produced no diagnostic;
type success is not claimed here. Root deferred that check to the serialized
final tooling assignment rather than repeating the same resource failure.

The initial diagnosis used runtime fingerprint `a153c34d…`. The targeted
test run's full source fingerprint, observed during and after execution,
was `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`;
assignment 49 separately owned the contemporaneous AI repair. The adapter
remained `7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e`
and the ground solver remained
`68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3`.
All test file hashes and executed-command receipts are in the JSON evidence.

Reproduce the targeted acceptance without asset-regenerating lifecycle hooks:

```sh
MX_POSE_REPORT=1 node --max-old-space-size=1024 node_modules/vitest/vitest.mjs run \
  tests/motocross-live-pose-coherence.test.ts \
  tests/motocross-dynamic-suspension.test.ts \
  tests/motocross-joint-reversal.test.ts --maxWorkers=1
```
