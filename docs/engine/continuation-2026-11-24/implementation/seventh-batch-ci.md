# Seventh batch CI evidence

Commit: [`93416f81c9bfe4f1df894888bd7c03d904b64058`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/93416f81c9bfe4f1df894888bd7c03d904b64058). The coordinator inspected completed job metadata and logs directly.

[Focused runtime run 45469677287](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45469677287), job 138713911618: **success**. Complete project TypeScript compilation, the exact-source Vite build, and all **13 native browser tests** passed with zero retries. The log reports 2.1 minutes for the browser suite.

| Native coverage | Passing cases |
|---|---:|
| Replay, IndexedDB/save ownership and frame-buffer lifecycle | 7 |
| OfflineAudioContext cadence, reset and disposal | 3 |
| Actual circuit and Festival worker transfer/recovery | 2 |
| Full application replay ownership | 1 |

The circuit worker case exercised held frame, telemetry, replay and surface publications, native transferable detachment, ordinary reserve exhaustion, credit recovery and ordered rewind completion. The Festival case exercised event-field growth and shrink with frame capacity and old-size buffer ownership. These supplement the earlier Node worker-thread rehearsal with actual Chromium workers. Required control snapshots remain distinct from bounded ordinary frame reserves; this evidence does not establish a bound on all possible queued control messages or full-session replay history.

The complete replay case passed in approximately 1.8 minutes. The existing three native audio cases passed again; they are repeated coverage rather than three additional unique scenarios. Mesa/llvmpipe supplies software graphics, not consumer-GPU or physical audio-device performance evidence.

The artifact upload succeeded and recorded zip SHA-256 `446b6e292dfea32f73a610c7f9db7bc31606b51767c0472a8f4b0665d5785977`. The workflow retains source commit/tree, lockfile digest, build identity, browser/backend logs and test evidence.

[Settings interaction run 45469676910](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45469676910) also completed successfully. In [broad Build and validation run 45469677081](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45469677081), the global validate job 138714151957 completed successfully. Some broad unit/browser jobs were still running or queued at this inspection, so this report does not count them as passed or describe the entire CI suite as green.

This report covers the published seventh-batch source. Subsequent scalar staging, worker clock diagnostics, persistence concurrency and additional reviews require their own gates.
