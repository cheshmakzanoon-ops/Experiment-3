# Art Bible A: lighting, atmosphere, grade, surfaces, cars, characters

Owner: Art Director (lighting, materials, cars). Phase: analysis only. No source changed.
Scope: what "F1 25 on PS5" looks like, written as numeric targets an implementer can hit in
Three.js r180 without re-reading the references. Every target cites the reference images that
show it best, and the code location that currently owns the value.

## 0. How to use this document

**Reference shorthand.** Root: `scratchpad/refs/f1ref/` (session scratchpad, NOT in the repo; never
copy reference pixels, liveries or logos into the repo, only these written descriptions).

| Tag | Folder | Files used |
|---|---|---|
| PS | official_playstation | 001 Albert-Park scan/game split, 002 red car pan at Monza-style straight, 003 cockpit + wheel (Austria), 004 pit stop golden light, 005 livery editor studio, 006 overhead drone pair (Imola kerbs), 007 low rear-chase in pack (Imola), 008 above-halo onboard (Monza), 009 halo/helmet close-up low sun, 010 rain chase (Spa) |
| BR | official_ea_braking | 020 driver portrait in paddock (AVIF), 021 night helmet close-up (AVIF) |
| TIP | official_ea_tips | 022 red car in corner, overcast-bright (AVIF); 023-030 phone-video crops (top half = game): 024 Melbourne chase, 025 Vegas night T-cam, 026 livery showroom, 027 Monaco T-cam, 028 Imola offset onboard + mirror, 029 Barcelona chase, 030 cockpit |
| CUS | official_ea_customisation | 031 livery side view (studio), 032 Suzuka wheel-to-wheel close, 033 Suzuka side profile + guardrail |
| TX | photo_mode_traxion | 075 pan blur red car, 076 Spa Eau-Rouge wide, 077 Monza low front 3/4 (forged carbon), 078 Austria golden-hour crowd pan, 079 Vegas night + LED sphere, 080 Vegas close pan |
| PSQ | ps5_review_pushsquare | 034 Austria T-cam, 035 team HQ interior, 036 Melbourne chase, 037 Melbourne T-cam, 038 cutscene faces |

Most `official_ea_*` files are AVIF despite their `.jpg/.png` names. The Read tool rejects them.
Converted 1280-wide PNGs are in `scratchpad/artA_conv/`, made with PIL, which decodes AVIF:
`python3 -I conv.py`.

**Baseline** = `scratchpad/shots/baseline/` (SwiftShader, Medium, 1280x720): 00-menu, 10/11 grid
chase/cockpit, 12/13 pod/trackside, 20/21 driving chase/cockpit.

**Measurement method.** All hex values below marked "meas." were measured from the images with a crop-mean
script (sRGB, display-referred), so they are *rendered* targets after tone mapping. Use them to check
a capture: put a crop of the same surface type next to them in the same lighting.

### 0.1 Headline measurements (reference vs current baseline)

| Surface (sunlit, gameplay cam) | Reference meas. | Baseline meas. | Verdict |
|---|---|---|---|
| Dry asphalt, off-line | #938b83 (TIP029), #91897a (PSQ036), #959192 (PS002), #7a7570 (PSQ037), #797674 (PSQ034) | #3e3f44 (10), #3c3c40 (20) | **2x too dark, blue-cast (B/R 1.08 vs 0.88-0.95), no texture: crop std-dev 2.4 vs 8-40** |
| Asphalt, overcast / soft light | #63636b (TIP022), #615f61 (CUS033), #6c6260 (CUS032) | n/a | baseline still darker than overcast refs |
| Rubbered racing line | #6c6764 vs off-line #a1988e (TIP029): ~45% linear luminance | absent (circuit-finish.ts:15 forbids it) | missing |
| Grass | #878c48, #8e8a4c, #727939, #6d792a, #778359 (olive/yellow-green) | #445e20, #445c22 | too dark, too saturated pure green |
| Trees in sun | #3f4b3e, #454e3b, #3a4c46 (desaturated, cool) | #304d1d | too saturated/yellow-green |
| Sky zenith (clear) | #70a6cb, #8ec0f3, #7ebcef (gameplay); #2197cb (photo-mode grade, TX076) | #83a9b8, #96c5d6 | too cyan-grey; G/B 0.92 vs target 0.80-0.85 |
| Sky at horizon | #92bbd4, #bfdbec, #abcbe5 | #c0dada, #c8dcdb | greenish (G = B); target B - G >= 15 |
| Far hills (2-4 km) | #6f7b7a (PSQ034, blue-grey haze over forest) | #898e6b (yellow-olive, untextured) | wrong hue, no forest cover |
| Car cast shadow on asphalt (clear sun) | #1d2635, #1b2738: lit/shadow linear ratio 15-17:1, shadow **blue** B/R 1.8-2.1 | #101216 ratio 8:1 (10); #261e1c ratio 3:1, warm (20) | shadows not sky-blue; contact under car too weak while driving |
| Overcast sky | #d2d2d0 (TIP022), #e3e7ec (PS007), #e8eaea (PS010 rain) | n/a | |
| Night sky / floodlit road | sky #090d10; road #706f67 under masts, #40443d between (TIP025, TX079) | n/a | |

Frame statistics (sRGB luma percentiles, gameplay refs PSQ034/036/037, TIP029): p5 0.09-0.12,
**p50 0.44-0.53**, p95 0.82-0.86, p99 0.88-0.91, mean saturation 0.22-0.31. Baseline chase: p50 0.25 (10),
0.37 (20), p95 0.82-0.84, saturation 0.28-0.36. Highlights and saturation are already in range. **The
midtones are about 1 stop low, almost entirely because the large asphalt area is dark.** Do not fix this
with exposure: fix the albedo (section 4).

---

## 1. Lighting and sun

Code owners: `src/rendering/daylight.ts:7-97` (sun offsets, `daylightState`, `circuitLightState`),
`src/rendering/lighting-coherence.ts:6-22` (palette), `src/rendering/renderer.ts:185-186` (sun 0xffead0 3.3 /
hemisphere 0xc3d8f3, 0x33372e, 0.3), `:311-314` (ACES, PCFSoft), `:325` env 0.7 (overridden by daylight),
`:334-344` (2048 map, ±38 m ortho, bias -1.5e-5, normalBias 0.008), `:923-943` (per-frame apply),
`src/rendering/far-shadow.ts`, `src/rendering/scene-ambient-pass.ts:22-26` (AO r 0.9 m, i 1.15).

