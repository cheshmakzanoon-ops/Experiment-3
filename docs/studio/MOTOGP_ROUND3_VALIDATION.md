# MotoGP Round‑3 Photorealism Integration — Validation Report

**Repository:** `cheshmakzanoon-ops/Experiment-3`
**Target Branch:** `main`
**Vehicles Covered:** GP-R1 (`gpr1`) and GP-R2 (`gpr2`)

---

## 1. Executive Summary

This milestone recovers, completes, and validates the MotoGP Round‑3 photorealism graphics upgrade (`docs/studio/hyperrealism-wip/motogp-round3.patch`) for the GP-R1 (`gpr1`) and GP-R2 (`gpr2`) Grand Prix prototype motorcycles on `main`.

All six required graphical improvements are integrated and verified:
1. **A. Physically realistic brushed-metal rendering** (`src/rendering/bike.ts`, `src/rendering/gp-appearance.ts`, `src/rendering/gp-forged-wheel.ts`)
2. **B. Realistic motorcycle bodywork thickness (`hemShellEdges`)** (`src/rendering/gp-race-shell.ts`, `src/rendering/gp-race-bodywork.ts`)
3. **C. Surface microgeometry and panel relief (`GP_PANEL_RELIEF`)** (`src/rendering/gp-panel-relief.ts`, `src/rendering/gp-race-bodywork.ts`)
4. **D. Rider-to-motorcycle 10-capsule ambient and specular occlusion** (`src/rendering/gp-occlusion.ts`, `src/rendering/rider.ts`, `src/rendering/bike.ts`)
5. **E. Lighting and Ultra SSR reflection fidelity** (`src/rendering/gp-appearance.ts`, `src/rendering/gp-race-bodywork.ts`, `src/rendering/rider.ts`)
6. **F. 8×2 LED rear rain-light detail (`GP_TAIL_LED`)** (`src/rendering/gp-appearance.ts`)

Per milestone scope, the WIP motocross (`motocross-round2.patch`) and open-world (`open-world-round2.patch`) patches were not integrated.

---

## 2. Implementation Summary of the Six Graphical Improvements

### A. Physically Realistic Brushed-Metal Rendering
- **Files modified:** `src/rendering/bike.ts`, `src/rendering/gp-appearance.ts`, `src/rendering/gp-forged-wheel.ts`, `src/rendering/gp-front-hydraulics.ts`
- **Material upgrades:**
  - `BikeMaterials.aluminium`, `BikeMaterials.forkUpper`, and `BikeMaterials.forkLower` are upgraded from `THREE.MeshStandardMaterial` to `THREE.MeshPhysicalMaterial` (with explicit TypeScript property types on `BikeMaterials`).
  - Configured `anisotropyRotation = Math.PI / 2` so the specular lobe stretches perpendicular to lathe/machining grooves (`+U` tangent direction).
  - Authored anisotropy strengths (`GP_METAL_ANISOTROPY` in `src/rendering/gp-appearance.ts`):
    - Brushed billet/frame aluminium (`aluminium`): `0.62`
    - Turned outer fork tubes (`forkUpper`): `0.45`
    - Super-finished TiN/DLC inner stanchions (`forkLower`): `0.22`
  - Quality gating (`setGpMetalAnisotropy(materials, highDetail)`): sets `anisotropy` to authored values in High/Ultra (`detail === 'high'`) and `0` in Low/Medium (`needsUpdate = true` only on state transitions to avoid shader recompilation).
- **Forged wheel machined lip (`src/rendering/gp-forged-wheel.ts`):**
  - Replaced `gpWheelMachinedLip` with a 3-ring bevelled annulus tilted inward by `GP_LIP_BEVEL = (32 * Math.PI) / 180` (`32°`) with continuous polar UVs (`u = θ / 2π`, `v ∈ [0, 1]`) and analytical normals `(cos θ sin β, sin θ sin β, cos β)`.
  - Ensures lathe-mark bump maps and anisotropic specular highlights follow the rim circumference continuously without box-projection seams or highlight swimming during wheel rotation, steering, or camera motion.
- **High-LOD lower fork lug material (`src/rendering/bike.ts`):**
  - Applied `m.forkUpper` to the GP lower fork axle lug (`BoxGeometry(0.045, 0.11, 0.07)`) in High LOD (`gpPrototype && detail === 'high' ? m.forkUpper : m.dark`), preserving Mid-LOD geometry batching (`9` steering meshes).

