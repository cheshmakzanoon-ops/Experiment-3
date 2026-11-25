# W05C — records and telemetry composition

Assignment 27/60, wave 5. The W03 first-passage and closing-gap fixes reach their
production consumers correctly. **No new production defect was demonstrated;
no production change or fix request is needed.**

Owned files:

- `tests/engine-advancement-records.test.ts` — two integration tests.
- `docs/engine/advancement-2026-11-25/w05c-records-integration.md` — this report.

## Coverage gap addressed

The existing suites establish first-passage lookup, recorder bounds, persistence
ownership, telemetry lap selection, and CSV-worker lifetime separately. The new
tests connect those boundaries without repeating the first-passage query sweep
or the 600-second actual-worker retention runs.

### Saved reversal → reload → time-trial HUD

The first test uses the real `Track`, `LapTracker`, `TimeTrialRecords`, internal
`GhostRecorder`, `SaveStore`, leaderboard insertion, and game-event bus. The
input is a prescribed finite snapshot stream with real timing gates and sectors,
not a physics-driving or handling benchmark. Its first valid lap includes five
10 m backward samples, followed by valid slower and faster laps.

Only the IndexedDB boundary is substituted. It structured-clones values at the
request boundary and exposes queued writes at transaction completion. A second
real `SaveStore` opens that same committed database and loads the reversal ghost
through `TimeTrialRecords.prepare()` and `validateGhost()`. This is application
composition evidence, not native IndexedDB scheduling evidence; that remains in
the coordinator's wave-6 scope.

The test establishes all of the following:

- The persisted object equals the completed recording, retains version `1`, and
  uses the unchanged `ghost:v1:<circuit>` key for the default vehicle.
- The loaded player owns a different sample buffer from the original live
  player, with exactly the same sample bytes.
- `TimeTrialRecords.observe()` delivers the first forward crossing to the live
  HUD delta at a station crossed again after the reversal. Only one crossing
  witness is evaluated; the existing W03 algorithm sweep remains authoritative
  for the broader query space.
- `TimeTrialRecords.ghostAt()` still follows the original time-ordered reverse
  pose. Its interpolated station, x/z position, and recorded vehicle agree with
  the original adjacent sample pair.
- A slower valid lap enters the leaderboard and emits the time-trial event
  without replacing the ghost. A faster valid lap replaces the player and save.
  All three valid laps reach both record consumers.
- Subsequent recording, replacement, and reload leave the old live player and
  the independently reloaded reversal player's bytes and crossing result intact.
- Preparing qualifying clears the active record player/HUD; preparing a new
  time-trial session reloads the faster committed ghost into a new player without
  modifying either retained earlier recording. The store still has one ghost
  key, and its read value equals the active loaded lap.

The read-only comparison of `src/core/ghost-lap.ts` with the pinned baseline shows
only the documented `GhostPlayer` constructor/index/query changes. Recording,
validation, key generation, metadata, and `poseAt()` arithmetic are unchanged.
The cache assumption therefore holds at the reviewed production boundaries:
`GhostRecorder` creates a fresh `Float32Array` for each completed lap, later laps
use a separate accumulator, and record/session replacement replaces references
rather than modifying retained sample arrays.

### Capture → transfer pages → wrapped ring → snapshot → CSV worker

The second test executes the real `TelemetrySampler`, `packTelemetry`,
`TelemetryRecorder.appendBatch()`, chronological snapshot, `TelemetryExport`,
and production `telemetry.worker.ts` message handler. Its narrow frame-source
fixture supplies finite protocol snapshots; it does not substitute a physics
worker or claim to exercise native worker scheduling.

The sampler captures **730 rows** and publishes **twelve 60-row pages plus a
10-row partial page**. Both telemetry and replay transfer buffers are actually
detached, consumed, transferred back, and recycled. The telemetry ring retains
**630 rows**, with `head === 100`; its oldest retained lap starts partway around
the circuit.

The producer deliberately omits one second of capture immediately before source
row 600. This is simultaneously:

- The closing interval of lap 4 and opening row of lap 5.
- The boundary between telemetry transport pages 10 and 11.
- The interval between retained rows 499 and 500, crossing the CSV encoder's
  500-row chunk boundary after the ring has wrapped.

