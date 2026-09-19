# Reference-driven visual continuation — 2026-09-19

## Scope and source of truth

The user supplied `F1_25_PS5_Developer_Reference_100_Images.zip` as an additional visual target, not a replacement for the 148-section master directive. The recovered `Pasted markdown(6).md` is byte-identical to `MASTER_DIRECTIVE.md` (SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`). Work resumed from published source `1a46c45c9ac6f553ae09e461dfb4127ffff470dd`; its preceding runtime milestone was road-plane tire forces, physical underfloor contacts and wet-pit braking in `7e458fd0`.

**The target is not yet achieved.** A passing render test is not evidence of F1 25 photorealism, equivalent content, calibrated vehicle dynamics, or completion of the manual scenario in section 146. The original circuit, names, liveries and interface remain original; reference pixels and extracted commercial assets are not application assets.

## Reference-pack inspection

Archive SHA-256: `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.

All 100 images were decoded and reviewed in five contact sheets, with selected close views. Inspection classified 51 as useful visual references, 21 as contextual/menu/promotional images, eight as video collages, two as scanning/marketing context, and **18 as unrelated**. IDs **048–065** contain hardware, other games or unrelated product imagery and are excluded from the visual target.

There are no byte-identical or identically sized decoded-pixel duplicates. That does not make this 100 independent gameplay views: a 63-bit DCT perceptual hash with Hamming distance at most six identified 18 candidate pairs, including groups 002/090, 004/071/092, 006/045/083, 007/044/098 and 010/068/082. Resizing, cropping and recompression explain several repeated compositions. Source-page metadata is retained in the separate audit; the platform provenance of every image has not been independently verified. Do not label the whole collection verified PS5 gameplay.

Useful targets include cockpit framing (003/034/037), pit architecture (004), mechanical close-ups (007/077/078), wet-track visibility (010), dust and surface transitions (041), landscape depth (076), and night/broadcast views (039/079/080). These are qualitative references, not exact camera-matched ground truth for Aurel.

## Implementation in this continuation

- Bounded body-section interpolation, narrowed sidepod undersides, shaped nose/engine cover and separate endcaps; thin swept multi-element aero surfaces and bevelled endplates replace rounded slabs.
- Original UV-conforming APEX flank liveries, inlet lips/dividers, cooling louvers, small fasteners and outboard wheel covers. Existing tire deformation, suspension motion and damage ownership remain physical-state driven.
- Metre-scaled carbon detail; original correlated asphalt, grass, gravel and concrete albedo/height/roughness; stochastic rather than sinusoidal asphalt detail. Road and pit wetness share the actual water cells; pit materials do not invent laid rubber or marbles.
- One world-space sun for the sky, light and shadows; recorded-weather cloud coverage and environment updates; light-space texel snapping; layered instanced vegetation with track/pit clearance and ground placement.
- Fixed-seed, fixed-tick 1280×720 captures through the production renderer. Clear/rain exterior and cockpit views exercise high settings, plus local/environment reflection and bloom state transitions. The tests preserve the source simulation frame and collect browser errors and render statistics.

## Evidence and acceptance boundaries

The original high-preset baseline was captured by Actions run `35444098881`. The first rendering candidate passed 511 unit tests, lint, TypeScript and production build but failed both browser image gates: the local-reflection cockpit became black while the exterior view rendered. Runs `35445179817` and `35445498460` preserve that failure and its diagnostic variants. It was not published as the runtime milestone, and neither disabling bloom nor reducing the image threshold is an acceptable repair.

The failed raw HDR diagnostic (`35445971107`) isolated one NaN pixel at cube face 5, pixel (12, 66), in both weather states before environment filtering. The surface-bump derivative basis became singular at a grazing angle. The repair preserves the geometric normal when derivatives, the basis determinant or the perturbed normal collapse. It retains the bump detail elsewhere and preserves composition with the wet-road shader hook. It does not clamp a black final image or disable local reflections/bloom.

Repaired-candidate run **`35446315279` passed 512 unit tests across 53 files, lint, TypeScript, production build and both real Chromium reference cases**. Its exact 14 source/test file hashes are retained in the `reference-renderer-repaired` artifact with candidate `6347d9e10cb51d75a0e656319bdc8cef80db0d6c`. All 12 captured views rendered; all 24 sampled cubemap faces had zero non-finite RGB texels, with no browser errors or WebGL errors and no mutation of the simulation frame. Clear/rain full-preset exterior and cockpit images were visually inspected. The regular full game workflow remains the separate final source-publication gate.

Reproduce the captures with `npm ci`, `npx playwright install chromium`, `npm run build`, then `npx playwright test e2e/04-reference-visual.spec.ts`. The HTML report contains screenshots and JSON attachments. The high preset, 1280 x 720 resolution, seed 1887 and tick 96 are fixed. Readback/intersection instrumentation exists only in the test fixture; it is not a gameplay frame cost. The workflow used to move and diagnose candidate files is removed from the published tree.

Current acceptance requires the normal repository CI (unit/build/lint, physics scenarios and all browser shards), finite real reflection data, non-empty full-preset cockpit captures, and visual inspection of the emitted images. Pixel-content checks detect blank output, not aesthetic equivalence. Software-rendered CI is not a representative hardware FPS benchmark.

## Still visibly below the requested reference quality

Environment density and authored architecture, ground/vegetation transitions, driver/glove and cockpit detail, mirror framing, surface wear, lighting/exposure balance, atmospheric depth, temporal antialiasing and long-range detail still need reference-led review. The procedural car is not a licensed real-team model or a scanned production asset. A stationary clear/rain pair also cannot establish motion quality, spray readability, consistent lighting around a full lap, rain transitions, night lighting or replay presentation.

The remaining master-directive gates stay open: a complete human-driven section-146 audiovisual scenario, repeated subsystem review, representative hardware performance captures and honest final reporting. Continue from the committed implementation and its evidence rather than converting this document into a completion claim.

## Subsequent cockpit continuation

The complete normal workflow for the renderer milestone, `35446641303` at `e607062`, subsequently passed all jobs, including playable publication. The next [cockpit continuation](COCKPIT_REFERENCE_CONTINUATION.md) preserves that runtime, adds fitted mirrors and real-state controls, and repairs stale reflection history on replay seeks. Its evidence and graphics costs are reported separately rather than retroactively changing the earlier candidate measurements above.