### B. Realistic Motorcycle Bodywork Thickness (`hemShellEdges`)
- **Files modified:** `src/rendering/gp-race-shell.ts`, `src/rendering/gp-race-bodywork.ts`
- **Implementation:**
  - Added `GP_SHELL_HEM` (`thickness: 0.0028` m / `2.8 mm`, `radius: 0.0016` m / `1.6 mm`, `steps: 2`, `mirrorEps: 0.006` m) and `hemShellEdges(geometry, options)` in `src/rendering/gp-race-shell.ts`.
  - Detects exposed boundary half-edges via quantized position keys (`0.1 mm` grid) so welded UV seams and mirrored `x = 0` centreline edges are excluded while physical panel perimeters (windscreen cutout, wheel-arch lip, side cowl trailing edge, bellypan lower edge, tank perimeter, tail opening) receive a 2-step quarter-round rolled hem.
  - Applied to High-LOD `bodyGeometry`, `tankGeometry`, and `tailGeometry` in `src/rendering/gp-race-bodywork.ts` before nose number-plate decal projection (`buildNoseNumberDecal`). Mid and Far LODs remain untouched (`0` added triangles).

### C. Surface Microgeometry and Panel Relief (`GP_PANEL_RELIEF`)
- **Files modified:** `src/rendering/gp-panel-relief.ts`, `src/rendering/gp-race-bodywork.ts`, `src/rendering/bike.ts`
- **Implementation:**
  - Created `src/rendering/gp-panel-relief.ts` generating a cached `1024×1024` single-channel (`RedFormat`, `LinearFilter`, `LinearMipmapLinearFilter`, `generateMipmaps = true`) height atlas in fairing livery UV space (`GP_PANEL_RELIEF`):
    - Upper/mid cowl horizontal parting seam and bellypan parting seam (`seamWidth: 0.0045`, `seamDepth: -0.48`, raised lip ridges `+0.09`).
    - Six recessed Dzus quarter-turn fasteners along the fairing seams (`fastenerRadius: 0.0065`, cup depth `-0.42`, domed head `+0.22`, screwdriver slot `-0.55`).
    - Five angled gill/louvre extraction vents (`louvres: 5`, trough `-0.65`, upper lip ridge `+0.26`).
    - Tank knee-pad recess boundary groove and tail number-board recess border.
  - `installGpPanelRelief()` injects screen-space derivative height-to-normal perturbation (`dFdx`/`dFdy`) into `#include <normal_fragment_maps>` and copies the perturbed normal to `clearcoatNormal` inside `#include <clearcoat_normal_fragment_begin>`, with distance fade between `fadeNear = 4.5 m` and `fadeFar = 14.0 m` and derivative footprint clamping to prevent grazing-angle shimmering.
  - Quality gating (`setGpPanelRelief(materials, highDetail)`): sets `gpReliefStrength.value = 1` in High/Ultra and `0` in Low/Medium.

### D. Rider-to-Motorcycle Ambient and Specular Occlusion
- **Files modified:** `src/rendering/gp-occlusion.ts`, `src/rendering/rider.ts`, `src/rendering/bike.ts`
- **Implementation:**
  - Expanded `GP_CAPSULES` from `4` to `10` slots in `src/rendering/gp-occlusion.ts` (`torso`, `head`, `left/right upperArm`, `left/right forearm`, `left/right thigh`, `left/right shin`).
  - Added `rider.gpOccluders(put)` in `src/rendering/rider.ts`, transforming the 10 anatomical segment endpoints (`RIDER_OCCLUDERS`) through each limb's live `matrixWorld` each frame (`BikeModel.updateWorldOcclusion` in `src/rendering/bike.ts`).
  - When `riding === false` (rider separated from motorcycle) or below High quality, `rider.gpOccluders` is skipped and all capsule radii (`gpCapA[s].w`) are zeroed.
  - In the fragment shader (`src/rendering/gp-occlusion.ts`), capsule occlusion is soft-saturated (`1.0 - exp(-capSum * 1.15)`) and combined with the baked 3D SDF grid via `min(baked.x, mix(1.0, capAo, gpOccStrength.x * 0.78))` (`min` rather than `multiply`), preventing double-darkening when stacked with baked SDF occlusion and Ultra GTAO.

