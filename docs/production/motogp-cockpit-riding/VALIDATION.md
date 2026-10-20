# Validation record

This record distinguishes model and simulation checks from application browser
acceptance. The existing MotoGP test deadlines, viewports, GPU completion gates,
110,000-triangle model limit and 220-draw-call limit remain unchanged.

## Current verification checkpoint

The current work incorporates main
`e7cbd04d8f5225d2b742dcc1bd39f9a6da444978` and preserves its physics category 12
and snapshot protocol 14. These results have different source scopes; they are
not combined into one test total or one clean-commit acceptance claim.

| Source scope                                          | Check                                                               | Result                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Current follow-up after `e7cbd04` integration         | Focused interaction gate                                            | **96/96 tests passed in eight files**                                                                                      |
| Same post-integration follow-up                       | Guarded production TypeScript/Vite build                            | **Passed**, 127.416 seconds                                                                                                |
| Follow-up before `e7cbd04`, fingerprint `bd53fbce...` | Production build and final scoped ESLint                            | Passed                                                                                                                     |
| Same pre-`e7cbd04` follow-up, actual Mesa WebGL       | Applied context reuse / original wet / original dry browser command | **2 passed, 1 failed**: context reuse 15.717 s and wet 257.873 s passed; dry reached its original 300 s execution deadline |
| Published `85ceda3`, hosted CI                        | Production build and focused units                                  | Passed; **439/439 tests in 38 files**                                                                                      |
| Same published `85ceda3`, hosted CI                   | Browser groups                                                      | **21/21 browser tests passed**: rider 7, presentation 6, dry 1, wet 1, menu/settings 6                                     |

The post-integration gate covers startup, frontend loading, session identity,
GP front-contact steering, GP control feedback, snapshot interpolation, wheel
winding, and wheel recording. It completed in 46.64 seconds of Vitest time,
55.092 seconds for the guarded command. This includes actual GP production
wheel steps and recorded/replayed winding alongside the GP steering behavior.

The post-integration build identity records fingerprint
`be7406dfc83a2b48079a454522cdb95da559e4c680aa3fd131a15ae5c14a6e54`
and `commit: null`. It is a modified-worktree build receipt, separate from the
published-source CI. The local Mesa browser results predate `e7cbd04` and do not
validate that later shared protocol/wheel update. The earlier 80-test and
19-test runs below retain their original scopes; their overlapping results are
not summed with the 96-test gate.

The [final integration receipt](final-integration-receipt.json) retains the
command results, source hashes, and exact unit-file counts. The subsequent main
commit `5bb13e3` adds only a separate motocross validation document; it is
preserved without changing the runtime verified by this gate.

## Local evidence before integration of main `4a8fd57`

- Production TypeScript/Vite build passed under the source-stability guard.
  Its source fingerprint was
  `d837beb4d6f50fc482488dd9a52351b3a517902eda4a82a15b690826e72ccb74`.
  This was a modified worktree build, not a clean committed source receipt.
- The 38-file focused run completed 438 tests: 437 passed and one geometry
  measurement failed. The failure read the new garment's conservative animation
  culling box as physical geometry. The test and review fixture now measure
  actual posed vertices, with every original size and silhouette threshold kept.
  The follow-up geometry/suit/garment run passed all 18 tests in three files.
- The final front-contact dynamics run passed 48 tests in five files, including
  GP traction, braking, the base motorcycle and setup contracts. The separately
  recorded comparison covers both GP bikes at 120 and 240 Hz and verifies 48
  supported-riding profiles against the prior behavior.
- Full lint and content validation passed before the final integration edits;
  changed garment and geometry files also passed scoped lint after the bounds fix.

## Actual local WebGL review

The browser backend was verified SwiftShader software WebGL. It is not evidence
of physical-GPU frame rate.

Five model captures completed before the broad reference sequence reached its
original 300-second timeout: GP-R1 high/mid/far dry, GP-R2 high dry, and GP-R1 high
wet. Their completed resource, model-budget and GL checks passed. GP-R1 high
rendered 100,713 triangles / 193 draw calls, GP-R2 high 93,012 / 191; both reported
zero GL errors. Visual inspection of the GP-R1 dry and wet images found the near
sleeve and cuff connected without a visible tear or flex-joint collapse. These
views do not establish every occluded knee or hip contact.

