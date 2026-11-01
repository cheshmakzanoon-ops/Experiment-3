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

## First native result: `7f07ecef`

[Run 41356499639](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41356499639)
passed Windows/macOS model checks and all four compatibility journeys, with
49/49 and 36/36 draws. All three platforms recorded component epoch 2 / scene
epoch 1 and 308 preparations, directly proving scene retention rather than
inferring it from elapsed time. Expected original asset receipts remained intact.

Linux passed initial pause 6/6 and post-restart pause 12/12, then loaded the model
at 70.150 s. Its wheel-motion wait fulfilled after 5.201 s, but the following
Pause locator click timed out after 30 s waiting for button actionability. Final
freeze/readiness and compatibility checks were not reached. GPU exit 512 was
logged about 434 ms after that timeout. The pending sequence 16 was an unpaused
post-model submission: tick 55, throttle .111948, wheel phase 2.257628, no
preparation owner, 16 submitted/15 completed. The later loss pending age was
30.523 s; this is not an exact timeout-age measurement. CPU draw time 14.3 ms
does not explain the GPU delay. Approximate host/renderer clock alignment is not
causal evidence. No general Linux repair or physical-performance claim follows.

Verified evidence artifacts: Linux 13103314326, Windows 13103134823,
macOS 13104395069. Fingerprint:
`8c1421916f4a10340c83123f0d694fe5bbda07342b2fd4ed88ece6d200f70867`.
The prior `468c4cdb` all-platform pass remains a valid download checkpoint;
intermittent failures remain part of the recorded qualification history.

## First GPU result: strict comparison remains failed

[Run 41356499579](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41356499579)
finished with 31 passed and one failed. The new reset-image case selected actual
reuse, retained scene epoch 2 while component advanced 2 → 3, and recorded two
fresh ready tick-zero submissions 12/13 after driving to tick 66. Canonical scene
state matched. However, the unmasked comparison failed on 746 pixels (2,238
channels, max delta 228), all inside x31–112/y179–225 around the Resume button.
Reference focus-visible was false; reset focus-visible was true. Independent
full-image comparison and screenshot inspection confirmed the orange focus ring
appeared only in the reset capture; pixels outside that rectangle were identical.
This is evidence of mismatched UI input modality, not permission to mask pixels
or declare the strict case passed. Same-condition real-pointer setup and a fresh
exact-source run are still required. No CSS override/tolerance change is proposed.

All four isolated shards passed and all 380 common asset PNGs remained unchanged.
The existing paused-startup viewport comparison also passed with zero changed
pixels. Retained artifact 13103459857 SHA-256:
`0613e348371d0c73716f15450a4e2f46c361efee2733ba29e568a4a72ed4366e`.
