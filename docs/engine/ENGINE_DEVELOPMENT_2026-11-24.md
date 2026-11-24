# Engine development programme — 24 November 2026

## Scope and baseline

This programme improves the shared game engine of Experiment-3 on `main`.
Baseline: `5bb8a45843c853fcdbfe3fe422d303b5c2932fca`.

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

## Architecture

- Circuit racing, road motorcycles, and motocross share `RacingRenderer` and
  the worker-owned `Simulation`.
- Vehicle dynamics are provided by `Vehicle`, `BikeVehicle`, and
  `DirtBikeVehicle`, with shared collision, race, and snapshot infrastructure.
- Festival uses `FestivalSession`, `FestivalRenderer`, and
  `OpenWorldSimulation`, reusing the graphics context and vehicle systems.
- Rendering is based on Three.js; the project's game systems are TypeScript.

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
| 8 | 43–48 | Determinism, shared runtime integration and open-world engine services | In progress |
| 9 | 49–54 | Performance measurement and adversarial integration review | Pending |
| 10 | 55–60 | Independent regression audits, remaining fixes and final validation | Pending |

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
and scoped lint passed again. Full application/E2E compilation is delegated to CI.

### Pre-existing broad-suite findings

The baseline CI report for `a0ae513e79` records failures in livery metadata,
CPU-backed texture resampling, vehicle calibration/catalogue snapshots,
localization dictionaries, and shadow batching. These predate this programme.
Engine-related failures will be investigated within scope; changing model art
or vehicle specifications merely to satisfy a snapshot is excluded.
