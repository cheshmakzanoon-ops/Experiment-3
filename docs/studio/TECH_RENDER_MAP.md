# TECH_RENDER_MAP: rendering architecture, budgets and extension points

Owner: Technical Director (rendering). Phase: analysis only; no source changed.
Three.js **0.180.0**, WebGL2 only, TypeScript + Vite. All `file:line` refs are against `3a6036d`.
Companion docs: `docs/studio/ART_BIBLE_A.md` (numeric look targets), `ART_BIBLE_B.md` (HUD/UI).
Reference images stay in the session scratchpad. Never copy them into the repo; describe them in words only.

---

## 0. Headline findings (read this first)

1. **The forward pipeline is sound and well instrumented.** It has one MSAA HDR scene draw, a depth texture,
   half-res AO, a Jimenez bloom pyramid, ACES at output and a display-referred grade. Most "AAA" features
   can be **folded into existing passes at zero extra draw calls**. This matters because of finding 2.
2. **Draw-call ceiling, the biggest hazard.** The cold cockpit frame at **Medium** quality must stay within **+2%** of
   `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json` (`scripts/infrastructure-render-budget.ts:50-53`). It is
   enforced by 7 e2e specs. Sunset was measured at **3,232 / 3,236 allowed: only 4 calls of headroom**. Any new
   full-screen pass on Medium costs 1 call. Any new shadow cascade or scene re-render on Medium costs
   hundreds. Put expensive features on **High** (no budget test), or fold them into existing passes, or
   rebaseline. Rebaselining is a producer decision and needs documented evidence.
3. **The IBL is about 1.8 stops darker than the visible sky.** When `material.envMap === null`, r180 sets
   `envMapIntensity = scene.environmentIntensity` (`node_modules/three/src/renderers/WebGLRenderer.js:2501`).
   That value is `daylight.environment` = **0.28** on a clear day, 0.21 overcast and 0.07 at night
   (`daylight.ts:39`, `renderer.ts:937`). The PMREM is captured from the *same* dome you see
   (`probeSkyIntensity` = 1), so paint, carbon and glass reflect a sky at 28% of its on-screen brightness.
   This is the main reason the chase-cam car reads near-black in baseline `20-driving-a.png`. The High
   local probe copies the same 0.28 gain into its sky (`reflections.ts:278`).
4. **The IBL's lower hemisphere is sky, not ground.** Three's Preetham `Sky.js` clamps
   `zenithAngle = acos(max(0, dir.y))`, so every downward direction returns horizon radiance. The PMREM
   therefore lights car undersides and lower sidepods with bright sky. F1 25 cars get their contrast from
   dark asphalt reflected in the lower body. Fix it in `SkyEnvironment.capture()` (`daylight.ts:386-423`)
   with a ground-radiance branch that is only active during capture.
5. **Motion blur is off in every preset** (`options.ts:41`). Its implementation **re-renders the whole scene**
   with an override material (`motion-blur.ts:195-211`), which roughly doubles composer calls. Switching it on
   for Medium would break the budget. Rebuild it as **depth reprojection plus a per-car OBB velocity table**
   in one full-screen draw (section 12.10).
6. **Wet planar reflections cannot be reached on Medium.** `renderer.ts:719` maps
   `reflections==='environment'` to `'low'`, which sets scale 0, so the 0.35 Medium scale in `wet-reflection.ts:17`
   is dead code. Only High shows mirrored wet roads. This costs nothing in dry budget runs.
7. **Shadows** use a single car-following cascade at ±38 m with PCFSoft: **7.4 cm/texel on Medium** (1024) and
   3.7 cm on High. A static, baked "far" map is spliced in as directional shadow #1 by a ShaderChunk
   regex patch (`far-shadow.ts:45-85`). Shadow map *size* does not cost draw calls, so Medium could go to 2048
   without touching the budget. A near cascade costs calls, so it should be High only.
8. **There are many global ShaderChunk patches, all fragile to ordering.** Specular AA, the far shadow,
   point-light work and the wet road all regex-patch `lights_fragment_begin` / `lights_physical_fragment` /
   `shadowmap_pars_fragment`. Three's `CSM`, `GTAOPass`, `SSRPass` and `TAARenderPass` addons are **not drop-in**:
   CSM collides with the far-shadow regex, and the others need extra scene passes (section 13).
9. **Tests pin exact numeric looks.** Changing `daylight.ts` numbers, sky shader text, grade profile
   bounds or the `GraphicsOptions` shape requires the listed unit tests to change in the same commit
   (section 13). Baseline: vitest **218 files / 1,914 tests green** (481 s).
10. **Time and determinism rule.** Every effect is driven by presented simulation time `H.TIME`, never
    `performance.now()`. Held, paused and photo frames must be pixel-identical. Passes must `reset()` on
    camera cut, seek or resize.

---

## 1. Renderer construction (`src/rendering/renderer.ts`, class `RacingRenderer`)

| What | Where | Value |
|---|---|---|
| Spec-AA chunk patch (before any compile) | `:277` `installSpecularAntialiasing()` | variance 0.25, clamp 0.18 (`specular-aa.ts:14-19`) |
| Context | `:278-292` | `webgl2`, `antialias:true`, `alpha:false`, high-performance. The canvas MSAA is wasted because the composer draws a full-screen quad, but it still costs a multisampled default framebuffer. |
| Instrumentation | `:293-295` | `GpuTimer` (EXT_disjoint_timer_query_webgl2), `DrawLedger`, `GpuFrameGate` |
| Opaque sort | `:309` | `frontToBackOpaque` (`opaque-order.ts:12-28`). The sky is forced last by `material.name === 'SkyShader'`. |
| Colour | `:310-312` | `outputColorSpace = SRGBColorSpace`, `ACESFilmicToneMapping`, exposure 1.05 (overwritten every frame) |
| Shadow type | `:313-314` | `shadowMap.enabled`, `PCFSoftShadowMap` (r180: fixed bilinear 3×3-style kernel, `shadow.radius` ignored) |
| Shadow proxies | `:315` | wraps `shadowMap.render` (`shadow-proxies.ts:411-419`); merged depth-only car casters |
| Sky | `:320-324` | three `Sky` (Preetham), `scale 450000`, `excludeMotionBlur`, `configureSky()`, `SkyEnvironment` |
| Env / fog / lights | `:325-331` | `environmentIntensity 0.7` (overwritten), `FogExp2(0xb9c7c1, 0.00044)` (overwritten), hemisphere + sun + far light. **Order matters: the far light must be directional-shadow index 1.** All three are opted into wet layer 5. |
| Sun shadow camera | `:332-344` | mapSize 2048 then `g.shadowSize`; ortho ±38 m, near 20, far 500; bias −1.5e−5; normalBias 0.008 (sunset 0.004, `lighting-coherence.ts:44`) |
| Construction tasks | `:361-373` | "Far sun shadow" bake; "Environment lighting" (first PMREM); "Local weather materials" installs `WeatherPresentation` + `LocalAtmosphere` hooks on **every** scene material (use this as the global-uniform injection point) |
| Composer | `:379-398` | see section 2 |
| Camera | `:145` | `PerspectiveCamera(58, 1, near 0.045, far 7000)`. Standard (non-reversed) depth. |
| Pixel ratio | `:748-773` `resize()` | `min(devicePixelRatio, 1.5) × resolutionScale`, capped by maxTextureSize (`options.ts:77-89`) |

