# Offline single-pass structural-summary route

**Offline qualification only. Not integrated, not native evidence, and not an
authorization for another capture.** This extends the separately frozen
[structural prototype](offline-gpu-structural-coverage-prototype-2026-11-01.md)
inside a workspace-backed selected-source snapshot of
`0ffe4599cb87a867942b775d57630154747a9f5c`, on the same cloud computer.
Main, workflows, renderer/physics and existing V2/V3 paths were not modified.

## Preservation and useful output

All six frozen prototype files and 23 existing dependency/config/test files
remain byte-exact. This route imports their unchanged fixed query, strict
decoder and parser pin; it neither changes V2/V3 schemas/SQL nor routes through
their launchers, validators or historical receipt handling. There is no CLI,
capture integration, environment-selected production mode or workflow trigger.

The separate `offline-gpu-structural-coverage-v1` schema retains numeric buckets
for the same selected ten wrappers, the other 393 wrappers from the complete
source-pinned Chromium file, and other exact-`gpu` scopes. Ordered, same-track,
typed-GPU unfinished decoder/flush ancestry is a per-instance conjunction, not
a conjunction of independent totals. Fixed schema indices are not trace IDs.
No dynamic names, arguments, categories, timestamps, paths or trace identities
are returned. Actual selected-wrapper emission (`buckets[0].count > 0`) is
mandatory; source metadata or other-GPU activity cannot substitute. A completed
selected wrapper is sufficient emission evidence, but not hang evidence.

Source provenance is unchanged: Chromium `156.0.8078.75`, generated GL bindings
605,856 bytes, SHA-256
`bd48608bfbede328cec4fbb1afb320df72530940d3f69b22e86e3cecbf7e7916`.
The complete catalogue was independently re-extracted, including source lines.
Parser 58.2 is 14,897,560 bytes, SHA-256
`58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9`.
The producer embedded in Chromium is a different Perfetto revision; the
prototype report retains that distinction and the exact primary-source links.

## One bounded private pass

`summarizeOfflineGpuStructure` is the only pinned, private-summary entry point.
It is Linux x64 only. The exported lower-level processor helper is a lifecycle
test seam returning unvalidated stdout, not a proposed integration API.

- One monotonic **five-second work/acceptance budget starts at public entry**:
  option validation, parser verification/copy, input staging, one query,
  strict decode, actual-emission check, serialized-size check and final
  acceptance all share it. A smaller supplied budget is allowed; a larger one
  is clamped to five seconds. No separate version/V2/V3/fallback query runs.
- Input is at most **64 MiB**; stdout and serialized summary at most **16 KiB**
  each; stderr at most **4 KiB**, counted and discarded. These are recorder,
  input/output and time bounds, **not RSS or address-space caps**. No address
  space, watchdog, security, capture-window or recorder-budget change is made.
- Both source files are opened with `O_NOFOLLOW | O_NONBLOCK`, checked as
  positive-length regular files, and copied from the same descriptors. Byte
  counts, identity/size/timestamps and final named-path metadata must agree.
  Parser bytes are SHA-verified while copying; the private verified copy is
  what executes, so source-path replacement cannot substitute an executable.
- The unique staging directory is 0700, parser 0500 and input 0400 after exclusive
  0600 creation. Final-component no-follow is not an ancestor-path sandbox;
  trusted workspace parents and no hostile same-UID writer remain required.
- Node 22.23.4 embedded source inspection identified a valid-fd-zero stream-close
  edge. The route rejects fd0 before attaching a ReadStream and closes the
  unreferenced descriptor; a regression proves no stat/stream/spawn occurs.
- Timeout, parent abort, pipe/child error and output overflow fail closed.
  Signaling is idempotent; attempted kill or `exit` is not treated as `close`.
  Private staging is removed only after child close. OS operations/close and
  cleanup may outlast the work budget; this is **not a five-second settlement
  guarantee**. No late result can become success. Cleanup failure is a fixed
  failure, not success; any residual staging remains private, not uploaded.
- Public errors have fixed reasons and do not forward parser diagnostics or
  file/option exceptions. Strict own-data option validation and native signal
  intrinsics reject getters/spoofing. The original caller-owned input is not
  deleted. The route returns a validated object; it writes no retained summary
  file and never exports raw input.

## Correctness qualification, separate from performance

The new route suite passed **58/58**. It covers one invocation, exact and
excess-byte ceilings, UTF-8 byte accounting, abort/deadline/pipe/error cleanup,
close-versus-exit lifetime, sanitized errors, option/signal spoofing, no-follow
regular-file checks (including FIFO/fd0), parser pin failures, changed input
identity/metadata, verified-private-executable use after source replacement,
actual selected emission, truncated-tail acceptance without certification, and
deadline consumption in staging, decode and cleanup. These deterministic
failure/lifetime tests establish contract behavior, not throughput.

The initial public-abort test incorrectly expected a new `processing-aborted`
reason instead of the existing fixed `processing-timeout` reason. Its **53-pass,
one-failure** log is retained; only that expectation was corrected. No failure
was relabelled and no budget/assertion was relaxed to obtain the later pass.

