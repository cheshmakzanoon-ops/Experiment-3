# Wave 2 — circuit/Festival startup admission

Assignment 10/60; implements runtime audit finding 1.

## Behavior

- `GameApp.start` rejects circuit admission while Festival is importing, preparing, or active.
- `startFestival` rejects admission during circuit startup, non-paddock circuit states, and settings transactions. Menu and results remain valid entry states.
- Festival's existing owner claims startup before the lazy import. Its load callback immediately disables driving input and displays the existing loading screen/message. On readiness, the circuit backdrop resumes its parked state while Festival owns frame/input dispatch.
- Host settings preparation cannot begin during either startup or an active Festival. Festival already consumes the host settings action; its supported lighting, machine, autopilot, traffic and travel controls stay on their existing session-owned callbacks.
- Festival import/preparation/readiness failures report the original error through the existing toast only after cancellation and complete menu restoration succeed. Cleanup failures still reach the existing fatal handler; terminal context loss/disposal remain terminal.
- Explicit Festival exit restores menu admission immediately. Departed imports and preparation callbacks cannot reset a later circuit/Festival launch or deliver its input.

No renderer definitions, 3D content, assets, tuning, UI markup, styles or authored UI copy changed. The loading message is the existing Festival startup message, shown earlier.

## Verification

The new `tests/engine-cross-mode-startup.test.ts` extracts complete production methods, both lazy import boundaries, the circuit renderer switch and the production input-pump callback. It runs real session/readiness owners, the input pump and settings transaction with deferred imports/preparation and browser/rendering doubles.

18 new cases cover both launch orders; duplicate submits during import/preparation/active use; delayed circuit audio/module/renderer/records preparation; settings quality preparation and durable saving; reverse settings admission; failure then a valid circuit start; canceled import resolve/reject; stale preparation callbacks versus a replacement Festival; and failed restoration/terminal host states.

Direct focused command (one worker; no package lifecycle hooks):

```sh
./node_modules/.bin/vitest run tests/engine-cross-mode-startup.test.ts tests/engine-export-host-ownership.test.ts tests/circuit-startup-settlement.test.ts tests/festival-host-startup.test.ts --maxWorkers=1
```

Result: **4 files, 66 tests passed**, including all 18 new cases. The existing export-host fixture supplies the loading UI seams now reached before import completion.

The coordinator owns consolidated typecheck/build/gates. This assignment did not run a native browser, delay a real network chunk, or claim native GPU evidence.