Driver: `src/main.ts:734` `frame` RAF loop → `:781` `canSubmitFrame()` (skips the draw while the previous
GPU fence is unsignalled) → `:797` idle 15 fps cap for menu, paused, results and photo → `:852` `renderer.draw(a, b, alpha, dt, menu, replay, wallDelta)`.
Build: `:347` `RacingRenderer.create(...)`, `:355` `setQuality`. Settings change: `:2079` `prepareQuality` (drain fence → `setQuality` → `compileAsync`).
The HUD is **HTML/CSS outside the canvas** (`src/ui/race-day-hud.ts`, `compact-race-hud.ts`). It is never tonemapped, graded or blurred.
In-scene screens (the steering LCD `steering-display.ts`, pit-wall screens) are CanvasTextures and *are* graded.

---

## 2. Frame graph: `draw()` (`renderer.ts:861-1329`)

```
CPU: camera solve (:870-1096) → kit LOD updates (:1097-1123) → rival LOD/pose (:1127-1146)
     → shadowAnchor + sun pos (:1147-1155) → circuit/atmos/weather/crowd/fx updates (:1156-1197)
     → reflection.beginFrame (:1198) → updateMatrixWorld (:1204)
GPU (ledger phase in [ ]):
 [environment] far-shadow bake if lighting/size/veg changed (:1250)      ~rare, whole-circuit depth
               SkyEnvironment.update (:1252): PMREM capture on bin/mode change; else ≤1 atlas blend quad
 [probe]       ReflectionSystem.updateProbe (:1259)   HIGH only; 128² cube, 1 face/frame, 1.5 s dry / 0.55 s wet
 [mirrors]     MirrorViews.render (:1269)             COCKPIT only; 1 feed/frame alternating, uses LAST frame's shadow map
 [wet]         WetRoadReflection.update (:1274)       only if water>0.02 or wheel water; HIGH only in practice
 [composer]    EffectComposer.render (:1304):
   1 SceneAmbientPass  (scene-ambient-pass.ts:279)  shadow maps [shadow] → scene → MSAA HalfFloat + Float depth
                       AO (if on): obscurance ½res → blur H → blur V → bilateral-upsample composite (4 quads)
   1b BokehPass        (photo DOF only, inserted at index 1, :805) re-renders scene with depth material
   2 AdaptiveExposurePass (adaptive-exposure.ts:85)  16×12 meter draw ≤4 Hz, async PBO read, needsSwap=false
   3 MotionBlurPass    (motion-blur.ts:187)          OFF in all presets; when on: FULL scene velocity re-render + 1 quad
   4 LensBloomPass     (lens-bloom.ts:210)           prefilter ½res + 6 down + 6 up + 1 additive into readBuffer (14 quads)
   5 OutputPass        (three)                       ACES(toneMappingExposure) + sRGB OETF
   6 FXAA ShaderPass   (:397)                        only when MSAA samples == 0 (Low)
   7 BroadcastGradePass (broadcast-grade.ts:202)     display-referred grade, renderToScreen
 [other]       GeometrySurvey (photo survey only, :1306)
 gpuFrames.submittedFrame() (:1325): fence + flush
```
Fixed post overhead on Medium: about **20 calls** (AO 4 + meter 0-1 + bloom 14 + output 1 + grade 1).
Linear HDR runs up to and including bloom. OutputPass is the single tone-map and encode. FXAA and grade are display-referred.
The exposure meter reads the post-AO, pre-bloom linear buffer. Mirrors, probe and wet targets are linear
HalfFloat and are tone-mapped only through the main view.

### 2.1 Render targets (1280×720, Medium)
| Target | Owner | Format | Size | Notes |
|---|---|---|---|---|
| Scene | `SceneAmbientPass.target` (`:190`) | RGBA16F, samples 0/2/4 | full | `DepthTexture` **FloatType**, nearest. This is **the depth source for any new screen-space pass.** |
| Composer ping/pong | EffectComposer | RGBA16F | full | no MSAA, no depth |
| AO obscurance/blur | `:198-207` | RGBA8 | ½ | R only used. G/B/A are free for contact shadow or bent normal. |
| Exposure meter | `adaptive-exposure.ts:10` | RGBA8 | 16×12 | log2 luminance encoded in R |
| Velocity | `motion-blur.ts:86` | RGBA16F + depth | full | allocated only when used |
| Bloom levels 0-6 | `lens-bloom.ts:181` | RGBA16F | ½ … 1/128 | A = 1.0 unused |
| Mirrors ×2 | `mirrors.ts:12` | RGBA16F + depth | 128×48 / 256×96 / 512×192 | 10/15/30 Hz |
| Wet planar | `wet-reflection.ts:49` | RGBA16F + depth, mips | 0.35× (M, unreachable) / 0.5× (H) | layer 5 objects only |
| Probe cubes ×2 | `reflections.ts:77` | RGBA16F cube, mips | 128² | auto-PMREM'd when bound as envMap |
| Sky PMREM | `daylight.ts:407` | CubeUV HalfFloat | size 128 | ≤2 bins + 2 blend outputs |
| Sun / far shadow | three | depth | 1024 (M) / 2048 (H) / far `max(1024,size)` | |

---

## 3. Colour pipeline and exposure

- Working space linear sRGB. Colour textures are tagged `SRGBColorSpace`; data maps use `NoColorSpace`.
- **Tone map:** `ACESFilmicToneMapping`, applied once in `OutputPass`. Three skips tone mapping and colorspace
  chunks when rendering to a render target, so the `#include <tonemapping_fragment>` lines in particle
  shaders (`effects.ts:180`) do nothing there.
