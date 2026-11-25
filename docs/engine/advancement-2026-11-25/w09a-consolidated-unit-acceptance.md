# W09A — consolidated unit acceptance

Assignment **49/60**, wave 9. This review owns test selection, execution identity,
and the final focused-unit result. It does not edit engine implementation,
assertions, authored content, dependency versions, or Git state.

## Acceptance status

**The expanded CI unit selection passes: 914 tests in 70 files at the frozen
source. The one local consolidated attempt was terminated and is not a complete
pass.** The coordinator froze commit
`26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1`, tree
`0067cdfd51fb6b9cdecfa9cc1632f8ec19879b50`, including all reviewed wave-8
repairs and the expanded workflow selection. After the separate measurement
released compute, this assignment made one 70-file local attempt. It received
SIGKILL before a final result; the complete record is below.

The GitHub job API for
[run 45590533223](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45590533223),
job `139123267349`, records the expanded focused-unit step as successful. The
subsequent TypeScript/build step failed, so the native steps were skipped. W09C
owns the exact-source artifact archive (`15011470835`); W09B owns investigation
of the compiler/build failure. Unit-step success is not an overall workflow or
native acceptance claim.

The prior inspected checkpoint is
`6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`. Its retained exact-source unit log
reports **820 passing tests in 65 files**. That artifact also records successful
full TypeScript checking and production build, with **46 of 47 native browser
cases passing**. The one native failure concerns the separately documented
software-backend `vec3` raster path. This historical evidence does not certify
the later modal, range, ghost, snapshot-policy, or host repairs.
See [the checkpoint receipt](evidence/checkpoint-6cb1c88/result.json) and
[its full unit log](evidence/checkpoint-6cb1c88/engine-runtime-unit.log).

## Selection review and repaired coverage gaps

The focused workflow selects every top-level `tests/engine-*.test.ts` file and
four explicitly named lifecycle/transport suites. All 25 new engine-prefixed
files since baseline `350119e8ec0606e8c5de5b3ab80df41104025679` are therefore
included automatically, including the new ghost endpoint and modal-opening
regressions. Existing cross-mode startup, snapshot batching and attribute-range
suites are also inside that selection.

Three modified existing suites were outside the command:

| Supplementary suite                        | Change since the original baseline                             | Acceptance purpose                                                                   |
| ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `tests/circuit-startup-settlement.test.ts` | Host fixture now supplies page waiters and UI disposal.        | Retain complete startup settlement regressions after host lifecycle changes.         |
| `tests/festival-ground-height.test.ts`     | The streaming fixture explicitly admits a render submission.   | Retain the carved-ground and streaming query contract after frame admission changes. |
| `tests/festival-session-lifecycle.test.ts` | The vehicle mock supplies the existing Formula baseline shape. | Retain Festival session cleanup and ownership regressions with the new import graph. |

These files received fixture compatibility updates, not weakened production
assertions. The coordinator allocated W09B the minimal workflow repair: add
these three paths to both the push filters and unit command. W09B also adds
`src/ui/**` to the trigger paths, closing the concrete gap where a UI-only
ownership repair would not start this workflow. The Festival host already lives
at `src/session/free-roam.ts` and is covered by `src/session/**`.

The resulting command selects **70 files at review time**: 63 engine-prefixed
files plus seven explicit suites. This is a static path inventory, not a count
of executed or passing tests. The exact sorted path list is retained in
[the shared selection manifest](evidence/w09-unit-selection.json), with SHA-256
`87b33765d1d495165dee308d7cfbddbffde31b2b5d76b8aaf446fb98fe489e5b`
over LF-joined paths and a terminal LF. Content identities and execution evidence
are separate records tied to the frozen source.

### Count comparability

Read-only Git tree inspection gives 38 engine-prefixed files at the original
baseline. The old four-name command would select 42 baseline files; the expanded
seven-name command would select 45. At review time those same patterns select
67 and 70 current files, respectively. Parameterized test counts require actual
execution and are not inferred from file counts.

