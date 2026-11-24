# Agent 05 — input and audio runtime audit

Scope: read-only inspection of `src/input` and audio engine/mixer/spatial scheduling. No source, tests, git state, assets, sound profiles, presets, gains, models, characters or environments changed. Findings were reproduced with inline `node --no-warnings --experimental-transform-types --input-type=module` programs importing production modules and the existing `tests/fake-audio.ts` recorder. No full TypeScript build was run.

## 1. Active-controller replacement bypasses the device-loss safety transition

**Priority:** high; isolated implementation scope: `src/input/controller.ts`, with controller lifecycle regression coverage.

`InputController.update()` checks `!pad && this.lastDevice` before calling `observeButtons()`. With default automatic selection, `selectDevice()` immediately returns another connected standard pad when the previously selected pad disappears. A non-null replacement therefore bypasses `deviceFault()`. `observeButtons()` silently replaces the identity; only button edges get baselined, while the replacement's held pedals take effect immediately. A delayed disconnect event for the previous pad is then ignored because `lastDevice` already names the replacement.

**Measured reproduction:** start with standard pads 0 and 1 connected, allow pad 0 to become the active device, hold pad 1's mapped throttle button at 1, replace the polled list with `[null, pad1]`, then call `update(.016)`. Output was:

```json
{"throttle":1,"device":"Audit pad 1","actions":[]}
```

**Required behavior:** an identity change after an established active device must take the same neutralization and device-loss path as a missing device before another pad can drive. Keep initial automatic acquisition and explicit settings selection working.

**Tests:** selected pad disappears while a second pad remains connected with throttle/steering held; assert neutral state and exactly one `deviceLost`. Dispatch the old pad's disconnect event after the replacement poll; ensure it cannot bypass the safety transition or emit duplicates. Cover clean acquisition after explicit resume/reselection and initial acquisition without a previous identity. This is separate from the already identified worker shift-edge loss.

## 2. Pending power-unit events survive presentation reset

**Priority:** medium; isolated scope: scheduled source ownership inside `src/audio/power-unit.ts` plus focused fake-audio tests.

`PowerUnitAudio.pop()` creates a buffer source and a per-event gain, schedules its start, and relies solely on `onended` to disconnect them. Neither source nor event gain is tracked. `reset()` only clears bookkeeping and fades the shared output. A subsequent update reopens that output, permitting an already scheduled pre-reset pop to play in the new presentation. `dispose()` also leaves these source branches unstopped and connected until natural completion.

**Measured reproduction:** a maximum-crackle frame at audio times 0 and .1 scheduled a source at **0.16721548994537444**. `reset()` at .1 followed by an update with zero crackle at .125 left that old source with **zero stop calls** and **one connection**. Output gain was targeted to 0 at .1 and reopened to 1 at .125. The old source remained unstopped/connected after `dispose()` as well. This establishes that a quick seek/reset/resume can present an event from the preceding presentation. These are scheduling events; no loudness or sound design changes are needed.

**Required behavior:** own every transient source/gain pair; detach and stop pending/active pairs on reset and disposal; remove completed pairs on `onended`. Make cleanup idempotent and safe if an ended callback arrives afterward. Bound transient ownership by event lifetime and scheduling horizon.

**Tests:** reproduce the future-start timeline above; assert reset cancels the old source before the new output opens, and a fresh event still works. Assert disposal empties event ownership and releases each event pair, including delayed callbacks. Exercise overlapping shift and crackle events without altering the shared graph's normal routing.

## 3. Continuous low update rates reduce the scheduled crackle rate

**Priority:** medium; independent timing scope in `PowerUnitAudio.update()`, after event ownership is fixed.

`dt = clamp(time - lastTime, 0, .1)` discards elapsed audio time on every update below 10 Hz, including a steady low frame rate rather than an isolated stall. `RacingAudio.update()` is driven from presentation calls (`src/main.ts` / `src/session/free-roam.ts`), so slow rendering changes event frequency. This is not merely a small floating-point discrepancy.

**Measured reproduction:** constant frame requesting 14 events/s, initialized at t=0 and updated through exactly 10 seconds:

| Update frequency | Emitted bursts | Requested rate |
|---|---:|---:|
| 5 Hz | 70 | 14/s |
| 10 Hz | 139 | 14/s |
| 30 Hz | 140 | 14/s |
| 60 Hz | 140 | 14/s |

**Required behavior:** preserve elapsed time for continuous low-frequency presentation while retaining a bounded discontinuity/stall policy. Separate sustained scheduling cadence from handling a long resume gap. A bounded maximum per update or independent audio scheduling clock can preserve the existing nominal event rate without changing any preset or gain.

**Tests/measurement:** replay the same 10-second control trajectory at 5/10/30/60 Hz and require the event total to agree within the single-event boundary tolerance. Separately inject a multi-second suspension and assert no unbounded catch-up loop, stale events, or allocation burst. Track maximum simultaneously owned transient voices once scope 2 introduces ownership.

## Audit limits and existing strengths

SpatialAudioScene already uses fixed-size source/selection buffers and a four-voice selection pass. No evidence here supports a new spatial-source memory leak. The report does not propose changing calibration semantics or sound tuning. The inline audio recorder verifies source scheduling and graph ownership, not an audible waveform; a short browser or offline-audio check is appropriate after implementation. Two of the findings are functional transitions, and the third has an explicit cadence measurement rather than an asserted performance benefit.
