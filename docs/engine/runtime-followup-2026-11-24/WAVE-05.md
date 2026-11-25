# Wave 5: integration across engine owners

All six workers completed. This wave composes production components so their individual contracts are tested at session and message boundaries.

## Circuit worker failure ownership

Every circuit worker error already terminates its host session. The worker now enforces that contract itself: queued resume/input/command messages cannot revive partially changed state, and pending rewind work is cleared. A successful fresh initialization restores a paused simulation. Matching engineering and surface receipts may retire old ownership while failed, without generating new state or preventing future initialization.

Nine new actual-worker cases cover mutating command failures, completed-tick failures, duplicate and active rewinds, failed rewind publication, retained acknowledgement credit and one-shot input after recovery. Together with diagnostics, input, controller and rewind suites, **67 distinct tests passed across five files**.

## Final network boundary and record verification

A send failure during the final scheduled snapshot could disconnect a client after the last physics step. That stamped a takeover for the next step, at the record's exclusive end tick, and made the resulting archive fail its own verifier.

`createRecord()` now trims only the unsimulated current-tick journal suffix. It preserves the live journal, earlier takeovers, the existing format/version and strict corruption checks. Tests verify the full re-simulation, including failures before and exactly at the final boundary, with and without a throwing close callback. Future-dated and unordered entries still fail verification. A linked two-client trace also covers loss, duplication, reordering, a 500 ms blackout, prediction, one-shot shifts and AI handback. **41 tests passed across four files**, including six new cases.

## Replay, telemetry, ghosts and resimulation

A double-precision flashback receipt was compared directly with Float32 pose timestamps. In the real seeded reproduction, tick 40 has completion time `6.180847637805483` while its pose stores `6.180847644805908`. The selected row could therefore be lost or its page rejected. Pose and page comparisons now use the stored Float32 domain; weather-surface cutoffs remain full precision. Negative and nonfinite cutoffs remain invalid.

Seven new cases combine actual Simulation, InputLog, Resimulation, telemetry ring overwrites, transferred replay pages, resumed branches and ghost persistence/playback. Four cases failed before the fix. **95 tests passed across six files**.

## Festival host and worker handoff

A throwing error toast could leave SessionStartOwner retaining an already-disposed Festival session. Error reporting now guarantees the host exit is attempted. Local disposal and command rejection occur first and retain the original error.

The complete production FestivalSession and worker are connected through asynchronous structured-clone queues to the real startup owner. Seven new cases cover travel publication order, status-capacity rejection and recovery, consumer/reporting/exit failures, cancellation/replacement and late confirmations after timeout. **53 tests passed across three files**.

## Audio, controls and haptics

Five new composition cases connect real InputController, RacingAudio, Rumble and the production input-pump/host callbacks. They cover blur and hidden-tab suspension, delayed activation, held-button baselines, device replacement, stale haptic rejection, mute between queued shifts and intentional paused previews. **54 tests passed across four files**. No further production change was justified by those cases. Native waveforms and physical device behavior are separate validation scopes.

## Mixed texture ownership and renderer disposal

A throwing texture-disposal listener could prevent later imported and generated wrappers from restoring their original sources while renderer teardown continued. Both texture budgets now retire the closing batch before callbacks, restore each source in a finally block, complete independent cleanup and then rethrow the first value (including undefined). They remain reusable.

Five new composition cases use the actual renderer disposal method, both budget classes, Three textures/events and an OutputPass material. Four cases failed before the fix. Old-source disposal ordering, foliage mipmap restoration, streaming removal/re-registration, repaint and quality changes are covered. **35 tests passed across six files**. Native GPU allocation counts are measured separately.

## Verification limits

Focused suite totals overlap and are not a unique aggregate. Scoped ESLint and whitespace checks passed for each completed assignment. Browser, full compiler/build and protected-content verification are tracked in later waves and checkpoint evidence. No game content, vehicle tuning or authored models/environment definitions were changed.

## Combined checkpoint gate

The project compiler passed across 2,359 tracked/staged TypeScript paths at a 4,096 MB heap limit; scoped ESLint passed for all 30 changed TypeScript files. Native Wave 6 additions were excluded from this checkpoint gate and are validated separately. An existing reference-review JSON fixture omitted by the sparse checkout was restored byte-for-byte from Git for the compiler; its blob hash is unchanged. The only compiler corrections were a nullable test-host annotation, with no runtime behavior change.

The direct production Vite build passed in 13.40 seconds, including its IP guard. Asset-generation hooks were not invoked. The existing large-chunk warning remains; no warning threshold was relaxed.
