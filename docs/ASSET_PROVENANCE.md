# Asset provenance

The circuit layout, car lofts, wings, halo, wheel/rim construction, pit buildings, signage, stands, vegetation, interface, textures and audio synthesis are original procedural content authored for this repository. No game files, licensed Formula 1 branding, real team liveries, sponsor assets, real-person likenesses or extracted commercial audio are included. Driver names and the Aurel circuit are fictional design elements.

Three.js and its examples/addons supply the renderer, geometry helpers, sky and post-processing infrastructure. Their dependency license is retained through npm. Vite, TypeScript, ESLint, Vitest and Playwright are development dependencies. Consult each installed package's own LICENSE and the lockfile for dependency provenance; this document does not replace third-party license terms.

No external font files, models, textures, online image downloads or sound recordings are needed to run the built application. System fonts are used. The generated textures and models are local and do not require paid services or API credentials.

## User-provided visual references (2026-09-19)

The F1 25 reference ZIP was inspected as a quality target only. No reference image, commercial-game mesh, livery, UI, recording or extracted texture is bundled or fetched by the app. The replacement body-section geometry, swept wings, APEX UV liveries, procedural foliage atlas and correlated terrain material maps were authored in this repository. See [reference review and validation boundaries](REFERENCE_VISUAL_REVIEW.md) for the archive audit, the excluded unrelated images and the remaining fidelity gap. A visually similar technique is not evidence of ownership of or permission to redistribute third-party source assets.

## Original cockpit detail continuation

`cockpit.ts` authors the mirror housings, rounded apertures, butterfly wheel and printed APEX control panel. `driver-materials.ts` generates two shared 128 × 128 linear normal/roughness maps from deterministic periodic weave functions; no photograph was converted into these textures. Glove reinforcement and seam curves are original geometry. The control lettering uses the browser's system fonts, with no bundled font files. The reference collection supplies qualitative goals, not distributed pixels. No external material library, image-generation output or downloaded PBR asset was added in this continuation.

## Circuit continuation

Profiled barriers, analytically filtered fence wire, eight grandstand layouts, structural components, seat/crowd instances and decorative construction finishes are original procedural work. No F1 25 image, mesh, brand livery, texture, sound or UI element is imported. The supplied pack remains an external qualitative reference, not a runtime dependency. See [circuit validation and limitations](CIRCUIT_REFERENCE_CONTINUATION.md).

## Phase 27H.2 original seated driver

`author-driver.py` and `apx01-driver.blend` are original Blender-authored suit
geometry, vertex-colour panels, UVs and nine named skin joints. Their runtime GLB
contains no imported human scan, real-person likeness, external texture, font or
animation. The suit reuses the repository's deterministic woven-fabric normal
and roughness resources. Gauntlets, thumbs, paddle blanks, fitted six-point
restraints and helmet tethers are original metre-space geometry. See
`PHASE_27H12_IMPLEMENTATION.md` and the hash-pinned driver manifest. Blender is an
authoring tool, not a shipped runtime dependency.
