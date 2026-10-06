# TECH_ACTORS_MAP: vehicles and characters

Author: Technical Art Lead (vehicles & characters). Status: analysis only; no source changes.
Scope: player car (supplied RB19 GLB), rival cars (A61 GLB plus runtime materials), liveries/decals, tyres/rims/brakes,
drivers (helmet/visor/suit/gloves), pit/grid crew, marshals and crowd.
Line numbers refer to HEAD `3a6036d`. Paths are relative to `src/rendering/` unless stated otherwise.

---------------------------------------------------------------------------------------------------
## 0. Summary for implementers

**What we have.** Player: a 1.46 M-tri, 101-material RB19 GLB with a skinned R06 driver and cockpit. Rivals: a 108 k-tri
Blender A61 shell bound to runtime materials. Rival driver: procedural with a 9-bone suit skin. Crew: Blender-authored,
instanced (15 bones, 14 sampled actions). Crowd: instanced, 4 LODs plus an analytic billboard.

**Why it reads "toy-like" next to F1 25** (baseline `shots/baseline/10-chase.png`, `00-menu.png`, `20-driving-a.png`):

1. **The player RB19 paint is nearly black and matte.**
   - `Paint | midnight blue satin` has base linear (0.003, 0.005, 0.015), about sRGB #0A1021, roughness 0.46, clearcoat 0.045.
   - It only gets sky-only IBL at `scene.environmentIntensity` = 0.28 (`daylight.ts:39`).
   - Result: no visible highlights. F1 25 cars show crisp sky/horizon streaks along every body curve.
2. **Player carbon relief is effectively zero.**
   - `restoreSuppliedHeightMap` (`supplied-player.ts:22-37`) sets `bumpScale` 0.00015 (carbon) and 0.0004 (tyre).
   - r180 normalizes `dFdx(surf_pos)` in `bumpmap_pars_fragment`, so bumpScale is a unit-less gain; below about 0.05 it is invisible.
   - Every `Composite | …` material (ids 74, 81-83, 86, 91-93) renders flat dark grey.
3. **Bug: the player rain light never pulses.**
   - `supplied-player.ts:384` matches names containing "rain". The lamp is `Light | red lens` (mesh `RB19_RAIN`,
     emissiveStrength 4), so `this.rain` is empty.
   - Even lit, its luminance (about 0.85) is below the bloom threshold of 3.6 (`lens-bloom.ts:21`).
4. **The player car has no brake glow and no wet paint.**
   - `Brake | carbon ceramic` (id 80) has no emissive.
   - `installPaintObservation` runs before supplied materials are pushed (`car.ts:554-560`).
   - `FormulaCar.update` returns early for the supplied car (`car.ts:623-629`).
5. **Rivals look like pastel plastic.**
   - Pastel LIVERIES (`simulation/config.ts:244-247`, e.g. 0x54c8c0); clearcoatRoughness 0.16.
   - Carbon-black wheel covers; white ivory-ball helmet.
   - Tyres are black donuts with a thin raised torus ring (`tire-carcass.ts:44-49`) and no sidewall lettering.
   - The flank livery is a single Arial wordmark.
6. **Characters have no team identity.**
   - Pit and grid crew use a 5-tone muted blue-grey kit (`crew-geometry.ts:7-9`), whatever the car.
   - Grid mechanics wear crash helmets.
   - Every rival driver suit is the same teal (0x283f46).
   - All fabric is MeshStandard with no sheen.
7. **Texture budget.** At `medium`, supplied player maps and livery canvases drop to 512 px (`options.ts:31`;
   `imported-texture-budget.ts:72-75`, `texture-budget.ts`), so decals soften. All supplied player images are already ≤ 1024 px.

**Top priorities, in impact order:** P1 car paint look (colour, coat, flakes, IBL gain) on player and rivals ·
P2 player rain light, brake glow and wet coat · P3 tyre sidewall band and lettering, painted wheel covers · P4 carbon weave
relief and clearcoat · P5 helmet and iridescent visor · P6 team crew kits, plus caps and headsets on the grid ·
P7 fabric sheen · P8 crowd team colours and flags · P9 rival micro-silhouette.

---------------------------------------------------------------------------------------------------
## 1. Integrity-locked assets and guarding tests (do not break)

There is no Blender in this container (`which blender` returns nothing). All work must be runtime work: materials,
shader hooks, additive Three.js meshes, canvas textures. Do not edit or re-export these bytes or JSON files:

| Asset | Lock | Guard |
|---|---|---|
| `public/models/supplied-player.glb.gz` (36,134,058 B gz / 63,158,784 B raw) | `supplied-player.manifest.json`: sha256 `013a47f0…`, compressedSHA256 `269b4d94…`; 94 nodes, 18 meshes, 101 materials, 56 images, 58 joints, 1,455,118 tris; required nodes `supplied-player.ts:44-59` | `decode` (`supplied-player.ts:225-235`), `validateSuppliedPlayerDocument` (`:76-160`), `tests/supplied-player.test.ts:35-40`, `e2e/39-supplied-player.spec.ts` |
| `public/models/supplied-player-lods.bin.gz` | sha256 `2bcd661c…`; 172 primitives; tiers [1455118, 855654, 814806, 797386] | `supplied-player-lods.ts:34-106`, `tests/supplied-player-lods.test.ts` |
| `a61-rival-{near,mid,far}.glb.gz` | manifests (near 108,371 / mid 27,244 / far 10,443 tris); hashes of `scripts/apx01-assembly.blend` and `scripts/author-a61-rival.py` | `tests/a61-rival.test.ts:87-110`; budget `:203-235`: near < 250 k tris, LOD1 < 65 k, LOD2 < 30 k; near draws ≤ legacy path |
| `apx01-shell.glb.gz`, `apx01-assembly.json` (ghost car and legacy) | `apx01-shell.manifest.json`; loader allows only quantization and clearcoat extensions, ≤ 8 materials, no textures | `tests/hero-shells.test.ts` |
| `apx01-driver.glb.gz` (9 bones) | `apx01-driver.manifest.json`; `scripts/author-driver.py` hash | `tests/driver-asset.test.ts`, `tests/character-quality.test.ts:107-125` |
| `aurel-people.geometry.json`/`.glb.gz` (crew, helmet, glove, spectator_0/1/2) | `aurel-people.manifest.json`; `author-people.py` hash | `tests/people.test.ts:79-125`; `character-quality.test.ts:168-205` (lens vertex colours) |
| `crew-performance.geometry.json`/`.glb.gz` (suit_near 9,408 / suit_mid 4,208 / helmet 4,232 / glove 1,580 tris) | runtimeSHA256 `fa55bc95…`; rest pose must equal `CREW_REST` | `tests/crew-performance.test.ts:23-44` |
| `grid-mechanic.*`, `start-finish.geometry.json` (audience families and atlas) | their manifests | `tests/grid-staff.test.ts`, `phase27g-*.test.ts` |