- **Exposure** (`renderer.ts:1295-1301`): `toneMappingExposure = daylight.exposure × 2^(photo EV) × 2^(adaptEV)`.
  - Base `daylight.exposure`: day `0.9 + 0.1·cover`; sunset `1.01 − 0.03·cover`; night `1.12 − 0.001·rain`.
  - Adaptation (`exposure-meter.ts`): the meter samples x∈[0.18, 0.82], y∈[0.12, 0.66]
    (`adaptive-exposure.ts:25`) and trims 10% tails. The **90th-percentile** log2 luminance is
    driven toward `METER_KEY` (day −2.44, sunset −3.6, night −3.91; `:13`):
    `targetEV = clamp(0.5·(key − p90 − log2 base), −0.7, +0.85)` (`:122`). τ = 0.35 s when
    darkening and 1.6 s when brightening (`:97`). Time is the presented sim clock. Photo and menu are held (`active=false`).
  - The art bible says to fix albedo, not exposure. Changing METER_KEY breaks `tests/exposure-key.test.ts`.
- **Grade** (`broadcast-grade.ts:18-68`, applied `renderer.ts:1302`). Profiles: day, sunset, night, studio.
  Day: contrast 0.16 (smoothstep S-curve), saturation 1.06, vibrance 0.16, shadowTint (0.98,1,1.03),
  highlightTint (1.025,1.005,0.975), vignette 0.12. Fringe, grain and sharpen are 0, and tests require 0
  for **every** profile in `GRADE_PROFILES`.
- **Bloom** (`lens-bloom.ts:19-35`): threshold 3.6 linear, knee 1.8, firefly limit 24→64, scatter 0.7,
  strength 0.55, 6 levels. `LensBloomPass.strength` is a public field and is never changed per mode today.

---

## 4. Lights, sky, IBL, fog: per-frame values (`renderer.ts:919-953`, `daylight.ts:30-97`)

| Quantity | Day (cover c, rain r) | Sunset | Night | Studio |
|---|---|---|---|---|
| Sun dir | `SUN_OFFSET (−160,190,−130)`, elev **42.7°** | `(−215,28,−150)`, elev **6.1°** | same as day (moon) | day |
| Sun colour (`lighting-coherence.ts:6-45`) | `#ffead0` → lerp `#dce3eb` by 0.88c | `#ffb76d` | `#e2e9f6` (lerp 0.12c) | |
| Sun intensity | `4.2·(1−0.94·c^1.45)` | `2.8·(1−0.88c)` | `0.3·(1−0.55c)` | 1.4 |
| Hemisphere sky/ground | `#c3d8f3`/`#33372e`, int `0.26+0.34c` | `#bccde6`/`#3b3027`, `0.5+0.1c` | `#9eaec8`/`#242a33`, `0.085+0.03c` | 0.25 |
| IBL `environmentIntensity` | `0.28−0.07c` | `0.28−0.07c` | `0.07+0.01c` | 0.3 |
| Sky turbidity / skyRadiance | `2.3+5.5c` / `0.32+0.2c` | `5.6+3c` / `0.26+0.12c` | as day | |
| Fog `FogExp2` density | `0.000205+0.00016c+0.000026r` | ×1.18 | ×0.75 | |
| Fog colour (linear) | (0.5,0.61,0.77) − cover/storm terms → sRGB ≈ `#bccde3` | (0.55,0.37,0.31) | (0.01,0.014,0.026) | |
| Venue lights | off | 4 × 0.18 strength | 4 × `PointLight(0xd9e8ff, 1800cd, 135 m, decay 2)` | off |

- **Sky** (`daylight.ts:231-297` `configureSky`). Three's Preetham with `rayleigh 2.9, mie 0.0032, g 0.82`
  (`:131`). The fragment is patched to linear radiance × `skyLinearGain` (CPU-integrated, `:176`), plus
  4-octave value-noise clouds in the flat projection `dir.xz/(y+0.24)`, a sunset haze and a night dome
  with a moon. There is no wall-clock animation. Uniforms written per frame (`renderer.ts:944-953`):
  `turbidity, cloudCover, skyRadiance, nightAmount, sunsetAmount, sunPosition, skyLinearGain`, plus `probeSkyIntensity`.
- **IBL** (`SkyEnvironment`, `daylight.ts:368-557`). `PMREMGenerator.fromScene(sky clone, σ 0.04, near 0.1,
  far 700000, size 128)` per cloud bin (cover×8, 9 bins) × mode. Fractional cover is a linear blend of
  two CubeUV atlases (1 quad). `scene.environment` is set at `:520`. The env map contains **only the sky** (no
  ground, terrain or buildings). The local probe (High) adds scene radiance near the followed car.
- Energy math, clear day, horizontal surface (three r180: IBL irradiance ×π then Lambert ÷π; hemisphere has no ×π):
  shadowed ≈ albedo·(0.28·L̄sky + 0.26·0.6/π) ≈ albedo·0.11; sunlit adds albedo·4.2·cos(47.3°)/π ≈ albedo·0.91.
  The lit/shadow ratio is ≈ 9.5:1 and shadows are only weakly sky-blue. The hemisphere *duplicates* the IBL
  diffuse sky term.
- **Local atmosphere** (`local-atmosphere.ts`): three analytic height-fog pockets in every Standard,
  Lambert or Phong material, plus particles. σ = `0.00055·sat((c−0.62)/0.38) + 0.0022·min(r,20)/20`. It is
  zero on a clear day. Quadrature equivalence is tested in `e2e/38-fog-quadrature.spec.ts`.
- **Wetness** (`weather-presentation.ts`): per-role darkening and roughness; road clearcoat water film
  (`materials.ts:42-177`, F0 of water at IOR 1.333, `wetRoad.frag`).
- **Point-light guard** (`point-light-work.ts:51`): zero-intensity point lights skip BRDF work (uniform
  branch). Light count changes program variants (day has 0 point lights, night has 4).

---

## 5. Shadows

- **Near (dynamic) sun map.** The ortho box is ±38 m around the followed car, snapped in light space
  (`daylight.ts:101-128 shadowAnchor`; `renderer.ts:1147-1155`). Near 20 m and far 500 m, so low sun pulls
  in many venue casters. Shadow calls in the cold cockpit frame are day 477, **sunset 1,268**, night 1,324.
