# Supplied-player full-race stability continuation

Base: `8dc2b2691332a3d42fd5aa98af21ff62ee47340d` on `main`.
This is a repair candidate, not full-race, hardware, final-art or Steam approval.

## Evidence that selected this work

Build and validation `36418088324` failed on the pit-service review and the
clear-day/sunset full-lap frame counts. Its source/build, scenarios, dedicated
wet/player GPU job and five browser shards passed. The publisher was skipped.

The clear-day shard-8 trace records eight review frames, roughly 8.7–10.2 seconds
of reported GPU time per presented frame. Diagnostic evaluations themselves are
short; increasing their timeout does not repair that rendering workload.
The shard-5 pit trace shows the real 15-person service. A rendered removal-phase
sample at simulation time 96.875 has only 0.0773 m jack height; the next observed
installation sample is already at 98.8929. The required raised/unloaded removal
observation is absent. These are software-GPU traces, not consumer-device FPS.
A first-use pipeline stall is a candidate contributor, not a proven sole cause.

## Implemented changes

`supplied-shader-work.ts` avoids reads for exactly zero skin weights while keeping
all four original weighted additions, bind matrices, source weights and normals.
It also reuses the roughness lookup for metalness only when the two maps are the
same texture object. Independent maps/UV transforms retain independent reads;
a per-draw identity guard survives later shader-hook cache wrappers. A uniform
opt-out retains the original paths for same-program GPU comparisons.

The original GLB remains SHA-256
`013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`.
An audit of its 243,834 distinct WEIGHTS_0 vertices found 181,312 with one nonzero
influence, 58,127 with two, 4,380 with three and 15 with four. The corresponding
matrix-read opportunities are 975,336 versus 310,766. These are source-vertex
operation counts, not submitted-LOD counts, measured GPU gains or an FPS claim.
All model binaries, LOD indices/manifests, materials/maps and physics remain.

`pit-material-warmup.ts` exercises the existing near/mid service vertex layouts
in a temporary 32x20 half-float target before grid release. Its isolated staging
copy is never sent to the worker, normal renderer.draw, replay or review recorder.
The original crew and render target, viewport, scissor, XR and shadow ownership
are restored synchronously before any awaited callback, including failures.
The target is disposed on success, error or cancellation. Startup also waits
nonblockingly for its actual camera submissions rather than only shader linking.
Both the real paused grid and all actual pit-service timing remain unchanged.

The original full-game tests retain their frame/event thresholds, resolutions,
opponent counts, timeouts, zero retries and complete shard coverage. Additional
checks require offscreen warmup to have executed, compare optimized versus
original player pixels exactly, and retain completion diagnostics before a
full-lap frame-count assertion can fail. The publisher still requires all gates.

## Executed validation and remaining gates

Local: 13 focused regression cases passed using Node's native test harness on
the same assertion bodies authored for Vitest. They cover weighted arithmetic,
shader composition/map identity and warmup resource/state restoration on success,
error and cancellation. Changed TypeScript files also passed syntax diagnostics
with the locally available TypeScript 5.8.3; this is not the locked-project tsc.
The Three.js 0.180.0 runtime for these checks was recovered from the exact tested
build's source maps. Direct dependency installation was unavailable locally;
local Chromium also could not provide WebGL2. No local full npm-check or browser
pass is claimed.

The new commit must pass the complete locked-toolchain CI, the independent actual
model GPU oracle, all eight browser shards and the unchanged publication gate.
If a gate fails, its evidence is authoritative; neither this report nor a source
push certifies repair completion. Real-device profiling, a manually driven race,
final visual review and exact-release hosted verification remain independent.
