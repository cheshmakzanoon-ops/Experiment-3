# Original browser acceptance for the retained texture/order candidate

Source: [`f22622e3302ed6147c5aae6f8eb6f6bc4057a242`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/f22622e3302ed6147c5aae6f8eb6f6bc4057a242), tree `c413cd5062b6555d1e607297e99ad93db123de77`, identical to reviewed local `62f18b868163a9c86857ac3222414484b92bffc9`.

[Hosted run 44623276067](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44623276067) completed with **failure**. The production build passed. All 16 original browser cases ran: **15 passed, one failed, zero skipped and zero retries**. This source is not accepted for main integration.

| Original group | Job | Result |
| --- | --- | --- |
| Component GPU | 135910316811 | 7 passed |
| Driving and replay | 135910316754 | 1 passed |
| Menu and settings | 135914932514 | 7 passed |
| High production journey | 135910316834 | 1 failed |
| Product build | 135910316355 | Passed |

The observed browser backend is ANGLE with Mesa llvmpipe, LLVM 20.1.2, OpenGL 4.5. These are software-WebGL results; no physical-GPU frame-rate claim follows.

## High failure

The original readiness assertion at `e2e/graphics-high-journey.spec.ts:786` received `loading` instead of `paused` after its unchanged **90,000 ms** deadline. The subsequent active-chassis, driving, two-photo-view and completed-GPU-work assertions did not execute. The test lasted 172,788 ms including navigation, menu setup and cleanup.

The retained native trace starts the shadow/reflection warmup **50,233.034 ms after the readiness poll began**. It was still submitting cube-reflection work at the final retained activity record. The latest successful diagnostic read predates that blocked submission and therefore must not be treated as the final renderer state. A finite test deadline does not establish an infinite stall.

The bounded sampled chase interval contains 3,432 `bufferData` calls with 36,858.2 ms of aggregate CPU call time, and 28 `texSubImage2D` calls with 1.2 ms of aggregate CPU call time. No new shader compilation, linking or shader-metadata queries occur in that interval. Six compilations, three links and 139 metadata owners in the cumulative final counters predate the chase; they are not late-program discoveries.

The sixteen retained slow-upload records are buffer allocations. The two longest completed calls are 8,321.6 ms and 7,934.7 ms during cube-reflection preparation. A call can wait for earlier submitted driver work, so its duration does not measure isolated upload cost or GPU execution time. The trace does not identify buffer owners; equal byte sizes do not prove duplicated uploads. The interval ends before startup completes, so it is not a whole-scene performance comparison against an earlier candidate.

## Evidence and reproduction

`metadata.json` retains the terminal run, all five jobs and GitHub artifact descriptors. `artifact-receipts.json` verifies all four downloaded browser ZIPs against GitHub's SHA-256 digests and exact byte counts. `all-case-results.json` reconciles all original case results. Complete decoded job logs are preserved in deterministic gzip form, with uncompressed and compressed hashes in `log-provenance.json`.

`high/` retains the native console records, original failure, assertion and diagnostic timelines, attachment manifest, source-specific analysis, and explicit chase-counter differences. `analyze-high.py` reproduces the extraction from the original High ZIP using arguments `ARCHIVE OUTPUT SOURCE RUN JOB`; it does not execute or modify a browser test. The large original ZIP is available from the run while GitHub retains it. The extracted failure and native evidence are retained here independently of that artifact's expiry.

`protected-inputs.json` verifies that the original High and journey/menu test files, workflow, Playwright configuration and dependency lockfile are byte-identical to the preceding reviewed texture candidate. Native fixture success and the separately passing prospective-main build do not replace this failed hosted acceptance result.
