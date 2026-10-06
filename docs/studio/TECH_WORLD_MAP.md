# TECH WORLD MAP: circuit, surfaces, vegetation, terrain, venue, weather

Owner: Technical Art Lead (world/environment). Analysis only; no source changed. Colour targets come
from `ART_BIBLE_A.md` §4, 5, 9, 10 and `GAP_ANALYSIS.md` §2.8-2.19. This map says **where and how** to
implement them without breaking asset contracts. Lines refer to HEAD `3a6036d`.

Reference cues (described, never copied):
- PS007 (Imola): astroturf behind red/white kerbs, white chevrons on painted run-off, flags, 20 m
  broadleaf canopy behind the stands.
- PS010 (Spa, rain): forested misty hills, yellow/red barrier vinyl, a ~2 m rear-tyre plume, a dark
  streaky wet road.
- PSQ034 (Austria): 25 m conifers behind blue/white wall boards, multi-colour painted run-off, "50"
  boards.
- TX076 (Spa): red/yellow painted run-off, a cantilever main stand with a board band, a conifer wall.

---

## 0. Key facts and conventions

| Fact | Value | Source |
|---|---|---|
| Aurel lap | **2972.7 m** (Vellamar 3997.3 m) | `new Track()` (measured) |
| Half-width w | `8 + 0.6·sin²(2πu)`, 8.0-8.6 m | `simulation/circuits.ts:74` |
| Elevation | `1.5 sin θ + 0.65 sin 3θ` (±2.15 m); cross-fall `0.018 sin 2θ` | `circuits.ts:66-76` |
| State grid | `CELL_ROWS 512 × CELL_COLS 7`, about **5.81 × 2.3-2.5 m** per cell | `simulation/track.ts:14-15` |
| Kerb physics | `shoulder·(0.025 + 0.016 sin(2πs/0.65))`, 0.12 m shoulders, 1.1 m wide | `simulation/contact.ts:6-9` |
| Pit lane | +lateral, 22 m out, `s > L-220` or `s < 330`, no deposits | `track.ts:278-291` |
| Axes | x east, z north, y up; normal `(nx,nz) = (tz,-tx)`; `+l` = right of travel | `track.ts:142-145` |
| Corners (s, m) | NORTH HOOK 627, QUARRY 1248, ORCHARD 1545, WORKS 2012, CONCOURSE 2180 | `circuits.ts:78-84` |
| Baseline | **1103 draws, 4.45 M tris, 285 textures, 2803 geometries, 245 shadow casters** (medium, cockpit) | `shots/baseline/diag.json` |

**Physics lateral zones** (`track.ts:285-317`), measured from the centreline:

| Zone | Span |
|---|---|
| Road | `|l| ≤ w` |
| Painted edge line | `w-0.18 … w` |
| KERB | `w … w+1.1` |
| PAINT run-off | `w+1.1 … w+4` |
| GRASS, or GRAVEL where `curvature·l < -0.009` | `> w+4` |
| Wall `boundary` | `w+11`; pit side `max(w+11, pitOffset+5)` |

**UV convention.**
- Ribbons write `uv = (l/5, s/5)` (`circuit.ts:487`).
- Finishes recover metres as `vFinishMetres = uv*5` = (lateral, lap distance)
  (`circuit-finish.ts:132`). The road also has `vRoadMetres` (`materials.ts:67`). World position is
  `vFinishWorld` (`circuit-finish.ts:141-146`).
- `s` wraps 2972.7 → 0 at the start line. Along-track periods that do not divide the lap show a seam.
- `trackUV = (clamp(l/w·.5+.5), s/L)` samples the state texture (`circuit.ts:488`); off-road ribbons
  clamp to 0 or 1.

---

## 1. Construction pipeline (`src/rendering/circuit.ts`)

**Groups.** `CircuitScene` (68-380) owns `StaticTransformGroup`s `props` (venue, batched), `surfaces`
(ribbons, terrain, barriers; not batched) and `vegetationGroup`, plus a plain `crowd` group. Work runs
cooperatively on `BuildQueue` by priority 0-7 (`renderer.ts:536`).

**Build order** (p = priority):

| p | Steps (lines) |
|---|---|
| 0 | road and kerb ribbons (`queueRibbon` 431-452); grid and finish markings (338) |
| 1 | tyre marks (329) |
| 2 | other ribbons; 80 m barrier chunks (286-305); garages (595-716); service areas (318) |
| 3 | terrain (252-285); stands; infrastructure (307); districts (324); foliage (330-337) |
| 4 | `batchScene(props)` (339-360) |
| 6 | seal (361-377) |
| 7 | probe survey (378) |

**Kits.** `renderer.ts:477-534` loads A01-A10, A51-A54 (vegetation) and A55-A60 (quarry) before
construction, **for Aurel only**. Vellamar uses fallbacks: `circuit-barriers.ts`
(`barrierGeometry`, `catchFenceMaterial`, beam posts), `landscape.ts buildVegetation` and
`grandstand.ts` decks. Every upgrade must cover both circuits, or gate on `track.circuit.id`.

**Per-frame hooks** (`renderer.ts`):

| Hook | Line |
|---|---|
| kit LOD `update(camera, quality)` | 1097-1108 |
| `circuit.update(b)` | 1156 |
| `weatherPresentation.update` | 1159 |
| crowd | 1165-1174 |
| effects | 1175 |
| wet reflection | 1274-1280 |

**Wet-reflection layer 5** (`wet-reflection.ts:4`).
- Opted in: terrain and sea (`circuit.ts:279-283`), barriers (304, 371), all `props`
  (`renderer.ts:544`), cars (579), lights (331).
