# 27H.5 — reconciled presentation candidate

Remote baseline: `85d215fff2a761c9a0e1f9f05b9dd62b7b6ef263`, tree
`1252518b5d00dc7f9cc0e45a5505505862976805`.
Recovered source: `fd79085cbec2db7a746e17a4dcf3af6fceb768b5`.

This is a behavior-level reconciliation, **not a replacement of the newer
remote implementation by the older saved tree**. The remote snapshot-driven
lighting palette, localized fog integration, road clearcoat ripples, weather
controller, replay/camera ownership and full-lap browser evidence paths remain.
No force update, engine change, dependency upgrade or weakened CI gate is needed.

## Recovered work integrated with the current runtime

* `SkyEnvironment` now linearly blends neighboring linear-HDR CubeUV atlases,
  instead of exposing rounded cloud bins. It owns at most two captures and two
  reusable blend targets. Identical observations do no work. Capture and blend
  failure retain the last complete image, restore caller state and do not publish
  a partially written atlas. A stable sky epoch preserves the local reflection
  interval during smooth cloud changes; mode switches, hard weather jumps and
  replay discontinuities still refresh promptly, including while paused.
* The canonical `WeatherPresentation` owns all material wetness. Saved spectator
  skin/clothing masks now exclude faces at all four detail levels, with the same
  authored partial shelter on meshes and impostors. The impostor mask is applied
  after its head is defined, before physical lighting. Cockpit fabric retains
  its authored maps with reduced exposure. Foliage and bark receive explicit,
  distinct roles. These remain bounded presentation approximations, not a second
  rainfall, roof-occlusion or fabric-saturation simulation.
* Smoke, dust and other nonemissive contact particles share the existing scene
  light uniforms; sparks retain their emissive response. Rain, spray and contact
  particles also use the existing localized atmospheric integral with explicit
  world-position sources. No particle pool, light source or simulation emitter
  has been added.
* The exposure meter retains the remote camera-reframe/generation handling and
  adds the saved broad-highlight guard. A 90th-percentile observation limits
  broad highlights without allowing a few glints to drive adaptation. Paused
  clocks, stale asynchronous observations and replay resets retain their tests.

The saved alternative `WeatherSurfaceField`, `WaterFilmObservation`, palette and
particle-light helpers are not installed alongside competing remote owners.
Their overlapping responsibilities remain in the newer canonical APIs; unique
behavior is ported above. In particular, the physically located road-water
response is retained rather than replaced with the older alternative. Original
source archives remain separate historical recovery evidence, not active code.

## Repair of the known CI failure

Run `36112034326` failed in both wet-presentation and browser shard 8 at the same
`e2e/weather.spec.ts` pixel assertion. Its helper created a scene with **no light
sources**, although precipitation now correctly depends on scene illumination.
The helper now supplies the production day/cloud light state and palette from
its actual simulation snapshot. The original `changedPixels > 100`, emitter,
wind, cleanup and error assertions are unchanged. No emissive fallback, relaxed
threshold, retry, skipped case or longer timeout conceals this failure.

## Validation and evidence boundary

The reconciled runtime passed `npm run check`: lint, **1,041 tests in 102 files**,
strict whole-project TypeScript and a production build. Fifteen additional saved
ownership/mask/highlight regressions were adapted to the canonical APIs; the new
foliage role is also covered by the existing parameterized material tests.

**94** actual Three.js-generated shader variants compiled and linked in native
EGL/Mesa GLES3, including masked crowd detail levels, skinned crew/driver,
particles with localized fog, HDR sky blending, shadows and environment light.
**12** native pixel controls passed for linear-HDR interpolation and the existing
scene-lit precipitation shader. These are component checks, not browser or
ordinary gameplay evidence.

The local browser attempt could not create a WebGL context, and the other case
stopped at missing Playwright video tooling. Neither is a browser pass. Current
source hosted CI, new footage inspection and representative physical-hardware
performance remain required. The existing successful full-lap captures belong
to the remote baseline and are not relabelled as this candidate's evidence.

The exact 248-row matrix is regenerated with unchanged acceptance dispositions:
0 PASS / 230 PARTIAL / 2 FAIL required rows, plus 16 excluded references.
No final-art, reference-parity, hardware, Phase 27H.6 or Steam acceptance is added.
