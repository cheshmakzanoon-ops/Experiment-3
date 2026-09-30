# Broadcast presentation pass

This pass audits and upgrades the Three.js image pipeline and replaces the race
HUD / paddock visual language with one distinctive broadcast identity. Physics,
race rules, recording and every HUD layout contract are unchanged.

## Audit findings (before)

| Area          | Finding                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anti-aliasing | The composer rendered into single-sample targets, so the canvas `antialias` flag had no effect; only FXAA was applied. Fences, kerbs and bodywork edges shimmered. |
| Ambient light | No ambient occlusion of any kind. Cars, barriers and cockpit parts floated on the surface lit only by shadow maps.                                                 |
| Bloom         | Present, but at strength 0.1 and enabled only on High, so the default Medium preset had none.                                                                      |
| Grade         | ACES tone mapping straight to output: low contrast, grey haze, no lens response.                                                                                   |
| Sky / haze    | Pale, milky clear-sky zenith and white aerial perspective flattened every distant plane.                                                                           |
| Asphalt       | Very narrow macro variation (±8 %) read as a uniform mid-grey ribbon.                                                                                              |
| Particles     | Near-camera smoke puffs became opaque 120 px discs; value noise made them blocky.                                                                                  |
| HUD           | Generic Arial/monospace panels with thin borders; no position readout, no flag colour language, no rev-light semantics.                                            |

## Rendering changes

- **`SceneAmbientPass`** (`src/rendering/scene-ambient-pass.ts`) replaces
  `RenderPass`. It performs the single scene draw into a hardware-multisampled
  (2× Medium, 4× High) half-float target with a 32-bit float depth attachment.
  Depth-only scalable ambient obscurance is then computed at half resolution
  (14 spiral samples, reconstructed facet normals, screen-radius clamp for cockpit
  surfaces, 90–220 m distance fade), filtered with a separable depth-aware blur
  and joint-bilateral upsampled. No second geometry pass is added.
- **`BroadcastGradePass`** (`src/rendering/broadcast-grade.ts`) runs after tone
  mapping and FXAA: luma unsharp mask, filmic S-curve, cool-shade / warm-key split
  tone, vibrance, optical vignette, lateral lens fringe and luminance-weighted
  grain. Profiles exist for day, sunset, night and studio (studio has no grain or
  fringe). Grain is seeded from presented simulation time, so paused, replay and
  photo frames hold still.
- **Bloom** is enabled from Medium upwards at a linear-HDR threshold above sunlit
  paint and smoke, so only speculars, lamps and the sun disc glow.
- **Sky and haze:** deeper clear zenith, lower clear-air turbidity, bluer and
  slightly thinner fair-weather aerial perspective. Cloud and rain still thicken
  and grey it through the existing recorded-weather inputs.
- **Asphalt:** darker binder, wider macro variation and sealed repair patches in
  the world-space finish shader (no fabricated session rubber).
- **Particles:** radial billowed smoke silhouettes and a near-lens dissolve.

New graphics controls (saved with the existing settings, migrated from older
saves by preset): `msaa` (0/2/4), `ambientOcclusion` and `filmGrade`.

## Interface changes

- Bundled, offline **Saira** variable typeface (OFL, `@fontsource-variable/saira`)
  using its width axis: expanded italic numerals for speed, gear and timing,
  condensed tracking for labels.
- Carbon-glass panels, parallelogram cuts and a signature **Apex Flame** accent.
- Session strip with FIA-style flag colours, a new **position badge** (`P5 / 8`),
  a classification tower with skewed team bars and a highlighted player row, and
  green / red / blue / violet rev lights with shift glow.
- The delta chip is green when ahead, red when behind and neutral until valid.
- ERS mode chips are coloured per mode (harvest / balanced / attack).
- Broadcast track map with casing, bright ribbon, start/finish mark and outlined cars.
- Restyled paddock menu, loading screen, dialogs, results table, replay bar and toasts.
- High-contrast mode and `prefers-reduced-transparency` still override the glass surfaces.

## Validation

- `npm test`: all unit suites pass, including the new
  `tests/broadcast-presentation.test.ts` (presets, migration, half-resolution
  sizing, sample-count reallocation, grade curve monotonicity, held grain).
- `npm run lint`, `tsc --noEmit` and `vite build` pass.
- `e2e/28-race-hud-layout.spec.ts` passes on SwiftShader: every wide/compact
  geometry contract, keyboard-scrollable tower and menu reachability at all
  tested viewports.
- The real application was driven in headless Chromium (SwiftShader) through the
  menu, grid, chase, cockpit, pod and broadcast cameras in clear and heavy rain
  with no console or shader errors.

SwiftShader frame rates are not performance evidence. MSAA, obscurance and bloom
remain individually switchable, and Low disables all three.
