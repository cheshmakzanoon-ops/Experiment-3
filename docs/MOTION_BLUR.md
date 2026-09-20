# Bounded camera and rigid-object motion blur

Sections 62, 92 and 133 now have a real optional render path rather than a setting
that merely changes a label. The garage slider controls a shutter fraction from
0 to 0.6. Every preset defaults to zero. Zero disables the composer pass entirely:
there is no velocity render or fullscreen blur submission while it is off.

## Data and rendering order

After the normal scene render, a half-float RGBA target records signed UV motion
in red/green, linear view depth in blue and coverage in alpha. Rigid objects use
both their previous model transform and the previous camera view-projection.
The driver's cockpit therefore does not acquire artificial motion just because
its car and camera translate together. Static instanced geometry uses its actual
instance matrix. Alpha-tested fence textures retain their cutouts in this pass.

Seven current-frame color samples follow the measured motion vector. Samples
crossing the frame boundary, missing coverage or a depth discontinuity are
rejected. The sweep is limited to 24 physical render pixels. The pass precedes
bloom, tone mapping and FXAA. HTML instruments, dialogs and accessibility text are
not inputs to it. It is not a radial speed smear or an accumulation of old images.

Transform history resets after a camera-mode change, resize, replay rewind or a
large forward seek, frame gaps over 120 ms, translation cuts over 25 m, large
orientation cuts or abrupt field-of-view changes. A newly visible rigid object
has no stale historical motion. The first frame after invalidation renders
without blur. Render-target, clear-color, callback, visibility and shadow state
are restored even when a velocity draw throws.

## Supported scope and cost

The pass requires WebGL2 float color-buffer support. A device without it keeps
the original unblurred pipeline, and diagnostics explicitly report unsupported.
The slider's saved preference is not misreported as an active effect on such a
device. GPU and render CPU measurements include the additional submissions.

This is a real-time screen-space approximation, not a stochastic shutter model.
It follows rigid mesh transforms (including articulated driver and wheel meshes),
not per-vertex deformation or independently changing instance matrices. Sky,
line overlays and particle geometry do not contribute their own velocity field;
color at these pixels can use covered background motion. Depth rejection avoids
large foreground/background streaks, but cannot reconstruct hidden surfaces.
Use zero for the crispest presentation or to reduce GPU work.

## Verification

Unit tests check off/unsupported behavior, input bounds, target sizing, history
identity, previous-versus-current object matrices, cut/seek/hitch invalidation,
resource disposal and restoration after failed draws. A native Node oracle runs
those actual production history and ownership paths independently of a GL driver.
That oracle is not evidence that a shader executed on a GPU.

`e2e/motion.spec.ts` bundles a test-only fixture in memory; it is not included in
`dist/`. Chromium creates a real WebGL2 renderer and reads actual velocity pixels.
The expected motion is independently calculated from the pinhole projection. It
checks zero first/stopped/co-moving motion, nonzero translated-object motion,
measurably changed image pixels, depth and coverage, and camera-cut resets.
The existing presentation browser workflow enables the slider through the UI,
reloads persisted settings, drives a real car and observes velocity submissions.
These tests are required publication gates, not a claim about untested consumer
hardware or universal visual preference.
