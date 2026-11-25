# W08F — host startup and retained-page ownership review

Assignment **48/60**, wave 8. Original baseline:
`350119e8ec0606e8c5de5b3ab80df41104025679`. The reviewed pre-repair source
is local `714632a3db99c0016437d789bb9417c610c9a267`, whose production tree
matches the published `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b` checkpoint.
The intervening commit updates CI reports only. Other wave-8 patches were
present in the shared worktree; this assignment changed only the host and its
existing startup suite, plus this report.

## Decision and ranked findings

### 1. High: final startup callbacks could outlive the owner they activated

The asynchronous preparation stages already check ownership, but two final
synchronous boundaries did not. A callback can revoke an owner before its
caller returns, even when no promise or task intervenes.

In circuit startup, `emitSessionStarted()` synchronously calls subscribers
through the real process-wide `GameEventBus`. A subscriber can fail, dispose,
or replace the host. The old startup then continued into UI and input
activation. A separate `activeElement.blur()` callback could dispose the host
immediately before the old startup sent an unpause command to its departed
worker. In Festival readiness, a focus callback could exit or dispose the
session, after which the old readiness callback still created the demo clock
and published a session-start event.

Six concrete witnesses failed before the repair; the original 18 cross-mode
cases still passed. Their results were:

| Boundary and revocation                                              | Incorrect continuation observed                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Circuit public session-start subscriber calls `fail()`               | One additional input enablement after fatal ownership revocation                   |
| Circuit public session-start subscriber calls `dispose()`            | One additional input enablement after terminal disposal                            |
| Circuit public session-start subscriber begins a replacement circuit | Old startup enables input while the replacement owns loading and is awaiting audio |
| Circuit launch focus calls `dispose()`                               | Old startup sends `pause: false` to the departed worker                            |
| Festival launch focus exits the session                              | Departed readiness creates the demo clock and publishes session-start              |
| Festival launch focus disposes the host                              | Departed readiness creates the demo clock and publishes session-start              |

The event witnesses use the actual `emitSessionStarted` implementation and
actual `gameEvents` bus, including its synchronous subscription delivery and
exception isolation. The focus witnesses control the browser boundary; they
are deterministic callback evidence, not claims of a native focus incident.
The startup harness executes complete production methods and the real
`WorkerReadiness`, `SessionStartOwner`, `PauseHandshake`, `InputPump`, and
settings transaction. No startup decision is copied into the fixture.

The original baseline also contains these unguarded callback boundaries by
source inspection. The fail-before execution was performed on the reviewed
current source, not separately on the original baseline. This finding is an
uncovered host defect; it is not labeled a regression introduced by the earlier
advancement changes.

#### Narrow repair

`src/main.ts` adds ten lines:

- Circuit startup reuses its existing `cancelled()` predicate after public
  session-start delivery and after launch focus, before unpause/pump activation.
- Festival readiness captures its page epoch and checks actual session identity,
  disposal, fatal state, and page suspension. It rechecks after input activation,
  focus, and demo-clock callbacks before continuing.

The event payloads and the ordinary successful event order remain unchanged.
The existing generation still owns circuit startup, and the actual Festival
session still owns Festival readiness. No new global latch, retained collection,
worker protocol, callback queue, or renderer abstraction was introduced.

The six unchanged assertions pass after the repair. The replacement test also
checks that the new startup remains pending in loading state; terminal tests
check the absence of a late worker unpause. Existing successful startup and
recovery cases continue to pass.

### 2. Accepted: asynchronous startup and settings admission remain coherent

The review found no additional missing asynchronous admission boundary in the
reviewed changes:

- Festival claims its `SessionStartOwner` before the lazy import and synchronously
  makes the host loading. Circuit, duplicate Festival, and graphics-settings
  admission remain blocked while that owner is preparing.
- Circuit startup establishes its generation and `WorkerReadiness` before
  asynchronous audio, renderer, module, first-snapshot, and records work.
  Replacements close the old lifetime. Old finalizers clear timers and startup
  state only when they still own that exact startup object.
- Renderer preparation captures generation, build identity, and page epoch.
  An obsolete candidate cannot overwrite or dispose the renderer that replaced
  it; released template ownership has its existing `finally` cleanup.
- Settings capture the renderer, generation, and page epoch. A durable save
  completion checks cancellation and the actual still-connected form before
  closing its editor. Delayed locale reload retains the same cancellation
  predicate. The settings owner excludes new session startup until it settles.
- Recoverable Festival import/preparation errors report a toast only after
  cancellation and menu restoration succeed. Restoration failures retain the
  existing fatal route.

This conclusion is limited to the reviewed ownership paths and executed
regressions. It does not assert that every application callback is reentrancy-safe.

### 3. Accepted: retained-page suspension preserves one paused owner

The retained-page design distinguishes active completed sessions from unfinished
startup. Active circuit workers retain generation so their final pause snapshot
and receipt can still be consumed. Unfinished starts lose ownership, their
worker/renderer work is cancelled, and menu recovery waits for an active page.

