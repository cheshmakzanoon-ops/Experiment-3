# Live Formula road and edge-paint boundary

The isolated source at `2caf3413013f522c74f708262996c437e9433744` passed the real WebGL paint-factor and short-range
surface probes before this live integration: all four paint-factor cases matched
Three r180 exactly in RGB8, with zero GL errors; both authored paint bands were
visible in all four sampled views, including grazing. That does **not** certify
this new full-lap workload or native startup performance.

## Scope and eligibility

The Babylon workbench supplies actual simulation vehicle definitions and explicit
circuit presentation context. Only all-Formula/four-wheel sessions with matching
entrant count and canonical Aurel or Vellamar definitions activate original road
and edge paint. Absent/unknown, GP, MX/SX, open-world, non-Formula and noncanonical
contexts keep the existing coarse +.010 m diagnostic road unchanged. An eligible
construction failure propagates; it never silently falls back.

The full original road (zero lift) and two +.006 m paint bands replace the coarse
road together. No overlap, reduced columns/steps, new authored textures, physics changes,
changes to original source datums or seam smoothing are introduced. Aurel has 38 road and 76 paint chunks
(31,882 vertices); Vellamar has 50 road and 100 paint chunks (42,700 vertices),
versus 3,074 vertices in the previous coarse surface. These counts exclude the
existing entrant proxy.

Paint retains the verified original construction grit/wear and authored colour.
**Asphalt material layers, paint grounding and light pools remain unported.**
This is not final road/environment parity. The shared Babylon BRDF LUT remains
scene-owned infrastructure.

## Ownership and readiness

Synchronous scene replacement remains inside startup/no-submission or the existing
GPU-ready restart drain. Simulation/input authority changes at the original
restart event, not after graphics catches up. A partially constructed scene is
cleaned on constructor failure, preserving the original error. Scene disposal
owns surface resources, including scene-first shutdown.

`SurfacePreparation` compiles all actual mesh/material variants through the
existing exclusive preparation lane. Normal scene submission stays suppressed
through every inter-variant yield; the render loop rechecks GPU ownership after a
rebuild. Ordinary owner cancellation is checked after the active lease drains,
not injected into a running compiler. Loss/disposal invalidate the existing lane.

After compilation, subscribe before enabling draws and require two ready GPU
completions owned by the current scene. The existing preparation deadline remains
unchanged. After the compiler lane drains, a cancellable timer enforces only the
remaining absolute budget for presentation, including a never-completing first
frame. It clears its subscription/timer on completion or owner cancellation; it
never abandons an active compiler. No compensating sleep or extended budget is
introduced. Resize also rechecks idle ownership after rebuild before consuming
its pending request. Paused presentation demand remains held until readiness completes.
Asset inspection is disabled throughout readiness. Read-only counts come from
live meshes/materials and are published only after current-owner completion;
restart, loss and failure clear them immediately.

## Acceptance

Local full-lap tests compare every road/paint attribute/index byte and strip
metadata against the original Three owner on both venues. They cover fallback,
actual-resource diagnostic changes, constructor failure and scene-first teardown.
Actual GPU-owner tests cover compilation gaps, ordinary cancellation/drain,
loss/disposal, other-scene/unready receipts and the final deadline. Existing
simulation and model preparation contracts remain required.

The real `/babylon.html` route legitimately selects Aurel. Its browser journey
now verifies original surface counts, restart invalidation, real context
loss/restoration (which alone does not revive readiness), explicit rebuild and
subsequent original model loading. A separate full-lap probe uses the actual
`BabylonCircuitScene` and `SurfacePreparation` classes for both Aurel and Vellamar,
without a hidden live query selector or fabricated status. It compiles all
115/151 scene variants including the unchanged proxy, checks completed frames,
GL/resources/disposal and retains screenshots/shader diagnostics.

Full live WebGL and native acceptance is **pending** until Actions runs this exact
source. Existing browser/native deadlines and quality are not relaxed. Paint
pixel counts establish authored-band visibility, not continuous seam coverage;
seams retain geometry-oracle evidence and image review.

Native validation also reads raw surface fields from its existing readiness snapshot, retains them, and validates the actual default Aurel counts through a pure helper. Missing/malformed/inherited/wrong counts and non-Aurel receipts fail. No extra page evaluation, render, action, wait or polling is introduced; the original 30-second presentation wait and frame gates remain unchanged.

Local integration validation passed 326 combined tests, followed by 98 native/trace tests after the native receipt addition. Root and desktop TypeScript, full lint, content and actionlint checks passed. Source-stable offline desktop preparation passed; the compiled entry and Three licence are included and source maps excluded. The full surface fixture bundles and 11 Babylon workflow journeys are discoverable. Real GPU/native results for this live increment remain pending.