**Runtime material edits are safe.** Changes to supplied GLB materials are not hash-relevant (the hash covers bytes before
parsing) and not test-asserted, except for the items below.

**Test constraints you will hit:**

| Test | Constraint |
|---|---|
| `tests/supplied-player.test.ts:202-222` | `restoreSuppliedHeightMap` bumpScale must stay in (0, 0.001). Amplify relief in a separate hook (§10.2) or update the test with justification. |
| `tests/imported-render-budget.test.ts:168-198` | `configureSuppliedMaterial` leaves `F1CP_MAT_Visor` with forceSinglePass false. `Decal |` sheets stay transparent and single-pass. |
| `tests/phase27e.test.ts:148-165` | `installPaintFinish` is idempotent (same key), adds **zero uniforms**, and contains `dFdx`. |
| `tests/phase27g-presentation.test.ts:30-48` | Exactly one `uniform vec3 paintObservation`; clones are isolated. |
| `tests/race-surface-finish.test.ts:110-140` | `car.rings[i]` is a MeshStandard with emissive 0 and intensity 1. `treads[i].surface.value.y` ∈ {0,1,2}. Every visible tread mesh keeps `tireBind`; reduced tyres share `treads[i].material` (`car.ts:546-549`). `car.rearSignal.parent === car.root`. |
| `tests/tire-carcass.test.ts` | Every mesh in `TireCarcass.root` stays under the axle at the contact patch. |
| `tests/cockpit-detail.test.ts:125-150` | `fabricPixels` is deterministic. Suit, glove and panel share the normal and roughness DataTextures (NoColorSpace, mipmapped). MeshPhysical is acceptable. |
| `tests/character-quality.test.ts:208-232` | `installCrewHelmetFinish` is idempotent, keeps earlier uniforms, and contains `roughnessFactor=mix(roughnessFactor,.17`. |
| `tests/people.test.ts:430-500` | Impostor index count is 6. `spectatorStyle` and `instanceMatrix` are shared across LODs. Shaders contain `attribute vec3 crowdPerson`, `mix(position,standingPosition,spectatorStyle.z)`, `vCrowdAccessory < .5`, `vCrowdRank >= crowdLodRange.y`. |
| `presentation-closure` / `presentation-continuity` tests | `crowdLodRanges` is pinned. |
| `e2e/fixtures/apx01-assembly.ts` | Reads `car.reflectivePaint` flank materials (`userData.liverySide` ±1 with a CanvasTexture map) and `car.paint` colour after `setLivery`. |

**Hook-chaining rule (house style).** Capture `previous = material.onBeforeCompile` and
`previousKey = material.customProgramCacheKey()`, call `previous` first, and append a unique key suffix.

These existing installers **overwrite** instead of chaining. Install new hooks after them, and chain:
- `carbonMaterial` (`materials.ts:16-37`, key `'apex-metre-carbon-v3-twill'`)
- `treadMaterial` (`tire-finish.ts:43-67`)
- `installCrewSkin` (`crew-pose.ts:185-245`)
- `installCrowdShader` (`crowd.ts:125-185`)
- `installCrowdImpostorShader` (`crowd-impostor.ts:15-89`)
- `buildHelmet` helmet paint (`car-mechanical-detail.ts:103-127`)

Install order: the car constructor runs first. Then `RacingRenderer.setCars` (`renderer.ts:566-595`) runs
`reflectInWetRoad`, `textures.register`, `weatherPresentation.install` and `atmosphere.install`, and pushes
`car.reflectivePaint` into `reflectionMaterials`.

---------------------------------------------------------------------------------------------------
## 2. Player car: supplied RB19 + R06 cockpit/driver GLB

**Load path.**
1. `renderer.ts:424-433` loads, in order: `loadHeroShells`, `loadRivalLevels`, `loadDriverAsset`, `loadSuppliedPlayer`.
2. `loadSuppliedPlayer` (`supplied-player.ts:521-583`) streams `./models/supplied-player.glb.gz?v=<sha16>` with a 120 s timeout.
3. `SuppliedPlayerAsset.decode` (`:218-280`) checks the hash, gunzips, validates the contract, loads the LOD indices,
   and parses with GLTFLoader. All meshes cast and receive shadows; SkinnedMeshes get `frustumCulled=false`.
4. `FormulaCar(0, …)` (`car.ts:556-563`) calls `take(display)`. It hides all procedural children (they still exist and
   `setLivery` still updates them), adds `suppliedPlayer.root`, appends its `reflectivePaint`, and swaps mirrors to `RB19_MIRROR_0/1`.

**Scene graph.**

| Node | Contents |
|---|---|
| `PLAYER_VEHICLE` | Vehicle root. |
| `RB19_BODY` | Mesh 7: 48 primitives, 752 k tris. Monocoque, floor, pods, decals, exhaust, skid, and the **brake discs** (static, so they never spin). |
| `RB19_FRONT_WING`, `RB19_DRS`, `RB19_REAR_WING` | Under the damage pivots `PLAYER_FRONT_WING` / `PLAYER_REAR_WING`. |
| `PLAYER_WHEEL_i` → `PLAYER_SPIN_i` → `RB19_spin{i}` | 11 primitives: tyre, `Metal | black anodised` rim, `Paint | vermilion`, titanium, `Anodised hub | yellow`, `Decal | tyre_pirelli/pzero/barcode`, `Tyre | compound sidewall ink`. |
| `RB19_RAIN` | Lamp, material `Light | red lens`. |
| `F1CP_ROOT` | `PLAYER_COCKPIT` (skinned), `PLAYER_CONTROLS`, `PLAYER_DRIVER` (20 primitives, 242 k tris, 58-joint skin). |
| `PLAYER_HEAD` | Helmet, visor, face, eyes. Hidden in cockpit view (`:436-438`). |
| `PLAYER_LCD` | Replaced by a MeshBasic canvas display (`:336-347`). |

**Material inventory.** Authored glTF values, linear baseColorFactor.

