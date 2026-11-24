# Final resource integration review — 2026-11-24

Agent 56, wave 10. This review followed ownership across the application, Festival
session, renderer, audio and controller lifetimes. Production changes are confined
to three existing terminal `dispose()` methods. No models, characters, authored
environments, asset files, geometry or material definitions, audio synthesis/cue
parameters, or vehicle tuning were changed.

## Confirmed defects and corrections

### Application teardown

`GameApp.dispose()` previously invoked several callbacks before checking or setting
its terminal state. A callback could reenter disposal, and an early exception could
leave the application nonterminal. A renderer exception prevented later racing
audio cleanup. The method never disposed its menu sound owner or stopped the
previously owned haptic actuator. Its replay cleanup promise also had no rejection
handler.

The method now marks the application disposed and increments its generation before
calling children. Each independent release is attempted even after an earlier
synchronous failure. It disposes `UiSounds`, calls `Rumble.stop(null)` so a lost pad
does not strand an owned actuator, and observes replay cleanup rejection. The
existing asynchronous racing audio diagnostic is retained. After attempting all
releases, the first synchronous thrown value is rethrown, including `undefined`.
Repeated or reentrant calls are inert.

### Festival session cancellation

The real `SessionStartOwner.cancel()` revokes its owned session before invoking
session disposal. With the previous `FestivalSession.dispose()`, a renderer cleanup
exception therefore left HUD cleanup and frame-reference clearing unattempted,
while the outer owner had already discarded its session reference.

The session now captures nullable child owners and clears its references before
callbacks. It attempts lifetime closure, readiness and command settlement, input
cleanup, worker callback removal and termination, child render owners, and HUD
cleanup independently. The first synchronous failure is preserved after the other
attempts. The existing mouse-release method only exits pointer lock; it does not
depend on the cleared control or renderer fields.

### Festival renderer teardown

A reflection cleanup exception previously skipped cars, effects, postprocessing,
the compositor and scene clearing. The renderer was already terminal, so a second
call could not complete those skipped releases.

The renderer now revokes its nullable owner references and rendering caches before
callbacks, and attempts each independent existing release. Effect geometry and
material disposal operations are individually isolated inside traversal: a Three
disposal-event listener throwing on one resource no longer skips later materials
or nodes. The first synchronous failure is preserved after cleanup attempts.
Rendering behavior, resource construction, geometry, materials and scene contents
are unchanged.

## Regression evidence

The new `tests/engine-resource-integration.test.ts` executes the complete current
production `dispose()` methods, selected through the TypeScript AST and transpiled
into a small test owner. It does not copy or substitute their branches or assert
implementation source strings. This avoids `main.ts` automatically booting its UI
and avoids importing the entire renderer graph in every ownership test.

The suite uses the real `UiSounds`, `RacingAudio`, `Rumble`, `SessionLifetime` and
`SessionStartOwner` implementations. Audio contexts and haptic devices are
controlled fixtures. Generic empty Three geometries and materials exercise actual
Three disposal-event behavior; no authored artwork or scene assets are loaded.

The 18 new cases cover:

- Menu audio closure and stale cue rejection through host disposal.
- Racing audio graph release after renderer failure.
- Independent host releases after failures in four different owners.
- Early host generation revocation, reentrant disposal and repeated disposal.
- Resetting an owned actuator after the input pad disappears.
- Preserving an `undefined` first failure across subsequent cleanup failures.
- Observing asynchronous replay and audio cleanup rejection.
- Actual `SessionStartOwner.cancel()` invoking session teardown when rendering
  cleanup fails, and clearing worker callbacks, HUD ownership and frame references.
- Session and renderer reference revocation before reentrant callbacks.
- Reflection failure followed by the remaining renderer cleanup attempts.
- Actual Three geometry/material disposal-event failures followed by remaining
  effect and postprocessing cleanup.
- A complete ownership chain from application disposal through session ownership,
  session disposal and Festival renderer disposal to a failing reflection child.

The initial eight host regression cases failed before the application fix. A
separate direct-method reproduction before the Festival fixes confirmed that
session cancellation cleared its outer owner but skipped HUD/frame cleanup, and
that reflection failure skipped cars, compositor and scene cleanup. The final
expanded integration suite passed all 18 cases.

| Completed suite | Passing cases |
| --- | ---: |
| `engine-resource-integration.test.ts` | 18 |
| `racing-audio-lifetime.test.ts` | 19 |
| `rumble-actuator-lifetime.test.ts` | 24 |
| `ui-audio-lifetime.test.ts` | 17 |
| `review-audio-tap-lifetime.test.ts` | 6 |
| `festival-session-lifecycle.test.ts` | 31 |
| **Distinct completed cases** | **115** |

Commands used for the completed runs, from the repository root:

```sh
NODE_OPTIONS=--max-old-space-size=256 node node_modules/vitest/vitest.mjs run tests/engine-resource-integration.test.ts --pool=threads --maxWorkers=1

NODE_OPTIONS=--max-old-space-size=256 node node_modules/vitest/vitest.mjs run tests/racing-audio-lifetime.test.ts tests/rumble-actuator-lifetime.test.ts tests/ui-audio-lifetime.test.ts tests/review-audio-tap-lifetime.test.ts --pool=threads --maxWorkers=1

NODE_OPTIONS=--max-old-space-size=384 node node_modules/vitest/vitest.mjs run tests/festival-session-lifecycle.test.ts --pool=threads --maxWorkers=1
```

An AST boundary comparison against the prechange Git versions confirmed identical
bytes before and after the three changed `dispose()` methods. Final whitespace
verification passed for the changed files. Scoped lint passed for the initial
application/test changes; the final four-file lint run was killed by the host with
exit 137 and is not counted as a successful final lint run.

## Limits and follow-up verification

The tests prove ownership revocation, cleanup attempts, exception propagation and
controlled callback interactions. They do not prove that a child or browser API
which refuses cleanup successfully freed its internal resources. Reentrant calls
intentionally do not retry failed owners after terminal ownership is revoked.

The new method fixtures do not instantiate the full application, Festival session
or Festival renderer constructors. In particular, the extracted session fixture
does not duplicate the constructor's abort-listener wiring. The existing 31-case
Festival session suite supplies separate coverage of real session startup,
cancellation, timeout and queued callbacks with controlled dependencies.

The existing Festival renderer loader suite did not produce a completed local
report: its 384 MB run was killed by the host and the 256 MB retry also ended
without a completed report. Earlier default-fork/combined runs were likewise
interrupted by host resource limits. None are counted as passing or included in
the 115-case total. Final lint, full type checking, build and the full renderer
suite remain part of the parent integration/CI gates.

No native browser, physical GPU, real audio device, actual gamepad, sustained memory
profile or FPS comparison was performed by this agent. Controlled cleanup evidence
must not be presented as hardware validation or a measured rendering speedup.

## Restored-source integration receipt

After execution-host replacement, the three exact production patches and the
complete 18-case test were recovered from the retained review record. All
18 cases passed again. Scoped lint passed for all three production files and
the test; the parent whole-project TypeScript check (3,169 files) and direct
production build also passed. The previously blocked real Festival renderer
loader suite passed all 18 cases in the consolidated run on the restored host.
The consolidated [regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md)
records final frozen-source identities and unique execution counts separately
from the historical 115-case table above.
