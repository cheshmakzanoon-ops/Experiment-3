# Supplied-player full-race runtime recovery

Source baseline: `5eae26e45ae6d2c902792e50588ea95836912110`.
Failed hosted run: `36445863041` (2026-09-28). This is a runtime correction
candidate, not a claim that its complete browser or publication gate has passed.

## Observed failures

Six ordinary-race cases failed across browser shards 3, 4, 7 and 8: clear/day
and sunset full-lap captures had six/eight frames rather than more than ten;
one 30-second wet-night performance window had five samples rather than more
than five; two wet-following event reviews were interrupted by session finish;
and an eight-car wet-night paused-grid preparation exceeded its 60-second check.

The retained shard-3 wet-night full-lap report has eleven samples over 84.847
seconds, a 7469.784 ms median GPU observation and approximately 108 ms mean CPU-render
observation. Its separate timed performance window has five samples over 33.161
seconds. These are software-GPU/automation workloads, not target-PC frame rates,
and do not establish that all six failures have one cause.

## Corrections

* Preparation now compiles against the existing composer's linear scene target,
  not the canvas's unused tone-mapped variant. Target, face/mip, viewport and
  scissor ownership return synchronously before awaiting compilation. A bounded
  preparation trace reports actual stage wall times, completion, cancellation
  and errors in ordinary renderer diagnostics; it does not advance physics.
* Both offscreen pit-material layouts still warm before grid release, but the
  submissions exclude unrelated draw surfaces by temporary layer masks. Child
  lights, the real scene lighting/environment, crew poses and target format are
  preserved. Masks and renderer/crew state are restored even on failure, before
  any asynchronous wait. No staged pose enters the simulation or recorders.
* The 58-joint source rig can use its exact float32 bone matrices as vertex
  uniforms instead of repeatedly fetching matrix texels for every influence.
  The source weighted-position/normal equations remain unchanged. Eligibility
  requires a single shared skeleton per material, at most 64 joints, and the
  device's vertex-uniform limit with 128 vectors reserved for other uniforms.
  Unsupported cases retain bone textures. The existing same-program shader
  control still exercises the original texture lookup as an independent oracle.
  A view of Three's palette storage tracks its initial padded-texture allocation;
  normal frames neither copy matrices nor allocate a new view.
* Sixty-one source skinned primitives now have conservative posed bounds. Per-
  joint bind-space boxes contain every source vertex with a positive influence;
  their transformed union bounds linear blend skinning, including non-unit
  positive weight sums and a float32 upload margin. Bounds are invalidated on
  real pose updates and shared by index-only LODs. Attribute/bind/morph changes
  use the original exact bound calculation; unsupported signed/malformed data
  does not enable the optimization. Teardown restores original ownership.

The source GLB and derivative manifests/binaries, steering/camera sockets,
materials, physics, weather, race duration, input, replay and recording rules
are unchanged. This does not substitute a cheaper model or a lower preset.

## Evidence and acceptance

Added CPU tests check all actual source skinned vertices at neutral, both locks,
translated poses and rewind, plus conservative culling, subset-LOD reuse,
attribute/morph fallbacks, cancellation/error ownership and trace bounds. The
existing actual-binary GPU material test retains every original threshold and
adds zero-pixel-error culling comparisons with an uncullable reference, along
with submitted-call/triangle and stable-resource checks. Its original shader
oracle also compares the palette path with the original texture path.

The six failing race cases, all eight browser shards, original timeouts,
frame/event requirements, zero retries and successful-artifact publication gate
remain mandatory. A local unit/build pass does not certify hosted WebGL results.
Only the final source commit's normal CI can establish full browser acceptance;
only its successfully published exact artifact can establish deployment.
Physical-hardware profiling, manual full-race driving, artwork approval and Steam
acceptance remain separate. No measured performance improvement is claimed here
without the new candidate's corresponding GPU reports.
