# Worker 46 / Wave 8D — input callbacks and preview activation

## Result and scope

Implemented two demonstrated engine defects in `src/input/button-actions.ts` and `src/audio/engine.ts`, with seven new cases in `tests/engine-input-audio-adversarial.test.ts`. Six cases failed before the changes; all seven now pass. The final relevant group passes **118/118 tests across eight files**. Scoped ESLint, Prettier and whitespace checks also pass.

COMPUTE was explicitly granted by root after worker45 released it, and has been explicitly released for worker47. No browser, build, whole-project compiler, dependency installation, npm hook, git mutation or protected content/tuning change was performed. `src/main.ts`, `src/input/controller.ts`, the input pump, shift queue and rumble implementation are unchanged by this worker.

## Review and pre-fix proof

Read the baseline-to-working-tree changes for the assigned input/audio files and host callsites; the controller/action/pump/rumble implementations; the relevant shift-order, controller lifecycle/replacement/session, audio cancellation/composition/lifetime and haptic lifetime tests; and the native input/preview fixtures and wave6 evidence. The existing native evidence already covers trusted keyboard dispatch, real worker consumption, focus loss, native offline preview waveforms and an actual suspended live-context resume. It was not rerun here.

Pre-fix HEAD was `6314ba3ec7d54a0ba1e79a59b8db8f03117e4520`. The pre-fix source blobs were `781ea0a460a4100c2f5a3c814b653bc12b1526af` for audio/engine and `22d57947ca2111df4e9923158d65c2b828aba864` for input/button-actions. Other workers' unrelated uncommitted files were not altered.

### Incomplete button observations across callbacks

`ControllerActions.poll()` previously emitted its selected action inside its observation loop. Later button slots had not yet been consumed when the callback ran. Three independent production-controller regressions produced an unexpected `pause` after `camera`:

1. The camera callback reentered the public action poll while camera and pause were simultaneously held. The inner poll treated the not-yet-observed pause as a new edge.
2. The callback threw. The next paused/action poll treated the still-held simultaneous pause as a new command.
3. The callback disabled driving, selected a replacement pad with held pause/shift buttons, and baselined it with a paused poll. The unfinished original loop then overwrote the replacement's later held slots; the next poll manufactured a pause edge.

The fix selects the same first eligible action during the same loop, observes all remaining button slots, then invokes the selected callback. Index priority, mapping conflict rules, context allowlists and one-action selection are unchanged. No additional per-sample collection is introduced. Exceptions still propagate, but the complete sample has already been observed. The tests retain release/repress recovery, held replacement shift suppression and the public `state.shift = 0` acknowledgement contract.

### Live previews armed after unsuccessful activation

`RacingAudio.start()` deliberately contains resume failures and bounds an unresolved activation wait at 250 ms. `previewDriving()` previously treated that return as sufficient to schedule tones even when a live context remained suspended. Three cases—rejected resume, synchronous resume refusal and unresolved resume beyond the bounded wait—each recorded the preview's 800 Hz center tone at context time 0.25 while the context was still suspended. This retained preview automation for a later activation and consumed its cooldown despite unsuccessful activation.

The fix returns before scheduling or spending cooldown when a **live** context is not running. It uses the existing live/offline distinction: suspended offline graphs still schedule before rendering. The tests execute the real `AudioUnlock` gesture listener after refusal/timeout, verify no old preview automation, then verify a fresh request, ordinary cooldown and a later fresh request. The timeout case also rejects the obsolete resume promise after the new gesture to verify its late failure remains contained.

The pre-fix proof is recorded in `w08d-pre-fix.log`: **6 failed, 1 passed**, exit 1. The passing control is suspended offline preview scheduling. These are recorded graph/ownership checks with `FakeContext`, not a claim that physical speakers were measured.

## Validation commands and results

Working directory: `/tmp/engine-c71f32882729/repo`.

Pre-fix reproduction:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-input-audio-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Final focused group:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-input-audio-adversarial.test.ts tests/engine-controller-shift-order.test.ts tests/button-actions.test.ts tests/controller-buttons.test.ts tests/controller-session-ownership.test.ts tests/engine-audio-preview-cancellation.test.ts tests/engine-audio-input-composition.test.ts tests/racing-audio-lifetime.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Result: **8 files passed, 118 tests passed, zero failures**, exit 0, 8.32 seconds. `w08d-focused.log` retains the exact test counts: 7 new adversarial, 11 shift-order, 17 button-action, 34 controller-button, 16 session-ownership, 9 preview-cancellation, 5 audio/input-composition and 19 audio-lifetime cases.

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/prettier/bin/prettier.cjs --check src/audio/engine.ts src/input/button-actions.ts tests/engine-input-audio-adversarial.test.ts
NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/audio/engine.ts src/input/button-actions.ts tests/engine-input-audio-adversarial.test.ts
git diff --check -- src/audio/engine.ts src/input/button-actions.ts tests/engine-input-audio-adversarial.test.ts
```

All exit 0; Prettier reports every file formatted. `w08d-lint.log` is empty on success.

## Findings without additional changes and limits

- Existing reset/disable/blur/visibility/disconnect/dispose boundaries already clear the controller shift backlog; the focused production-host tests retain that contract. Automatic replacement and paused/resumed held controls remain covered.
- Existing haptic tests already cover transient synchronous/asynchronous effect failures, reset failure, retry, clock rebasing and late failure after ownership changes. No additional haptic defect was established, so no rumble changes or duplicate tests were added.
- No changes to control mappings, default settings, preview tone content/envelopes, audio buses, cooldown duration, authored models/assets/visuals or vehicle tuning.
- The new cases inject refused/delayed platform promises and reentrant/throwing host callbacks at public ownership boundaries. They do not measure physical gamepad behavior, vibration, audio devices, hardware latency, rendering performance or FPS.
- Whole-project TypeScript, build and any broader integration gate remain with the coordinator's validation work. No existing assertion, timeout or quality setting was weakened.

## Final source SHA-256

| File | SHA-256 |
| --- | --- |
| `src/audio/engine.ts` | `8d8208cb1e383546da49200e08b889a3fb8a18bb4a2772c2e66b22aa1be5f143` |
| `src/input/button-actions.ts` | `0e9e223259bcb842f4c0de87b868806de2e6548461d3d8e130b12b2881928e92` |
| `tests/engine-input-audio-adversarial.test.ts` | `03fb47af76fe7423118a0093a9bf11c32ea9af6fb603eb798ce0fb29e8721b0c` |

Handoff and raw logs are under `/tmp/engine-c71f32882729/`. Root owns all staging, publication, workflow lists and shared ledgers.