The RAF callback checks its captured page epoch before clearing the current
pending identifier or calling the frame. This prevents a cancelled old delivery
from disturbing the replacement callback. `null`, rather than numeric truthiness,
represents no pending callback, including native identifier zero. Duplicate
hide/show paths are idempotent.

Page restoration resets wall-clock baselines, input/action edges, and playback
permission. It restarts the existing input pump and schedules one host frame.
Flashback and travel completions retain their original page epoch so an old
automatic resume cannot cross a retained navigation. Settings completion uses
that same principle. Initial-load waiters settle on return, terminal disposal,
or failure.

The existing 28-case page lifecycle suite passed with the new host guards. The
already published native evidence at `6cb1c88` additionally verifies two actual
persisted history restores and terminal reload cleanup. That native evidence
predates this ten-line repair; the next exact-source CI run is required to verify
the repaired source in a browser.

### 4. Accepted: Festival scheduling keeps service work independent of drawing

`src/session/free-roam.ts` was reviewed without modification. Its frame captures
renderer, HUD, controls, and page epoch, then rechecks them after admission,
resize, pose updates, draw, HUD polling, and control synchronization. GPU or idle
cadence deferral leaves HUD/control/audio service active on eligible callbacks.
Only a successful draw consumes presentation and resize revisions. Hidden and
retained-page transitions reset wall time rather than replaying it as a large
presentation delta.

The independent W04E controlled-callback evidence remains relevant: 60 ready
live callbacks admit 60 draws; paused/photo callbacks admit 15; GPU-busy
callbacks admit none while service continues. Those counts are scheduling
contracts, not GPU time, hardware latency, or frame-rate measurements. This
assignment did not rerun that unchanged full pacing group or claim new timing
results. No concrete additional free-roam repair was established.

## Validation executed

No package lifecycle hook, asset generator, browser launch, full compiler/build,
Git mutation, or timing benchmark was run by this assignment.

Before the production repair, the focused cross-mode execution completed with
**18 passed / 6 failed**. All six failures are the intended new assertions,
not import, compiler, or fixture-initialization errors.

After the repair, this direct command passed:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-cross-mode-startup.test.ts \
  tests/engine-page-lifecycle.test.ts \
  tests/circuit-startup-settlement.test.ts \
  tests/festival-host-startup.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 --reporter=dot
```

Result: **91 tests across four files, all passed**. This includes 24 cross-mode
startup cases, 28 retained-page cases, and 39 circuit/Festival startup settlement
cases. There were no retries or omitted failed cases.

Scoped ESLint on the two changed TypeScript files passed, as did the scoped
`git diff --check`.

Prettier reports style warnings for both files. A direct Prettier API check of
their exact `714632a` Git blobs also reports both unformatted before this repair.
The patch retains the narrow existing host style rather than reformatting the
large host and preexisting fixture. This is a disclosed preexisting formatting
result, not a passed formatting gate. The report itself is formatted separately.

Local logs are retained at:

- `/tmp/aeebac160835-engine/validation/w08f-startup-before.log`
- `/tmp/aeebac160835-engine/validation/w08f-startup-after.log`

| Tested artifact                           | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `src/main.ts`                             | `d4131727c5cea898728eee4d87a4bf512295e056b0cfa69f73fafb2905b78537` |
| `tests/engine-cross-mode-startup.test.ts` | `af8f2d0d89b4fad418facc4e5ebbf770515cf5f108bfa873e44c85aa60080cfe` |
| Before log                                | `a1097ce450fadede2a0aa96578a3770b63676bd4c167f1ea9ef68e558891c8c5` |
| After log                                 | `87e2d4c4f5ea49d2f7a279e4b1495ae9892af3392aa799406dfbeae2f70456f0` |

## Source and evidence references

- [W02D startup admission](w02d-startup.md)
- [W04B retained-page design](w04b-page-lifecycle.md)
- [W04D shared GPU ownership](w04d-shared-gpu-ownership.md)
- [W04E Festival pacing](w04e-festival-frame-pacing.md)
- [W05D device/host composition](w05d-device-lifecycle-composition.md)
- [W06B native history restoration](w06b-native-page-history.md)
- [Exact-source 6cb1c88 CI](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45585197376)
- [Preserved 6cb1c88 result](evidence/checkpoint-6cb1c88/result.json)

The preceding exact-source checkpoint passed 820 focused unit tests, full
TypeScript checking and its production build, with 46 of 47 native browser/replay
cases passing. Its remaining GPU full-image assertion is independently isolated
to a native `vec3` shader path on ANGLE/Mesa llvmpipe. This review neither repairs
nor reclassifies that raster failure. Software-renderer evidence does not certify
physical graphics, audio, or controller hardware.

## Handoff

Released to the coordinator: `src/main.ts`, the existing
`tests/engine-cross-mode-startup.test.ts`, and this report. The next source freeze
must include these exact tested files before aggregate and native CI acceptance.
No model, character, environment, authored asset/shader, vehicle definition,
handling constant, dependency, persisted schema, or wire format changed.