| id | Name | Base / rough / metal | Notes |
|---|---|---|---|
| 87, 88 | `Paint | midnight blue satin` (+curve-local) | (0.003, 0.005, 0.015) / 0.46 / 0.015 | cc 0.045, ccRough 0.38, specular 0.54. **The main body colour (59 k tris).** |
| 46 / 90 / 85, 89 | `Paint | vermilion` / `warm yellow` / nose panel, airbox roundel | (0.72, 0.018, 0.022) / (0.95, 0.32, 0.003) / navy | Same coat (cc 0.045 / 0.38). |
| 74, 81 | `Composite | 2x2 twill / physical scale` | (0.028, 0.033, 0.038) / `carbon_twill_roughness` | Bump `carbon_twill_height`; cc 0.13 / 0.36; anisotropy 0.52. |
| 82-83, 86, 91-93 | Floor laminate, cured skins, dry ducts, rear-wing laminate | Same base; rough 0.42 / 0.295 / 0.55 / 0.425 | cc 0.06 / 0.18 / 0.018 / 0.065; anisotropy 0.32. |
| 80 | `Brake | carbon ceramic` | (0.034, 0.033, 0.032) / 0.74 | **No emissive.** |
| 94, 99 / 97 | `Tyre | lightly scrubbed slick` / `Tyre | compound sidewall ink` | (0.015, 0.017, 0.02) / 0.56; ink (0.85, 0.63, 0.012) | Ink is recoloured per compound (`:455-456`). |
| 50-73, 95-98 | `Decal | <sponsor>` and `Decal | tyre_*` | BLEND, rough 0.45 / 0.64, cc | Textures ≤ 1024 px; `race_number` is 350×480. |
| 44 | `Metal | black anodised` | (0.017, 0.019, 0.022) / 0.29 / 0.8 | 250 k tris in the body. |
| 100 | `Light | red lens` | emissive (1, 0.01, 0.002), strength 4 | |
| 35 | `F1CP_MAT_HelmetPaint` | 1024 px base texture / 0.27 | cc 0.38 / 0.16. |
| 36 | `F1CP_MAT_Visor` | (0.64, 0.71, 0.76) / 0.065 | cc 0.16, IOR 1.586. A light clear visor. |
| 22, 26-28, 30-31, 34 | `F1CP_MAT_Suit` / glove / knit | — | Sheen (0.015, 0.018, 0.020) with roughness 0.75, so effectively invisible. |
| 38-41 | Face, eyes | Face (0.24, 0.12, 0.073) / 0.64 | No subsurface scattering. |

**Runtime processing.** The constructor traversal (`supplied-player.ts:363-386`) runs, per material:
`restoreSuppliedHeightMap`, then `configureSuppliedMaterial` (`supplied-player-materials.ts:52-73`: empty-decal
discard, single-pass decals, texture-budget opt-in), then `installSuppliedShaderWork` (bone palette, packed ORM).
It then sorts materials into `reflectivePaint` (`Paint |`, non-tyre `Decal |`, `F1CP_MAT_HelmetPaint`; `:374-380`),
`compound` (`:381`), `rubber` (`:382`) and `rain` (`:384`, the bug in §0).

**This traversal is the main extension point. Name-keyed overrides here are integrity-safe.**

**LODs.** The player is always `carLod = 0` (`lod.ts:19`). `SuppliedPlayerLods.setLevel`
(`supplied-player-lods.ts:221-227`) picks tier 0 (1.455 M tris) on high or when `exactClose` is set, otherwise
tier 1 (855 k). It swaps index buffers only.

**Per-frame update** (`supplied-player.ts:430-468`). Handles the steering clip; wheel hub travel, steer, camber and spin;
pit offset and wing damage; compound ink colour; rubber roughness × (1 − 0.3·rain/14); and the empty rain list.
It has no disc temperature, no paint wetness and no livery. `FormulaCar.update` (`car.ts:623-629`) draws the LCD and delegates.

**Livery on the player car.** `renderer.ts:774-781` → `car.ts:95-117` recolours only the hidden procedural paint;
`repaintFlank` exits without a source canvas. The decal editor therefore has no visible effect on car 0.
Art Director decision: (a), recommended, tint `Paint | midnight blue satin*` from `livery.primary` and vermilion/yellow
from `livery.accent`; or (b) keep the RB19 authentic and hide the livery UI.

---------------------------------------------------------------------------------------------------
## 3. Rival cars (id > 0): A61 GLB geometry with runtime materials

`car.ts:125`: `if (id > 0 && rivals) hero = rivals[0]`. The near A61 replaces the apx01 shell. `HeroShells.copy(part, side)`
(`hero-shells.ts:238-259`) returns owned, mirrored clones of 41 parts (slots in `a61-rival-near.manifest.json`
`materialBindings`). All materials are per car.

| Slot | Code | Value | Used by |
|---|---|---|---|
| `paint` | `car.ts:131-138` | MeshPhysical `LIVERIES[id%12]`, metal 0.06, rough 0.34, cc 1, ccRough 0.16, plus `installPaintFinish` | nose, monocoque, engine, airbox_paint, front/rear_paint, mirror_shell |
| flank ×2 | `car-livery.ts:74-86` | paint clone with a 1024² canvas map | sidepod |
| `carbon` | `materials.ts:16-37` | **MeshStandard** 0x15191c, metal 0.08, rough 0.42, twill shader (`shaders/carbon*.frag`) | floor, floor_edges, **safety (halo)**, beam, front/rear_carbon, **covers**, ducts, airbox/tail carbon, seat, suspension |
| `dark` | `car.ts:141` | 0x101416, rough 0.75 | airbox/tail dark, seat padding, **calipers** |
| `metal` | `car.ts:142-145` | 0x7c8589, metal 0.88, rough 0.30, turned-alloy | **rims**, hubs, uprights, *_alloy, hats |
| `ivory` = `accent` | `car.ts:146-153` | MeshPhysical 0xe7e1d2, rough 0.3, metal 0.18, cc 1 | nose pinstripes (`:274-287`), **helmet base** (`:523`) |
| `logo` | `car.ts:257-273` | `label('APEX / NN')` patch | nose |

**LODs.**
- `carLod` (`lod.ts:13-28`): near 55 m, far 130 m, hysteresis 8 m, all × scale (high 1.25, low 0.7).
- `ReducedCar` (`lod.ts:32-219`) uses `rivals[1]` and `rivals[2]`. Rim, cover and hub are all carbon (`:193-194`).
  The helmet is a painted `helmetShell()` (`:134-142`). There is no driver.
- Paint, flank and tread materials are shared across LODs, so material work reaches every LOD.

**What the silhouette lacks against the references.** All can be added at runtime before `mergeStatic(s)` (`car.ts:529`);
`mergeStatic` groups by material (`geometry.ts:72`), so reusing an existing material is draw-neutral. Missing: a T-camera pod
and antennae; coloured wheel covers; a painted halo; front/rear endplate graphics with number; a readable LED rain light
(a 95×65×20 mm box today, `car.ts:254`); reflective rival mirror glass (MeshBasic 0xd4dde0 today, `cockpit.ts:93`).

