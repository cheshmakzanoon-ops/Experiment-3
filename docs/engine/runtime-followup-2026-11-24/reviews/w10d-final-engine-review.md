# W10D / worker 58 — final engine integration acceptance

## Decision and exact scope

**Accept the frozen production implementation at checkpoint 9.** I found no concrete new reachable regression in the complete production diff or in the cross-domain traces below. No production repair, fixture change, or additional compute workload is requested by this review.

The task baseline is `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`. The reviewed final checkpoint is **`9119c7683d821d145f15ed64a03ee3406595b58d`**, root tree **`3b704f846c3283c21e73f8f5c3febf670a773c63`**. Independent local object/working-byte checks confirm that checkpoints 7, 8 and 9 share the complete `src` tree **`ad28ec3acb55feb301e13232614a14c4230abcae`** and that all **1,116 current source files** match that tree. The baseline-to-final production diff contains **29 files, 943 added lines and 295 removed lines**. Using the same five context lines as W09E yields **107 hunks**, all reviewed; three context lines simply split the same changes into 124 hunks.

This was a read-only source, test-assertion and retained-evidence review. I read the worker context/state, W09E protected-method audit, W10A regression reconciliation, W10B performance limitations and the implementation draft. I also inspected the actual production changes, surrounding callers and targeted regression assertions. I ran no engine code, test, build, compiler, lint, benchmark or browser, acquired no compute/browser lease, made no repository/Git mutation and used no network. Root's later documentation integration does not affect this checkpoint-pinned decision.

Evidence created here: [source identities and counts](../validation/w10d-source-review.json), [complete source identities](../validation/w10d-all-source-identities.json), [reviewed production patch](../validation/w10d-production-baseline-to-final.patch), [retained validation receipt summary](../validation/w10d-evidence-review.json), and [exact audit Git reads](../validation/w10d-operations.json). The reproducible [audit script](../validation/w10d-audit-source.py) performs only metadata reads, byte hashing and existing-report parsing.

## Reviewed integration invariants

### 1. Failure, receipt retirement and fresh initialization agree

I traced the circuit worker's command, timer and rewind exceptions through `fail`, the failed-message gate, both receipt channels and fresh initialization. Terminal failure revokes stepping and pending rewind completion before error publication. A matching already-delivered surface/engineering receipt can retire ownership while failed without capturing, publishing or reviving the simulation. New initialization preserves the outstanding receipt accounting; old or duplicate epoch/sequence receipts cannot release a successor. A failed replacement initialization remains terminal.

Festival preserves its monotonically increasing status sequence and outstanding receipt set across initialization. At the 64-status bound, commands and init reject before mutation; repeated pauses neutralize inputs without creating additional required frames/statuses. A valid receipt that opens the full queue rebases the clock, including when it arrives before a throttled timer has run. Typed pre-mutation command rejections remain recoverable, while errors after mutation enter the terminal path.

These are exercised by actual worker modules with structured transfers and real simulation mutations, not just tests of a parallel model: `engine-circuit-worker-terminal`, `engine-worker-session-adversarial`, `engine-diagnostics-backpressure`, `engine-festival-command-errors`, `engine-festival-status-backpressure`, and `engine-festival-composition`. The corrected `circuit-frame-transport` and `surface-channel-backpressure` assertions retain independent low-level buffer recovery and same-terrain rebase guarantees, as reconciled in [W10A](w10a-regression-triage.md).

### 2. Input order composes with live and legacy authority

The controller's staged pulse plus FIFO reserve stays bounded at 32. I followed both real `GameApp` input-pump branches: successful host delivery clears the visible shift, and only then can the next accepted edge surface. Repeated reads do not consume it. Reset/disable/device-loss paths discard pending session intent. Completing all button observations before dispatch prevents reentrant polling, callback exceptions or replacement-device acquisition from manufacturing a second UI edge from the old sample.

On the network side, live controls normalize shift to zero and journal a separate one-shot edge only on first application while human controls apply. Consumption, AI takeover, rejected client samples and handback cannot replay an old live edge. The journal owns a separate level-control object. Archived tags 0/4 deliberately bypass the new live normalization and retain persistent-shift replay semantics; tag 5 explicitly records new edges.

