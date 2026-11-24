# Agent 21 — power-unit transient voice lifetime

Date: 2026-11-24. Wave 4. Ownership scope: `src/audio/power-unit.ts` and new `tests/power-unit-voice-lifetime.test.ts`.

## Result

Pending and active gear-change/crackle source-gain pairs now belong to the current PowerUnitAudio lifetime. Reset and disposal revoke that ownership, stop scheduled/active sources, clear ended handlers, and disconnect both nodes. A late or repeated ended callback cannot release a replacement voice. Natural completion retires ownership without unnecessarily stopping the finished source.

The audit's exact future-start event at `0.16721548994537444` is now cancelled by a reset at `0.1`, before a new presentation opens at `0.125`. Reset also cancels future shared bandpass-frequency automation from those old events. New events still use the unchanged shared graph and their original gains, frequencies, seed, and scheduling formula.

No sound profiles, gains, noise samples, frequencies, model/character assets, environment definitions, vehicle tuning, dependencies, or other production files were edited. No commits, refs, pushes, or asset generation were performed.

## Bounded live ownership and offline compatibility

A voice's expiry uses the actual rounded buffer duration, `ceil(sampleRate * 0.03) / sampleRate`, after the later of its requested start and actual audio time. Updates retire expired records even when `ended` delivery is delayed. Supplied future timestamps do not prove that playback has finished.

Realtime playback retains at most **64** transient source/gain pairs. When that reserve is full, a new event is dropped before allocating either node. This protects a suspended/frozen audio clock from repeated same-time updates. Accepted voices remain intact, and advancing audio time releases expired slots. The original ordinary event schedule remains unchanged below the bound.

The production offline measurement rig intentionally schedules an entire finite render while `currentTime` remains zero. It already distinguishes offline contexts by the presence of `startRendering`. The same distinction preserves that supported use: the realtime cap does not truncate an offline plan, and future supplied timestamps do not prematurely disconnect its voices. Offline plan retention is proportional to the number of planned events until rendering completes or reset/dispose cancels the plan; it is **not** claimed to have the realtime 64-voice bound. A 200-event offline regression proves that the complete future sequence remains scheduled and can be cancelled cleanly.

## Failure and terminal behavior

Each source enters ownership before fallible handler/buffer/gain/connection/event/start setup. A setup failure releases every allocated branch and preserves the original exception. Partial starts receive a best-effort stop. Transient cleanup continues after independent stop/disconnect failures; local ownership remains terminal even if a device refuses cleanup.

Reset blocks reentrant scheduling until cleanup completes. Disposal marks the instance terminal before releasing its graph; subsequent updates, resets, disposals, and old callbacks are inert. Fixed-graph disposal now attempts all oscillator/node releases before reporting its first failure. Reset similarly attempts output cancellation/fade even if filter cancellation fails, then reports the first failure.

Actual device reclamation cannot be guaranteed when a Web Audio operation itself refuses cleanup. The tests establish local ownership and independent cleanup attempts, not hardware resource behavior.

## Verification

All **63/63 tests** passed across five suites:

| Suite | Passed |
| --- | ---: |
| New power-unit voice lifetime | 28 |
| Existing RacingAudio lifecycle | 19 |
| Existing power-unit mix | 4 |
| Existing sound profiles | 6 |
| Existing airborne audio | 6 |

The new cases cover the audited reset timeline; overlapping shift/crackle events; normal and delayed completion; exact duration rounding; past-scheduled immediate starts; the realtime reserve under 1,000 frozen-clock updates; complete offline pre-scheduling; idempotent disposal; delayed callbacks; three independent transient cleanup failures; failed filter cancellation; failed oscillator disposal; 1,000 reentrant reset generations; nine partial-setup/start failure points; and exact baseline event times, gains, and filter values at 5, 10, 30, and 60 Hz.

Focused command, run under the shared lock:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/power-unit-voice-lifetime.test.ts tests/power-unit-audio.test.ts tests/racing-audio-lifetime.test.ts tests/sound-profiles.test.ts tests/airborne-audio.test.ts --pool=threads --maxWorkers=1
```

Vitest completed in 5.73 seconds. Scoped ESLint passed for both owned files. Prettier formatting and scoped `git diff --check` passed.

## Handoff and limits

The existing `dt = clamp(time - lastTime, 0, 0.1)` expression and crackle accumulation loop are deliberately unchanged. Agent 24 owns the separately audited sustained-low-cadence scheduling repair. Event totals at low cadence remain the old behavior in this assignment; the reference comparisons prove preservation rather than claiming that timing defect is fixed.

Verification used the production graph with controlled Web Audio recording doubles, including the actual dirt-bike simulation in the existing airborne suite. No full-project TypeScript check, real browser/offline waveform render, audible quality measurement, or FPS claim was made. Root owns the project compiler/build and final integration gates.