### E. Lighting and Reflection Fidelity
- **Files modified:** `src/rendering/gp-appearance.ts`, `src/rendering/gp-race-bodywork.ts`, `src/rendering/rider.ts`
- **Implementation:**
  - Registered GP lacquered paint (`paint`, `secondary`, `accent`, `gpLiveryMaterial`, `gpWingPaint`), `carbon`, and rider `helmet` with the Ultra SSR masking pipeline (`installSsrMask`).
  - Tuned GP bodywork clearcoat and roughness parameters (`clearcoat = 1.0`, `clearcoatRoughness = 0.032`, `roughness = 0.16`, `metalness = 0.12`, `envMapIntensity = 1.42`) and carbon fibre (`clearcoat = 0.88`, `clearcoatRoughness = 0.06`, `roughness = 0.24`, `envMapIntensity = 1.22`) so paint, carbon, bare metal, and dark smoked lenses exhibit distinct, physically plausible responses across daylight, overcast, and wet weather.

### F. Rear Rain-Light Detail (`GP_TAIL_LED`)
- **Files modified:** `src/rendering/gp-appearance.ts`
- **Implementation:**
  - Added `GP_TAIL_LED` (`cols: 8`, `rows: 2`, `width: 128`, `height: 32`) and `gpTailLampMap()` in `src/rendering/gp-appearance.ts`.
  - Generates a `128×32` sRGB emissive texture containing 16 discrete circular LED emitters in an 8×2 grid with warm-white hot cores (`rgb(255, 224, 195)`), saturated ruby-red halos, and a dim internal reflector cavity (`rgb(14, 2, 2)`).
  - Assigned `gpTailLampMap()` to `materials.lamp.emissiveMap` over a dark smoked-red polycarbonate lens (`color: 0x1c0404`, `roughness: 0.22`), keeping the unlit lens dark and legible while preserving existing braking and wet-weather rain-light activation (`emissiveIntensity`) without excess bloom.

---

## 3. Resolution of Compilation, Type, and Integration Defects

All four documented patch issues and two additional test-gate interactions discovered during full-suite validation were resolved cleanly without weakening any tests:

1. **`src/rendering/bike.ts` (`BikeMaterials` physical-metal declarations):**
   - Updated `readonly aluminium`, `readonly forkUpper`, and `readonly forkLower` on `BikeMaterials` from `T.MeshStandardMaterial` to `T.MeshPhysicalMaterial`.
   - Scoped the lower fork axle lug material override (`m.forkUpper`) at `src/rendering/bike.ts:1181` to `gpPrototype && detail === 'high' ? m.forkUpper : m.dark` so Mid-LOD continues batching the lug with the Mid-LOD hydraulic caliper lead (`m.dark`), preserving the exact `9`-mesh steering batch budget in `tests/gp-fork-crown.test.ts`.
2. **`src/rendering/gp-front-hydraulics.ts` & `tests/gp-front-hydraulics.test.ts`:**
   - Widened `type Materials = Pick<BikeMaterials, 'aluminium' | 'steel' | 'dark' | 'carbon' | 'gold'>` in `src/rendering/gp-front-hydraulics.ts` to accept `T.MeshStandardMaterial` on `aluminium` (which `T.MeshPhysicalMaterial` extends) without unsafe casts, and updated the unit test mock `aluminium` material in `tests/gp-front-hydraulics.test.ts` to `new T.MeshPhysicalMaterial()`.
3. **`tests/gp-panel-relief.test.ts`:**
   - Explicitly typed `const allowed = new Set<number>([T.NearestFilter, T.LinearFilter]);` so `tex.magFilter` (`T.MagnificationTextureFilter`) checks compile cleanly under strict TypeScript.
4. **`tests/gp-rear-chassis.test.ts`:**
   - Updated the High-LOD material-property texture count ceiling from `21` to `22` (`expect(high.textures).toBeLessThanOrEqual(22)`) with documented breakdown accounting for the `+1` `gpTailLampMap()` 8×2 LED emissive texture on `materials.lamp`.
5. **`e2e/gp-rider-contact.spec.ts`:**
   - Calculated and verified the exact post-hem High-LOD triangle counts for GP-R1 and GP-R2 and updated `const TRIANGLES = { gpr1: 99017, gpr2: 98094 } as const;` with a full per-panel triangle delta breakdown in the spec's header comment.

