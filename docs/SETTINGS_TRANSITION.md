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

Settings, HQ and other read-only menu editors freeze their last completed
background immediately, including the first animation callback after opening.
Their invalidations remain pending until the editor closes. The Academy is an
explicit lighting/guidance preview: it consumes one invalidated frame and then
holds it. Settings transactions override both paths. Input polling continues;
gameplay/replay are not blanket-disabled by the menu rule.

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

## Academy preview correction after complete-suite inspection

Commit `22e2416d1537b22b78167beb2102ccb34f178cc6` passed the independent settings
workflow `37310586555`, including the unchanged original 640x400 click/save/grid
regression and the new pointer/keyboard cases. Full CI `37310586484` passed its
stable-source, numerical scenario and wet-presentation jobs, but browser job
`111767907793` exposed a different regression in the unchanged night-reference
test. At `08-reference-implementation.spec.ts:55`, reference 079 had selected
night but actual nearby venue lights stayed at zero instead of four. The previous
unconditional covered-menu return prevented the production draw which positions
and enables those lights. That failed full run is not release approval.

`shouldDrawMenu` now permits exactly one invalidated frame only while an Academy
preview is actually open. Generic editor invalidations still cannot draw through
settings/HQ, and settings ownership blocks all submissions even if a preview was
pending. Existing GPU backpressure retains the request until a frame can be drawn.
No renderer metrics are fabricated; the ordinary renderer still updates the
actual lights, camera and scene. No simulation channels or light budgets change.

The original night/day/guide test keeps every previous assertion and deadline.
Additional read-only observers check held frames, live input polling, exactly one
frame for guide/day changes, unchanged simulation snapshots and retained PNG/JSON
evidence. Five unit cases exercise all busy-state combinations, first-editor-frame
exclusion, pending previews, replacement editors and ordinary uncovered rendering.
The existing focused settings workflow also runs the reference controls, so it
cannot certify settings without checking this neighbouring interaction again.

Local validation before publication of this continuation: 49 focused Vitest
cases and strict project TypeScript passed. A fresh local Mesa adapter check
succeeded, but navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; no local game
browser pass is claimed. The hosted failing trace establishes the pre-repair
application defect. Full frozen-source validation and the new-commit hosted
browser and release outcomes remain independently reportable gates.
