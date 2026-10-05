# Settings interaction repair

## Starting evidence

Full validation run 37246346644 on 1243bb8 failed the original 640x400
menu/settings test at APPLY & SAVE. Its log passed the visible/enabled/stable
checks, then timed out while performing the click. This is not proof that the
button was unreachable or that IndexedDB was the underlying cause.

The previous continuation retained two reviewed runtime blobs through explicit
staging commit 205567943afaa6ab43cf90b33df7c098f51307bd. Staging run 37308795150
passed without updating application source. This continuation integrates those
runtime files with their required transition module and tests, and removes the
one-shot staging workflow. Installs and builds do not apply source patches.

## Behavior

The menu editor freezes its last completed background immediately, including the
first animation callback after opening. Invalidations remain pending until the
editor closes. Input polling continues; gameplay/replay are not blanket-disabled
by the menu rule.

A save marks its form busy and yields a browser task. For a graphics change only,
the renderer waits for its previous GPU submission before changing target and
texture quality, then compiles the scene asynchronously without drawing a new
frame or resetting race/camera/replay state. Custom graphics changes are compared
by value, not object identity or preset label alone. Non-graphics edits do not
reconfigure graphics.

The application excludes competing draws, duplicate saves, scene replacement,
and resume while the transition owns graphics resources. Resize events coalesce
until ownership ends. Teardown/generation/renderer checks prevent stale UI
completion. An accepted save continues when its editor closes; closing the editor
is not a promise that an in-progress storage transaction was cancelled.

The settings editor closes automatically only after the storage transaction has
settled. Storage failures explicitly report session-only settings; graphics
failures use the existing error panel rather than claiming durable success.

## Verification

`tests/settings-transition.test.ts` covers graphics equality/custom options,
real-task yielding, preparation/application/durable-save ordering, cancellation
at each boundary, preparation failure and late storage rejection. The continuation
executed all 37 assertions locally using Node's test registrar (only the Vitest
registrar import was adapted); this is not the full installed-toolchain suite.

`e2e/settings-transition.spec.ts` records the real opening click's presentation
counter, verifies zero subsequent background frames while input keeps polling,
changes quality through ordinary pointer input and checks persistence after reload.
It also exercises keyboard submission with unchanged graphics at 640x400 and
1280x720. The original 30-menu-access regression and its 15-second click timeout
remain unchanged. The dedicated workflow retains failed traces as well as successes.

Full exact-commit CI and publication remain independent gates. This focused repair
does not authorize release by itself. Consumer-hardware frame rate, uninterrupted
human racing, final-art approval and A71/A12 authoring are not claimed.
