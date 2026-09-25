# Phase 27H.5 — lighting, weather, materials and motion coherence

Baseline: `a3bb756414cb1c1e5e0d5b926cc8c1c7379acbd3` (27H.4).
This checkpoint implements the next presentation work package in the existing
Three.js game. It does **not** certify final art, every reference, target-PC
performance or Steam readiness. The exact-source validation record is
[PHASE_27H5_VALIDATION.json](PHASE_27H5_VALIDATION.json).

## Integrated changes

### Lighting and material coherence

`lighting-coherence.ts` gives the existing directional/hemisphere lights a
shared linear-space palette for day, sunset, heavy cloud and night. Overcast
reduces the warm sunset key rather than leaving an orange light below grey
cloud. Lower-sun normal bias is reduced while the existing texel-snapped shadow
projection is preserved. Light intensities, the environment generator and
sky/road/car physical state retain their existing owners. This is authored
lighting, not a calibrated photometric model.

`WeatherPresentation` binds after circuit construction and batching and also
binds newly installed car materials. Explicit stone, paving, concrete, timber,
metal, paint, kerb, grass, gravel and cloth roles receive different dampness
responses. Porous surfaces darken without all becoming mirrors; fabric and
vegetation keep broad highlights. Instance/skin deformation, prior material
hooks and shader cache identity survive. The actual authored pit-cloth material
is included, not only a legacy fixture helper.

Non-road dampness is reconstructed from the **presented snapshot's** rain and
mean track water, with orientation and filtered broad variation. Downward-facing
surfaces remain dry; verticals have a smaller response. It is explicitly an
approximation, not a second water solver, roof-occlusion calculation, fabric
saturation or local off-track puddle simulation.

### Wet roads, rain and spray

The existing spatial road water/deposit texture remains authoritative. The road
shader adds derivative-filtered ripple normals only where the actual water
field forms puddles and presented rain is nonzero. Both the base normal and
clearcoat normal receive the perturbation; rain also broadens the water coat's
highlight. Ripple time/wind come from the presented snapshot, so pause and
replay reconstruct the same surface. Rainless standing water does not ripple
from a decorative wall clock. Deposit-free pit-road semantics remain intact.

Rain streaks no longer use a fixed self-visible colour independent of the
scene. Rain and wheel spray share bounded directional, hemisphere, ambient and
attenuated point-light response. Existing rain geometry, opacity, near clipping,
fog, physical emissions and particle pools are retained. Floodlights illuminate
precipitation without introducing extra light sources. This is a lightweight
single-scattering-style approximation, not volumetric light/shadow transport.

### Atmosphere, cameras and motion

The local height-haze shader now integrates around each pocket's actual ray
interval. Three samples spread over a long broadcast sightline could miss a
narrow pocket; eight bounded quadrature samples within that interval preserve
its contribution. CPU reference checks compare the same method with dense
sampling and test ray reversal. The original weather density and authored
pocket locations are unchanged. This increases fragment arithmetic in active
haze and still needs representative-hardware profiling.

Camera cuts retain the viewer's adapted exposure while invalidating pending
GPU samples from the old view. Lighting changes, replay rewinds, large time
jumps and disabled/photo/menu states reset as appropriate. The existing async
meter remains bounded to one read in flight, with no synchronous polling added.

Local cube reflections now use presented simulation time while racing/replaying
and additionally refresh when the scene environment texture changes. Switching
lighting while paused cannot leave an old daytime cubemap until the clock moves.
A failed capture never becomes the published reflection; the existing two-target
ownership and restoration paths remain. Continuous intensity changes do not
force a cube recapture on every frame.

## Executable coverage and evidence

The new unit suite covers presented-snapshot weather/rewind, all material roles,
real cloth hooks, physical road ownership, shared rain/spray light inputs,
exposure camera-cut generations and late readbacks, localized haze, and paused
reflection refresh/failure. An existing exact road-uniform assertion is updated
to include the new snapshot uniform and verify its zero defaults/texture owner;
its original water and bump checks remain.

`e2e/27-visual-coherence.spec.ts` adds two distinct evidence paths:

* An **isolated GPU fixture** compares dry/wet/held/rewound materials, animated
  rain-driven clearcoat, rainless standing water, unlit/warm/cool/floodlit rain,
  stable resource counts and five lighting/weather conditions.
* Four **ordinary-application full-lap cases** use real menu controls, the
  existing autonomous demonstration driver, the existing full-lap review
  recorder and actual recorded replay. Clear daylight/cockpit, sunset/pod,
  wet daylight/chase and wet night/trackside runs retain videos, frame-report
  exports, application diagnostics and replay-camera captures. Full-lap
  completion requires the existing distance and lap-crossing conditions; no
  snapshot injection, time acceleration or completion-label override is used.

Pure overcast is a material-fixture condition. The current session menu has no
independent persistent pure-overcast mode, so these tests do not invent one or
claim a complete normal-game overcast lap. Full-lap videos still require human
inspection for silhouettes, glare, clipping, pit/kerb/braking presentation and
reference discrepancies. They cannot automatically certify aesthetic quality.

The local run passed lint, strict TypeScript, production build, **1,025 tests in
101 files**, matrix regeneration/check and all eight existing numerical scripts.
Fifteen actual Three.js-generated shader variants compiled and linked in native
Mesa GLES, including skinned cloth, instanced materials, clearcoat and lit/unlit
precipitation. That is shader compilation, **not normal-browser visual proof**.

The local browser attempt could not create a WebGL context for the fixture and
normal application navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`. Neither
is a pass. The new tests remain enabled for the normal hosted CI. Consult that
exact published revision's results; the baseline's green CI is not evidence for
these changes.

## Preservation, budgets and reproduction

Physics, track layout, water/grip equations, simulation/input/replay/worker/audio
source, original Blender/GLB assets, dependencies and CI configurations are
unchanged. Eighty-three protected files were compared byte-for-byte. The
acceptance matrix is regenerated only to refresh source/file hashes: **0 PASS /
230 PARTIAL / 2 FAIL required rows plus 16 excluded references remain**.
No final-art approvals are granted by these tests.

No geometry, texture resource, live light or render pass is added. Existing
reflection capture can run when lighting changes while paused, and active local
haze performs more arithmetic. Neither a CPU test nor a software-renderer result
establishes the minimum-PC frame rate or VRAM budget.

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/phase27h-matrix.ts --check
npm run test:e2e
```

The local complete unit run used `--maxWorkers=2`. Existing test assertions,
timeouts and CI jobs are not removed, relaxed or skipped. The new full-lap cases
have their own budget covering the recorder's existing ten-minute ceiling.
27H.6 reference/hardware acceptance, the later racing/game-feel/robustness phases
and the final human integrated drive remain separate obligations.
