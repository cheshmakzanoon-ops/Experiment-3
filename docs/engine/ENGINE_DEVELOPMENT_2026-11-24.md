# Engine development programme — 24 November 2026

## Scope and baseline

This programme improves the shared game engine of Experiment-3 on `main`.
Engine baseline: `a0ae513e7982f0b4719296519752e0ae5f1983f8`. The starting
branch checkpoint was `5bb8a45843c853fcdbfe3fe422d303b5c2932fca`; the difference
consists only of automated CI reports. Performance and determinism comparisons
use the original engine commit explicitly.

The user requested 60 agents in 10 waves, with six distinct agent assignments
per wave. Available execution capacity is three workers plus the coordinating
agent, so each wave runs in two batches of three. The coordinator reviews,
integrates, validates, commits, and pushes the completed work to `main`.
Independent tasks from the following wave may start while the previous wave's
last verification completes; file ownership and commits remain separate.

**Excluded:** 3D models, characters, authored environments, geometry, scene
decoration, textures, material appearance, asset exports, vehicle specifications,
and artistic changes. Runtime infrastructure that operates on these resources
may be improved without altering the resources or their intended appearance.

## Final outcome

All **60 distinct agent assignments across ten waves** are complete. The final
production changes are published on `main` at
[`b282f121b5766df26466d413d2c685b2f826799d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b282f121b5766df26466d413d2c685b2f826799d).
The programme changes 54 production-source files, adds 55 unit-test suites,
updates five existing suites and retains reusable performance/determinism
harnesses plus independent evidence reports. All excluded authored content,
vehicle tuning and dependencies retain their baseline identities.

| Final verification at the published engine source | Result |
|---|---|
| Consolidated changed-suite execution | 60 files; 1,072 passes, zero failed/skipped; 1,068 distinct displayed file/name identities |
| Full unit CI | 840 files; 8,645 passes and four exact pre-existing baseline failures |
| Full CI lint, content checks and TypeScript | Passed |
| Product and demo builds, output guards and source-stability checks | Passed |
| Focused native IndexedDB/Worker and complete replay browser scenario | Seven of seven passed on verified Mesa llvmpipe |
| Physics and offroad scenarios | Passed |
| Additional wet-presentation browser checks | Seven passed on verified SwiftShader |
| Same-tick baseline comparison | Six scenarios, 14,406 complete snapshot/selected-state observations matched; measured source identity retained at final publication |
| Final scope audit | All 11 protected manifests match; 2,996 asset-extension files unchanged |

Counts from separate runs overlap and are not added together. The four remaining
broad-unit failures concern original livery/catalogue/localization content; exact
baseline comparisons are retained. The full release workflow has not been
certified all green, and the long browser/owner matrices are reported separately.
The implementation, final code validation and scoped engine programme are complete.

## Architecture

- Circuit racing, road motorcycles, and motocross share `RacingRenderer` and
  the worker-owned `Simulation`.
- Vehicle dynamics are provided by `Vehicle`, `BikeVehicle`, and
  `DirtBikeVehicle`, with shared collision, race, and snapshot infrastructure.
- Festival uses `FestivalSession`, `FestivalRenderer`, and
  `OpenWorldSimulation`, reusing the graphics context and vehicle systems.
- Rendering is based on Three.js; the project's game systems are TypeScript.

## Evidence guide

The final production checkpoint is `b282f121b5766df26466d413d2c685b2f826799d`.
The reports below keep implementation, measured work, regression execution and
publication evidence separately identifiable. Per-agent test counts overlap;
only the consolidated inventory supplies the programme's selected-suite total.

| Report | Contents |
|---|---|
| [Task ledger](ENGINE_TASK_LEDGER_2026-11-24.md) | All 60 numbered agent assignments across the ten waves |
| [Performance evidence](ENGINE_PERFORMANCE_2026-11-24.md) | Actual baseline comparisons, operation counts, output hashes and reusable benchmark commands |
| [Cross-mode determinism](ENGINE_DETERMINISM_2026-11-24.md) | Six same-tick simulation comparisons, complete snapshot hashes and source identities |
| [Regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md) | All 60 selected suites, 1,072 passing executions, conservative unique-name accounting and published-input verification |
| [Scope audit](ENGINE_SCOPE_AUDIT_2026-11-24.md) | Protected assets, catalogue, configuration and mixed-file runtime boundaries |
| [Clock and transfer review](ENGINE_CLOCK_TRANSFER_REVIEW_2026-11-24.md) | Reentrant publication ownership and composed worker/input timing checks |
| [Persistence review](ENGINE_PERSISTENCE_REVIEW_2026-11-24.md) | Transaction completion, save-copy consistency and failure recovery |
| [Physics review](ENGINE_PHYSICS_REVIEW_2026-11-24.md) | Adversarial contact, interpolation and terrain invariants |
| [Resource review](ENGINE_RESOURCE_REVIEW_2026-11-24.md) | Host/session/renderer/audio/haptic terminal ownership |
| [Network review](ENGINE_NETWORK_REVIEW_2026-11-24.md) | Server observer cancellation, teardown failures, late acceptance and reliable delivery |
| [Browser validation](ENGINE_BROWSER_VALIDATION_2026-11-24.md) | Native IndexedDB and Worker checks, complete replay scenario and verified backend |
| [CI validation](ENGINE_CI_VALIDATION_2026-11-24.md) | Exact workflow jobs, compiler/build results and baseline failure comparisons |
| [Completion audit](ENGINE_COMPLETION_AUDIT_2026-11-24.md) | Independent final source, evidence and scope acceptance |

## Acceptance criteria

1. Changes address an observed defect, measured inefficiency, or demonstrated
   integration gap; speculative rewrites are excluded.
2. Physics retains its fixed timestep and existing vehicle tuning.
3. Regression tests exercise behavior such as pause/resume, stalls, repeated
   initialization, ownership transfer, disposal, boundary values, and recovery.
4. Type checking, relevant unit tests, and production bundling must pass.
5. Broader physics and browser checks are selected to cover actual risks.
6. No excluded model, character, environment, or asset file is changed.
7. Every wave records its evidence and is committed and pushed to `main`.
8. Performance claims require measured results; correctness improvements alone
   are not described as an unmeasured FPS improvement.

## Wave plan

Specific assignments are refined against findings from preceding waves.

| Wave | Agents | Engine focus | Status |
|---|---:|---|---|
| 1 | 1–6 | Fixed-step scheduling, input cadence, live/replay timing, worker snapshots | Complete |
| 2 | 7–12 | Runtime ownership, asynchronous lifecycle, resource reuse | Complete |
| 3 | 13–18 | Collision queries, numerical stability, simulation throughput | Complete |
| 4 | 19–24 | Worker protocols, input validation, cancellation and recovery | Complete |
| 5 | 25–30 | Replay, telemetry, recording, persistence and bounded memory | Complete |
| 6 | 31–36 | Rendering infrastructure, frame scheduling and quality transitions | Complete |
| 7 | 37–42 | Audio graph lifecycle, input devices and session transitions | Complete |
| 8 | 43–48 | Determinism, shared runtime integration and open-world engine services | Complete |
| 9 | 49–54 | Performance measurement and adversarial integration review | Complete |
| 10 | 55–60 | Independent regression audits, remaining fixes and final validation | Complete |

## Validation environment

The checkout is isolated from the pre-existing development checkout. Installed
dependencies are reused. Tests invoke Vitest directly to avoid asset-generation
pretest scripts. Asset contents are not regenerated or modified.

## Completed work and evidence

Wave results, test commands, limitations, and commits are recorded here as work
is integrated. Agent-specific receipts are maintained in the accompanying task
ledger.

Published engine checkpoints:

| Wave | Commit |
|---|---|
| 1 | `db3b4f1`, `09fd6d2` |
| 2 | `c865e21` |
| 3 | `f4deef7` |
| 4 | `02d2f97` |
| 5 | `1d4e83c` |
| 6 | `17c16ae` |
| 7 | `9dc4811` |
| 8 | `c4e62c6` |
| 9 | `6a66503` |
| 10 | `b282f12` (final production changes) |

Automated CI-report commits are preserved between engine checkpoints;
publication never force-updates `main`.

### Baseline and first batch

The initial targeted baseline passed 64 tests across eight suites: collision
continuity, wheel-solver accuracy, integrator stability, input, both worker
paths, live-frame timing, and replay clocks.

Agents 01–03 added a bounded-work simulation clock, input-pump lifecycle
guards, migration of valid older clutch bindings, and replay-clock validation.
The scheduling contract retains the existing 120 Hz physics timestep; an
individual tick remains indivisible. A synthetic 100 ms backlog with 6 ms
ticks now performs two ticks and reports 83.3 ms discarded instead of running
the full catch-up batch. This is a deterministic scheduling test, not an FPS
benchmark. The Festival worker will adopt the same clock in the second batch.

### Wave 1 — second batch

Festival now uses the same bounded-work clock, including pause/reinitialization
and an exact 100 ms status deadline. Recording pools reject duplicate local
returns, maintain outstanding-transfer credits, and preserve attached pages
when a send fails. Both recording streams stage a shared tick before either
stream is delivered. Controls become neutral on disposal or visibility loss;
keyboard widgets and individual touch pointers retain ownership of their inputs.

All six assignments completed with focused regression suites. The first batch
is published as `db3b4f13c135cbe8b0ad35ff49cd36cfeea7a5d9`. Full-project
compiler runs are serialized because concurrent instances exceeded available
memory; a compiler termination is not counted as a passing check.

Wave 1 integration: **81 tests passed across six suites**. Full project
`tsc --noEmit --extendedDiagnostics` passed after serialization (3,112+ files;
approximately 2.0 GiB compiler memory). Scoped ESLint and whitespace checks
passed. No excluded content files were changed.

### Wave 2 — resource infrastructure

Completed assignments repair exhausted texture-cache retries, asynchronous
background/PMREM resource ownership, gain-map conversion cleanup, GPU query
validation, frame-fence lifetime, and stale graphics-preparation reports.
Successful decoding, shader math, atlas sizing, filtering, lighting choices,
model data and environment layouts are unchanged. PMREM ownership follows
the repository's existing guarded Three r180 adapter pattern.

Festival sessions now support cancellation throughout asynchronous startup.
Disposal rejects readiness and command waits, clears owned timers and animation
callbacks, and ignores late worker replies. A fatal worker failure terminates
startup instead of allowing it to install later resources. Host application
cancellation and renderer-owned late loader cleanup are tracked follow-ups.

Wave 2 integration passed **178 tests across 13 resource/preparation suites**,
plus **27 Festival lifecycle tests**. Successful-path resource behavior is
preserved; an independent review also checked the two conversion ownership
changes together. No artwork or environment content was changed.

Wave 2's changed TypeScript files and their imported dependency graph passed
the project compiler options in a scoped project (1,470 files, approximately
936 MiB compiler memory). Scoped ESLint passed. Two whole-project compiler
attempts were terminated by the host memory limit; they are not passing checks.
Final validation will cover the full project again, using separate root groups
if the memory constraint persists.

### Wave 3 — simulation work and deterministic boundaries

General BVH raycasts retain their original traversal but resolve the winning
contact's point and normal once. A controlled 128-ray layered fixture retains
66,048 triangle checks while reducing point resolutions and normalizations
from 8,448 to 128 each. A proposed near-first traversal was rejected after an
adversarial tolerance case changed its contact result; its provisional triangle
count reduction is not part of the delivered improvement.

Collision broadphase now checks conservative live y/z bounds before detailed
SAT tests, preserving frozen x ordering and refreshing bounds after impulses.
Swept queries cache unchanged radii and center intervals, and calculate a
contact point only at the existing hit threshold. Seeded reference comparisons
include grazing contacts and correction chains. On controlled 64-vehicle
separated fixtures, endpoint SAT calls fall from 2,016 to zero and swept radius
evaluations from 4,096 to 64. These are operation counts on fixtures, not FPS
claims or a change to the game's supported grid size.

Terrain cache residency and pending work are bounded. Invalid residency budgets
are rejected, recently sampled tiles regain LRU priority after prefetch, and
queued synchronous misses are removed. Exact sampled heights and normals remain
unchanged across eviction and regeneration.

Flashback now yields between complete ticks at an 8 ms work budget or the
existing step cap. It never drops recorded ticks or changes the 120 Hz timestep.
A 720-tick variable-cost replay and its 120-tick continuation match the unsliced
reference. One expensive tick and constructor work remain indivisible.

The first wave 3 integration run passed **92 tests across eight suites**,
including real worker pause barriers and flashback reconstruction for road
motorcycles, motocross, and a road car.

Snapshot encoding now scatters ranks in one pass and uses a stable vehicle-index
lookup. At 12 entrants, order-element reads fall from 78 to 12 and registry
linear searches from 12 to zero. The tradeoff is one additional rank-slot write
per listed entrant. Twenty-four seeded snapshots across eight vehicle/session
scenarios match the original writer byte for byte, including reused subarrays.
All 14 new encoding tests and five existing targeted checks passed.

Festival renderer loaders now share an in-flight photographic load and release
resources that resolve after disposal. Successful installation and scene data
are unchanged. Renderer/session lifecycle integration passed 45 tests. These
loaders may still finish underlying downloads after cancellation; their results
can no longer repopulate the closed renderer.

Wave 3's simulation/worker source and tests passed TypeScript checking as one
400-file project with the repository's compiler options (about 248 MiB compiler
memory). Scoped lint passed for every assignment. Local checks of the large
renderer dependency graph were terminated by host memory pressure, including a
serialized attempt; they are not recorded as passing. The repository CI's full
compiler/build job is required to close that verification gap.

That gap is now closed: on published wave 3 commit
`f4deef71c6be959f19f97df6a3ba4554da5057f2`, the full CI `validate` job passed
repository-wide lint, content validation, TypeScript checking, and production
build validation. Receipt:
https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45398957235/job/138462387258

### Wave 4 — host cancellation, transport and protocol validation

Application-level Festival ownership begins before the lazy module loads and
remains linked to the running session. Exit, disposal and fatal failure revoke
host callbacks and abort startup. Late sessions are disposed; old callbacks
cannot change a replacement run. Keyboard focus is released when driving takes
over. Host/session integration passed 43 tests after the coordinator connected
fatal terrain-worker errors and undecodable messages to cleanup and menu exit.

Circuit and Festival workers share `FrameBufferPool`: duplicate or wrong-sized
returns are rejected, attached storage is recovered when writing/posting fails,
and detached transfers retain capacity credit without retaining detached wrapper
objects. Required pause, pit, flashback and applicable Festival state snapshots
still deliver with an exhausted ordinary pool. Circuit verification passed 40
tests; Festival verification passed 14, including real transferable buffers.
The existing wire protocol does not authenticate same-size returns by sender or
session, and this change makes no such guarantee.

Terrain streaming now rolls back failed sends, retires cancellation ownership
before posting, clears terminal worker failures, and ignores late replies.
Twenty transport/transition tests passed. Geometry, payloads, LOD transitions,
quality budgets and scene content are unchanged.

Binary utilities now grow from zero capacity, reject malformed byte counts
without poisoning the read cursor, and reject unsafe decoded integers. Both
directions of network control decoding enforce their channel/shape contracts.
Server-control validation preserves real producer sentinels and legacy optional
fields while rejecting malformed nested state. Binary/codec tests passed 48;
server-control/lifecycle/resilience tests passed 130. These are improvements to
the repository's existing networking prototype, not a new multiplayer service.

Wave 4's worker, network, terrain-streamer and startup-owner source/test graph
passed the project TypeScript options (999 files, about 396 MiB compiler
memory). The full application/renderer graph remains delegated to CI because
local attempts were terminated by host memory pressure. All changed files have
scoped lint and behavior coverage; the whole-project CI receipt is tracked after
publication.

Wave 4 commit `02d2f97c79e5f79fce6ed80d6bdc020ead8a756a` passed the full CI
`validate` job, including repository lint, content validation, TypeScript,
production/demo/static builds and committed-source preservation. Its full
off-road calibration/race job also passed. Validation receipt:
https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45401257871/job/138470333158

A broader local network-test run exited with a closed worker IPC channel after
its lifecycle suite passed. It produced no failing assertion and is not counted
as a passing full-network check; the selected codec/control/lifecycle results
above remain the verified local coverage.

### Wave 5 — replay and persistence consistency

Replay IndexedDB storage now rejects work after disposal, closes late opens,
handles version changes, and waits for transaction completion. SaveStore can
retry failed/blocked opens, closes obsolete connections, and aborts partially
enqueued writes on synchronous failures. Read success is published only after
its transaction commits. The two stores retain their existing keys and formats.

Session replay tracks individual pending page objects across flashback page-ID
reuse. Reopened surface records retain validated hashes when resealed, and
truncation removes all future-only surface records. Controlled regressions cover
overlapping writes and evicted/reloaded pages; replay data and physics are
unchanged.

Telemetry export rejects malformed replies through its promise and contains
auxiliary worker errors. Cancellation, sequence ownership, CSV schema and bytes
are preserved. The tests also exercise the real export-worker handler in-process
with transferred buffers and a live wrapped recording; this is not a claim of
full browser Worker validation.

Diagnostic replay recorders reject invalid capacities and use complete slots
for fractional durations. Telemetry bulk append skips rows that the same batch
would overwrite and uses at most two contiguous copies. For a controlled
60-row ring receiving 6,000 rows at head 17, copy calls fall from 6,000 to two and
copied float values from 1,368,000 to 13,680. Ring contents, ordering, truncation
and exported CSV match the row-at-a-time reference.

Desktop mirroring now uses the revision of the snapshot actually loaded or
seeded, retains the highest observed revision across retries, and reports the
actual entry count. Its IndexedDB adapter waits for completed transactions and
aborts failed write batches. Bridge/API signatures are unchanged. These fixes
provide instance-local ordering; the existing backend does not provide atomic
cross-process comparison or cross-device conflict resolution.

All six assignments have targeted regression coverage and scoped lint. Their
new suites cover 18 replay-store, 35 SaveStore, 27 export, 31 recorder, seven
session-paging and 22 desktop-mirror cases. Storage transaction tests use
controlled IndexedDB doubles; native-browser ordering remains an integration
validation target.

Wave 5 integration passed **140 tests across all six new storage suites**. Its
source and test dependency graph passed TypeScript with the project options
(619 files, about 262 MiB compiler memory).

### Wave 6 — rendering infrastructure and bounded ownership

Texture-budget refresh now repaints all registered groups derived from the same
authored source, including different resolution claims and CPU-read copies.
Full-resolution siblings also receive upload invalidation. Dimensions, backing
choices, filtering and canvas identities remain unchanged. Two regressions
failed before the fix; 34 related tests now pass. A separate existing test was
corrected to inspect each canvas context rather than assume an obsolete global
call order; no redundant production resampling was introduced.

The shadow-batching audit retained production code. Current model articulation
requires 15 LOD1 shadow draws: eight rigid-owner proxies, four upright-owned
brakes, one articulated suspension and two independently moving hydraulic
parts. Current draw counts are 96 to 58 at LOD0, 26 to 15 at LOD1, and 23 to 13
at LOD2. These are existing reductions, not new performance gains. Tests now
require at least one-third draw reduction at every LOD and retain exact triangle
comparisons. New checks cover mirrored/nonuniform owner transforms, winding,
culling, original-buffer preservation, visibility and shared disposal. Twelve
related tests pass without modifying model or shadow content.

Presentation buffers passed additional ownership auditing without production
changes. Six new cases cover offset array views, real transfer detachment,
192 observations across three resets, bounded eight-slot reuse, malformed
replacement atomicity and reentrant quaternion callbacks. All 67 related tests
pass. The native PMREM compiler also passed its existing ownership tests without
a rewrite.

Reflection and mirror disposal now revoke ownership before callbacks, complete
remaining independent cleanup after failures, restore borrowed bindings, and
become idempotent. They propagate the first failure after cleanup, including
an undefined thrown value. All 12 new regressions failed on the prior code;
68 related preparation/reflection/mirror tests pass after the fix.

Optional per-pass GPU timing no longer skips rendering or leaks partial queries
when instrumentation fails. Active and pending measurement pairs share the
48-measurement bound; disjoint/lost samples and invalid timestamps are retired,
and reporting callbacks cannot retain completed ownership. Rendering executes
once and preserves its own exception. DrawLedger remained unchanged after
256-frame/nested-shadow accounting checks. The final timing/accounting run
passed 73 tests; these use controlled GPU query doubles, not physical-GPU
measurements.

The completed texture/reflection/timing/presentation source and new-test graph
passed TypeScript with the project options (630 files, about 263 MiB compiler
memory).

Circuit preparation now checks both caller cancellation and terminal renderer
disposal at asynchronous boundaries. Late loading, compilation, progress and
camera-restoration callbacks cannot resume work on a disposed renderer. Fence
waits terminate promptly on disposal; the factory also checks cancellation after
its final ground-readiness wait. Its synchronous teardown finishes independent
releases before rethrowing the first failure, while asynchronous decoder cleanup
rejection is reported separately. Nineteen new lifecycle tests pass; startup
integration passed 101 tests and actual MX/SX scene-resource teardown passed
seven. The factory guard was inspected rather than exercised through a full
browser startup; that remains a broader integration target.

Wave 6 integration passed **79 tests across all seven new rendering suites**.
The complete renderer graph is covered by the publication CI rather than a
local full-project compiler run under the shared memory limit.

The full CI `validate` job passed on wave 6 commit
`17c16aeddc2146523435cb6ce06c4e82fae9c14a`: repository lint, content validation,
TypeScript, production/demo builds, output checks and exact-source preservation.
This closes the complete renderer compiler/build check for waves 5 and 6:
https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45404807980/job/138482690592

### Wave 7 — audio, haptics and replay controls

RacingAudio detaches old graph ownership before cleanup or asynchronous context
close. Replacement starts cannot reuse a closing context, and an old finalizer
cannot clear the replacement. Partial construction rolls back owned nodes;
independent cleanup continues after failures. Delayed driving previews cannot
cross stop/disposal/context boundaries, and preview throttling uses the new
context's time origin. Nineteen new cases and 87 related tests passed.

Audio activation ignores stale/disposed and closed-context requests and contains
synchronous activation refusals. Accepted gestures still retry while earlier
resume requests remain pending. Seventeen activation tests passed.

Music playback belongs to the latest valid request. Old loads cannot supersede
newer cues or restart after stop/disable/disposal. Voice identities track current
playback through crossfades; ended and partially constructed voices release both
nodes. Twenty new cases and 47 related tests passed. Underlying obsolete fetches
may still finish, but cannot install their result.

UI audio releases each source/filter/gain branch on completion and releases the
shared cue trim after its last voice. Terminal disposal cannot reopen the graph;
failed setup rolls back. Review capture attempts all owned track/destination
cleanup while retaining the regular playback connection and original failure.
The final integration passed 77 tests, including 100 successive cue completions.
Audio cue definitions, synthesis values, gain formulas and sound assets are
unchanged; controlled Web Audio stand-ins verify scheduling and ownership,
not native device output or waveform equivalence.

Haptic output now retains the actuator that received the effect. Disconnect,
replacement and stop(null) can release that actuator; late rejected effects
cannot stop newer output. Clock rebasing and optional API failures cannot poison
the next update. All 26 tests passed. Channel strengths, quiet threshold, 120 ms
effect duration and ordinary 10 Hz cadence remain unchanged. No physical
controller validation is claimed.

Host replay Play/Pause now uses ReplayClock.toggle. Pausing an end seek awaiting
presentation preserves its endpoint; pressing Play at the end restarts at the
retained floor with page preparation and presentation/audio reset. The actual
host methods passed six mechanically extracted scenarios after two baseline
failures, and 41 recording/clock tests passed. A real-application E2E regression
was added to replay-state.spec.ts; browser execution remains pending.

Wave 7 integration passed **125 tests across seven suites**. A test-spy typing
issue was corrected during the compiler check. The final audio/input/clock
source and test dependency graph passed TypeScript with the project options
(623 files, about 270 MiB compiler memory); the affected 19-case audio suite
and scoped lint passed again. The full CI validate job subsequently passed on
wave 7 commit `9dc4811ff986e9b410bdcfb5f631db19130ce95f`: complete lint, content
validation, application/E2E TypeScript, production/demo/static builds and exact
source preservation. This validates compilation of the added browser regression;
it does not establish that the browser scenario has run:
https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45406562605/job/138488941100

### Wave 8 — deterministic services and networking

Event-loop cancellation belongs to a queued handle. Unknown or retired handles
cannot cancel a future event; cancelling releases the callback closure at once.
The cancelled heap slot remains until its due time, preserving ordering and
pending-count behavior. Finite clock and interval guards reject poisoned
deadlines. Twenty-one new cases, 32 related tests and 24 seeded 512-event traces
passed, including 10,000 completed/cancelled cycles and 2,000 self-stopping timers.

The simulated reliable transport now performs at most 64 loss attempts in one
send or retry continuation. Longer streaks continue through the event loop so
permanent loss cannot trap send in a synchronous infinite loop. Deferred packets
preserve FIFO ordering, and graceful close follows preceding packets. Severing
the link or closing the destination retires owned retries. Duplicate datagrams
get independent payload storage before either delivery. Invalid conditions and
unrepresentable retry deadlines fail explicitly. Fifty new and 11 existing cases
pass, including a 2,000-packet deferred queue and 16 exact original-algorithm
comparisons at 0%, 2%, 20% and 80% loss. Pending payload memory still follows the
number of queued sends; this does not add a queue quota or a deployed service.

Command issuance validates its complete wire range before advancing sequence
or tick counters. Future acknowledgements cannot suppress unsent commands, and
malformed server queue metadata cannot poison the integer gap walk. Existing
sequence continuity across command-log restarts is retained. All 56 new cases
and 87 related cases pass, including a 512-command seeded tick oracle with loss,
duplicates and reordering and existing motorcycle/motocross controls.

RaceClient now owns a single join/keep-alive, retires timers before leaving,
protects replacement transport callbacks, and rejects late messages after a
terminal transition. Race generations prevent reentrant input callbacks from
publishing into a replacement race. Results stop all timers while retaining
already received chunked lap data. Twenty new cases and 150 distinct selected
client/codec/control/lifecycle/resilience cases pass; the full resilience suite
was not represented by this selected run.

Rate buckets reject invalid configuration and invalid requests without corrupting
their budget. Zero-rate buckets cannot become NaN through an overflowing finite
clock difference. Runtime timing statistics use only usable post-warmup samples,
retain total tick counts and existing histogram boundaries, and treat an invalid
measurement as a break in the observed overrun streak. Fifty-one new and 67
related cases pass, including 10,240 valid requests compared with the original
bucket arithmetic and 4,096 timing observations against independent statistics.

Route search replaces its repeated full-state selection scan with a bounded
binary heap and true decrease-key. Exact distance followed by state index
preserves the original tie order; relaxation tolerance, turn rules, arrival
selection and leg reconstruction remain unchanged. All 1,024 route comparisons
match the frozen original, including the 18 authored event routes, explicit
departure directions, seeded multigraphs, equal-cost grids and threshold cases.
Ten selected tests pass. RoutePath sampling and geometry code are byte-identical.

For all 18 current events (44 shortest searches), both planners settle 5,544
states. The original makes 704,088 state-slot visits; the heap makes 37,691
ordering comparisons. These are different operation units. Nine alternating
paired trials after warmup measured a local median of 2.353 ms versus 1.389 ms
for the complete route workload, about 41% lower. This is a route-planning
microbenchmark on a shared host, not an FPS or device-level guarantee. The
queue adds two bounded Int32Array buffers (8 bytes per directed state, 1,008
buffer bytes for the current region's 126 states), plus object overhead.

Wave 8 integration passed **206 tests across all six new suites**. A fixture's
explicit receiver type was corrected during TypeScript checking. The final
373-file source/test dependency graph passed the project compiler options
(about 260 MiB compiler memory), and scoped ESLint passed. A preceding compiler
attempt was terminated during concurrent work; it is not counted as a pass.

The full CI validate job also passed on published wave 8 commit `c4e62c6`,
including repository lint, content validation, whole-project TypeScript and
production/demo builds. The independent full offroad scenario job passed:

- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948448
- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498947631

All four broad unit partitions subsequently completed: **8,587 tests passed and
four failed across 835 files**. The four failures match baseline cases: APX-01
livery material metadata, a stale gpr1 calibration record, missing localization
dictionary keys, and the frozen gpr1 catalogue-growth hash. No new engine test
failed in these partitions. They are not treated as permission to modify art,
content or tuning:

- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498947980
- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948050
- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948185
- https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948131

### Wave 9 — independent performance and integration evidence

The independent operation-count comparison imports actual baseline and revised
engine modules. It reproduces the BVH, telemetry ring, collision broadphase and
rotating-contact work reductions reported above, while requiring exact output
equality. Reusable scripts and machine-readable source/output hashes accompany
the [performance evidence](ENGINE_PERFORMANCE_2026-11-24.md). The route benchmark
also compares actual baseline and revised modules, with optional timing trials.

An independent content audit found no changes to 2,996 tracked asset-extension
objects, all 231 public files, vehicle catalogue data, or selected protocol,
dependency and default definitions. It physically rehashed present assets and
checked Git objects for sparse-checkout omissions. Mixed renderer, loader,
terrain and vehicle files received declaration-level inspection so an allowed
runtime filename could not conceal an artistic edit. The
[scope audit](ENGINE_SCOPE_AUDIT_2026-11-24.md) identifies exact coverage and
content hashes; it will be refreshed after the remaining reviews.

The same-tick comparison ran six actual baseline/candidate simulation pairs:
Formula, wet touring cars, wet road motorcycles, motocross racing, Festival
traffic and a Festival sprint event. Each ran 2,400 steps at 120 Hz (20 simulated
seconds), comparing 2,401 observations including initialization. All **14,406
complete snapshots and selected Float64 vehicle-state records matched byte for
byte**. Festival also matched 4,802 traffic frames and gameplay-status records.
No snapshot field was excluded; both serializers received the same zero timing
inputs. The sole status exclusion was Festival's intentionally changed terrain
residency/work-statistics subtree. This checks fixed-step state equivalence, not
wall-time catch-up policy, rendering or all possible driving conditions.

The [determinism report](ENGINE_DETERMINISM_2026-11-24.md) includes scenarios,
commands, exact data hashes and the unchanged 189-file engine source manifest.
Fresh sequential processes kept each child's peak resident memory below 250 MiB;
temporary comparison traces were deleted after validation.

The independent clock/transfer review found a further reentrant ownership bug:
an older failing publication could reclaim a buffer already republished to a
newer synchronous consumer. The reproducer showed a later writer overwriting
that consumer's live bytes. FrameBufferPool now associates each outstanding
buffer with a publication number; recovery and detached-credit bookkeeping act
only on the matching publication. Seven new cases pass, including real
structured-clone transfers and 2,048 clock/backpressure/pause batches. The
combined independent review passed 50 distinct tests, including both actual
worker handlers. Pool capacities and wire messages are unchanged. See the
[clock/transfer review](ENGINE_CLOCK_TRANSFER_REVIEW_2026-11-24.md).

The persistence review found a mismatch between IndexedDB's request-time clone
and the desktop mirror's later use of a mutable caller object. Desktop saves now
retain one private structured clone at the existing enqueue boundary and use it
for both committed copies. Caller mutation while opening retains the prior
timing semantics; mutation after submission cannot change the mirrored revision.
Clone failure aborts an already queued backup, and browser-only saves keep their
ordinary IndexedDB clone. All 13 new cases and 134 selected storage/replay/export
tests pass. This adds one desktop-only clone for consistency; it is not a memory
or speed reduction. See the [persistence review](ENGINE_PERSISTENCE_REVIEW_2026-11-24.md).

Six native IndexedDB/Worker cases and the complete replay ownership scenario
are selected by a new read-only focused CI workflow. Local Chromium was denied
a socket before backend verification or test execution, and a separate local
Vite build was host-terminated during transformation. Neither is counted as a
pass. The test/source dependency graph, fixture bundle, seven-case discovery,
workflow YAML and shell syntax checks passed. CI uses the original assertions,
deadlines and verified Mesa backend, builds directly without asset-generation
hooks, and uploads exact source/build/backend receipts. It does not replace
the complete suite. See [browser validation](ENGINE_BROWSER_VALIDATION_2026-11-24.md).

Wave 9 integration passed **55 tests across the two new review suites and the
existing save-lifecycle suite**. The combined 621-file source/test/native-fixture
graph passed TypeScript with the project options (about 279 MiB compiler memory).
The three reusable measurement scripts and all changed code passed scoped lint.

### Wave 10 — final ownership fixes and independent acceptance

The physics review adds eight adversarial invariants for cached contact bounds,
rotating contacts, deferred-hit ownership, reused interpolation outputs, and
terrain failure/retry behavior. It makes no production physics or tuning change.

The resource integration review follows application disposal through the Festival
session and renderer. Three terminal disposal methods now revoke ownership before
callbacks, attempt every independent cleanup after an exception, and preserve the
first synchronous failure. Application disposal additionally closes its UI audio,
stops the owned haptic actuator even after the pad disappears, and observes replay
cleanup rejection. Resource construction, scenes, material definitions and authored
content are unchanged. Eighteen composed regressions cover these ownership chains.

The networking review fixes observer-requested teardown that previously allowed
world construction, recurring ticks or results creation to continue afterward.
Server teardown retires local connection/timer ownership before callbacks and
attempts all external closes. New transports presented to a terminal server receive
the existing rejection and close without installing another handler or deadline.
Eleven composed cases plus four unchanged selected lifecycle/resilience cases pass.

The execution host was replaced before the final wave was published. The first
nine waves were already safe on main. The exact final production patches were
recovered from retained agent records; two network-test tails were reconstructed
and verified afresh. On the restored frozen checkout, all 37 new final-wave cases
passed, plus the four unchanged network scenarios. This recovery is recorded so
historical results are not mistaken for verification of reconstructed files.

The final consolidated run passed all 60 changed unit suites (55 added and five
modified): **1,072 passing test executions, zero failed or skipped**, with one
process per file and no retries. Conservative file/name deduplication gives
1,068 displayed identities; four parameterized title collisions are documented
without inventing additional unique names. Source, test and configuration hashes
were unchanged throughout the run. These totals are independent of overlapping
agent runs. See the [regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md).
On the published final commit, all **seven focused browser cases passed**:
six native IndexedDB/Worker cases and the complete replay scenario. The corrected
mirror test now verifies rollback, rejection, recovery and error absence with
Chromium's observed event ordering. The backend was verified as Mesa llvmpipe,
so this is software-rendered browser evidence. The full CI validation job also
passed repository lint, content checks, whole TypeScript and product/demo builds.
The final independent scope audit passed at the exact same production tree.
All four broad unit partitions subsequently completed on that same commit:
**8,645 passed and four failed across 840 files**, with zero skipped or pending
cases and no unhandled-runner/source-guard errors. The four failures exactly match
the original baseline titles, assertions and values: APX-01 livery metadata,
gpr1 calibration hash, missing localization dictionary keys and the frozen gpr1
catalogue-growth hash. Their test sources remain unchanged. No new engine unit
failure occurred. Full physics scenarios, offroad scenarios and wet-presentation
validation also passed; the wet run separately passed seven browser cases on
verified SwiftShader. The focused seven-case run uses verified Mesa.

The full repository workflow is not presented as all green: its four baseline
unit failures remain visible, and the larger browser/owner matrices were still
in progress at the final core-evidence snapshot. Detailed job identities,
counts and limitations are in the [CI report](ENGINE_CI_VALIDATION_2026-11-24.md).

The restored candidate passed whole-project `tsc --noEmit --extendedDiagnostics`
across 3,169 files (approximately 2.3 GiB compiler memory), scoped lint for every
changed production/test file, and a direct Vite production build. The build
transformed 1,094 modules in 15.27 seconds, passed the existing output IP guard,
and passed the repository source-stability guard without changing inputs. It
invoked neither npm build prehooks nor any model-generation command. The first
compiler attempt identified a tracked JSON fixture omitted by sparse checkout;
restoring its exact HEAD bytes resolved that checkout issue before the passing
full compiler run.

### Pre-existing broad-suite findings

The baseline CI report for `a0ae513e79` records failures in livery metadata,
CPU-backed texture resampling, vehicle calibration/catalogue snapshots,
localization dictionaries, and shadow batching. These predate this programme.
Engine-related failures will be investigated within scope; changing model art
or vehicle specifications merely to satisfy a snapshot is excluded.