The complete GP-R1 right-grip browser case passed, including held-frame and
wet/rewind pixel hashes and stable resources. The next case was manually stopped
to move the remaining review to isolated CI. That interruption is not a pass for
the other contact cases. The local broad reference sequence remains a timeout.

An earlier dry/wet application run timed out waiting for the initial menu at its
180-second gate, before GP selection. It used the previous full-circuit startup,
before incoming main `4a8fd57` introduced showroom-only startup. It does not prove
the combined source's menu or riding acceptance.

## Combined-source verification

The work incorporates main `4a8fd57`, preserving its Motocross and showroom
startup changes and assigning the subsequent GP physics update category 11.
The combined implementation was published as
[`85ceda3`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/85ceda37b9893ffe1f407e08f4ae1e3a5018e736).

- Production TypeScript/Vite build passed under the source-stability guard.
  The build fingerprint was
  `ce6f4d664a3e797bfb3751abe66bf6274f2ebfc7645a3992831f957b98841d00`.
  It was built from the combined modified worktree before publication, so its
  embedded commit is null; it is not a clean-commit build receipt.
- **80/80 tests passed in ten files**, covering session identity, GP control
  feedback, front-contact steering, menu sky and preview, startup, the incoming
  MX landing behavior, actual bike bounds, continuous garments, and rider suits.
  This count is one completed run, not a sum of overlapping earlier runs.
- Full ESLint and content validation passed on the combined source.

### Production onboard cameras: both cases passed

Both independent production-model onboard cases passed on verified SwiftShader
WebGL, retaining the original model budgets. Each performs three preparation
draws, verifies stable geometry/texture/program counts, checks nine instrument
visibility samples, and reports zero GL errors. GP-R1 uses 100,713 model triangles
and 60 submitted draw calls in this view; GP-R2 uses 93,012 and 56. These view
counts are different from whole-model side-view draw counts.

The retained [GP-R1 image](gpr1-production-onboard.png) is a direct, unedited
browser capture using the production onboard camera and materials. The neutral
review floor and sky intentionally isolate the model; this is not an on-track
race screenshot. Visual inspection confirms exposed gold adjusters, open fork
rings, recessed screw slots, and readable gear/speed/RPM text. The GP-R2 display's
upper band has an inherited windshield reflection/filtering effect. Geometry
visibility checks do not establish physically accurate glass optics.

[Production WebGL receipts](production-webgl-receipts.json) retain both camera
results and capture hashes. These cases supplement the original broad reference
sequence; they do not replace its acceptance gate or establish hardware FPS.

### Deep-corner and recovery poses: all three cases passed

The original GP-R1 and GP-R2 corner cases and original GP-R1 recovery case passed
on verified Mesa WebGL: **3/3 cases**, 163.6 seconds for the browser run. Each
corner case retains its complete five-sample dry/wet/held/rewind sequence, stable
resources, unchanged source frames, the same model instance, zero GL errors,
and the original triangle/draw-call limits. Recovery restores its original
wrist/ankle pose hash after the intervening riding pose.

The [retained GP-R1 corner image](gpr1-production-corner.png) shows a continuous
near sleeve around a rounded elbow and an exposed rounded knee connected to the
thigh. Review of all five captured images found no visible torn surface, missing
skin face, detached garment opening, collapsed bend, or new cuff gap. The recovery
view also shows continuous extended trouser legs and ankle overlap. The remaining
shoulder armor and knee puck still appear molded, and broad leather surfaces are
smoother than the selected clothing references.

The corner views obscure far limbs, the inner hip seam, boot soles, and
slider-to-ground contact. Wet samples change pose as well as weather, so these are
not a matched material A/B. The recovery fixture presents an isolated pose over
the motorcycle, not a grounded walking scene. The receipts retain these limits,
both complete corner sequences, and the hashes of all five images. Two unedited
model-review images are committed alongside the later on-track capture; larger
browser reports and traces are not added to the repo.

### Earlier local application journeys before the context-reuse correction

Both original application journeys were run with verified Mesa llvmpipe WebGL,
one worker, their normal UI interactions, original Low quality selections,
1280 × 800 viewports, original deadlines, and complete GPU completion gates.
Neither run reached its driving/replay or live-spray assertions.