An integration recheck exposed a separate test-only portability assumption: a
pre-aborted valid signal expected the Linux-x64 timeout result even on unsupported
hosts. The retained identity-mocked red probe produced three correct runtime
`unsupported-platform` results against that wrong expectation. The corrected
serial table covers Linux x64, Windows x64, macOS ARM64 and Linux ARM64, restores
both complete process-property descriptors in `finally`, and asserts no caller
signal-method, file-open or process-spawn calls. These are synthetic guard tests,
not native cross-platform executions. Runtime/prototype source is unchanged.
The final default invocation passes 88 active cases with 76 explicitly opt-in
parser/stress cases skipped; the separately enabled route suite passes 58/58.
Final scoped types/lint pass. A prior combined-checkout full typecheck also passed
before this test-only table change; no second product build was needed.

The unchanged prototype/V2/V3 selector passed **237/237 in five suites**:
99 structural contracts, 99 existing real-parser contracts and 39 summary
contracts. Snapshot TypeScript, focused ESLint and formatting passed. These are
selected-source checks, not a new whole-product build or native qualification.

## Explicitly synthetic size/density/depth measurements

Seven opt-in workloads passed in one serial qualification pass using Node 22.23.4
and the pinned actual parser. Fixture generation is streamed in bounded chunks
and measured separately; it precedes the public route and is not charged to
that route's five seconds. Reported work time includes staging/verification,
query/decode and cleanup through public return. Synthetic files were deleted;
only fixed-label numeric measurements were retained.

| Synthetic shape            | Input bytes | Generated scopes | Requested nesting | Public work ms | Summary bytes |
| -------------------------- | ----------: | ---------------: | ----------------: | -------------: | ------------: |
| sparse                     |   8,500,000 |              400 |                 1 |         165.05 |         1,188 |
| dense                      |   8,500,000 |           80,000 |                 1 |       3,125.08 |         1,212 |
| denser                     |   9,100,000 |          120,000 |                 1 |       4,775.45 |         1,215 |
| qualifying deep            |   9,100,000 |           60,000 |                64 |       3,766.83 |         1,212 |
| nonqualifying deep         |   8,500,000 |           60,000 |                64 |       3,884.18 |         1,196 |
| nonqualifying deepest      |   9,100,000 |           60,000 |               256 |       3,828.15 |         1,196 |
| sparse exact input ceiling |  67,108,864 |               10 |                 1 |         539.33 |         1,168 |

The generator adds a closed selected-emission witness, optionally two unfinished
parents, and one final unselected scope. Qualifying parent nesting adds two to
maximum depth. The table's generated-scope count excludes these fixed additions;
the numeric receipt records event/descriptor/padding packet counts and expected
bucket totals separately. All seven actually completed with matching counts and
coverage masks, zero reported error/loss sums and `childTailCertified:false`.

**What is approximated:** 8.5/9.1 million bytes (about 8.11/8.68 MiB) sample near
the retained native capture byte scale; they do not bracket every observed value.
For comparison, retained V2 `0ffe459` has 8,494,392 capture bytes and V3
`89a04a8` has 9,139,117. Total real scope density/depth is not recoverable from
the retained selected summaries. The 80k/120k scope and depth
64/256 cases are deliberate stress shapes, not measured real-trace replicas.
Ignored protobuf padding controls size independently of event complexity.
The 64 MiB case has only 1,577 pre-padding bytes; it demonstrates sparse input
admission/staging, not dense 64 MiB capacity.

Six cases had a predeclared requirement to complete within the unchanged budget.
Only the nonqualifying depth 256/60k case explicitly allowed a safe timeout as
an inconclusive stress result, not throughput qualification. It completed in
this run. A timeout in any required case remains a test failure; assertions were
not relaxed after observation. The densest case left only **about225 ms** of
headroom, so these timings do not establish robust margin, real-trace throughput
or reproducibility on another runner. No longer budget is proposed. The stress
suite remains explicitly opt-in and is not added to a default/required workflow.

## Tail limitations and proposed next decision

A future separately approved same-category capture could distinguish a
**captured open selected wrapper**, a **captured open unselected source-pinned
wrapper**, and other captured GPU scope ancestry (possibly several together).
That is useful structural evidence beyond the selected-ten summary, not a cause
verdict or an API/native-GPU execution-time measurement.

The embedded producer's incomplete-chunk handling can omit its final packet.
A missing last BEGIN can hide the final scope; a missing END can make a completed
scope appear open. Pinned parser fixtures also demonstrate an incomplete final
protobuf packet accepted with zero error/loss sums and informational overwritten
buffer counters outside severity-loss totals. Thus zero coverage, all-closed
wrappers, zero statistics or a successful final-flush value **never certify the
final producer tail**. The completed native run has no raw capture here to
reparse; observing the new query would require a new, separately scoped capture.

Recommended review boundary: first review this twelve-new-file offline patch
(six frozen prototype files plus five route/test files and this report). A later
integration, if approved, should be a separate fixed, default-off structural-only
summary choice, not a second pass appended to V2/V3. It must retain the exact
Linux x64/Mesa/full/nonpublishing source/runtime guards, existing service tracing
flag, nine categories, window and budgets, actual-emission gate and no-raw
artifact rules. Neither old validator nor historical receipts should change.
Timeout/missing emission is unavailable evidence, not a successful diagnostic.
No workflow or future native run is authorized by this offline result; stop at
the frozen reviewed patch and evidence pending root approval.
