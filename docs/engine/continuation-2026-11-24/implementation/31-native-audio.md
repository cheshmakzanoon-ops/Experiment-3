# Agent 31 — complete audio reset ownership and native Web Audio gate

Wave 6, agent 31 of the requested 60. The coordinator's integration review identified a remaining fixed-graph automation gap in audio reset. This agent reproduced it, implemented the narrow repair, and added both scheduling regressions and three native audio rendering tests. **All 98 focused unit tests pass. The three native browser tests are compiled and bundled, but their remote execution remains pending.**

## Defect and production repair

`PowerUnitAudio.update()` schedules future frequency and gain targets on its turbo, transmission-whine and electric-motor branches. Reset already retired transient sources, cancelled the shared burst filter, and faded the output. It did not cancel the six fixed-graph parameter timelines. Reopening the output for a replacement presentation could therefore make previously scheduled RPM/load/profile targets audible again.

A loaded timeline alternating the existing APX-01 combustion and EH3 electric profiles reproduces that ownership error. Before the repair, all six targeted regressions fail: each parameter retains eleven scheduled targets after reset. This is scheduling evidence, not a claim that fake audio nodes rendered a waveform. The matching native integration test provides the separate output-level gate.

The production change adds cancellation of those six AudioParams at **actual native device time** inside the existing independent cleanup loop. It preserves the current oscillator state, the 20 ms output fade, first-error reporting, continued cleanup after an independent cancellation error, and retry behavior. It does not reset oscillator phase, force immediate gain jumps, alter cadence, change sound profiles or modify synthesis.

Changed source: `src/audio/power-unit.ts`, nine added lines in `reset()` (six cancellation calls and their explanation).

## Scope and files

Added:

- `tests/power-unit-reset-automation.test.ts` — 14 focused scheduling and failure-boundary regressions.
- `e2e/engine-native-audio.spec.ts` — three native browser tests.
- `e2e/fixtures/engine-native-audio.ts` — real OfflineAudioContext rendering fixtures.

Updated `.github/workflows/engine-runtime-validation.yml` only to include the new native spec and fixture in its path triggers and the new spec in the existing exact-source browser command. Existing lifecycle/replay browser tests and their assertions remain unchanged.

No sound profile, gain, synthesis parameter, seed, model, character, environment, asset, vehicle calibration or dependency changed. Existing agent21/26 voice ownership and cadence changes are preserved. The only production change in this agent's assignment is the reset repair described above.

## Native behaviors under test

All contexts, audio nodes, parameters, sample buffers, rendering and `ended` events are real browser Web Audio objects. The fixture uses isolated `OfflineAudioContext` instances at 48 kHz and a routed blank page. It does not need application assets, a microphone, a physical audio device, an existing browser profile, or audible playback. A narrow read-only inspection of the engine's voice set exposes ownership counts; it does not replace native nodes or their cleanup handlers.

### Complete low-rate scheduling

The first test preschedules ten seconds at both 5 Hz and 60 Hz while native device time is zero, then renders the entire schedule plus a 0.4-second tail. The 5 Hz schedule must retain and render all 140 crackles, and the 60 Hz schedule must contain 139–140 events, reflecting the documented fractional accumulator roundoff. Every owned source receives an additional native `ended` event listener without replacing the engine's `onended` handler. Rendering and all expected native events are awaited before requiring zero remaining owners.

To prove that late crackles actually reach the rendered output, a third native render uses the same 5 Hz schedule, load, road speed, gear and fixed-oscillator targets with RPM below the overrun threshold. The test subtracts this otherwise identical no-crackle signal from the full signal. Each one-second window starting at seconds 6, 7, 8 and 9 must contain transient RMS above `0.00001`. Constant transmission whine therefore cannot conceal a scheduling cap that loses events after the first 64 voices.

The test also requires finite sample output, the requested sample length, a nontrivial peak, and no clipping in these chosen fixtures. It does not compare 5 Hz and 60 Hz waveforms; their event jitter schedules are intentionally different. It asserts count consistency and complete native playback rather than subjective sound quality.

### Reset and replacement timeline

The second test preschedules ten alternating shift impulses while varying RPM, torque, road speed and the existing combustion/electric profiles. This deliberately creates materially different old targets on all fixed branches. Reset occurs before rendering, with native `currentTime` still zero; no old oscillator phase has advanced. Reset must immediately remove old transient owners and release their handlers, and rendering the cancelled plan must produce exact silence.

A separate reset graph then receives one new upshift at 0.19 seconds with zero road speed and negative engine torque. A fresh graph receives exactly that same replacement timeline. Its fixed-oscillator gains are zero. The two 48 kHz Float32 signals must agree sample for sample and contain a nonzero impulse.

This checks two independent old-timeline hazards. The old downshift at 0.2 seconds would otherwise change the shared filter while the new impulse is audible. The old loaded fixed-graph targets would also reopen turbo, whine and electric-motor sound after the replacement presentation makes output audible. The exact comparison is valid because both graphs have rendered nothing before the reset boundary and begin the replacement with the same oscillator phase. It is a same-browser comparison, without a platform-dependent prerecorded waveform golden.

