# W06F — independent review of actual-source engine probes

Assignment 36/60, wave 6. This is an independent source review of the six W05
comparison probes and their shared baseline loader. It changes only this report.

## Decision and execution status

**No blocking source defect found in the inspected probes.** The baseline
comparison uses real historical module bytes, the candidate executes its real
implementation, assertions precede success reporting, and the inspected CI
invocation stops on a failed probe.

This decision is a source-review result. It is not a claim that Node, the six
probes, TypeScript, native browsers, or the complete engine passed. No local
execution was available. At the review checkpoint, workflow
[45635583065](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45635583065)
was still running the focused unit-contract step; its baseline comparison step
had not completed. The eventual workflow result is separate evidence.

The reviewed publication is
[`c482ad9ce9fdef02660e4880a027d83326c840c4`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/c482ad9ce9fdef02660e4880a027d83326c840c4).
The original candidate-tree sources and each W05 report were also read.
Production checks used pinned source from
`b3b8ec09183734287b71406f8894d07c91eb48c9`; the published loader, Simulation
comparator, and workflow were then read at `c482ad9`.

## Baseline identity and module resolution

The [shared helper](../../../scripts/engine-runtime-probes/support.mjs) obtains
the declared baseline files with argument-based `git show` calls at
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. It verifies that this full hash
resolves to a commit. It does not use a copied reference class, derive the old
algorithm by mutating the candidate, or load a floating baseline branch.

The repository path calculation is correct for a helper located under
`scripts/engine-runtime-probes`: the URL `../..` resolves to the repository
root. Each replacement path must be a normalized repository-relative
production TypeScript path. The esbuild loader matches the absolute file
location and supplies historical bytes only to the baseline build. It records
every replacement and fails if a declared target was never loaded. Imports
inside a substituted file resolve from that file's real directory.

The candidate uses the ordinary loader. Both builds use the same entry, esbuild
options and candidate dependency tree, with exactly these substitutions:

| Probe | Historical production files |
| --- | --- |
| Radio | `src/core/radio.ts` |
| Input queue | `src/net/input.ts` |
| Lane cache | `src/simulation/track-lane-index.ts` |
| Thermal solver | `src/simulation/surface-thermal.ts` |
| Codec | `src/net/bytes.ts`, `src/net/codec.ts` |
| Simulation composition | Lane index and thermal solver together |

Unique import-URL fragments ensure distinct module instances even if two bundle
texts happen to be identical. The helper checks each declared candidate file
again after bundling, checks HEAD again, and records entry, source and bundle
SHA-256 hashes plus runtime versions.

This is deliberately a **historical-module substitution within the candidate
dependency graph**. It does not reproduce every dependency from the historical
repository. The individual reports and emitted provenance state that scope
accurately.

## Provenance limits

The tracked-status check covers the declared source/probe/package/TypeScript
areas and explicitly excludes untracked files. It reports a dirty candidate
honestly rather than equating working-tree bytes with HEAD.

The helper does not hash every transitive input independently or lock a live
checkout against concurrent writes. A non-target dependency that changes while
remaining in the same dirty-status category would not necessarily change the
porcelain status text. The bundle digests still identify the generated code,
but they are not a substitute for freezing an actively edited checkout. This is
a boundary of the helper's stated guarantee, not a reason to claim that its
target-byte checks cover all possible concurrent edits.

The inspected workflow mitigates the operational risk by using an exact
checkout, recording the source commit/tree and lockfile, and wrapping the
execution with the repository's source-stability command. Reports should retain
the emitted provenance and workflow identity when citing results.

## Behavioral and measurement review

### Radio

The interpreter supplies inputs and records complete offers and captions from
the imported arbiters. Its public `post` wrapper calls the original method;
it does not implement arbitration. Fresh, reused, transferred and overwritten
snapshot ownership is exercised, including actual buffer detachment.

Expected keys and captions supplement, rather than replace, differential
equality of complete message streams. The current production arbitration was
checked against representative simultaneous-offer, cooldown, expiry and
engineer-muted assumptions. Offer logging deliberately occurs before the
production engineer filter, while displayed captions remain filtered.

Copy counting runs separately and observes actual `Float32Array.slice` calls
and returned byte lengths. It restores the inherited/own-property arrangement
in `finally`. These counters support removal of the observed frame slices;
they do not measure all allocations, retained memory or GC.

### Input queue

The operation list is created without consulting either queue. Immutable
commands are shared so returned control-reference identity has a meaningful
comparison. Every return, public ACK/depth/remembered value and statistics field
is compared; slack reads exercise the reset as well.

Instance-only Map wrappers delegate to native methods and iterators. The budget
counts iteration visits plus deletes, including unsuccessful deletes, so a
regression into a huge sparse numeric walk fails inside the counted pass.
Uninstrumented replay hashes must match the instrumented observations.

