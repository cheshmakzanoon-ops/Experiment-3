# Offline GPU structural-coverage prototype · 2026-11-01

**Offline-only, not integrated and not native evidence.** This prototype lives in
a selected-source snapshot of `0ffe4599cb87a867942b775d57630154747a9f5c` on the same
cloud computer. It does not change V2/V3, their validators, launch guards,
workflows, capture settings, native tests or production game code. No existing
raw capture was retrieved, inspected or reparsed; the completed one-shot run
retained only compact evidence here. No future capture is authorized by these
unit/parser results.

## Useful additional question

The existing V3 summary can show every selected wrapper completed while its
`otherGpuEvents` remains only an aggregate. The prototype asks whether an
**unselected, source-pinned wrapper instance** is captured open beneath the
**same typed-GPU, same-track, ordered unfinished decoder → flush chain**.
A synthetic real-parser case demonstrates the additional information: the
unchanged V3 sees the selected wrapper completed and remains inconclusive;
the prototype observes one open unselected wrapper beneath that exact chain.
This is additional captured structure, not identification of a native driver
stall, proof of execution at process death, or a tail-completeness certificate.

## Source-closed catalogue

The exact [Chromium 156 generated GL bindings](https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc)
contain **403 unique argument-free `gpu` TraceGLAPI labels**. The source copy is
605,856 bytes, SHA-256
`bd48608bfbede328cec4fbb1afb320df72530940d3f69b22e86e3cecbf7e7916`.
`offline-gpu-structure-catalogue.json` records the pinned URL, source SHA/size,
extraction rule, every literal name and source line. An independent review
re-extracted all 403 names **and all 403 line numbers** from that exact source.
The newline-delimited sorted-name SHA is
`a0c7838d4eeacdec96300c1f4352a044d4c3866f4ace417f6f65b0481eb1df3c`.

This is not another guessed list of likely calls. The three numeric buckets are:

1. The **same ten** selected wrapper pairs as existing V3.
2. The **remaining 393** argument-free wrappers from that complete pinned file.
3. Other exact-`gpu`-category-token scopes, including unnamed scopes, but excluding
   the two separately counted parent pairs.

The two parents are `CommandBufferService:PutChanged` and
`CommandBufferStub::OnAsyncFlush`; neither can count as its own child. The
catalogue does not cover every action inside decoding or ANGLE/Mesa internals.
The fixed wrapper instrumentation remains a service API boundary, not native
GPU execution time. This prototype does not enable any instrumentation.

## Query and output contract

`offline-gpu-structure-prototype.mjs` is a pure SQL/decoder/validator module. It
has no launcher, CLI, recorder, raw reader or workflow integration. The query
uses the typed Chrome `Gpu` process descriptor, never process/thread labels.
Category matching requires an exact token, not a prefix. The two nested
`EXISTS` conditions apply to the same child and one ordered same-track ancestor
chain, with all required instances unfinished. Nested duplicate parents do not
multiply child counts. Aggregate timestamps and independent marginal counts
are not substituted for per-instance conjunctions.

Output has a separate `offline-gpu-structural-coverage-v1` schema. Each bucket,
the work aggregate and the two parents retain only fixed row indices and
numeric process/event/completed/open/ancestor/joint counts. Indices 0–5 are
constant schema positions, **not trace IDs**. Parent-row ancestor counts mean
open-flush ancestry; child-row ancestor counts mean the full open decoder/flush
chain. The coverage mask uses bits 1/2/4 for positive joint counts in the three
buckets. No bucket wins causal priority when several bits are set.

No dynamic name, category, timestamp, duration, event argument, path, process
identifier, thread identifier, track identifier or parser diagnostic is exported.
Private synthetic strings and misleading identities are exercised by tests.
The strict validator rejects extra, inherited, hidden, accessor and symbol
properties; arrays must be dense and exactly bounded before iteration. Counts
are finite nonnegative safe integers, completed+open partitions and aggregate
sums must agree, and joint counts satisfy intersection bounds. Covered-process
lower bounds cannot exceed the available qualified parent processes/instances.

The existing bounds are preserved: **64 MiB input,16 KiB stdout,4 KiB discarded
stderr,16 KiB summary and 5-second parser processing**. The test helper checks
actual synthetic input length, launches without a shell, kills on deadline or
output overflow and waits for child close. These recorder/input/output/time
bounds are **not RSS or address-space caps** and cannot preempt an unresponsive
OS operation. No parser address-space restriction was introduced.

