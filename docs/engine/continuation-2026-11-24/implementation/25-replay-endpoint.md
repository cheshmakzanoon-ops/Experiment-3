# Agent 25 — Exact replay endpoints after native range serialization

## Result

Implemented a narrowly scoped correction in `ReplayClock.seek`: a native range control's exact 15-significant-digit representation of a recording boundary is restored to the authoritative boundary. Other interior seek values retain their original binary64 value. The fix preserves pending-frame acknowledgement, play/pause behavior, and restarting from a retained flashback floor.

The 27 existing replay-clock cases and 28 new precision regression cases pass (55 total). Scoped strict TypeScript, ESLint, browser-fixture bundling and whitespace checks pass. Native browser execution remains pending remote CI because the local executor prevents Chromium from creating its process-singleton Unix socket.

## Observed defect

The parent supplied a real failure from GitHub Actions run `45454054788`, job `138658590706`, on published source `61241fd004afbc62a555723923fcc8e94effdafe`. `e2e/replay-state.spec.ts:197` expected the exact recording end `16.600000381469727` but observed `16.6000003814697` after setting a native range input to that end and dispatching its input event. The received number is exactly `Number(duration.toPrecision(15))`.

The UI sends `Number(input.value)` through the normal replay seek callback. Previously, the clock only clamped the input. A rounded value just below the upper bound therefore remained an interior position. Exact comparisons used to stop or restart playback could miss the final-frame state.

This change leaves the failing full-game test and its strict equality assertions untouched.

## Implementation

`src/session/replay-clock.ts` adds a private boundary-normalization helper used only by `seek`:

1. Clamp to the validated recording range, preserving the existing out-of-range behavior.
2. Preserve exact lower and upper endpoint values immediately.
3. Compare against each endpoint's specific 15-significant-digit decimal representation.
4. Restore the matching endpoint, without applying a general absolute or relative epsilon.
5. If an exceptionally narrow range gives both endpoints the same decimal representation, select the nearer authoritative endpoint; a distance tie selects the lower endpoint.
6. Preserve every other interior value exactly.

This handles both upward-rounded retained floors and downward-rounded ends. Exact-endpoint precedence prevents an exact request from being redirected to the opposite endpoint when a very narrow range has ambiguous decimal forms. The decimal conversion occurs on a seek, outside the simulation tick. Playback arithmetic, recording storage, physics tolerances, and presentation acknowledgement are unchanged.

## Regression coverage

`tests/replay-endpoint-precision.test.ts` adds 28 cases covering:

- The exact reported failure values as fixed constants.
- Both lower and upper bounds, including Float32 timestamps, large values, tiny values and the smallest positive subnormal.
- Playing and paused seeks, pending target ownership, pausing before presentation, stopping at the end after presentation, and restarting from zero or a nonzero retained floor.
- Interior positions very near each endpoint, full-precision interior values, and meaningful distances from the bounds at small and large scales.
- Both possible nearest-bound choices and a tie for overlapping decimal representations.
- Exact endpoint precedence, ordinary clamping, singleton/zero-duration recordings, and the maximum finite endpoint.

`e2e/fixtures/engine-native-lifecycle.ts` now exposes a small real-DOM fixture using `input[type=range]`, `step=any`, exact min/max strings and the normal numeric input-event mapping. Its lower bound is `Math.fround(4.2)`, which rounds upward at 15 digits, and its end is `Math.fround(16.6)`, which rounds downward. It exercises the pending end seek, pause, presentation, restart, lower-bound seek and an exact interior seek. It removes its input and event listener on completion.

`e2e/engine-native-lifecycle.spec.ts` adds one case asserting those exact states and attaching a JSON record of the native serialized input strings and resulting clock states. It uses the existing asset-free fixture infrastructure. It does not assume every future browser must lose precision; both native full-precision and rounded representations must produce the same exact state.

## Validation

All local heavy checks used `/engine-work-4e0075ccccb3/test.lock` and a 512 MiB Node heap.

| Check | Outcome |
| --- | --- |
| Direct Vitest on `tests/replay-clock.test.ts` and `tests/replay-endpoint-precision.test.ts`, one thread | 55/55 passed in 2 files |
| ESLint on all four owned files | Passed |
| Strict scoped TypeScript on all four owned files and their import graph | Passed |
| Browser fixture bundled with the same esbuild options as native E2E | Passed, 413,090 output bytes |
| `git diff --check` for owned files | Passed |
| Formatting of owned files | Applied with project Prettier |
| Native Chromium execution | Blocked locally before page creation; pending CI |

The scoped compiler used ES2022, DOM/DOM.Iterable, ESNext modules, Bundler resolution, strict mode, TypeScript extension imports, skipLibCheck, and Vite/Node types. It was not a full-project compiler run.

The local browser attempt found `/usr/bin/chromium` but failed during launch with `process_singleton_posix.cc:297`, `socket() failed: Operation not permitted (1)`. No attempt was made to bypass the executor restriction. No native pass is claimed. The parent should run the focused native lifecycle suite and the unchanged full-game replay-state regression in CI on the published candidate.

## Owned changes and scope

- `src/session/replay-clock.ts`
- `tests/replay-endpoint-precision.test.ts` (new)
- `e2e/fixtures/engine-native-lifecycle.ts`
- `e2e/engine-native-lifecycle.spec.ts`

No model, character, environment, authored visual, tuning, dependency or generated-asset changes. No commits, pushes or Git ref updates were made by this agent.
