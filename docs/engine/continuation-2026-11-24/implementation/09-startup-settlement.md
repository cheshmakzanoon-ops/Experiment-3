# Agent 09 — circuit startup settlement

Implemented audit finding 4 in `src/main.ts`, with `src/session/worker-readiness.ts` and `tests/circuit-startup-settlement.test.ts`.

## Behavior

- First-frame readiness now belongs to one startup generation. The gate clears its callback before settlement and observes rejection immediately, including while audio, imports, or circuit preparation are still pending.
- The existing `SessionLifetime` cancels startup waits on failure, disposal, or replacement. Active startup failures reject; disposed and replaced starts complete quietly. Late preparation failures are consumed.
- Native worker errors, decoding errors, protocol failures, initialization-post exceptions, worker-constructor failures, and initialization timeout all settle readiness and clear the timer.
- Worker callbacks, frame acceptance, progress updates, and time-trial completion check ownership. Stale frames, errors, timeout callbacks, and preparation continuations cannot activate or fail a replacement.
- The existing timeout remains five-second checks, counting at most six seconds per check toward 45 seconds. It ends at the first frame and does not bound renderer preparation.
- Terminal readiness is revoked before other teardown callbacks. Successful startup retains normal running-frame delivery.

## Verification

Serialized focused run:

`flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/circuit-startup-settlement.test.ts tests/engine-resource-integration.test.ts tests/circuit-preparation-lifetime.test.ts`

**64/64 tests passed:** 27 new startup tests, 18 existing host/resource tests, and 19 existing renderer-preparation tests. The startup harness executes complete production methods extracted through TypeScript's AST, replacing only the worker-import boundary and external services. It covers cancellation at every startup await, late rejection, stale callbacks, synchronous failures, timeout accounting, and success.

Focused ESLint passed for the three source/test files. No npm lifecycle hooks, full typecheck, Git operations, authored content, model, character, environment, UI, or rendering-construction changes were made.