---------------------------------------------------------------------------------------------------
## 4. Livery and decal system

**Storage.** `Livery` (`storage/livery.ts`): `primary`, `accent`, `number`, `sponsor`, `pattern` (sweep/split/minimal), and up to
10 `DecalSlot`s (14 chars A-Z0-9, colour, x/y ±1, scale 0.35-1.75, rotation ±90°, side). Policy (`ui/decal-editor.ts:207`):
original text only, no licensed logos. Keep this for rivals.

**Rendering.** `drawFlank` (`car-livery.ts:23-72`) fills a 1024² canvas per side: primary fill; dark #10191d lower polygon at
y 590/715/860; accent stripe 8 or 24 px; sponsor in italic 800 87 px Arial at x = 0.25/0.75 × 1024, y 440, rotated ±90°;
"FORMULA / AUREL" at 21 px; number at 49 px, y 690; decals via `drawDecal` (`:7-19`). `repaintFlank` (`:88-95`) is reached
only from car 0. Rival liveries are generated once from `LIVERIES[id]` with numbers id+7. The canvas goes through
`TextureBudget`, so it is 512 px at medium.

**Extension points.**
- `drawFlank`:
  - Add several original sponsors ("AUREL", "VANTA", "NORTHLINE", "KESTREL", "OBSIDIAN").
  - Add a two-tone `createLinearGradient` sweep, 2-3 px accent pinstripes, a dark diagonal "exposed carbon" lower band,
    and a 120 px condensed team number.
  - Keep the signed UV orientation (centre 0.25/0.75, rotation ±π/2).
- Nose and engine cover: they use plain `paint`. Add a new `installLiveryPattern(material, {primary, accent, secondary})`
  with **its own uniforms** (`installPaintFinish` must stay zero-uniform). Use object-space shapes on `vPaintPosition`:
  an accent chevron where |x| < 0.04 + 0.03·smoothstep(...) for z ∈ [0.4, 2.0], and secondary colour below y < 0.02.
- Resolution: for the followed car, allow 2048 px by extending `textureSize` choices (`options.ts:31,67`, today
  [128, 256, 512, 1024]) plus the UI and tests.
- Palette: replace the pastel `LIVERIES` (`simulation/config.ts:244-247`) with saturated sRGB team bases:
  #B3121E, #F27C1E, #0B5E4F, #13235E, #E9E9EB, #1C5BD8, #E36FA8, #16181B, #2BB3A0, #9EA4AA, #7FC241, #F2C200.
  Add a dark secondary and a light accent for each. The HUD reads the same array (`ui/interface.ts:462,549`).

---------------------------------------------------------------------------------------------------
## 5. Wheels: tyres, rims and brakes

**Rival hierarchy** (`car.ts:289-445`). `pivot` (steer/camber, y −0.183) contains `spin`, which holds rim, cover and hub.
`wheelCarriers[i]` (non-rotating) holds duct, upright and caliper. The disc sits on `pivot`, rotated to the wheel
phase (`:741`). `mountAuthoredWheel` (`car-assembly.ts:28-47`) assigns rim→metal, **cover→carbon**, hub→metal,
duct→carbon, upright→metal, caliper→dark.

**Rival tyre.**
- `TireCarcass` (`tire-carcass.ts:28-143`) deforms `hero.copy('tire_*')` on the CPU from load, pressure and flat spot,
  with immutable `tireBind` (`tire-finish.ts:8-22`).
- It adds **two `TorusGeometry(0.287, 0.005, 6, 48)` compound rings** (`:44-49`) using `rings[i]`
  (MeshStandard, compound colour, rough 0.82).
- BEAD 0.245 m, NOMINAL 0.335 m. Half-width 0.155 front, 0.19 rear (`car.ts:297`).
- `treadMaterial` (`tire-finish.ts:36-68`): 0x191c1d, rough 0.9. Uniforms:
  - `treadCondition`: dirt, wear, blister, graining
  - `treadSurface`: wet; style 0 slick / 1 inter / 2 wet; half-width
- `shaders/tread.frag`: polar coords `tireRadius`, `tireAngle`, `tireAcross`; crown mask, inter/wet grooves, dirt, wear.
- Compound colours (`simulation/config.ts:79-83`): soft 0xe7444f, medium 0xf6cf45, hard 0xe1e1db, inter 0x49bb82, wet 0x529bea.

**Rival brake.**
- Geometry: `ventilatedBrakeGeometry` (`manufacturing.ts:61-91`: r 0.209, bore 0.084, 2×20 vents, 14 mm thick),
  or `hero.copy('brake_rotor')`.
- Material (`car.ts:347-356`): 0x4b4a45, rough 0.6, emissive 0xff4d08, carbon-ceramic finish.
- Glow (`:742`, LOD0 only): `clamp((DISC_TEMP−500)/450, 0, 2)`. The colour is fixed, not blackbody. The maximum
  luminance is about 0.85, which is below bloom.
- Reduced brakes are carbon (`lod.ts:164`) and never glow.

**Player wheel.** Tyre, rim, painted cover, Pirelli/P ZERO/barcode decals and the ink ring are all authored, which is good.
The discs sit in `RB19_BODY`: static, one shared material, **no glow**.

