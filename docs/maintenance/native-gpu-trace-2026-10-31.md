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
unchanged. Actual Electron emission was subsequently verified on `b451a2e`; the
retained result is detailed below. General GPU coverage
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

## Actual version 2 capture: `b451a2e`

The dedicated Mesa run retained a verified 5,113-byte version 2 summary from
8,698,878 privately processed bytes. The GPU fault was observed **inside** the
unchanged Inspect/wheel window. Every selected new scope emitted. The only
positive joint-open descendant was `CommandBufferService:PutChanged` under an
unfinished `OnAsyncFlush`; all five selected compile/link rows completed and
had zero joint-open ancestry. The discriminator therefore remained
**inconclusive**. Error/loss statistic rows were present and zero, but
`childTailCertified` remained false. No raw capture or parser output was uploaded.

Preparation completed 403/403 cumulative leases (115 initial surface + 115
restart surface + 173 original asset variants). Required and traced Mesa later
lost the GPU during normal original-model presentation, whose scene still
contained the live road/paint. Windows, Apple Silicon and diagnostic SwiftShader
passed all four journeys. Compatibility Mesa returned its cockpit CPU draw and
then lost the GPU while its fence remained pending. These observations neither
identify the later failing command nor isolate road/paint, asset, LLVM or another
backend owner. They are not a first-use-only failure proof or a Linux repair.

## Service-API-boundary experiment (implemented, not yet run natively)

This is a **separate, nonpublishing configuration**, not an expansion of the
existing trace mode. It was initially manual-only. Its unchanged manual path
and the temporary, explicitly authorized one-shot push path below share
`desktop-gpu-service-api-review.yml`, read-only repository permissions, and one
Ubuntu 22.04 / Linux x64 / Mesa / full-journey call. The reusable input
`gpu_service_api_trace` and harness `MOTOBOUND_GPU_SERVICE_API_TRACE` default to
`off`; the only other value is `service-api-boundary-v1`. Existing
`MOTOBOUND_GPU_TRACE=0|1` semantics remain unchanged.

The new selector is rejected unless private tracing is enabled, target and host
are Linux x64, graphics is Mesa, journey is full, and GitHub's existing caller
context identifies the dedicated manual workflow or the exact one-shot push
below. This is checked before
dependency/package work and independently before Electron launch. A manual
launch of a required release workflow is insufficient. Package publication
remains `--publish never`; installer/checksum steps additionally require the
new selector to be off. Required lanes and the existing driver comparison do not
select this mode. No security approval is implied; local Chromium restrictions
and the separate Ubuntu 24.04 sandbox-helper blocker remain unchanged.

