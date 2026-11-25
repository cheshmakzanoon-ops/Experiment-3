# W06D — native audio advancement acceptance

Assignment 34/60, wave 6. **Two native browser cases are authored and locally
checked. Native execution and PCM acceptance remain pending the coordinator's
GitHub workflow.** No production source, authored audio profile, recipe, tuning,
model, character, environment, dependency, or workflow changed.

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

## Case 1 — native stereo PCM through cold and warm caches

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

The test is configured to compare **297,216 Float32 sample values per
implementation**, across two channels and four contexts. This is a sample budget,
not an already-observed passing result. It requires all of the following:

- Zero differing samples by `Object.is`, zero differing bytes, and zero maximum
  error between the original and edited implementations at each rate.
- Equal SHA-256 digests as retained evidence; direct byte comparisons establish
  equality before the digest is used.
- Exact original/current spatial and presence traces, unchanged input frames,
  finite nonzero output, and a nontrivial stereo image.
- Equal cold/warm same-rate PCM separately for each implementation.
- Native contexts complete normally; all thirteen oscillators stop once;
  disposed voices stay empty; native PeriodicWave objects are fresh for each
  context.

The observer wrappers forward native oscillator and PeriodicWave calls without
substituting nodes, DSP, samples, or parameter schedules. No PCM arrays are
returned to the test runner or committed. The compact attachment contains
counts, signal statistics, direct-comparison results, digests, traces and exact
source/bundle provenance.

These checks preserve the existing 48 kHz analytic model. They do **not** claim
that distinct sample rates have identical acoustics or equal PCM to one another.
Only original/current renders at the same rate, and the cold/warm 44.1 kHz pair,
are compared for exactness.

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

This case verifies native ownership and lifecycle behavior. It does not measure
live output PCM, physical playback, audible latency, or speaker silence.

## Local verification

The local Chromium launch restriction was respected. No browser launch or
restriction workaround was attempted.

| Check                                                 | Result                              |
| ----------------------------------------------------- | ----------------------------------- |
| Actual original source and all 31 shared dependencies | Exact bytes/hashes verified         |
| Exact spec `beforeAll` preparation executed locally   | Passed                              |
| Original reference bundle                             | 172,506 bytes; bundled successfully |
| Current native fixture bundle                         | 197,778 bytes; bundled successfully |
| Owned-file TypeScript diagnostics                     | 0 across three TypeScript files     |
| Scoped ESLint                                         | Passed                              |
| Scoped Prettier                                       | Passed                              |
| Playwright discovery                                  | 2 cases in one file                 |
| Native browser execution / PCM equality               | **Pending CI**                      |

The exact beforeAll callback was selected using the TypeScript AST and executed
with its normal dependencies for the local bundle/source check. This runs the
same archive, dependency, input-manifest, and bundle checks used in CI; it does
not execute either browser case. Its compact local provenance is retained at
`/tmp/aeebac160835-engine/validation/w06d-local-bundle.json` for the coordinator.

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
`native-audio-advancement-suspension.json` before their result assertions. The
coordinator must record the actual workflow commit and outcome before promoting
the pending native assertions to acceptance evidence.