**Reference look.** Sidewall: a 12-15 mm compound arc band near the outer shoulder (r ≈ 0.315-0.325 m on a 0.335 m tyre),
with large brand/model lettering between band and rim in the compound colour (white hard, yellow medium, red soft, green
inter, blue wet). Rubber is charcoal (sRGB #2A2B2D), not black; sidewall roughness ≈ 0.8; tread scrubbed and lighter. Wheel
covers in team colour, often with a contrast ring. Anthracite rims. Under heavy braking, discs glow orange-red at the outer
radius, with bloom.

---------------------------------------------------------------------------------------------------
## 6. Drivers

**Player.** Skinned R06 driver with 1024 px suit, glove and helmet maps, face and eyes; head hidden in cockpit view. Arms
follow the `PLAYER_STEERING` clip (`steeringSample`, `supplied-player.ts:186-195`). Weak points: the light clear visor, the
invisible sheen, and no subsurface scattering on the face (mostly hidden anyway).

**Rivals.** `DriverRig` (`driver.ts:91-243`).
- Torso: procedural loft (`buildDriverTorso`, `driver-anatomy.ts:294+`) with suit, neck, collar and HANS yoke.
- Sleeves: the 9-bone `apx01-driver` skin via `DriverAsset.instantiate` (`driver-asset.ts:194-210`), which clones the suit
  material with vertexColors and FrontSide.
- IK: two-bone (`driver.ts:14-45`). Shoulders (±0.16, 0.015, −0.48); UPPER 0.37, LOWER 0.36 (`:89-90`). Test-pinned
  hardpoints; do not move them. Gloves are procedural (`buildGlove`), parented to the steering wheel.
- Helmet (`car-mechanical-detail.ts:99-201`): lofted `helmetShell()` on an **ivory accent clone**, with a shader centre
  stripe and vent (key `'original-helmet-crown-v2'`). Visor: MeshPhysical 0x253b45, metal 0.35, rough 0.13, cc 1,
  ccRough 0.07 (`:129-136`). Gasket tubes, hinges and tether posts are all `mergeStatic`.
- Fabric: `driverMaterials()` (`driver-materials.ts:36-82`), all MeshStandard, sharing one 128² woven DataTexture
  (repeat 3×): suit 0x283f46 (rough 0.98, normalScale 0.3), glove 0x74928a (0.86), panel 0x293f44, grip 0x1c2326,
  stitch 0xaaa895.
- LOD1/2: only a painted helmet shell.

**Reference look.** Bespoke high-gloss multi-colour helmets with a sponsor strip on the visor top; dark smoked or iridium
mirror visors (blue/gold/rainbow shift) reflecting the sky; team-coloured Nomex suits with soft sheen, embroidered
patches and contrast panels; gloves with knit back, suede palm and coloured cuff.

---------------------------------------------------------------------------------------------------
## 7. Pit crew, grid crew and marshals

**Shared kit.** All three use the Blender kit from `crewPerformanceGeometry` (`crew-performance.ts:13-81`): 15 bones
(`CREW_REST`), 2-4 weights; meshes suit_near, suit_mid, helmet, glove (left via mirrored indices). `installCrewSkin`
(`crew-pose.ts:185-245`) reads a bone-atlas DataTexture (60 × rows) indexed by instanced `crewSlot`. `crewSuitFragment`
(`crew-suit.ts`) draws yoke/shoulder panels in a fixed vec3(.30,.36,.37), darkened reinforcements, a zip and piping
vec3(.48,.44,.32). Roughness `mix(.58, .88±.035, vCrewCloth)`.

**Pit crew** (`pit-crew.ts`). 15 per car × 12 = 180 actors. Instanced batches (`:162-250`): cloth near/mid (MeshStandard
white + vertexColors, rough 0.9, `:170-197`); helmets (rough 0.35, metal 0.08, + `installCrewHelmetFinish`, `:198-199`);
gloves L/R (`:200-203`); guns, jacks, handles, signals; custom depth/distance materials. Colour:
`palette[(car*7+wheel+role)%5]` (`:403-406`) from `CREW_KIT_COLOURS` (`crew-geometry.ts:7-9`: 0x244553, 0x315963,
0x334950, 0x455961, 0x304c62), which are not team colours. Helmets are white 0xe1ded0 with a vertex-coloured blue-black lens.

**Grid.** `grid-presentation-view.ts:178-207` puts a crash helmet on every mechanic; the references show polo shirt, cap
and headset. `grid-preparation.ts:153-186` uses `crew_mid`, helmet and glove. Colour is `CREW_KIT_COLOURS[id%5]`
(`grid-presentation-view.ts:369`).

**Marshals** (`marshal-staff.ts:79-200`). suit_mid recoloured on the CPU to orange 0xe6813c with reflective bands 0xe8e6c8
at y≈1.2 and 0.39; helmets, gloves, a cloth-shader flag, poles.

**Proportions.** Rest pose heights: head 1.61, shoulders 1.43 (±0.245, a 0.49 m span), elbow 1.07, wrist 0.73 (real ≈ 0.82),
hips 0.88 (±0.092), knee 0.46. The forearm is 0.34 m (`CREW_FOREARM`, `crew-pose.ts:12`) against a real 0.26-0.28, so arms
read long and shoulders broad.

Fixing this is **hash-locked** (runtimeSHA256 plus the rest-equality test) and needs a Blender re-export.
Runtime options:
- (a) In the skin vertex stage, compress the distance from the elbow toward the wrist by 0.82 for fore and hand
  joints, and shift the glove placement by the same factor.
- (b) Accept the proportions and spend effort on materials and accessories first. **Recommended.**

---------------------------------------------------------------------------------------------------
## 8. Crowd

**Placement** (`grandstand.ts:189-280`). Seats from the authored plan. `personPalette` (`:199`): 0x535b5c, 0xc7b69b, 0x323f51,
0xab4030, 0x3f665a, 0x88867d; 60 % of a cohort shares one colour (`:222-227`). Clusters of 64 (hero stand) or 128 (`:270-280`).

**`CrowdCluster`** (`crowd.ts:198-339`). Four InstancedMeshes share `instanceMatrix`, `instanceColor`, `spectatorPhase`,
`spectatorSkin` and `spectatorStyle` (width, height, standing, accessory). Levels: 0 `spectator_0` (2,296 tris),
1 `spectator_1` (1,328), 2 `spectator_2` (638), 3 a `PlaneGeometry(0.66, 1.72)` impostor. The hero stand's levels 0-1 use
`audienceGeometry(level, family)` (4 families). Visual-distance bands 92-108 / 218-242 / 420-480 m (`:56-78, 187-194`) with
a stable per-person rank dither.

**Animation.** `installCrowdShader` (`:125-185`) turns joints about pivots (`crowdTurn`), driven by `crowdClock` and passing-car
reaction (`crowdResponse`). The hero stand adds `installAudienceActions` (`audience-actions.ts`): a quaternion atlas of
4 bones × 121 frames × 4 clips (idle plus 3 gestures). Motion fades out by 120 m.

**Variety.** 5 skin tones (`:226`), 2 hair tones (`:178`), torso/sleeve panel tweaks; accessories discarded via `vCrowdAccessory`.
**Impostor** (`crowd-impostor.ts:15-89`): analytic ellipse person (head, torso, lap, legs), alphaTest 0.5 + alpha-to-coverage,
no shadow.

**Reference look.** Dense, saturated team-colour blocks (red, papaya, navy), waving flags and banners, caps, raised phones.

---------------------------------------------------------------------------------------------------
## 9. Cross-department dependencies (Lighting / Render)

**IBL** is sky-only (`daylight.ts:368+`, `SkyEnvironment`, published at `:520`). `scene.environmentIntensity` and the followed
car's paint `envMapIntensity` are both `daylight.environment` = 0.28 − 0.07·cover (`renderer.ts:937-939`;
`reflections.ts:121-130`). Sun 4.2, fill 0.26, ACES exposure 0.9-1.05 (`renderer.ts:311-312`). The local cube probe is 128 px
(`reflections.ts:79`), only with `reflections: 'local'` (high).

