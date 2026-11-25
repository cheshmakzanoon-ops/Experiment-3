# W06E — native records and export acceptance

Assignment **35/60**, wave 6. Two native-browser acceptance cases are authored
and locally checked. **Browser execution remains pending the coordinator's CI
run. No production defect was found and no production source was changed.**

## Owned files

- `e2e/engine-native-records-advancement.spec.ts`
- `e2e/fixtures/engine-native-records-advancement.ts`
- `e2e/fixtures/engine-native-records-advancement.worker.ts`
- This report.

These tests extend the actual-source integration witnesses in
[W05C](w05c-records-integration.md). They preserve the existing native recording,
storage-lifetime, cancellation, replacement and replay cases.

## IndexedDB commit → real page reload → first crossing and reverse pose

The first case supplies prescribed finite poses to the actual `LapTracker`,
`TimeTrialRecords` and its internal `GhostRecorder`. The lap contains five
reverse segments; it is not a vehicle-driving or handling benchmark. The
unchanged `SaveStore` writes both the ghost and leaderboard through the native
browser IndexedDB factory, requests, structured clones and transactions.

The fixture waits for both application success notices. Those notices follow
the real store's transaction-complete promises. A read then verifies the ghost's
exact sample bytes, independently owned buffer, version, key and leaderboard.
The spec attaches `native-ghost-before-reload.json` before asserting its values.

The test performs a real `page.reload()` and injects a fresh fixture module.
Its random document identifier must differ and native navigation timing must
report `reload`. Thus the original document's player, numerical index, module
state and database connection cannot supply the new result. A fresh `SaveStore`
and `TimeTrialRecords` load the saved recording from IndexedDB.

Assertions establish that:

- Database `apex-formula` remains version 1 with its `saved` store; the ghost
  remains version 1 with the unchanged default-vehicle key.
- The reloaded sample count and SHA-256 equal the pre-navigation recording.
- The production live HUD delta uses the first recorded forward crossing of a
  station reached again after the reversal. A small linear witness computes only
  that expected crossing from the original samples.
- Time-ordered ghost presentation still interpolates the original adjacent
  reverse segment, including station, position and vehicle identity.
- Mutating a separate native read result changes neither persisted bytes nor
  the player's immutable recording. A subsequent read has a separate buffer.
- Preparing qualifying clears the record consumer; returning to time trial
  loads another independently owned player without changing the retained first
  player's bytes or first-crossing answer.

The second phase attaches `native-ghost-after-reload.json`. Cleanup deletes the
test database through the native API, exercising `SaveStore`'s existing
versionchange closure. Each case runs in a fresh Playwright context; it never
opens the user's connected browser profile or saves.

## Native capture → recycled pages → wrapped ring → native CSV worker

The second case has a dedicated native fixture worker. Only its finite frame
source is prescribed: the actual `TelemetrySampler` owns sampling cadence,
packing, elastic pages and transfer/recycle accounting. It captures 730 rows,
including a one-second omission immediately before source row 600, the first
row of lap 5.

The worker sends twelve full 60-row telemetry pages and one 10-row page. Its
actual replay side also publishes thirteen pages, containing 182 frames. Every
outgoing buffer must detach. The main thread appends telemetry into the real
630-row `TelemetryRecorder`, transfers both streams' buffers back, and checks
return detachment. A FIFO settle message follows all returns, so the reported
pool state must be six telemetry pages and six replay pages, with no warning.

The ring wraps to head 100. The closing gap now falls between retained rows
499 and 500, which is also the production CSV encoder's 500-row chunk boundary.
Both the recorder and parsed export must retain exactly these complete laps:

| Lap counter | Retained rows | Validity |
| ----------- | ------------- | -------- |
| 1           | 20–139        | Valid    |
| 2           | 140–259       | Invalid  |
| 3           | 260–379       | Valid    |
| 5           | 500–619       | Valid    |

Lap 4 is excluded because its closing interval is missing. The later complete
lap 5 remains valid, including when lap 6's first row is invalid.

The actual `TelemetryExport` transfers a separate snapshot into the complete
production `telemetry.worker.ts`, running in a second native Worker. The Vite
inline-worker import is adapted only into a Blob URL constructor; worker
messages, ownership transfer, Blob cloning and CSV code stay native/production.
The snapshot must detach immediately while the recorder keeps its own bytes.
The recorder accepts another row before the export is awaited. Reconstructed
CSV Float32 bytes must exactly equal the earlier retained snapshot, and the
recorder must contain the continuing row. Both workers terminate once.

`native-records-closing-gap.json` records page counts, detachment, pool capacity,
lap ranges, both gap timestamps, byte-difference counts, digests and cleanup.
It does not retain large raw sample or CSV payloads.

## Local validation and limits

| Check                                             | Result                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| Playwright discovery                              | 2 cases in 1 file                                     |
| Host browser fixture bundle                       | Passed; 915,590 emitted characters, 245 static inputs |
| Capture-worker bundle                             | Passed; 156,310 emitted characters                    |
| Production CSV-worker bundle                      | Passed; 147,112 emitted characters                    |
| Scoped semantic TypeScript                        | 0 diagnostics with a 1,024 MiB heap                   |
| Scoped ESLint                                     | Passed                                                |
| Prettier                                          | Passed                                                |
| Native browser IndexedDB/reload/worker acceptance | **Pending CI**                                        |

The initial 512 MiB semantic check exhausted its heap before producing
diagnostics. The one larger scoped check completed successfully; no full
compiler/build or browser was run locally.

`TimeTrialRecords` imports Interface's existing lap formatter. The fixture's
bundler preserves that module graph and handles Vite CSS/font imports as text
and data URL values. Unused UI presentation is tree-shaken, and no game UI,
font, model or environment is changed or constructed. Esbuild warns that an
unused third-party asset resolver's `import.meta` has no IIFE value; that asset
resolver is not exercised by either case.

A separate Node preflight ran the same browser bundles with actual Node worker
threads and narrow browser-event adapters. It supplies the compiled worker code
by worker name rather than loading browser Blob URLs. This checks the new
producer/export protocol and fixture arithmetic, **not native browser scheduling
or IndexedDB**. Its result was:

- 26 capture transfers, 26 returned buffers, all detached at their sender.
- Thirteen telemetry pages and thirteen replay pages; 182 replay frames.
- 630 retained rows × 228 fields, exactly matching exported Float32 bytes.
- The four expected lap ranges and the missing closing interval preserved.
- One CSV termination and one capture termination.
- CSV size 328,372 bytes.

Retained/exported Float32 SHA-256:
`00b9b860ffd9f09ec91ace85047a975584da0d47ad5cbdf17e40f75b0c4d800a`.
CSV SHA-256:
`71cf511de9701a8c2711a2fcadb1ef407166a35cee3857ef5256c7a8ff68c25a`.
The temporary diagnostic summary is
`/tmp/aeebac160835-engine/w06e-native-records-node-preflight.json`; durable browser
evidence will come from the spec's attachments after CI executes it. An initial
Node adapter prelude used CommonJS under inherited ESM flags; correcting that
temporary adapter resolved the setup error without changing production code or
test expectations.

No performance measurement, physical-hardware claim, browser bypass, dependency
change, npm lifecycle hook, Git mutation, child agent, authored-content edit or
production source edit was performed. Ownership is released for publication.