- **Far (static) map** (`far-shadow.ts`). A light with intensity 0 is marked `shadow.intensity = −1` and
  fit to track bounds + 150 m (`renderer.ts:347-358`). It is baked once per lighting, size and vegetation
  density (`:1334-1391`). Trees/treelines cast only into it. `farShadowChunks` (`far-shadow.ts:45-71`)
  regex-patches `lights_fragment_begin` so directional light 0 (sun) also multiplies a 4-tap bilinear
  compare of directional shadow 1, handing over at 8% of the near-map edge (`FAR_SHADOW_BLEND`).
- **Casters.** `ShadowProxies` merges static-attribute rigid car meshes ≤8,192 verts into 16-bit depth-only
  casters (`shadow-proxies.ts:15-61`). Instance and supplied-range shadow hooks narrow draw ranges per
  shadow camera (`static-instance-shadow-bounds.ts`, `supplied-draw-ranges.ts`).
  `e2e/scenery-shadow-budget.spec.ts` requires culled vs unculled shadow output to differ by **0 bytes**.
- Mirrors, probe and wet passes set `shadowMap.autoUpdate=false` and reuse the existing map.

---

## 6. Reflections

| System | File | Who sees it | Content |
|---|---|---|---|
| Sky PMREM | `daylight.ts:368` | all Standard/Physical materials without envMap | sky only, ×0.28 by day |
| Local probe | `reflections.ts:168-335` | `reflectivePaint` + road of followed car, **High** (`reflections:'local'`) | scenery minus small props, people, rivals; eye = car + 1.5 m; 2 alternating cubes |
| Mirrors | `mirrors.ts`, `reflections.ts:158` | cockpit view only | real rear cameras 42° fov, exclusions, rival LOD per feed (`renderer.ts:1396-1417`) |
| Wet planar | `wet-reflection.ts`, `materials.ts:169-173` | road ribbons' clearcoat lobe | mirror about road plane under the car; Lengyel oblique clip; mip by coat roughness; fade 0.4-2.5 m |

---

## 7. Materials and global shader patches

- Counts: 242 `MeshStandardMaterial` sites, 30 `MeshPhysicalMaterial`, 53 `onBeforeCompile` hooks, 10 custom `ShaderMaterial` files.
- **Global ShaderChunk patches (install order matters).**
  1. `far-shadow.ts:85`: `lights_fragment_begin` + `shadowmap_pars_fragment`, at module import.
  2. `specular-aa.ts:39`: `lights_physical_fragment`, at `renderer.ts:277`.
  3. `supplied-shader-work.ts:52-111`: `skinning_pars_vertex`, `skinbase_vertex`, `metalnessmap_fragment`.
  `point-light-work.ts` and `materials.ts:149` (wet road) *inline* `ShaderChunk.lights_fragment_begin` text
  at compile time, so they inherit patch 1. Any new chunk patch must be idempotent, installed at module
  scope before the first `compileAsync`, and must still match the regexes in `farShadowChunks` (it throws
  "Unexpected three.js directional light chunk").
- **Hook chaining convention.** `const previous = m.onBeforeCompile, key = m.customProgramCacheKey();` …
  `previous.call(m, shader, r)`; then extend the cache key. Shared uniforms are injected as the *same object*
  (e.g. `shader.uniforms.apexLocalSigma = this.sigma`). Use this to add global lighting uniforms; the
  installer to copy is `LocalAtmosphere.installMaterial` (`local-atmosphere.ts:167`).
- Car paint: `MeshPhysicalMaterial` metalness 0.06, roughness 0.34, clearcoat 1, clearcoatRoughness 0.16
  (`car.ts:131-137`) + `installPaintFinish` (`paint-finish.ts:27`, procedural roughness grain). The supplied
  player car uses glTF materials; `reflectivePaint` comes from names `Paint |`, `Decal |`, `F1CP_MAT_HelmetPaint`
  (`supplied-player.ts:375`).
- Road: `surfaceMaterial('asphalt', …, waterFilm=true)` uses `MeshPhysicalMaterial`, clearcoat 1, IOR 1.333,
  512² procedural canvas maps on a 0.64 m tile, bumpScale 0.00045 (`surface-detail.ts:75-124`), plus
  `installWetRoad` (`circuit.ts:143-149`).

---

## 8. Quality tiers: exact values

| Setting (`options.ts:26-48`) | Low | Medium (default) | High |
|---|---|---|---|
| resolutionScale (× min(DPR,1.5)) | 0.75 | 1 | 1 |
| textureSize (canvas/imported resample cap) | 256 | 512 | 1024 |
| shadowSize (0 ⇒ shadows off, far map off) | 0 | 1024 (7.4 cm texel) | 2048 (3.7 cm) |
| reflections | environment | environment | **local** (probe + wet planar 0.5) |
| mirrorQuality | 128×48 @10 Hz | 256×96 @15 Hz | 512×192 @30 Hz |
| particleDensity | 0 (effects off) | 0.65 | 1 |
| vegetationDensity | 0.5 | 1 | 1 |
| crowd / bloom / autoExposure / localFog / AO | off | on | on |
| msaa | 0 (→ FXAA) | 2 | 4 (capped by maxSamples) |
| anisotropy | 2 | 8 | 16 |
| motionBlur / antialias / filmGrade | 0 / true / true | same | same |
| Car LOD `carLod` scale (`lod.ts:20`) | 0.7 (near 38.5 m) | 1 (near 55, far 130) | 1.25 |
| Supplied player near tier (`supplied-player-lods.ts:223`) | tier 1 (855,654 tris) | tier 1 | **tier 0** (1,455,118 tris) |
| Kit LOD distances | per kit, e.g. barriers 16/70 | 28/100 | 40/150 (`concrete-barriers.ts:76`) |
| Wet planar scale (`wet-reflection.ts:17`) | 0 | 0 (0.35 unreachable) | 0.5 |
| Probe | none | none | 128², 1 face/frame |

---

## 9. Settings plumbing (`GraphicsOptions`)

`options.ts:4-24` interface → `graphicsPreset` `:26-48` → `validateGraphics` `:49-75` (a missing key falls back
to the preset, so no `Settings.version` bump is needed) → `Settings.graphics` (`storage/data.ts:49`, default `:67`,
load `:113`) → UI `src/ui/presentation.ts` (arrays `choices :9-36`, `ranges :37-42`, `checks :43-51`;
inputs are named `graphics_<key>`; **string-valued keys must be added to the condition at `:74`**) →
`main.ts:355/2079` → `RacingRenderer.setQuality` (`renderer.ts:714-747`) → `resize()`.
`graphicsSettingsChanged` (`core/settings-transition.ts:10`) is key-generic.
**New-option checklist:**
1. Interface, preset and validate.
2. UI array, plus the `:74` condition if the value is a string.
3. Apply it in `setQuality`.
4. Add the key to *both* literal objects in `tests/settings-transition.test.ts:32,48`. `tsc` includes tests.
5. Make `tests/broadcast-presentation.test.ts:17-26` and `presentation.test.ts:24` still pass.
   They compare migrated settings to `graphicsPreset()`, so the preset is the source of truth.