### Terminal disposal

The third test preschedules ten shifts, disposes twice, then calls reset and update again. Ownership must stay zero, the cumulative burst count must remain unchanged, and a native render must be exactly silent. This verifies actual output disconnection and terminal scheduling, not only recorded calls on mocked nodes.

## Regression and local validation results

The new unit suite contains 14 cases:

- Six parameter-specific old-future-timeline cancellations, followed by a new independently owned target.
- Six injected cancellation failures proving that every other independent parameter is still cancelled, the output fade still runs, transient branches are retired, and a later reset can retry.
- Device-time cancellation at 0.25 seconds preserves already-started targets, cancels only the future, and retains the existing fade without immediately changing the output value or stopping oscillators.
- A presentation discontinuity removes old future targets before scheduling the new timeline.

The pre-repair reproduction ran the first six cases: **6 failed, 8 intentionally skipped**, with the uncancelled targets recorded in `31-reset-before.log` in the coordinator's reports directory. After the repair, the complete seven-suite run passed **98/98 tests**, including all **14 new cases**: reset automation 14, cadence 22, transient lifetime 27, power-unit audio 4, racing audio lifetime 19, sound profiles 6 and airborne audio 6. This is one actual combined run, not a sum of overlapping retries.

All heavy checks used the shared `/engine-work-4e0075ccccb3/test.lock` and a 512 MiB Node heap; Vitest used one worker. No npm lifecycle hook, browser launch, asset generation or full-project build was run by this agent.

Also passed:

- Prettier on all four owned TypeScript files and the narrowly changed workflow.
- Scoped ESLint on the source, new unit test, new native fixture and new spec.
- Strict scoped TypeScript compilation of those four files and their imports.
- Browser-targeted esbuild IIFE bundling: **171,465 bytes; zero warnings**.
- Scoped `git diff --check`.

Commands:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/power-unit-reset-automation.test.ts --maxWorkers=1 -t 'cancels the old future'
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/power-unit-reset-automation.test.ts tests/power-unit-cadence.test.ts tests/power-unit-voice-lifetime.test.ts tests/power-unit-audio.test.ts tests/racing-audio-lifetime.test.ts tests/sound-profiles.test.ts tests/airborne-audio.test.ts --maxWorkers=1
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/audio/power-unit.ts tests/power-unit-reset-automation.test.ts e2e/engine-native-audio.spec.ts e2e/fixtures/engine-native-audio.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node src/audio/power-unit.ts tests/power-unit-reset-automation.test.ts e2e/engine-native-audio.spec.ts e2e/fixtures/engine-native-audio.ts
```

The bundle uses the same esbuild entry point, IIFE global name, browser platform and ES2022 target as the spec's `beforeAll` hook. The coordinator can execute the three native tests through the now-updated focused workflow's existing Chromium/Mesa environment.

## Required remote gate and limits

The local environment does not authorize the Unix socket used by Chromium's process-singleton setup. The coordinator supplied that already-established limitation, so this agent did not attempt another local browser launch or bypass the restriction. GitHub CI provides the intended native execution environment.

The remote gate must confirm all three new tests against the published source. A compilation result and a recorded scheduling test are not native Web Audio waveform evidence. If an assertion fails remotely, preserve its JSON/Playwright artifact and investigate native behavior before changing either production behavior or an exact assertion. No claim is made here about real-time physical audio hardware, subjective mixing, listening quality, or all browser engines.

Source SHA-256 at handoff:

| File | SHA-256 |
| --- | --- |
| `src/audio/power-unit.ts` | `c1ceeaae3bb91d6df405a056b854a2f86d21067a05076a8769a5f8aa8d0e4980` |
| `tests/power-unit-reset-automation.test.ts` | `74969a8dd754ff8db31707b89013d2491cafeb18bca9c952deecde4deea1f79c` |
| `e2e/engine-native-audio.spec.ts` | `0f0270f0b9b865f74e1f4596cb101981aa3a84fa0f8285e021a51170d0fc3e43` |
| `e2e/fixtures/engine-native-audio.ts` | `f1f041dc8bccd16682e58d6302b94648ab2611b995a73ebc25fe169d7abf2846` |

All owned changes remain unstaged. No commit or push was performed. File ownership is released for the coordinator's integration.

## Completed remote integration gate

The coordinator verified [focused runtime run 45463968891](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45463968891), job 138693779261, at commit `676d4c8531695638537bf62af5a74ca8edbe41ef`. The job completed successfully. Full TypeScript/build and **all 11 browser tests passed**, including all three new native audio tests.

The real OfflineAudioContext gate therefore confirmed complete low-rate playback and native ended cleanup; exact zero-sample-difference between the reset replacement and fresh graphs; and actual silence after terminal disposal. The earlier pending-gate statements describe the agent's handoff, now superseded by this coordinator-observed result. Hardware listening and other browser engines remain outside this evidence.