---

## 4. Geometry, Draw-Call, and Resource Budgets (Before vs. After)

### 4.1 Motorcycle Model Inventory Across LODs (`BikeModel` + `RiderModel`)

| Vehicle | LOD Tier | Metric | Before (`main`) | After (Round‑3) | Delta | Notes |
| :--- | :--- | :--- | ---: | ---: | ---: | :--- |
| **GP-R1 (`gpr1`)** | **High** | Triangles | `96,695` | `99,017` | `+2,322` (`+2.40%`) | `+1,440` flank/nose hem, `+600` tank hem, `+216` tail hem, `+66` nose decal across hemmed brow |
| **GP-R1 (`gpr1`)** | **High** | Meshes (Draw Calls) | `102` | `102` | `0` | Zero new meshes or draw calls |
| **GP-R1 (`gpr1`)** | **High** | Geometries | `102` | `102` | `0` | Hemmed in-place on High-LOD shells |
| **GP-R1 (`gpr1`)** | **High** | Materials | `36` | `36` | `0` | Existing materials upgraded in-place |
| **GP-R1 (`gpr1`)** | **High** | Material Textures | `21` | `22` | `+1` | `+1` `GP tail LED array (emissive)` (`128×32` RGBA); plus cached `1024×1024` R8 panel relief uniform texture |
| **GP-R1 (`gpr1`)** | **Mid** | Triangles | `35,370` | `35,370` | `0` | Zero overhead in Mid LOD (`79` meshes, `32` materials) |
| **GP-R1 (`gpr1`)** | **Far** | Triangles | `6,748` | `6,748` | `0` | Zero overhead in Far LOD (`43` meshes, `21` materials) |
| **GP-R2 (`gpr2`)** | **High** | Triangles | `95,916` | `98,094` | `+2,178` (`+2.27%`) | `+1,296` flank/nose hem, `+600` tank hem, `+216` tail hem, `+66` nose decal across hemmed brow |
| **GP-R2 (`gpr2`)** | **High** | Meshes (Draw Calls) | `101` | `101` | `0` | Zero new meshes or draw calls |
| **GP-R2 (`gpr2`)** | **High** | Geometries | `101` | `101` | `0` | Hemmed in-place on High-LOD shells |
| **GP-R2 (`gpr2`)** | **High** | Materials | `36` | `36` | `0` | Existing materials upgraded in-place |
| **GP-R2 (`gpr2`)** | **High** | Material Textures | `21` | `22` | `+1` | `+1` `GP tail LED array (emissive)` (`128×32` RGBA) |
| **GP-R2 (`gpr2`)** | **Mid** | Triangles | `35,042` | `35,042` | `0` | Zero overhead in Mid LOD (`78` meshes, `32` materials) |
| **GP-R2 (`gpr2`)** | **Far** | Triangles | `6,720` | `6,720` | `0` | Zero overhead in Far LOD (`43` meshes, `21` materials) |

### 4.2 Reference Studio Scene Render Metrics (`1280×800`)

| Vehicle | View | Calls (Before → After) | Submitted Triangles (Before → After) | Programs (Before → After) | `glError` |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `gpr1` | `front-3q`, `three-quarter`, `side`, `front`, `rear` | `103 → 103` (`+0`) | `97,981 → 100,303` (`+2,322`) | `43 → 46` (`+3`) | `0` |
| `gpr1` | `cockpit-contact` | `100 → 100` (`+0`) | `97,305 → 99,627` (`+2,322`) | `43 → 46` (`+3`) | `0` |
| `gpr1` | `rider-side` | `102 → 102` (`+0`) | `97,709 → 100,031` (`+2,322`) | `43 → 46` (`+3`) | `0` |
| `gpr1` | `tail-led` (macro) | `57 → 57` (`+0`) | `75,958 → 78,214` (`+2,256`) | `43 → 46` (`+3`) | `0` |
| `gpr1` | `wheel-fork-metal` (macro) | `59 → 59` (`+0`) | `70,292 → 72,548` (`+2,256`) | `43 → 46` (`+3`) | `0` |
| `gpr1` | `onboard` | `32 → 32` (`+0`) | `34,881 → 36,987` (`+2,106`) | `43 → 46` (`+3`) | `0` |
| `gpr2` | `front-3q`, `three-quarter`, `side`, `front`, `rear` | `102 → 102` (`+0`) | `97,202 → 99,380` (`+2,178`) | `43 → 46` (`+3`) | `0` |
| `gpr2` | `cockpit-contact` | `99 → 99` (`+0`) | `96,526 → 98,704` (`+2,178`) | `43 → 46` (`+3`) | `0` |
| `gpr2` | `tail-led` (macro) | `58 → 58` (`+0`) | `76,686 → 78,798` (`+2,112`) | `43 → 46` (`+3`) | `0` |
| `gpr2` | `wheel-fork-metal` (macro) | `59 → 59` (`+0`) | `69,580 → 71,692` (`+2,112`) | `43 → 46` (`+3`) | `0` |

