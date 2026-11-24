# Agent 26 — power-unit audio cadence

Wave 5, agent 26 of 60. The implementation is complete and available for root review. All changes remain unstaged; the existing staged agent-21 snapshot was not modified.

## Result

The power-unit scheduler now retains elapsed time for continuous update intervals through 0.5 seconds. The constant 14-event/second APX trajectory at 5 Hz now schedules 140 crackles in 10 seconds, versus the audit's former 70. Counts at 5, 10, 30, and 60 Hz differ by no more than one event. Exact previous event times, gains, and filter frequencies remain unchanged at 10, 30, and 60 Hz in the frozen ordinary-scheduling reference.

The production change is restricted to update-time handling and its documented continuity constant in `src/audio/power-unit.ts`. Vehicle sound profiles, synthesis, gains, frequencies, noise buffers, random seeds, and the transient-ownership implementation from agent 21 are preserved. No character models, other 3D models, environments, assets, or content definitions were changed.

## Timing policy

| Input condition | Result |
| --- | --- |
| First valid update | Establish the supplied-time baseline; no elapsed-time crackle catch-up. |
| Forward interval through 0.5 s | Account for the entire interval. Crackle phase carries fractional events across calls. |
| Nominal 0.1 s interval | Preserve the old cap only within timestamp subtraction roundoff, retaining the exact seeded 10 Hz schedule. |
| Repeated timestamp | Accumulate no elapsed-time crackles. Existing gear-change behavior and live ownership limits remain active. |
| Backward timestamp or interval greater than 0.5 s | Use the existing reset lifecycle to release old transient voices, cancel shared-filter future automation, and discard old fractional phase and gear history. Rebase at the supplied time without creating old crackles or a stale shift crack. |
| Negative or nonfinite timestamp | Reset using the valid device clock and return before supplying invalid times to any AudioParam or source. The next valid update establishes a new baseline. |
| Discontinuity cleanup disposes the graph reentrantly | Return without reopening scheduling. |

The continuity threshold deliberately supports sustained 2 Hz updates and faster, including the defective 5 Hz case. Arbitrarily slow updates are not preserved: intervals greater than 0.5 seconds are treated as a presentation discontinuity. At the highest current authored rate of 14 crackles/second, a continuous update can emit at most seven crackles plus one gear-change burst. A discontinuity emits neither.

The original jitter law remains `time + random.next() * dt`; normal-cadence random draws, gains, and frequencies are unchanged. The timestamp-roundoff allowance only preserves prior behavior at the old 0.1-second boundary. It does not restore the old elapsed-time loss for genuinely longer intervals.

Offline rendering remains uncapped and uses supplied continuous timestamps to preschedule a complete render while actual device time is zero. The new offline 5 Hz fixture owns all 140 scheduled voices until reset; agent 21's existing 200-future-shift fixture still passes. Offline discontinuities use the same timeline-reset policy. Live playback still caps owned voices at 64 before allocation, even if supplied time advances while the device clock is frozen. Actual audio time remains the authority for natural voice expiry.

## Tests and fixture changes

Added `tests/power-unit-cadence.test.ts` with 22 passing cases covering:

- Constant-trajectory 5/10/30/60 Hz counts and bounded live ownership.
- Four fixed cadences and a mixed cadence across a piecewise RPM trajectory; event counts stay within one of the independently specified time-weighted integral.
- The 0.5-second boundary, including seven crackles plus an optional shift burst.
- Repeated timestamps, live frozen-device caps, and complete offline 5 Hz prescheduling.
- Gaps just beyond the threshold, multisecond gaps, a minute-long gap, and an extreme finite timestamp without backlog or stale shifts.
- Reset cancellation of future voices and shared-filter automation, disconnection of owned branches, and harmless late ended callbacks.
- Fresh fractional phase after resume, backward-clock rebasing, negative/nonfinite clock rejection, and disposal during reset callbacks.

Two existing fixture changes were approved by root:

1. Removed only 5 Hz from the frozen **legacy-equality** scheduling matrix, with an explicit source comment pointing to the new cadence suite. The old 5 Hz equality asserted the precise elapsed-time defect being fixed. New tests replace it with the correct full-rate, ownership, and offline assertions. The 10/30/60 Hz legacy references and their ownership assertions remain unchanged.
2. The past-scheduled-source ownership fixture now supplies continuous timestamps around 1 s while actual device time advances through 2–2.03 s. Its original start-time and actual-playback-expiry assertions remain intact. This isolates the intended expiry behavior from the newly explicit greater-than-0.5-second discontinuity policy, which is covered separately.

## Verification

All checks used the shared test lock and a 512 MB Node heap; Vitest ran with one worker. No npm lifecycle hooks or full TypeScript build were invoked.

Initial focused run: **83/83 tests passed** across six suites: cadence (21 at that point), transient lifetime (27), power-unit audio (4), racing audio lifetime (19), sound profiles (6), and airborne audio (6). After extending the continuity-boundary fixture to assert the simultaneous shift maximum, the final cadence suite passed **22/22**. Thus the final suite set contains 84 verified cases: the final 22 cadence cases and 62 unchanged passing cases in the other five suites.

Commands:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/vitest run tests/power-unit-cadence.test.ts tests/power-unit-voice-lifetime.test.ts tests/power-unit-audio.test.ts tests/racing-audio-lifetime.test.ts tests/sound-profiles.test.ts tests/airborne-audio.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/vitest run tests/power-unit-cadence.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prettier --write src/audio/power-unit.ts tests/power-unit-cadence.test.ts tests/power-unit-voice-lifetime.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/eslint src/audio/power-unit.ts tests/power-unit-cadence.test.ts tests/power-unit-voice-lifetime.test.ts
git diff --check -- src/audio/power-unit.ts tests/power-unit-voice-lifetime.test.ts tests/power-unit-cadence.test.ts
```

Scoped ESLint and whitespace checks passed; Prettier completed. This verification records scheduling and ownership behavior with the existing fake Web Audio implementation. It does not claim browser listening or waveform quality evaluation.

## Integration

Files for root to review and stage in the later cadence batch:

- `src/audio/power-unit.ts`: the unstaged timing delta above agent 21's already staged ownership implementation.
- `tests/power-unit-cadence.test.ts`: new unstaged test file.
- `tests/power-unit-voice-lifetime.test.ts`: the approved unstaged fixture changes above agent 21's already staged test snapshot.

At handoff, Git reports `MM`, `??`, and `AM` for those respective files, consistent with preserving root's staged agent-21 snapshot. No staging, commit, push, dependency change, or unrelated edit was performed.