- **Not reflected: vegetation, road ribbons, crowd.**

---

## 2. Circuit mesh: the ribbon table

`ribbon()` (`circuit.ts:453-535`):
- indexed grid in pieces of 80 m or less; vertex = `track.at(s) + n·l`
- `y = p.y + bank·clamp(l,±12) + height()`; lateral-ordered winding; `computeVertexNormals`
- casts no shadow (512); strips up to 1.5 m wide recorded for the probe survey (533)

| Ribbon | Lines | Lateral span | Height | step / cols | Material |
|---|---|---|---|---|---|
| Grass apron | 155-162 | 9 knots `±(w+38), ±(boundary+1), ±12, ±w, 0` | `grassApronOffset`: -0.04, then -4.5 cm/m beyond the wall | 2 / 8 | `surfaceMaterial('grass')` |
| Gravel | 163-174 | `±(w+10)`, cells kept where `|l|>w+4` and `curv·l<-0.009` | -0.027 | 2 / 12 | `'gravel'`, no finish |
| Run-off | 175-182 | `±(w+4)`, visible w+1.1…w+4 | -0.008 | 2 / 4 | asphalt + 'paint', `color 0x8aa58d` |
| **Road** | 183-191 | `±w` | 0 | **1.8 / 14** | `roadMaterial` (Physical + wet) |
| Kerbs ×2 | 196-211 | `side·(w + t·1.1)` | `kerbHeight(s, t·1.1)`, 0 at pit mouth | **0.16 / 6** | Standard `{vertexColors, r.85}` + 'kerb' |
| Edge lines ×2 | 212-219 | `side·(w-.17 … w-.03)` | +0.006 | 2 / 1 | `0xf1eee0` r.75 + 'paint' |
| Pit road / lines | 222-249 | `pitOffset ± 3.6`; lines ±3.35…3.47 | +0.003 / +0.008 | 1 / 4 | asphalt + wet (no deposits) / white |

**Markings.**
- Kerb colour: per-vertex `0xdc553b`/`0xe8e3cf` by `floor(s/3)%2`, so **3 m stripes** with 0.16 m
  blended edges (`circuit.ts:489`).
- Grid boxes `MeshBasicMaterial 0xece9de` (717-729); chequer from a 128×32 canvas (730-744); garage
  marks `0xe7c969` (630-632).

**Gaps.**
- Visual gravel stops at `w+10`, but physics says GRAVEL to the wall on the corner outside. That band
  looks like grass and drives like gravel.
- The apron edge (`w+38`, about road y-1.2 m) can float **0.8-4.8 m above** Aurel's -4 m terrain datum
  (inside 680 m; `terrain-profile.ts:57`). Only the quarry has a skirt (`aurel-quarry.ts:119-170`).

---

## 3. Surface materials (dry)

**Texel generator** (`surface-detail.ts`).
- `palette` (9-14): asphalt `[79,81,83]`, grass `[89,101,53]`, gravel `[150,138,114]`, concrete
  `[172,172,162]`.
- `surfacePixels(kind, 512, 1887)` (18-74) builds CPU albedo, height and roughness. Asphalt uses
  `AsphaltAggregate` (64×64 fractured stones per tile). Roughness bytes: asphalt 188-229, others
  224-248.
- `surfaceMaterial` (75-124):
  - **512² canvases** (80)
  - tiles asphalt **0.64 m**, grass 2.5 m, gravel 0.9 m, concrete 3 m (82); repeat `5/metres`
  - maps: `map`, a **`bumpMap`** (no normal map), `roughnessMap`
  - `bumpScale` asphalt **0.00045** (flat), gravel 0.009, others 0.002 (107)
  - water-film kinds are `MeshPhysicalMaterial{clearcoat 1, ccRough .1, ior 1.333}` (111-118)
  - gravel gets **no finish** (121-122)
- `surfacePixels` re-runs on every call: 3× asphalt, 2× grass. Memoise before going to 1024².
- **TextureBudget** (`texture-budget.ts:61-90`) resamples every registered `CanvasTexture` to
  `textureSize`: low 256 / med 512 / high 1024 (`options.ts:31`). Opt-out is `userData.dynamic`.

**World-space finishes** (`circuit-finish.ts`).
- `installCircuitFinish(material, kind)` (116-158) composes with earlier hooks and runs after
  `map_fragment`. Helpers `finishFilteredNoise` and `finishLine` (17-36).
- Cache key at 155-156. **Bump it on every GLSL change.**

| Kind | Lines | Now |
|---|---|---|
| asphalt | 38-48 | ×(.8+.2·noise(.11/m)+.07·noise(1.7/m)); repairs ×.86; paving joints every 3.6 m lateral at -17% |
| grass | 49-72 | **green push ×(.79,1.066,.8)**; dry/moist regions; patches; **9 m mown bands**, faded by 26-38 m |
| terrain | 73-89 | dry high ground 14-95 m; scrub on slope >.12; **rock** on slope >.34 or at 150-240 m; stone `(.19,.18,.16)-(.31,.29,.25)` |
| concrete | 90-98 | grain, streaks, damp foot, form ties every 1.9 m |
| paint | 99-103 | grit 24/m, wear .72/m |
| kerb | 104-112 | chips (noise 33/m >.65) toward `(.19,.18,.16)`; joints every 3 m |

**Road-only layers.**
- `road-macro.ts` (`ROAD_MACRO` 6-28): 37 m cells, 22% chance of a 3-16 m patch, 35% full-width,
  fresh ×.82 / faded ×1.07, 5 cm seams at -35%. GLSL at 86-121, applied by `ROAD_MACRO_APPLY` (124)
  right after `map_fragment`.
