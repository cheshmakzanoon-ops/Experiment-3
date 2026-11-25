# W06D — native audio advancement acceptance

Assignment 34/60, wave 6. **The first native run failed both new cases. The
revised PCM contract and UI timeout diagnostics are prepared for another exact
source CI run; native acceptance remains pending.** No production source,
authored audio profile, recipe, tuning, model, character, environment, dependency,
or workflow changed.

Owned files:

- `e2e/engine-native-audio-advancement.spec.ts`
- `e2e/fixtures/engine-native-audio-advancement.ts`
- `e2e/fixtures/engine-native-audio-advancement-original.ts`
- This report.

## Portable actual-source reference

The reference is the complete, **7,256-byte original**
`src/audio/engine-loudness.ts`, read directly from commit
`350119e8ec0606e8c5de5b3ab80df41104025679` using read-only `git show`.

| Identity             | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Original Git blob    | `d784c320267e79bcfd6e2465e220674e044108b6`                         |
| Original SHA-256     | `01c9b225d95e3122fe3dff2278d40e8b279ef455bf5941c362d870adba5e3f00` |
| Shared source inputs | 31, all byte-identical to the original commit                      |

The archival fixture stores the original text as joined string literals; the
join preserves its complete bytes, including the final newline. The native
spec validates both its Git blob hash and SHA-256 before bundling. No function
is reconstructed, renamed, extracted, approximated, or copied from the edited
normalizer.

The reference bundle exports the actual `EngineVoices` class. Its graph and all
31 shared source inputs—including spatial selection, profiles, vehicle data,
protocol, limiter behavior, and supporting math—were compared byte-for-byte
against the pinned commit. Their original blob hashes and SHA-256 values are
retained in the fixture and asserted again in CI. The esbuild input manifest
must match that complete shared-input list.

One esbuild resolution hook supplies the archived loudness text for
`./engine-loudness.ts`. Its unchanged relative imports resolve from the original
production directory, `src/audio`. The source text itself is not rewritten.
Separate baseline and current bundles give the normalizers separate module
caches while retaining the same original graph and authored inputs. The shallow
CI checkout therefore does not need a second checkout or access to historical
Git objects at test time.

## Preserved failed native checkpoint

Workflow **45573448610**, source **`9922926`**, used the locked Playwright 1.55.1
Chromium 140.0.7339.186 browser. The original assertion required zero differing
PCM samples/bytes and equal PCM digests. It failed at the first comparison with
23,419 differing sample values. The attachment also contains independent
same-implementation controls:

| Comparison                            | Differing samples | Differing bytes | Maximum absolute error |
| ------------------------------------- | ----------------: | --------------: | ---------------------: |
| Original/current, cold 44.1 kHz       |            23,419 |          23,635 |   7.450580596923828e-9 |
| Original/current, warm 44.1 kHz       |            24,824 |          25,062 |   8.381903171539307e-9 |
| Original/current, 48 kHz              |            33,112 |          33,529 |  1.6763806343078613e-8 |
| Original/current, 96 kHz              |            69,429 |          70,805 |   2.421438694000244e-8 |
| Original/original, cold/warm 44.1 kHz |            24,411 |          24,665 |   7.450580596923828e-9 |
| Current/current, cold/warm 44.1 kHz   |            24,235 |          24,473 |   8.381903171539307e-9 |

The original compared against itself also failed byte equality. That establishes
that the fully mixed native output was not bit deterministic in this run; it
does not establish an optimization arithmetic defect. The retained traces match
between implementations, and the output was finite, nonzero and stereo. Existing
arithmetic and graph-command proofs remain exact; they are separate evidence
from this native PCM result.

The complete 51,044-byte failed PCM attachment remains in the coordinator's
checkpoint archive as `native-audio-advancement-pcm.json`, SHA-256
`c78787536f36e6a57db69b3d6ab7bfb7c8e90ee93e2f3c2c1fbdb5352156dff1`.
The failed source commit, browser log, trace ZIPs and original assertion are
preserved. No PCM sample arrays were collected, so individual failed sample
values cannot be reconstructed from this attachment; the raw difference counts,
maximum errors, signal statistics and digests are retained.

Chromium's [AudioSummingJunction declaration](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/audio_summing_junction.h)
uses a pointer hash set for connected outputs. Its
[rendering-list update](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/audio_summing_junction.cc)
copies that iteration order, and
[AudioNodeInput](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webaudio/audio_node_input.cc)
sums the resulting connections sequentially. Different allocation/order of
three or more incoming Float32 signals can change rounding because addition is
not associative. This is a source-supported explanation, not a measurement of
the failed browser's internal pointer order; those links describe the inspected
Chromium main implementation, not a verified checkout of its exact locked tag.