### 4.3 Live Circuit Gameplay Render Metrics (`poggio-alto`, 4 GP bikes, `960×540`)

| Shot Name | Preset | Weather | Calls (Before → After) | Submitted Triangles (Before → After) | Mean Abs Diff (`0–255`) | Changed Pixels (`Δ > 8`) | `glError` |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `gpr1-high-chase-daylight` | High | Clear (`35.2°` lean, `0.19` brake) | `3,923 → 3,923` (`+0`) | `4,493,158 → 4,516,834` | `0.094` | `1,094` | `0` |
| `gpr1-high-trackside-daylight` | High | Clear | `3,610 → 3,610` (`+0`) | `4,155,666 → 4,183,026` | `0.010` | `162` | `0` |
| `gpr1-high-front3q-live` | High | Clear | `3,311 → 3,311` (`+0`) | `3,793,147 → 3,814,645` | `0.758` | `11,515` | `0` |
| `gpr1-high-side-live` | High | Clear | `3,308 → 3,308` (`+0`) | `3,843,327 → 3,864,825` | `0.421` | `4,563` | `0` |
| `gpr1-high-cockpit-contact-live` | High | Clear | `3,301 → 3,301` (`+0`) | `3,775,479 → 3,796,977` | `0.470` | `8,122` | `0` |
| `gpr2-high-chase-daylight` | High | Clear (`33.2°` lean, `0.06` brake) | `4,028 → 4,028` (`+0`) | `4,649,531 → 4,669,445` | `0.083` | `1,022` | `0` |
| `gpr2-high-trackside-daylight` | High | Clear | `3,306 → 3,306` (`+0`) | `3,808,644 → 3,829,998` | `0.009` | `167` | `0` |
| `gpr2-high-front3q-live` | High | Clear | `3,256 → 3,256` (`+0`) | `3,687,004 → 3,706,918` | `0.838` | `11,909` | `0` |
| `gpr1-high-chase-wet` | High | Rain (`161.6 km/h`, `0.13` brake) | `3,644 → 3,644` (`+0`) | `4,247,181 → 4,273,635` | `0.080` | `938` | `0` |
| `gpr1-high-trackside-wet` | High | Rain | `4,637 → 4,637` (`+0`) | `4,311,538 → 4,337,608` | `0.006` | `16` | `0` |
| `gpr1-ultra-chase-daylight` | Ultra | Clear (SSR + GTAO active) | `4,372 → 4,372` (`+0`) | `4,991,552 → 5,023,964` | `0.139` | `2,665` | `0` |
| `gpr1-ultra-chase-overcast` | Ultra | Overcast (`cloud = 0.92`, SSR + GTAO) | `4,442 → 4,442` (`+0`) | `4,992,370 → 5,024,782` | `0.130` | `2,742` | `0` |
| `gpr1-ultra-front3q-live` | Ultra | Clear (SSR + GTAO active) | `3,388 → 3,388` (`+0`) | `3,793,972 → 3,815,470` | `0.952` | `17,071` | `0` |
| `gpr1-ultra-cockpit-contact-live` | Ultra | Clear (SSR + GTAO active) | `3,309 → 3,309` (`+0`) | `3,775,487 → 3,796,985` | `0.673` | `14,444` | `0` |
| `gpr2-ultra-chase-daylight` | Ultra | Clear (SSR + GTAO active) | `4,475 → 4,475` (`+0`) | `5,142,029 → 5,170,679` | `0.126` | `2,598` | `0` |
| `gpr1-ultra-chase-wet` | Ultra | Rain (SSR + GTAO + Rain Light) | `3,948 → 3,948` (`+0`) | `4,480,580 → 4,511,552` | `0.139` | `2,572` | `0` |