The authoritative [baseline receipt](baseline.json) records **506 passing tests
in 42 files**, using the engine wildcard and original four named suites. An
earlier session summary incorrectly described 51 files; the receipt and this
independent tree reconstruction agree on 42. The later 820-test/65-file
checkpoint includes a different expanded set of files under that wildcard.
This report does not subtract or divide those totals to claim comparable
coverage growth or performance improvement.

## Assertion and oracle review

A scan of the selected files found no `skip`, `only`, `todo`, `skipIf`, `runIf`,
or expected-failure test modifiers. The scan was repeated against all 70 exact
Git blobs at the frozen commit and again found none. The command explicitly forbids focused tests and retries; an
interrupted process or a missing summary cannot be counted as a pass.

The baseline-to-current diffs of pre-existing modified suites preserve their
original assertions. Most edits supply newly required lifecycle resources or
admission return values in fixtures. Resource integration additionally checks
release of the new page listeners and GPU lease. The new range suite deliberately
changes its internal pending-list oracle to exact independent component coverage;
its bounds, version, full-upload and complete uploaded-byte assertions remain.
That representation change is explained and validated in W08E.

The attribute suite has an optional `ENGINE_ATTRIBUTE_RANGE_BENCH=1` branch.
Its unconditional transfer-byte assertions run regardless of that variable;
the branch adds optional timing collection and logging only. Consolidated unit
acceptance leaves it unset. Performance claims remain owned by the separately
reserved, actual-source paired workloads, not Vitest elapsed time.

The selected new suites use different kinds of witnesses, which must retain
their stated limits:

| Area                                 | Meaningful unit/composition evidence                                                                                                              | Limit                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lane and surface work                | Real Track/solver paths, cache bypasses, ordered candidate and state comparisons; separate actual-baseline measurements remain preserved.         | A current-path bypass is not by itself an import of the historical source tree.                                            |
| Audio arithmetic                     | Exact arithmetic against retained original functions, operation counts, supplied waveform and scheduling observations.                            | A fake audio graph records calls; it does not render native PCM or certify a sound device.                                 |
| Snapshot and input encoding          | Complete packet bytes, independently owned buffers, recipient headers, real codecs, observed work/allocation counts and connection-reentry cases. | These are deterministic transport and encoding contracts, not internet latency measurements.                               |
| Ghosts, telemetry and recording      | Saved sample and packed record bytes, first-crossing semantics, ring/chunk ownership and closing-gap validity.                                    | Native IndexedDB/reload/worker evidence is separate.                                                                       |
| Attribute ranges                     | Independent component-bitset union, exact versions and bounds, actual Three uploader decisions and complete copied buffer bytes.                  | The recording GL boundary is CPU instrumentation, not native GPU time or hardware validation.                              |
| Startup, page and UI ownership       | Complete production methods or real classes with controlled callback/resource boundaries, explicit stale-owner and failure witnesses.             | Controlled callbacks do not prove that a physical device or browser naturally delivered a particular adversarial ordering. |
| Integrated simulation and networking | Actual simulation/client/server modules, mutable weather, replay/record state, packet/header/control and incident ordering.                       | A passing unit scenario does not establish all gameplay or rendering behavior.                                             |

The native suite complements these witnesses. This report neither substitutes
controlled unit doubles for native evidence nor treats a native result from an
older commit as acceptance of later source edits.

## Exact acceptance command

Run from the frozen repository root, without `npm test`, `pretest`, `prebuild`,
or any asset-generation hook. W09B owns the matching workflow selection:

```sh
NODE_OPTIONS=--max-old-space-size=1024 \
node node_modules/vitest/vitest.mjs run tests/engine-*.test.ts \
  tests/circuit-frame-transport.test.ts \
  tests/circuit-preparation-lifetime.test.ts \
  tests/festival-renderer-loader-lifecycle.test.ts \
  tests/surface-channel-backpressure.test.ts \
  tests/circuit-startup-settlement.test.ts \
  tests/festival-ground-height.test.ts \
  tests/festival-session-lifecycle.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 \
  --allowOnly=false --retry=0
```

The CI invocation additionally wraps the command with the existing
`scripts/source-stability.ts` guard. Local validation will record the exact
commit, tree, dependency-lock digest, command, selected test-file digests,
changed production-file digests, exit status and complete result. A guard that
includes all documentation inputs must not run concurrently with unrelated
report writers; the coordinator controls that freeze.