**Vehicles need** (coordinate with the Lighting lead, TECH_RENDER_MAP.md) either a vehicle-only env gain of ×3-4, or a
"track horizon" PMREM (sky over a 0.18-albedo ground with a horizon band). Also: probe 256 px on high, 128 px on medium.

**Bloom.** Threshold 3.6, strength 0.55 (`lens-bloom.ts:21,32`). An emitter needs luminance ≥ ≈ 4: red (1, 0.01, 0) needs
intensity ≥ 18; orange (1, 0.3, 0.03) needs ≥ 8.5.

---------------------------------------------------------------------------------------------------
## 10. Extension-point cookbook

### 10.1 Clearcoat car paint and flakes

**Rival paint** (`car.ts:131-138`).
- Solid colours: metalness 0.0, roughness 0.32, clearcoat 1, **clearcoatRoughness 0.045**, `ior` 1.5, specularIntensity 1.
- Metallic flake liveries (silver, blue, green, papaya): metalness 0.35, roughness 0.38, `userData.flake = true`.

**Flakes.** Write a new `installPaintFlakes(material)` in `paint-finish.ts`, chained after `installPaintFinish`.
Use constants only, so the zero-uniform contract holds. Cache-key suffix `|aurel-flake-v1`.
1. Hook `#include <normal_fragment_maps>`.
2. Cell coordinate: `fp = vPaintPosition*2400.` (about 0.4 mm flakes).
3. Fade: `flakeResolved = 1.-smoothstep(.4,1.4,max(length(dFdx(fp)),length(dFdy(fp))))`.
4. Mask: `flakeMask = step(.82, hash(floor(fp)))`.
5. Tilt the **base** `normal` (not `clearcoatNormal`) by 0.18·hashDir·flakeResolved·flakeMask.
6. Add `metalnessFactor += .25*flakeMask*flakeResolved`.

**RB19 overrides** in the `supplied-player.ts:363-386` traversal:

| Material | Change |
|---|---|
| `Paint | midnight blue satin*` | colour linear (0.0091, 0.0145, 0.068) = sRGB #18204A; roughness 0.36; clearcoat 0.55; clearcoatRoughness 0.10; sheen 0.25, sheenColor 0x23305e, sheenRoughness 0.45 |
| `Paint | vermilion` / `warm yellow` | clearcoat 0.6, clearcoatRoughness 0.08 |
| non-tyre `Decal |` | clearcoat 0.6, clearcoatRoughness 0.08, so decals sit under the same coat |

**Wet coat for the RB19.**
1. Call `installPaintObservation(m)` on each `reflectivePaint` material at construction.
2. In `SuppliedPlayer.update` (`:430`), compute `wet` exactly as `car.ts:631-639`.
3. Call `setPaintObservation(m, wet, front, rear)`.

The damage mask uses object z 1.5-2.0 and −1.8 to −2.1 (`paint-finish.ts:81-86`). Verify it against the RB19 bounds,
or pass health = 1.

**Env gain.** In `setSkyIntensity` (`reflections.ts:121-130`), multiply car `reflectivePaint` by `VEHICLE_ENV_GAIN` = 3.2.
Leave road materials unchanged.

### 10.2 Carbon weave

**Rivals: `carbonMaterial()`** (`materials.ts:16-37`).
- Use `MeshPhysicalMaterial({color:0x14181b, metalness:0, roughness:0.38, clearcoat:0.85, clearcoatRoughness:0.07})`.
- New key `'apex-metre-carbon-v4-twill-coat'`.

**`carbon.frag`.**
- Contrast `1.+twillStrand*carbonResolved*.22`.
- Add `diffuseColor.rgb += .012*max(0.,twillStrand)*carbonResolved`.
- Roughness clamp (0.28, 0.6).
- 3 mm period: `*333.`.

**`carbon-normal.frag`.** Slope 0.035 → 0.06.

**Matte floor.** For a matte forged look on floor and floor_edges, add `carbonMatte` (MeshStandard, roughness 0.55);
this costs +1 draw.

**Player relief.** Keep `restoreSuppliedHeightMap` within the test bound. Add a new `amplifySuppliedRelief(material)`
that patches `bumpmap_pars_fragment`, following `installStableSurfaceBump` (`materials.ts:183-219`), with
`dHdxy *= GAIN`:
- GAIN 4000 for `carbon_twill_height` (effective 0.6)
- GAIN 2000 for `tyre_scrub_height_16bit` (effective 0.8)

**Player coat.**
- `Composite | 2x2 twill*` and `cured aerodynamic skins*`: clearcoat 0.6, clearcoatRoughness 0.08.
- Floor laminate stays at 0.06.

### 10.3 Tyre sidewall lettering and compound band

Work in `shaders/tread.frag` and `treadMaterial` (`tire-finish.ts:36-68`).

**New uniforms.**
- `treadCompound`: vec3, linear.
- `treadLetters`: a shared 1024×128 canvas, `flipY=false`, holding **original** wordmarks such as "APEX CORSA" and
  "SLICK 18", condensed bold, white on transparent.

**Shader.**
1. Sidewall mask:
   `side = smoothstep(.90,.97,abs(tireAcross))*step(.252,tireRadius)*(1.-step(.334,tireRadius))`
2. Band:
   `aa = fwidth(tireRadius)`;
   `band = smoothstep(.312-aa,.312+aa,r)*(1.-smoothstep(.326-aa,.326+aa,r))*side`,
   drawn as two 150° arcs: `*step(.04,fract(tireAngle*2.))*step(fract(tireAngle*2.),.46)`.
3. Letters: for .268 < r < .308, `uv = vec2(fract(tireAngle*2.), (r-.268)/.040)`, with u flipped when `tireAcross < 0`;
   `letter = texture2D(treadLetters,uv).a*side`.
4. Colour: `diffuseColor.rgb = mix(diffuseColor.rgb, treadCompound, max(band,letter)*.92)`; ink roughness 0.55.
5. Rubber base: 0x191c1d → 0x232426; sidewall roughness 0.82.

**Per frame.** Set `treads[i].compound.value.setHex(compound.color)` at `car.ts:652-670`.

**Old rings.** Keep `rings[i]` for the test, but shrink the torus tube to 0.0015 or colour it as rubber.

