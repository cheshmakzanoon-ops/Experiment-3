# Temporal AA depth rejection

The temporal resolve now checks whether a previous image texel belongs to the surface being rendered. This addresses stale foreground/background colour at disocclusions, while preserving the existing Halton jitter, HDR blend, YCoCg variance clipping, rigid chassis reprojection and sharpening pipeline.

## Coordinate and history ownership

The current colour/depth image is sampled on its **current jittered pixel grid**. The resolve reconstructs it with the inverse of that exact jittered projection, including off-axis camera offsets. The previous image is sampled through the **previous successful resolve's jittered view-projection**. Subtracting the current jitter from the previous projection would use a different grid from the one that produced the history.

The resolve owns its previous camera projection and rigid chassis matrices. They advance only after the resolve draw succeeds. A failed scene/stage draw, failed resolve, camera replacement, hold, cut, seek, quality reset or resize invalidates history before it can be reused. A second resolve call for the same begun frame returns the existing result without accumulating it again. An abandoned jittered projection is restored at the next begin or disposal.

The supported production path is conventional WebGL perspective depth. Orthographic, reversed-depth, WebGPU-coordinate and out-of-range camera inputs do not activate this TAA path. SceneAmbientPass also checks logarithmic/reversed renderer capabilities before the first scene draw can modify the camera. This does not add support for those modes to the other scene effects.

## Depth encoding and filtering

Each existing RGBA16F history texel contains:

| Channel | Meaning |
| --- | --- |
| RGB | Resolved linear HDR scene colour |
| A > 0 | Positive linear view distance in metres |
| A = 0 | Clear sky or invalid/out-of-range geometry |

The first frame writes valid geometry depth even though no colour history is available. Current background pixels use the current image directly. A previous background texel cannot pass a foreground depth test. Clear depth is tested against exactly `1.0`; the former style of broad `0.99999` thresholds would discard substantial distant Festival geometry.

The expected depth is measured in the **previous camera's view space after applying the previous rigid chassis transform**, rather than comparing old depth to current camera distance. Reciprocal depth gradients account for sloping planar surfaces at each sampled texel. Excessive gradients at discontinuities disable plane extrapolation and reduce history confidence.

Depth is fetched at individual texels before colour interpolation. The original five bilinear Catmull-Rom taps cover 12 distinct texels. The new resolve reads those texels explicitly and reproduces the same Catmull-Rom interior kernel when they are compatible. At an edge it uses only depth-compatible central bilinear contributions, scales confidence by their surviving weight, and halves edge feedback. If no contributing texel is compatible, it returns current colour immediately. It never interpolates foreground and background depths into a fictitious intermediate surface.

The existing neighbourhood variance clip and motion-dependent feedback then operate on the accepted colour. They continue to bound colour/lighting changes independently of geometric rejection.

## Precision and cost

Storing nonlinear device depth in half float would lose most useful distant-depth separation. Positive linear depth instead has at most approximately **0.049% round-to-nearest relative error** for normal half-float values. The actual near/far ranges, 0.045–7,000 m for circuits and 0.3–26,000 m for Festival, fit comfortably below the 65,000 m supported limit. Geometry beyond that encoding range is not silently clamped to a false matching depth.

The comparison allows a 2 cm minimum or 0.2% relative error, plus a conservative source-depth uncertainty. The source scene attachment still stores conventional Float32 device depth. One device-depth ULP corresponds approximately to:

`distance² × 2⁻²⁴ × (1 / near − 1 / far)`

At the very distant end of these unusually wide depth ranges, source precision dominates half-float history precision. The resolve reduces confidence when that uncertainty exceeds the relative comparison allowance. This is not a substitute for a separately validated change to the complete renderer's depth convention.

| Resource | Before | After |
| --- | --- | --- |
| Temporal fullscreen draws | 1 active resolve | 1 active resolve |
| History targets | 2 × RGBA16F, no depth attachment | Unchanged |
| History colour/depth fetches | 5 bilinear history fetches | At most 12 point fetches; 4 when central rejection/fallback ends early |
| Current colour neighbourhood | 3 × 3 | Unchanged for accepted history; rejected pixels exit early |
| Added render-target storage | — | 0 bytes |
| Total history backing storage at 1920 × 1080 | 31.64 MiB | 31.64 MiB |
| Total history backing storage at 3840 × 2160 | 126.56 MiB | 126.56 MiB |

The diagnostics report the layout's `historyBytes`, maximum `historyFetches`, active draw count and history validity. These byte counts describe the two full-sized backing images once allocated; they are not a measurement of driver residency. Fetch counts are static bounds, not a GPU timing claim.

## Alpha consumers

SSR consumes material alpha from the scene image before temporal AA. It therefore keeps its roughness metadata. Temporal AO owns a different history. Motion gather uses RGB. SceneAmbientPass is the first consumer of the resolved TAA texture and now restores outgoing alpha to `1.0`; internal depth must not reach composer output, captures or subsequent effects as transparency. CAS reads RGB after that boundary and already writes opaque alpha. The velocity diagnostic output keeps its explicit geometry mask.

## Verification

`tests/temporal-depth-rejection.test.ts` exercises matrices actually bound to the resolve draw, including consecutive jitter grids, off-axis camera motion, rigid chassis history, previous projection ranges, failed/unfinished frames, holds/resets, duplicate resolves, unsupported depth paths and disposal. The precision checks sweep both complete production depth ranges with Float32 device-depth quantization and nearest half-float history values.

`e2e/temporal-depth-rejection.spec.ts` builds the real production scene, TAA and composite shaders in a small asset-free WebGL2 fixture. It captures a moving foreground over a high-variance background, compares the result with an identical-RGB history whose depth alone is deliberately falsified, and checks compatible static/rigid history, sky rejection, held/resumed frames, 24 km geometry, finite outputs and opaque outgoing alpha. The fixture emits numerical diagnostics and reviewable PNGs. It requires an actual supported GPU/browser run; successful Node tests or a TypeScript build do not prove its assertions.

## Remaining limits

Rigid chassis footprint classification is still approximate and shared with the existing motion approach. This change does not provide mesh/object IDs, per-vertex motion vectors, wheel rotation vectors, skinning velocity or a transparency reactive mask. A moving rider, foliage vertex or particle can retain a similar depth while changing its shading, and a background point inside a chassis footprint can still be assigned an approximate rigid motion. Existing variance clipping limits some of those errors, but the depth check cannot identify every such case. Image quality and GPU cost should be reviewed on the actual gameplay cameras and target hardware after the focused correctness fixture passes.