- `src/shaders/wetRoad.frag:1-21`, `trackState` R = water mm/2, G = rubber, B = marbles:
  - `diffuse *= mix(1,.58,wet)·(1-rubber·.25)`
  - seeded rubber `.035 + .415·gauss(fromLine/1.8)` (`track.ts:223-224`), so **≤11% darkening at
    2.4 m resolution**: invisible
  - marbles are hashed flecks
- `tyre-marks.ts`:
  - zones from a racing-line speed profile; `TYRE_MARKS` (14-32): 0.3 m wide, 6 mm lift, 4-16 marks
    per zone, alpha ≤.62
  - material (189-255): `0x0c0c0d` r.72, 64×256 alpha canvas, transparent, polygon offset, role
    `paint`

---

## 4. Wet weather, rain, spray

**Water source.**
- Physics `track.water` (mm/cell) updates every 0.5 s from rain, drainage, evaporation and a
  depression pattern `.65+.35 sin²(.113r+.4c)` (`track.ts:341-360`).
- The rain preset starts at 0.7-1.05 mm (217). Cars remove `|v|·.00025·dt`, **so a physical dry line
  emerges** (379).
- `updateSurface` (`circuit.ts:558-576`) writes a 512×7 RGBA8 DataTexture.

**Road film** (`materials.ts installWetRoad` 42-177):

| Term | Value | Line |
|---|---|---|
| wet | `smoothstep(0,.65,mm)` | `wetRoad.frag:6` |
| puddle | `smoothstep(.65,1.5,mm)` | `wetRoad.frag:7` |
| roughness | `mix(r, mix(.48,.095,puddle), wet)` | 84 |
| normal flattening | `wet·mix(.35,.9,puddle)` | 92 |
| ripple | sinusoid × `puddle·min(1,rain/18)·.009`, time `roadWeather.y` | 96-104 |
| clearcoat | `wet·mix(.58,1,puddle)`, F0 0.02 | 124-127 |
| clearcoat roughness | `mix(.26, mix(.22,.055,puddle), wet) + rain·puddle·.045`, then variance AA | 128-140 |
| lamp lobe | | 143-166 |
| planar injection | | 169-173 |
| cache key | | 175-176 |

**Puddles are 2.4 × 5.8 m blobs with no sub-cell shape. The ripple is not drop rings.**

**Planar reflection** (`wet-reflection.ts`).
- Scale low 0 / **med .35 / high .5**, HalfFloat with mips, `planeFade` .4-2.5 m, `maxLod` 5 (15-22).
- Mirrored about the road plane under the followed car, with an oblique near plane (79-154).
- The GLSL (168-187) applies a tilt offset ×.06, edge fade and one `textureLod` at `sqrt(ccRough)·5`.
  It is **not vertically streaked**; F1 25 shows 3-5× streaks.

**Other surfaces** (`weather-presentation.ts`).
- Role `[darkening, wetRoughness]` (19-31): grass .16/.78, paint .10/.32, kerb .12/.34, foliage .10/.56.
- `surfaceDampness = max(smooth(0,18,rain), smooth(0,.6,meanWater))` (50-53). The shader (122-196)
  darkens up-facing surfaces and lowers roughness. **No off-track puddles.**
- `update()` (202-218) is **the only material path that sees `H.WIND_X/Z` and `H.TIME`**: surface
  `(damp, time, rain, meanWater)`, road `(rain, time, windX, windZ)`. Put a shared wind uniform here.

**Particles** (`effects.ts`).
- `EFFECT_CAPACITY {contact 3600, rain 600}` (13, test-pinned). Spray colour `(.65,.73,.73)` (22-29).
- Spray emission (369-377): `min(180, speed·water·2.5·tread·load) × (front .5 | rear 1.5)` births/s
  per wheel when `water>.04` and `speed>5`. 30% of rear births are the diffuser plume (20).
- Births (400-428): plume at `(±.18,-.12,-2.35)` with vy 2.2-3.5; tyres at `(±.83,-.37,+1.82/-1.62)`
  with vy 1.15-2.55. Velocity `carV·.16 + wake·speed·.2 + wind·.84`.
- Puffs (232-235, 476-478): life 1.1-1.9 s; size .30-.45 m growing **+1.6 m/s**; gravity -.35;
  alpha `min(1,age/.08)·rem^.75·.36` (**peak .36**).
- `spray-clouds.ts`: one instanced draw of metre-sized quads stretched along screen motion up to 2.1×;
  filament noise (153-170); alpha `1-exp(-d·op·1.25)` (173). It fades only against the **birth ground
  plane** (`vGround`, 123): **no soft particles**. Lit by `precipitationLighting`, with rear lights
  tinting red (134-142).
- Rain: up to 600 streaks in a 40×14×40 m box around car 0, spawned at `rain·40·density`/s, life
  .45-.67 s, vy -15 (`effects.ts:432-450`). Quads: half-length 1-24 px, half-width .55-1.6 px
  (`rain-streaks.ts:74-87`).
- `particleDensity` low 0 / med .65 / high 1. **No lens or screen droplets exist.**

---

## 5. Vegetation

**Aurel: the A51-A54 kit** (`aurel-vegetation.ts`, `aurel-vegetation-plan.ts`).
- **Asset**: `public/models/aurel-vegetation.glb`, 914 188 B, sha `a06edbb2…`. Tris LOD0/1/2:

  | Variant family | Tris |
  |---|---|
  | broadleaf young/mature | 1484 / 498 / 80 |
  | columnar | 1332 / 454 / 72 |
  | orchard | 1180 / 410 / 64 |

  Materials: BARK, and LEAVES (MASK .45, double-sided). Images: 256², 256², **1024² leaf atlas**.
