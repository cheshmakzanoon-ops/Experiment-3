# Agent 07 — recording publication ownership

Date: 2026-11-24.

## Result

Implemented the recording ownership repair from `03-replay-audit.md` for both telemetry and replay. A stale outer callback can no longer cancel a newer publication of the same recycled buffer. Independently captured newer partial pages also survive an older send failure, and the failed older rows remain available for retry.

## Changed paths

- `repo/src/storage/telemetry-sampler.ts`
- `repo/tests/recording-publication-ownership.test.ts` (new)

This report is outside the repository. No Git mutation, asset regeneration, models, characters, or authored environment changes were performed.

## Implementation

`ElasticTransferPool` now maps each outstanding buffer to a monotonically increasing publication identifier. `beginTransfer` returns that identifier; `cancelTransfer` requires both the original identifier and an attached buffer of the expected size. Recycling still validates size, rejects known local duplicate/active returns, and accepts a new identity only against a detached outstanding page. Detached-wrapper matching now iterates the map's keys.

Each recording stream has its own retry queue. When a failed publication still owns its attached buffer and a newer page or retry batch exists, the older batch is retained in that queue instead of overwriting newer state. Explicit flushes drain older retry batches before the active page. Capture retries queued batches before appending another sample. With no reentry, the existing active-page restoration remains intact: partial failed batches remain appendable, and full failed batches are retried before another row is written.

Retry queues retain existing pool pages; they do not allocate independent payload storage. Allocation remains capped at 60 pages per stream and shrinks toward the six-page reserve after valid returns. Nested tests retain and recover all 60 distinct pages, verify exactly one exhaustion warning, reject duplicate returns, and verify the recovered allocation count by filling the initial reserve again.

## Regression evidence

Before the production change, the first 18 new tests produced **10 failures and 8 passes**. Failures reproduced both corruption of the newest same-buffer publication and loss of independently captured newer rows, including a 59-level nested failure chain.

The completed new suite contains **22 passing tests**, exercising both streams:

- One and three older attached callback failures after same-buffer republication.
- A newer actual transfer and a complete synchronous transfer round trip, including duplicate returns.
- Failure and retry of the newest republication without restoring the older row count.
- Independent newer partial pages retained through repeated failures; explicit flush and capture-triggered retry.
- Three and 59 nested independent failures with every captured row retained within the pool bound.
- Ordinary nonreentrant partial failures retaining their original appendable page.
- An already-delivered independent newer batch retaining ownership while the older batch retries.

## Validation

Executed directly, without npm asset hooks:

```text
node_modules/.bin/vitest run tests/recording-publication-ownership.test.ts tests/recording-transport.test.ts tests/recording.test.ts tests/engine-clock-transfer-integration.test.ts tests/frame-buffer-pool.test.ts
```

**5 files, 93 tests passed**, including all 22 new cases, 16 existing recording transport cases, 37 recording/cadence cases, 11 frame-pool cases, and 7 clock/transfer integration cases. Duration: 6.59 seconds. This run launched immediately before the request to serialize later test runs with `flock`; it completed successfully, and no subsequent test run was needed.

Also passed:

```text
node_modules/.bin/eslint src/storage/telemetry-sampler.ts tests/recording-publication-ownership.test.ts
node_modules/.bin/prettier --check src/storage/telemetry-sampler.ts tests/recording-publication-ownership.test.ts
git diff --check -- src/storage/telemetry-sampler.ts tests/recording-publication-ownership.test.ts
```

A full TypeScript build was not run, per the task's known OOM constraint. Validation is focused runtime regression, lint, formatting, and diff checking; no browser/Electron end-to-end result is claimed.

## Ordering limitation

A synchronous callback can deliver an independent newer batch before an older callback's failure becomes known. Retrying the still-owned older batch preserves its rows but cannot retroactively reorder that completed delivery. The implementation preserves captured rows and consumer ownership; it retries all still-pending batches in their original order. The new suite explicitly documents this case for both streams. Native `postMessage` delivery does not synchronously reenter the sender.
