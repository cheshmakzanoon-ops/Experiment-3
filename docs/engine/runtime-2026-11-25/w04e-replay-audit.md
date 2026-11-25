# W04E — replay and telemetry audit

Result: no newly justified production change found. This source and regression audit treated earlier engine advances as established work.

## Evidence

SessionReplay admits a disk page only while its original metadata object still owns that page id, including after cooperative yields. Pending reads retain slots until settlement; writes are tracked by page object so old completion cannot unlock a replacement. Existing coverage includes session-replay-lifecycle and replay-seek-preparation.

Production replay notifications are guarded by the captured session generation in the host. The storage class retains its first failure while disposal drains writes; blanket storage-level notification suppression would duplicate the covered host responsibility.

Workers transfer recording buffers; the host copies telemetry into its ring and replay frames into session pages before returning them. Existing recording transport/publication/ring tests cover duplicate, foreign, active and detached buffers, bounded recovery, send failure, recursive publication, chronological snapshots and later source mutation.

Pose and telemetry truncation use stored Float32 time; surface timestamps remain double precision. Replay-clock and endpoint tests cover pending seeks, restart, invalid inputs and native range endpoint serialization. The host advances playback only after a successful sample and required offroad preparation.

The inspected protected recent-frame consumer requests less than 4.75 seconds. Production pages hold roughly 20 seconds at 15 Hz, consistent with the two-page visitRecentFrames contract. No rendering change is proposed.

## Reviewed coverage

recording.test.ts; recording-transport.test.ts; recording-publication-ownership.test.ts; recorder-rings.test.ts; session-replay-lifecycle.test.ts; replay-seek-preparation.test.ts; replay-clock.test.ts; replay-endpoint-precision.test.ts; engine-recording-composition.test.ts; indexed-replay-store-lifetime.test.ts.

## Limits

No production or test edits, local tests, compiler, build, browser or probe ran for this audit. Final filesystem reads failed when the execution environment disconnected; root preserved this report from the agent's completed inline findings through the GitHub connector. No repair assignment is justified by the evidence gathered.