- **Validation**: `vegetationDocument` (33-87) checks bytes, header, counts, hierarchy and exact
  triangles. `decodeAurelVegetation` (510-529) checks the **SHA-256**. Crown `bounds` are checked
  (273-280).
- **Packing**: each young/mature pair shares one geometry with LOD index ranges.
  `installTreeVariants` (111-155) selects by per-instance `treeVariant` on the colour, depth **and**
  distance materials, which must stay identical.
- **Plan** (`-plan.ts:123-175`): near **≤650**, including 2 orchards of 3×11 at s 640/830 (21-24);
  groves **≤900**; treeline R 760/830 m. Clearance (50-77): `boundary + 14` (near) or `+60`
  (grove/treeline), plus crown radius.
- **Instancing**: buckets of 160/240/700 m per family (354-361), one `InstancedMesh` per bucket ×
  part. Colour `.87+(seed%17)/100` (409-419). Shadows cast by near and orchard only (396).
- **LOD**: `VEGETATION_LOD {near 55, middle 190, hyst .14}` (23), ×.86 med, ×.68 low (90-101). Shadow
  LOD via `onBeforeShadow` (424-427). Groves LOD ≥1; treeline always LOD2.
- **Density and far shadow**: `vegetationDensity` sets `count = fullCount·density`
  (`renderer.ts:1355-1360`). FarShadow bakes **every non-casting vegetation InstancedMesh**
  (1361-1368). A new layer in `vegetationGroup` with `castShadow=false` and `userData.fullCount` joins
  automatically.
- **Missing**: **no wind**; no translucency (`canopy-normals.ts` only undoes the double-side flip);
  conifers ≤14 m; no forest walls (trees ≥7 m apart, 43-198 m out).

**Fallback, used on Vellamar** (`landscape.ts`).
- `vegetationPlan` (43-114): 650 trees, 6-13 m. `grovePlan` (126-219): clumps of 7-20 at 90-520 m,
  28% conifer, plus a treeline.
- `foliageAtlas()` (467-489): **procedural 1024² canvas**, 4 crowns, baked sky gradient.
- `treeGeometry()` (629-716): 3 silhouette + 12 clump cards + trunk; the distant version is 3 cards.
- `installFoliageAtlas` (541-600) shapes crowns in GLSL (500-536).
- Material: alphaTest .45, DoubleSide, roughness 1; bark `0x655e49` (741-766).

**Foliage mips.** `foliage-mipmaps.ts` preserves alpha coverage through the mip chain, triggered by
`texture.userData.foliageAlphaCutoff` (`aurel-vegetation.ts:227`). Reuse it for every new alpha atlas.

---

## 6. Terrain, mountains, sea

- **Mesh** (`circuit.ts:252-285`): `PlaneGeometry(5500, 5500, 160|256)`, so **34 m cells on Aurel**
  and 21 m on the coast. UV is world `x/5, z/5` (the 2.5 m grass texel across 5.5 km). Material
  `surfaceMaterial('grass','terrain')`, one draw.
- **Aurel height** (`terrain-profile.ts:50-66`): -4 m datum inside 680 m; sine foothills; 7 m
  value-noise undulation; ridged range (`ridgedNoise` 24-43, 5 octaves) from 1.15 km to crests of
  about 260 m.
- **Vellamar**: `vellamarNatural` plus a `TrackDistanceField` blend (`terrain.ts:22-78`;
  `track-field.ts`, 20 m cells, 420 m reach). Sea: Physical plane with wave normals (`sea.ts:42-62`).
  Shoreline in the terrain shader (69-96).
- **Quarry A55-A60** (`aurel-quarry.ts`, 1.53 MB, sha `af95d1d0…`): 11 variants (cliff-bench, talus,
  boulder, shrub, hedge, tussock, ridge, …), 12 stations at s 1160-1424, `quarryLod` (99), skirt
  (119-170).
- **Today** (13-pod, 20-driving-a): smooth olive faceted hills, a treeless horizon, beige quarry
  polygons. Target: forested ridges in blue haze.

---

## 7. Stands, crowd, barriers, boards

**Stands** (`venue-plan.ts:51-60`): s -72 (64 m), 55 (80 m), and 450/780/1220/1670/2210/2600 (48 m).
- Aurel stands are all authored. Hero `StartFinishVenue.accepts` takes -72 and 55
  (`start-finish-venue.ts:93`). A12 takes the rest (manifest "sites"). Geometry comes from
  SHA-pinned `secondary-grandstands.geometry.json` and `start-finish.geometry.json`.
- The procedural deck (`grandstand.ts:108-182`: 8 rows, .98 m deep, .49 m rise) is Vellamar only.
- Seats: .65 m pitch, palette `0xa33c35 0x8b3431 0xe0dcd0 0x394e53` (198).
- Crowd: occupancy .56-.91, palette `0x535b5c 0xc7b69b 0x323f51 0xab4030 0x3f665a 0x88867d` (199).
- Fascia: `label('A U R E L / GRAND CIRCUIT')` (67-73; reused for A12 at 105).

**Crowd.** Meshes from `aurel-people.geometry.json`, spectator tris pinned at 2296/1328/638.
- Rank LOD hand-off at 92-108 / 218-242 / 420-480 m (`crowdLodRanges`).
- SDF impostor card beyond that (`crowd-impostor.ts:5-90`).
- Chunks of 128 people (64 at hero stands).

**Barriers** (`circuit-barriers.ts:87-223`): 80 m chunks, 3.8 m modules.
- Procedural profile (18-29): ±.275 m base, ±.17 m above .55 m, .94 m tall, centred on `boundary`.
- On Aurel, A01 replaces it (`concrete-barriers.ts:109-160`): **one shared material**, envelope
  |x|≤.275, y≤.94, z≤3.8.