---

## 10. Performance budgets and gates

- **Cockpit complete frame** (`scripts/infrastructure-render-budget.ts:14-54`). Workload: Medium, 1280×720,
  12 cars, seed 1887, 8 s, cockpit. The **sum of all ledger phases** must be ≤ +2% calls and triangles vs
  `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`. Phase `composer` must be < 1,800, and composer,
  mirrors and shadow must all be > 0. Direct-scene captures must be < 1,800 calls.

  | Lighting | Baseline calls | Max allowed | Measured | Headroom | Triangles base |
  |---|---|---|---|---|---|
  | day | 2,345 | 2,391 | ~2,345 | ~46 | 10,744,392 |
  | sunset | 3,173 | 3,236 | **3,232** (A12 doc) | **4** | 12,549,162 |
  | night | 3,457 | 3,526 | ~3,457 | ~69 | 13,147,019 |

  Used by `e2e/56-track-infrastructure`, `57-trackside-operations`, `aurel-quarry`, `aurel-vegetation`,
  `event-hall`, `secondary-grandstands` and `scenery-shadow-budget`.
- `e2e/41-player-render-budget` and `42-full-scene-index-budget`: triangle and call monotonicity of player and index work.
- `GpuFrameGate` (`gpu-frame-gate.ts`) allows at most one unfinished submission. The RAF skips the frame
  rather than queueing it.
- Profiling: `core/performance.ts` (30 s capture, p99, 1% low, GPU ms); `stats().drawBreakdown`;
  `visualDiagnostics().census` (`render-census.ts:32`, per-owner draw estimate for main, probe, mirrors and shadow).
- Target comment `options.ts:28-29`: "1080p/60 High". In SwiftShader CI the baseline cockpit frame takes
  about 9 s wall and 14.7 s GPU, with 1,103 calls and 4.45 M triangles (`shots/baseline/diag.json`). Heavier
  passes lengthen e2e captures, so watch Playwright timeouts.

---

## 11. Where the frame's look is decided (one-line index for implementers)

Sun, sky, fog numbers: `daylight.ts:30-97`. Palette: `lighting-coherence.ts:6-45`. Per-frame apply:
`renderer.ts:919-953`. Shadows: `renderer.ts:332-344, 714-729, 1147-1155, 1334-1391`, `far-shadow.ts`.
AO: `scene-ambient-pass.ts:22-31, 59-164`. Exposure: `exposure-meter.ts:13-15, 97, 122`. Bloom:
`lens-bloom.ts:19-35`. Grade: `broadcast-grade.ts:18-68, 78-146`. Motion blur: `motion-blur.ts`.
Wet road: `materials.ts:42-177`, `wetRoad.frag`, `wet-reflection.ts`. Paint: `car.ts:131`, `paint-finish.ts`.
Presets: `options.ts:26-48`.

---

## 12. Extension points (how to add each feature)

Legend: **Δcalls** is the added draw calls on the Medium cockpit budget frame. "0" means folded into an
existing pass. Tier is the recommended default.

### 12.1 Physically based sky + IBL
- **Step A (Medium, Δcalls 0; highest value per line of code): IBL energy.**
  - Add a shared uniform `apexSpecularIBL` (radiance gain) via an installer modelled on
    `LocalAtmosphere.installMaterial`.
  - Patch `#include <lights_fragment_maps>` per material so that, after it,
    `radiance *= apexSpecularIBL; clearcoatRadiance *= apexSpecularIBL;`.
  - Drive it from `renderer.ts:937` as `1/daylight.environment` (the sky specular then matches the visible
    dome) while diffuse stays art-directed.
  - Alternative: set `environmentIntensity = 1` and remove or rebalance the hemisphere fill. That is more
    physical, but it rebalances every albedo and pinned test.
  - Materials that own a probe envMap (`reflections.ts:330-331`, `envMapIntensity=1`) already carry lit
    radiance. Skip them, or exclude them through the probe's `originalMaps`.
- **Step B (Δcalls 0): ground in the env map.**
  - In `configureSky`, add `uniform float groundAmount; uniform vec3 groundAlbedo;`.
  - For `direction.y < 0`, blend to `groundAlbedo·(E_sun·cosθ_sun + E_sky)/π`. Use asphalt and grass albedo
    0.10-0.18 per ART_BIBLE_A §4/5, with a smooth 2° horizon blend.
  - Set `groundAmount=1` only inside `SkyEnvironment.capture()` (`daylight.ts:390-423`), which already
    saves and restores uniforms. The sky clone shares the material, so restore it in `finally`.
- **Step C (Δcalls 0): resolution.** PMREM `size: 128 → 256` (`daylight.ts:407`), for sharper clearcoat
  reflections at roughness 0.05-0.16. The cost is paid only at bin or mode change.
  Probe `WebGLCubeRenderTarget(128)` → 256 on High (`reflections.ts:79`).
- **Step D (Δcalls 0 at runtime): Preetham tuning or Hillaire LUT sky.**
  - The sun is static per mode, so the sky is fully bakeable.
  - Option 1: tune `SKY_SCATTERING` and turbidity per ART_BIBLE_A §2.1 (turbidity 1.8-2.0, rayleigh 3.3-3.6).
  - Option 2: new `src/rendering/atmosphere-lut.ts`. Precompute a transmittance LUT (256×64), a
    multi-scatter LUT (32×32) and a sky-view LUT (192×108) once per (mode, cover bin) with FullScreenQuad
    into HalfFloat RTs at load or bin change. The dome then samples the sky-view LUT. Export
    `apexAerialPerspective(viewDir, dist)` GLSL for fog (12.9).
  - Keep the three `Sky` mesh, its uniform names and `material.name === 'SkyShader'`. Tests construct
    `new Sky()` + `configureSky()` and check the shader text (section 13).
