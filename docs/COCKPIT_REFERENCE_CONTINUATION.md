# Cockpit reference continuation — 2026-09-19

## Baseline and directive

This continuation starts at `e6070622bb1f5d15cc724316061e71f4f7ac4e65`, not at the earlier unreferenced renderer experiments. Its complete normal Actions run `35446641303` passed validation, physics scenarios, all three browser shards and playable publication. The recovered **Pasted markdown(6).md** remains byte-identical to `MASTER_DIRECTIVE.md`: 148 numbered sections, SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`.

The re-uploaded F1 25 ZIP is byte-identical to the previous reference pack (SHA-256 `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`). All five contact sheets were re-inspected. IDs 048–065 remain excluded because they show unrelated products or other games. Repeated crops and promotional/context images are not independent gameplay evidence, and the platform of every image is not independently verified. See [the original reference audit](REFERENCE_VISUAL_REVIEW.md).

The close-up steering-wheel reference (003), cockpit compositions (034/037), and the actual baseline game capture drove this pass. The visible targets were unsupported mirror-image corners, a rectangular steering-wheel outline, flat gloves and sparse control detail. **This is an original implementation of the engineering qualities, not a tracing of commercial assets or UI. F1 25 visual parity is not achieved.**

## Functional changes — sections 58, 82, 92 and 123–125

### Mirror apertures

Each mirror now has a bevelled housing, a raised carbon bezel and a rounded rear-facing aperture. The 192 × 72 mm glass matches the existing 8:3 rear-camera aspect ratio, fits inside the shell, and sits ahead of the bezel rather than intersecting it. Normalized, bounded UVs make the actual render-target feed fill the aperture once. Both feeds still render the real scene, not a decorative image. Shadows on the unlit glass are disabled; the shell remains lit geometry.

### Steering wheel and real controls

The original butterfly-shaped wheel has a bevelled carbon body, fitted display surround, screws, ergonomic grips, button bezels, a shaped printed control panel and three knurled selectors. The live steering display remains a canvas updated from simulation state. The new dials consume the recorded brake bias, power differential and ERS mode; they do not invent setup changes or replace actual input controls. In particular, brake bias/differential reflect the setup applied to that session, not an uncommitted garage edit. ERS follows the recorded mode.

Dial pose is a stateless mapping of frame values, so pausing or seeking cannot accumulate an animation error. The existing inverse-kinematic shoulders, wrists, fingers, paddles and thumb actions retain their ownership. No tire force, steering assist, vehicle setup, protocol channel or storage format changed.

### Driver materials

Original periodic woven normal and roughness maps distinguish cloth from reinforcement and rubber. Two 128 × 128 RGBA data textures are shared across a driver's materials; they are linear data, mipmapped and subject to the existing anisotropic-filter setting. They are not giant colour textures with lighting baked in. Reinforced glove panels, gauntlets, knuckle strips and curved seams add close-range geometry. Smaller seam/finger tessellation reduces triangle count compared with the previously over-sampled tubes.

The texture budget recognizes only explicitly tagged decorative data maps. Physics surface-grid data textures are not resized, mipmapped or given artwork filtering. Renderer disposal owns the actual texture release; the budget only tracks references.

### Reflection history on replay seeks

A local reflection probe previously compared replay time against the last capture's later timestamp. Rewinding could therefore keep future-lap scenery until replay time caught up. Both local probes and mirrors now invalidate on a backward or discontinuous presentation time, an explicit renderer reset, or a cockpit-mode transition. They recapture at the next eligible pass without recompiling material programs. Stable paused frames do not repeatedly regenerate probes. Double-buffering, source/target separation, and failure restoration remain intact.

## Engineering validation

The local complete `npm run check` passed **527 tests across 54 files**, ESLint, strict TypeScript and production build. The 15 added unit cases cover rounded UVs and shell fit, invalid dimensions, shaped-panel bounds, real control values, stateless seek/pause mapping, deterministic fabric maps, selective texture filtering, mirror invalidation, backward-time probe recapture, batched mirror ownership, instance transforms and conservative rotating-detail bounds. Original tests and their thresholds remain present.

The browser suite now contains **29 cases**. Four focused real Chromium/WebGL2 cases were executed locally at the high preset and 1280 × 720. These ran through Xvfb with software rendering, not a representative gaming GPU:

- Existing clear/rain production reference tests passed: 12 images across exterior/cockpit and reflection/bloom transitions; all 24 sampled HDR cubemap faces contained finite RGB values.
- The new articulation case passed with five captures: neutral, left, right, paused and rewound. Steering and ERS changes entered through the real simulation input. Both rear-camera feeds had image content; wrists stayed reachable with the fixed 0.37/0.36 m arm lengths; selector angles matched recorded channels; source frames were unchanged; browser/WebGL errors were absent.
- Four additional alternating seeks remained bounded at 80 textures and 558 geometries after warming both probe targets. Two shared fabric maps emitted exactly two disposal events even when renderer disposal was called twice. The three selector instance sets also release their object-owned GPU attributes exactly once. This is a bounded repeated-seek check, not an hours-long memory-leak certification.

The first articulation fixture attempted to access a car before the renderer's lazy car creation; that fixture initialization was corrected with `setCars(1)`. A rounded-UV unit test also found floating-point values just outside [0,1]; the aperture builder now bounds the UV conversion. Assertions were not reduced to hide either failure.

The unoptimized candidate passed its three selected browser checks but failed the unchanged pit-scene budget in a broader local attempt: 105 draw calls against a strict limit of less than 100. Static mirror shells were moved into the existing body batches, preserving the independent rear-camera apertures. Each of the three selector material layers now uses one instanced draw with three independently recorded matrices. All knurl ridges, indicators and mirror geometry remain present. The same unmodified pit test now passes at **95 draw calls**. Conservative bounds contain the full selector orbit; frustum culling stays enabled. Instance attributes are explicitly disposed because shared geometry disposal alone does not release them.

The broad local browser attempt also encountered 15 administrator-blocked page navigations and did not establish full application coverage. Those restrictions were not bypassed, and the tests were not rewritten around them. The complete normal GitHub workflow is the environment for those application journeys.

The final normal GitHub workflow remains the publication gate for the whole suite: it must run unit/build/lint, native physics scenarios and all browser shards before copying the tested build to `playable`. Selected local/candidate tests are not a substitute for that result.

## Measured graphics trade-off

Identical three-car reference fixtures, seed 1887, tick 96, high preset, 1280 × 720:

| View | Baseline draw calls | Current draw calls | Baseline triangles | Current triangles |
|---|---:|---:|---:|---:|
| Clear cockpit | 661 | 689 | 752,041 | 742,685 |
| Rain cockpit | 652 | 680 | 734,881 | 724,125 |

The final detailed cockpit costs **28 additional scene-pass draw calls** over the original baseline, rather than the unoptimized candidate's 68. Trimmed seam/finger tessellation saves 9,356 submitted triangles in clear weather and 10,756 in rain; static batching changes culling granularity, so the submitted totals differ from the unoptimized candidate. End-of-fixture texture/geometry counters change from 85/747 to 94/768. Counts are the renderer's reported scene-pass statistics, not total frame GPU work or a 60 FPS claim. The dial transforms, seams and mirror silhouette remain intact; the new browser checks verify the GPU instance matrices against the actual recorded controls.

## Reproduction

```sh
npm ci
npm run check
npx playwright install chromium
npx playwright test e2e/04-reference-visual.spec.ts e2e/05-cockpit-detail.spec.ts e2e/pit-presentation.spec.ts
```

The HTML report contains the actual PNGs, `reference-review-metrics.json` and `cockpit-articulation.json`. On a Linux host with a system Chromium and Xvfb, `DISPLAY=:99 CHROMIUM_PATH=/usr/lib/chromium/chromium` selects that browser; the application itself does not require Xvfb. The test-only pixel readback, geometric checks and statistics are not added to the gameplay loop.

## Remaining acceptance work

Dry/wet and articulated cockpit images were inspected, but the driver still uses simplified procedural anatomy, the cloth detail is subtle at gameplay distance, the scene has sparse authored infrastructure, and lighting/material/temporal detail remains far below the requested reference. These tests do not establish dynamic rain visibility, audio fidelity, a complete human-driven section-146 race, or target-hardware performance.

An earlier full application capture showed a **replay recording-buffer gap** under a rendering stall. That separate producer/consumer back-pressure issue is not repaired by reflection invalidation, and uninterrupted archival recording is not certified here. Keep the existing explicit gap warning rather than masking it. Sections 2, 141, 146–148 remain open for integrated repeated review. No claim of complete 148-section acceptance or one-to-one F1 25 photorealism is made.