`engine-controller-shift-order` executes the real host pump for circuit and Festival delivery. `engine-network-shift` covers duplication, loss, partial lateness, opposing/identical pulses, pending-edge versus later-level writes, AI handoff and exact replay. `engine-network-adversarial` independently supplies hand-authored legacy bytes across AI handoff and a rear-brake tag change. Quantizer tests compare against the unchanged actual byte writer/reader, including coercion/rounding boundaries. The documented older-reader incompatibility of tag 5 is accurate.

### 3. Synchronous callbacks cannot retain the reviewed departed owner

`GameApp.fail` sets terminal ownership and detaches startup/worker handles before callbacks, then attempts independent cleanup while preserving the originating error. `SessionLifetime.wait` removes its abort listener and marks settlement before cleanup; thrown cleanup rejects otherwise successful work but cannot replace an original abort/rejection or leave the returned promise pending. The tests include an original `undefined` rejection and reentrant close.

Festival fatal cleanup rejects startup/commands and closes the lifetime before notification, with host exit attempted even when toast throws. The real HUD/gamepad exit path returns from `frame` immediately after disposal, before navigation or audio can dereference the cleared owner. Status/engineering receipt callbacks check current ownership before returning credit. `engine-host-failure-cleanup`, `engine-session-settlement`, `engine-worker-session-adversarial` and the host/worker composition cases cover these actual boundaries.

### 4. Recording cutoffs and export completion use the right owners

Telemetry rewind truncation uses `session_time_s`, matching the worker receipt, and rounds the cutoff into the Float32 domain of stored rows. Removing a tail resets last-tick deduplication to the newest retained row. Replay uses the same pose domain for open/sealed page selection and frame truncation, while surface/weather cutoff decisions retain their double-precision timestamps. The two-span ring copy retains chronological order and independent snapshot storage.

The composition tests derive receipts from real `Resimulation`, covering upward/downward rounding, first/last frames of sealed pages, an open-page boundary, a wrapped telemetry ring and changed resumed input. The first-pose test separately excludes a surface keyframe only `1e-8` later than the double cutoff. Ghost tests cover the accepted near-600-second endpoint, ineligible-lap release, Float32 sampling and an independent returned typed copy.

CSV's completed Blob groups retain the existing byte format. Host export captures telemetry plus generation and checks current ownership both before starting and after `await`; failure/Festival handoff cancels the exporter. Tests include the subtle already-resolved promise whose continuation has not run, as well as pending cancellation and a Festival request rejected before ownership transfer. Native cases add real sender detachment, continued recording, stale-success rejection and one termination per job. Relevant suites are `engine-telemetry-time-ring`, `engine-recording-composition`, `engine-ghost-bounds`, `engine-export-host-ownership`, `engine-telemetry-chunk-storage`, and native recording.

### 5. Shared capture does not share recipient packet ownership

The server captures each relevant car once, including prediction data for connected owners, then encodes every recipient's independent buffer before external transport callbacks. Only that recipient's FULL bit is set during its encode, restored in `finally`. Boundary contact/event/slack latches retire before sends; a reentrant callback can capture one follow-up batch, and further requests leave newer pending data for the next scheduled boundary.

I checked disconnection/replacement ownership, transport exceptions, callback teardown during grid/results, and exclusive-end record creation. A terminal snapshot's current-tick unconsumed suffix is excluded from the archive without rewriting the live journal; corruption elsewhere remains subject to strict verification. Tests mutate a retained packet, change live state during send, request nested snapshots, and verify healthy-recipient bytes plus later contacts/events/slack. Separate cases prove non-transport capture/physics faults propagate and chunked-results failures do not abandon healthy recipients. `engine-server-snapshot-lifetime`, `engine-network-adversarial` and `engine-network-composition` cover these interactions.

### 6. Source, decoded image, GPU owner and borrowed backend remain distinct

The budgets batch compatible source groups without changing the existing resampling/filtering implementation. Unregister removes wrapper indexes before disposal listeners, exposes the old source during release, and restores the original in `finally`. Whole-budget/root cleanup attempts independent resources and preserves the first thrown value, including `undefined`. Exclusive bitmap close is attempted after a failing texture listener; both source identity and decoded-image identity protect shared/cache images.