- Skipped spans: `guardrailRole`, `impactBarrierRole`, gate role (118-123).

**Fence.** Always the analytic `catchFenceMaterial` (`circuit-finish.ts:183-224`).
- Diamond pitch **.09 m**, wire coverage 3.2%; `0x77807e`, metalness .5, roughness .67; transparent,
  single pass.
- Geometry: .96 → 3.4 m at outward .23, leaning to 3.8 m at -.17 (`circuit-barriers.ts:145-168`).
- A03 supplies only the posts.

**Boards and signs.**
- A09 braking boards 50/100/150 at `l=-18` (`track-board-plan.ts:40-79`).
- Face art is injectable: `makeLabel` in the `TrackBoardsKit` constructor (`track-boards.ts:113-120`)
  and `decodeTrackBoards(bytes, loader, makeLabel)` (258-277). `loadTrackBoards` (279) lacks the
  parameter; add a pass-through.
- Venue signs: 4 per circuit (`venue-plan.ts:83-88`) via `CircuitScene.sign()`
  (`circuit.ts:581-594`). Gantry banner (683-693). Garage panels (614-622).
- **There is no sponsor, advert or hoarding system.**

**Venue finish.** `installVenueFinish` (`venue-materials.ts:9-98`) draws metric joints. Glass
`0x3e6267` r.17 is opaque (102-138).

---

## 8. Asset contracts

- **Runtime kits.** Each `public/models/*.glb` (24 files) has a `src/rendering/<kit>.manifest.json`:
  `url`, `bytes`, `sha256`, and usually `author`, `sourceSHA256`, `editable`, `editableSHA256`, per-LOD
  `triangles`/`draws`, `bounds` and `sockets`. Loaders stream into a fixed buffer, check SHA-256 via
  `crypto.subtle`, parse the JSON chunk and reject count changes (example
  `aurel-vegetation.ts:510-579`).
- **Exchange copies.** `src/rendering/*.glb.gz` plus `*.geometry.json` (people, start-finish, crew,
  grid-mechanic, event-hall, A12). Tests hash both (`people.test.ts:80-84`,
  `start-finish.test.ts:48-52`, `secondary-grandstand-assets.test.ts:41`).
- **Blender is not installed.** `scripts/author-*.py` and the `.blend` files cannot be re-run, and kit
  tests hash them (`aurel-vegetation.test.ts:41-43`).

**Rule: never edit GLBs or manifests.** Improve kits through runtime `onBeforeCompile` hooks on
`part.material` (with a cache-key suffix), per-instance attributes added after load, and new
procedural TypeScript layers.

---

## 9. Extension points

Targets are in ART_BIBLE_A §4/5/9/10; file:line is the hook.

### 9.1 Asphalt: aggregate, rubbered line, patches, sheen

1. **Tone in the shader, not the palette.** `race-surface-atmosphere.test.ts:102-125` pins
   grass/gravel/concrete bytes and requires asphalt R in (50,120).
   - In `circuit-finish.ts:38-48`, change `.8+broad*.2` to `.92+broad*.08` and multiply by about
     `vec3(1.30,1.25,1.18)`. That gives ≈#686460 with no blue bias.
   - Bump the key (155).
2. **Normal map.** Sobel the height bytes in `surfaceMaterial` (`surface-detail.ts:96-108`), strength
   ≈2.5, `normalScale` .6-.9, `NoColorSpace`. Ribbons have no tangents, so r180 uses derivative TBN;
   keep the degenerate guards (`installStableSurfaceBump`, `materials.ts:183-220`).
3. **Meso layer.**
   - Add a 4.5 m second tile (new seed), sampled with `vRoadMetres/4.5`.
   - Fade the .64 m micro tile to its mean over 15-40 m (`finishDetailWeight`,
     `circuit-finish.ts:8-12`).
4. **Racing line.**
   - In `ribbon()` (`circuit.ts:479-492`), for `options.road` only, add
     `apexLine = vec2(l - racingLineFor(track).offsetAt(s), brakingWeight(s))`. Sources:
     `racing-line.ts:25`, `tyreMarkZones` (`tyre-marks.ts:43`).
   - The offset is constant per row, so this gives an exact per-pixel line distance with no texture.
   - Shader:
     `line=exp(-.5*pow(apexLine.x/.85,2.)); diffuse*=1.-(.42+.18*apexLine.y)*line*smoothstep(0.,.3,roadState.g); roughness-=.12*line;`
   - Physics `roadState.g` stays the amplitude (`circuit-finish.ts:14-16`).
   - Tests build ribbons from `Object.create(CircuitScene.prototype)` with only
     `{track, group, surfaces}` (`rendering.test.ts:8-24`, `reference-rendering.test.ts:156-175`), so
     compute lazily from `this.track`.
5. **Tar snakes and cracks.** Add noise iso-line sealant to `apexRoadMacro` (`road-macro.ts:86-121`):
   1-2 cm, `#2a2927`, roughness .45. **Keep `ROAD_MACRO` constants, asserted substrings and hook
   order** (`road-macro.test.ts:16-59`).
6. **Glints.** A sparse aggregate glint within 6 m, using stone coverage from a spare roughness-map
   channel.
7. **New uniforms.** Put them in a separate `installRoadDetail()` composed at `circuit.ts:143-150`.
   `circuit-detail.test.ts:126-131` pins the `installWetRoad` uniform keys
   `['roadWeather','trackState','surfaceDeposits','roadLampRadius']`.