The sole added launch switch is `--enable-gpu-service-tracing`. Chromium
156.0.8078.75's
[wrapper installation](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_implementation_wrapper.h#L24-L34)
requires this flag; selecting the existing `gpu` category alone does not install
it. Its
[switch-forwarding list](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_switches.cc#L181-L188)
passes it to the GPU process. Source Electron 45.2.1 is required before launch;
the existing runtime observation must confirm Electron 45.2.1 and Chromium
156.0.8078.75 before capture. No extra runtime observation API is introduced.
A constant-only launch receipt records the guarded mode, sole switch and fixed
platform/backend/journey facts. Actual event emission is checked separately.

There is **no** GPU service logging, decoder-category addition, application
bridge, draw/RAF hook, extra priming or fence, custom ANGLE build, watchdog
change, quality reduction, security change, or deadline increase. The nine
capture categories, Inspect-to-wheel/first-fault window, original authored
operation, first-error precedence and cleanup ownership remain unchanged.
The mode has no release dependency and may fail independently of gameplay.

### Exact version 3 summary

Version 2 remains the baseline parser/validator, with unchanged fixed SQL bytes
and default output. Shared immutable parser limits, baseline pairs and fixed
errors are factored into `native-gpu-trace-protocol.mjs` without changing their
values. Version 3 is selected only by the explicit new mode and has a separate
strict validator. It retains the original nine pairs and appends exactly these
ten **`gpu`** pairs in this order:

| Fixed event name                           | Pinned Chromium definition                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `TraceGLAPI::glDrawArrays`                 | [5283–5286](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5283-L5286) |
| `TraceGLAPI::glDrawArraysInstancedANGLE`   | [5288–5295](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5288-L5295) |
| `TraceGLAPI::glDrawElements`               | [5318–5324](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5318-L5324) |
| `TraceGLAPI::glDrawElementsInstancedANGLE` | [5326–5335](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5326-L5335) |
| `TraceGLAPI::glClientWaitSync`             | [4935–4940](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L4935-L4940) |
| `TraceGLAPI::glWaitSync`                   | [7717–7720](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L7717-L7720) |
| `TraceGLAPI::glGetSynciv`                  | [6223–6231](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L6223-L6231) |
| `TraceGLAPI::glFenceSync`                  | [5426–5429](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5426-L5429) |
| `TraceGLAPI::glFlush`                      | [5441–5444](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5441-L5444) |
| `TraceGLAPI::glFinish`                     | [5431–5434](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc#L5431-L5434) |

The query still requires the typed `chrome.process_type=Gpu` descriptor through
`slice → thread_track → thread → process`, with exact category tokens. Two new
numeric fields count (a) instances with an unfinished PutChanged ancestor that
**itself** has an unfinished OnAsyncFlush ancestor, all on the same track, and
(b) the conjunction of that ordered chain with the child's own unfinished state:
`unfinishedDecoderFlushAncestorCount` and
`unfinishedUnderUnfinishedDecoderFlushCount`. Nested `EXISTS` predicates count
each child once even with duplicate qualifying ancestors. Separate parent/child
marginals, temporal overlap, reversed parents and cross-thread instances cannot
manufacture a positive chain. Validators enforce subset/intersection bounds,
necessary open-parent evidence and exact aggregate sums.

`serviceApiCoverage` requires actual emission of at least one of the ten new
pairs. General GPU work alone cannot pass this mode's evidence gate. The
`serviceApiBoundaryDiscriminator` is
`same-track-open-service-api-under-unfinished-decoder-and-flush-observed` only
when an added API row has positive joint count; otherwise it is `inconclusive`.
The original compile/link discriminator still uses only its five original rows.
`otherGpuEvents` in version 3 excludes the nineteen selected `gpu`/`gpu.angle`
pairs while retaining its gpu-token-only counting scope. Neither version's
counts are directly interchangeable without accounting for the different
selected names.

The separate successful evidence outcome is
`retained-typed-gpu-service-api-summary`, not gameplay success. It also requires
exact launch facts, pinned observed runtime, source, categories, settings,
regular-file size/digest and numeric schema. Version 3 cannot satisfy the
baseline version 2 validator, or vice versa. No event arguments, names discovered
from traces, IDs, pointers, shader text, paths or raw parser output enter the
sanitized summary. The new wrappers' argument-free definitions are **not** a
privacy guarantee for other raw trace content.

### Bounds, interpretation and stopping condition

The existing 16 MiB recorder buffer, 64 MiB maximum raw input, 16 KiB parser
stdout/summary, 4 KiB counted/discarded stderr, five-second shared processing
budget, five-second tracing API waits and 50-minute outer job limit remain
unchanged. Recorder/input bounds are **not total-process or RSS caps**. No new
parser address-space restriction is introduced as an unqualified variable.
Raw and staging remain private outside `desktop-evidence`; no raw upload is
permitted on success or failure. Parser termination still settles on close;
producer closure and inspection settlement still govern cleanup. Retention now
also removes a prior sanitized summary if mode/schema validation, serialization
or the size check fails before writing; successful version 2 bytes are unchanged.

These scopes measure host-side Chromium-to-GL/ANGLE API calls, not native Mesa
instructions, device execution time or CPU utilization. A captured open draw
API can include validation, specialization, synchronization or other driver
work. Even `glClientWaitSync` does not establish passive waiting: Chromium
[adds `GL_SYNC_FLUSH_COMMANDS_BIT`](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/gles2_cmd_decoder_passthrough_doers.cc#L702-L710)
to the call. Fence/flush/server-wait names retain their literal API meaning.
No positive row establishes LLVM, OOM or a unique underlying cause; absence does
not exclude uninstrumented work or a lost child tail. `childTailCertified` stays
false. Additional wrapper traffic can change scheduling and recorder churn;
filtering the later summary does not remove that instrumentation overhead.

The alternative decoder category is intentionally excluded: it selects the
[debug decoder path](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/gles2_cmd_decoder_passthrough.cc#L917-L995),
and GPUTracer can
[add device timers](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/gpu_tracer.cc#L110-L151)
while emitting service events on
[explicit tracks](https://github.com/chromium/chromium/blob/156.0.8078.75/gpu/command_buffer/service/gpu_tracer.cc#L85-L109).
That would be a different perturbation and ancestry model.

The authorized execution scope remains **one bounded observation**
through the existing window and terminal cleanup. Report observed API-boundary
evidence, unavailable/inconclusive evidence, or non-reproduction under
instrumentation. Do not broaden categories, extend the window, retry until a
preferred result appears, or call a traced pass a repair. Native emission and
this mode's fault coverage remain unverified until that exact-source run exists.

### Temporary exact-push authorization — 2026-11-01

The owner could not click Run workflow and explicitly requested an autonomous
way forward. The narrow alternative uses ordinary repository-write/Actions
authorization, not credentials, an API restriction bypass or security changes.
No service-API observation had run when this exception was implemented.

The temporary push trigger matches only `main` and changes to this dedicated
workflow file. The job condition requires this repository and workflow, first
attempt, a non-created/non-deleted/non-forced push, and exactly one commit from
previous head `b3a0cc29a78f03ac019e701592b4788d468f124e`. The complete commit
message must be exactly:

```text
diagnostic: authorize gpu-service-api once 2026-11-01-8dc45f7a
```

Event `after`, head commit, sole commit, `github.sha` and workflow SHA must
agree. A later ordinary push cannot reuse the fixed previous head; ordinary
messages do not select the diagnostic. A rerun is not an authorized second
observation. The original manual-dispatch behavior remains unchanged.

GitHub's preliminary expression equality is case-insensitive. Before dependency
installation, and again before Electron launch, the same guard repeats the
checks case-sensitively using the documented
[GitHub default context and event-file variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
and [push payload fields](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push).
The push path also rejects fork identity and requires the packaged source
commit to equal the authorized GitHub SHA. Workflow SHA is the documented
[workflow revision identity](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context),
not a branch-name approximation. These checks bind the run to its source; they
do not protect against a repository writer deliberately editing the guard.

Only this push path reads `GITHUB_EVENT_PATH`: at most 256 KiB, regular file,
no-follow open, nonblocking open to prevent a FIFO replacement from hanging,
stable descriptor identity/size/mtime, and bounded reads. Malformed, oversized,
symlink, nonregular or unavailable input fails closed with no payload/path/OS
error reflected in logs or artifacts. Off and manual modes never read it.
This is an input/allocation bound, **not an RSS or OS-latency cap**.

The push launch receipt has the same fixed facts but uses
`oneShotPushNonpublishing: true` instead of `manualNonpublishing: true`.
Both flags, extras and other receipt values are rejected; manual receipts and
default V2 behavior are unchanged. No event payload or new trace-derived field
enters the summary. Existing source/runtime pins, ten wrapper pairs, typed GPU
identity, actual-emission gate, categories, window, parser, limits, first-error
precedence and no-raw-upload policy remain unchanged.

Publish only the tested direct child with that exact message, verify one run,
and follow it through terminal compact-evidence review. Then remove the push
trigger and launch authorization. If it does not qualify, stop and report the
failed guard; do not broaden the trigger, retry until a desired result appears,
or claim native service-API evidence without actual emitted wrappers.

The one-shot guard's offline regression passed **350 tests in 10 files**,
including all **99 real pinned-parser cases**, with one deliberately
non-host-platform branch skipped. The three directly affected suites passed
178 tests with that same skip. Tests exercise exact identity/token/parent/SHA,
trailing LF/CRLF and case differences, first-attempt/force/fork/commit-count
rejection, actual bounded UTF-8 file reads, symlink/directory/FIFO refusal,
off/manual no-read behavior, source mismatch, fixed error privacy, both exact
receipt forms and unchanged default receipt bytes.

The shared-worktree native selector passed **893 tests / one platform-branch
skip in 67 files**. This included seven unpublished asphalt-reference cases
outside the diagnostic manifest; it is not described as an isolated 66-file
snapshot run. Two overlapping broad type checks were killed with exit 137 and
are not counted as passing. One subsequent serial **full TypeScript check
passed** in a same-computer source snapshot of exact parent `b3a0cc2` plus only
the nine-file diagnostic patch. Scoped strict types, ESLint, Prettier,
actionlint and whitespace checks passed. Both summary parser modules, the
shared parser protocol and reusable platform workflow remained byte-unchanged;
the baseline SQL hash below still matches. These are engineering results, not
native service-API emission or a graphics repair.

### Offline engineering verification for the service-API mode

On Node **22.23.4**, the final focused run passed **254 tests in 10 files**:
existing trace/summary/parser/workflow and smoke-control/target regressions,
plus the new service-API mode, summary, parser and workflow suites. This includes
**99 required real-parser cases** (32 baseline + 67 service-API) using the exact
SHA-pinned Perfetto 58.2 binary, without Electron/browser/network runtime access.
Full-project TypeScript, final scoped strict TypeScript, scoped ESLint,
formatting, workflow actionlint and whitespace checks passed.

Every added wrapper has isolated open, completed-under-open and mixed-instance
fixtures. Additional cases reject wrong category tokens at each ancestry layer,
reversed/cross-track/missing/completed parents, spoofed process names, annotation
spoofing, private names/paths, unknown events, malformed/truncated inputs,
incorrect parser binaries, oversized input and symlinks. Duplicate ancestors
count a child once. The stronger nested-subset intersection lower bound is
independently exercised. New-mode timeout/output-limit/abort fixtures retain
close-before-settlement; both modes remove stale sanitized output on pre-write
validation/serialization/size/abort failures. Default-off workflow guards,
source/runtime pins and actual-emission evidence gates have independent tests.

The baseline SQL bytes and default real-parser summary bytes were compared
against `cee488b3e399c67fcf5c4d94fc9defa02b355272` and matched exactly. Baseline
query SHA-256 is
`b4a1c214b63de669bdf4132826add06aff40e63a38b3de01bde46fea8f56c81e`.
These are offline engineering results only: no service-API native run, source
publication, GPU repair or new gameplay qualification is claimed here.
