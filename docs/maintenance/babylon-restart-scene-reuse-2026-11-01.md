# Guarded proxy-scene reuse on Restart

This branch-only optimization follows the observed rebuilt-surface delays, but
is not a demonstrated Linux repair. Exact `468c4cdb` already passed all three
native targets without it; preceding Linux failures remain relevant.

Restart still immediately creates a fresh SimulationComponent and Track and
clears input. Only immutable graphics may be retained. The candidate must be a
fully installed, healthy canonical clear-weather Aurel Formula proxy scene, with
one entrant, no optional-model attempt/load/installation, no outstanding restart,
no context loss and no pending preparation or failed queue. Resize or repeated
restart invalidates the candidate. Unknown state takes the original full rebuild.

Eligibility is captured before cancellation invalidates owners, then rechecked
after the existing GPU drain. Exact scene/collection registrations, geometry,
materials, submeshes, internal texture identity and constrained static state must
match, along with complete geometry of the fresh Track. Frozen snapshot-driven
entrant transforms reject reuse. Static station frozen matrices remain part of
the proof. No geometry, model, physics or original materials are replaced.

Eligible retained owners keep their graphics lifetime signal. Pending or attempted
model work never qualifies for this exception; its existing cancellation and full
rebuild semantics remain. Model-loaded Restart still removes the model and clears
wheel/height state. Loss, incomplete owners, changed identity or failed proof also
rebuild through the original path. Old component/scene epochs remain distinguishable.

A retained scene is NOT instantly ready: a new reset-presentation owner requires
two fresh ready GPU completion receipts after reset. Previous installation or
paused-image receipts cannot qualify that wait. Public scene/settled readiness and
model loading remain disabled until completion, while necessary draws are allowed.
Both timer and explicit elapsed-deadline checks retain the existing budget; no
new sleeps, GPU queries, relaxed timeout or missing-frame shortcut is introduced.

## Verification boundary

Base local validation passed 1,422 tests across 101 files, types, canonical lint,
production build and discovery. CPU pose checks cover the NullEngine proxy/camera,
not original material rendering. Original source-contract failures from an earlier
layout are retained; the new helper keeps the full-rebuild branch's existing
ordering and tests, with narrow surface-validator extraction and negative controls.

The new browser case requires actual retained-scene selection, stable scene and
resource identities, a fresh component epoch and two new ready receipts. It drives
through normal controls, then compares a deterministic tick-zero reset with an
original fully rebuilt tick-zero reference, including exact canonical state and
unmasked composited-canvas RGBA. Restart/Pause are dispatched through real DOM
handlers in one evaluation task for deterministic tick zero; this is programmatic
UI integration, not a claim of human pointer coverage. Existing native input tests
remain separate. A fallback, masked image or stale framebuffer cannot pass.

Exact combined-head CPU/build checks and real GPU/native execution remain required.
No reset-image equality, physical-device improvement or Linux stability result is
claimed until those checks execute on the published source.

## Combined frozen verification

The exact candidate on top of `43a4c3df` passed the workflow selection of
804 tests across 57 files, full TypeScript, canonical project ESLint, production
Vite build and discovery of 32 cases in ten browser spec files. The ordinary
large-chunk warning remains. The eight-file reviewed source patch was unchanged
through these checks. No local GPU/native execution is claimed.