- The dry case reached the GP-R1/Poggio practice menu and began circuit entry,
  but its overall 300-second deadline expired while mode remained `loading`.
  Initial menu waiting took approximately 78 seconds, settings closure 54,
  and the first diagnostics read after GP selection 53. Circuit entry began
  approximately 253 seconds into the trace, leaving about 65 seconds before
  teardown. This does not demonstrate a complete 180-second entry-stage hang.
- The wet case reached circuit entry earlier, but its complete 180-second
  `finishRaceEntry` wait expired. Material compilation, shadow compilation and
  then “Setting up cameras” were observed. The last completed poll result was
  already 110 seconds old at failure because the following visibility query did
  not return; it does not establish a freshly sampled `loading` state at the
  deadline. The [retained timeline](wet-entry-timeline.json) distinguishes the
  observations, final diagnostics, and attribution limits.

The loader displayed the inherited GP labels “4 cars” / “Preparing cars”. Source
inspection confirms that Formula host models are constructed before motorcycle
models replace their visible presentation. However, there was no stage boundary
before synchronous motorcycle construction, and the visible percentage is
monotonic across circuit and entrant preparation. The old label consequently
cannot identify which construction operation was still running. These traces do
not establish a specific bottleneck or prove that software rendering alone caused
the failures. The wet trace records two `texImage3D` upload warnings, no page or
console errors, and 183 resource snapshots with status 200. It does not establish
the warnings as the timeout's cause.

### Small loader-feedback follow-up

The follow-up adds a GP-only motorcycle preparation report, repaint opportunity,
and cancellation check before model construction; the session context says
“riders”. Formula host construction and GPU readiness gates are unchanged.
The guarded startup/frontend run passed **19/19 tests in two files**, including
cancellation before GP construction, byte-identical source frames, and preserved
MX/mixed-field behavior. Scoped ESLint, Prettier, and whitespace checks passed.
This is a reporting/cancellation improvement, not a claimed fix for the timeout.
Its guarded production build also passed, with source fingerprint
`374d5e108b8255b6b4f3010addcd63c717cef4a3d6b6f7b3f0297f37effdbe8e`.
The following context-reuse correction is a subsequent, separately checked change.

### Renderer context reuse

The menu-to-circuit path disposes a renderer and creates its replacement on the
same canvas. A real CanvasTexture upload can leave an unpack flag enabled after
disposal. Three 0.180.0 creates fallback array/3D textures in its constructor
before ordinary uploads write their own flags. Reproducing that sequence produces
two invalid allocations with the same warning signature as the retained trace.

The production creation helper now clears both unpack flags before constructing
Three's renderer, preserving the original context attributes and renderer options.
The [context-reuse receipt](context-reuse-receipt.json) binds the applied code to
the tested candidate. Its real WebGL regression passed: independently dirtying
either flag causes two GL 1282 errors in the legacy control and zero in the
production path. It retains the same canvas/context and renders exact red-top /
blue-bottom pixels after recreation; explicitly reversing texture flipY reverses
those pixels correctly. Candidate strict TypeScript, ESLint and formatting checks
also passed.

This establishes and corrects an inherited context-reuse mechanism. It does not
prove the origin of every recorded application warning or that these warnings
caused the entry timeout. The original full application deadlines and GPU gates
remain in place. The applied pre-physics-12 build and browser results are recorded in the
following section; later main integration has its own verification scope in the
current overview.

### Applied follow-up before the physics-12 integration

This follow-up combines the GP loading feedback and production renderer
context-reuse correction with incoming main
`0004d10009b6e88ec65fdb3fbd663e1dee3f5eb3`. Its source-guarded production
TypeScript/Vite build passed, as did final scoped ESLint. The emitted build
identity records fingerprint
`bd53fbce898638e54ac582995a9fcdb532735b1e90d2ccd866953077097be2c4`
and `commit: null`. This modified-worktree receipt predates incoming
`e7cbd04`; it is separate from published `85ceda3` CI and from the earlier
loader-only build.

The final browser command ran against a dedicated application server on verified
Mesa llvmpipe WebGL, retaining the original dry/wet workloads, 1280 × 800
viewports, deadlines, and GPU completion gates. Its terminal result was
**2 passed, 1 failed**, exit 1:

| Check                                            | Observed result                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Actual applied renderer context-reuse regression | Passed in **15.717 seconds**                                                                    |
| Original wet GP application journey              | Passed in **257.873 seconds**                                                                   |
| Original dry GP application journey              | Failed on the **300-second execution deadline**; the report's 321.798 seconds includes teardown |

The wet journey entered an actual four-rider GP-R1 practice session at Poggio
Alto through the normal menu, settings, worker, and circuit renderer. It used
the original Low preset with particle density 1. Runtime checks verified wet
contact at both tyres, live spray, all four riders moving and riding, chase and
cockpit views, acknowledged pause with held simulation/effect state, and normal
tick advancement after resume. It reported no page or console errors. Autopilot
supplies the riding input in this repeatable browser workload; the test does
not inject simulation frames. The production wet cockpit capture uses the
actual on-track scene at the Low preset's 0.75 resolution scale.

The context test exercises the actual applied production creation helper on
Mesa. It is a separate run from the earlier SwiftShader candidate receipt. It
establishes corrected fallback texture allocations and preserved ordinary 2D
texture orientation; it does not measure a startup-time improvement.

The dry case passed menu/settings/GP-preview entry and reached four-rider
circuit preparation, but did not reach its driving, guidance, pause, or
recorded-replay assertions. Its last observed raw stage was
`Warming shadows and scene reflections…`, the chase-view warmup announcement.
The entry poll was interrupted by the overall execution deadline after about
175.95 of its allowed 180 seconds. The final completed diagnostics object was
already about 53.8 seconds old at that deadline; a subsequent diagnostics query
never returned. This does not locate a blocking draw, yield, graphics-driver
operation, or later unobserved work. No browser warning, page/console error, or
`texImage3D` warning was recorded in this trace; it contains no direct
`gl.getError` sample. Absence of warnings is not a complete GL-error census or
proof of the timeout's cause.

These results establish a completed local wet application journey and a
remaining local dry acceptance timeout. They do not establish physical-GPU
frame rate, a measured loading speedup, or browser acceptance of the subsequent
physics-12/protocol-14 integration.

The [final browser receipt](final-webgl-journey-receipt.json) retains the three
case outcomes, actual graphics settings, wet-session diagnostics, and capture
hashes. The [wet cockpit image](gpr1-live-wet-cockpit.png) is a direct unedited
on-track capture. The [final dry timeline](final-dry-timeline.json) preserves
exact observations and the stale-diagnostics qualification.

### Hosted CI on the published implementation

The exact-source
[MotoGP review run for 85ceda3](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39341711922)
completed its guarded production build successfully at 23:57 UTC on 19 October 2026. The logs identify checkout of the full published commit and upload of the
reviewed build with `SOURCE_COMMIT.txt` (artifact 12229859964).

The focused unit job passed at 00:07 UTC on 20 October: **439/439 tests in
38 files**, 69.25 seconds, with JSON results in artifact 12230612527. This is the
complete focused run on the published source, including the earlier geometry
measurement correction.

The complete hosted run finished successfully at **00:52:32 UTC on 20 October
2026**. All seven jobs passed, including **21/21 browser tests** across these
five groups:

| Browser group                                                 | Result                           |
| ------------------------------------------------------------- | -------------------------------- |
| Rider contact and poses                                       | 7/7 passed; artifact 12230904873 |
| Presentation, including the original broad reference workload | 6/6 passed; artifact 12231771586 |
| Original dry application journey                              | 1/1 passed; artifact 12231975790 |
| Original wet application journey                              | 1/1 passed; artifact 12233470298 |
| Menu entry and settings                                       | 6/6 passed; artifact 12231309702 |

The successful hosted dry case is separate from the retained local Mesa timeout.
The wet job completed successfully at 00:52:31 UTC, followed by the successful
workflow conclusion one second later. Its unchanged live wet-riding and pause
case passed in 1.5 minutes on the observed Mesa backend. These
hosted results belong to published commit `85ceda3`; they do not include the
loading-feedback/context-reuse follow-up or the later main physics/protocol
changes. The follow-up has the separately identified local receipts above.

The subsequently published loading/context follow-up is
[`b6f3ede`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b6f3edea0fc3fe624e04ffbd0ca45b7a8f5f1044).
Its own [MotoGP CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39350085945)
was queued when checked. The green `85ceda3` run is not represented as a hosted
pass for that newer source; its production build, 96-test integration gate, and
scoped local browser evidence are identified separately above.