### 1.1 Clear day (default; PSQ036, TIP029, TIP024, PS002, PS007, CUS033)
- **Sun elevation 50-58°.** The references show short shadows tucked under or beside the car. Current
  `SUN_OFFSET (-160,190,-130)` = 42.7°. Suggested `(-140, 235, -115)` (about 52°); azimuth unchanged so
  far-shadow and probe bakes keep their orientation logic.
- **Sun colour** 5600-5800 K: `#fff0dc` (current 0xffead0 is acceptable; slightly warmer than ideal).
  Measured sunlit asphalt is warm-neutral (B/R 0.88-0.95), so keep the key slightly warm.
- **Key/fill ratio** on horizontal asphalt, open cast shadow: **10-15 : 1** (linear). Under the car
  floor (umbra plus AO): **20-30 : 1** (CUS033 under-floor #0d0b0c next to #615f61).
- **Shadow colour** must come from the sky: clear-day shadow on grey asphalt renders **#1b2738-#1d2635**
  (B/R about 2.0). Current hemisphere sky colour 0xc3d8f3 is too pale and the IBL too weak, so shadows go
  neutral black (#101216) or warm (#261e1c). Target hemisphere sky `#8fb6ea`, ground `#4a4237` (warm bounce
  from asphalt/grass), and IBL `environment` 0.28 → **0.38-0.45**, so the sky term dominates shadowed areas.
  Acceptance: a capture crop of car shadow on asphalt has B/R >= 1.5 and lit/shadow 10-17 : 1.
- **Shadow softness.** Contact-hardening look: crisp within 0.3 m of the occluder (wing endplate, tyre
  contact), 3-6 cm penumbra for halo/rear-wing shadows on the road (about 1 m drop). The current single ±38 m
  cascade at 2048 gives 3.7 cm texels, so car self-shadow detail (halo on cockpit, wing on engine cover) is
  mushy. Target: a **near cascade ±10-12 m at 2048 (≤1.2 cm texel)** following the camera's car, plus the
  existing ±38 m and far-shadow cascades. PCF radius about 1.5-2 texels in the near cascade.
- **Contact grounding.** Every car needs a dark under-floor contact term (planar blob or SDF box under the
  plank: 25-35% darkening over a 0.2 m falloff outside the floor outline). It must stay visible in overcast,
  where the refs still show a dark under-car band (TIP022, TIP027, TIP028). AO radius 0.9 m is fine for the
  track; AO alone does not seat the car.
- **Specular key:** the sun must produce a bright, small, **clipped** highlight streak along curved
  bodywork (PS002 sidepod, PS009 halo). Gloss paint clearcoat roughness ≤0.05 (section 6) is what produces it.

### 1.2 Golden hour / sunset (PS004, PS009, TX078, TX077)
- Elevation **8-15°** (current `SUNSET_OFFSET` 6.1°: raise to about 10°, e.g. `(-215, 45, -150)`).
- Key `#ffb26b`-`#ffc58e`, key/fill **5-7 : 1**. Shadows violet-blue `#2e3550`-`#3a4660`.
- Long raking light rims bodywork edges warm orange. Deep crushed shadows on the shadow side
  (PS004 p50 0.07, p95 0.77). Accept a darker frame: p50 0.15-0.25.
- Sky gradient horizon `#f2b27a` → zenith `#4a6fa8` (section 2). Grade highlightTint warm (section 3).

### 1.3 Overcast (TIP022, TIP027, TIP028, PS007 sky)
- Sky `#d2d2d0`-`#e3e7ec`. Sun 0.25-0.6 of clear value, direction still faintly readable (soft
  shadow 0.5-1 m penumbra, ratio about 2.5-3 : 1). Fill and IBL up 30%.
- Asphalt renders `#63636b`-`#6c6260`. Paint shows broad, soft sky reflections, not sharp sun glints.
- Current `daylightState(cover=1)`: sun 0.25, fill 0.60, env 0.21. **Env should rise, not fall, with
  cover** (overcast is all sky light): target env 0.45-0.5 at cover 1.

### 1.4 Night / floodlit (TIP025, TX079, TX080, BR021)
- Sky `#06090d`-`#090d10` near black, slight teal. Horizon glow `#1a2230` from city light.
- Mast light 4500-5000 K, `#e6edf8` (current 0xe2e9f6 OK). Masts every **25-35 m both sides**, about 18-20 m
  tall. Road illuminance uniformity min/max ≥ 0.6: road renders `#5e5d58`-`#706f67` under masts and no
  darker than `#40443d` between them.
- Multiple faint shadows per car (2-4 masts), each about 20% strength. The car always sits in a bright pool.
- Lamp heads must bloom: a halo about 1.5-3% of frame height, a hot clipped core (TX079 top-left).
- Emissive environment (screens, LED sphere, neon) supplies colour: magenta/orange bokeh in TX080.
- Current `circuitLightState('night')` sun 0.3, fill 0.085, env 0.07. OK as a base. Add local pools
  (`venue-lighting.ts:138` uses 4 point lights; target ≥ 8 nearest mast lights or a light-pool decal
  pass on the road).

---

## 2. Sky and atmosphere

Code owners: `daylight.ts:30-52` (turbidity 2.3, skyRadiance 0.32, fogDensity 0.000205, fog RGB
0.5/0.61/0.77 linear), `daylight.ts:131` (rayleigh 2.9, mie 0.0032, g 0.82), cloud shader
`daylight.ts:259-270`, `renderer.ts:326` (initial FogExp2 0xb9c7c1 0.00044, overridden per frame),
`local-atmosphere.ts`.

### 2.1 Clear sky gradient (TIP029, PSQ034/036/037, TX076)
| Point | Gameplay target | Photo-mode/hero grade (TX076) |
|---|---|---|
| Zenith (60-90° up) | `#5f9ad6`-`#70a6cb` | `#2a7fc4`-`#2197cb` |
| 20° elevation | `#8ec0f3` | `#5aa8de` |
| Horizon (0-3°) | `#b8d4ea`-`#c8dcef` | `#abcbe5` |
| Horizon/zenith luminance | 1.5-1.9x | 2.5x |

- Current zenith `#83a9b8` and horizon `#c0dada` are cyan-grey. Lower turbidity (2.3 → **1.8-2.0**),
  raise rayleigh (2.9 → **3.3-3.6**), and/or apply a hue push so G/B at zenith is 0.78-0.85 and horizon
  B - G is 12-20 (8-bit).
- Sun disc: small (0.5°), clipped, with a soft Mie glow radius of about 8-12° (g 0.82 OK).

### 2.2 Clouds (TIP024 cumulus over palms, PS003 bright cumulus, PSQ034 thin cirrus, PS010 full overcast)
- Default dry race: **15-30% fair-weather cumulus** in the lower 25° of sky. Bases flat, tops billowed.
  Sun-side tops `#f6f7f8` (clip slightly), shaded undersides `#9aa6b4`-`#aab4c0`, edges with silver lining.
  Angular size of individual cells 3-10° near the horizon.
- The current cloud field is 4-octave value noise in a flat projection (`cloudUV=direction.xz/(y+0.24)`),
  which reads as smeared fog patches (baseline 10). Target: cellular/worley-based cumulus with a
  height-gradient (flat base) and a 2-sample sun-direction self-shadow, or 6-8 hand-authored cloud billboard
  sprites per sky.
- Overcast: uniform `#cfd3d6`-`#e8eaea` with low-contrast darker rolls (±6%), no blue visible.

### 2.3 Aerial perspective / haze
- Contrast loss vs distance (clear day): **500 m 10-15%, 1 km 25-30%, 3 km 55-65%**, toward `#a9c2d8`.
  For FogExp2 (`1-exp(-(d·x)²)`), 28% at 1 km needs d ≈ **0.00055**. The current clear-day d = 0.000205
  gives about 4% at 1 km and 31% at 3 km, so mid-distance treelines and stands stay crisp and saturated (baseline
  20, 13), while the PSQ034 forested ridge at about 2 km is visibly blue-grey `#6f7b7a`.
- Add a **height falloff** (density × exp(-(y - y0)/120 m)) so valley floors and hill bases haze more than
  ridgelines. Without it, raising density greys the sky too.
- Fog colour = sky colour at the horizon in the view direction (sun-side warmer `#c9d3dc`, anti-sun bluer
  `#9db8d3`). Current fixed linear (0.5, 0.61, 0.77) → sRGB #bccce4 is close but has no sun-direction term.
- Overcast: d ≈ 0.0008, colour `#c4cacd`. Rain: d ≈ 0.0015-0.002, colour `#aeb5b8` (PS010 trees at 300 m →
  `#39451d`, low contrast). Sunset: d ≈ 0.0006, colour `#d9a27c` sun-side, `#7d84a0` anti-sun.
  Night: d ≈ 0.0004, colour `#0e141c`, plus lamp-lit haze halos.

---

## 3. Tonemapping and colour grade

Code owners: `renderer.ts:311-312` (ACESFilmic, exposure 1.05, then `daylight.exposure` 0.9-1.0 at
`:940`), `adaptive-exposure.ts` / `exposure-meter.ts`, `broadcast-grade.ts:24-34` (day: contrast 0.16,
sat 1.06, vibrance 0.16, vignette 0.12, fringe/grain/sharpen 0), `lens-bloom.ts:19-35` (threshold 3.6
linear, knee 1.8, strength 0.55), `motion-blur.ts:131` (max 24 px, 6 taps), `options.ts:41`
(**motionBlur: 0 in every preset**), `photo-camera.ts`, `renderer.ts:800-805` (BokehPass photo focus).

| Parameter | Gameplay target | Photo/replay/menu target | Reference |
|---|---|---|---|
| Tone curve | ACES filmic is fine. Keep it, but exposure is set so sunlit mid-grey asphalt displays sRGB 125-150 | same | PSQ036, TIP029 |
| Exposure anchor | sunlit asphalt `#7d7a76`-`#938b83`; painted white line `#e5e3dc` (not clipped); clear horizon sky 200-230 | | |
| Contrast | S-curve 0.16-0.22 (current 0.16 OK) | 0.22-0.3 | TX076, TX078 |
| Black level | p1 0.00-0.01 in frames containing tyres/undertray; p5 0.02-0.11. Never lifted or milky | crushed allowed (PS004) | |
| Highlight rolloff | p99 ≤ 0.93 in gameplay; only sun disc, glints, lamps clip | | |
| Saturation | mean 0.22-0.32; liveries vivid, environment slightly muted (grass/trees desaturated) | 0.30-0.45 | TX075 is 0.54 (stylised thumbnail, ignore) |
| Split tone | shadows cool (+3% B), highlights warm (+2.5% R): current values are right | | PS002, TIP029 |
| Bloom | Day: only sun disc, specular glints, rain light, LEDs. Threshold 3.6 OK, strength 0.55 → **0.45 day, 0.8 night/wet** | 0.6-1.0 | PS010 rain light, TX079 masts |
| Vignette | 0.08-0.12 | 0.15-0.25 | TX076 |
| Chromatic aberration | 0 | 0.002-0.004 radial at corners | TX080 edges |
| Lens flare | off unless sun within 25° of view centre; then 3-5 faint hexagonal ghosts, ≤ 4% opacity | optional | (not prominent in refs) |
| Film grain | 0 | 0.015-0.025 luminance-weighted | |
| **Motion blur** | **ON by default at Medium/High: shutter 0.35-0.5 of frame, max 3.5% of width (about 56 px @1600), ≥ 10-12 taps**, camera-relative so the player car stays sharp and track/barriers streak | shutter 1/60 s pan look (TX075, TX078, TX080, PS002: background fully streaked, car sharp) | PS008 road streaks, PSQ036/037 near road streaked |
| Wheel/rim blur | rotational blur on wheel covers/rims above about 60 km/h; sidewall lettering unreadable above 120 km/h (PS002, TX080, TIP022) | | |
| Depth of field | none while driving; garage/pit/menus/cutscene: f/2-f/2.8 look, round bokeh (PS004 foreground crew, BR020 background, BR021 fireworks) | user-set | |

Note: `broadcast-grade.ts:20-23` deliberately bans grain and fringe in gameplay. Keep that. The F1 25
look comes from motion blur and materials, not lens tricks. **Motion blur defaulting to 0 is the single
biggest "looks like a PC tech demo, not a PS5 racer" tell in the baseline driving shots.**

---

## 4. Asphalt

Code owners: `surface-detail.ts:9-14` (palette asphalt `[79,81,83]`), `:59-66` (aggregate variation
±16, roughness 188-220/255), `:82` (0.64 m tile), `:107` (bump 0.00045), `circuit-finish.ts:42-44`
(binder darkening ×0.8-1.0 and ×0.86 on repairs), `circuit-finish.ts:15` (comment forbids session rubber),
`asphalt-aggregate.ts`, `road-macro.ts`, `tyre-marks.ts`, `materials.ts:42-176` (wet road).

| Item | Target | Reference |
|---|---|---|
| Base albedo | sRGB **#686460** (linear about 0.13). After the finish multiply, the effective mean must be ≥ #605c58. The current effective mean is about #4a4c4e (palette 79/81/83 × 0.8-1.0 in linear): **raise the palette to [106,101,96] and change the binder multiply to `.92+broad*.08`** | TIP029, PSQ036, PS002 |
| Hue | warm-neutral, B/R 0.90-0.95. Remove the blue bias (current B > R) | all dry refs |
| Aggregate (meso) | light-grey stone chips 2-6 mm, `#9a958e` on a binder of `#4a4744`; ±15-20% value; visible within 6 m of camera; std-dev of a 40x40 px crop at 1080p in near road = **8-14** (ref CUS033 4.7 far, CUS032 7.9 mid, PSQ034 26 near) | CUS032, PSQ034, TIP028 |
| Second detail layer | 0.12 m repeat, fades in < 4 m. Fixes the one-scale "noise carpet" | |
| Macro variation | 8-25 m blotches ±5-7% value, ±0.03 roughness; longitudinal paving joints every 4-6 m lane (exists) | TIP027, TIP028 |
| **Racing line** | 1.4-1.8 m rubber band on the ideal line, **45-60% of off-line linear luminance** (TIP029: #6c6764 vs #a1988e), roughness 0.62 vs 0.80 off-line → faint sheen toward the sun. Darkest in braking zones and corner apexes, fading on straights (60 → 80%) | TIP029, PSQ034, PSQ036 |
| Braking zones | paired dark parallel streaks 0.3 m wide, 20-60 m long, ending at the apex; lock-up flat-spot streaks (short, very dark, 0.3 m) | PSQ034 (T3), PS006 |
| Marbles | outside the line, dark rubber pellets 5-15 mm, density increasing during a race | TIP029 outside line |
| Patching | sealed rectangles 1-4 m, -10 to -15% value, roughness -0.05; meandering crack-sealant lines `#2a2927`, 1-2 cm wide, 1 per 20-40 m² | TIP027 Monaco, PS001 right half |
| Painted lines | `#e9e7e0` (never pure white), roughness 0.55, 1-2 mm raised, edges slightly worn/broken; grid boxes same paint | PSQ036, PS001 |
| Dry sheen | roughness 0.75-0.85 overall; grazing-angle sheen toward the sun clearly visible on straights (PS008: road ahead brightens to #c0bcb5 toward the sun) | PS008, TIP030 |
| Wet look | see section 10: albedo × 0.6 (PS010 wet #5a5e5a vs dry #8f8a85), roughness 0.08-0.2, puddles in low/off-line areas, racing line dries first | PS010 |

---

## 5. Kerbs, run-off, grass, gravel, astroturf

Code owners: `circuit.ts:151-154` (grass/run-off/gravel materials; run-off = asphalt × `0x8aa58d`,
4 m), `:163-173` (gravel on corner exits, width + 4 → width + 10 m), `:192-195` (white line 0xf1eee0 r0.75,
kerb vertex colours r0.85), `:489` (**kerb colours 0xdc553b / 0xe8e3cf, 3 m per stripe**),
`circuit-finish.ts:49-58` (grass pushed greener ×(.79,1.066,.8)), `:104-110` (kerb chips),
`surface-detail.ts:11-12` (grass [89,101,53], gravel [150,138,114]).

| Item | Target | Reference |
|---|---|---|
| Kerb red | albedo `#c4222a`, renders `#d03226` in sun | PS007, TIP029 (#bf5c64 in haze) |
| Kerb white | `#ecebe6` (renders #f0eee8) | PS006, TIP029 |
| Kerb alt. palettes per corner | yellow `#e8c43a` + green `#2f8f52` (PSQ036 Melbourne), blue `#2a4fa0` + white (PSQ034), red/white/green (PS006). Suggest Aurel uses red/white plus one signature blue/white complex | |
| Stripe length | **1.0-1.2 m per colour** (current 3 m: reads as a road-works barrier). Sawtooth/ribbed ("sausage") outer kerbs at hairpins | PS006, TIP029, PS007 |
| Kerb finish | paint roughness 0.45-0.55, with tyre-rubber smudges on the track-side 30% of width (`#2a2a2a` at 30-50% coverage), paint chipped on edges | PS007 close kerb |
| Run-off (asphalt) | wide painted asphalt run-off: base `#6f6c68`, with 1.5-2 m coloured bands (red `#b33a32`, blue `#2e57a8`, green `#3b8a50`, yellow `#d9b23a`) parallel to the kerb | TX076 Spa stripes, PSQ034 |
| Astroturf strip | 1.5-3 m behind kerb, base `#3f9a55` → renders `#98b27b`, fine fibre noise, roughness 0.75, white painted chevrons/stripes optional | PS007, PSQ036 |
| Grass | albedo sRGB **#6c7438** (olive), renders `#878c48`-`#8e8a4c` in sun. Remove the ×(.79,1.066,.8) green push (`circuit-finish.ts:52`) and invert it toward yellow `×(1.04,1.0,.86)` | TIP029, CUS033, TIP022 |
| Grass detail | mowing stripes 3-5 m wide, ±6% value; within 8 m of camera use blade cards or shell grass, 5-10 cm blades, tips lighter/yellower (CUS033 foreground blades) | CUS033, TIP028 |
| Gravel trap | albedo `#b9a98a`, pebbles 1-3 cm, roughness 0.95, bump 0.009 OK; raked furrows 0.3 m spacing along the track direction; never directly against the kerb (2-4 m asphalt or astroturf first). The baseline's tan band from kerb to wall (20-driving-a, #635949) reads as a dirt road: **narrow it and put asphalt run-off between** | TX076, PSQ034 |
| Grass/track edge | 10-20 cm dirt/dust transition, slightly darker | TIP028 |

---

## 6. Car materials

Code owners: `src/rendering/car.ts:131-137` (paint: metalness 0.06, rough 0.34, cc 1, **ccRough 0.16**),
`:141` dark 0x101416 r0.75, `:143` metal 0x7c8589 m0.88 r0.3, `:146-151` ivory accent, `:246-250` rain
light (0x710000, emissive 0xff1b0a ×0.4), `:300-303` compound ring r0.82, `:347-353` disc 0x4b4a45 r0.6
emissive 0xff4d08; `materials.ts:16-17` carbon (0x15191c, m0.08, r0.42, standard, no clearcoat) +
`shaders/carbon.frag` (twill at 3.1 mm cells, ±10% diffuse); `tire-finish.ts:39` tread 0x191c1d r0.9;
`paint-finish.ts`; `supplied-player-materials.ts` / `supplied-player.ts` (player car is the user-supplied
GLB, materials patched at load); `simulation/config.ts:79-83` compound colours, `:244-246` LIVERIES.

### 6.1 Paint (PS002, PS009, TIP022, CUS031, TX077, TX080)
| Finish | color | metalness | roughness | clearcoat | ccRoughness | Use |
|---|---|---|---|---|---|---|
| Gloss solid | livery | 0.0 | 0.32 | 1.0 | **0.035-0.05** | red/white/yellow liveries (PS002, TIP022) |
| Gloss metallic | livery | 0.45-0.6 | 0.38 | 1.0 | 0.04 | blue/teal/purple (PS007, TX080, PS004) |
| Satin | livery | 0.0-0.2 | 0.48 | 0.35 | 0.32 | 2025 "satin" liveries (CUS033) |
| Matte | livery | 0.0 | 0.6-0.65 | 0 | n/a | matte black/navy cars, camo (PS008, PS005) |

- **ccRoughness 0.16 → 0.04.** At 0.16 the paint never shows the crisp horizon line/sky reflection and the
  long sun streak along sidepods that defines every hero shot (PS002, PS009, TIP022).
- **Metallic flake:** a 0.2-0.5 mm flake normal-noise in the base layer only (under the clearcoat). Sparkle
  is visible within 3 m and filtered to zero by 10 m. Flake tint ±10% hue. Limit to metallic liveries.
- **Orange peel:** a very low-amplitude clearcoat normal noise (5-10 mm wavelength, 0.002 slope). It breaks
  perfect mirror reflections on close-ups (PS009).
- **Livery palette:** the current `LIVERIES` are pastel (0x54c8c0, 0xe079ac, 0xb58ce4 …), which reads as toy
  plastic (baseline 10, mint car). Target saturated, darker bases, each two-tone + exposed carbon:
  red `#a8101a`, navy `#0b1d4f`, racing teal `#00544c`, papaya `#ff7a00`, purple `#3a1f6e` + yellow
  `#f2d000`, pink `#ff4fa3` + blue `#1b3fa0`, satin black `#0d0e10` + gold `#c9a227`, white `#e9ebed` + blue
  `#1f4fc8`, bright blue `#1550c8`, lime `#57d13a` + black. Use fictional sponsor marks only.

### 6.2 Carbon fibre (PS005, PS006, CUS031, TX077, TX078, BR021)
- Visible bodywork carbon (halo fairing, wing endplates, floor edge, sidepod undercut, mirror stalks):
  **lacquered**: MeshPhysicalMaterial color `#0e1012`, roughness 0.35, clearcoat 0.9, ccRoughness 0.06,
  **anisotropy 0.5**, with anisotropyRotation alternating ±45° per twill cell. Weave diffuse modulation
  **±18%** (current 10%). Weave cell 3-5 mm (current 3.1 mm OK).
- Underbody/floor underside/suspension: raw satin carbon, roughness 0.55, no clearcoat, weave ±8%.
- Forged carbon (TX077 endplates and floor): marbled chopped-fibre pattern, flakes 1-3 cm, ±25% value, same
  lacquer. Optional per-team.
- Fasteners: white or black dots 4-6 mm on engine cover/sidepod seams; panel-gap lines 1 mm dark (CUS031).

### 6.3 Decals and livery detail (CUS031, CUS032, PS004, PS008)
- Decals sit under the clearcoat (same reflection, no separate gloss), albedo-only, 2048-4096 px
  livery atlas for the player car. Edge AA via mip bias -0.5.
- Mandatory placements: race number on nose tip and engine-cover fin (15-20 cm), driver name/flag on halo
  or cockpit side, sponsor on halo top (PS008 has a sponsor wordmark across the halo), sidepod main sponsor
  50-70 cm wide, rear wing endplate/main plane wordmark, front wing endplate, small 5-10 cm marks on the
  floor and the T-camera.
- The T-camera pod on the airbox is black (lead car) or fluorescent yellow (second car).

### 6.4 Tyres (PS002, PS007, PS010, CUS032, TX078, TX080, TIP022)
- Tread (slick): albedo `#2a2a2a` (linear 0.023), roughness 0.75 new, 0.82 scrubbed, with graining bands
  and pick-up blobs on the shoulders after 2+ laps. Renders `#2e2d2e` in sun (TIP022). The current 0x191c1d
  is too black: under the sun it renders as a void.
- Sidewall: albedo `#1f2022`, satin roughness 0.55-0.6 (visibly glossier than the tread; PS005 shows a soft
  sheen). Moulded lettering: supplier wordmark ×2 and compound name ×2 around the circumference, letter
  height 32-38 mm, raised 0.5 mm, painted in the compound colour (or white on hard).
- Compound band (one thin ring, 12-16 mm wide, at about 75% of sidewall radius):
  soft `#e2262f`, medium `#f5c400`, hard `#f2f2ee`, inter `#2bb04a`, wet `#0a6fd0`.
  `config.ts:79-83` inter 0x49bb82 is too minty and wet 0x529bea too pale. Use these values for
  presentation (the colours are also used by the HUD; keep a separate render colour if needed).
- **Wheel covers** (18-inch era): flat disc covering most of the rim face, team-coloured or carbon
  (TIP022 red, CUS032 carbon weave + yellow nut, TX078 rainbow, TX080 yellow-green). Rim visible only as a
  20 mm lip: magnesium `#3a3b3e`, metalness 0.7, roughness 0.35. Centre-lock nut anodised (team colour).
- Rotational blur on the cover at speed (section 3).

### 6.5 Brakes, lights, halo, mirrors
- **Brake discs:** carbon-ceramic `#2c2b29`, roughness 0.75. Glow only at ≥ 600 °C under heavy braking,
  emissive `#ff5a10`, up to linear 6-10 at peak, fading over 1.5-3 s. Mostly hidden by covers; the glow shows
  through cover vents and duct gaps. Current emissive 0xff4d08 is fine.
- **Rain light:** LED dot-matrix square about 95×65 mm (PS007: grid of about 5×6 dots), plus endplate LED
  strips on 2025 cars. Lit: core emissive `#ff2010` at linear **15-30** (clipped), bloom halo 3-4× the lamp
  size; in rain it lights the spray plume red (PS010). Steady in wet; 4 Hz flashing for harvest/slow
  warnings. Current emissiveIntensity 0.4 on 0xff1b0a cannot reach the bloom threshold (3.6).
- **Halo:** 2-3 visible parts: titanium tube about 45 mm under a paint/carbon fairing, top surface gloss
  livery with sponsor text (PS008), underside visible from the cockpit with painted motto text (PS003). The
  central pillar is 70 mm at the base, narrowing to 40 mm. Gloss highlight runs along its top in every
  exterior shot (PS009).
- **Mirrors:** housing about 150×50 mm glass with a 3 mm black bezel, aerodynamic pod shell in livery,
  mounted on stalks from the sidepod inlet/halo. Glass = sharp live rear view (PS008, TIP028, CUS032 all
  show a crisp image), tint `#d4dde0` (current OK). Update ≥ 30 Hz in cockpit/T-cam.

---

## 7. Car silhouette and detail cues (2022-25 ground-effect cars)

Use these cues to judge AI-car meshes (`hero-shells.ts`, `a61-rival*.glb`, `car-architecture.ts`) and the
supplied player car. The references are all 2025 cars.

- Proportions: length about 5.6 m, width 2.0 m, height 0.95 m, wheelbase about 3.6 m (sim keeps 3.44 m;
  OK visually), tyre outer diameter 720 mm, front width 305 mm, rear 405 mm. The car must look **long and
  low**: front wing about 75 mm off the ground, floor plank 10-20 mm.
- **Front wing:** 4 elements sweeping up toward the endplates; the endplate is a curved, rounded fence; the
  nose sits on the 1st/2nd element. Elements are carbon underneath, livery on top, with a white/coloured edge
  stripe (PS002, PS007, TX077).
- **Front-wheel wake winglets/arch:** a small carbon brow over each front tyre (CUS032, TIP027, TIP028,
  PSQ037). It is very visible from T-cam/cockpit and is missing on simple models.
- **Sidepods:** high narrow letterbox inlet; deep undercut below; downwash ramp or "waterslide" top,
  tapering to a coke-bottle waist at the rear tyres (PS006 overhead, CUS031).
- **Floor:** visible floor edge with a scrolled edge-wing lip and 3-5 cut-outs, carbon; the floor-edge
  silhouette and its shadow line read from every chase cam (TIP022, PS002).
- **Rear wing:** spoon/upwash main plane, single or swan-neck pillar, rounded endplates merging into the tips
  (no square corners), DRS actuator pod on top, beam wing below; the rain light and a single exhaust exit
  are centred under the crash structure.
- **Engine cover:** airbox triangle above the driver's head with the roll-hoop blade, T-camera pod, short
  shark fin; the engine-cover number.
- **Suspension:** push-rod front / pull-rod rear wishbones, carbon aero-section, visible through the gap
  between floor and tyres (PS006).
- **Cockpit:** raised cockpit sides, headrest pads in carbon/fabric, steering wheel with a central colour
  screen, 20+ coloured rotaries/buttons (PS003, TIP030), driver-side mirrors.

---

## 8. Characters

Code owners: `driver-materials.ts:55-81` (suit 0x283f46 r0.98, glove 0x74928a r0.86, grip 0x1c2326),
`car-mechanical-detail.ts:129-135` (visor 0x253b45, metal 0.35, r0.13, cc 1, ccR 0.07), `helmet-shell.ts`,
`driver-anatomy.ts`, `pit-crew.ts`, `crew-suit.ts`, `crew-performance.glb.gz`, `crowd.ts:226` (skin
palette).

### 8.1 Driver
- **Helmet** (BR021, PS009, PS008): gloss shell, roughness 0.25, clearcoat 1, ccRoughness **0.03**.
  High-contrast design (stripes, signature, number, carbon panels with visible weave). A white/coloured
  sponsor strip across the top of the visor. A small rear spoiler/Gurney on the top. HANS posts and straps
  visible at the neck.
- **Visor:** dark iridium tint. MeshPhysicalMaterial color `#151a22`, metalness 0.2, roughness 0.05,
  **iridescence 0.8, iridescenceIOR 1.7, thickness 300-550 nm** (gives the purple/green sheen of BR021),
  transmission off. The current flat teal 0x253b45 reads as plastic.
- **Suit:** team colour, not dark teal. Woven Nomex with roughness 0.8, **sheen 0.35, sheenRoughness 0.6,
  sheenColor = 0.6 × suit colour**; quilted/stitched panels on shoulders and arms; embroidered logos with
  slight normal relief; epaulettes. Example (BR020): yellow `#f2d000` sleeves, purple `#3d1f70` torso,
  black `#141414` collar. Collar high and black, with the inner balaclava visible.
- **Gloves** (PS003, PS008): team colour (yellow with purple accents in PS003), suede palms slightly darker,
  roughness 0.85, sheen 0.3; knuckle panels; visible in cockpit view, so they are a priority.
- **Faces** (menus/cutscenes/podium; BR020, PSQ038, TIP023): skin with SSS approximation (wrapped diffuse
  0.3 and a red-shifted terminator `#d0604a`), roughness 0.45 on the T-zone and 0.6 elsewhere, pores/freckles
  detail normal 0.5 mm, peach-fuzz rim (sheen 0.15), eye wetness with a specular catch-light, hair cards
  with anisotropic highlight.

### 8.2 Pit crew (PS004)
- Team fire-suits in livery colours (purple/yellow in PS004) with **large sponsor/team wordmarks** running
  down the legs and arms; roughness 0.8, sheen 0.3; fold normals at knees, elbows and waist.
- **Crew helmets** in team colour with a team logo on the side, a dark smoked full visor (gloss), roughness
  0.25 shell; gloves; knee pads.
- Poses: 3 per corner (gun, off, on), low crouches, leaning in, front and rear jack operators, one stabiliser
  per side, a release controller. Motion blur on moving crew (PS004 right edge).
- Rim light: pit-lane overhead strips plus a sun shaft. Crew read as silhouettes with saturated team colour.

### 8.3 Crowd (PS007, PS002, TX078, PSQ036)
- Full grandstands (≥ 90% occupancy), **per-person colour noise**: crop std-dev 27-54 in sRGB with a mean
  around `#919393`-`#978989` (lots of white, red and black shirts, a sprinkling of team colours). Baseline
  stands read as uniform maroon blocks.
- Flags: 1 per 15-25 seats, waving national/team flags (PS007 has many). Banners on the railing.
- Animation: 10-20% of people arms-up / waving at any time; bob 0.5-1 Hz.

---

## 9. Trackside

Code owners: `catch-fence.ts`, `concrete-barriers.ts`, `steel-guardrails.ts`, `impact-barriers.ts`,
`track-boards.ts`, `grandstand.ts:61-66,198-199` (concrete 0x878880, roof 0xc6c9c7, seat/people palettes),
`secondary-grandstands.ts`, `start-gantry.ts`, `landscape.ts:764` (bark 0x655e49), `aurel-vegetation.ts`,
`terrain.ts`, `venue-*.ts`, `pit-building-frontage.ts`.

| Element | Target | Reference |
|---|---|---|
| Ad-board barrier | continuous 1.0-1.2 m printed boards on every barrier run, dark base `#16181c` or brand colour (deep blue `#1e2a78`, red `#c8102e`, yellow `#f5c400`) with big white wordmarks; matte vinyl r0.7 | PSQ036/037, TIP025, TIP027 (fictional brands only) |
| Concrete walls | `#c8c8c4` (street circuits), panels 3-4 m with joints, scuff/tyre marks at base | TIP025, TIP027 |
| Armco | triple-beam galvanised, `#9a9fa8`, metalness 0.8, roughness 0.35, renders `#969bb3` in overcast; posts every 2 m | CUS033 |
| Catch fence | posts 4-4.5 m, top 0.8 m angled 30-45° toward the track, 50 mm diamond chain-link + 3-4 tension cables. **Mesh alpha must fade to 25-35% transmission-grey with distance (no moiré, no full disappear)** | TIP024, CUS032, CUS033, PSQ037 |
| Distance boards | white `#f2f2f2` boards with black numerals 300/200/100/50, 1.2 m tall, on the outside before braking zones | TIP028, PSQ034 |
| Gantries | start gantry: 5 red light pods + abort; sponsor overhead gantries with clean typography (TIP024) | TIP024, PSQ036 |
| Grandstands | steel structure, big cantilever roofs `#d8dadc` top / `#5a6064` underside with a roof shadow line on the crowd, front fence + ad band | TX076, PSQ036, PS007 |
| Buildings | pit building with glass reflecting the sky (r0.05, F0 0.04), media centre; city skyline on street circuits | PS001, TIP027 |
| Trees | **dense continuous forest masses**, 15-25 m tall, canopy colour in sun `#3f4b3e`-`#454e3b` (meas.), shaded inner `#1c241e`, backlit edge leaves `#7d8f4a`. Deciduous (PS007 Imola) or pine (TX076, PSQ034 Spa/Austria). The baseline has sparse single 6-10 m trees dotted on lawn (20-driving-a, 13): **the biggest environment gap** | PS007, TX076, PSQ034, TIP029 |
| Hills | forested ridges with tree-cover texture and visible individual crowns up to 800 m; rock/quarry outcrops; aerial haze per section 2 | PSQ034, PS010 |
| Trackside clutter | marshal posts with orange-clad marshals, TV camera towers, light poles, tyre stacks, recovery cranes, cable trays, service roads | PS007, TIP029 |

---

## 10. Wet weather

Code owners: `materials.ts:42-176` (`installWetRoad`), `wet-reflection.ts`, `weather-presentation.ts`,
`spray-clouds.ts`, `rain-streaks.ts`, `precipitation-light.ts`, `tire-finish.ts:63-64` (wet roughness),
`local-atmosphere.ts`, `effects.ts`.

| Effect | Target | Reference |
|---|---|---|
| Sky/light | flat overcast `#e8eaea`, no cast shadows, contact darkening only | PS010 |
| Road film | albedo × 0.6 (wet `#5a5e5a` vs dry), roughness 0.08 (puddles) - 0.22 (damp); reflections of cars/sky **stretched vertically 3-5×** (anisotropic streaks), blurred with distance; the dry line appears first as a lighter, rougher 1.5 m band | PS010 |
| Puddles | low spots and run-off edges, mirror roughness 0.05, raindrop ring ripples 0.1-0.3 m, 2-4 Hz per m² density at heavy rain | |
| **Spray plume** | rear tyres throw a rooster tail 1.5-3 m high, 15-30 m long at > 150 km/h; near opacity 0.4-0.6, `#d6dadb` lit / `#9aa3a6` shadow side; front tyres throw a smaller side mist; the plume scatters the rain light red | PS010 |
| Rain streaks | thin 1-2 px streaks, 3-8% opacity, length ∝ camera speed; readable against dark trees, invisible against sky | PS010 (faint diagonal lines over trees) |
| Mist/haze | fog d 0.0015-0.002, `#aeb5b8`; trees at 300 m low-contrast | PS010 |
| Lens drops | **missing in code** (no droplet/lens shader found). Chase/T-cam: 20-60 refractive drops (2-12 px radius), streaking sideways/backward with speed and cleared by airflow above 150 km/h. Cockpit: drops on the visor edges | (F1 25 feature; not in these frames) |
| Car wetness | paint gets droplet beading (normal noise, 2-6 mm) at low speed, a smooth film at speed; tyres glossier (roughness -0.3, exists) | PS010 |
| Tyre colour | full-wet blue band, intermediate green band (section 6.4) | PS010 (blue band) |

---

## 11. Camera language

Code owners: `renderer.ts:124-133` (`CHASE`: height 1.95, distance 5.7, lookAhead 10, lookLift 0.42,
**fov 58 vertical + up to 6**), `:135-136` (T-cam lift 0.09, pitch -0.06), `:1056-1061` (**T-cam/pod fov
68 + up to 7 vertical**), `cockpit-framing.ts:7-13` (**cockpit verticalFov 64**, eyeOffset, pitch -0.045),
`trackside.ts:28-40` (`TRACKSIDE_PLATFORMS` fov 36-45), `photo-camera.ts`.

| Camera | Target framing (16:9) | Suggested start values | Reference |
|---|---|---|---|
| **Chase** | car at rest spans **38-45% of frame width**; rear-wing top at 57-62% from top; vanishing point at 36-42% from top; at speed the car shrinks ≤ 8% (FOV gain) and drops ≤ 2% | fov 58 → **50** (+4 at speed), distance 5.7 → about **4.9**, height 1.95 → about **1.75**, lookLift 0.42 → 0.35, lookAhead 10 → 14 | PSQ036, TIP029, TIP024 |
| Baseline chase | car spans about 26% of width (10-chase): too small, too much empty road | | |
| **Cockpit** | halo top bar in the top 10-14%; central pillar dead centre; steering wheel spans **32-40% of width**, screen readable; both front tyres and mirrors visible at the sides | verticalFov 64 → **54-56**; eye 2-3 cm lower; head-bob/vibration 0.2-0.4° on kerbs | PS003, TIP030 |
| Baseline cockpit | wheel spans about 24% of width (11-chase); too wide, and the scene is very dark (p50 0.10) | | |
| **T-cam** | halo arch top at 62-68% from top; front tyres in the lower corners; mirrors at the bottom edges; horizon at 42-46% from top | vertical fov 68 → **56** (+4 at speed); keep lift 0.09, pitch -0.06 | PSQ034, PSQ037, TIP025, TIP027 |
| Above-halo onboard (alt.) | behind the helmet top, halo + both mirrors in frame, strong road streaks | fov 60, 0.35 m above the helmet | PS008 |
| Low rear chase (replay) | 0.5 m high, 3 m behind the rear tyre, offset 1 m, rear tyre fills 25% of frame | fov 40 | PS007 |
| **Broadcast/trackside** | telephoto, vertical fov **8-24°**, panning to track the car with background motion blur; camera heights 3-8 m; occasional fence-in-foreground framing | `TRACKSIDE_PLATFORMS` fov 36-45 → 12-24 with zoom tracking | TX075, TX078, PS002 |
| Overhead/drone | 15-30 m above, looking 70-90° down, tracking | fov 30 | PS006 |
| Photo mode | default 35 mm equiv; shutter-blur pans (1/30-1/125 s) and DOF f/1.8-f/8 as user controls | existing 18-150 mm | TX075-TX080 |
| Garage/pit/podium | DOF on, f/2.8, 50-85 mm, warm practical lights | | PS004, BR020 |

---

## 12. Ranked: the 15 highest-impact visual changes

Ranked by (screen area × visible gap × frequency in normal play) ÷ effort. Each has a measurable
acceptance check against the numbers above.

1. **Asphalt rebuild** (`surface-detail.ts:10`, `circuit-finish.ts:42-44`): albedo palette [79,81,83] →
   [106,101,96], warm-neutral; the binder multiply lightened; second-scale aggregate; **racing-line rubber
   band at 45-60% luminance**, braking streaks, patches. Accept: sunlit crop `#7d7a76`-`#938b83`, B/R ≤ 0.95,
   near-road std-dev ≥ 8. *Asphalt is 30-50% of every gameplay frame.*
2. **Default camera motion blur ON** (`options.ts:41`, `motion-blur.ts:131`): 0.4 shutter Medium/High, max
   about 3.5% width, 12 taps; wheel-cover rotational blur. Accept: near-road streaks at 200 km/h in chase
   matching PSQ036/PS008.
3. **Vegetation and landform density** (`aurel-vegetation.ts`, `landscape.ts`, `terrain.ts`): continuous
   forest masses 15-25 m tall on hills and behind stands, desaturated canopy `#3f4b3e`; forested ridges
   instead of bare green hills. Accept: no visible bare-lawn hill in chase/T-cam captures.
4. **Car paint, liveries and carbon** (`car.ts:131-137`, `materials.ts:16`, `config.ts:244`): ccRoughness
   0.16 → 0.04, gloss/satin/matte finish table, saturated two-tone liveries, lacquered anisotropic carbon.
   Accept: a crisp horizon reflection line and a sun streak visible on the sidepod in a chase capture.
5. **Sky-blue shadows and car grounding** (`lighting-coherence.ts:13-21`, `daylight.ts:37-39`): hemisphere
   sky `#8fb6ea`, ground `#4a4237`, IBL 0.38-0.45; under-car contact shadow; near shadow cascade ±12 m.
   Accept: car shadow B/R ≥ 1.5, lit/shadow 10-17 : 1, under-floor 20-30 : 1.
6. **Camera framing** (`renderer.ts:124-133`, `:1056-1061`, `cockpit-framing.ts:11`): chase fov 50 with the
   car at 38-45% width; T-cam fov 56; cockpit fov 54-56. Accept: screen-space positions in section 11.
7. **Grass, run-off and kerbs** (`circuit-finish.ts:52`, `circuit.ts:153,489`, gravel band): olive grass
   `#6c7438` with mowing stripes; 1.0-1.2 m red `#c4222a` / white `#ecebe6` kerb blocks; painted asphalt
   run-off and astroturf between kerb and gravel. Accept: grass crop `#7f8444`-`#8e8a4c` in sun.
8. **Sky, clouds and aerial perspective** (`daylight.ts:41,47-50,131,259-270`): zenith `#6aa2d6`, horizon
   `#bcd6ea`, cumulus with flat bases, FogExp2 d about 0.00055 with height falloff and a sun-direction fog
   colour. Accept: 2 km ridge reads `#6f7b7a`-ish, horizon B - G ≥ 12.
9. **Tyres and wheels** (`tire-finish.ts:39`, `car.ts:300`, `config.ts:79-83`): tread `#2a2a2a` r0.75,
   satin sidewall, moulded lettering, a thin compound band in the corrected colours, team/carbon wheel
   covers, rim lip. Accept: compound readable at 10 m in chase at rest; lettering smeared at speed.
10. **Crowd and grandstands** (`crowd.ts`, `grandstand.ts:198-199`): per-person colour noise (crop std-dev
    ≥ 27), ≥ 90% occupancy, flags and waving, roof shadow lines. Accept: no uniform colour block > 2% of the
    frame in trackside captures.
11. **Trackside dressing** (`track-boards.ts`, `catch-fence.ts`, `steel-guardrails.ts`): continuous printed
    ad-board barriers with fictional brands, distance boards, distance-faded chain-link, Armco metal values.
12. **Driver and crew materials** (`driver-materials.ts:72-74`, `car-mechanical-detail.ts:129-135`, crew):
    team-colour suits with sheen, glossy helmet with an iridescent visor, coloured gloves (cockpit view!),
    crew helmets/suits with wordmarks. Accept: in a cockpit capture the gloves read as team colour, not
    sage/teal.
13. **Wet-weather presentation** (`spray-clouds.ts`, `materials.ts:42`, new lens-drop pass): vertical
    streak reflections, a 15-30 m spray plume lit red by the rain light, a lens-drop overlay, mist d 0.0015.
14. **Rain light, brake glow and emissive bloom** (`car.ts:246-250`, `lens-bloom.ts:32`): rain-light core at
    linear 15-30 with an LED dot-matrix, endplate strips, bloom 0.45 day / 0.8 night and wet.
15. **Night and golden-hour lighting profiles** (`daylight.ts:64-95`, `venue-lighting.ts:138`): sunset sun
    raised to about 10°, key `#ffb26b`, violet shadows; night masts every 25-35 m with uniformity ≥ 0.6, ≥ 8
    active pools near the camera, lamp bloom halos.

### 12.1 Things NOT to do
- Do not raise global exposure to brighten the scene: highlights and sky are already at reference levels
  (p95 0.82-0.84). Fix the asphalt, grass and shadow-fill instead.
- Do not add grain, chromatic aberration or sharpening to gameplay to fake detail
  (`broadcast-grade.ts:20-23` is right).
- Do not copy any logo, livery, track layout, sponsor wordmark or texture from the references. Use
  fictional brands, original textures and procedural detail. The supplied player GLB already carries
  real-team markings (menu shot): flag that to the producer, and do not extend it.
- Keep every change deterministic for replays (no wall-clock animation in materials). This repo enforces
  that pattern throughout (`daylight.ts:211-212`, `tire-finish.ts:24-26`).