- **Clouds (Δcalls 0).** Replace the value-noise layer with a baked cloud texture: equirect upper hemisphere,
  2048×512, computed once per cover bin on the GPU. Use Worley-Perlin cumulus with flat bases and 2-step sun
  self-shadowing, then sample it in the dome and the PMREM. This is cheaper per pixel than the current
  4 octaves × 2, which matters for SwiftShader. Keep it stationary (no wall-clock time).

### 12.2 Shadows (filtering, cascades, contact, grounding)
- **Medium, Δcalls 0.**
  - (a) `shadowSize` Medium preset 1024 → **2048** (`options.ts:32`); fill cost only.
  - (b) Soft and contact-hardening filtering. New `src/rendering/shadow-filter.ts`, installed at module
    scope after far-shadow, patches the `SHADOWMAP_TYPE_PCF_SOFT` branch of `getShadow` in
    `shadowmap_pars_fragment`. Use a 12-16 tap Vogel disc rotated by interleaved gradient noise (IGN), the
    same hash as `scene-ambient-pass.ts:94`, with an optional 8-tap PCSS blocker search (light size
    ≈ 0.53° sun ⇒ penumbra ≈ 0.0093·d_receiver−blocker). Do not touch the `lights_fragment_begin` structure
    that `farShadowChunks` matches.
  - (c) Screen-space contact shadows in the AO obscurance pass. Pass a view-space sun direction uniform and
    march 12 steps over 0.3 m in depth, writing to the **G channel** of the AO buffer. In the composite
    (`scene-ambient-pass.ts:135-163`), darken by `mix(1, contact, directShare)`, where `directShare` is
    estimated from luminance as the existing `luminance*0.12` heuristic already does.
  - (d) **Car grounding.** Add a uniform array of up to 12 car OBBs (`vec4 posYaw[12]`, half extents
    2.8×1.0 m) to `installWetRoad` (`materials.ts:53`) and to the grass/kerb/gravel `surfaceMaterial`s.
    Apply analytic under-floor occlusion: 25-35% over a 0.2 m falloff, applied to indirect and direct light.
    Feed it from `renderer.draw` after car poses (after `:1146`).
- **High, Δcalls ≈ +30-80 (not budget-tested).** Near cascade ±10-12 m @ 2048 (≤1.2 cm texel) as directional
  shadow **index 2**. Add it to the scene *after* `farShadow.light`, mark it like `FAR_SHADOW_MARK`, and
  extend `farShadowChunks` so light 0 samples near (2) → mid (0) → far (1) with 10% edge blends. Snap it with
  `shadowAnchor`. If Medium must get it, take the calls back first. Sunset currently has 4 spare calls; one
  option is to tighten the mid cascade's `far` from 500 m to ~250 m for the sunset mode and measure.
  Three's `CSM` addon is **not** usable because it rewrites `lights_fragment_begin`.

### 12.3 GTAO
- Replace `obscuranceFragment` (`scene-ambient-pass.ts:59-114`) with GTAO (Jimenez 2016): 2-3 slices ×
  6 steps per side, a cosine-weighted horizon integral, the existing depth-reconstructed normals, IGN plus a
  per-pixel slice rotation, and the screen-radius clamp (`maxPixels`). Add the multi-bounce fit
  `ao' = max(ao, ((a·ao+b)·ao+c)·ao)` with albedo ≈ 0.3. Keep the half resolution, 2 bilateral blurs and
  upsample: **Δcalls 0, 4 quads**.
- Constraints from `tests/broadcast-presentation.test.ts:47-80`: `AMBIENT_OCCLUSION` stays frozen, with
  `0.2 < radius < 2`, `maxPixels ≤ 96`, `nearStart ≥ 0.8`, `nearEnd ≤ 3` and `fadeStart < fadeEnd`. The
  near fade (0.9-2.2 m) exists because AO blackened the cockpit. Keep it.
- R&D (High): previous-frame AO applied *inside* materials to indirect light only (`aomap_fragment`
  patch plus reprojection). It is physically correct, but has a one-frame lag. A depth pre-pass was measured
  at **+20-26% frame time** and removed (`docs/RENDER_BUDGET_CONTINUATION.md`). Do not reintroduce it.

### 12.4 SSR and wet reflections
- **Enable planar wet on Medium (Δcalls 0 in dry budget runs):** `renderer.ts:719` → `setQuality(q)` or a
  new `wetReflections` option. It costs layer-5 draws only while wet.
- **Better wet look (Δcalls 0)** in `WET_REFLECTION_GLSL` (`wet-reflection.ts:168-187`):
  - Vertically stretched streaks: 4-6 taps along screen-space Y, scaled by coat roughness. This is the
    racing-game wet look (PS010).
  - Stronger ripple distortion.
  - A Fresnel boost at grazing angles.
- Mid-road spray and rain-light reflections come for free once rear lights are on layer 5.
- **No generic SSR.** There is no G-buffer for normals or roughness. `SSRPass` re-renders normals and
  metalness (2 extra scene draws), so it is rejected for Medium. On High, an SSR restricted to the road is
  possible later: road materials write a reflectivity mask into the scene target's alpha. That is risky
  because transparent blending writes alpha, so keep the planar approach.

### 12.5 Anti-aliasing (TAA, SMAA, alpha-to-coverage)
- **Δcalls 0, all tiers.** `alphaToCoverage = true` on alpha-tested foliage when MSAA > 0
  (`aurel-vegetation.ts:223-239`, `landscape.ts:744-758`). The catch fence already uses analytic wire
  coverage (`circuit-finish.ts:162-183`), so it does not need this. Alpha-to-coverage meshes fail
  `plainShadowCaster` and remain unmerged casters, which is fine because they are instanced.
- Context `antialias: false` (`renderer.ts:279,290`) saves canvas MSAA memory. The composer always resolves offscreen.
- **Low:** swap FXAA for `SMAAPass` (+2 calls, Low is not budget-tested) at `renderer.ts:397, 735`.
- **TAA (High, opt-in `temporalAA`, +1-2 calls).**
  - Jitter `camera.projectionMatrix` with Halton(2,3) × 8 after `:1096` and before the composer.
  - Add a resolve pass after `SceneAmbientPass` using depth reprojection plus car OBB velocity (shared with
    12.10), YCoCg variance clipping and a HalfFloat history.
  - Disable it in photo, menu and held frames and in e2e fixtures. Reset on every `reset()` path.
  - The wet planar copies `source.projectionMatrix` (`wet-reflection.ts:113`), so jitter propagates there
    consistently.
  - Do not use `TAARenderPass`; it is SSAA that re-renders the scene N times.