One consolidated local attempt was made after compute was released. Its complete
log and exit signal are preserved; no cases were removed and no local retry was
performed. Exact-source CI supplies the consolidated unit gate, while the
separate compiler/build failure remains unresolved at this handoff.

## Local execution receipt

The one attempt used Node `v24.22.3`, Vitest `3.2.4`, one thread worker, a
1,024 MiB Node heap limit, zero retries and no focused tests. The optional
attribute timing environment variable was explicitly removed. The command
expanded the reviewed path list to exactly 70 files and added only default/JSON
reporter arguments; selection and assertions matched the workflow command.
No package lifecycle or asset-generation hook ran.

Before invocation, the coordinator's commit and tree were checked. The runner
recorded **104 content hashes**: the 70 selected tests, all 25 changed production
files relative to the original baseline, and nine configuration/workflow/helper
files. This focused inventory is not claimed as a transitive asset manifest.
Read-only Git checks separately found no modified or untracked executable/source
inputs in `src`, `tests`, `e2e`, `scripts`, `.github` or the named root configs.
The same checks and all 104 hashes matched after the attempt. Documentation-only
work by other agents was deliberately outside this local source check; the
broad CI source-stability wrapper remains the CI gate.

| Observation                                 | Recorded result                                                      |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Test-process duration                       | 113.549 seconds                                                      |
| Test-process return                         | `-9` in the subprocess API: SIGKILL, signal 9                        |
| Completed per-file summaries                | 10 files containing 122 tests, each marked passed in the partial log |
| Final Vitest suite summary                  | Absent                                                               |
| Requested machine JSON result               | Absent                                                               |
| Full 70-file acceptance from this run       | **Not established**                                                  |
| Selected/changed/configuration input hashes | All 104 unchanged                                                    |
| HEAD and executable/source cleanliness      | Unchanged                                                            |
| Repeated local attempts                     | None                                                                 |

No assertion failure appears in the retained output. That does not turn an
interrupted run into acceptance, and the signal alone does not establish its
root cause. The partial duration is neither a full-suite runtime comparison nor
a performance result.

Durable local evidence:

- [Complete local log](evidence/w09-unit-local-26efaeef.log), SHA-256
  `f2a3468b51be8c62fec606dbf9496f17a8e0c26ef5887357f9fc1f8a88dae194`.
- [Command, identities, before/after hashes and termination receipt](evidence/w09-unit-local-26efaeef.json).
- [Expanded path selection](evidence/w09-unit-selection.json).

## Consolidated CI receipt

**All 914 tests in the expanded 70-file selection passed** at
`26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1`. The extracted source identity is
exactly that commit and tree `0067cdfd51fb6b9cdecfa9cc1632f8ec19879b50`.
The full unit log records a 204.42-second Vitest run. Its 70 per-file pass lines
sum to 914 tests; their paths exactly match the reviewed selection, with no
missing or unexpected files. The final summary reports 914 passed out of 914,
with no failed or skipped cases.

W09A independently inspected the log extracted by W09C from artifact
`15011470835`, rather than relying on the workflow's step label alone. The
same artifact records a later TypeScript error, `TS2352`, at the controlled
`Interface` fixture cast in `tests/engine-ui-opening-review.test.ts`. Because
typechecking failed, the chained production build did not execute and native
browser steps were skipped. W09B owns the narrow fixture-type repair and the
coordinator owns its next exact-source run. This report does not use the unit
pass to conceal that failed compiler gate.

Durable CI evidence:

- [Independent unit acceptance receipt and every file count](evidence/w09-unit-ci-26efaeef.json).
- [Full archived unit log](evidence/checkpoint-26efaeef/engine-runtime-unit.log).
- [Full archived compiler/build log](evidence/checkpoint-26efaeef/engine-runtime-build.log).

**Assignment 49's consolidated unit acceptance is complete at this source.**
The source/selection finding led to the minimal W09B workflow coverage repair;
no engine production file or test assertion was changed by this assignment.
Any later source revision requires its own CI identity. Root can reconcile the
next unit result without rerunning the locally terminated heavy group.