I inspected the ordering of renderer budget teardown, planting-owner release, OutputPass disposal and Festival's sky/near-shadow release. The Festival backend remains borrowed and alive. Resource tests use real Three objects/events, sibling shared sources, partial acquisition, reentrant budget close and source restoration; native fixtures add tested pixel equality and repeated GPU resource cycles. The guarantee stops at the documented outer ownership boundary: vendor/nested internal cleanup is not made universally exception-proof. No authored material, geometry, texture definition, model, environment definition or vehicle tuning was changed.

### 7. Audio activation and exact math retain their documented domains

Mute and stop invalidate the preview generation before delayed activation can complete, and cancel scheduled previews. A live context must actually be running before tones are armed; resume refusal/timeout does not spend cooldown. Offline scheduling remains supported. Tests include mute/unmute during pending activation, late rejected resumes, a later real unlock gesture, blur on paused/menu screens and exact native replacement PCM.

The numerical changes preserve expression/order and typed destinations on supported inputs: component-wise BVH extrema retain `Math.min`/`Math.max` signed-zero behavior; contact normal/index stores use the same offsets and winding; ordinary `Vec3` normal length is reused only after its existing acceptance checks; the fixed-four tire maximum keeps its argument order. The positive-integer contact-row guard prevents the previously demonstrated fractional-allocation regression. I checked its invalid-domain and vector-alias regressions and the W08F exactness limitations. These support the stated finite evidence and supported-domain contract, not universal equivalence for stateful custom getters, modified built-ins or concurrently mutated shared geometry.

## Validation evidence inspected, not rerun

| Retained gate | Reviewed result | Receipt |
| --- | --- | --- |
| Exact-checkpoint local engine unit selection | **1,852 passed / 128 files**, no failed cases; source stable | [Unit summary](../validation/w09a-final-results.json) |
| Full local static/build gates | Lint, whole-project TypeScript, product build, bundle budget and IP guard all exit 0 | [Static/build manifest](../validation/w09b-static-build-manifest.json) |
| Exact-checkpoint focused CI | **506 unit cases / 42 files**, **37 browser cases**, compiler/build/source guard passed; Mesa llvmpipe | [CI receipt](../validation/checkpoint9-ci.json) |
| Final local native/full-game replay | **37 passed / nine files**; each exactly one result, retry 0, no errors/skips/flaky results; source/dist stable; SwiftShader | [Native manifest](../validation/w09c-native-gate-manifest.json), [case results](../validation/w09c-case-results.json), [W09C report](w09c-native-final.md) |
| Final broad unit partitions | **9,594 passed / four baseline-established failures**, 901 physical files | [Broad-unit receipt](../validation/checkpoint9-broad-unit-summary.json), [failure reconciliation](w10a-regression-triage.md) |

The final native receipt retains the 8,500 ms real main-thread stall, no recording warnings, continuing telemetry/replay, and zero error in the first requested seek time. I parsed the case results to confirm every case has one successful retry-0 result; this was report inspection, not a new browser run. Counts above describe overlapping gates and must not be added into a unique-case total.

## Bounded residual risks and publication disposition

Keep the following limits explicit in publication:

- Same-sized frame buffers have no cross-session sender authentication in the current wire format. The reviewed frame tests establish credit/allocation behavior, not that absent identity guarantee.
- New journal tag 5 and internal worker receipt envelopes intentionally change compatibility. Legacy recorded tags retain their previous interpretation; older readers do not understand the new tag.
- Festival's lossless claim applies to accepted 10 Hz status publications; it does not promise to observe every physical event between samples or retain an unlimited stalled burst of input.
- Three listener ordering and nested protected/vendor disposers can still interrupt cleanup within an individual resource. The tested independent-owner continuation must not become a claim of arbitrary internal exception-proof draining.
- Exactness evidence is fixture/domain bounded. Historical Wave 7 timings remain attributed to their measured source, and later identical methods do not constitute a fresh timing of the final build. Contact timing is mixed, AWD savings are dormant, and the natural-vehicle timing cause remains unresolved, as reviewed in [W10B](w10b-performance-claims.md).
- The four broad-unit content/i18n failures remain visible. The night scenery timeout has mixed prior history and no established cause; it is neither a proven new engine defect nor an established baseline/environment failure. Software-renderer/native API success is not physical-GPU/device or whole-game performance proof.

These are preserved limits, not new defects found by this review. The implementation draft's stated engine contracts agree with the final production behavior within those qualifications. Root can proceed with its authorized documentation and publication work; this worker's review is complete.
