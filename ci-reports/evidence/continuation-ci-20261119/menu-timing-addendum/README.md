# Menu timing addendum — published source d8d87c7

This is a read-only supplement to the previously frozen MotoGP CI evidence. It
adds exact retained menu trace records and a reproducible extraction of the
640×400 Low-quality paused-grid failure. It contains no production correction,
test change, rerun, new download, or claim that the failure is resolved.

**Supported finding:** the trace directly records the hidden loading detail
`Waiting for completed cockpit GPU work…`, alongside `Warming up tyres` and
`94%`. In the same post-reload document, the native instrumentation records
eleven completed, zero-timeout polls of world-context fence 13, all returning
`TIMEOUT_EXPIRED`. The evidence identifies pending GPU completion during the
observed interval. It does not identify the draw, shader, upload, or driver
operation responsible, or establish the fence's eventual completion time.

## Source and original artifact

- Published commit: `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`.
- Published tree: `51077ee3c9103d7faf139b622aa806bf8652d1f6`.
- Original local trace: `../ci-motogp-d8d87c7/menu-entry/trace.zip` relative to
  this external package's original location.
- ZIP: **32,854,438 bytes**, 220 entries, 77,870,996 uncompressed bytes.
- ZIP SHA-256: `0c34a460c3b08af3df75d2b8e35c9334574a4d804ea0b502d29f46acc65ff1d2`.

`evidence/provenance.json` records original entry hashes/sizes, exact one-based
source-record selections, pinned Git blob identities, and source excerpt line
ranges. The test and timing fixture embedded in the ZIP were compared byte for
byte with the pinned Git source. Every retained trace record was copied as its
original JSONL bytes and checked against the full original before compression.

## Clock and navigation boundaries

| Field | Raw unit and scope |
| --- | --- |
| Native event `at`, long-task `start`, native wrapper `duration` | Milliseconds on the document's `performance.now()` clock |
| Packet `origin` | `performance.timeOrigin`, epoch milliseconds; distinguishes navigation documents |
| API `startTime`/`endTime`, DOM `timestamp` | Trace monotonic milliseconds |
| Console `time` | Trace receipt time for a batched packet; not the contained native event time |

Do not subtract a page-relative event `at` from a trace timestamp. The loading
table below subtracts trace click-start time from trace snapshot timestamps.
Console batching also means receipt time can follow the underlying event.

| Document `origin` | Packets / sequence range | Emitted events | Maximum reported browser drops |
| --- | ---: | ---: | ---: |
| `1795101607269.8` — initial navigation | 66 / 1–66 | 9,396 | 723 |
| `1795101643928` — settings reload and failed grid start | 173 / 1–173 | 4,321 | 0 |

All 173 post-reload console records and their complete event bodies are retained
here, including both console text and original argument fields. The initial
document's event bodies are omitted; the packet header/count index for all 239
packets remains. Each projected index field was checked against the full original.
The initial document is not a lossless execution record because it reported drops.
Zero reported drops and contiguous post-reload packet numbers describe the
emitted stream; they do not guarantee that no unflushed events existed after
the final packet. The fixture's 4,096-event Node attachment ring is a different
retention mechanism; this addendum uses the trace console stream.

## Setup and completed JavaScript polls

The exact test is `e2e/30-menu-access.spec.ts:136`, with a 240,000 ms test deadline.
It explicitly sets the viewport to **640×400**, selects Low, applies/saves,
reloads, and successfully asserts the saved quality is `low`. It then selects
race mode and three opponents, and clicks `PREPARE GRID START PAUSED`.
The trace context's original default viewport of 1440×900 precedes the explicit
override; it is not the viewport used for this test's menu interaction.

Before settings, the completed showroom diagnostic had `presentationPurpose:
showroom`, construction tasks 0, and GPU-frame queue submitted 3 / completed 2.
The retained setup calls prove both menu-visible checks and the saved-Low check
completed. The start click spans trace **97462.651–97582.203 ms**. Its subsequent
session snapshot says `Grand Prix · Aurel Grand Circuit · 3 laps · 4 cars · Dry`.

All **29 completed** state evaluations, `call@2624` through `call@2680` at even
IDs, returned `loading`; none records an evaluation error. The first spans
97618.131–97640.798 ms, and the last 157350.226–157363.307 ms. The failure is the
60,000 ms `expect.poll` at line 162: expected `paused`, received `loading`.
The assertions after that line were not reached.

Two particularly delayed evaluations lasted **6,283.001 ms** (`call@2636`) and
**22,624.815 ms** (`call@2664`). Independently, the post-reload instrumentation
records a long task starting at page **47869.399999999994 ms**, lasting
**23,141 ms**, delivered to the observer at page **71022.6 ms**. These records
do not identify the operation inside the delayed work. Exact values for all
polls and long tasks of at least 5,000 ms are in `summary.json.gz`.

## Direct loading-stage observations

These are selected snapshot observation times, not exact stage-entry times or
stage durations. Their literal DOM nodes are preserved, including hidden
`#loadingText`; no complete DOM-diff reconstruction is claimed.

| Snapshot | Trace timestamp (ms) | Seconds after click began | Literal hidden loading detail |
| --- | ---: | ---: | --- |
| `after@call@2622` | 97610.297 | 0.147646 | `0% · Loading authored venue and crew data…` |
| `before@call@2650` | 118985.906 | 21.523255 | `100% · Scene ready…` |
| `after@call@2652` | 120443.227 | 22.980576 | `Compiling circuit and vehicle materials…` |
| `before@call@2664` | 149165.718 | 51.703067 | `Warming offscreen pit-service materials…` |
| `before@call@2670` | 152252.606 | 54.789955 | `Waiting for completed cockpit GPU work…` |