---

## 5. Mandatory Visual Verification Summary

Matched before-and-after screenshots (`Before (Main)` vs. `After (Round-3)` plus `Abs Diff ×4`) were captured with identical vehicle state, camera position, focal length, lighting, weather, graphics preset, and resolution across both the reference studio harness (`1280×800`) and live circuit gameplay on Poggio Alto (`960×540`):

1. **View 1 — GP-R1 Front Three-Quarter Close-Up (`gpr1-front-3q-cmp.png`, `gpr1-high-front3q-live-cmp.png`, `gpr1-ultra-front3q-live-cmp.png`, `gpr1-wheel-fork-metal-cmp.png`):**
   - **Verified:** The front forged wheel rim lip (`gpWheelMachinedLip`) now exhibits a crisp `32°` bevelled diamond-cut metallic reflection band around the circumference; outer (`forkUpper`) and inner (`forkLower`) fork tubes and the High-LOD lower fork lug show distinct anisotropic metal sheen; nose brow, windscreen cutout rim, and front wheel-arch opening display `2.8 mm` rolled edge thickness (`hemShellEdges`); fairing seams, Dzus fasteners, and gill louvres catch grazing light (`gp-panel-relief.ts`).
2. **View 2 — GP-R1 Side View (`gpr1-side-cmp.png`, `gpr1-rider-side-cmp.png`, `gpr1-high-side-live-cmp.png`):**
   - **Verified:** Both front and rear wheel lips, fork tubes, brake disc carrier, and frame spar (`aluminium`) show distinct anisotropic reflection character rather than uniform plastic specular; fairing trailing edges and lower bellypan edges show rolled thickness; side-pod louvres and parting seams respond to directional light; rider forearm and thigh cast soft contact occlusion onto the tank and side cowl.
3. **View 3 — GP-R1 Rider Cockpit / Contact Close-Up (`gpr1-cockpit-contact-cmp.png`, `gpr1-onboard-cmp.png`, `gpr1-high-cockpit-contact-live-cmp.png`, `gpr1-ultra-cockpit-contact-live-cmp.png`):**
   - **Verified:** The 10-capsule rider occlusion system (`GP_CAPSULES = 10`) produces believable contact darkening along the tank crown under the rider's chest/arm, around the seat pad under the pelvis, and along the tank flank recesses under the inner thighs/knees. In Ultra mode (`gpr1-ultra-cockpit-contact-live-cmp.png`), GTAO and GP capsule occlusion combine via `min()` without double-darkening, black patches, or shadow halos, while Ultra SSR reflects the rider's suit and cockpit into the clear-coated fuel tank and fairing. Also verified in `gpr1-cockpit-contact-cmp.png` (unlit brake state) that the unlit rear rain-light lens remains dark (`0x1c0404`) and distinguishable from the illuminated state.
4. **View 4 — GP-R1 Actual Gameplay Chase Camera (`gpr1-high-chase-daylight-cmp.png`, `gpr1-ultra-chase-daylight-cmp.png`, `gpr1-ultra-chase-overcast-cmp.png`, `gpr1-high-chase-wet-cmp.png`, `gpr1-ultra-chase-wet-cmp.png`, `gpr1-tail-led-cmp.png`):**
   - **Verified:** Under both trail-braking in dry conditions (`35.2°` lean, `brake = 0.19`) and high-speed wet-weather running (`161.6 km/h`, `rain`), the rear rain light resolves as a legible 8×2 array of 16 red LED emitters with warm cores inside a dark smoked housing rather than a flat washed-out orange slab, with zero excess bloom. In Ultra mode (`daylight`, `overcast`, and `wet`), SSR reflections on the tail cowl, tank, and helmet remain stable and physically plausible without washing out metallic livery colours.
5. **View 5 — GP-R1 Actual Gameplay Trackside Camera (`gpr1-high-trackside-daylight-cmp.png`, `gpr1-high-trackside-wet-cmp.png`):**
   - **Verified:** Telephoto trackside camera framing confirms clean LOD behaviour, stable wheel-lip and fork highlights at distance, distance-faded panel relief without mipmap shimmering, and legible rear rain-light emission in wet conditions.
