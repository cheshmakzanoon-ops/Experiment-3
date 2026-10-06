# Gap Analysis: Apex Formula (Aurel) vs EA F1 25 (PS5)

Author: Lead Artist (studio pre-production). Status: analysis only. No source was changed.
Companion docs: `ART_BIBLE_A.md` (lighting, surfaces, cars, characters, with measured hex targets) and
`ART_BIBLE_B.md` (HUD, cockpit, broadcast, front-end). This doc rates each **gap**, names the **code
owner**, and gives a **Three.js r180 approach**. Where the art bibles already give a number, I quote it
here rather than restate it.

## 0. Method and evidence

- **Baseline:** 7 SwiftShader captures at 1280x720, Medium preset (`shots/baseline/00-menu`,
  `10/11-chase` grid chase and cockpit, `12/13-pod` T-cam and trackside, `20/21-driving` at 152 and
  77 km/h) plus `diag.json`: 1,103 draws, 4.45 M triangles, 285 textures, 245 shadow casters, 650 trees,
  reflectionIntensity 0.27, mirror width 256.
- **References viewed individually (33):** 001, 002, 003, 004, 006, 007, 008, 009, 010 (official
  PlayStation); 034, 035, 037, 038 (PushSquare PS5); 041, 042, 039 (ThumbCulture); 043, 045, 047, 066
  (TechRadar); 068, 070 (TopGear); 076, 077, 078, 080 (Traxion photo mode); 085 (GamesCreed); 087, 089
  (Maxi-Geek); 093 (NoobFeed); 094 (JoinSteer); 095 (OnPSX); 096 (Vandal); 098 (GamingBolt).
  **All 100 were triaged** on three contact sheets.
- **Exclude from art direction:** `review_techradar` 048-065 are unrelated site images (wheel/pedal
  product shots, other games, phones, cameras, 3D printer). 023-030 are tutorial video thumbnails that
  include a presenter. 017 is AVIF data with a .jpg extension (decode it with ImageMagick). 091 and 099
  are promotional portraits.
- **Measurements** use sRGB-luma patch statistics from `scratchpad/tools/patch.py` and `stats.py`.
  "hf" is the mean absolute Laplacian, a proxy for visible micro-detail.

| Patch | Baseline | F1 25 refs | Read |
|---|---|---|---|
| Clean dry asphalt | #3e3e43 / #3f4044 / #3d3d41, std **0.006-0.011** | #676962 (085), #7e7a6a (076), #8c8378 (037), #b6b4ac (070, low-sun glare), std 0.03-0.10 | about 1 stop too dark, slightly blue, textureless |
| Clear sky, mid-dome | #abd1da, #9ac9dc, sat 0.22-0.30 | #94ccf4 (089), #8ebff2 (034), #58a6d3 (076), sat 0.39-0.58 | cyan-grey and under-saturated |
| Sunlit grass | #38501e, #465926, sat **0.57-0.62** | #414d30 (089), #76783f (085), #7b8055 (076), sat 0.33-0.47 | too saturated, too pure green |
| Tree masses | #466033, sat 0.47 | #3f4c3f (089), sat 0.17 | too yellow-green, too bright |
| Cockpit frame, share of pixels <0.06 luma | 0.31-0.33 (11, 21) | 0.10-0.19 (008, 094, 096) | cockpit crushed to black |
| Whole frame p50 / p95 | 0.17-0.58 / 0.82-0.90 | 0.19-0.71 / 0.66-0.94 | global range is fine. Fix materials and fill light, not exposure |

**Five root causes, which explain about 80% of the visible gap:**
1. Fill and IBL are too weak: env 0.28, no ground bounce. Dark liveries, the cockpit and car undersides
   go black, and paint shows no reflections.
2. Surface albedos are wrong: dark blue-grey asphalt, neon-green grass and trees, and no
   micro/meso texture visible at gameplay distances.
3. There is **zero trackside branding** and the venue is sparse. Real F1 broadcasts are wall-to-wall
   boards, flags and dense crowds or forest.
4. There is no motion language. Motion blur is 0 in every preset and wheels never blur, so 152 km/h
   reads as a still frame.
5. Vegetation, crowd and characters are low-density, low-fidelity assets. The trees read as an orchard
   of lollipops, the drivers' gloves as blobs, and the crew have about 9 k triangles each.

## 1. Pipeline snapshot (what implementers touch)

`renderer.ts` constructor (L271-405):
- WebGL2 with MSAA `SceneAmbientPass` (scene draw plus half-res SAO), then `AdaptiveExposurePass`,
  `MotionBlurPass` (velocity buffer), `LensBloomPass`, `OutputPass` (tone map plus sRGB), `FXAA` (only
  when MSAA is 0) and `BroadcastGradePass` (display-referred).
- Tone mapping is `ACESFilmicToneMapping` at L311 (exposure 1.05, then overwritten per frame at
  L940/L1295 with `daylight.exposure` 0.9 times adaptation). Shadows are `PCFSoftShadowMap` (L314).
- Sun: `DirectionalLight(0xffead0)` at L185; its intensity is overwritten by `daylight.sun` (4.2 clear).
  Its shadow is a 2048 map over ±38 m around the followed car, near 20, far 500, bias -1.5e-5,
  normalBias 0.008 (L331-344). `FarShadow` holds a baked map of the whole circuit plus 150 m.
- `HemisphereLight(0xc3d8f3, 0x33372e)`, intensity set by `daylight.fill` = 0.26 (L186, L936).
- `scene.environmentIntensity` = `daylight.environment` = 0.28 (L937). The sky PMREM is 128 px
  (`daylight.ts:407`). The local cube probe is 128 px on High only (`reflections.ts:79`).
- `FogExp2`, density 0.000205 clear, colour (0.50, 0.61, 0.77) linear (`daylight.ts:46-50`, applied at
  `renderer.ts:941-943`).
- Sun direction `SUN_OFFSET` (-160, 190, -130) is about 42.7° elevation (`daylight.ts:7`).

Quality tiers (`options.ts:28-49`), Low / Medium / High: resolution scale 0.75 / 1 / 1; textures
256 / 512 / 1024; sun shadow off / 1024 / 2048; reflections env / env / local probe; MSAA 0 / 2 / 4;
anisotropy 2 / 8 / 16; particles 0 / 0.65 / 1; bloom, AO and crowd off / on / on; **motionBlur 0 / 0 / 0**.
Every change below must keep **Low** cheap and gate the expensive paths to Medium/High.

Guardrails:
- Tests pin many of these constants. Update them deliberately and run `npx vitest run` and
  `npm run build`. The pinning tests are `tests/presentation.test.ts`, `visual-coherence.test.ts`,
  `sky-linear.test.ts`, `lens-bloom.test.ts`, `dusk-readability.test.ts`,
  `weather-reconciliation.test.ts`, `broadcast-presentation.test.ts`, `phase27g-*.test.ts` and
  `reference-rendering.test.ts`.
