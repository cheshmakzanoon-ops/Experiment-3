# Native GPU trace diagnostic — 2026-10-31

## Scope and default-off contract

This is a harness-only diagnostic, not a GPU failure repair or first-use draw
priming. `scripts/native-gpu-trace.mjs` uses Electron's built-in `contentTracing`
through Playwright `ElectronApplication.evaluate`; it adds no shipping
main-process API or renderer bridge.

The reusable desktop workflow defaults `gpu_trace` to `false`.
`MOTOBOUND_GPU_TRACE` accepts only `0` or `1`, defaults to `0`, and rejects other
values. The disabled operation invokes neither tracing APIs nor the new failure
snapshot callback. Required native lanes and existing driver comparisons remain
untraced.

The existing Linux driver-review workflow adds a separately labelled
`gpu-trace-mesa` job: Ubuntu 22.04, Mesa, the **full** unchanged Babylon and
compatibility journeys. It cannot publish packages, uploads no installers or
package checksums, and retains a distinct
`desktop-evidence-linux-x64-gpu-trace` artifact. Required publication dependencies
are unchanged. Tracing with the compatibility-only journey is rejected.

Only one window is captured: setup immediately before the real **Inspect**
action for the original Formula asset, through the existing authored-model and
wheel-motion checks, or a stop request on the first sticky graphics fault.
Tracing does not race or cancel the authored operation. Existing gameplay
assertions, action deadlines, quality, driver selection and security settings
remain unchanged. No additional draws, GL queries/hooks, RAF hooks or simulation
updates are introduced.

## Categories, storage and cleanup bounds

The frozen allowlist is intersected with Electron's reported category inventory:

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

The inventory is limited to 4,096 entries of at most 512 characters each. At
least one supported GPU/ANGLE category must remain. There are no wildcard,
heap-profiling or system-profiling categories. Recording uses
`record-continuously`, a 16 MiB buffer and argument filtering.

After discovery, `categoryInventory` records the original group count and a
bounded sample before selection can reject the inventory. It retains at most 64
groups, each capped at 128 JavaScript string code units, within a strict 16 KiB
UTF-8 JSON limit. Omitted groups, sampled malformed entries and sampled truncated
strings have separate counts. Malformed values become `null`, without coercing
or serializing their contents. This sample is **not** used for validation or
selection: the full original inventory still faces the same limits, fixed
allowlist and no-supported-GPU rejection. Default-off calls produce no inventory.

Category discovery and start each have a 5-second wait; stop and file inspection
also each have a 5-second wait. These diagnostic waits do not extend the existing
gameplay readiness budgets. A timeout does **not** cancel an underlying native
operation: a late start acknowledgement triggers another bounded best-effort
stop, serialized after the prior stop and marked uncertain. The first-fault
watcher is settled when the authored operation ends so its listener is removed.

Electron 45's output is Perfetto protobuf (`.pftrace`), not JSON. Raw output and
the streaming staging file stay in the ephemeral profile outside the uploaded
evidence directory. Only a size-checked, streaming-capped copy is promoted to
`gpu-trace.pftrace`: at most 64 MiB, with byte count and SHA-256. Oversized output
is removed rather than truncating protobuf and calling the prefix valid.
Receipts retain source commit, package fingerprint, Electron version, selected
configuration, times, completeness and up to four error strings of 2,048
characters each.

## First-error precedence

When the traced operation throws, the harness synchronously calls the existing
`retainNativeSmokeFailure` **before any cleanup await**. A later GPU exit during
trace stop cannot replace an earlier readiness timeout. The later graphics fault
remains separately retained. The snapshot callback is best-effort: even if it
throws, the original operation error wins. Trace setup/stop/file errors are
diagnostic evidence failures, not replacement gameplay failures.

## Separate evidence gate and interpretation

The trace job always attempts this additional diagnostic-only step after launch:

```sh
node scripts/native-gpu-trace.mjs --validate desktop-evidence/report.json
```

It requires enabled diagnostic recording metadata, matching packaged source,
the fixed file name, a nonempty regular file (not a symlink), size at most 64 MiB,
and an independently recomputed matching size/SHA-256. Report input is bounded
to 32 MiB. `gpu-trace-validation.json` records `retained-bounded-trace` or
`trace-evidence-unavailable`; missing evidence fails this diagnostic step even
if gameplay passed. This is an integrity/retention check, not a protobuf semantic
parser or a claim that every GPU event was captured.