**Coordinates.** Use `tireBind`, not UVs: it is immutable under deformation and across LODs (reduced tyres use
`bindTireSurface(...,'y')`).

**Targets (sRGB).** Soft #E10600, medium #FFD100, hard #F0F0F0, inter #3CB043, wet #0067FF.

### 10.4 Brake glow

**Rivals.** At `car.ts:742`, replace the line with a blackbody ramp on `emissive` and intensity:

| Temperature | Colour | Intensity |
|---|---|---|
| < 450 °C | — | 0 |
| 450 °C | 0x3a0600 | 0.3 |
| 650 °C | 0xb21a00 | 1.5 |
| 850 °C | 0xff4a0a | 6 |
| ≥ 1000 °C | 0xff8a30 | 12 |

- Limit glow to the outer radius in the carbon-ceramic hook (`manufacturing.ts:39-45`):
  multiply `totalEmissiveRadiance` by `smoothstep(.12,.19,length(vManufacture.yz))`.
- Give reduced brakes the shared disc material (`lod.ts:164`). This costs +1 draw per reduced car.

**Player.**
1. Collect `Brake | carbon ceramic` in the traversal.
2. Add a hook that picks the wheel from the object-space quadrant (signs of x and z about the wheelbase midpoint;
   wheelbase 3.44, track 1.66 in `manifest.fit`).
3. Multiply emissive by a `uniform vec4 discGlow` (FL, FR, RL, RR), set in `update()` from `b[p+W.DISC_TEMP]`
   (`simulation/protocol.ts:163`).

### 10.5 Rain light (bug fix plus bloom)

- Player: change `supplied-player.ts:384` to match `m.name === 'Light | red lens'` (keep the "rain" test as an extra condition).
- Gain: apply `REAR_LAMP_GAIN` at the call sites `car.ts:645` and `supplied-player.ts:461` (×8 player, ×20 rivals).
  Do **not** change `rearSignalIntensity` itself: it drives `RearSignalField` and is referenced by
  `tests/phase27e.test.ts:176,200` and `tests/race-finish.test.ts:88,110`.
- Rivals: replace the box at `car.ts:254` with a 3×4 LED-dot InstancedMesh or a 110×60 mm emissive canvas plate.
  Keep the name `'Recorded rear signal'` and the parent `car.root`.

### 10.6 Helmet and visor reflections

**Rival visor** (`car-mechanical-detail.ts:129-136`). MeshPhysical:
- color 0x0b1014, metalness 0, roughness 0.04
- clearcoat 1, clearcoatRoughness 0.015
- **iridescence 1, iridescenceIOR 1.8, iridescenceThicknessRange [280, 620]**
- envMapIntensity 2.5

Push it into `car.reflectivePaint` so the probe and env gain apply.

**Rival helmet** (`:103-127`). It clones `ivory` (passed at `car.ts:523`).
- Pass a per-team material instead: `LIVERIES[id]` plus secondary and accent; clearcoat 1, clearcoatRoughness 0.03, roughness 0.25.
- Replace the stripe with three zones (crown, side flash, chin bar) and keep the vent.
- Use the same material for the `ReducedCar` helmet (`lod.ts:134`).

**Player visor** (`F1CP_MAT_Visor`).
- color (0.05, 0.06, 0.07), roughness 0.03
- iridescence 0.9, iridescenceIOR 1.75, range [300, 650]
- clearcoat 1, clearcoatRoughness 0.02
- Do not touch `transparent`, `side` or `forceSinglePass` (test). Push it into `reflectivePaint`.

### 10.7 Fabric shading for suits

- **Rivals.** In `driverMaterials()` (`driver-materials.ts:55-68`):
  - `fabric()` returns `MeshPhysicalMaterial` with sheen 1, sheenRoughness 0.55, sheenColor = base lightened 45 %.
  - Keep the shared DataTextures (test).
  - Make the suit colour per team: give `DriverRig` (`driver.ts:112-118`) a team colour and call `suit.color.set(...)`.
- **Player.** For `/^F1CP_MAT_(Suit|Glove|GloveSuede|CollarFabric|Glove_)/`: sheenColor = base × 0.6 (0x3a4452 for
  textured whites), sheenRoughness 0.5, roughness × 0.95.
- **Crew.** At `pit-crew.ts:173-177`, `grid-presentation-view.ts:180,200` and `marshal-staff.ts:104`, switch to
  MeshPhysical (sheen 0.6, sheenRoughness 0.6, sheenColor 0x8a96a0). `installCrewSkin`'s hooks also exist in the
  physical shader. Depth and distance materials stay as they are.

### 10.8 Crew and driver detail

**Team kits.**
- Colour cloth from `LIVERIES[car % 12]` at `pit-crew.ts:403-406` and `grid-presentation-view.ts:369`.
- Replace the fixed yoke colour vec3(.30,.36,.37) in `crew-suit.ts:38-39` with a per-instance secondary: either an
  `InstancedBufferAttribute crewKitSecondary` or `vColor*.35` (dark trousers and yoke).

**Crew helmets.**
- Shell tint = team primary through instance colour. The vertex-colour lens mask keeps the visor dark.
- Lens: MeshPhysical clearcoat 1, iridescence 0.6.

**Grid accessories.** Replace helmets with instanced cap and headset parts placed from `pose.joints[2]`, like the
helmet placement:
- cap: lathe crown r 0.10 m plus a 0.07 m brim
- headset: 2 cylinders r 0.04
- head: a skin-tone ellipsoid at −0.02 m

This costs about +3 draws.

**Logos.** A shader chest wordmark gated by `vCrewRegion.x` and a front mask, drawn from a shared 512×128 atlas of
original team wordmarks indexed by `crewSlot % N`.

### 10.9 Crowd variety and animation