- **Blender is not installed** in this container (`which blender` returns nothing). New art must be
  procedural TypeScript or Three.js, or GLB written by node or python scripts.
- **IP:** use invented brands only, and never copy reference pixels. The supplied player GLB (RB19-derived,
  `supplied-player.manifest.json`) shows real sponsor marks in `00-menu`. Producer must decide on a
  fictional replacement before any public build.

---

## 2. Element-by-element gap analysis

Format: **Now** is what the baseline shows. **F1 25** is the target, with reference IDs. **Sev** is gap
severity from 1 to 10. **Files** are the code owners. **Approach** is the r180 technique and starting
values (tune against captures).

### 2.1 Sky (Sev 7)
- **Now:** Preetham `Sky` with an authored 2D-noise cloud field (`daylight.ts:231-305`). The mid-dome
  is flat cyan-grey (#9ac9dc-#abd1da). The "clouds" are a few small dark-grey smudges that read as dirt
  (top-left of 10-chase). The horizon washes to pale green-grey (#c0dada), and there are no sunlit
  cumulus.
- **F1 25:** Clear days have a saturated cerulean zenith (#70a6cb-#8ec0f3 in gameplay, #2197cb in
  photo mode) grading to #bfdbec at the horizon, with B - G of at least 15. Fair-weather cumulus have
  bright white sunlit tops and blue-grey bases (007, 044, 098). Overcast is layered stratus with
  visible structure (085, 010, 096).
- **Files:** `daylight.ts`: `configureSky` L231, `daylightState` L30-52 (turbidity 2.3, skyRadiance
  0.32), `SKY_SCATTERING` L131 (rayleigh 2.9, mie 0.0032, g 0.82), `SkyEnvironment.capture`
  L386-420. `renderer.ts` L945-955.
- **Approach:**
  1. Fix the colour first. Clear-day turbidity 2.3 → 1.6-1.9; A/B rayleigh 2.2 / 2.9 / 3.5 against the
     measured zenith target. Lower
     `skyRadiance` 0.32 → 0.26 so the dome sits around sRGB 0.65-0.75 and ACES stops pushing it
     toward cyan-white. Add a small zenith blue boost in the replaced fragment:
     `retColor *= mix(vec3(1), vec3(0.92,0.97,1.08), smoothstep(0.05,0.6,direction.y))`.
  2. Replace `skyCloud` 2D noise with a 2.5D cumulus slab: base 1,400 m, top 2,600 m, ray-marched in
     the dome shader with 12-16 primary steps and 4 light steps. Use FBM density built from
     Perlin-Worley (stored as a 128³ `Data3DTexture` generated at load), Beer-Powder lighting and a
     Henyey-Greenstein phase with g=0.6 for the silver lining. Coverage comes from `cloudCover`.
     The dome is one full-screen fragment. The PMREM capture (`SkyEnvironment.capture`) then puts the
     clouds into the car reflections for free.
  3. **Cheaper alternative:** bake a 2048x1024 HDR cloud panorama per cover bin into a
     `HalfFloatType` render target once at load, and sample it in the dome shader.

### 2.2 Sun lighting and fill (Sev 8)
- **Now:** Sun 4.2, hemisphere fill 0.26, environment 0.28, exposure 0.9. The key-to-fill ratio is
  very high, but the fill is a non-directional hemisphere, so shading is both flat and crushed. The
  player car is a black silhouette in 10-chase and 20-driving-a. 31-33% of cockpit-view pixels sit
  below 0.06 luma. The car's cast shadow on asphalt is #101216, neutral black. Refs are blue (Art
  Bible A: B/R 1.8-2.1). Bodywork has no specular modelling.
- **F1 25:** A crisp warm key, with highlights streaking along curved sidepods and the halo (077, 078,
  009). Shadow sides are lifted by blue sky and warm ground bounce, so carbon weave stays readable in
  shade (080, 009). Cockpit interiors are dark but detailed (003, 094).
- **Files:** `daylight.ts` L30-52 (`daylightState`), L57-101 (`circuitLightState` for sunset and
  night); `renderer.ts` L185-186, L918-955; `lighting-coherence.ts` (`applyCircuitLightPalette`);
  `adaptive-exposure.ts` / `exposure-meter.ts` (`METER_KEY`).
- **Approach:**
  1. **Add ground bounce to the IBL.** In the `SkyEnvironment` constructor (`daylight.ts:383`), add
     a ground disc to `environmentScene` (radius 4 km, at y = -2 m) with `MeshBasicMaterial`, linear
     colour ≈ (0.20, 0.19, 0.16) × sun-irradiance factor, fading to the fog colour at the rim. The
     lower hemisphere of the PMREM is currently the Preetham below-horizon colour, which gives a
     wrong, sky-coloured underside.
  2. Rebalance: `environment` 0.28 → 0.8 clear and 0.65 overcast, and drive it with
     `scene.environmentIntensity`. `fill` (hemisphere) 0.26 → 0.05, or remove it. The IBL now does
     this job directionally. `sun` 4.2 → 3.4. Re-anchor exposure so sunlit asphalt lands at
     #7d7a76-#938b83 (Art Bible A §3).
  3. PMREM size 128 → 256 (`daylight.ts:407`) for crisper glossy reflections.
  4. Lower the sun to about 32° (`SUN_OFFSET` y 190 → 130) for longer shadows and stronger modelling.
     Update `shadowAnchor` tests.
  5. Light colour: key #fff1df (≈5,600 K); the sky colour then comes from the IBL.

### 2.3 Shadows (Sev 7)
- **Now:** The near map is ±38 m (3.7 cm per texel at 2048, 7.4 cm at 1024). The far map is one
  baked 2048 map over the whole venue (≈1.0 x 1.2 km plus margin, so ≈0.6-0.8 m per texel).
  Detail collapses beyond the 38 m near box: tree and grandstand shadows there are mushy blobs
  (13-pod left). There are no
  dappled tree shadows across the road, and the car contact shadow is weak and soft.
- **F1 25:** Crisp dappled canopy shadows across the track (089). Long grandstand-roof shadows. Sharp
  car shadows with contact hardening (076, 002, 077).
- **Files:** `renderer.ts` L331-344 and L714-746; `far-shadow.ts`; `shadow-proxies.ts`;
  `static-instance-shadow-bounds.ts`; `aurel-vegetation.ts` (casters).
- **Approach:**
  1. Add a **middle cascade**: a second dynamic `DirectionalLight` shadow at ±160 m, 2048 on High
     (15.6 cm per texel) and 1024 on Medium. Use the same texel-snapping (`shadowAnchor`) and shader
     selection pattern as `apexFarShadow` in `far-shadow.ts:25`, rather than adopting
     `three/addons/csm/CSM.js`. CSM patches `lights_fragment_begin` and will fight the existing
     far-shadow and proxy patches. Update the middle cascade every 2nd frame.
  2. Foliage must cast alpha-tested shadows: give it a `customDepthMaterial` with
     `MeshDepthMaterial({ alphaTest: 0.45, map: foliageAtlas })` (`depthPacking` must match the
     renderer).
  3. Contact hardening on High: override the `shadowmap_pars_fragment` PCF with a 16-tap blocker
     search PCSS. Light size is about 0.012 in light-UV and the penumbra is clamped to 3-12 texels.

### 2.4 Ambient occlusion and contact (Sev 6)
- **Now:** Half-res depth SAO (`scene-ambient-pass.ts:22-31`: radius 0.9 m, intensity 1.15,
  maxPixels 72, fade 90-220 m, near fade 0.9-2.2 m). Cars look slightly floating, wheel wells and
  sidepod undercuts are shallow, and barrier bases are unoccluded.
- **F1 25:** Very dark floor and plank contact under every car, dark tyre contact patches, deep
  occlusion under sidepods and around the halo base (076, 078, 044, 066).
- **Files:** `scene-ambient-pass.ts`, `car.ts`, `supplied-player.ts`, `a61-rival.ts`.
- **Approach:**
  1. **Per-car ground AO decal**, the cheapest high-impact fix. Each car gets one quad
     (5.7 x 2.1 m) under the floor with a 256² baked radial-occlusion `CanvasTexture`: 0.85 under the
     plank, 0.92 at the four contact patches, feathered to 0 at 0.4 m outside the footprint. Use
     `MultiplyBlending`, `depthWrite: false`, and `polygonOffset -2`. Fade it out with the car's
     ride height.
  2. SAO tuning on Medium/High: intensity 1.15 → 1.5, radius 0.9 → 1.1, keep the near fade.
     Optional on High only: `GTAOPass` (r180) with radius 0.6, distanceExponent 1.5, thickness 1,
     samples 16. Note it needs its own normal and depth pass (+1,100 draws), so prefer tuning the
     existing pass.
  3. Bake vertex AO (`color` attribute) into kerbs, barriers and fences at generation time
     (0.6 at the ground seam).

### 2.5 Tone map and grade (Sev 5)
- **Now:** ACES, exposure 0.9 × adaptive. `BroadcastGrade` day profile: contrast 0.16, saturation
  1.06, vibrance 0.16, vignette 0.12, with no grain or fringe (`broadcast-grade.ts:24-33`). Global
  percentiles already match. The look problems are the sky cyan shift (ACES skews bright blues) and
  crushed darks caused by weak fill.
- **F1 25:** Punchy contrast, neutral hues, vivid liveries (Ferrari red stays red in 077/047, papaya in
  078), p5 0.02-0.11, only glints clip.
- **Files:** `renderer.ts:311,940,1295`; `broadcast-grade.ts`; `adaptive-exposure.ts`.
- **Approach:** Keep ACES as the default (agreeing with Art Bible A §3) **after** fixes 2.2 and 2.8,
  then re-measure. If livery hue shift is still above 5° (red toward orange, blue toward cyan), A/B
  `T.NeutralToneMapping` (Khronos PBR Neutral, constant 7 in r180) with grade contrast 0.22,
  saturation 1.04. Add an optional `LUTPass` (`three/addons/postprocessing/LUTPass.js`) with a 33³
  `Data3DTexture` generated in code per lighting mode (day, sunset, night, wet) for the final look.
  Wet/overcast grade: saturation 0.95, contrast 0.18, shadow tint (0.97, 1.0, 1.04).

### 2.6 Bloom, lens and emissives (Sev 4 day / 7 night and wet)
- **Now:** `LensBloomPass` threshold 3.6 linear, knee 1.8, strength 0.55 (`lens-bloom.ts:19-35`). No
  bloom is visible in any baseline frame, and there is no flare.
- **F1 25:** Strong red rain-light bloom in spray (010, 068), start-light glow (094), floodlight masts
  and LED boards at night (087, 079), sun veil at low angles.
- **Files:** `lens-bloom.ts`, `rear-signal.ts`, `track-signal-hardware.ts`, `venue-lighting.ts`,
  `steering-display.ts`.
- **Approach:** Keep the threshold. Make emitters **HDR-bright** instead: rain light
  `emissiveIntensity` 12-20, start lamps 25, wheel LEDs 6, LED boards 2.5. Strength 0.45 by day and
  0.8 at night or in the wet (Art Bible A). Bloom must sample spray quads so the rain light glows
  inside the mist. Sun flare: `three/addons/objects/Lensflare.js` with 4 ghost elements at ≤4%
  opacity. Show it only when the sun is within 25° of the view axis **and** a 1-px depth read at the
  sun's screen position is sky. Chase and TV cameras only.

### 2.7 Motion blur, DOF and anti-aliasing (Sev 7)
- **Now:** `MotionBlurPass` exists (per-object velocity, `motion-blur.ts`), but `options.ts:41` sets
  `motionBlur: 0` for all tiers. 20-driving-a at 152 km/h is pin-sharp. Wheels never blur, and DOF is
  photo-mode-only (`BokehPass`). Thin fence wire shimmers and moirés (21-driving-b).
- **F1 25:** Gameplay: near road, kerbs and barriers streak (008, 042, 037), while the car stays
  sharp. Wheel covers and sidewalls blur radially, so lettering is unreadable above 120 km/h (002,
  080, 022). Replays and photo mode: full panning blur and shallow DOF (002, 078, 080, 004).
- **Files:** `options.ts:41`, `motion-blur.ts`, `renderer.ts:714-746`, `tire-finish.ts`, `car.ts`,
  `supplied-player.ts`, `photo-camera.ts`, `broadcast-cameras.ts`.
- **Approach:**
  1. Presets: motionBlur Low 0, Medium 0.3, High 0.45. Max blur 3.5% of width, at least 10 taps.
  2. Write zero velocity for the followed car in chase, T-cam and cockpit views (the camera is
     rigidly attached), e.g. a `userData.cameraLocked` flag read by the velocity material.
  3. **Wheel blur:** precompute a radially-blurred rim and sidewall `CanvasTexture` and blend to it
     with `uWheelBlur = smoothstep(18, 45, angularSpeed rad/s)`. Optionally add an alpha
     "spoke-disc" overlay.
  4. Broadcast and replay cameras: a CoC gather DOF focused on the followed car, with aperture scaled
     by FOV (32° telephoto gives a shallow field).
  5. High tier: TAA with neighbourhood clamp, reusing the velocity buffer. This fixes fence and wire
     shimmer and makes motion blur temporally stable.

### 2.8 Asphalt (Sev 8)
- **Now:** `surfaceMaterial('asphalt')` (`surface-detail.ts:75-124`): a 512² tile every 0.64 m with
  bumpScale 0.00045 (visually flat) and no normal map, plus road-macro patches (`road-macro.ts`) and
  finish noise (`circuit-finish.ts`). Measured #3e3e43 with std 0.006-0.011: a flat dark-grey slab.
  The racing line is invisible. Seeded rubber peaks at 0.45 (`track.ts:224`), but the shader darkens
  by only `rubber × 0.25`, giving -11% (`src/shaders/wetRoad.frag:8`), on a coarse 512x7 cell grid
  (≈5.8 m x 2 m cells). No sheen toward the sun.
- **F1 25:** Sunlit off-line asphalt #7d7a76-#938b83. A rubbered line at about 45% of off-line linear
  luminance, crisp-edged and car-wide. Aggregate sparkle within 5 m, and dusty, lighter edges by the
  kerbs. Strong grazing glare at low sun (070, 008), tar-snake repairs, and marbles off-line (089, 037,
  066).
- **Files:** `surface-detail.ts`, `circuit-finish.ts:15+` (its comment forbids fabricated rubber:
  keep using the simulation's rubber state), `road-macro.ts`, `src/shaders/wetRoad.frag`,
  `asphalt-aggregate.ts`, `circuit.ts:143`, `simulation/track.ts:211-225`.
- **Approach:**
  1. Albedo: raise to linear about 0.16-0.20 (sRGB about #6e6c68), neutral to slightly warm. Remove
     the blue cast.
  2. Generate a **normal map** from the existing height field (Sobel, strength 2.5) at two scales: a
     0.64 m micro tile and a 4.5 m meso tile with a different seed. Fade micro to its mean between 15
     and 40 m using derivatives (the `finishDetailWeight` pattern).
  3. Roughness: 0.86 base, 0.74 on the rubber line, 0.92 in dusty edges. Add a cheap
     glint term: aggregate specular sparkle within 6 m, from hash × N·H^256.
  4. **Racing line:** upload a 1D `Float32` `DataTexture` (4,096 samples along s) of
     `racingLineFor(track).offsetAt(s)`. In the road shader compute
     `fromLine = (lateral - offset) / 0.95` per pixel and darken by
     `1 - 0.5 × rubber × exp(-0.5 × fromLine²)`. Keep the simulated `roadState.g` as the amplitude so
     physics stays the source of truth.
  5. Edge dust: lighten 8% within 0.8 m of the track edges. Add tar snakes as thin, dark, glossy
     curves (roughness 0.45) from noise iso-lines.

### 2.9 Kerbs (Sev 6)
- **Now:** Vertex-coloured ribbon in 3 m bands of 0xdc553b / 0xe8e3cf (`circuit.ts:194,489`),
  roughness 0.85, plus physical height. Reads as clean vector bands: no ridges, wear or rubber, and an
  orange-red hue.
- **F1 25:** Ridged or serrated painted kerbs catching sun, black rubber streaks where the line
  crosses, chipped paint, gloss paint at roughness about 0.5. Several styles: red/white,
  red/yellow outer (076), green/white with painted run-off (044, 007, 066).
- **Files:** `circuit.ts:192-215,489`, `circuit-finish.ts` ('kerb'), `simulation/contact.ts`
  (`kerbHeight`).
- **Approach:** Colours: red #c4232b, white #e6e4dc. Paint roughness 0.5; worn paint 0.85.
  Procedural ridge normal, `sin(2π·s/0.32)` with a 6 mm amplitude equivalent. Wear mask from noise
  times proximity to the racing-line crossing. Rubber streaks are dark (#26262a) and run along s.
  Data-drive a kerb-style palette per corner, add sausage kerbs at 3 apexes, and add an optional
  green "astroturf" band behind exit kerbs.

### 2.10 Grass (Sev 6)
- **Now:** Grass tile at 2.5 m plus mowing stripes. Saturated #38501e-#465926 (sat 0.6). Flat, with
  no blades, and a hard seam against gravel and track.
- **F1 25:** Olive, desaturated (#727939-#878c48, sat 0.33-0.47), patchy with dry yellow areas, with
  real 3D blades at the verges, dappled shade (089) and broad mowing stripes (076, 085).
- **Files:** `surface-detail.ts` ('grass'), `circuit-finish.ts` ('grass', 'terrain'),
  `circuit.ts:151-171,265-275`, `landscape.ts`.
- **Approach:**
  1. Albedo: hue toward yellow-olive, saturation × 0.65, and +0.25 stop of brightness.
  2. Macro variation from two noise octaves at 25 m and 90 m (±12% value, ±0.04 hue toward yellow).
  3. **Near grass tufts:** an `InstancedMesh` of 3-card crossed tufts (0.10-0.18 m, alpha-tested,
     `alphaToCoverage` with MSAA) on a camera-following 60 x 60 m ring. Density 30-40 per m² near,
     fading out from 12 m to 35 m. Wind vertex sway is 2 cm at 1.5 Hz. Medium and High only.
  4. Blend strips: 0.4 m of worn grass and soil at the track and gravel seams.

### 2.11 Gravel (Sev 6)
- **Now:** Gravel ribbon with a 0.9 m tile, bumpScale 0.009 and no finish shader. Reads as a flat
  beige cardboard band (13-pod, 20-driving-a).
- **F1 25:** Visible pebbles, raked texture, tyre ruts, and thick sunlit dust when cars run through (041).
- **Files:** `surface-detail.ts` ('gravel'), `circuit.ts:154,163`, `effects.ts` (dust).
- **Approach:** 8-12 step parallax occlusion mapping on a Voronoi pebble height field (cells 1.5-3 cm,
  rounded caps). Albedo #b7a98f with ±8% per-pebble hue jitter, and cavity AO from height. Fade POM
  to the normal map beyond 20 m. Add rut decals along off-track excursions.

### 2.12 Terrain, mountains and atmosphere (Sev 6)
- **Now:** Ridged-noise terrain (`terrain-profile.ts:50-64`, crests to about 260 m) shaded by slope
  and elevation (`circuit-finish.ts:74-86`). Hills are smooth, faceted and olive (#898e6b). The quarry
  mounds (`aurel-quarry`) read as flat-shaded beige polygons. Aerial perspective is weak and greenish.
- **F1 25:** Far hills carpeted with forest in blue-grey haze (#6f7b7a, 034; 010, 068 wet). Rock
  outcrops with strata.
- **Files:** `terrain.ts`, `terrain-profile.ts`, `circuit-finish.ts`, `aurel-quarry.ts`,
  `daylight.ts` fog values, `local-atmosphere.ts`.
- **Approach:**
  1. Add a **forest-canopy surface** on slopes beyond 400 m: a canopy albedo and normal, with vertex
     displacement of 3-8 m bumps from noise and darker crevices, instead of individual trees.
  2. Triplanar rock on slopes above 35° and on the quarry (strata normal, #8a8378).
  3. Replace `FogExp2` with a height plus sun-inscatter fog chunk override (`fog_fragment`): density
     `0.00022 · exp(-max(h - 30, 0) / 220)`. Inscatter colour = the sky horizon colour plus a Mie
     lobe `pow(max(dot(V, L), 0), 8) × 0.35 × sunColor`. Fog colour must match the sky's horizon
     colour (B > G).
  4. Increase the silhouette ring resolution.

### 2.13 Trees (Sev 8)
- **Now:** 650 instances of 6 variants (`aurel-vegetation.ts`, `VEGETATION_LOD` near 55, middle
  190 m) plus `landscape.ts` groves and impostor cards. They are spaced like an orchard, with visible
  trunks and isolated crowns. Colour #466033 is too saturated. There is no wind, no conifers and no
  canopy mass.
- **F1 25:** Continuous dense tree walls and forest belts behind the barriers (089, 068, 003, 076,
  010), mixed conifer and broadleaf, dappled light, backlit translucency, subtle sway.
- **Files:** `aurel-vegetation.ts`, `aurel-vegetation-plan.ts`, `landscape.ts`, `foliage-mipmaps.ts`,
  `scripts/author-aurel-vegetation.py` (Blender not available).
- **Approach:**
  1. **Density:** 650 → 8-15 k, planted as forest belts 30-80 m deep behind the run-off using
     clustered Poisson-disc sampling, while keeping sightline exclusions.
  2. LOD chain: mesh within 60 m (≤ 400 visible). Cross-card impostor up to 250 m. **Octahedral
     impostor atlas** (8x8 views per variant, baked at load into a 2048² RT) up to 1.2 km. Canopy
     surface beyond that (2.12).
  3. **Conifer generator:** stacked cone whorls of alpha-tested branch cards, 14-28 m tall,
     #2f3d2c. Procedural in TypeScript.
  4. Shading: spherical bent normals from the crown centre. Translucency `+= sunColor ×
     pow(saturate(dot(-V, L)), 4) × 0.35`. `alphaToCoverage: true`. Crown AO gradient: 0.55 inside,
     1.0 at the rim. Albedo toward #3f4b3e.
  5. Wind vertex shader: trunk bend `0.015·h²·sin(0.6t + φ)` plus leaf flutter of 2 cm at 3 Hz.

### 2.14 Buildings (Sev 5)
- **Now:** The pit building frontage and paddock are a white block with blue glass (10-chase left),
  plus event-hall and district boxes. Glass is flat, with no signage or rooftop detail.
- **F1 25:** Modern glass and steel paddock architecture with sky-reflecting glazing, team branding,
  hospitality terraces with people, and dense structural detail (041, 042, 094 pit straight).
- **Files:** `pit-building-frontage.ts`, `venue-architecture.ts`, `venue-districts.ts`,
  `venue-materials.ts`, `event-hall-assets.ts`.
- **Approach:** Glazing: `MeshPhysicalMaterial` with roughness 0.04, metalness 0, `envMapIntensity`
  1.4, plus an **interior-mapping** shader (parallax room cube from a procedural atlas) for depth.
  Panel-seam normal maps on facades. Rooftop clutter (HVAC, antennas) via instancing, and branded
  fascia bands (2.19).

### 2.15 Grandstands (Sev 6)
- **Now:** `grandstand.ts`: 8 rows, white seats (0xffffff, roughness 0.58), crowd density 0.56-0.91.
  The roof and steel are teal. Stands look small, low and generic.
- **F1 25:** Massive 20-40-row multi-tier stands (076 main stand, 078 crowd bank, 007), coloured seat
  patterns, flags and banners, front fascia ad boards, giant screens, camera towers.
- **Files:** `grandstand.ts`, `secondary-grandstands.ts`, `start-finish-venue.ts`,
  `race-structures.ts`.
- **Approach:** Parametric stand generator: 24 rows in 2 tiers with a cantilever roof. Seat colours
  in team blocks (fictional teams). Fascia branding band (2.19). One or two giant screens showing a
  256x144 render target of the broadcast camera, updated at 2 Hz. Instanced flag poles.

### 2.16 Crowd (Sev 6)
- **Now:** Instanced authored people (`aurel-people.glb`, LOD 0-2) plus an analytic impostor
  (`crowd-impostor.ts`). At gameplay distance they read as red, white and grey static noise.
- **F1 25:** Dense, colourful crowds with team-colour clustering (orange and red blocks), waving flags
  and standing fans, and readable individuals at 30-60 m (078, 007, 044, 094).
- **Files:** `crowd.ts`, `crowd-impostor.ts`, `audience-actions.ts`, `crowd-response.ts`.
- **Approach:** Density 0.9-1.0 in the main stands. Palette: 35% fictional team colours, 65% casual
  (white #e8e8e6, denim #3a4f6e, black #1c1c1e, and so on). Bake a 16-pose impostor atlas from the
  LOD0 mesh at load (64x128 per pose, with a normal channel). Vertex animation with a per-instance
  phase: bob 3 cm at 1.2 Hz idle, arm wave when a car passes (`crowd-response.ts`). 3-5% of
  spectators hold flag cloth quads with a wave shader.

### 2.17 Barriers (Sev 7)
- **Now:** Plain grey concrete walls (`concrete-barriers.glb`), steel guardrails and impact
  barriers. Close-up (21-driving-b) shows blotchy low-res concrete, no branding and no wear.
- **F1 25:** Barriers are almost always **wrapped in sponsor vinyl or painted**: yellow and red logistics
  style (042, 008), black watch-brand boards (070, 037), blue crypto-style (087), white series boards
  (066). Armco has 2-3 galvanised rails, and TecPro blocks are coloured.
- **Files:** `concrete-barriers.ts`, `steel-guardrails.ts`, `impact-barriers.ts`,
  `circuit-barriers.ts`.
- **Approach:** Map a branding atlas onto the barrier faces by track s (2.19). World-space scuffs
  and tyre-rub black marks at 0.2-0.5 m height near corners. Armco: metalness 0.9, roughness 0.32,
  #9aa0a4, with a streak normal. Impact blocks alternate red #b8262c and white, or blue #1e3f8a.

### 2.18 Fences (Sev 5)
- **Now:** The catch fence (`catch-fence.ts`) has very thick, near-black posts with curved tops. The
  mesh is too opaque near the camera (it dominates 20-driving-a) and moirés in the mid distance
  (21-driving-b).
- **F1 25:** Thin galvanised grey posts (#9aa0a3), fine mesh that almost vanishes beyond 30 m with
  occasional glints, and top cables (037, 042, 070, 087).
- **Files:** `catch-fence.ts`, `foliage-mipmaps.ts` (reuse its coverage-preserving mip pattern).
- **Approach:** Posts: metalness 0.85, roughness 0.45, albedo #8d9396, with a 15% thinner profile.
  Mesh: `alphaToCoverage`, coverage-preserving mips, and distance opacity `clamp(1.0 - d/70, 0.12,
  0.55)`. Add an anisotropic wire specular (`anisotropy` 0.5 on `MeshPhysicalMaterial`).

### 2.19 Billboards and trackside branding (Sev 9: the biggest "real broadcast" cue)
- **Now:** Essentially none. There is the gantry text "AUREL / GRAND CIRCUIT", braking boards
  (`track-boards.ts`) and one timing tower. Repo-wide grep finds no advert or sponsor system.
- **F1 25:** Every frame carries continuous barrier boards, bridge banners, painted run-off logos,
  fascia bands, flags, LED boards and big screens (007, 008, 037, 042, 066, 070, 087, 094, 095).
  One sponsor typically owns a whole straight.
- **Files:** new `src/rendering/trackside-branding.ts`, plus hooks in `circuit.ts`, `circuit-finish.ts`
  (run-off decals) and `venue-plan.ts`.
- **Approach:** Brand atlas: a procedural `CanvasTexture`, 2048², 16 panels of 512x128, with mipmaps
  and anisotropy 16. **Invented** wordmarks only, for example VOLTEX, NORDFIN, KESTREL TIME, HALCYON
  AIR, ORBITEL, MERIDIAN OIL and AUREL BANK. Colour schemes (yellow #f5c400 / red #c8102e, navy
  #1e2a78, black #16181c, white) follow Art Bible A §9. Placement: instanced quads 1.0-1.2 m tall
  along barrier lines from `track.at(s)` plus a lateral offset, in sponsor sections of 80-150 m per
  side. Material: matte vinyl at roughness 0.7, with 10% of boards emissive LED (`emissiveIntensity`
  2.5, animated scroll). Painted run-off logos as large decals in `circuit-finish` every 200-300 m,
  overhead banner bridges, and distance boards at 50/100/150 m (they exist; restyle them).

### 2.20 Player car materials (Sev 8)
- **Now:** The supplied hero GLB (1.46 M tris, 101 materials, 56 images) plus `car.ts` paint
  (`MeshPhysicalMaterial` with metalness 0.06, roughness 0.34, clearcoat 1, clearcoatRoughness 0.16;
  L131-136). `reflectionIntensity` measured 0.27, and the local probe is High only (128 px). The
  dark navy livery reads matte black. There are no horizon or sky reflection lines on the sidepods
  or engine cover, no visible carbon weave, and no sun glints. Decals are crisp (good).
- **F1 25:** Mirror-like clearcoat on gloss liveries, with a sharp horizon line and cloud reflections
  (009, 077, 080, 002). Satin or matte carbon with visible twill (078, 006). Rubber pickup and brake
  dust on the rims, with a gloss-vs-matte split per livery.
- **Files:** `car.ts`, `car-surfaces.ts`, `paint-finish.ts`, `supplied-player-materials.ts`,
  `reflections.ts`, `src/shaders/carbon*.frag`, `bodywork.ts`.
- **Approach:**
  1. Environment from 2.1 and 2.2 (clouds plus ground in the PMREM). Raise `reflectionIntensity` to
     about 0.9-1.0. Enable the local probe on Medium at 128 px and on High at 256 px.
  2. Gloss paint: clearcoatRoughness 0.16 → 0.04, roughness 0.34 → 0.28. Optional metallic flake
     via a `clearcoatNormalMap` noise at 0.3 mm scale and strength 0.05.
  3. Carbon: albedo #0d0e10, twill normal at 4 mm. Gloss carbon has clearcoat 1, clearcoatRoughness
     0.05 and `anisotropy` 0.5 along the weave. Matte carbon has roughness 0.48 and no coat.
  4. Supplied GLB: traverse materials by name and raise `envMapIntensity` on paint and carbon. Never
     edit source alpha (see `configureSuppliedMaterial`).

### 2.21 Rival cars (Sev 8)
- **Now:** The A61 rival near, mid and far GLBs (`finalArtApproved: false`). Simplified chunky
  chassis, louvres as stripes, a thick halo, flat teal paint and weak reflections. At 100 m and beyond
  they become purple blobs (12-pod).
- **F1 25:** All 20 cars at hero fidelity, each with a distinct team livery, sponsors and number
  (007, 044, 085, 039).
- **Files:** `a61-rival.ts`, `lod.ts`, `car-livery.ts`, `car.ts`, `scripts/author-a61-rival.py`.
- **Approach:** Build rivals from the hero geometry. A node script using the `meshoptimizer` wasm
  package (no Blender needed) produces LODs of 250 k, 60 k and 12 k triangles. Repaint through a
  livery-mask shader: primary, secondary and accent colour plus a fictional-sponsor decal atlas and
  number, keyed off material names. Same paint and carbon materials as 2.20. Probe only on the
  nearest 2 rivals. **Blocked on:** a producer decision on the real marks in the supplied textures.

### 2.22 Tyres and wheels (Sev 7)
- **Now:** `tire-finish.ts:39` uses `MeshStandardMaterial` 0x191c1d at roughness 0.9, with a
  compound ring. Rims are featureless dark discs and there is no sidewall lettering. Sidewalls look
  like grey plastic (10-chase zoom).
- **F1 25:** Bold sidewall lettering and a coloured compound band (red, yellow, white, green, blue),
  slightly satin fresh rubber, a scrubbed matte tread with graining and pickup, team-logo wheel
  covers, radial blur at speed, and sidewall bulge at the contact (002, 078, 080, 047).
- **Files:** `tire-finish.ts`, `tire-carcass.ts`, `tire-profile.ts`, `src/shaders/tread.frag`,
  `wheel-pose.ts`.
- **Approach:** Sidewall `CanvasTexture` with invented wordmarks ("APEX RACE SLICK" and a compound
  name), arranged as a radial UV ring. Sidewall roughness 0.55, tread 0.85, albedo #18191b. Wear and
  graining mask driven by the simulated tyre wear. Wheel-cover discs with team decals. Contact-bulge
  vertex shader: about 2.5 cm lateral bulge on the bottom 30° arc, scaled by load. Blur from 2.7.

### 2.23 Driver (Sev 7)
- **Now:** `apx01-driver.glb`, at most 20 k tris and 9 joints, with suit, gloves and `helmet-shell.ts`.
  Gloves are dark navy blobs (11-chase, 21). The helmet is a plain white shell with a dark visor
  (00-menu).
- **F1 25:** Detailed gloves with knit fabric, stitching, palm grip and team colours (003, 094, 096,
  093). Vivid personal helmet designs with clearcoat, an iridescent or tinted visor reflecting the
  world, HANS and belts (009, 004). Head lean in corners.
- **Files:** `driver.ts`, `driver-asset.ts`, `driver-materials.ts`, `helmet-shell.ts`,
  `driver-anatomy.ts`, `driver-tailoring.ts`.
- **Approach:** Helmet: `MeshPhysicalMaterial` with clearcoat 1 and clearcoatRoughness 0.03, plus a
  procedural livery canvas (stripes, number, flag, signature). Visor: `iridescence` 0.6,
  iridescenceIOR 1.3, thickness range 250-400 nm, roughness 0.02, metalness 0.6. Gloves and suit:
  `sheen` 0.6 with `sheenColor` = team colour, and a procedural knit normal at 1.5 mm. Palm silicone
  print. Head roll ±6° driven by lateral g, with a 0.15 s lag.

### 2.24 Pit crew and grid personnel (Sev 7; no baseline capture yet)
- **Now:** `crew-performance.glb` and `grid-mechanic.glb` (9,168 tris, 15 bones), animated by
  `pit-crew.ts`. Not in the baseline set: **QA must capture pit-stop and grid-crew frames first.**
- **F1 25:** About 20 crew in full team kit with visor helmets, fabric folds, logos and a fast
  choreographed stop (004, 095). The grid has crews with blankets, tablets and headsets (047).
- **Files:** `pit-crew.ts`, `crew-suit.ts`, `crew-geometry.ts`, `crew-pose.ts`,
  `grid-mechanic-asset.ts`, `marshal-staff.ts`.
- **Approach:** Suit: sheen fabric, fold normal atlas and fictional team decal atlas. Helmets:
  clearcoat with a dark visor. LOD0: smooth normals plus one subdivision pass in a node script. Add
  secondary motion (head look-at to the car, idle weight shifts) and spread pose timing for natural
  asynchrony.

### 2.25 Wet weather (Sev 7, estimated; no wet baseline)
- **Now:** A strong technical base: water-film clearcoat with puddles and ripples
  (`materials.ts:100-160`, `wetRoad.frag`), planar wet reflection (`wet-reflection.ts`), porous
  darkening (`weather-presentation.ts`), rain streaks and spray clouds. None of it was captured
  (the baseline is clear and dry).
- **F1 25:** Flat overcast light, a dark glossy road with streaky car and sky reflections, standing
  water in ruts, beaded droplets on bodywork (096), rain on the halo and lens, and misty distance
  (010, 068, 085, 093).
- **Files:** `weather-presentation.ts`, `wet-reflection.ts`, `materials.ts`, `rain-streaks.ts`,
  `precipitation-light.ts`, `daylight.ts` (rain fog term).
- **Approach:** QA: capture wet chase, cockpit and TV views first. Add **screen-space lens
  droplets** for chase and TV cameras: 40-80 refracting droplet sprites that slide and streak, using
  `tDiffuse` offset by the droplet normal. Bodywork beads: a top-facing mask times a droplet
  `clearcoatNormalMap`. Rain fog density ×3, overcast grade (2.5), wet reflection enabled on Medium.

### 2.26 Spray (Sev 6, estimated)
- **Now:** `spray-clouds.ts` draws instanced lit quads, metre-sized with a ground fade; a rooster-tail
  share comes from the diffuser (`effects.ts`).
- **F1 25:** A dense rooster-tail mist trailing 20-40 m, forward-scattering when backlit, glowing red
  around the rain light, and cutting visibility for following cars (010, 068, 093).
- **Approach:** Soft particles with a depth fade against `SceneAmbientPass` depth (fade over 0.5 m).
  HG phase g=0.5 toward the sun and the rain light. Velocity-stretched sprites. A third "wake haze"
  layer: one stretched box volume behind each car, 8-step ray-marched noise density at alpha ≤ 0.35.

### 2.27 Particles: sparks, dust, smoke, debris (Sev 5)
- **Now:** `effects.ts` points for sparks and debris. Smoke and dust go through SprayClouds. None
  appeared in the baseline frames.
- **F1 25:** A thick lit dust plume in gravel (041), floor sparks at night with bloom, white lock-up
  smoke.
- **Approach:** Sparks: additive velocity-stretched quads with HDR emissive ×15 so bloom catches
  them. Dust: lit soft particles sampling the sun shadow, colour #c9b597. Lock-up smoke: #d9d9d6,
  lifetime 1.2 s.

### 2.28 HUD (Sev 6; detailed spec in Art Bible B §1)
- **Now:** Bottom-right block: gear tile, 3-digit speed and ERS/fuel bars on #10191eef with a gold
  top border. Top-left: an 8-row tower. Top bar: flag and weather pills. Top-right: delta panel.
  **Permanently visible camera tabs** (CHASE / PIT / ERS / DATA / REPLAY / AI OFF). A "CAR RIGHT"
  red triangle. All text is Arial.
- **F1 25:** A bottom-centre twin-ring cluster: battery ring, big gear numeral, speed and RPM ring
  (034, 037, 070, 085, 094). Around it: a slim 5-row tower with team marks and tyre icons. A
  top-right sector strip (S1, S2, S3 with purple, green and yellow fills). A left-edge proximity
  bar. Contextual prompts at the bottom right. Deep-navy translucent panels and a clean geometric
  sans with tabular numerals.
- **Files:** `src/ui/interface.ts`, `race-day-hud.css`, `compact-race-hud.css`, `style.css`
  (Arial at L2 and L128).
- **Approach:** Follow Art Bible B §1: build the cluster from SVG arcs (`stroke-dasharray` driven by
  CSS vars). Self-host an OFL font (for example Titillium Web 600/700) in `public/fonts` and use
  `font-variant-numeric: tabular-nums`. Hide the camera tabs behind input. Use 180 ms slide
  transitions.

### 2.29 Menu (Sev 5)
- **Now:** The live 3D car-on-grid backdrop is a good base. On top of it: a dropdown column, an
  orange ENTER CIRCUIT CTA, and 9 equal secondary buttons including developer items (SESSION 146
  EVIDENCE, REFERENCE REVIEW, build hash). The car is shot flat, with no DOF or studio light.
- **F1 25:** Cinematic full-bleed scenes with shallow DOF and dramatic rim light; tabbed hub; image
  tiles; magenta and red radial backdrops for driver select (035, 017, 018, 019, 031).
- **Files:** `interface.ts`, `style.css`, `menu-preview.ts`, `photo-stage.ts`,
  `headquarters-stage.ts`.
- **Approach:** Slow dolly or orbit camera with `BokehPass` (focus on the car, f/2.8 look) and a
  studio light rig (key, 2 rims, reflective floor via the existing photo stage). Tabbed hub: RACE /
  TEAM HQ / GARAGE / SETTINGS, with live-rendered thumbnails. Move the evidence and review entries
  behind `?dev=1`.

### 2.30 Cockpit view (extra; Sev 7; see Art Bible B §2)
- **Now:** The halo and tub fill the lower 45% of the frame in near-black. Gloves are dark, mirrors
  are dark and low-res (256 px on Medium), and the wheel reads as plastic.
- **F1 25:** A lit carbon halo with visible weave, bright and legible mirrors, a vivid wheel LCD and
  LEDs, and detailed gloves (003, 008, 094, 096).
- **Approach:** Fixes 2.2 and 2.20 (environment, carbon) solve most of it. Mirrors: Medium 256 →
  384. Wheel LCD emissive 1.5 and LEDs 6 (with bloom). Keep the AO near-fade
  (`AMBIENT_OCCLUSION.nearStart` 0.9).

---

## 3. Ranked top 20 by impact ÷ effort

Impact is 1-10 (visible change across most frames). Effort is 1-10 (agent-days plus risk). Sorted by
ratio; ties go to the higher impact. Owner is the suggested studio department. Items 1-9 are wave-1
quick wins (effort 2-3). Items 16-20 are large builds.

| # | Change | Impact | Effort | Ratio | Owner | Key files |
|---|---|---|---|---|---|---|
| 1 | Lighting rebalance plus IBL ground bounce: env 0.28 → 0.8, hemisphere 0.26 → 0.05, sun 4.2 → 3.4, PMREM 256, sun at about 32° (2.2) | 9 | 2 | 4.5 | Lighting TD | `daylight.ts`, `renderer.ts` |
| 2 | Motion blur per tier (0 / 0.3 / 0.45), camera-locked car kept sharp, wheel radial blur (2.7) | 8 | 2 | 4.0 | Rendering / post | `options.ts`, `motion-blur.ts`, `tire-finish.ts` |
| 3 | Per-car ground AO decal plus SAO retune (2.4) | 7 | 2 | 3.5 | Rendering | `car.ts`, `scene-ambient-pass.ts` |
| 4 | Asphalt albedo, normal maps, visible racing line from simulated rubber (2.8) | 9 | 3 | 3.0 | Track surfaces | `surface-detail.ts`, `wetRoad.frag`, `circuit-finish.ts` |
| 5 | Grass and tree colour correction: desaturate toward olive, macro variation (2.10, 2.13 step 4) | 6 | 2 | 3.0 | Environment art | `surface-detail.ts`, `circuit-finish.ts`, `aurel-vegetation.ts` |
| 6 | Car paint, carbon and clearcoat values, reflection intensity, probe on Medium (2.20) | 8 | 3 | 2.7 | Vehicle art | `car.ts`, `paint-finish.ts`, `reflections.ts` |
| 7 | Kerb paint, ridges and wear, per-corner styles (2.9) | 5 | 2 | 2.5 | Track surfaces | `circuit.ts`, `circuit-finish.ts` |
| 8 | HDR emissives, bloom strength per mode, sun flare (2.6) | 5 | 2 | 2.5 | Rendering / post | `lens-bloom.ts`, `rear-signal.ts` |
| 9 | Helmet, visor and glove materials, head roll (2.23) | 5 | 2 | 2.5 | Character art | `helmet-shell.ts`, `driver-materials.ts` |
| 10 | **Trackside branding system**, fictional brands: barrier boards, banners, run-off logos (2.19) | 9 | 4 | 2.25 | Environment / props | new `trackside-branding.ts` |
| 11 | Tyre sidewall lettering, compound band, wheel covers, wear (2.22) | 6 | 3 | 2.0 | Vehicle art | `tire-finish.ts`, `tread.frag` |
| 12 | Barrier wraps, Armco and fence metal values, distance-faded mesh (2.17, 2.18) | 6 | 3 | 2.0 | Environment / props | `catch-fence.ts`, `concrete-barriers.ts`, `steel-guardrails.ts` |
| 13 | Gravel parallax occlusion mapping and dust plumes (2.11, 2.27) | 4 | 2 | 2.0 | Track surfaces / VFX | `surface-detail.ts`, `effects.ts` |
| 14 | Sky colour fix plus ray-marched cumulus slab, captured into the PMREM (2.1) | 7 | 4 | 1.75 | Lighting TD | `daylight.ts` |
| 15 | F1-style HUD: twin-ring cluster, 5-row tower, sector strip, OFL font, hidden debug tabs (2.28) | 6 | 4 | 1.5 | UI / UX | `interface.ts`, `race-day-hud.css` |
| 16 | Middle shadow cascade (±160 m), alpha-tested foliage casters, PCSS on High (2.3) | 7 | 5 | 1.4 | Rendering | `renderer.ts`, `far-shadow.ts` |
| 17 | Forest belts (8-15 k trees), conifer generator, octahedral impostors, wind, canopy terrain (2.13, 2.12) | 9 | 7 | 1.3 | Environment art | `aurel-vegetation*.ts`, `landscape.ts`, `terrain.ts` |
| 18 | Height and inscatter fog, aerial perspective, near grass tufts (2.12 step 3, 2.10 step 3) | 6 | 5 | 1.2 | Environment / Lighting | `daylight.ts`, `landscape.ts` |
| 19 | Grandstands at scale plus crowd density, colour, animation and flags (2.15, 2.16) | 7 | 6 | 1.17 | Environment / crowd | `grandstand.ts`, `crowd*.ts` |
| 20 | Rival cars rebuilt from hero geometry with livery masks and an LOD chain (2.21) | 8 | 8 | 1.0 | Vehicle art | `a61-rival.ts`, `lod.ts`, `car-livery.ts` |

Next tier, just below 20: pit crew fidelity (2.24), wet lens droplets and spray volume (2.25, 2.26),
cinematic menu hub (2.29), building glazing and interior mapping (2.14), TAA (2.7 step 5).

### 3.1 Sequencing notes for production
- **Do 1, 2 and 3 first, together, then re-capture.** They move the baseline every other department
  tunes against. Raising env intensity will expose any material with a wrong albedo or roughness:
  that is intended. Fix the material; never lower the env to hide it.
- #4, #5 and #7 all edit `circuit-finish.ts`: give them one Track Surfaces owner to avoid conflicts.
  #10 and #12 share barrier geometry: #10 owns the atlas and placement, #12 owns the materials.
  #1 and #14 both edit `daylight.ts` (`daylightState` / `SkyEnvironment` vs `configureSky`): #1 lands first.
- QA captures to add before wave 2: wet chase, cockpit and TV; pit stop (cockpit and TV); grid with
  crews; sunset and night chase; a 1 s motion-blur sequence at 250 km/h. Re-run `stats.py` and
  `patch.py` on the §0 patches. Acceptance: inside the §0 ranges and Art Bible A §0.1.
- Performance: Medium measured 1,103 draws and 4.45 M triangles. New trees, tufts, boards and crowd
  must be instanced or batched (about +150 draws at most on Medium), and every new pass is gated by
  quality tier.