### 9.2 Kerbs: stripes, profile, wear

- **Stripes.** In the kerb finish (`circuit-finish.ts:104-112`), use
  `apexStripeCoverage(vFinishMetres.y/2.2, fwidth(..), .25)`: 1.1 m per colour, anti-aliased.
  Red #c4222a, white #ecebe6. Ignore the 3 m vertex colours (`circuit.ts:489`).
- **Styles.** Add `kerbStyles` s-ranges (red/white, blue/white, yellow/green) to `venue-plan.ts`,
  passed as a vertex float from `ribbon()` when `options.stripes`.
- **Ridges by normal.** Leave `kerbHeight` and the contact mesh alone.
  - Add attribute `kerbAcross = t·1.1`.
  - Perturb the normal with `dh/ds = .016·2π/.65·cos(2πs/.65)` across the .12-.98 m band.
  - Optional: `step` .16 → .108 (+48% kerb vertices).
- **Wear.**
  - Paint roughness .5 fresh, .85 worn.
  - Rubber `#2a2a2a` on the track-side 30%, weighted by usage `exp(-((w-|offset(s)|)/1.2)²)`
    (vertex attribute).
  - More chips where usage is high.

### 9.3 Grass, gravel, astroturf, painted run-off

- **Grass.** Change `circuit-finish.ts:52` from `×(.79,1.066,.8)` to `×(1.04,1.0,.86)` (≈#6c7438).
  Texel bytes stay legacy.
- **`edgeMetres` attribute.** Add `|l| - p.width` (one float) in `ribbon()`. Shaders cannot know
  `w(s)` otherwise.
- **Run-off band** (w+1.1…w+4; physics PAINT, grip .93).
  - New `'runoff'` finish on the ribbon at `circuit.ts:152-153, 175-182`; drop the `0x8aa58d` tint.
  - Per-corner styles: astroturf #3f9a55 (fibre noise, roughness .75), or painted bands of
    1.5-2 m in red #b33a32 / blue #2e57a8 / green #3b8a50 / yellow #d9b23a over #6f6c68, with white
    chevrons.
- **Gravel finish** (none today, `surface-detail.ts:121`).
  - #b9a98a, Voronoi pebbles at 40-60 cells/m with cavity darkening, furrows every .3 m along s.
  - Optional parallax within 15 m.
  - Map the weather role at `circuit-finish.ts:117-118`.
  - Fix the w+10-vs-wall mismatch (section 2).
- **Seams.** A .3-.4 m worn-soil strip at `edgeMetres ≈ 1.1` and `≈ 4`.

### 9.4 Terrain texturing

- **Track distance.** Build `TrackDistanceField(track)` for Aurel too (today Vellamar only,
  `terrain.ts:56`). Write per-vertex `trackDistance` at `circuit.ts:261-268`.
- **Canopy carpet.** In the terrain finish (`circuit-finish.ts:73-89`), where `trackDistance > 350`
  and slope < .6:
  - albedo #2f3d2c-#3f4b3e
  - 6-14 m crown-bump noise with a fake gradient normal, dark crevices, a ragged edge
- **Rock and meadows.** Triplanar strata rock #8a8378 on slope >.55; drier south-facing meadows.
- **Resolution.** Aurel segments 160 → 320 (`circuit.ts:256`): 103k verts, one draw. Optional ±4 m
  canopy displacement.
- **Anti-tiling.** Scale the terrain UV by .25 (set at 267) and blend in a rotated second sample.
- **Lap-wide skirt.** Generalise `quarrySkirtGeometry` so the `w+38` apron edge blends to terrain over
  12 m.

### 9.5 Tree canopies and forest mass

- **Keep the A51-A54 GLB and plan caps.** `aurel-vegetation.test.ts` pins: near ≤650 and grove ≤900
  (142-143), treeline count (144), total >1800 (147), chunk meshes between 50 and 440 (213-214),
  determinism (137-138).
- **New `src/rendering/forest-belts.ts`.**
  - Clustered Poisson belts 30-120 m behind `boundary`.
  - Exclusions: `plantingClearance` (`aurel-vegetation-plan.ts:50-77`, grove semantics), quarry
    `blocksPlanting`, gate `blocksVegetation` (as composed at `circuit.ts:331-333`).
  - 6-12k trees, 15-28 m tall, 40% conifer.
  - Geometry: `treeGeometry().distantLeafGeometry` with `installFoliageAtlas`, or a new 2048² atlas.
  - In `vegetationGroup` with `castShadow=false` and `userData.fullCount`. Buckets of 240-700 m
    (about 30 draws).
- **Canopy shading.** Hook the Aurel leaf material (`aurel-vegetation.ts:216-230`) and
  `installFoliageAtlas`:
  - translucency `sun·pow(sat(dot(-V,L)),4)·.35·(1-ao)`
  - crown AO .55 inside, 1.0 at the rim
  - albedo toward #3f4b3e (instance colour, 409-419)
  - `alphaToCoverage` with MSAA
- **Wind.**
  - `WORLD_WIND = {value: Vector4(windX, windZ, simTime, gust)}`, written in
    `WeatherPresentation.update` (`weather-presentation.ts:202-218`) from `H.WIND_X/Z, H.TIME`.
    **Sim time only, never a wall clock.**
  - Sway after `begin_vertex`: trunk `.015·h²·sin(.6t+φ)`, flutter 2 cm at 3 Hz, `φ` from
    `instanceMatrix[3].xz`.
  - Apply the **same code** in `installTreeVariants` (colour, depth, distance; 111-155) and in
    `installFoliageAtlas`, or shadows detach. Pad the bounding boxes (`landscape.ts:708-714`).

### 9.6 Grass blades near the track

- **New `src/rendering/near-grass.ts`.** One `InstancedMesh` of 3-card tufts (.10-.18 m) with an alpha
  atlas run through `foliageMipmaps`.
- **Placement.** A camera-following 64 m tile. When the camera moves more than 8 m, rebuild 4-6k
  matrices on the CPU:
  - `track.nearest(x,z)`
  - keep `w+4 < |l| < boundary-.4`; drop gravel (`curv·l < -.009`)
  - `y = p.y + bank·clamp(l,±12) + grassApronOffset(track,s,l)` (`ground-profile.ts:9-16`)
- **Fade** 12 → 35 m by stable rank dither (`crowdLodRanges` pattern). Sway from `WORLD_WIND`.
  Medium and High only. Receives shadows, casts none.
- **Attach to `circuit.group`**, not `props`/`surfaces`/`vegetationGroup`: those are sealed
  (`static-transform-group.ts`), and `batchScene` strips custom attributes from `props`. Update next
  to `renderer.ts:1107`.

### 9.7 Billboards and sponsor art (fictional brands only)

**New `src/rendering/trackside-branding.ts`**, a construction step at p3 (before the seal at p6).
- **Barrier vinyl.**
  - A ribbon per 80 m chunk at `side·(boundary-.285)` (5 mm proud of the base), y .02-.92, UV
    `(s/boardLength, v)` into the atlas.
  - Skip guardrail, impact and gate spans (`circuit-barriers.ts:118-123`).
  - In `surfaces`; `castShadow=false`; `reflectInWetRoad`; weather role `'paint'`.
- **Hoardings.** 1.0-1.2 m on posts at outward ≥.5 m (A03 posts are at .23). One sponsor per
  80-150 m.
- **Atlas.**
  - Wordmarks: VOLTEX, NORDFIN, KESTREL TIME, HALCYON AIR, ORBITEL, MERIDIAN OIL, AUREL BANK.
  - Draw with canvas paths, not `label()` Arial (`geometry.ts:137-147`).
  - TextureBudget caps canvases at **512 px on Medium**: use 512×128 panels, or set
    `userData.dynamic=true` and state the memory cost.
  - 10% LED boards (emissive 2.5), scrolled by sim time.
- **Restyle existing hooks.** A09 `makeLabel` (section 7); signs `circuit.ts:581-594`; gantry banner
  683-693; fascia `grandstand.ts:67-73`; run-off logos as `'runoff'` decals every 200-300 m; roof flags
  as instanced quads with `WORLD_WIND`.

### 9.8 Wet puddles and reflections

- **Sub-cell puddles**, after `wetRoad.frag:7`:
  ```glsl
  float pn = apexRoadNoise(vRoadMetres*vec2(.45,.18))*.65 + apexRoadNoise(vRoadMetres*1.7)*.35;
  puddle = smoothstep(1.-puddle-.12, 1.-puddle+.12, pn) * step(.001, puddle);
  ```
  Bias toward the edges (`|trackUV.x-.5|`) and away from `apexLine`. Everything downstream
  (`materials.ts:84, 92, 112, 124, 128-131`) inherits it. Physics mm is untouched.
- **Dry line.** `wet *= mix(1., .55, line·smoothstep(.2,.65,mm)·(1.-puddle))`.
- **Drop rings.** Replace the sinusoid (`materials.ts:96-104`) with cellular rings: .25 m cells,
  radius `fract(t·2+hash)·.12` m, density ∝ `roadWeather.x/60`, time `roadWeather.y`, keeping the
  derivative fade.
- **Streaks.** In `WET_REFLECTION_GLSL` (`wet-reflection.ts:168-187`), take 5-7 Gaussian taps along
  screen-vertical at `±k·(.004+.03·ccRough)`. `wet-reflection.test.ts:107` reads
  `WET_REFLECTION.scale.medium`.
- **Reflect the forest.** `reflectInWetRoad` on treeline, grove and belt chunks (LOD2, cheap).
- **Off-track.** A world-noise puddle mask for the grass, gravel and paving roles in
  `WeatherPresentation` (presentation only).

### 9.9 Spray plumes

- **Keep** `EFFECT_CAPACITY` (`spray-lighting.test.ts:37`) and the **birth-rate maths**
  (`wet-presentation.test.ts:58-65,175` pins 17280 spray and 8000 rain spawns).
- **Rooster tail**, plume births (`effects.ts:402-426`):

  | Parameter | Now | Target |
  |---|---|---|
  | vy | 2.2-3.5 | 3.0-4.5 |
  | rear offset | -2.35 | -2.6 |
  | size (`spawn` 232-235) | .30-.45 | .55-.8 |
  | growth (478) | 1.6 m/s | 2.6 m/s |
  | life | 1.1-1.9 s | 1.6-2.6 s |
  | peak alpha | .36 | .5, decaying with age² |

- **Hanging mist.** Use the slot `variation` to draw ~25% of older puffs ×2.5 size at ×.35 alpha
  (`spray-clouds.ts:103-118`). Birth counts are unchanged.
- **Soft particles.** `ScenePass` (`scene-ambient-pass.ts:188-209`) renders the scene, transparents
  included, into the target that owns the `DepthTexture`. Sampling it from spray is a feedback loop,
  so it needs a depth copy after the opaques. Coordinate with the TECH_RENDER_MAP owner.
- **Colour.** Lit #d6dadb, shadow #9aa3a6, as a sun-direction gradient in the fragment shader
  (`spray-clouds.ts:144-179`).
- **Rain.** Keep 600 streaks at 3-8% opacity. Lens droplets belong to post-FX (render owner).

---

## 10. Hazards checklist

1. **Hash-pinned assets.** `public/models/*.glb`, `src/rendering/*.glb.gz`, `*.geometry.json`,
   `scripts/author-*.py`, `scripts/*.blend` (section 8). Never edit, re-export or "fix" a hash. A
   runtime mismatch throws inside the sequential awaits (`renderer.ts:477-534`) and aborts world
   construction.
2. **Pinned strings and keys.**
   - `circuit-detail.test.ts:110-135`: uniform keys; exactly one `varying vec3 vFinishWorld;`.
   - `road-macro.test.ts:43-59`: substrings and hook order.
   - wet-presentation and spray-lighting tests: pools and counts.
   - Always append to `customProgramCacheKey`.
3. **Pinned bytes.** `race-surface-atmosphere.test.ts:102-125`. Change looks in finish shaders.
4. **Vegetation caps.** `aurel-vegetation.test.ts:137-147, 213-214`. New layers go in new modules.
5. **Render budgets.** `scripts/infrastructure-render-budget.ts` with
   `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`:
   - day 2345 calls / 10.74 M tris (composer 812)
   - **2% tolerance**; **1800-call ceiling** for the direct scene and the composer
   - e2e specs: `56-track-infrastructure`, `57-trackside-operations`, `aurel-quarry`,
     `aurel-vegetation`
   - Prefer few, large instanced draws. An intentional overrun needs the baseline regenerated in the
     same commit with a rationale.
6. **Batching strips attributes.** `batchScene` (`geometry.ts:171-243`) keeps only position, normal
   and uv on `props` meshes. Use `surfaces`, an `InstancedMesh`, or the preserve set
   (`circuit.ts:342-357`).
7. **Sealed groups at p6** (361-377). Moving transforms go in `circuit.group`. Vertex animation is fine
   anywhere.
8. **Shadow parity.** Alpha or animated foliage needs identical `customDepthMaterial` and
   `customDistanceMaterial` hooks (`aurel-vegetation.ts:231-243`, `landscape.ts:750-762`).
9. **Determinism.** Use `H.TIME` / `roadWeather.y`, never `performance.now()`. Replays must re-render
   identical frames.
10. **Physics/visual agreement.** Do not change `kerbHeight`, `grassApronOffset`, `boundary`, the
    `SURFACE` zones or drivable ribbon heights. `circuit-detail`, `contact`, `aurel-drain-datum` and
    `rendering` tests compare them. Relief goes in normals.
11. **Vellamar parity.** Fallbacks must still build (`circuits.test.ts`; `landform-groves.test.ts`
    imports `grovePlan` and `vegetationPlan`).
12. **Texture budget.** Canvases are resampled to 256/512/1024. Set `name`, colour space (sRGB albedo,
    NoColorSpace data) and wrapping. Detail DataTextures may use `userData.surfaceDetail=true`.
13. **Startup CPU.** `BuildQueue` runs on the main thread, and 1024² per-texel JS loops cost .1-.5 s.
    Memoise, and generate atlases in queue steps.
14. **SwiftShader captures** take ~9 s/frame (`diag.json`). Judge cost by draws and triangles, not fps.

---

## 11. Work packages (file ownership)

| WP | Files | Delivers |
|---|---|---|
| W1 Asphalt | `surface-detail.ts`, `circuit-finish.ts` (asphalt), new `road-detail.ts`, `circuit.ts:143-150, 479-492` | tone, normal maps, meso, `apexLine` line, glints, tar snakes |
| W2 Kerbs and run-off | `circuit-finish.ts` (kerb, runoff, gravel), `circuit.ts:151-219, 489`, `venue-plan.ts` | 1.1 m stripes, ridge normals, wear, astroturf, painted run-off, gravel, seams |
| W3 Terrain | `circuit.ts:252-285`, `circuit-finish.ts` (terrain), `terrain-profile.ts`, `ground-profile.ts` | canopy carpet, rock, 320 segments, anti-tiling, skirt |
| W4 Forest | new `forest-belts.ts`; hooks in `aurel-vegetation.ts` and `landscape.ts`; `weather-presentation.ts` (`WORLD_WIND`) | 6-12k belt trees, translucency, AO, wind with shadow parity |
| W5 Near grass | new `near-grass.ts`, `renderer.ts` ~1107 | camera-ring tufts with sway |
| W6 Branding | new `trackside-branding.ts`, `track-boards.ts` pass-through, `circuit.ts` signs/banner, `grandstand.ts` fascia | barrier vinyl, hoardings, LED boards, logos, flags |
| W7 Wet road | `wetRoad.frag`, `materials.ts:86-142`, `wet-reflection.ts` | sub-cell puddles, dry line, drop rings, streaks, reflected forest |
| W8 Spray and rain | `effects.ts` (life/size/alpha), `spray-clouds.ts`, `rain-streaks.ts` | rooster tail, hanging mist, lit gradient |
| W9 Fence and walls | `circuit-finish.ts:183-224`, hooks on A01/A02/A04 materials | fence distance opacity, galvanised look, scuffs and tyre rub |

**Shared files.** `circuit.ts`, `circuit-finish.ts` and `materials.ts` are shared by W1, W2, W3, W7
and W9. Each WP adds its GLSL as a separately named block or installer with its own cache-key suffix,
and runs before every push:

```
npx vitest run tests/circuit-detail.test.ts tests/road-macro.test.ts \
  tests/race-surface-atmosphere.test.ts tests/aurel-vegetation.test.ts \
  tests/wet-presentation.test.ts tests/spray-lighting.test.ts tests/rendering.test.ts \
  tests/reference-rendering.test.ts tests/wet-reflection.test.ts
```
