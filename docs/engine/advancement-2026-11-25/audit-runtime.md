# Runtime audit — 25 November 2026

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`. Assignment 1/60; production read-only.

Reviewed the prior runtime follow-up plan/review, current core/worker/session implementation, main startup and frame integration, and existing settlement, frame-credit, input and Festival regressions. The findings below do not repeat the repaired clock, shift transport, credit conservation, terminal-worker or readiness-settlement issues. No content, authored assets, vehicle tuning, dependencies, production code or tests were changed.

## Priorities and distinct ownership

| Priority | Finding | Safe implementation boundary |
| --- | --- | --- |
| High | Circuit and Festival startup can simultaneously claim the same renderer | `src/main.ts` startup admission; focused host integration test |
| Medium | Flashback-disabled modes retain an unused, unbounded input journal | `src/workers/physics.worker.ts`, shared flashback eligibility in `src/core/flashback.ts`, `src/ui/flashback.ts`; worker recording tests |
| Medium | A history-cache return restores an app that `pagehide` permanently disposed | `src/main.ts` page lifecycle ownership; focused lifecycle/browser test |

## 1. Cross-mode startup has no mutual exclusion before the lazy Festival module resolves

**Paths.** `src/main.ts:998–1107` (`startFestival`), particularly the guards at 1002–1010, captured renderer at 1018, `festivalOwner.start()` at 1021, and deferred `create` at 1034; `src/main.ts:1193–1224` (`start` admission); `src/main.ts:713–747` (`switchCircuit` renderer disposal). The live session form at `src/ui/interface.ts:468–479` calls `callbacks.start` directly without setting its own busy state. `SessionStartOwner` prevents a second Festival only; it does not own circuit startup.

**Reachable sequence.** Launch Festival with its lazy module fetch delayed. `festivalOwner.starting` becomes true synchronously, but application state remains `menu`, and `showMode('loading')` runs only after the import resolves. The form remains actionable. Change the session choice to a circuit and submit: `start()` checks only disposed/error, settings and an existing loading worker; it does not check Festival ownership. It advances its generation and may dispose the captured old circuit renderer while preparing the replacement. When the original Festival import resolves, its scope is still current and `create` passes the previously captured renderer's WebGL renderer into `FestivalSession.start`. If both complete on the same circuit instead, both workers/session controllers remain active and share presentation/input ownership.

This is source-confirmed through actual UI and ownership callers, not a hypothetical synchronous callback during a constructor. The delayed-import/two-submit browser sequence was **not executed** in this audit.

**Narrow repair.** Make circuit/Festival admission mutually exclusive synchronously before either async import/preparation. For the least disruptive policy, reject another circuit start while `festivalOwner.starting/session` is present; reject Festival while circuit startup/loading or a settings transaction owns the renderer. Expose Festival's loading state immediately when its owner is acquired. If product behavior instead permits replacement, explicitly cancel the prior owner before capturing the renderer; never allow two starts to survive independently. No renderer geometry or visual definitions need change.

**Regression.** Extract the complete production host methods as existing startup tests do. Hold the Festival module import, submit a circuit request through the same host boundary, then resolve the import; assert that only one startup enters preparation, at most one session receives input, and no session borrows a disposed renderer. Cover reverse ordering, duplicate Festival submit, failed import followed by circuit start, and settings preparation. A native check can delay the Festival chunk and exercise the visible form.

## 2. Every time-trial and qualifying control sample pays for flashback history that cannot be used

**Paths and consumers.** `src/workers/physics.worker.ts:26–31, 134–143, 155–160, 183–191, 194–209` always allocates `InputLog`, always uses `applyLoggedInput`, and also logs pit/autopilot transitions. `src/core/flashback.ts:47–83, 90–93` stores an outer entry plus a copied controls object for every distinct applied input. The only production consumer of `log.entries` is the worker's `new Resimulation(..., log.entries.slice(), ...)` at line 209. No telemetry export, replay storage, ghost recorder, networking or audit export reads this journal. `src/ui/flashback.ts:6–10`, used by `GameApp.openFlashback`, permits only race, endurance and practice; qualifying and time trial can never invoke that consumer through the application.

**Cost.** Continuously varying controller steering produces a new retained entry per 60 Hz host sample. This accumulates for the whole session; the 30-second flashback *selection* window does not bound the log. Even modes with no permitted rewind retain it. On each new distinct sample, `InputLog` also creates a separate transient `lastInput` copy. This is avoidable allocation and session-length memory retention on an ordinary path, independent of renderer/physics tuning.

**Executed mechanical reproduction.** A transient inline Node 24 script extracted/transpiled the exact production `sameInput` and `InputLog`, then applied 36,000 varying steering samples stamped every two ticks. It retained **36,000 entries**, first tick 0, last tick 71,998: the count corresponding to ten minutes at 60 Hz. At that cadence one hour implies 216,000 entries (arithmetic projection). The probe did not run simulation ticks, measure heap bytes/GC or establish an FPS result; worker call sites establish that the same journal runs in every mode.

**Narrow repair.** Move the existing mode eligibility predicate into a core helper shared by UI and worker. Create/append flashback history only for supported modes, while applying the exact same input to `Simulation` in all modes. Reject unsupported-mode rewind requests before constructing a resimulation. Keep all telemetry/replay/ghost recording untouched. The first implementation should leave the enabled-mode journal representation and from-start determinism unchanged; checkpointing enabled modes is a separate, larger task.

**Regression.** In the actual worker harness, initialize time-trial and qualifying, send a long varying input stream, and assert no journal entries/control copies are retained. Compare packed frames and applied input traces against baseline for the same samples. Preserve enabled-mode shift, watchdog, AI handback, pit and flashback-determinism tests. Verify telemetry/replay still emit normally and unsupported rewind cannot mutate the live session.

## 3. History-cache restoration returns a permanently disposed application

**Paths.** `src/main.ts:589` installs `pagehide` as `() => this.dispose()` without checking the event's `persisted` state. `dispose()` at `3708–3757` sets `disposed = true`, increments generation, stops the RAF/input pump, terminates workers and disposes the renderer/audio. There is no `pageshow` listener anywhere in `src`, and `start()`/`startFestival()` return immediately for a disposed instance.

**Reproduction.** In a browser that admits this page to its back/forward cache, load the app, navigate to another same-origin page, then go Back. The persisted `pagehide` tears down the retained JavaScript instance; restoration does not rerun module initialization, so the restored screen has no live frame/input/worker owner. The same ownership sequence can be tested deterministically with persisted page transition events. This audit verified the source path, **not** a native cache admission/restoration; actual cache eligibility is browser/configuration dependent.

**Narrow repair.** Define persisted navigation separately from terminal teardown. Either retain the instance in a paused state on persisted `pagehide` and rebase/invalidate presentation on `pageshow`, or deliberately reload once on persisted restoration if retaining the full engine is unsuitable. Do not automatically resume a moving vehicle. Ordinary terminal navigation must still release workers/resources once.

**Regression.** Exercise both `persisted = true` and false through owned event callbacks. A retained engine must stop audible/driving activity while away, keep one owner, resume with fresh clocks and a usable paused UI, and perform final disposal exactly once. Add a native same-origin away/Back case that records whether restoration actually used the cache; do not count a normal page reload as proof.

## Rendering handoff and evidence limits

`GameApp.frame` branches to `FestivalSession.frame` at `src/main.ts:1652–1655`, before the circuit's GPU/idle gates. `src/session/free-roam.ts:666–736` calls `renderer.draw` every RAF, including pause, and `src/rendering/open-world/festival-renderer.ts:679–1081` has no `GpuFrameGate` equivalent. This is a concrete scheduling opportunity for the rendering/resource owner, with required HUD/gamepad polling kept independent of deferred draws. It is not counted as a fourth runtime defect or a measured GPU improvement.

Only the exact journal mechanical probe was executed here. No dependency installation, asset hooks, full tests/build, native browser, heap/FPS benchmark, commits or remote writes were performed. Coordinator verification remains authoritative for aggregate test results.
