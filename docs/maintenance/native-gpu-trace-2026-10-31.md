# Private native GPU trace diagnostic — 2026-10-31

## Scope and historical boundary

This is an opt-in, nonpublishing harness diagnostic, **not a Linux GPU repair**.
Required native lanes and normal driver comparisons remain untraced. The
`gpu_trace` workflow input defaults to `false`; `MOTOBOUND_GPU_TRACE` accepts only
`0` or `1`. The disabled path calls no tracing APIs, parser or new failure hook.
The separate Linux Mesa trace job retains the full unchanged gameplay journey,
assertions, budgets, quality, driver and security settings. It uploads no
installers/checksums and is not a publication dependency.

The only capture window starts before the actual **Inspect** action and ends
after its authored-model/wheel checks, or on the first sticky graphics fault.
Playwright's `ElectronApplication.evaluate` calls Electron `contentTracing`;
there is no shipping main-process API, renderer bridge, GL/RAF hook, first-use
priming or added rendering/simulation work. A later Three cockpit or Festival
failure is **outside coverage** of a successfully closed Babylon window.

Published `1be6c70` and `a937cac` attempts retained no raw trace. In `a937cac`,
the inventory was actually `[]`: zero groups, no omissions or truncation. Its
trace-evidence gate failed; its later GPU loss had no trace coverage. Empty
discovery does not identify the reason for absent descriptors. The old
raw-promotion diagnostic was paused in `0066f1c` while this private replacement
was reviewed; a skipped/cancelled diagnostic is not a pass.

## Explicit categories, not discovery claims

The same frozen nine-name allowlist is requested, without wildcards or additions:

```text
gpu
gpu.service
gpu.angle
viz
toplevel
disabled-by-default-gpu.service
disabled-by-default-gpu.device
disabled-by-default-gpu.debug
disabled-by-default-angle
```

The receipt says `fixed-allowlist-requested-not-discovered`. Discovery retains
only counts and matches to these constant names, never arbitrary returned
strings. At most 4,096 groups of 512 characters are accepted; malformed,
oversized and omitted counts remain explicit. The receipt is under 16 KiB.
Successful configuration is not evidence that any category emitted events.