The following ranges survive in both the ring's `PlotData` and parsed exported
CSV. Lap numbers are the zero-based protocol counters.

| Lap | Retained start | Retained end | Validity |
| --- | ---: | ---: | --- |
| 1 | 20 | 139 | Valid |
| 2 | 140 | 259 | Invalid |
| 3 | 260 | 379 | Valid |
| 5 | 500 | 619 | Valid |

The partial oldest lap and unfinished final lap remain excluded. Lap 4 is
excluded because its closing capture interval exceeds one second; the following
well-observed lap 5 remains available, and lap 6's invalid first row does not
contaminate lap 5's validity.

The real export controller transfers a disposable snapshot. Recording continues
before the CSV-worker handler is delivered. Every numeric field reconstructed
from the exported CSV matches the retained snapshot's Float32 bytes, while the
live recorder contains the subsequently appended row. Both gap timestamps remain
present across the chunk boundary. There is no telemetry-to-`SaveStore` path in
these callers: telemetry storage here is the bounded in-memory ring and CSV
export; `SaveStore` persistence is exercised by the ghost test.

## Unsupported-mode flashback journal review

The journal optimization does not gate record consumers:

- In `src/workers/physics.worker.ts`, initialization conditionally creates the
  `InputLog` through `supportsFlashback(mode)`, then creates `TelemetrySampler`
  through `recorder(simulation)` independently. Physics steps still call
  `telemetry.capture()`, and telemetry/replay recycle messages retain their
  separate paths.
- In `src/main.ts`, telemetry messages reach `appendBatch()` and are recycled.
  Accepted driving snapshots independently reach `TimeTrialRecords.observe()`.
  Time-trial setup calls `prepare()` independently of flashback eligibility.
- The new record test establishes that the time-trial consumer still saves,
  reloads, compares, emits events, and inserts slower as well as faster valid
  laps. Qualifying continues to have no time-trial ghost, as intended by the
  existing `prepare()` mode guard.

The actual worker connection to these output streams is already covered by
[W03D](w03d-flashback-retention.md): the time-trial and qualifying comparisons
each preserve the packed frames, 36,000 telemetry rows and 9,000 replay frames
while eliminating the unavailable journal. Those 600-second streams were **not
rerun** here. No claim of a new worker, browser, heap, or performance measurement
is made.

## Negative witnesses and validation

The two new tests were copied temporarily into the coordinator-provided sparse
baseline at `350119e8` and run against its source using the same direct command.
Both failed for the intended pre-fix behavior:

| Witness | Pinned baseline | Integrated source |
| --- | --- | --- |
| Reloaded reversal → HUD delta at 20 s | `4.199999809265137` s | `5.199999809265137` s, the first crossing |
| Closing capture gap | Incorrectly includes lap 4, rows 380–499 | Excludes lap 4 and preserves the following lap |

The temporary baseline test copy was removed after that check; baseline source
was never edited. These are regression witnesses for the existing fixes, not
additional defects.

Focused validation, using direct executables and one worker:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-advancement-records.test.ts tests/engine-persistence-integration.test.ts tests/engine-telemetry-lap-gap.test.ts tests/telemetry-export-lifetime.test.ts --maxWorkers=1 --no-file-parallelism
node node_modules/eslint/bin/eslint.js tests/engine-advancement-records.test.ts
```

**4 files passed; 51 tests passed; 0 failed.** Breakdown: 2 new composition
tests, 13 existing SaveStore/desktop-mirror ownership tests, 9 existing telemetry
lap-gap tests, and 27 existing export-lifetime/protocol tests. The existing
persistence suite remains unchanged and covers desktop snapshots, enqueue
timing, revisions, rollback, getters, and the browser-only clone path. Scoped
ESLint passed with exit code 0.

After the final test-harness bound/comment cleanup, the two new tests and scoped
ESLint were rerun successfully. No production source was modified. No long
worker stream, browser attempt, performance timing, npm lifecycle hook, full
typecheck/build, Git operation, or authored-content/asset change was performed.

Ownership of both files is released to the coordinator for integration.
