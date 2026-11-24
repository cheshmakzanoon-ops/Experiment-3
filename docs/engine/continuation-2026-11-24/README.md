# Engine continuation — 24 November 2026

## Purpose and scope

This is a new engine-only development programme starting from `5edead7a44c8ccb5a187b22b750ce2bda7715128`, after the earlier programme documented in the parent directory.

The user requested 60 distinct agents across ten waves, implementation of substantial improvements to the underlying engine, and commits directly to main. Three agents run concurrently, so each six-agent wave has two execution batches.

No 3D models, character models, authored environments, textures, materials, tracks, vehicle catalogue tuning, or asset-generation output may be modified. Work is confined to engine algorithms, runtime coordination, transport, storage, input/audio infrastructure, tests, and engineering documentation. Algorithmic contact/query improvements must preserve ordinary simulation results unless an explicitly documented defect requires a correction.

## Working method

1. Audit the existing implementation and its previous validation before selecting changes.
2. Give every agent a concrete, separate assignment and file ownership.
3. Reproduce meaningful faults or measure hot-path costs before changing production behaviour.
4. Retain focused regression evidence and review integrations between circuit and festival runtimes.
5. Commit validated batches to main without rewriting remote history.
6. Independently audit changes against the original tree to establish that protected content is identical.

## Ten-wave programme

| Wave | Agents | Focus | Status |
|---|---|---|---|
| 1 | 01–06 | Remaining defects and performance opportunities across the shared engine | Complete: 17 independently recorded findings |
| 2 | 07–12 | Critical worker, recording and persistence repairs; collision sweep work | Complete |
| 3 | 13–18 | Simulation queries, numerical failure recovery, input edges and resource boundaries | Complete |
| 4 | 19–24 | Bounded network history, snapshot ownership and audio event lifetime | Complete |
| 5 | 25–30 | Replay endpoints, controller/audio continuity and real-workload measurements | Complete |
| 6 | 31–36 | Input, audio and shared resource lifecycle | In progress |
| 7 | 37–42 | Cross-subsystem integration and regression repairs | Pending |
| 8 | 43–48 | Reproducible performance and deterministic comparisons | Pending |
| 9 | 49–54 | Independent adversarial reviews and targeted corrections | Pending |
| 10 | 55–60 | Final validation, scope audit and publication verification | Pending |

Wave scopes will be narrowed to evidence from the initial audit; assignments are not claims of changes already made.

## Validation and limitations

The repository was sparsely checked out in an isolated workspace because the disk-backed workspace has little free capacity. Source, tests and tools are available. Large authored assets are intentionally absent. Dependencies use the committed lockfile and are installed with lifecycle scripts disabled, preventing asset regeneration.

The preceding programme reports four pre-existing broad-suite failures. Those historical results are not new validation for this continuation. New results will be recorded against the actual changed source, and asset-dependent validation will be distinguished from tests runnable in this workspace.

## Results

Implementation and validation results will be added as each wave completes. See [the task ledger](TASKS.md) for the actual agent record.


### Wave 1: evidence selected for implementation

The six reports in [audits](audits/) reproduce lost shift edges, surface-channel backlog, fatal-session and startup-settlement failures, stale recording-buffer ownership, save-mirror revision gaps, command/metric history growth, controller takeover, stale audio events, low-rate audio cadence loss, build-queue cancellation and GPU timer faults. They also measure redundant BVH construction and swept-collision interpolation work. Integration-only state-alias findings and extreme numerical solver cases are explicitly distinguished from normal gameplay.

The baseline focused networking/interpolation run passed all 38 cases in three suites. Whole-project TypeScript checks exceeded the local process memory limit at the unmodified baseline (default and bounded heaps); remote CI will be used for the complete compiler/build gate. This is an environment limit, not a passing compiler result.

### Wave 2: first implementation batch

Recording transport now uses publication identity when recovering failed sends and retains independently captured newer pages. Festival errors explicitly distinguish terminal runtime/transport failure from recoverable command rejection. Circuit first-frame readiness belongs to one startup generation and settles on failure, timeout, replacement or disposal; cancellation also covers asynchronous preparation.

Focused runs passed 93 recording cases, 61 Festival cases, and 64 startup/lifecycle cases. These overlapping suite totals are not added into a unique-test claim. Existing media/geometry definitions and simulation tuning are unchanged.

### Second implementation batch and restored verification

Surface publications now use a bounded 120-packet acknowledgement window, preserve accumulated terrain state, and defer flashback completion until its ordered surface rebase can be sent. Save mirroring certifies complete profile/ghost revisions and serializes a bounded pending queue. Swept collision caches invariant quaternion arc work. BVH construction uses bounded in-place selection while preserving the exact original hierarchy and leaf visitation order.

The local executor was replaced after resource failures. Published work was intact, unfinished patches were recovered from preserved blobs, and completed implementations were tested again in the restored workspace. The new results are recorded in each implementation report; interrupted commands are not counted as passes. The original source reference is retained separately for comparisons.

The coordinator's full `tsc --noEmit` passed on an immutable staged-source checkout with a 2 GiB heap. Three unchanged JSON manifests omitted by sparse checkout were read from Git to satisfy existing imports. Type-only annotations corrected the new test fixtures' map value type and intentional read-only terrain-set inspection. The runtime algorithms and fixture behavior were unchanged by those annotations. The first published batch also passed the remote full build and native/replay browser job; see [its CI evidence](implementation/first-batch-ci.md).

