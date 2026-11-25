# Wave 03e — menu input ownership and UI teardown

Assignment 17, 2026-11-25. Starting findings: sections C–D of
`audit-devices.md` at baseline `350119e8`.

## Production changes

`MenuGamepad` records the selected controller's index, id and mapping as values,
plus the current scope and modal content owner. A device replacement, disconnect,
focus loss, visibility transition or scope replacement revokes its button and
direction state. The next eligible sample establishes a baseline. A direction
held across that boundary must reach neutral before it can navigate or repeat;
changing directly to another held direction does not bypass that requirement.
Ordinary navigation retains its 360 ms initial delay, 110 ms repeats, button
mapping, stick threshold and spatial scoring.

Owned `pagehide`/`pageshow` listeners also coordinate with the page-lifecycle
assignment. Leaving the page cancels the pending menu RAF. Returning schedules
one RAF, refreshes document focus and establishes a fresh baseline, including
when no hidden-tab RAF or blur event occurred. Disposal removes both page
listeners along with pointer, keyboard, focus, disconnect and visibility
listeners. A retained callback cannot restart polling after disposal.

Button edges are committed before invoking actions. After a focus, click, value
change or discipline callback, the poller checks whether it still owns the
sample. A callback that disposes the application or changes its screen cannot
continue through the remaining buttons in that sample.

`Interface.dispose()` is the UI teardown owner, invoked by the complete
`GameApp.dispose()` path. It revokes ownership first, removes UI event bindings,
stops the menu controller and releases every current modal resource:

- Wildcard, first-run and settings binding disposers;
- credits controller, key-binding capture and device calibration panel;
- launch-board registration and event bindings;
- the constructor-owned showroom `ResizeObserver` and toast timeout.

Resource references are detached before their cleanup callbacks run. Cleanup
continues through independent owners after a failure and then rethrows the first
failure. Reentrant/repeated disposal is inert. Late toast, modal, settings and
credits calls cannot start new UI resources. Settings form listeners now share
the existing settings binding lifetime. Observer callbacks check disposal before
reporting a showroom change.

The only change made by this assignment in `src/main.ts` is
`release(() => this.ui.dispose())` immediately after input-pump disposal.
`main.ts` was then released to the page-lifecycle assignment; its startup work
was preserved.

## Separate credits button defect found by the real-class regression

`CreditsGamepad.poll()` previously assigned `this.previous = now` before
evaluating an edge closure that read `this.previous`. Thus A, B and Start always
compared the current sample with itself. Capturing the prior set fixes those
documented edges without changing the mapping: A activates the focused control,
and B/Start close the credits screen. A second small guard prevents scheduling a
new RAF after an A-click callback synchronously disposes the credits owner.

## Verification

Direct invocation, without npm hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-menu-gamepad-lifecycle.test.ts --maxWorkers=1
```

Result: **42 passed**, 230 ms test time, 3.46 s command duration. The tests import
the actual `MenuGamepad`, `CreditsGamepad` and `Interface`; RAF delivery, gamepad
snapshots and DOM objects are controlled boundaries. Host integration executes
the complete current `GameApp.dispose()` method selected through the TypeScript
AST, including the page-lifecycle assignment's cleanup. Constructor root-event
and observer registrations are likewise executed from production source.

Coverage includes direct controller hot swaps, replacement ids and mapping
changes on a reused object; transient disconnection/API loss; hidden/visible and
blur/focus without intervening RAF; both persisted and ordinary page transitions;
modal replacement; held-direction neutral recovery; repeat timing and value
stepping; complete listener/RAF removal; and disposal from active menu, credits,
focus, input, sound-cue and discipline callbacks. Integration checks also cover
failing/reentrant modal cleanup, capture release, observer ownership, pending
toasts and rejection of late resource creation.

The existing `tests/front-end-board.test.ts` passed **34 tests**, including the
unchanged spatial-navigation geometry. The five existing host fixtures needed
only a `ui.dispose` stub from this assignment:

- `tests/engine-cross-mode-startup.test.ts`
- `tests/engine-host-failure-cleanup.test.ts`
- `tests/engine-resource-integration.test.ts`
- `tests/engine-audio-preview-cancellation.test.ts`
- `tests/circuit-startup-settlement.test.ts`

The page-lifecycle assignment subsequently supplied its `pageWaiters` and page
listener dependencies in those fixtures. It confirmed all five passing in its
159-test focused run (100 tests in these five files). An earlier overlapping
combined run exposed the incomplete fixture handoff; it was not accepted as a
passing result or worked around in production cleanup.

Scoped ESLint passed for the three UI source files, the new lifecycle test and
the five affected fixtures. `git diff --check` passed for this assignment's UI
changes. Native browser history/focus/controller validation remains assigned to
the later browser regression pass. These are deterministic lifecycle results,
not physical-device certification or memory/frame-rate measurements.

No authored styles, content, models, characters, environments, assets, vehicle
handling or navigation geometry were changed. No build hooks, full build, git
mutation or local-browser bypass was used.
