# Full-lap surface and weather continuation

Baseline: `1984adc5eee7b4688fcafab6c27ff379b4def17a`, exact tree
`72a33c9d1f731ed5a65061ded48ba4e47269a0d6`; its ordinary CI run
`36322146621` passed. This continuation preserves the compact HUD, dusk fill,
static circuit transforms, authored car/people, camera-detail and pit fixes.
It does not claim complete Phase 27, photoreal parity or human race acceptance.

## Implementation and observed scope

The baseline's full-lap and populated-race captures were inspected from artifact
`10933082916` (SHA-256
`b0a6e74e62ca074485bbb2001089cb18b9b5fdbbc887a9c040a030b6c2bfbf79`).
The road's close-range detail was predominantly stochastic speckle. Its original
512px, 0.64m asphalt tile now contains irregular, rotated fractured aggregate,
softened shoulders, binder and restrained mineral variation. The same physical
stone field controls colour, height and roughness. Initial rounded profiles were
rejected after map inspection in favour of independently perturbed facets.
The original roughness/bump material pipeline, UV scale, water-film clearcoat,
regional weather, road geometry and all physical surface state remain intact.
Grass, gravel and concrete texels reproduce the previous recipe byte-for-byte.
The old recipe is retained only in the test fixture, not shipped in the game.

Rain's regional haze previously sampled each billboard's template corner near
its mesh origin, although depth and lighting already used the real drop centre.
The local-weather hook now uses that centre as well. The shader cache key includes
the injected position expression so the two paths cannot alias a compiled shader.
Rain count, velocity, opacity, lighting, depth and simulation are unchanged.

Local height fog now rejects only a Gaussian tail whose conservative optical-depth
bound is at most one third of 1e-6. Three pockets therefore omit no more than 1e-6
optical depth; exponential transmittance is 1-Lipschitz for nonnegative depths.
The bound uses the minimum radial distance and minimum height over the SAME clipped
ray interval as the original eight-node quadrature. Those independent minima can
only overestimate the density, even when they occur at different ray positions.
Dense crossings, including long-lens views from far away, keep all eight samples.
No camera-distance cutoff, reduced pocket count or coarser quadrature is introduced.
A zero-budget test control bypasses both the new bound and the early return.

## Cost and regressions

No new GPU texture, geometry, draw call, particle pool or per-frame CPU allocation
is introduced. The aggregate author uses a temporary 393,216-byte stone table;
the returned albedo/height/roughness arrays remain 2,359,296 bytes in both versions.
This detail has a real loading cost: an alternating four-pair local measurement
with one warmup per recipe averaged 53.06ms before and 149.49ms after for one 512px
map set on Node 22.16.0. These are development-container authoring observations,
not loading-time guarantees, resident memory, GPU timings or game FPS. Reproduce:

```sh
node --experimental-transform-types scripts/surface-authoring-cost.ts
```

The frozen local `npm run check` passes 119 files / 1,203 cases, ESLint, strict
TypeScript and production build. Ten new unit cases cover tiling, determinism,
physical scale, registered maps, unchanged other surfaces, malformed inputs,
1,200 varied fog rays, distant/vertical/zero-length rays, shared uniforms and the
rain-coordinate regression. The original master directive and dependency lock
remain unchanged. The build retains its existing large-bundle warning.

`e2e/37-race-surface-atmosphere.spec.ts` adds three real-GPU comparisons: actual
road materials against the old texel recipe; production rain with an explicitly
exaggerated fog strength to expose the coordinate error; and the asset-loaded
full scene at grid, low district, high district and distant district views.
They require unchanged resources/draw counts, exact held/restored pixels and at
most one 8-bit channel step against the original fog integral. Synchronized
render measurements alternate control/candidate order, but no speed threshold
is used to hide host variability. These controlled poses are not race footage.

Local Chromium could not create WebGL2. GPU results must therefore be read from
this exact commit's ordinary hosted CI, not inferred from the local unit pass.
The existing dry/sunset/wet full-lap, populated grid/traffic, complete pit-service,
compact 30-second whole-application performance export, replay and numerical
race suites remain unchanged and independently required.

## Release boundary

Deploy only the resulting successful ordinary-CI source with production bytes
matched to that run's release artifact, on the existing app origin. The historical
tracked `playable/` directory is not the release source. Confirm SOURCE_COMMIT.txt
and the app's runtime source fingerprint; an uploaded artifact alone is not a
public deployment. Existing local settings, liveries and team saves must survive.

The uninterrupted human Section 146 audiovisual drive, physical Windows/controller/
wheel measurements, subjective handling/audio review and broad final-art approval
remain separate. This source does not manufacture acceptance receipts or declare
all 148 directive sections and all references complete.
