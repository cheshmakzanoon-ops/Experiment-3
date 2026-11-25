# W05E — audio cache and context composition

Assignment 29/60. **No new production defect found; no production source changed.**
The completed changes compose correctly at the recorded graph boundary. This
assignment adds two integration cases, an actual-baseline proof runner, and a
compact source/hash record. Native PCM remains assigned to wave 6.

## Reviewed ownership

The W03A filter coefficient reuse is local to one normalizer call. It retains
neither a voice nor an audio context. The W04A 640 KiB sine basis contains only
profile-independent Float64 numbers. The existing profile waveform cache remains
a WeakMap keyed by profile object; its prior behavior for distinct objects and
mutation of an already-cached profile is covered by the coefficient suite.

`EngineVoices` creates each `PeriodicWave` through its own context and keeps its
family-to-wave map on that graph instance. Numeric reuse does not transfer a
browser wave between contexts. Voice reassignment still dips gain, retunes the
same oscillator owners, and schedules the original band, limiter, pan and filter
automation. Disposed voices reject subsequent updates.

`RacingAudio.stop()` revokes pending preview intent and silences the retained
graph. Disposal detaches its graph fields before awaiting context closure, so a
replacement start can proceed independently. `UiSounds.suspend()` similarly
detaches its current context, noise, repeat clock, bus nodes and cue branches,
while keeping its event listener owner usable. Old cue-ended callbacks close
over the old branch; delayed resume/close promises do not adopt the new graph.

The existing suites already exercise mute/unmute, focus loss, autoplay refusal,
failed graph construction, teardown failures, and the main host's page callback
ordering. Those scenarios were not reimplemented as another broad harness.

## New composition cases

`tests/engine-audio-advancement-composition.test.ts` uses the real production
owners with a recording Web Audio boundary.

1. **Cold normalization, warm caches, separate contexts.** Twelve frames rotate
   six authored vehicle families through the four stable engine voices. The
   frames vary load, RPM, distance order, Doppler, interior/exterior view,
   followed car and family reassignment, then shrink the grid to two cars.
   The first graph uses a cold module; the next two share its warm numerical
   caches. Context sample-rate metadata is 44,100, 48,000 and 96,000 Hz. Recorded
   parameter values/times, waveform coefficients, assignments, spatial trace,
   presence and teardown observations match exactly. Every wave belongs to its
   own context. All 13 oscillators stop once, nodes disconnect, stale updates do
   nothing, and source frame bytes remain unchanged.

2. **Two audio owners across a replacement.** Real race voices and menu cues
   start at an old context time of 60 seconds. Both owners then have pending
   resume work; race preview activation is held while menu cues are already
   scheduled. Stop/suspend cancels that intent. Old context closures remain
   pending while the race graph and menu cue graph are replaced at time zero
   with 96 kHz context metadata. Captured old ended callbacks and the delayed
   resume/close completions leave both new graphs' scheduling and connections
   unchanged. The new race graph remains playing, its next deliberate preview
   works, and the abandoned preview never schedules its center tone.

## Actual original-source comparison

The retained runner is
`scripts/engine-advancement/audio-composition-proof.mjs`. It extracts the six
named workload declarations from the new test, then imports each tree's actual
`EngineVoices`, protocol, vehicle fixtures and recording context in separate
sequential Node processes. It does not reconstruct or substitute the old
normalizer. The coordinator supplied the original tree pinned to
`350119e8ec0606e8c5de5b3ab80df41104025679`.

The compact record is `evidence/w05e-audio-composition.json`.

| Observation | Exact matched result |
| --- | ---: |
| Graphs per implementation | 3 |
| Frames per graph | 12 |
| Synthesis voices / oscillators per graph | 4 / 13 |
| Parameter events in active graph records, total | 1,890 |
| Periodic waves per graph, including shared limiter LFO | 19 |
| Serialized observation bytes per implementation | 487,954 |
| Numeric or structural differences | 0 |

The matched observation SHA-256 is
`2f0476466eacd6a2bb5fced0c8f912fa9f699692d3f6b8e5c0f2c9be3f09ec14`.
The runner first performs deep strict equality on V8-deserialized observations
and then asserts byte equality. V8 serialization preserves signed zero, NaN and
undefined; the digest does not replace the direct comparison. The byte count
includes active, disposed and post-disposal records, and is not an audio sample
count.

The summary records Node and TypeScript versions, runner/workload hashes, and
before/after hashes for eleven named engine and fixture files in each tree.
Those eleven include every changed audio implementation involved in this
scenario, but are explicitly a selected source record rather than a full
transitive dependency manifest. The runner relies on the coordinator's baseline
pin and does not invoke Git. It refuses to overwrite its output and removes only
its own temporary generated scripts/observations.

Reproduce with distinct actual source trees and a new output path:

```sh
node scripts/engine-advancement/audio-composition-proof.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/audio-composition-recheck.json
```

## Validation

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-audio-advancement-composition.test.ts \
  tests/engine-loudness-coefficients.test.ts \
  tests/engine-loudness-sine-basis.test.ts \
  tests/racing-audio-lifetime.test.ts tests/ui-audio-lifetime.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
node node_modules/eslint/bin/eslint.js \
  tests/engine-audio-advancement-composition.test.ts \
  scripts/engine-advancement/audio-composition-proof.mjs
```

**53 tests passed across five files**: 2 new composition, 8 coefficient,
7 waveform-basis, 19 race audio lifetime, and 17 menu audio lifetime cases.
Scoped ESLint passed. The final reusable proof runner reproduced the same exact
observation bytes and digest. No timing, full compiler/build, browser launch,
Git operation, npm lifecycle hook, authored audio tuning or visual-content edit
was performed by this assignment.

## Limits

These are recorded graph commands, ownership and exact arithmetic results.
The recording boundary does not render PCM or model browser resampling,
PeriodicWave normalization, audio-device behavior, or automation smoothing
constants. Using three context sample-rate values checks resource separation;
it does not certify perceptual consistency across hardware rates. The existing
48 kHz analytic reference is unchanged. Native OfflineAudioContext and live
browser acceptance remain with the later browser wave; no audible-quality,
startup-duration or game-frame-rate claim follows from this work.