[Electron 45.2.1 StartTracing](https://github.com/electron/electron/blob/v45.2.1/shell/browser/api/electron_api_content_tracing.cc#L211-L292)
accepts the supplied configuration independently of category discovery.
[Chromium 156 discovery](https://github.com/chromium/chromium/blob/156.0.8078.75/services/tracing/public/cpp/perfetto/perfetto_session.cc#L130-L192)
can return an empty list on failed queries or absent/unparseable descriptors.
[Its category conversion](https://github.com/chromium/chromium/blob/156.0.8078.75/base/trace_event/trace_config.cc#L802-L835)
accepts explicit filters. These sources support requesting the existing names,
not guessing new categories or claiming why actual discovery was empty.

## Raw data is private, not presumed redacted

The legacy `enable_argument_filter: true` setting is unchanged, but is **not a
privacy guarantee**. Electron passes `privacy_filtering_enabled=false` at
lines 270–273 of its linked implementation. Chromium's Perfetto conversion uses
that separate boolean for debug-annotation/dynamic-name filtering, not the
legacy argument-filter member; its
[Perfetto configuration forwarding](https://github.com/chromium/chromium/blob/156.0.8078.75/services/tracing/public/cpp/perfetto/perfetto_config.cc#L89-L97)
retains the boolean. Thus raw protobuf may contain private annotations/paths.

Raw output and staging stay solely in the ephemeral profile, **outside
`desktop-evidence`**, and are never copied/uploaded. Recording remains
`record-continuously` with a 16 MiB configured buffer; Chromium may allocate
additional metadata buffers, so this is not a total-process memory cap.
Raw input is capped at 64 MiB. It must be a regular file. A capped private
0600 staging copy is closed, checked for source size/mtime/inode changes, and
made read-only before parsing. Symlinks and oversized files are rejected, not
truncated and promoted as valid.

## Pinned offline parser and fixed summary

Only the trace job downloads the official free Linux x64 Perfetto parser:

- Version: **58.2**, 14,897,560 bytes.
- SHA-256: `58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9`.
- [Official binary](https://commondatastorage.googleapis.com/perfetto-luci-artifacts/v58.2/linux-amd64/trace_processor_shell).
- [Pinned official manifest](https://github.com/google/perfetto/blob/403906f4adfbf287a02e5546f8430dcc9d56b649/tools/trace_processor#L63-L76).

The workflow verifies size/digest before execution; the production summarizer
verifies them again. No shell interpolation or third-party parser is used.
The parser receives one fixed SQL query. stdout is capped at 16 KiB and stderr
at 4 KiB; stderr is counted/discarded, never copied into errors or artifacts.
Untrusted parser/JSON failures yield fixed reason labels, not verbatim text.
A parser exit code, when available, is retained only as an integer from 0–255
(or unknown/null inside the private processing error); success records 0.
This is the offline parser exit, not the Electron GPU-process exit code.

`gpu-trace-summary.json` contains exact source identifiers and a strictly
validated constant-labelled numeric schema, capped at 16 KiB. No event args,
freeform process/thread/event names, paths or raw parser output are published.
Sanitized bytes are written to a private temporary sibling, then atomically
renamed only after a successful, non-aborted write. Failure removes the
temporary and prior output; no stale summary is accepted. Such temporary bytes
contain only the validated sanitized schema, never raw trace content.
The **version 2** summary has exactly these category/name pairs (the capture
category list itself is unchanged):

| Category    | Fixed event name                             |
| ----------- | -------------------------------------------- |
| `gpu`       | `CommandBufferStub::OnAsyncFlush`            |
| `gpu`       | `CommandBufferStub::PerformWork`             |
| `gpu`       | `Scheduler::RunTask`                         |
| `gpu`       | `CommandBufferService:PutChanged`            |
| `gpu`       | `GLES2DecoderPassthroughImpl::DoLinkProgram` |
| `gpu.angle` | `CompileEvent::wait`                         |
| `gpu.angle` | `Program::MainLinkLoadEvent::wait`           |
| `gpu.angle` | `ProgramGL::linkJobImpl`                     |
| `gpu.angle` | `ProgramGL::postLinkJobImpl`                 |

The original three names are reviewed in Chromium
[command_buffer_stub.cc](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/service/command_buffer_stub.cc)
and [scheduler.cc](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/scheduler.cc).
The new Chromium scopes cover the
[command-buffer decode loop](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/command_buffer_service.cc#L250-L309)
and [explicit passthrough link call](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/gles2_cmd_decoder_passthrough_doers.cc#L2146-L2163).
Chromium's pinned ANGLE revision defines the
[compile-result wait](https://github.com/google/angle/blob/127e783de33425c27a70a3f48da9d9202d6a0745/src/libANGLE/Shader.cpp#L174-L180),
[link/load-result wait](https://github.com/google/angle/blob/127e783de33425c27a70a3f48da9d9202d6a0745/src/libANGLE/Program.cpp#L694-L701),
and [GL link/post-link scopes](https://github.com/google/angle/blob/127e783de33425c27a70a3f48da9d9202d6a0745/src/libANGLE/renderer/gl/ProgramGL.cpp#L431-L603).
These are host-side scopes, including task joins/status queries; they do not
isolate native shader specialization or LLVM execution. Source definitions do
not prove compiled-in emission: ANGLE's
[trace macros](https://github.com/google/angle/blob/127e783de33425c27a70a3f48da9d9202d6a0745/src/libANGLE/trace.h#L12-L35)
and [registration](https://github.com/google/angle/blob/127e783de33425c27a70a3f48da9d9202d6a0745/src/libANGLE/Display.cpp#L119-L142)
are conditional. No draw-entrypoint or arbitrary marker names are enumerated.

Association requires `slice → thread_track → thread → process`, the typed
`chrome.process_type = Gpu` descriptor and the exact pair's category token.
Names, categories and ordering are constant and strictly validated. A process
merely named “Gpu” or an identically named renderer event does not qualify.
`otherGpuEvents` retains its original **gpu-token-only** scope, excluding the
five known `gpu` pairs; it does not count arbitrary `gpu.angle` events.
Version 1 summaries remain historical evidence but cannot pass the version 2
validator. The capture receipt schema and gameplay acceptance are unchanged.

Each fixed row and the aggregate add `unfinishedFlushAncestorCount`: an
[ancestor_slice](https://github.com/google/perfetto/blob/v58.2/docs/analysis/perfetto-sql-getting-started.md#L540-L575)
`EXISTS` test requires a same-track, exact `gpu` / `OnAsyncFlush` ancestor with
unfinished duration. Each child counts once, even with multiple qualifying
ancestors. No slice/track/process IDs, arguments or dynamic labels are exported.

One additional joint field, `unfinishedUnderUnfinishedFlushCount`, counts only
instances where **both** the specific scope and its same-track flush ancestor
are unfinished. The fixed query computes this conjunction per instance before
aggregation. Validation checks its intersection bounds and exact aggregate sum.
A completed nested link plus an unrelated open link cannot manufacture a
positive joint count from their separate marginal totals.

`coverage` remains general typed-GPU-work coverage. Independently,
`compileLinkDiscriminator` is
`same-track-open-compile-or-link-under-unfinished-flush-observed` only if one of
the five compile/link rows has a positive **joint** count; otherwise it is
**inconclusive**. This is an observed open scope in an uncertified child tail,
not a proven blocked cause or GPU timing. The ordinary ancestor count separately
retains completed nested work; it does not make the discriminator positive.
Cross-thread workers cannot be attributed by same-track ancestry. Missing
scopes, incomplete tails and decoding-only observations do not exclude
compilation or establish draw specialization. No failure-tail window extension
is included.

Rows expose process/event/completed/unfinished counts, trace-relative first/last
nanoseconds and summed/maximum completed duration. These are **overlapping CPU
work spans**, not GPU execution time or a benchmark. Error/loss totals have
separate statistics-row presence counts: zero rows means **unknown**, not known
zero loss. Even present zero counters cannot certify completeness.
`childTailCertified` is always `false`. An actual truncated protobuf fixture
exits the pinned parser successfully with zero errors: neither `parseCompleted`
nor the bounded-input `captureValid` flag proves complete protobuf/child tails.

## Deadlines, cancellation and first-error precedence

Discovery/start/stop retain their existing 5-second waits. Hash verification,
private copying, parsing and summary writing share the existing 5-second
file-processing budget; it is not extended. One AbortSignal stops file streams
and kills the parser on deadline. Parser settlement requires its **close**
event, not merely error/exit/a successful kill request. Staging deletion follows
that settlement. Output limits also kill the parser and wait for close.

A timeout does not falsely cancel native Electron tracing: a late start
acknowledgement still requests a bounded stop, marked uncertain. The authored
operation is neither raced nor cancelled by tracing. Its exception is
synchronously retained through the existing failure ledger **before cleanup
awaits**; later GPU loss or failed snapshots/trace cleanup cannot replace it.
The first-fault watcher is explicitly settled on operation completion.

A stalled OS metadata operation or non-cooperative inspection must not cause an
unbounded outer cleanup wait. Cleanup aborts all active inspection owners and
returns an honest constant-valued receipt. It schedules raw deletion only after
inspection settlement **and confirmed Electron shutdown**. A rejected close
records `producer-unconfirmed`; unsettled inspections record deferred cleanup.
Private leftovers can remain until runner teardown; no uploaded receipt claims
otherwise. `gpu-trace-cleanup.json` is separate from the original pre-close
failure report and contains no paths or trace strings.

## Separate evidence gate and verification

The diagnostic-only `--validate desktop-evidence/report.json` step checks exact
source, exact nine-category order, buffer/recording/filter settings, fixed
scope/empty omitted checks, filename, regular-file size/digest, strict schema and
actual **typed GPU
work coverage**. Nonempty raw files, successful gameplay, metadata-only traces,
unknown-name-only traces and successful parser exit are insufficient. A useful
partial capture may pass while its child tail remains explicitly uncertain.
The outcome is `retained-typed-gpu-work-summary`, never a gameplay/repair claim.
Invalid evidence reports only `trace-summary-validation-failed`.

Focused checks include the unchanged first-fault/default-off regressions;
malformed, oversized and privacy-negative summaries; shared stream abort;
parser kill-before-close ordering; late/never-settling inspection cleanup;
source/digest/coverage gates; workflow default/selector preservation; and an
**actual SHA-pinned parser** suite independent of mocks. Real fixtures distinguish
typed GPU versus spoofed identity, annotated private names/paths, unfinished
spans, truncated packets, wrong parser binaries, oversized input and symlinks.
The parser fixtures run without Electron/browser/network runtime access.

## Actual version 1 capture and version 2 limits

Source `2caf341` produced the first verified private summary. The dedicated
[driver diagnostic](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41242964971)
passed its trace-evidence gate while gameplay **failed** the original wheel
readiness wait. The artifact contained seven expected JSON/PNG files and no raw
trace or parser output. Empty discovery was recorded honestly; the same fixed
categories were requested. The private 8,432,880-byte input produced a
1,915-byte summary with one typed GPU process, 3,917 known events and two
unfinished scopes (`OnAsyncFlush` and `Scheduler::RunTask`). Error/data-loss
statistics were present and zero, but the child tail remained uncertified.
The GPU exit 512 arrived **11.576 seconds after** the stopped capture window;
that later fault is outside coverage. Original action failure retained
precedence. Cleanup confirmed producer closure but recorded raw deletion as
scheduled, not independently confirmed. These receipts do not establish the
underlying stall or a repair.

Version 2 adds only the six parser-selected pairs and numeric ancestry above.
The categories, recording window, 5-second processing budget, input/output caps,
raw-private lifetime, first-fault handling and all required untraced lanes are
unchanged. Actual Electron emission of these new scopes remains unverified
until its own exact-source Actions artifact is inspected. General GPU coverage
may still pass the diagnostic evidence gate with an inconclusive discriminator;
neither status is gameplay success or GPU repair evidence.

The original version 1 local receipt was Node **22.23.4**, **74 tests in 5 files**
including 15 required real-parser cases. Version 2 focused validation on Node **22.23.4** passed **94 tests in 5 files**
(`native-gpu-trace`, `native-gpu-trace-summary`, `native-gpu-trace-parser`,
`native-gpu-trace-workflow`, `native-smoke-control`), including **32 real-parser
cases** with `MOTOBOUND_TRACE_PARSER_REQUIRED=1`. Scoped strict TypeScript,
ESLint and formatting passed. The fixtures include completed/unfinished nested
children, each isolated compile/link pair, completed-flush and cross-track
negatives, mixed completed-nested/open-cross-track instances, exact-category
and typed-identity rejection, duplicate-ancestor
once-only counting, schema-version rejection and private annotation exclusion.
Full-project validation is reported separately in
[current status](../CURRENT_STATUS.md). Offline fixtures do not establish GPU
performance, and prior later-normal-frame losses remain counterevidence to a
first-use-only explanation.

## Linux exit-status interpretation

Pinned Chromium 156.0.8078.75 [POSIX process status](https://github.com/chromium/chromium/blob/156.0.8078.75/base/process/kill_posix.cc) preserves the raw wait status. The observed 512 decodes to exited status 2, rather than a direct SIGKILL receipt. The pinned [GPU result code](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/common/result_codes.h) names 2 as the hung-process result; the [watchdog termination path](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/service/gpu_watchdog_thread.cc) uses it after a final no-progress check. The Linux launcher/zygote and Electron child-process-gone propagation preserve that status.

This is consistent with GPU hang termination. It does not establish that the watchdog was the only possible caller, or identify shader specialization, LLVM, memory pressure or another underlying stall. No watchdog, quality, security or gameplay deadline is relaxed by this interpretation. A later context-restored event does not erase the original fault.
