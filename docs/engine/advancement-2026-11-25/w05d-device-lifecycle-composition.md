# Wave 5d — composed device and page ownership

Assignment 28/60. Independent integration review of the completed menu, host,
input-controller and UI teardown changes. Two bounded defects were reproduced
and repaired with coordinator authorization. No authored content, model,
character, environment, navigation geometry or input binding was changed.

## Findings and repairs

### The separate credits poller retained stale input ownership

The real `MenuGamepad` deliberately yields all input while the credits modal is
open. `CreditsGamepad` is then the independent owner of scrolling, A activation,
and B/Start close. The main host correctly suspended its `InputController`, and
the menu poller correctly reset its baseline, but neither operation reset the
credits poller. It had no page, visibility, focus or controller-identity
boundary.

Four integration witnesses failed before this repair:

- A retained page return with no blur or visibility event closed credits from
  B/Start first pressed while away. The actual main page callbacks had already
  left the actual driving input neutral with no action emitted.
- A delivered callback while blurred activated the focused credits control
  from A and accepted held scrolling.
- The equivalent hidden-page callback also activated the control.
- A replacement controller holding A/B closed the old controller's credits
  screen immediately.

`src/ui/credits.ts` now records the device index, id and mapping as values, owns
its focus, visibility, page-transition and disconnect listeners, and establishes
a fresh button baseline after ownership changes. Held scrolling must reach
neutral before moving the retained list. Ordinary scrolling retains the
0.25 stick threshold and 14-pixel multiplier, and A/B/Start retain their existing
mapping. A close still takes precedence over A within one sample.

Each poll reads one gamepad snapshot. Button edges are committed before any
scroll/click/close callback. Reentrant page changes or disposal during scrolling
revoke the remaining actions from that sample. The credits owner cancels its RAF
on pagehide, starts one on pageshow, and releases all owned listeners and its RAF
on idempotent disposal. A newly created credits owner cannot inherit the A edge
that created it.

The entire authored prefix of `src/ui/credits.ts`, before
`export class CreditsGamepad`, is byte-identical to original commit `350119e8`.
Its SHA-256 is
`2ff8017566335c439f47b0230c8d9325a235a3f773116264a229a38fde65dc66`.

### A controlled late menu callback could duplicate its replacement RAF

The composition fixture retained the pending callbacks for the menu and credits
owners, performed pagehide and pageshow, and then explicitly delivered the old
cancelled callbacks. Before the menu repair, the two legitimate new callbacks
became three: the old raw `MenuGamepad.poll` callback created an additional loop.
The already repaired credits scheduler rejected its old callback.

`src/ui/menu-gamepad.ts` now assigns a generation to each scheduled callback and
revokes that generation on pagehide and disposal. A callback may clear the
current frame handle or poll only while it still owns that generation. The
change preserves the existing action order, scope/content ownership and
360/110 ms repeat timing. The credits scheduler uses the same ownership rule.
Both retain a nullable handle, so a valid RAF identifier of zero is not treated
as an empty slot.

This is an explicit controlled late-delivery hardening case. It is **not evidence
that a native browser delivered a cancelled RAF**, nor proof of actual native
back/forward-cache admission.

## Integration coverage

`tests/engine-device-lifecycle-composition.test.ts` imports the real
`InputController`, `MenuGamepad` and `CreditsGamepad`. It extracts the complete
current `GameApp.pageHide` and `GameApp.pageShow` declarations through the
TypeScript AST and executes them without changing their policy. Browser objects,
RAF delivery, gamepad snapshots and non-input services are controlled boundaries;
there is no live worker, WebGL context or real DOM in this fixture.

Its 13 cases cover retained navigation with missing blur/visibility signals;
focus and visibility independently; device replacement, mapping mutation,
disconnect, disappearance and Gamepad API failure; reentrant scrolling into
disposal or page navigation; replacement credits ownership inside an A callback;
the controlled stale-callback delivery; and complete credits event/RAF teardown.
The menu handoff test also proves that a still-held A button cannot activate the
menu when credits closes, while a subsequent released-and-pressed A works.

Independent source review also followed `Interface.releaseModalResources()` and
`Interface.dispose()`: both detach the credits reference before invoking its
cleanup. The complete host disposes the UI before the driving input. Existing
tests cover the real interface's teardown, failing child cleanup, modal
replacement and disposal from focus/action callbacks, so no duplicate fixture
was added for those paths.

## Executed verification

No npm lifecycle hooks, full TypeScript/build pass, browser launch, benchmark,
Git mutation or child agent was used.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-device-lifecycle-composition.test.ts \
  tests/engine-menu-gamepad-lifecycle.test.ts \
  tests/engine-page-lifecycle.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Result: **83/83 passed across 3 files**: 13 new composition cases, 42 existing
menu/credits/interface cases and 28 existing page-lifecycle cases. No existing
test, fixture or assertion was changed by this assignment. Earlier negative
witnesses were 4/4 failing before the credits repair, then one controlled
late-menu-callback failure with the other 12 new cases passing before the menu
scheduler repair.

Scoped ESLint, Prettier and `git diff --check` passed for the two source files and
new test. The coordinator's subsequent aggregate and exact-commit CI gates remain
authoritative. Native focus/history and physical-controller behavior remain for
the native validation wave; there is no memory, frame-rate or physical-device
certification claim here.