6. **View 6 — GP-R2 Equivalent Bodywork and Gameplay Checks (`gpr2-front-3q-cmp.png`, `gpr2-side-cmp.png`, `gpr2-cockpit-contact-cmp.png`, `gpr2-tail-led-cmp.png`, `gpr2-wheel-fork-metal-cmp.png`, `gpr2-high-chase-daylight-cmp.png`, `gpr2-high-trackside-daylight-cmp.png`, `gpr2-high-front3q-live-cmp.png`, `gpr2-ultra-chase-daylight-cmp.png`):**
   - **Verified:** GP-R2 (`#03` orange/navy livery) exhibits identical improvements across bodywork thickness (`+2,178` High-LOD hem triangles), brushed/turned metal anisotropy, bevelled wheel lips, panel relief, 10-capsule rider contact occlusion, Ultra SSR reflections, and 8×2 LED rear rain-light rendering without clipping or visual regressions.

---

## 6. Automated Validation Results

All required compilation, linting, unit test, build, IP-guard, and Playwright E2E browser suites were executed and passed:

| Command / Suite | Result | Details |
| :--- | :--- | :--- |
| `npx tsc --noEmit` | **PASS** | `0` TypeScript errors |
| `npm run lint` | **PASS** | `0` ESLint errors or warnings across `src`, `tests`, `e2e`, `scripts` |
| `npx vitest run tests/gp-*.test.ts tests/bike.test.ts` | **PASS** | **67 test files, 592 tests passed** (including new `tests/gp-panel-relief.test.ts`, `tests/gp-shell-hem.test.ts`, and updated `tests/gp-appearance.test.ts`, `tests/gp-bike-finish.test.ts`, `tests/gp-front-hydraulics.test.ts`, `tests/gp-occlusion.test.ts`, `tests/gp-rear-chassis.test.ts`, `tests/gp-fork-crown.test.ts`) |
| `npm run build` | **PASS** | Production bundle built cleanly (`dist/`) |
| `npm run check:ip` | **PASS** | `ip-guard: clean (75 shipped text files and GLB name tables scanned)` |
| `npx playwright test e2e/41-motogp-reference.spec.ts` | **PASS** | 10-view MotoGP reference sheet & lean comparison passed |
| `npx playwright test e2e/gp-rider-contact.spec.ts` | **PASS** | All 7 tests passed (`TRIANGLES = { gpr1: 99017, gpr2: 98094 }`, zero rider/bike mesh penetrations, hands on grips, boots on pegs, thighs on tank) |
| `npx playwright test e2e/gp-brake-lever.spec.ts e2e/gp-fork-crown.spec.ts e2e/gp-front-brake.spec.ts e2e/gp-r5-tyre-review.spec.ts e2e/gp-rear-chassis.spec.ts e2e/gp-rider-motion.spec.ts e2e/gp-contact-effects.spec.ts e2e/gp-edge-design.spec.ts` | **PASS** | All 15 GP browser E2E tests passed with `glError === 0` |

---

## 7. CI Status & Unverified Hardware-Specific Acceptance Criteria

1. **GitHub Actions CI Status:**
   - Pre-existing repository CI report (`ci-reports/build-and-validation.md` for commit `54b3ca93cf138d1667dd225e17acaa41fa873110`) documents that the repository's GitHub Actions `Build and Validation` workflow previously passed `build-and-unit` while 4 of 6 `browser-validation` shards timed out at the 45-minute software-GL runner limit (`cancelled`).
   - All MotoGP unit tests (`67` files / `592` tests) and all 10 GP Playwright browser E2E specs (`23` tests total) pass locally after this milestone's integration, and draw calls across both Reference and Live Gameplay scenes increased by `0`.
2. **Real-GPU Performance Gate (Explicit Hardware Limitation):**
   - All WebGL2 browser renders and E2E validations in this Linux VM environment executed on CPU software Vulkan rendering (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`).
   - Per milestone rules, software-rendered timings are **not** claimed as real-GPU performance measurements. While proxy cost metrics confirm zero draw-call growth (`+0` calls in High and Ultra gameplay), zero Mid/Far LOD triangle growth, bounded High-LOD triangle growth (`+2.40%` on GP-R1, `+2.27%` on GP-R2), and quality-tier gating that disables metal anisotropy, panel relief, and 10-capsule occlusion below High quality, physical hardware GPU frame-time benchmarking (`npm run bench:gpu` on a discrete/integrated hardware GPU) remains an external hardware verification gate.
