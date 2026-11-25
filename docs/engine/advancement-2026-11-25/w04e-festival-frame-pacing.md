# Assignment 23/60 — Festival frame pacing

Wave 4. Implements the Festival scheduling boundary identified in `audit-rendering.md` and the rendering handoff in `audit-runtime.md`. Shared GPU fence ownership and renderer submission transactions belong to Assignment 22; page lifecycle ownership from Assignment 20 is preserved.

## Changes and ownership

`src/session/free-roam.ts` now separates presentation admission from its per-callback HUD, control and audio servicing:

- A visible callback polls `FestivalRenderer.canSubmitFrame()` before sampling the live presentation clock or updating riders and traffic. The renderer remains the authority for shared context ownership and checks admission again inside `draw()`.
- Live driving has no added cadence limit. Paused and photo presentation use the existing circuit policy of 15 Hz. First presentation, state transitions and explicit redraw requests bypass cadence, while still requiring GPU readiness. A one-millionth millisecond comparison tolerance prevents binary floating-point timestamps from accidentally dropping an exact 15 Hz boundary.
- The last submitted timestamp advances only when `draw()` returns `true`. GPU and idle deferrals retain elapsed wall time. The existing 0.08-second renderer delta cap is unchanged; simulation time and sampled poses still come from the real `LiveFrameClock`.
- Resize, camera changes, photo entry/exit/angles, active photo pointer/wheel input, lighting and reduced-motion changes request presentation. Revision receipts commit only after successful submission. A newer resize requested during a draw survives that older submission. Backend resizing is deferred until GPU admission, and a declined draw retains its resize receipt.
- Skipped draws retain the last valid presented pose for HUD and audio. HUD gamepad polling, control synchronization and audio pause/hidden-state servicing continue on every eligible callback. Cabin navigation texture work follows submitted draws.
- Hidden callbacks skip GPU admission and presentation, while retaining the service pump. An owned `visibilitychange` listener resets wall timing even if the browser delivers no hidden RAF. Visible return begins with a fresh delta. Fast travel and persisted page suspension also invalidate the submission baseline without changing their existing pause, input or page-epoch contracts.
- The frame captures renderer, HUD, controls and page epoch. It rechecks ownership after child calls, especially the external HUD and control callbacks. Disposal, travel, page suspension, a suspend/resume epoch change or replacement of a child ends the old callback before later navigation/audio work.
- Readiness or submission exceptions use `FestivalSession.fail(error, true)`, releasing the session through its existing fatal lifecycle. Error reporting exceptions still propagate after the `finally` exit path; failed GPU ownership is never treated as readiness.

No renderer or `main.ts` edits were made by this assignment. No models, characters, environments, geometry, materials, shaders, content, assets, quality settings or simulation tuning changed.

## Exact controlled-callback evidence

The new `tests/engine-festival-frame-pacing.test.ts` extracts and executes the **complete production FestivalSession class**, including its actual constructor, frame, pause, page, travel, failure and disposal methods. It uses the real `LiveFrameClock`, `PresentedFrame` and `FestivalControls`. GPU submission, worker transport, HUD and audio boundaries are observable doubles; the scheduling decision is not copied into the test.

The cadence fixture calls `frame(i * 1000 / 60)` for `i = 0..59`, starting at 0 ms and ending at approximately 983.333 ms. Its readiness probe has no internal extra renderer poll.

| Scenario, 60 callbacks | Successful draws | Session readiness polls | Live-clock samples | Rider updates | Traffic updates | HUD updates | Control syncs | Audio updates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Live, ready | 60 | 60 | 60 | 60 | 60 | 60 | 60 | 60 |
| Paused, ready | 15 | 60 | 15 | 15 | 15 | 60 | 60 | 60 |
| Photo, ready | 15 | 60 | 15 | 15 | 15 | 60 | 60 | 60 |
| Live, GPU busy | 0 | 60 | 0 | 0 | 0 | 60 | 60 | 60 |
| Paused, GPU busy | 0 | 60 | 0 | 0 | 0 | 60 | 60 | 60 |

The prior rendering audit's paused/busy fixture recorded **60 draws and 0 readiness polls**, with 60 HUD/control/audio calls. These results establish deterministic scheduling and service responsiveness. Session readiness-probe counts are **not** native `clientWaitSync` counts: the real renderer has its own safety check, and the shared gate polls a GL sync only when one exists. The 15-versus-60 draw result is not an FPS, GPU duration, energy or native backlog measurement.

Additional executed cases cover:

- A four-callback interval retaining a 4/60-second draw delta, with rider/traffic interpolation using the exact production sampled pair and auxiliary frames. Mutating original received buffers after observation cannot alter their retained presentation copies.
- A long GPU stall preserving absolute simulation time near 100 seconds, admitting no extrapolated pose, bounding the eventual draw delta at 0.08 seconds, and returning to a normal 0.016-second delta afterward.
- Pause, photo and resume transitions drawing at the next eligible callback, including the exact measured pause snapshot.
- GPU-busy resize, a `draw() === false` refusal, subsequent successful resize/draw, and a newer resize raised during submission. Deferred callbacks still service HUD/control/audio.
- Camera/photo/reduced-motion invalidation and active photo pointer/wheel requests persisting until GPU admission.
- Hidden callbacks, a hidden interval with **no** RAF, persisted suspension/resume, and real command-confirmed travel, each restoring a fresh presentation baseline.
- HUD exit while ready and while busy; real HUD-triggered travel; synchronous page suspend/resume during HUD polling; actual control callbacks disposing or suspending the session; replacement of the control owner.
- Readiness/submission failures releasing resources, and a throwing error reporter still executing the exit path.

The existing real-HUD adversarial fixture was changed only to provide `canSubmitFrame: () => true` and a successful boolean `draw()` return. Its actual gamepad EXIT path remains covered. No other existing Festival fixtures needed changes.

## Validation

Direct commands, bypassing npm hooks:

```sh
./node_modules/.bin/vitest run tests/engine-festival-frame-pacing.test.ts tests/engine-worker-session-adversarial.test.ts tests/festival-session-lifecycle.test.ts tests/engine-page-lifecycle.test.ts --maxWorkers=1 --reporter=dot
./node_modules/.bin/eslint src/session/free-roam.ts tests/engine-festival-frame-pacing.test.ts tests/engine-worker-session-adversarial.test.ts
```

Final focused run: **4 files / 96 tests passed**, 9.73 seconds. Scoped ESLint completed with exit code 0 and no findings. The shared workspace's current page-lifecycle and renderer changes were present during this run.

Native GPU/browser evidence remains assigned to wave 6. No local browser access bypass was attempted. This assignment did not run npm hooks, a full build, asset generation, Git commands, commits or remote writes.

## Release

Released to the coordinator: `src/session/free-roam.ts`, `tests/engine-festival-frame-pacing.test.ts`, the two renderer-stub lines in `tests/engine-worker-session-adversarial.test.ts`, and this report. Assignment 22's `canSubmitFrame(): boolean` and `draw(...): boolean` contract is required.