A retained partial/uncertain trace is accepted as diagnostic evidence. Even an
acknowledged flush is labelled `window-flushed-child-tail-not-certified`:
a crashed child can lose its tail, and a circular buffer can overwrite earlier
events. Missing or late cleanup is marked `partial-or-uncertain`.

If the Inspect/wheel window flushes successfully and a later Three cockpit frame
fails, the receipt explicitly says
`observed-after-trace-window-not-explained-by-this-capture`. A healthy captured
Babylon window cannot explain that later failure. Unavailable or uncertain
windows do not establish coverage. Backend specialization or LLVM cost remains
a hypothesis; generic GPU exit/context loss alone does not prove it, an OOM,
or a watchdog cause. Prior failures after completed preparation and subsequent
normal frames remain relevant counterevidence to a first-use-only explanation.

## Validation at handoff

On 2026-10-31 at 19:34 UTC, the frozen implementation passed 55 focused tests in
five files under local Node 24.22.1:

- `native-gpu-trace.test.ts`: 11 tests, including default-off behavior, bounded
  cleanup, late acknowledgements, evidence integrity and a late fault during
  stop that cannot replace the original error.
- `native-gpu-trace-workflow.test.ts`: 7 tests.
- `native-smoke-control.test.ts`: 16 tests.
- `native-preparation-evidence.test.ts`: 15 tests.
- `ci-workflow.test.ts`: 6 tests.

Scoped ESLint, Prettier, `git diff --check` and actionlint for both affected
workflows passed. Combined type/build and Node 22 validation are owned by the
integration run and are not claimed by this focused receipt.

At that handoff, actual Electron trace execution had not been verified. These
were unit, workflow and source checks; no local native trace was collected. The existing
`cf7672529fd7f2f47493393c74360188bc1c42c3` native results predate this diagnostic:
Windows, Apple Silicon and SwiftShader passed; required Mesa and Mesa
compatibility failed; Ubuntu 24 failed before connection on its existing sandbox
configuration. None is a trace-runtime receipt or evidence of a GPU repair.

## First packaged attempt and bounded inventory follow-up

The first diagnostic job at source
`1be6c704cdfb1816ebf5601fa8e41fedca5c7a95` (driver-review run `41236092096`, job
`124640074155`) retained **no trace**. Its receipt has `config: null`, no start
request timestamp, and `No supported GPU trace categories were reported`.
Artifact `13055761794` (SHA-256
`3fc567b70621e339272b8aff516e6c8dcabad18659775952eb29a7ae5ed9a473`)
contains the failed evidence-validation receipt, not a `.pftrace`. The evidence
gate correctly failed. This was category-selection failure, not a stop timeout
or file-integrity failure; the original inventory was not retained in that run.

Pinned [Electron 45.2.1 implementation](https://github.com/electron/electron/blob/v45.2.1/shell/browser/api/electron_api_content_tracing.cc)
delegates category discovery to Chromium. Its pinned
[Chromium 156.0.8078.75 implementation](https://github.com/chromium/chromium/blob/156.0.8078.75/services/tracing/public/cpp/perfetto/perfetto_session.cc)
reads Perfetto service-state `track_event` descriptors; a failed query, parse
failure or absent descriptors can yield an empty category vector. These source
paths do **not** establish which condition occurred, or justify guessing new
categories or changing the tracing configuration. The bounded receipt above is
the next discriminating observation; it adds no retry, category expansion,
deadline increase or driver/security switch.

In that job, the unchanged Babylon model/wheel checks passed before a later Three
cockpit fence was cancelled on GPU exit. Coverage remains
`trace-window-unavailable-or-uncertain`; no trace explains that failure. The
separate required, untraced Mesa lane failed the 15-second wheel-motion wait
after model import. A still later GPU exit appears in its teardown job log, not
its already-finalized report. A separate compatibility-only Mesa pass cannot
replace that required full-journey failure. Actual retained Electron trace
recording and its useful event coverage remain unverified.

The inventory follow-up passed its 14 trace tests plus 7 workflow tests, scoped
strict TypeScript, ESLint, Prettier and diff checks. New cases cover empty and
no-match inventories, malformed values without coercion, oversized arrays,
escaped/non-ASCII byte bounds, explicit omissions, default-off absence and a
valid GPU category beyond the retained sample. This is receipt/selection unit
proof, not successful native capture.
