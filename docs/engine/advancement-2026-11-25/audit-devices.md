# Audio and input audit — 2026-11-25

Baseline: `350119e8`. Production files were read only. Measurements used Node
v24.22.3 and actual exported production functions; proposed arithmetic lived only
in an inline process. No authored audio profiles, visuals or vehicle values changed.
Reusable probes, baseline snapshots and recorded results:
`/tmp/aeebac160835-audio-audit/{loudness-probe.mjs,menu-input-probe.mjs,measured-results.json}`.

## A. Highest-value engine work: exact loudness arithmetic reuse

**Scope:** `src/audio/engine-loudness.ts`, focused arithmetic tests/benchmark.
Actual caller: `EngineVoices.update()` invokes `loudnessScale()` for up to four
active voices. Each nonzero band evaluates up to 39 harmonics.

For every harmonic, `bandPower()` calls `kWeightPower()` and `lowpassPower()`.
The latter rebuilds the same two coefficient arrays, evaluates cutoff sine/cosine
and exponentiation, and all three biquads independently evaluate the identical
frequency cosine pair. A voice update can build 234 coefficient arrays.

Prepare low-pass coefficients once per `loudnessScale()` call; share that result
across all three bands. Evaluate `w`, `Math.cos(w)` and `Math.cos(2 * w)` once per
harmonic, and pass the exact pair to each biquad. Preserve the existing public
`bandPower`, `kWeightPower` and `lowpassPower` entry points and qDb behavior.
Keep every multiplication/addition and accumulation order; do not substitute a
trigonometric identity, approximate frequencies or quantize cutoff.

Measured in-memory candidate, five alternating runs after warmup:

| Workload | Baseline median | Candidate median | Ratio |
| --- | ---: | ---: | ---: |
| 20,480 normalisers, 4,096 varied cases | 143.090 ms | 45.440 ms | 3.149× |

All 4,096 cases matched by `Object.is` (maximum absolute difference zero).
Cases cycled all 24 profiles. Deterministic LCG seed 123456789,
`seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0`, divided by `2**32`.
For each case draw `base = 50 + r * 1600`, Hz `[max(50, base/2), base, base*2]`,
gains `[r*.4, r*.4, r*.15]`, cutoff `500+r*10000`, target `.01+r*.09`.
Each timed sample traversed this set five times and consumed the result in a sum.
Baseline samples: 140.853, 146.206, 142.271, 143.090, 146.752 ms.
Candidate samples: 47.320, 45.420, 45.440, 45.702, 43.456 ms.
These are arithmetic microbenchmarks, not browser frame-rate measurements.

Acceptance should additionally cover zero/silent gains, extreme cutoff clamps,
public qDb variants, frequencies around the 20 kHz termination and all authored
profile/rpm/load cases. Existing `tests/engine-loudness.test.ts` supplies relevant
contracts. Avoid eagerly creating cached waves on the all-zero-gain path.

## B. Optional cold-start companion, after A is owned

**Same source file as A; serialize implementation ownership.** `waves()` already
caches per profile. Only the first encounter pays for three 2,048×39 sine scans.
A lazy, bounded `Float64Array(2048 * 40)` sine basis preserves the original theta,
sine and accumulation values and eliminates repeated transcendental work.

All 72 profile/band peak and power results matched exactly by `Object.is`.
Scanning all 72 spectra: baseline median 68.252 ms, table median 5.977 ms over
five runs. Table construction measured 1.685 ms; retained storage is 655,360 bytes
(640 KiB). This is first-use work across all families, not steady-state savings
and not evidence that every family is loaded during startup.

Keep the table bounded; preserve arbitrary exported input lengths with a fallback
above 40 harmonics and exact behavior for shorter/silent spectra. Use Float64,
not Float32, and no recurrence approximation. Implement separately only if the
first-use stall benefit justifies the memory cost on target browsers.

## C. New caller defect: menu controller ownership survives device/focus loss

**Disjoint scope:** `src/ui/menu-gamepad.ts` and focused menu input tests.
Actual caller: `Interface` constructs it at line 589; it continuously polls the
first connected gamepad for visible menus/dialogs. `wasActive` tracks only whether
a prior poll had a scope. No gamepad identity, blur listener or visibility listener
resets the baseline. `document.hidden` is checked only inside RAF.

Production-class reproductions with fake RAF/Gamepad/DOM boundary objects:

1. Two connected standard pads, active menu, pad A first with no held buttons.
   Baseline two polls. Hold A and START on pad B. Disconnect pad A before the next
   poll so selection changes directly to B. **Observed: one focused-button click
   plus one form submission**, without a fresh press on the newly owned pad.
2. Active menu and neutral pad, baseline two polls. Dispatch hidden visibility,
   hold A/START, dispatch visible visibility, then deliver the next RAF with no
   intervening hidden RAF. **Observed: the same click and submission.** Hidden
   tabs need not receive a poll that would reset `wasActive`.

The harness imported the actual `MenuGamepad`; it did not replace its methods.
It supplied a root whose `#menu .menu-body` held a focused clickable control and
`#sessionForm` counted submissions. `navigator.getGamepads` returned mutable pads;
RAF callbacks were manually queued. Run under
`node --experimental-transform-types --input-type=module` from repository root.
This proves polling behavior, not physical-device/browser certification.

Track device identity (index/id/mapping), baseline replacements and disconnects,
and reset ownership immediately on blur/hidden events. Returning focus should
require a fresh press; held D-pad/stick repeat state also needs an explicit policy.
Prefer native-browser regression coverage alongside deterministic poll tests.
Do not change mappings, navigation geometry or menu styling. Existing
`e2e/60-launch-board.spec.ts` covers ordinary navigation but not these transitions.

## D. Menu controller teardown is incomplete

**Related caller-lifetime scope:** `src/ui/interface.ts`, `src/main.ts`, and C's
file, so coordinate with C. `GameApp.dispose()` releases driving input/pump but
never releases `Interface.menuPad`; its recurring RAF remains owned. Moreover,
`MenuGamepad.dispose()` cancels RAF but does not remove constructor-installed root
`pointerdown`/`keydown` listeners. A post-dispose keydown still deleted the root's
pad marker in the reproduction. Provide a real UI teardown owner and remove
listeners; prove no polling/actions/listener effects after application disposal.
Treat this as a lifetime defect, not a measured memory/FPS claim.

## Reviewed without a new defect

`InputController` already baselines reconnects, selected-device replacements,
focus/visibility loss and consumed shift edges. Its real `GameApp` caller checks
session ownership after callbacks. `InputPump` rejects stopped/reentrant samples.
Do not duplicate the previous preview/resume/rumble/pause/shift work. The spatial
12-car bound matches the actual options limit of 11 opponents; it is not a defect.
