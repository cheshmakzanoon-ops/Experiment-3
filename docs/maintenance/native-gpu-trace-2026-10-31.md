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
The only named work rows are:

1. `CommandBufferStub::OnAsyncFlush`
2. `CommandBufferStub::PerformWork`
3. `Scheduler::RunTask`

These names are source-reviewed in Chromium
[command_buffer_stub.cc](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/service/command_buffer_stub.cc)
and [scheduler.cc](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/scheduler.cc).
Association requires `slice → thread_track → thread → process` and the typed
`chrome.process_type = Gpu` descriptor, plus an exact `gpu` category token.
A process merely named “Gpu” or an identically named renderer event does not
qualify. Other GPU event names produce only a numeric count.

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

Actual Electron execution of this private protocol remains unverified until its
own exact-source Actions artifact is inspected. Offline fixtures and unit tests
do not establish GPU performance, a Linux failure cause, or a repair. Prior
later-normal-frame losses remain counterevidence to a first-use-only explanation.

Final focused local receipt: Node **22.23.4**, **74 tests in 5 files passed**
(`native-gpu-trace`, `native-gpu-trace-summary`, `native-gpu-trace-parser`,
`native-gpu-trace-workflow`, `native-smoke-control`); the 15 real-parser cases
are included, with the required-parser flag enabled. Scoped strict TypeScript
checking of the four trace suites/declarations passed. The focused evidence is retained in the development validation record.
Full-project validation is reported separately in [current status](../CURRENT_STATUS.md).

## Linux exit-status interpretation

Pinned Chromium 156.0.8078.75 [POSIX process status](https://github.com/chromium/chromium/blob/156.0.8078.75/base/process/kill_posix.cc) preserves the raw wait status. The observed 512 decodes to exited status 2, rather than a direct SIGKILL receipt. The pinned [GPU result code](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/common/result_codes.h) names 2 as the hung-process result; the [watchdog termination path](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/ipc/service/gpu_watchdog_thread.cc) uses it after a final no-progress check. The Linux launcher/zygote and Electron child-process-gone propagation preserve that status.

This is consistent with GPU hang termination. It does not establish that the watchdog was the only possible caller, or identify shader specialization, LLVM, memory pressure or another underlying stall. No watchdog, quality, security or gameplay deadline is relaxed by this interpretation. A later context-restored event does not erase the original fault.