## Case 1 — exact native inputs and bounded stereo PCM

Both constructors run the real four-voice `EngineVoices` graph in native
`OfflineAudioContext` instances. Each 0.64-second render schedules four finite
states with changes in RPM, load, cutoff, interior view and Doppler. The four
authored families are V6 turbo hybrid (`apx01`), turbo inline four (`tc1`),
electric (`eh3`), and V4 motorcycle (`gpr1`).

Voice identities and families remain stable within a render. This matters:
`setPeriodicWave()` changes the waveform immediately, while AudioParam events
can be scheduled into the future. The fixture does not schedule a future family
change by applying its waveform prematurely. Existing composition cases already
exercise family reassignment at the control-event boundary.

The native cases use this sequence:

| Render pair | Sample rate | Numerical module state                 |
| ----------- | ----------: | -------------------------------------- |
| First       |   44,100 Hz | Cold waveform/profile caches           |
| Second      |   44,100 Hz | Warm caches, fresh contexts and graphs |
| Third       |   48,000 Hz | Warm caches, fresh contexts and graphs |
| Fourth      |   96,000 Hz | Warm caches, fresh contexts and graphs |

The four principal pairs still compare **297,216 Float32 sample values per
implementation**. Extra original/original and current/current renders at 48 and
96 kHz extend the existing 44.1 kHz cold/warm self-controls to every rate. One
native perturbation render brings the fixture to **13 renders and 1,019,520
sample values**. These are authored budgets, not claimed passing CI results.

Exactness applies to the inputs supplied to native processing. Forwarding
observers record every PeriodicWave coefficient, wave assignment, graph
connection, node configuration, initial parameter value, direct value write,
oscillator start, and each automation call used by this production graph.
Numeric arguments are encoded by their IEEE-754 binary64 bits, retaining signed
zero. Event sequences are directly compared before their SHA-256 digests are
retained. Original/current input differences must be zero; their spatial and
presence traces must also match exactly, and input frames must remain unchanged.
No tolerance is applied to the optimized arithmetic's supplied values.

The native mixed-output contract is deliberately distinct:

- Float32 unit roundoff is `u = 2^-24`. Four three-band junctions and the
  four-voice junction perform `n = 4*(3-1)+(4-1) = 11` additions. The standard
  accumulated rounding expression is `gamma_n = n*u/(1-n*u)`; comparing two
  rounded evaluations motivates the fixed paired budget
  `b = 2*gamma_11 = 1.3113030448158677e-6`.
- For each channel, maximum absolute sample error must be at most
  `b * max(originalPeak, currentPeak)`, and RMS error must be at most
  `b * max(originalRMS, currentRMS)`. The latter also bounds relative RMS error.
  The budget is defined from Float32 arithmetic and graph addition count; it is
  neither fitted to the observed largest error nor increased automatically.
- The channel mean-square energy difference must be no larger than
  `2 * originalRMS * allowedRMSError + allowedRMSError^2`. This follows directly
  from Cauchy-Schwarz applied to `current = original + error`.
- Every original/current pair and both same-implementation controls at each
  rate must satisfy this same contract. Each channel must be finite and have
  RMS above 0.001, while the complete render must have a nontrivial stereo image.
  Raw differing-sample and differing-byte counts, maximum errors, PCM digests,
  channel energies, bounds and RMS errors remain in the attachment.

The usual `gamma_n` summation bound scales with the sum of input magnitudes.
Using measured output peak/RMS here is a **scoped fixture acceptance budget**,
validated by the self-controls, rather than a universal worst-case theorem for
cancellation, arbitrary native processing, or a time-varying IIR filter. New
families, controls or browser behavior that violate it require investigation;
they do not authorize widening it. The exact supplied-input comparison is the
arithmetic parity requirement for the represented production states.

Every render routes the real graph through the same extra native output GainNode
at unity. The sensitivity render alone sets that gain to exactly `1 + 2^-10`
(a 0.09765625% increase). The same PCM contract must reject it in both channels,
with maximum and relative RMS errors more than 100 times their budgets, while
production wave/control inputs remain exact. This changes an actual native
signal path; it does not edit the sampled PCM or authored production tuning.