### 12.6 Filmic grade, LUT and tone map
- **3D LUT in `BroadcastGradePass` (Δcalls 0).** Add `uniform sampler3D lut` (32³ `Data3DTexture`,
  linear filtering) and `lutMix`. Generate it *procedurally* per profile (day, sunset, night, studio, wet)
  from ART_BIBLE_A §3 numbers (hue shifts, the clear-sky blue push, slight foliage desaturation).
  `LUTPass` would cost +1 call. Keep `GRADE_PROFILES` fields within the tested bounds. Photo-only
  fringe or grain must live outside `GRADE_PROFILES`.
- Tone curve: keep ACES (art bible). If a tunable shoulder is needed, set `renderer.toneMapping =
  CustomToneMapping` and override `ShaderChunk.tonemapping_pars_fragment`'s `CustomToneMapping` once at
  module scope. OutputPass supports `CUSTOM_TONE_MAPPING`. Many e2e fixtures set ACES on their own
  renderer and are unaffected.
- Per-mode bloom: set `this.bloom.strength` next to `grade.apply` (`renderer.ts:1302`). Day 0.45, night
  and wet 0.8 per the art bible. It is a public field; `tests/lens-bloom.test.ts` uses the constants.

### 12.7 Lens effects
- **Lens flare and sun glare (Δcalls 0).** Use the final bloom upsample (`lens-bloom.ts:233`, linear) or the
  grade pass.
  - Uniforms: `sunUV` (project `lightingDirection` each frame) and `sunVisible`. For `sunVisible`, sample
    `scenePass.target.depthTexture` at `sunUV` (≥0.99999 means sky) in the same shader.
  - Draw 3-5 ghosts along `sunUV→centre` at ≤4% and fade them when the sun is >25° off-axis.
- **Lens dirt (Δcalls 0).** A procedural dirt mask multiplies the bloom in the final upsample. It needs a
  separate final-upsample material or a uniform toggle.
- **Rain on the lens (Δcalls 0).** Chase and T-cam only, in the grade pass. Uniforms come from `H.RAIN` and
  `H.TIME` (deterministic). The HUD is unaffected because it is HTML.
- Night lamp halos and anamorphic streaks: a horizontally stretched tap set in bloom level 1-2 upsample, night profile only.

### 12.8 Depth of field
- Replace `BokehPass` (`renderer.ts:799-807, 1284-1292`). It re-renders the whole scene with
  `MeshDepthMaterial` and installs `scene.overrideMaterial`, which is restored in `finally` at `:1320`.
- New `DepthOfFieldPass`: read `scenePass.target.depthTexture` (Float, resolved). Compute the CoC from
  `photoLens()` (`photo-camera.ts:91`), gather bokeh at half resolution (16-24 taps, round), then
  composite. That is **2-3 quads and no scene re-render**. Insert it at index 1 as today.
- Use it in photo mode, the menu showroom orbit, garage/HQ, pit-stop cinematics and broadcast tele cameras
  in replay (`trackside.fov` < 20°). It stays off in live driving per the art bible.

### 12.9 Volumetric light and aerial perspective
- **Aerial perspective (Δcalls 0).** In the fog chunk that `LocalAtmosphere` already replaces, add view-dependent
  in-scatter:
  - Fog colour = `mix(antiSun, sunSide, pow(max(dot(v, sunDir), 0), 8))`.
  - Height falloff `exp(−(y−y0)/120 m)`.
  - Optionally the LUT from 12.1.
  - Clear-day density target ≈ 0.00055 per ART_BIBLE_A §2.3, which is a `daylight.ts:47` change plus
    tests. Do not alter the pocket quadrature (`e2e/38`, `e2e/37` require ≤1 LSB equivalence).
- **Night and rain floodlight volumes (Δcalls 0).** Evaluate the closed-form point-light airlight integral
  for the 4 `VenueLighting.lights` along the reconstructed view ray in the AO composite pass (it has colour,
  depth and the view reconstruction). Use HG g≈0.6 and σ = fog density + local σ. This produces TX079-style
  lamp cones in haze.
- **Sun shafts (High, +1-2 calls).** Write a sky mask from depth into bloom level-0 alpha in the prefilter,
  radial-blur it at 1/8 resolution toward `sunUV`, then add it in the final upsample.

### 12.10 Motion blur (biggest "looks like PS5" lever per ART_BIBLE_A §3)
- New `src/rendering/velocity.ts` exporting a GLSL `apexVelocity(uv, depth)`:
  1. Reconstruct world position from the depth texture with `inverse(viewProj)`.
  2. If inside one of ≤12 car OBBs (uniform `mat4 carNow[12], carPrev[12]`, filled after car poses at
     `renderer.ts:1146`), use rigid reprojection `prevVP · carPrev · inverse(carNow) · p`.
  3. Otherwise treat the pixel as static: `prevVP · p`. The camera-attached cockpit gives ~0 velocity.
- Gather 12 taps (max ≈ 3.5% of width), depth-gated as in `motion-blur.ts:46-74`. Do this **inside the
  SceneAmbientPass composite** (Δcalls 0) or as one pass replacing `MotionBlurPass` (Δcalls +1).
- Default shutter: Medium 0.35, High 0.5. That changes `options.ts:41`. `e2e/presentation.spec.ts:52-53`
  sets 0.3 through the UI and expects `stats().motionBlur.active === true`, so keep the
  `motionBlur.diagnostics()` shape (`supported`, `active`, `strength`, …) when replacing the pass.
- Reset on `prepareFrame` discontinuities as today. Photo and replay pause force 0.
- Wheel rotational blur: angular smear in the tyre/rim shader from a wheel ω uniform
  (`tire-finish.ts`, `shaders/tread.frag`), Δcalls 0.

---

## 13. Hazards (things code and tests depend on)

1. **Cockpit draw budget** (section 10). Sunset has 4 spare calls. Every new Medium full-screen quad, shadow
   light, probe or scene re-render must be measured (`stats().drawBreakdown`) and kept at 0 on Medium, or
   the baseline JSON must be re-pinned with a committed justification and CI evidence.
2. **`tests/race-view-continuity.test.ts:136-209`** runs the real `RacingRenderer.prototype.draw` on a
   hand-made fixture until `this.sun.shadow.mapSize` throws at `renderer.ts:1149`. **Any new `this.x` member
   accessed in `draw()` before line 1147 must be added to that fixture**, or placed after the shadow anchor,
   or optional-chained. The fixture's `sky.material.uniforms` lists the 7 uniforms written at `:944-953`.