### Wave 3: state, input and optional instrumentation

Rejected rigid-body steps now preserve public state and object identities. The solver tests its final allowed correction without changing the iteration limit or tolerance. Successful normal-range dynamics match 6,144 frozen-reference steps exactly. Circuit and Festival workers retain bounded FIFO shift pulses and record application ticks for deterministic rewind; ordinary Formula, MotoGP, motocross and Festival traces are unchanged. Construction checks cancellation at external callback boundaries. Whole-frame GPU timing errors disable optional sampling while allowing rendering and frame accounting to continue.

Reports 14–18 retain the focused regression commands and limits. In particular, the solver correction fixture uses extreme numerical values, and GL fault injection establishes ownership/exception behavior without asserting hardware GPU performance.

The wave-3 integration also passed the complete project TypeScript check on an immutable staged-source snapshot with a 2 GiB heap. The second published batch (`3c3bf02`) subsequently passed [remote typecheck/build and native lifecycle/replay validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45451671524). A separate full-game paused-grid browser test timed out while loading in the settings-transition workflow; its trace is being investigated and is not counted as a pass.

### Wave 4: bounded network observations and owned state

Each network diagnostic retains a chronological 4,096-sample window plus independent lifetime summaries, with constant recording work. Command retention expires independently of ACK progress; a nominal client retains at most 185 recent commands through prolonged downlink silence. Exact wire/render comparisons preserve normal and tested outage/recovery behavior. Remote and predicted states cross public boundaries as detached scalar copies. Audio reset/disposal retires transient nodes and old shared-filter automation, while a 64-voice live bound preserves the supported offline scheduling path.

The paused-grid loading investigation retained the failed trace and the successful unchanged-commit six-test retry. Its read-only summarizer records a long cold preparation task and only 7.632 seconds of observed final-fence waiting, without inferring a deadlock. See report 22 for clocks, event-drop limits and exact source comparisons.

### Wave 5: replay endpoint correction

A subsequent native replay run at `61241fd` passed six lifecycle tests but exposed a range-control decimal round-trip: a recorded end of `16.600000381469727` became `16.6000003814697`. Agent 25 repaired exact endpoint recognition without a broad epsilon or relaxed browser assertions. All 55 clock/precision cases and scoped compilation passed. The published fix at `360d3de` subsequently passed all eight native lifecycle and replay browser tests, including the new real-range regression and the unchanged strict full-game assertions. See [the fourth-batch CI evidence](implementation/fourth-batch-ci.md).

The fourth publication batch (agents 19–25) passed the full project TypeScript check on its immutable staged-source snapshot. The three unchanged JSON imports excluded by sparse checkout were restored verbatim from Git before the successful compiler run. This check excludes later work still in progress.

### Wave 5: cadence, control ownership and measured construction

Power-unit scheduling retains continuous elapsed time down to 2 Hz, correcting the 5 Hz half-rate defect while preserving exact 10/30/60 Hz seeded scheduling. Clock discontinuities retire the prior audio timeline. Replacing an established gamepad now neutralizes controls and reports device loss before reading the replacement; explicit selection and resume retain their existing semantics.

Actual unchanged Aurel, Vellamar and Loirette collision meshes built 48–65% faster by cold median in this environment, with identical mesh bytes, BVH nodes/leaf order and 55,944 recorded query calls across the workers. ResponseModel removes transient matrix/view allocations; its isolated 250,000-operation training/query median was 18.01 ms versus 184.34 ms, with all samples and outliers retained. These results do not assert a frame-rate improvement. Reports 28–29 provide portable measurement scripts, distributions and source identities.

Real persistence validation added 33 subprocess cases, including 27 SIGKILLs across physical save-write boundaries. Incomplete pairs failed certification and were repaired from complete local data. Empty-local recovery retains its documented readable-data salvage behavior; the result does not claim power-loss durability or an atomic cross-file disk transaction.

The fifth publication batch (agents 26–30) passed complete project TypeScript compilation on an immutable snapshot of its staged source. The later native-audio and controller/network integration work was excluded while still in progress.

### Wave 6: integration repairs

Actual controller/input-pump/session integration reproduced a secondary Festival host exception when a pause transport failure destroyed the session during input sampling. The host now rechecks the sampled session identity and driving permission before publishing; both failing cases pass while preserving the original transport failure.

Audio integration reproduced six old fixed-oscillator parameter timelines surviving reset. Reset now cancels future turbo, transmission and motor gain/frequency automation at actual device time while preserving the existing output fade and synthesis. Three real OfflineAudioContext tests are prepared for the remote native gate; they are not yet counted as passed.

Two real client/server integration cases compare twin 90-second sessions under stale ACKs, downlink silence and jitter, then test timeout/token rejoin. Detached-output mutation leaves wire/render hashes identical, retention remains bounded, and teardown leaves no queued timer work. Reports 31–33 distinguish integration fixtures from hardware/network claims.

The sixth publication batch (completed agents 31–33 and the subprocess fixture lint correction) passed complete project TypeScript compilation on an immutable staged-source snapshot. The preceding commit passed all eight focused native tests and 9,134 broad unit tests, with the same four documented content failures; [its full CI account](implementation/fifth-batch-ci.md) also records the fixed helper lint failure and skipped broad browser jobs.