## Tail and statistics limitations are tested, not assumed away

`childTailCertified` is always false, including when every captured scope is
closed, every reported error/loss sum is zero, or the trace contains a successful
final-flush statistic. A missing final BEGIN can be indistinguishable from work
that had not started; a missing final END can create observed openness even
when the underlying call completed.

Two initial tests had incorrect assumptions. Their failures are retained, and
replacement tests make stronger assertions about the actual pinned parser:

- A valid synthetic stream followed by an incomplete final protobuf packet
  (`0x0a,0xff`) is accepted by pinned 58.2 with the earlier rows and zero
  error/loss aggregates. The summary still cannot certify its tail.
- Seven synthetic overwritten chunks produce an independently queried numeric
  buffer value of 7 but a severity-`data_loss` contribution of 0. This counter is
  [informational in the source](https://github.com/google/perfetto/blob/v58.2/src/trace_processor/storage/stats.h).
  The existing severity sums therefore do **not** exhaust buffer-loss facts.
  They are sums of reported stat values, not a normalized count of missing
  events. The prototype intentionally does not turn a zero sum into completeness.

The fixture fields are source-backed by [TracePacket](https://github.com/google/perfetto/blob/v58.2/protos/perfetto/trace/trace_packet.proto),
[TraceStats](https://github.com/google/perfetto/blob/v58.2/protos/perfetto/common/trace_stats.proto)
and the [stats importer](https://github.com/google/perfetto/blob/v58.2/src/trace_processor/importers/proto/proto_trace_reader.cc).
Final-flush-success and failure are verified with real numeric parser output;
neither establishes the lost producer's final committed packet.

The embedded producer/service source is a different revision from parser 58.2:
[Chromium DEPS](https://github.com/chromium/chromium/blob/156.0.8078.75/DEPS#L2843-L2844)
pins Perfetto `403906f4adfbf287a02e5546f8430dcc9d56b649`.
Chromium already enables shared-memory scraping; the embedded service scrapes
on disconnect before unregistering the producer. Thus it is unsupported to
assume the entire final chunk vanished. Both embedded buffer implementations,
however, omit the last packet of an incomplete chunk. The completed native
summary does not establish whether that occurred in its particular window.
The detailed source review remains in the external evidence record.

## Verification and isolation

- **237/237 tests in five suites passed:** 99 new prototype contracts, 99 unchanged
  existing real-parser fixtures, 39 unchanged V2/V3 summary contracts.
- The new suite covers all 403 catalogue labels, an omitted-wrapper positive,
  all-closed scopes, unrelated/reversed/cross-track/cross-process ancestry,
  mixed-instance marginals, duplicate ancestors, unnamed scopes, typed-identity
  and category spoofing, privacy, missing-tail scenarios, real stats limitations
  and malformed/bounded schemas.
- Scoped TypeScript and ESLint passed. Existing source files remain byte-exact
  to snapshot base; the original V2 SQL SHA remains
  `b4a1c214b63de669bdf4132826add06aff40e63a38b3de01bde46fea8f56c81e`.
- Parser binary: 58.2, 14,897,560 bytes, SHA
  `58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9`.
- The first combined attempts exposed missing **snapshot dependencies**, which
  were copied byte-exactly from the same base; no existing module was edited.
- A later test-startup attempt failed with ENOSPC before collection: `/tmp`
  tmpfs was full. That log is retained. The unchanged suite passed using a
  private workspace-backed TMPDIR. No shared scratch was deleted, no budget was
  relaxed and no native observation was repeated.
- Independent Astra/max source review found the NULL-name, covered-process and
  strict-serialization gaps; all were corrected with targeted negative and
  real-parser tests. No remaining code blocker was reported.

## Decision and stopping condition

The offline question is useful: it can distinguish **captured omitted wrapper
coverage** from the selected-ten-only view. A positive cannot identify a hang
cause or prove complete producer tail; a zero cannot choose between omitted
packets, uninstrumented work and no qualifying captured descendant.

Stop at this reviewed, offline-only prototype. Do not reparse unavailable raw,
add it to a default/required lane, expand categories/flags, or repeat the native
experiment. Any integration and any future observation require a separately
reviewed scope retaining exact source/runtime guards, actual-emission checks,
privacy and unchanged capture bounds. A producer-specific completion protocol
would be a materially different investigation, not a conclusion of this query.