The `100% · Scene ready…` text belongs to that internal detail; the same snapshot
has a public loading percentage of 90%. The final row directly contains public
`94%`, `Warming up tyres`, and the cockpit detail together. The cockpit stage
therefore does not depend solely on inferring the label's source mapping.

## Native fence evidence and its limits

All times in this section are **page milliseconds in origin 1795101643928**.
Context 1 was created for canvas `world` at 1814.3999999999942 ms. Context 2 was
created for an unnamed canvas at 18738.79999999999 ms, and records context loss
at 18785.699999999983 ms while the settings modal was open. There is no recorded
world-context loss. The context-creation dimensions 300×150 describe the canvas
at that instant; they are not the test viewport. The unnamed context loss is
not evidence that the active world context was lost.

| World context 1 fence | Recorded creation end (ms, rounded) | Completed polls | Last observed result |
| --- | ---: | ---: | --- |
| 10 | 70987.900 | 0 | Deleted at 71006.1; no observed signal result |
| 11 | 71006.500 | 78 | 77 timeouts, then `CONDITION_SATISFIED` at 73089.800 |
| 12 | 73098.600 | 10 | 9 timeouts, then `CONDITION_SATISFIED` at 73237.500 |
| 13 | 73341.500 | 11 | All `TIMEOUT_EXPIRED`, last at **81137.4** |

Fence 13's recorded creation end is exactly `73341.49999999997`; its first
completed timeout is at `73385.80000000002`, and its last at `81137.4`.
Creation-end to last timeout is **7795.900000000023 ms**, approximately
**7.7959 s**. This is the observed lower bound through the last explicit timeout,
not a total fence duration or proof of a permanent hang. No signal result or
deletion of fence 13 appears in the retained post-reload stream.

Every one of its eleven native calls used flags 0 and timeout 0 and returned
37147 (`TIMEOUT_EXPIRED`). The recorded wrapper duration was 0 or approximately
0.1 ms; this is not evidence of a synchronous `clientWaitSync` hang. Instrumented
durations include surrounding recording overhead and are not GPU execution time.
The native method was called once per wrapper invocation with its original
receiver/arguments, and its native return value was preserved.

The final timer event is at `81585.30000000002`, with browser frame count 862,
last browser frame `81137.30000000002`, active callback 0, and callback count
1952. All 1952 emitted rAF-start IDs have matching rAF-end IDs. **Do not extend
the pending-fence lower bound to that timer:** completion could occur between
polls, and the last explicit native status remains at 81137.4.

The pinned renderer source sequentially warms chase and cockpit views and
reports the completed-work detail immediately before `waitForPreparedFrame`.
The pinned GPU gate polls with zero timeout and treats `TIMEOUT_EXPIRED` as
incomplete. These source excerpts corroborate the stage and gate semantics.
The compiled bundle response body was not retained in the original trace:
both `assets/index-CbShg41_.js` content records have size -1 and no body hash.
The recorded minified callers therefore do not establish an exact responsible
draw/shader/driver operation. In particular, this supplement makes no claim
that the label itself proves a native fence's cause.

## Network and console scope

All **144** recorded resource snapshots are preserved: **142 HTTP 200** and
**2 HTTP 304**, with no recorded error status or `_failureText`. The 239 original
console records are debug timing packets; no console warning/error or page-error
event appears in the recorded browser trace. This describes recorded evidence,
not a guarantee about every possible pending request, omitted asset body,
unflushed event, or activity after recording ended.

## Files, verification, and reproduction

`evidence/browser-actions.jsonl.gz` preserves all context/API/log/event records;
`browser-dom.jsonl.gz` preserves the five complete selected snapshot records;
`browser-timing-postreload.jsonl.gz` preserves all post-reload console records.
`network.jsonl.gz` and `test-runner.jsonl.gz` preserve their entire original trace
entries. `packet-index.json.gz` is the explicitly limited header/count projection.
The exact source copies/excerpts, machine-readable findings in `summary.json.gz`,
and provenance accompany them. `SHA256SUMS` covers the complete supplement.

Verify this package and recompute all substantive saved-record findings without
the original ZIP, Git, a browser, or the network:

```bash
cd /path/to/ci-menu-timing-addendum-d8d87c7
sha256sum -c SHA256SUMS
python -B verify_evidence.py
gzip -dc evidence/summary.json.gz
```

To repeat the extraction from the existing full original, use a checkout that
contains the pinned commit and a new output directory. This command performs
only ZIP reads, `git show`/`git rev-parse`, and artifact writes. It refuses to
overwrite an existing output and checks the original ZIP, entry, and source
identities before producing the evidence:

```bash
python -B extract_evidence.py \
  --repo /path/to/Experiment-3 \
  --trace /path/to/ci-motogp-d8d87c7/menu-entry/trace.zip \
  --out /path/to/new-menu-evidence
```

The extraction script is also the definition of the selection and derived
findings. `verification.json` records the successful saved-record verification.
Initial-document event bodies, 93 other DOM snapshots, 162 screencast records,
asset bodies, and `0-trace.stacks` are intentionally omitted from this compact
supplement. The original ZIP and the previously frozen package remain unchanged.