The dense target of 30,876 historical key visits follows the exact 248-slot
drain, but remains an assertion until execution. The documented 31-command batch
is a queue-API workload and is correctly distinguished from the packet command
limit. The actual candidate's shorter-span-or-Map expiry branch agrees with the
budget rationale. The unchanged ACK-gap Map is outside the operation counter.

Timed passes use fresh uninstrumented instances and compare checksums outside
each timed pair. Their ratio is descriptive, with no speed threshold.

### Lane cache

Both variants execute the real current `Track.nearest`; only the index module
changes. Installing a fresh real index creates a known cache start and the
small-capacity boundary cases without replacing nearest-point geometry.
Comparison includes lateral results, every TrackPoint field, candidate ordering,
fallback identity, resident records, FIFO order and digest equality.

The ring checks cover resident-key bounds and overwrite behavior. Oldest-hit
checks require hits not to promote FIFO entries before the next eviction. The
counter wraps only each map's actual `keys` and `delete` methods; inspection
uses entry iteration and therefore does not inflate key-iterator counts.

Unlike queue and thermal probes, lane exact-output comparisons and operation
counters share one pass. The wrappers delegate directly and the probe makes no
timing or heap-byte claim. A future change to this instrumentation should retain
that limited interpretation or add a separate parity pass. This review does not
require extra execution merely to duplicate the existing geometry comparisons.

The probe's reference bound of 2,048 is additional key references, not a measured
byte-memory figure. Non-finite height inputs intentionally exercise existing
height-selection fallbacks; they are not claims of meaningful infinite heights.

### Thermal solver

Exact-output comparisons precede a fresh-instance counter pass. Direct results
must be finite and Object.is-equal; Track surface arrays must contain finite
values and equal bytes. Weather and clock scalars are checked independently.

The mutable-parameter cases intentionally preserve the pre-existing same-rain
early-return behavior, then require a changed-rain call to observe the edit and
invalidate other cached slots. This is compatibility coverage, not a newly
invented parameter-refresh contract.

Counter wrappers restore the original descriptors. Preparation, matrix request
and wet-advance counts prevent a reduced-work claim from succeeding merely
because the fixture skipped the intended workload. The encoded clear/wet
refresh counts still require hosted execution before being called observations.

### Codec

Ordinary output is compared with actual baseline encoding. Prepared recipient
output is also compared with baseline ordinary encoding, providing an independent
path within the real codec. Every count boundary and recipient position is
covered in the stated finite set.

Retention, source mutation, prepared-table overwrite, distinct peer backings,
actual structured-clone transfer and writer reuse address ownership rather than
byte equality alone. Defensive `finish()` behavior is tested separately from
the new consuming API.

Timing precedes constructor/prototype instrumentation. The untimed counter has a
known-copy self-check, deduplicates backing identities, restores globals and
descriptors, and compares resulting bytes. Its explicit exclusions are necessary:
scalar DataView writes, zero-byte/module-initialization storage, objects,
transport copies and total heap/GC are not measured. Prepared packet assembly
copies remain counted; the report does not incorrectly call that path zero-copy.

### Full Simulation composition

The probe constructs real independently bundled worlds and supplies deterministic
public controls. It compares full frame bytes, eight surface arrays at declared
checkpoints and explicit unrounded race/classification state. The published
comparator includes the coordinator's finite floating-array check.

The asserted race/lap fields were checked against their production definitions.
Practice starts at the seeded green time; actual stepping marks opponent laps
assisted and advances the public surface clock in half-second increments.
These source checks support the fixture design but do not establish that the
encoded movement/slip-work assertions passed.

The workload is one simulated second per scenario on one paved circuit. It
cannot establish a full lap, finished race, sustained eviction behavior, cold
weather, multiplayer, cross-host portability or frame-rate gains. The dedicated
lane and thermal probes cover different boundaries and remain necessary.

## Workflow failure propagation

At `c482ad9`, the focused workflow fetches the pinned baseline explicitly before
running the probes. The outer shell uses `set -euo pipefail`; the inner shell
also uses `bash -e -u -o pipefail` for its probe loop. Consequently a failed
earlier probe cannot be hidden by a later successful one or by the trailing
`tee`. The source-stability wrapper surrounds the loop, and the combined probe
log is included in artifacts even when the job fails.

The six scripts throw on failed correctness/count assertions and emit success
only after those checks. Codec additionally emits failure JSON before rethrowing.
Microtimings have no acceptance threshold. No new dependency, fixture substitute
for production arithmetic, model generation or protected visual edit is required.

## Follow-up rule

Use the actual hosted output to resolve any fixture-count or runtime failure.
Preserve the original assertions' intended contracts; do not reinterpret an
unexecuted count as a measurement or relax a real output mismatch to obtain a
green job. A final performance statement should identify which operation was
counted, its exact workload and the accepted source SHA, and keep measured
microtimings separate from gameplay or FPS claims.