3. `tests/startup.test.ts:7-60` drives `prepare()` through a double. It expects `compileAsync` with
   `composer.readBuffer` bound and the call order cars → compile → shadow-casters → chase → pit → cockpit.
4. **Sky:**
   - `tests/sky-linear.test.ts:71-80` expects the shader to contain `uniform float skyLinearGain` and
     `*skyLinearGain,retColor,sundisk)`, with `skyLinearGain ≈ 0.523` at the default turbidity 2.3. Changing
     day turbidity breaks this.
   - `reference-rendering.test.ts:113-118` expects `sunPosition == SUN_OFFSET` and `uniform float cloudCover`.
   - `sky-order.test.ts` checks depthWrite false, depthTest true, not transparent, and sort-last by name `SkyShader`.
   - `phase27g-presentation`, `daylight-environment` and `weather-reconciliation` spy on `PMREMGenerator.fromScene`.
5. **Daylight numbers pinned:**
   - `dusk-readability.test.ts:14-23`: sunset sun `2.8·(1−0.88c)`, exposure `1.01−0.03c`, skyRadiance
     `0.26+0.12c`, fog ×1.18; `circuitLightState(day) === daylightState`.
   - `presentation-continuity.test.ts:242-248`: night fog ×0.75.
   - `reference-rendering.test.ts:95-112`: monotonic sun, `fill < 1`.
   - `exposure-key.test.ts`: METER_KEY ordering and clamps −0.7/+0.85.
   - `SUN_OFFSET` is used by shadow-grid tests (`reference-rendering.test.ts:120`, `phase27g-presentation.test.ts:64`).
     Moving the sun (art bible asks for ~52° day and ~10° sunset) re-bakes the far map and changes those
     expectations.
6. **Grade:** `broadcast-presentation.test.ts:108-128`: contrast < 0.4, vignette ≤ 0.2, fringe, grain and
   sharpen **= 0** in all `GRADE_PROFILES`, grain seeded from presented time.
7. **Presets:** `broadcast-presentation.test.ts:17-26` pins msaa 0/2/4, AO and bloom off/on/on, filmGrade
   true. `settings-transition.test.ts:32,48` has literal `GraphicsOptions` objects, so `tsc` fails on new keys.
8. **Chunk-patch collisions:**
   - `farShadowChunks` throws if `lights_fragment_begin` no longer matches its regex or `RE_Direct` call.
   - `installSpecularAntialiasing` throws if its anchor moves.
   - `installWetRoad` string-replaces the `RE_Direct(...)` call.
   - Install new patches at module scope, idempotently (marker string), and run the full vitest suite.
9. **Light ordering:** the far map must stay directional shadow #1 (`renderer.ts:328-329`), and three sorts
   shadow-casting lights first. Adding or removing lights changes `NUM_*` defines, recompiles every lit
   program and invalidates `prepare()` warm-up. Pit warm-up is `pit-material-warmup.ts`.
10. **Determinism:**
    - e2e `13-wet-lighting-closure` (axial max diff ≤ 2), `37-race-surface-atmosphere` (≤ 1 LSB) and
      `scenery-shadow-budget` (0 changed bytes) compare renders.
    - Held frames must be identical. Use `H.TIME` (`presented[H.TIME]`), never wall time, and no
      `Math.random()` in shaders or uniforms.
    - Exposure, motion blur and probe reset on cuts.
11. **Pass state hygiene.** Every pass restores the render target, face, mip, viewport, scissor, autoClear,
    clear colour, `shadowMap.autoUpdate` and `scene.overrideMaterial` in `finally` (see `reflections.ts:290-313`).
    Ledger phases must still sum to `renderer.info` (`scripts/infrastructure-render-budget.ts:42`).
12. **Depth precision.** Near 0.045 and far 7000 with standard depth means view-z error of ~1 m at 1 km
    in Float32. Screen-space effects should fade beyond ~200 m, as AO does at 90-220 m. r180's
    `reversedDepthBuffer` needs EXT_clip_control, and every depth reader checks `depth >= 0.99999` for sky.
    Not recommended now.
13. **Capture path.** `capturePhoto()` reads the canvas immediately after `draw()`. There is no
    `preserveDrawingBuffer`. Anything temporal (TAA) must be converged or disabled for capture frames.
14. **Context loss and SwiftShader.** All CI images use SwiftShader, about 9 s per cockpit frame. Large
    kernels (PCSS 32+ taps, 16-step GTAO at full resolution) multiply CI time. Prefer half resolution and
    ≤16 taps on Medium.
15. **Hot file.** `renderer.ts` (1,849 lines) is touched by every department. Put each feature in its own
    module with a ≤10-line hook in `renderer.ts`, and rebase often.

---

## 14. Recommended work split (to avoid merge conflicts)

| Owner | Files they own | First deliverable |
|---|---|---|
| Lighting & Sky | `daylight.ts`, `lighting-coherence.ts`, new `atmosphere-lut.ts`, `renderer.ts:919-953` | 12.1 A+B+C (IBL gain, ground in env, PMREM 256), then sky tuning and clouds |
| Shadows | `far-shadow.ts`, new `shadow-filter.ts`, `renderer.ts:332-344,1147-1155,1334-1391` | Medium 2048 + PCSS/Vogel filter; car OBB grounding uniform; High near cascade |
| Post A (AO, contact, motion, TAA) | `scene-ambient-pass.ts`, `motion-blur.ts`, new `velocity.ts` | GTAO + contact shadows (G channel); depth-reprojection motion blur default on |
| Post B (bloom, grade, lens, DOF) | `lens-bloom.ts`, `broadcast-grade.ts`, new `dof-pass.ts`, `renderer.ts:379-398,799-807,1284-1302` | LUT in grade, per-mode bloom, flare and dirt, depth-texture DOF |
| Surfaces & wet | `materials.ts`, `wet-reflection.ts`, `surface-detail.ts`, `shaders/*.frag` | wet planar on Medium + streaks; road albedo per art bible |
| Settings gatekeeper | `options.ts`, `ui/presentation.ts`, `tests/settings-transition.test.ts` | one PR adding all new option keys at once |

Each change should commit focused unit tests and run `npx vitest run <affected tests>` plus `npx tsc --noEmit`.
After it, run a SwiftShader capture (`scratchpad/tools/capture.mjs <out> --quality medium|high`) and
compare against `shots/baseline`. For budget-relevant changes, run `npx playwright test e2e/scenery-shadow-budget.spec.ts`.