- **Palette.** `personPalette` (`grandstand.ts:199`) → 14 colours, 50 % team colours (#C8102E, #FF8000, #1E3A8A, #F2F2F2,
  #0B6E4F, #FFD200, #111111, #E5007D) plus neutrals. Raise the cohort share 0.6 → 0.75 so team blocks read.
- **Caps.** Use `crowdAccessory` 1, with colour from a per-instance hash in `color_vertex` (`crowd.ts:169-179`):
  `vColor.rgb = mix(vColor.rgb, capColour, step(1.5,skinMask)*capFlag)`.
- **Flags.** An instanced quad batch, about 1 per 12 people, at LOD 0-1 only.
  - Reuse the cloth wave from `marshal-staff.ts` `installFlag`, with team stripes.
  - Anchor at `crowdPivot` + 0.55 y.
- **Animation.** Extend `installAudienceActions` to all stands. Today it is hero-only, because `authoredFamily` is
  undefined elsewhere (`grandstand.ts:277`). Either use `audienceGeometry(level, i%4)` everywhere, or scale the
  `crowdTurn` reaction ×1.6 when `crowdReaction.x > .3`.
- **Impostor** (`crowd-impostor.ts:61-80`). Keep the 6-index plane (test), and add:
  - a cap disc from the accessory hash
  - a raised-arm ellipse when `vSpectatorStyle.w > .82`
  - a shirt/trouser split
  - a gradient `*= .85 + .3*p.y`

### 10.10 Rival silhouette and detail

All of this goes in `car.ts` before `:529` and reuses existing materials (draw-neutral) unless stated.
- **T-camera.** `box(s, dark, 0, 0.60, -0.12, 0.075, 0.028, 0.03)` plus 2 pod rods at (±0.11, 0.58, −0.05).
  Measure the `airbox_paint` bounds first.
- **Antennae.** Nose antenna `rod(s, metal, (0,.06,1.6)→(0,.16,1.55), .002)`, plus 2 cockpit-side fins.
- **Halo.** `car.ts:215` `safety`: carbon → `this.paint`. Draw-neutral, since paint is already in `s`.
  Optional slogan decal, as in ref 003.
- **Wheel covers.** `car-assembly.ts:38` cover → `materials.paint` (+1 draw per wheel). In ReducedCar (`lod.ts:193-194`),
  cover → paint and rim → dark alloy.
- **Rims.** Split them out of `metal` (`car.ts:142-145`) as `rimMaterial` 0x2b2e31, metalness 0.75, roughness 0.38
  (anthracite forged magnesium).
- **Endplates.** A per-car canvas map (number plus wordmark) on `rear_paint` via its A61 UVs, or an object-space print.

---------------------------------------------------------------------------------------------------
## 11. Reference observations (described in words; never copy the images)

- `official_playstation/004_ps_pitstop`: crew in team-colour full-face helmets with logos; two-tone suits with leg sponsor
  text; bright yellow gloves; large yellow sidewall lettering; deep purple/yellow gloss with crisp nose highlights.
- `002_ps_screenshot_02`, `photo_mode_traxion/075`, `077`: red wheel covers; white sidewall band and letters; exposed
  twill/forged carbon sparkling under the coat; deep red clearcoat with dark horizon reflections.
- `010_ps_rain`, `review_topgear/068`: blue wet band on the outer sidewall; yellow ring painted on the cover; bright red
  LED-matrix rain light with heavy bloom; spray and wet sheen.
- `003_ps_steeringwheel`, `review_maxigeek/088`: knit/suede gloves with purple cuffs; painted halo with a slogan; many
  coloured rotary encoders on the wheel.
- `review_techradar/047`: grid mechanics in polo shirt, cap and headset; branded tyre blankets; a mechanic with a tablet.
- `official_ea_braking/020`, `review_techradar/043`: drivers in sponsor-dense suits and caps; shallow depth of field.
- `official_ea_customisation/031-033`, `photo_mode_traxion/076-080`: multi-panel gradient liveries with many wordmarks;
  numbers on nose and engine cover; coloured wheel covers.

---------------------------------------------------------------------------------------------------
## 12. Budgets and guardrails

- Rival near car: < 250 k tris at LOD0, 65 k at LOD1, 30 k at LOD2. LOD0 draws must not exceed the legacy path
  (`tests/a61-rival.test.ts:225-227`). Each new material in a merged group costs one draw per car per LOD.
- Player: tier 0 on high only. Never add geometry to the RB19 itself; add small separate meshes under `suppliedPlayer.root`.
- Crew: 180 actors in ≈ 8 instanced batches; keep additions instanced. Crowd: clusters of 64/128; flags instanced, LOD 0-1 only.
- Prefer shared atlases (tyre letters, crew wordmarks, flags) over per-car canvases. SwiftShader captures are slow: avoid
  fragment loops over 8 iterations.

---------------------------------------------------------------------------------------------------
## 13. Suggested work packages

| WP | Role | Files | Deliverable |
|---|---|---|---|
| A1 | Vehicle Materials: paint | `car.ts:131-153`, `paint-finish.ts` (+ `installPaintFlakes`), `supplied-player.ts:363-386`, `reflections.ts:121-130` | Deep glossy paint and flakes, RB19 satin with highlights, vehicle env gain |
| A2 | Vehicle FX: lamps and brakes | `supplied-player.ts:384,460-465`, `car.ts:246-255,347-356,645,742`, `manufacturing.ts:39-45`, `lod.ts:164` | Rain-light fix and bloom; blackbody brake glow on both cars |
| A3 | Vehicle Materials: tyres | `tread.frag`, `tire-finish.ts`, `tire-carcass.ts:44-49`, `car.ts:652-670` | Sidewall band and lettering; rubber tone |
| A4 | Vehicle Materials: carbon | `materials.ts:16-37`, `carbon*.frag`, new `amplifySuppliedRelief` | Visible twill under the coat on both cars |
| A5 | Vehicle Modelling: rival | `car.ts` before `:529`, `car-assembly.ts:36-43`, `lod.ts:190-199` | T-cam, antennae, painted halo and covers, anthracite rims, LED rain light |
| A6 | Livery | `car-livery.ts:23-72`, `simulation/config.ts:244-247`, new `installLiveryPattern` | Rich original liveries; saturated palette; nose and engine graphics |
| B1 | Character: driver | `car-mechanical-detail.ts:99-201`, `driver-materials.ts`, `driver.ts:112`, `lod.ts:134` | Team helmets, iridescent visors, sheen suits |
| B2 | Character: crew | `pit-crew.ts:173-206,403-406`, `crew-suit.ts`, `grid-presentation-view.ts:178-207,369`, `marshal-staff.ts` | Team kits, physical fabric, grid caps and headsets |
| B3 | Crowd | `grandstand.ts:199-227`, `crowd.ts:163-180`, `crowd-impostor.ts`, `audience-actions.ts` | Team-colour crowd, caps, flags, livelier reactions |

**Verification for every package.**
1. Run:
   `npx vitest run tests/a61-rival.test.ts tests/supplied-player.test.ts tests/race-surface-finish.test.ts tests/people.test.ts tests/character-quality.test.ts tests/cockpit-detail.test.ts tests/phase27e.test.ts tests/phase27g-presentation.test.ts tests/imported-render-budget.test.ts tests/tire-carcass.test.ts tests/crew-performance.test.ts`
2. Re-capture the baseline shots (00, 10/11, 12/13, 20/21) at medium, 1280×720.
3. Compare them against the §11 references.
