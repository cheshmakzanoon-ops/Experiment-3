# f22622e isolated graphics run — final evidence

Source **f22622e3302ed6147c5aae6f8eb6f6bc4057a242**, reviewed local **62f18b868163a9c86857ac3222414484b92bffc9**, tree **c413cd5062b6555d1e607297e99ad93db123de77**. Original isolated workflow **44623276067**, attempt 1, finished **failure**. This source remains unaccepted for integration.

| Job | Original result |
| --- | --- |
| Production build | Passed |
| Component GPU | 7 passed |
| Menu/settings/context/GPU waits | 7 passed |
| Populated dusk driving/capture/replay | 1 passed |
| High GP application journey | 1 failed |

All 16 original browser cases ran: 15 passed and 1 failed, with no retries, skips or flaky results. The complete original case names/results and five full decoded job logs are retained. All four downloaded original artifact ZIPs match GitHub's advertised SHA-256 and size. The build ZIP's remote metadata is retained; it was not downloaded again. The menu job required and used the exact source build.

## Original High acceptance failed

The unchanged line-786 paused-readiness predicate expected **paused**, received **loading**, and exceeded its original **90,000 ms** deadline. Observed predicate duration was **90,000.550 ms**. Whole test duration was **172,788 ms**, including setup and evidence work.

The first chase began at readiness **+50,233.034 ms**, leaving **39,766.966 ms** until predicate failure. The last native worker snapshot is **+89,778.061 ms**, 222.489 ms before that failure. It records an in-flight `bufferData` call, sequence 23145, uploading a 26,568-byte element-array buffer at framebuffer 426, cube face +Z, viewport 256 by 256. It had been observed in flight for at least 2,475.4 ms; no completion or frame-completion fence was retained afterward.

The newest successful application diagnostic is only **+49,256.274 ms**, before the chase. It records post-processing preparation, zero warmup frames and GPU submitted/completed 0/0. That diagnostic becomes stale when chase work begins and cannot certify what later completed. This differs from the preceding 991cf4fc run, whose newest successful diagnostic arrived after its deadline.

No downstream paused/preparation, active GP driving, cockpit completion, photo view, or final application acceptance was reached. No original High photo PNG exists, so the changed authored far-shadow appearance remains unverified. The test's screenshot helper captures completed views but does not compare a dedicated far-shadow pixel reference.

## Bounded native evidence

Subtracting the last pre-chase worker snapshot at trace 124,084.359 ms gives:

| Observed first-chase work | Count / returned CPU-call time |
| --- | --- |
| New shader compile/link/metadata queries | 0 |
| Draw calls | 1,394 |
| Raw texture subimage transfers | 28 / 1.2 ms |
| Compressed transfers | 0 |
| Buffer-data starts | 3,432 / 36,858.2 ms |
| Buffer-subdata calls | 17 / 0.2 ms |
| Fence/client-wait/flush calls | 0 |

Buffer-data counts include the final in-flight start; returned-call CPU totals exclude that unfinished call. CPU call time can include earlier queued driver work and is not isolated transfer cost or GPU execution time. The trace retains no buffer handle or submitted payload hash. The current program, byte size and cube face cannot establish the geometry owner or duplicate upload.

Only selected pre-chase labels enable native tracing. Texture initialization and earlier construction are not fully included, so lower chase texture totals do not establish whole-scene transfer reduction. The worker's label timeline records the new circuit texture-budget task for about 35.401 ms, followed by a far-shadow interval of 7,438.923 ms, corroborating the measured 7,436.5 ms largest construction task. The later retained-texture stage occupies about 317.588 ms between observed labels; this is a label interval, not a GPU completion measurement.

No late program or GL warning/error appears in the retained native trace. That supports the repaired metadata boundary within the observed interval; it does not replace the failed overall readiness gate.

## Source review and provenance

SOURCE-REVIEW.md explains the narrowly reviewed initial construction change. The final selected texture policy now precedes the original far bake. Its native policy oracle, ownership, payload, cancellation and teardown evidence is retained with immutable source hashes. The old far-shadow inputs intentionally change; identical old pixels are not claimed. Original e2e files and workflow remain byte-identical.

The c9d3ff predecessor was cancelled while queued and produced zero artifacts. Its record remains in the separate texture-ci-c9d3ff-audit-2144 directory. No browser result was reassigned to it or from it, and the two source changes cannot be timed independently.

summary.json records all exact identities, results and limits. high/ contains the original attachments, decoded native records, predicate timeline, stale diagnostic, worker-label timeline and reproduced boundary calculation. source/ contains compact immutable source and committed proof snapshots. SHA256SUMS seals the compact review package; the original ZIPs remain outside it. Parser scripts reproduce extraction from those original ZIPs.

This audit performed reads and source-specific scratch evidence writes only. It did not change source or refs, rerun/cancel workflows, execute new tests, or add browser work. Mesa/llvmpipe evidence does not certify physical-hardware performance.
