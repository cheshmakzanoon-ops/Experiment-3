# Isolated original Formula grounding probe

**Source/build qualification only. Real GPU qualification is pending; no live
scene imports or enables this plugin.** Main remains physics 21. This increment
adds one isolated journey while retaining the existing twelve and their gates.

## Preserved effect and narrow domain

`src/engine/babylon/formula-grounding.ts` implements the original Formula
floor/nose/wing/four-tyre footprint and maximum-overlap rule using the qualified
neutral data/pose boundary. It adds no texture, mesh, geometry, separate GPU
buffer, draw, clock or second simulation. One caller owns CPU pose state; the
road/paint plugins borrow it through existing material uniform buffers.

The original indirect attenuation is `1 - 0.6 * occlusion`; direct attenuation
is `1 - 0.32 * occlusion²`. Three puts hemisphere light in indirect diffuse,
while Babylon also accumulates hemisphere contributions in its direct-light
bases. The plugin retains native accumulation, separately observes the
hemisphere contribution and carries it through pinned native albedo, clamp,
intensity, AO and specular-energy operations before post-AO recombination.
It does not multiply final color or change material/normal/roughness factors.

Support is intentionally limited to the actual opaque dry-road/paint default
BRDF/F0/IOR state, finite nonnegative light/material values and hemisphere or
directional lights. Shadows, reflection/environment, transmission, clearcoat,
sheen, nontrivial AO, override BRDF/maps, custom resolvers and unsupported mesh
variants reject explicitly. Nonnegative public F0 fields alone were found
insufficient to prove native diffuse signs; the domain was narrowed to the
actual original receiver configuration. Shader anchors are pinned and checked
at construction/composition; global ShaderStore contents are untouched.

Three has **no positive native sky-specular reference without an environment
map** in this scope. Applying its measured indirect factor to Babylon's additional
hemisphere-specular term is an explicit semantic mapping policy, supported by
the original shared indirect multiplier. It is not measured cross-renderer
sky-specular parity or full PBR/lighting parity. Mixed-light closure uses each
renderer's own native baselines rather than equating different PBR weights.

## Independent reference and future GPU acceptance

The original-reference/metric code was frozen before candidate source existed:
three-file manifest SHA-256
`f33f36f30a664e0a1ecfe1619a254027435aa908ba9c5d0195181744a9865089`.
It uses actual original road/paint factories and the installed grounding hook,
with actual StudioFrame outputs checked against the pre-edit pose oracle
`6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe`.
Flat, overlapping and banked/height-gated layouts exercise sky, sun and mixed
lighting on both receiver types.

The **unchanged 120-second harness** must complete 145 captures, including
45 original repeat comparisons. Original receiver IDs alone determine eroded
sample masks. Original repeats, required native denominators, native closure
and omitted/wrong-yaw/wrong-height/swapped-factor controls must qualify **before
candidate pose/material allocation**. Candidate holes cannot reduce the mask;
limits are not fitted to candidate output. Missing required denominators,
unexpected active terms, nonfinite/negative/out-of-range values fail. Deliberately
absent terms remain exactly zero on both sides, with no epsilon division.

Material-local observers read actual native final terms at priorities 240 and
300 around the application at 250. They do not report the plugin's private
attenuation calculation as proof. Prelighting captures require unchanged
albedo, native roughness, normals and emissive factors. Six native variants,
complete shader sources, GL/resource/fence receipts and images must be retained
by the future journey.
A completed zero-count draw establishes two non-null bound-effect identities;
changing count/factors must preserve them. Compilation alone is not that witness.

Native before/after values are packed into two 16-bit words across RGBA8 over
`[0,16)`. Raw bottom-up `readPixels` bytes retained as base64 are authoritative;
PNG images are inspection aids because alpha is data. A zero/low-alpha raw-byte
round-trip contract prevents silently using a lossy canvas transport for metrics.
The original repeat limit is zero; cross-renderer ratio allowance is one byte
maximum and 0.1 mean. Native closure uses original-only bounds plus a fixed
quantization allowance, not a post-failure relaxation.

## State and lifetime

All active pose values, including float32 representability, validate into a
temporary array before atomic commit. Count shrink clears unused slots;
cancellation during input access is rechecked before mutation. The preserved
legacy helper remains permissive separately; its malformed-input compatibility
is not permission to upload invalid GPU uniforms.

Cancellation/context loss permanently invalidates and clears the owner;
restoration does not rearm it. Scene/explicit cleanup detaches listeners.
Disposing one material invalidates its plugin, not another material's borrowed
owner. The fixture explicitly disposes the owner even if an earlier scene
observer skipped its hook. Allocation/preparation/disposal retain the existing
exclusive GPU owner. Defines do not change with active pose count.

## Final offline verification

The final guard ran **05:30:01.939–05:37:44.174 UTC on 2026-11-01**, base
`28b9d516568c4cb72f8db91796cb550064749e23`. All **5,558 inputs stayed unchanged**.

- Full TypeScript, full lint and owned formatting passed.
- Exact Babylon selector: **357/357, 35 files**.
- Separate original/neutral/look selector: **160/160, nine files**. Thirty
  existing asphalt cases overlap; these are not 517 unique tests.
- Unchanged production build, all three isolated IIFE bundles, content checks
  and **13-journey discovery** passed. No browser ran locally.
- Thirty-three qualified original inputs, three frozen reference files and
  nine later pinned native sources remained exact.
- Workflow change is only three fixture push paths. No job, deadline, quality,
  security or publication setting changed; path assertions cover the additions.

Owned eight-file plus separate workflow manifest:
`f56bdc4baeaa935ea5ef35899578029c20b2ad554bbe7dbb9e616e49c1fbe483`.
Final validation receipt:
`b3f23d41796962064904f08b18e45073b61e54264b3ad74f3eb8206517720031`.
Guard receipt:
`69ac8f582f368a75c52755c167d47c77ee4f82cc940d42dac2a0c520ab81dcf6`.
All-input manifest:
`ca8d27b360c63f9d85c443d226795eef97277113f37279a638581ddee73936ea`.

Retained failures include an explicit-zero reference guard initially using
Vector4's default w=1, two formatting-sensitive test assertions, an unbound
cache witness, and the first full TypeScript guard's two typing diagnostics.
The cache witness was strengthened to require an actual completed draw. The
last two corrections were one equivalent Boolean truthiness expression and a
number annotation on an intentionally throwing test getter. Frozen references,
shader math, comparison bounds and quality gates were not loosened. Independent
source review and correction addendum found no remaining static blocker.

Next is exact-source Actions GPU execution and inspection of every retained
reference/control/native result. A failed original control, budget or cleanup
check remains failure. Live grounding, GP grounding, shadows/environment,
wet/scanned layers, light pools, full-mode migration and physical-hardware/native
Linux reliability are separate work; none is accepted by this offline checkpoint.