Native contexts must complete normally; all thirteen oscillators must stop once;
disposed voices stay empty; native PeriodicWave objects must be fresh for each
context. The observers forward native calls and value accessors, leaving their
DSP and schedules intact. No PCM arrays are returned to the runner or committed.
The 48 kHz analytic model remains unchanged. Comparisons are always at matching
sample rates; no cross-rate PCM or physical acoustic equivalence is claimed.

## Case 2 — native menu contexts through suspension and replacement

After a trusted browser click, the real `UiSounds` event owner uses three actual
live `AudioContext` instances and native nodes. The fixture performs two owner
replacements:

1. Schedule a `confirm` cue and immediately suspend the owner. All old cue
   branches and bus nodes must disconnect, source handlers must be cleared,
   and the original context must receive exactly one native close request.
2. Schedule the same deliberate cue in a fresh running context. Suspend that
   native context, ask for a cue while suspended, then suspend the `UiSounds`
   owner before its actual resume promise is observed. The request must remain
   unqueued. A third fresh context must accept a deliberate cue and remain
   running after the earlier resume/close promises settle.

Captured old `ended` handlers are then explicitly invoked against their original
sources. This delivery is **controlled adversarial input**, not a claim that the
browser naturally delivered those callbacks in that order. The surrounding
contexts, sources, disconnections, resume and close promises are native. The
replacement's node/handler/ownership snapshot must remain unchanged through the
controlled deliveries.

A further fresh cue verifies that the replacement remains usable. Terminal
disposal must close every context once, disconnect every observed node, remove
all cue ownership and handlers, and prevent a later event from creating sound.
Native asynchronous operations have a bounded ten-second fixture deadline;
all contexts are closed in `finally`, including failure paths.

The first CI run failed this case with a generic ten-second native-operation
timeout, before its result attachment existed. The original trace did not
identify which await timed out. No production defect or browser resume defect
is claimed from that evidence. The diagnostic revision preserves the existing
resume-settlement and lifecycle assertions. It labels each await, records stage
history, activation, context states and observed resume/close outcomes, and
attaches the diagnostic snapshot even when evaluation throws. Cleanup also has
a bounded deadline and records its failure without replacing the original
error. A further native run must locate the failing stage before its semantics
are changed.

This case verifies native ownership and lifecycle behavior. It does not measure
live output PCM, physical playback, audible latency, or speaker silence.

## Local verification

The local Chromium launch restriction was respected. No browser launch or
restriction workaround was attempted.

| Check                                                 | Result                                |
| ----------------------------------------------------- | ------------------------------------- |
| Actual original source and all 31 shared dependencies | Exact bytes/hashes verified           |
| Exact spec `beforeAll` preparation executed locally   | Passed                                |
| Original reference bundle                             | 172,506 bytes; bundled successfully   |
| Revised current native fixture bundle                 | Bundled successfully                  |
| Owned-file TypeScript diagnostics                     | 0 across three TypeScript files       |
| Scoped ESLint                                         | Passed                                |
| Scoped Prettier                                       | Passed                                |
| Playwright discovery                                  | 2 cases in one file                   |
| Original native run                                   | **Both cases failed; retained above** |
| Revised native contract / UI diagnostic execution     | **Pending CI**                        |

The exact beforeAll callback was selected using the TypeScript AST and executed
with its normal dependencies for the local bundle/source check. This runs the
same archive, dependency, input-manifest, and bundle checks used in CI; it does
not execute either browser case. Original preparation evidence remains at
`/tmp/aeebac160835-engine/validation/w06d-local-bundle.json`; revised preparation
evidence is at
`/tmp/aeebac160835-engine/validation/w06d-checkpoint5-local-bundle.json`.

Scoped commands:

```sh
node node_modules/eslint/bin/eslint.js \
  e2e/engine-native-audio-advancement.spec.ts \
  e2e/fixtures/engine-native-audio-advancement.ts \
  e2e/fixtures/engine-native-audio-advancement-original.ts
node node_modules/@playwright/test/cli.js test \
  e2e/engine-native-audio-advancement.spec.ts --list
```

The existing focused engine workflow includes these paths through its native
spec and fixture globs. It provides the locked dependencies, exact-source build,
Mesa browser configuration, native runner and artifact collection. The cases
attach `native-audio-advancement-pcm.json` and
`native-audio-advancement-suspension.json` before their result assertions, and the
latter is also attached when its native operation rejects or times out. The
coordinator must record the actual workflow commit and outcome before promoting
the pending native assertions to acceptance evidence.
