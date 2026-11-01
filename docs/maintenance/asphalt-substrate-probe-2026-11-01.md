# Isolated original asphalt substrate candidate

## Scope, not live activation

This increment implements an isolated Babylon material and controlled probe for
the existing Three factory `surfaceMaterial('asphalt', undefined, false)`.
Neither live game entry imports the candidate. Original Formula road geometry,
edge paint, production materials, scanned assets and physics remain unchanged.

This is **not** the complete racing-road material: scanned asphalt, road macro
and racing-line/rubber layers, wet state/water film, car grounding and light pools
remain unported. The racing-road owner uses the separate water-film factory and
additional hooks; zero wet state does not remove its unconditional road macro.
Prelighting factor agreement does not establish PBR/environment or complete
four-mode presentation parity. Linux native GPU reliability also remains open.

## Independent source boundary

The renderer-neutral data and independent pre-extraction oracle from `b3a0cc2`
are unchanged; see [data-boundary evidence](asphalt-data-boundary-2026-10-31.md).
The frozen compressed oracle SHA-256 remains
`7f77c6a276a62ab192f571a36746704215260f44d94c31aac2d450e456bd0fc8`.

Before candidate implementation, `e2e/fixtures/asphalt-reference.ts` was frozen
at SHA-256 `0de95c06939bd1d40b6bba2ca95f2f581d36018053ed3c7205ce4e78db707675`.
It invokes the **actual original factory and composed hooks**, not an extracted
shader reimplementation. Its seven independent source contracts were frozen at
`cb44337a13f9ed0cf71069b0137f411c7f3e5aaa14970f1d1a7c83f9bf5cf96b`.
Neither file imports the candidate or changes in response to candidate pixels.

## Material semantics and ownership

- Exactly three original 512×512 textures: hardware-sRGB albedo; linear packed
  R meso/G roughness/B coverage; linear Sobel tangent normal. Repeat, 7.8125 UV
  scale, mipmaps, trilinear sampling, anisotropy 8 and original upload flip-Y are
  retained. Raw bytes are not flipped a second time. The real probe records
  actual `texImage2D` internal formats, not gamma metadata alone.
- A 2D client-memory upload permits flip-Y; the WebGL 2 restrictions differ for
  pixel-unpack-buffer and 3D uploads. [WebGL specification](https://registry.khronos.org/webgl/specs/latest/2.0/).
- Actual emitted albedo order is micro mean compensation, meso tone, then
  construction finish/noise/joints—not installer-call order. Roughness retains
  G-channel sampling, micro compensation, meso roughness, Toksvig spread and
  coupled near-field glints. World-XZ and metre-UV roles remain distinct.
- Original rounded means (`0.09685`, `0.09461`, `0.09022`, `0.80508`), meso
  frequency `0.22222` and slope gain `0.26548` are retained. The derivative frame
  uses the original Three view-space algebra, meso/glint frame tilt, micro
  attenuation and normal scale 0.75 before returning Babylon's world normal.
- The scoped plugin replaces the pinned tangent-space normal call; Babylon's
  named bump hook belongs to the object-space branch and is not used. Required
  anchors/global source identity are checked at installation **and effect
  composition**, failing closed if changed. No global shader source is mutated.
- Persistent source/rounded-mean defines survive later plugin composition.
  Active mesh vertex colors are rejected rather than silently multiplying
  albedo: the original factory disables vertex colors. Disabled color buffers
  remain accepted and untouched; no mesh data or caller flag is rewritten.
  Per-submesh hard binding updates the view matrix and borrowed data sampler.
  The owner, not the plugin, disposes its three shared textures; the scene BRDF
  LUT remains scene-owned. Owner/material/scene teardown, partial-construction
  failure and sticky context-loss invalidation have deterministic contracts.

## Controlled GPU acceptance, preregistered before candidate evaluation

The added journey supplements all eleven existing Babylon GPU journeys. It uses
the unchanged isolated 120-second preparation/presentation budget and GPU owner;
no deadline, quality, security or original assertion is relaxed.

1. Measure the actual Three factory in five controlled views: near glints,
   micro-fade transition, far minification, banked/translated world position and
   a grazing two-chunk seam. Capture albedo, roughness and view normal separately.
2. Repeat all 15 reference outputs and require exact interior/coverage equality.
   Then independently damage original gamma, packed channel, normal orientation
   and meso-tone inclusion; every control must visibly discriminate. **Do not
   allocate or evaluate the candidate unless all references/controls qualify.**
3. Capture the 15 actual candidate prelighting outputs, bypassing lighting and
   output tone/color transforms. Encoding is RGBA8: linear albedo ×4,
   pre-renderer-clamp roughness ×0.5, view normal ×0.5+0.5.
   Roughness is read from native `metallicRoughness.g` after the candidate's
   priority-200 assignment by a priority-300 observer, before conversion/clamp.
   It is not read directly from the candidate's private computed scalar; a
   real-manager composition contract pins this order and output dependency.

| Gate                  | Fixed acceptance                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Reference repeat      | Maximum/mean RGB8 error 0; no coverage change                                                                  |
| Candidate             | Maximum channel error ≤1; mean channel error ≤0.1                                                              |
| Each negative control | ≥100 changed interior pixels and maximum error ≥3                                                              |
| Coverage              | ≥1,000 reference interior pixels; no missing interior or excess coverage outside the fixed two-pixel edge band |

The reference alone selects the two-pixel-eroded interior. Candidate holes do not
remove disagreeing pixels from comparison; no percentile/outlier exclusions are
used. Angular normal error is diagnostic, not a replacement for the fixed RGB8
gate. All original/candidate/control screenshots and numeric reports are retained,
including partial failure evidence. Shader errors, actual completed GPU receipts,
sampler limits, exact three-texture sharing and resource restoration are asserted.

## Verification boundary

Local source contracts, original-factory/data regressions, strict TypeScript,
lint, fixture bundling and journey discovery are recorded in the increment's
evidence manifest. Initial local typing failures are retained alongside their
corrected results. Independent review added the late-global-shader mutation
guard and active-vertex-color rejection before final qualification. Instanced
and morphed geometries are outside this probe's controlled GPU acceptance claim.

**Real GPU qualification is pending Actions.** No local Chromium launch was
attempted around the existing access restriction. CPU/NullEngine tests, bundled
shader text and discovered tests do not prove actual driver compilation or visual
parity. Reference tolerances will not be expanded to fit candidate results.
Even a passing isolated software-GPU probe would not authorize live activation,
physical-hardware performance claims or completed native/four-mode acceptance.
