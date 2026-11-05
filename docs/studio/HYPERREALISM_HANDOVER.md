# Hyperrealism pass — handover and direction

Written 2026-11-05 when the second round was wound down. Audience: the next four section agents (F1, MotoGP,
motocross, open world) and any human reviewer. Read this before touching rendering code.

## 1. What happened

**Goal (from the user):** raise the realism of every 3D subject in the four disciplines (cars, motorcycles, riders,
vehicles, buildings, scenery) towards PS5 / Unreal Engine 5 level, with one dedicated graphics agent per discipline.

| Round | When (UTC) | Agents | Result |
| --- | --- | --- | --- |
| 1 | 02:43–03:23 | 4 × Opus 5.5, max reasoning, one-hour box | 20 commits, merged as `2f4ffe8` |
| 2 | 03:32–04:55 | the same 4 agents, max reasoning, no time box, captures mandatory | 8 commits, merged in this handover |
| 3 | 05:00–06:18 | 4 × Sonnet 5.5, xhigh reasoning, stopped by the user | F1 heat haze + soft-particle depth merged; MotoGP, motocross and open-world work saved as patches in [`hyperrealism-wip/`](hyperrealism-wip/README.md) |

Each agent worked in its own git worktree branched from `main` and owned a fixed set of files (listed per section
below). The orchestrator merged the branches into `claude/fervent-edison-2fnn2i` and then into `main`.
The `babylon-js` branch is a separate migration and was never touched.

## 2. Honest status

- **The PS5/UE5 target is not reached.** The work so far is a set of physically based material and shader
  refinements on top of a renderer that was already feature-rich (AgX, SSR, GTAO, TAA, cascaded soft shadows,
  scanned ground, photographed skies on Ultra). There is no single "vast" jump yet.
- **Code verification is solid:** every commit passed `tsc --noEmit`, eslint and the targeted vitest suites of its
  section, and no test was skipped or weakened. Intentional pinned-value changes are named in commit messages.
- **Visual verification is thin.** Only the open-world round-2 changes and the MotoGP/motocross close-ups were seen
  in rendered frames. F1 has **no** in-game circuit frame yet (capture tool bug); the GP occlusion has not been seen
  in a race; motocross round 2 has not been seen in a gameplay frame.
- **Nothing has been measured on a real GPU.** All rendering was software WebGL (SwiftShader/llvmpipe) on 4 shared
  cores with 16 GB RAM. Performance of the new High/Ultra terms is unknown.

## 3. Cross-cutting lessons (apply to every section)

1. **Captures are the bottleneck.** In software GL a first frame takes 3.5–5 min (every shader compiles), a
   session boot 1–8 min, and the production GPU fence (45 s, `renderer.ts`) fails sessions unless a capture-only
   build raises it. Each section's tooling below works around this; reuse it instead of writing new tools.
2. **One heavy job at a time.** Four agents capturing at once pushed load to ≈ 20 and the OOM killer ended several
   page processes and one tsc. Stagger captures; keep vitest targeted (the full suite is ≈ 626 files and takes far
   longer than any agent turn under load).
3. **Browser binary:** Playwright's default headless shell (build 1193) is not installed. Use
   `/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` or
   `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` with
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
4. **Vite dev server hazards:** any `src/` edit reloads open pages and kills a capture (use `hmr: false` configs or
   capture builds); the watcher ignores `test-results/**`; fonts 403 when `node_modules` is a symlink.
5. **Read back in the same task as the draw** (`view.capturePhoto()` right after `view.draw`), otherwise WebGL
   frames come back black.
6. **Gate by preset.** Heavy terms go behind High/Ultra (`src/rendering/options.ts`; motocross now has
   `offroad/mx-quality.ts`). Cheap terms may stay on everywhere, but say so in the commit.

## 4. Shared-file notes (coordinate before editing)

- `src/rendering/renderer.ts` (owner: F1/shared pipeline) now calls `setMxQuality(preset)` in `setQuality`
  (motocross, `5c398e8`).
- `src/rendering/paint-finish.ts` (F1) feeds catalogue and festival cars too (`vehicle-bodies/materials.ts`); the
  face-to-flop (`PAINT_FLOP`) affects every metallic car.
- `src/rendering/rider.ts` (MotoGP) also builds the motocross rider's torso leather; it exposes `ownedMaterials`
  for the GP occlusion hook.
- Motocross wants a scene depth texture from the shared pipeline for soft-particle dust.
- GP occlusion (`GP_OCCLUSION`) and screen-space GTAO (`scene-ambient-pass.ts`) may double-darken; tune together.

## 5. Direction for the next round

Work order for every section:

1. **Get a reliable in-game baseline** with the section's capture tooling (High and Ultra, gameplay cameras).
2. **Tune every untested constant** listed under "Risks" against those frames before adding anything new.
3. **Then take the remaining-work list top-down.** Each item names files and a concrete technique.
4. Commit only verified increments (tsc + targeted vitest + eslint + a before/after frame). Never weaken tests.
5. Keep shared-pipeline changes minimal, preset-gated and reported.

What "PS5/UE5 level" should mean in practice here, as a checklist per frame: no visibly flat/paper surfaces at
gameplay distance; believable contact (AO, contact shadows, specular occlusion) everywhere objects meet; no tiling
or seams at any distance; materials that react correctly to grazing light (Fresnel, sheen, anisotropy, wetness);
atmospheric depth; stable (non-aliasing) highlights in motion. A human must confirm the final look on a real GPU;
agents can only report evidence.

Capture tooling for each section is committed under [`hyperrealism-tooling/`](hyperrealism-tooling/). The scripts
contain absolute paths from the session that produced them (`/home/user/Experiment-3`, a scratchpad directory);
adjust them to your worktree before running.


## Formula cars and circuits (+ shared render pipeline)

Scope: `car*.ts`, `bodywork.ts`, `paint-finish.ts`, `tire-*.ts`, `cockpit*.ts`, `driver*.ts`, `apx01-*`, `a61-rival*`, `circuit*.ts`, `track-*.ts`, `grandstand.ts`, `pit-*.ts`, `landscape.ts`, `terrain*.ts`, `crowd*.ts`, `studio/*`, and the shared pipeline (`renderer.ts`, `materials.ts`, `materials/*`, `shaders/*`, sky/atmosphere/post).

### Done

Round 1 (merged in `2f4ffe8`):

| Commit | Change |
| --- | --- |
| `e742a8c` | Brake disc glow: new `car-brake-glow.ts`. `rotorGlowColour()` follows a tabulated black-body hue (800–2000 K, linear sRGB); `installRotorGlow()` is an emission-only hook that puts the glow on the pad band (`ROTOR_GLOW_PROFILE` inner 0.52 / full 0.72 of the rotor radius) and brightens edge-on faces (+0.35). The tested ramp `(T−500)/450` (clamped 0–2) is unchanged. |
| `86070ca` | `ReducedCar` (mid/far LOD) rotors share the wheel disc material, so hot discs no longer go dark at the LOD switch. Same draw count; `tests/vehicle-pose-probe.test.ts` checks it. |
| `5abff45` | Metallic face-to-flop in the flake hook (`paint-finish.ts`, `PAINT_FLOP` depth 0.42, chroma 0.55, power 1.6), flake finishes only. Hook key → `paint-flake-*-v2` (3 expected values in `tests/paint-livery.test.ts` updated intentionally). Also reaches catalogue cars via `vehicle-bodies/materials.ts`. |

Round 2 (this handover):

| Commit | Change |
| --- | --- |
| `0270ea2` | Tailpipe heat-tint oxide film: new `exhaust-heat-tint.ts` + test. The car's shared turned-alloy `metal` material is now `MeshPhysicalMaterial` with three.js iridescence (oxide index 2.2), enabled only inside a car-space box around the tailpipe (`EXHAUST_TINT`: \|x\| < 0.075, y −0.145…0.035, z −2.215…−1.88; covers the APX-01/A61 pipe and the procedural outlet). Film 82 nm at the lip (blue) → 30 nm upstream (straw/gold), ±9 nm mottling (filtered when sub-pixel), roughness +0.08 in the box. No extra draw call. |

Verified with tsc, eslint, prettier and targeted vitest (14 files / 83 tests in round 2) plus isolated real-WebGL renders. **No in-game circuit frame exists yet**: both full-circuit captures came back black because of a capture-tool bug (see pitfalls).

### Current state (code reading + isolated renders)

Already strong:

- **Asphalt**: chip-scale normal map and mineral glints within 6 m (`studio/road-detail.ts`); laid-rubber racing line with darker, smoother braking zones (`ROAD_DETAIL`); physics-driven marbles; wet film as a real clear-coat layer with ripples, puddles, snow and ice (`materials.ts` `installWetRoad`, `shaders/wetRoad.frag`); scanned ground, repairs, sealant and macro variation (`road-macro.ts`).
- **Car**: clear-coat paint with flakes, orange peel, race grime, wet/damage states; anisotropic carbon tow sheen; tyres with tread, sidewall lettering atlas, heat, wetness and carcass deformation; brake glow and exhaust tint.
- **Lighting/post**: sky reflection map with a ground hemisphere; photographed sky; SSAO + screen-space contact shadows (`scene-ambient-pass.ts`); soft PCF with penumbra scaling plus a far shadow map; aerial perspective, bloom, broadcast grade. Ultra adds AgX, SSR, temporal GTAO, TAA with sharpening, 4096 three-cascade shadows, physical bloom, light shafts, replay DOF.

Likely weakest (hypotheses until frames exist):

1. High uses ACES (hue skew on saturated liveries); only Ultra gets AgX.
2. High has no SSR and no TAA: expect specular aliasing on the halo, wing edges and fences.
3. No heat haze behind cars.
4. Hot rotors don't light the wheel interior.
5. No specular occlusion: no material has an `aoMap`, so three.js never occludes sky reflections in cavities.
6. Distant vegetation, crowd and terrain quality unknown.

### Remaining work (priority order)

1. **Fix the capture tool and take baselines** (High and Ultra × chase, trackside/TV, cockpit). Aurel laps only reach ≈ 320 °C on the discs; to see the glow set `b[carBase(i)+WHEEL_BASE+k*WHEEL_STRIDE+W.DISC_TEMP]=900` before the final draw.
2. **Tune in situ**: `PAINT_FLOP` (`paint-finish.ts`), `EXHAUST_TINT` (`exhaust-heat-tint.ts`; a more vivid look may need lighter titanium F0 inside the box), `ROTOR_GLOW_PROFILE` (`car-brake-glow.ts`).
3. **Decide what High inherits from Ultra**: AgX on High (`options.ts` `graphicsPreset` → `toneMapper`) is free in performance but `broadcast-grade.ts` `FILMIC_GRADE_PROFILES` and the preset tests need review; then consider `aoTemporal` on High within the draw/GPU budgets.
4. **Heat haze (High/Ultra)**: screen-space distortion in the scene composite (motion-blur / `scene-ambient-pass.ts` composite); uniforms for exhaust screen position and velocity of up to 4 near-detail cars; scrolling noise in a cone behind the outlet, depth-tested so only what is behind the car distorts.
5. **Rotor light spill** above ≈ 700 °C: fake orange irradiance on rim barrel, caliper and upright (per-wheel uniform) or one tiny `PointLight` per hot front rotor on Ultra only.
6. **Specular occlusion**: feed SSAO/GTAO into specular in the composite (Lagarde approximation) or horizon occlusion on normal-mapped surfaces. Asphalt brightness is calibrated by tests: be careful.
7. **Exhaust throat glow** at night/under load (emissive in the pipe throat / `tail_dark`).
8. **Environment from captures**: crowd and grandstands (`crowd.ts`, `crowd-impostor.ts`), trees (`aurel-vegetation.ts`), distant terrain (`terrain.ts`, `landscape.ts`), sky and clouds (`live-sky.ts`, `sky-*.ts`).
9. **Shared depth texture for soft particles** (requested by the motocross section for dust).

### Capture tooling

Scripts: `docs/studio/hyperrealism-tooling/f1/` (`vite.capture.config.ts`, `index.html`, `capture.ts`, `run.mjs`) plus the isolated shader harness (`check.mjs`, `entry.ts`, `entry2.ts`, `entry4.ts`). Copy the four capture files into `<worktree>/test-results/f1-capture/` (git-ignored; `vite.capture.config.ts` imports `../../vite.config.ts` from there).

- `vite.capture.config.ts` = `mergeConfig(base, { server: { hmr: false } })`. `index.html` needs `<base href="/">` and the script `/test-results/f1-capture/capture.ts`.
- `capture.ts` exposes `window.F1Capture = { boot, shoot, … }`: boot = `new Simulation({...DEFAULT_OPTIONS, mode: 'race', opponents, circuit})`, `sim.autoPlayer = true`, `sim.step(1/120)` for 40 s, then `RacingRenderer.create(canvas, sim.track, () => {}, () => false, { quality, graphics: graphicsPreset(quality) })`. shoot = set `view.follow`, `view.changeCamera('chase' | 'cockpit' | 'pod' | 'trackside')`, 6 settle frames 0.2 s of sim apart, then final frames 1/60 s apart; each draw `a.set(b)`, 2× `sim.step(1/120)`, `sim.writeFrame(b)`, `view.draw(a, b, 1, dt, false, false, dt)`.
- `run.mjs`: browser `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, 960×540, DPR 1, logs `F1CAP` lines, exits on page crash.
- Commands (from the worktree):
  - `npx vite --host 127.0.0.1 --port 5181 --strictPort --config test-results/f1-capture/vite.capture.config.ts`
  - `node test-results/f1-capture/run.mjs <label> high chase:3:0:6,trackside:3:0:6 "" 40 "" 3`
- Timings: module load ≈ 10 s; boot 130–170 s under heavy load (50 s light); first frame ≈ 5 min (≈ 3.5 light) while every shader compiles; later frames 0.05–0.4 s, occasionally 15–96 s on new compiles.
- Pitfalls:
  1. **Black frames**: `canvas.toDataURL()` after an `await` returns black. Read back in the same task as the final draw, ideally `await view.capturePhoto()` right after `view.draw` (copies synchronously). The fixed `capture.ts` copy was never exercised.
  2. Vite's watcher ignores `**/test-results/**`: restart the dev server after editing capture files (`src/` edits are picked up).
  3. Normal HMR reloads the page on `src/` edits and kills captures; hence `hmr: false`.
  4. Without `<base href="/">` authored assets 404 ("Truncated garage download").
  5. OOM: the page renderer (≈ 1.7 GB) was killed while several agents captured. One capture at a time, 3 opponents.
  6. `scripts/ultra-capture.ts` renders a synthetic scene with no F1 car: don't use it.
  7. `npx vite` skips predev player-LOD generation (fine for rendering); `tests/supplied-player-lods.test.ts` needs `npm run generate:player-lods` first.
- Isolated shader harness: bundles an entry with the vite `build` API (lib, iife), renders in SwiftShader, reports shader errors and a PNG. Entries outside the worktree must import three by absolute path (`/home/user/Experiment-3/node_modules/three/build/three.module.js`). A regex forcing shader values matches the first literal occurrence before `#include` expansion. Thickness palette reference: 25 nm straw, 50 bronze, 75 deep blue, 100 steel blue, 150 gold, 175 magenta.

### Risks and untested constants

- `PAINT_FLOP` tuned on spheres only; metallic liveries may go too dark at grazing angles, and it affects catalogue cars too.
- `EXHAUST_TINT` (thicknesses, mottling, box) not seen in game; any future static alloy part inside the box picks up the tint. The shared `metal` material changed Standard → Physical (equivalent shading at ior 1.5), so every turned-alloy part compiles the iridescence program; untested on low-end GPUs.
- `ROTOR_GLOW_PROFILE` and the black-body table checked in isolation only; reduced-LOD rotors reuse the full rotor radius (procedural annulus is also 0.209 m, so they match).
- Unrelated failures seen in round 1: `tests/supplied-player-lods.test.ts` (missing generated asset unless `generate:player-lods` ran) and `tests/pit-release.test.ts` (30 s timeout under CPU load, simulation-only).

## GP motorcycles and riders (`src/rendering/gp-*.ts`, `bike*.ts`, `rider.ts`)

### Done

Round 1 (merged in `2f4ffe8`):

| Commit | Change |
| --- | --- |
| `a819af3` | Exhaust heat tint: `exhaustGeometry(..., 'gp-oxide')` in `bike.ts` gives GP headers banded titanium temper colours (`GP_TITANIUM_OXIDE`) with wavy band edges (road/dirt bikes keep the 'classic' ramp); `gpSilencerHeatSoak` in `gp-appearance.ts` adds an inlet straw tint and outlet bronze ring; hook `gp-titanium-oxide-v1` makes tinted bands glossier. |
| `256b53a` | Metallic paint: livery finish texture's blue channel is a metalness map on gloss areas only (`GP_PAINT_FLAKE.metalness` 0.42, `gp-race-bodywork.ts`); GP helmet metalness 0.38 (`rider.ts`). |
| `2bbc20c` | Lacquered carbon: clearcoat 0.8 → 1, clearcoat roughness 0.09 → 0.045 (`calibrateGpMaterials`). |
| `6abda29` | `gpWingPaint` gets the livery's metalness. |

Round 2 (this handover):

| Commit | Change |
| --- | --- |
| `8f18cc1` | **Bike-space ambient + specular occlusion, High/Ultra only.** New `gp-occlusion.ts`: each GP definition's bike (no rider) is baked once, upright at rest, into a 3D occupancy grid (60–100 ms, cached per definition, freed with the last entrant). Hook `gp-occlusion-v1` on every lit opaque bike and rider material of the entrant: five short cone traces around the normal darken indirect diffuse and sheen; one cone along the reflection darkens environment reflections and clear coat. Wiring in `bike.ts` (`BikeMaterials.occlusion`, `BikeModel.occlusionGrid()`, `BikeShells.occlude()`, `releaseGpOcclusion`; per-frame bike-space matrix in `BikeShells.update`, enabled only at quality 'high', which includes Ultra). `rider.ts` gains an `ownedMaterials` getter. New `tests/gp-occlusion.test.ts` (8 tests). |

Verified with tsc, eslint, prettier and targeted vitest (203 tests across 20 files in round 2) plus before/after renders of the production GP-R1 model. **Not yet seen in a race frame**: both race-session captures failed (OOM, then a stuck menu click).

### Current state

Strong: livery clear coat with orange peel plus metallic base and separate gloss/satin/matte zones; carbon has per-bundle anisotropy (`carbonMaterial` in `materials.ts`); tyre finish (wear, temperature, scrubbed shoulder, sidewall lettering, wheel blur); rider suit (stitching, perforation, stretch panels, sheen); iridium visor; carbon disc glow; heat-tinted exhaust; screen-space GTAO from Medium up in the shared post pipeline.

Weakest (from reference-scene renders):

1. Shell panels are single paper-thin surfaces with no thickness or rolled edge (livery shell ≈ 8.3k of ≈ 96.7k triangles at high LOD).
2. The shared `dark` material (metalness 0.4, roughness 0.55) makes engine and mechanical parts read as uniform plastic.
3. The machined wheel lip reads as a wide flat bright ring.

### Remaining work (priority order)

1. **Verify `8f18cc1` in a race** (chase + trackside, High). Tune `GP_OCCLUSION.diffuse` (0.82) / `specular` (0.9) against GTAO in `scene-ambient-pass.ts` (possible double-darkening of wheels and undertray). Consider rider-to-bike occlusion (capsule occluders or baking the rider at partial density).
2. **Anisotropy, High/Ultra**: make `aluminium`, `forkUpper`, `forkLower` in `bike.ts` `MeshPhysicalMaterial`; `anisotropyRotation` = π/2 (brushed marks run along U, which wraps around the tubes); toggle strength per frame next to `setGpOcclusionStrength` (three.js recompiles once when crossing zero). The wheel lip (`gpWheelMachinedLip`, flat-projected UVs) needs a tangent attribute or anisotropy map; `bike-rigid-batch.ts` only merges meshes with identical vertex attributes. Untested starting script: `docs/studio/hyperrealism-tooling/motogp/patch-aniso.py`.
3. **Panel hems**: 2–3 mm rolled-edge strip along welded boundary edges of flank/nose, tank and tail panels (`shellPanelGeometry` in `gp-race-shell.ts`, assembled in `gpRaceBodywork` in `gp-race-bodywork.ts`), rounded normals, livery UVs. Triangle cap in `tests/gp-appearance.test.ts` is < 110k (≈ 13k headroom).
4. **Split `BikeMaterials.dark`** into cast magnesium, black anodise, hose rubber and plastic with roughness variation and fine normal detail.
5. **More shell subdivision at high LOD** (rows 4, cols 3 in `gpRaceBodywork`) for smoother nose/tail silhouettes.
6. **Header iridescence, High/Ultra**: titanium as `MeshPhysicalMaterial`, iridescence strength from vertex-colour saturation (as the oxide-gloss hook does), film thickness from a new oxide attribute written by `exhaustGeometry` (not UV maps: silencer UVs run differently). Low priority.
7. **Rider self-occlusion** (armpits, chin): per-vertex AO baked on the rigid rider segment meshes.

### Capture tooling

Scripts: `docs/studio/hyperrealism-tooling/motogp/` (`reference-capture.mjs`, `ao-capture.mjs`, `ao-fixture.ts`, `compare.py`, `race-capture.mjs`, `patch-aniso.py`).

- Load Playwright via `createRequire('/opt/node22/lib/node_modules/playwright/package.json')('playwright')`; the repo's own Playwright expects a different Chromium build than `/opt/pw-browsers`.
- Reference scene (production BikeModel, no post/GTAO): `node --experimental-transform-types reference-capture.mjs <worktree> <outPrefix> <views...>` builds `e2e/fixtures/motogp-reference-review.ts` and calls `MotoGPReview.captureBike(view,'high','gpr1',false)`. Views: three-quarter, side, front, rear, rider-corner, corner, rider-rear, rider-side, front-brake, rear-chassis, onboard. ≈ 20–35 s per view.
- Occlusion before/after: `node --experimental-transform-types ao-capture.mjs <outPrefix> <lean> <debug 0|1|2> <views...>` (scratch fixture `ao-fixture.ts`; needs vite `resolve.alias` for `three` and `three/addons`; debug 1 = diffuse term, 2 = reflection term). `compare.py out a b x0 y0 x1 y1 [scale]` makes side-by-side crops.
- Race session: `npx vite --host 127.0.0.1 --port 5182 --strictPort`, then `node race-capture.mjs <outPrefix> --grid --lite --preset high --opponents 3 --targets 0,1 --views chase,trackside`. It opens `/?dev`, waits for `#menu` (70–130 s), sets `[name=quality]` in GARAGE & SETTINGS (`--lite` = crowd off, half vegetation), clicks the GP BIKE radio with `noWaitAfter` and polls until `#vehicle` is gpr1, sets `#mode` race and `#opponents` (only 0, 3, 7, 11 are valid), then PREPARE GRID (paused) or ENTER CIRCUIT + ArrowUp (pause menu has AI DRIVER, `data-action="autopilot"`). Photo studio via `document.querySelector('#modal [data-action="photo"]').click()` (normal click timed out under load; this path not yet re-run), then `#photoTarget` / `#photo-view` (orbit, cockpit, pod, chase, trackside), saved via CDP `Page.captureScreenshot`.
- Pitfalls: grid preparation ≈ 8 min at load ≈ 15 and the page needs > 1.8 GB; two runs were OOM-killed (memory shared by all agents): use 3 opponents and `--lite`, nothing else heavy at once. Vite reloads open pages on src edits. Fonts 403 under the symlinked node_modules (fallback fonts). After a page crash `browser.close()` can hang; check for leftover node/Chromium processes.

### Risks and untested constants

- `GP_OCCLUSION`: voxel 0.02 m, margin 0.36 m, ≤ 192 cells/axis, strengths 0.82 / 0.9; cone weights 0.36 + 4 × 0.16 at ~55° tilt. Tuned only in the reference scene (RoomEnvironment, no GTAO).
- The bake uses the upright rest pose: fork dive, steering and swingarm travel shift parts a few cm relative to the volume. Rider not in the bake.
- ≈ 20 trilinear 3D texture reads per bike/rider pixel at High; never measured on a real GPU. R8 3D texture relies on `generateMipmap(TEXTURE_3D)` (works in SwiftShader, unverified on real GPUs).
- Only materials in `BikeMaterials.list` and `Rider.ownedMaterials` are hooked (deliberate). The volume cache is a module-level ref-counted Map: an undisposed `BikeShells` leaks its volume.
- Round-1 values judged only in the reference scene: `GP_PAINT_FLAKE` 0.42, helmet 0.38, carbon 1 / 0.045, `GP_TITANIUM_OXIDE` stops, `GP_TITANIUM_OXIDE_GLOSS` 0.62.
- SS-600 and SBK-1000 road bikes share `gpLiveryMaterial`, so they also got the metallic base; not checked visually.

## Motocross / supercross (`src/rendering/offroad/*`)

### Done

Round 1 (merged in `2f4ffe8`):

| Commit | Change |
| --- | --- |
| `892b438` | Dust puffs (`mx-dust-material.ts`) shaded as rough volumes: self-shadowed lee side, backlit thin edges, sky-lit top, lumpy noise instead of sine stripes, near-camera fade. |
| `f881932` | Mud (`mud.ts`): domed splats, opaque wet cores, paler dry rims, millimetre relief, fore-aft stretch. |
| `9adc6c6` | Roost clods (`roost.ts`): same 20 triangles / one draw, per-particle wetness (dry = crumbly, wet = rounded glossy clay). |
| `2f40505` | SX arena (`stadium.ts`): floodlight haze shafts in one additive draw (~560 tris); event-board accent bars merged to stay under the 16-batch budget. |
| `522907f` | Shoulder plants (`mx-shoulder-plants.ts`): backlit yellow-green leaf transmission. |
| `66a4ff8` | Start gate steel carries a fixed mud coat (0.42, damp 0.25). |

Round 2 (this handover):

| Commit | Change |
| --- | --- |
| `5c398e8` | Graphics-preset gate: new `offroad/mx-quality.ts` (`setMxQuality`, `gateMxDetail` → `MX_HIGH_DETAIL` define, `onMxDetail`). Dust uses two noise octaves and arena shafts render only on High/Ultra. **Touches `renderer.ts`** (1 import + `setMxQuality(preset)` in `setQuality` after `scannedGround.attach(...)`). |
| `6078ba9` | Knobby tyres (`motocross-tyre-finish.ts`, `dirt-bike-model.ts`) read the entrant mud uniforms: soil packs between knobs (dry 18 % fill, wet up to 82 % dark glossy clay), knob tops and sidewall stay rubber. |
| `0df8c43` | Drainage-shaped moisture (`terrain-view.ts`, `mx-soil-detail.ts`): new per-vertex `mxSoilTopo` (−1 crest .. +1 hollow, 1–2 m and 5 m scales); displayed moisture +0.16 in hollows, −0.22 on crests; dry crests paler/rougher. Simulation untouched. `tests/motocross-terrain-continuity.test.ts` attribute list extended. |
| `eb86b47` | Dry-race dust film on bike and rider (`mud.ts`): coat × (0.1 + 0.42·low) × upward-face settle × noise; washes off when wet; roughness ≥ 0.88, clearcoat cut up to 80 %. |
| `11f4cdf` | Starter's pad (`start-gate.ts`): tracked-in hardpack, worn lane per slot, roost spray fans behind rear wheels; lane spacing follows the session's gate slots. |

All verified with tsc, eslint and targeted vitest (22 files / 166 tests in round 2; 68 files / 624 tests in round 1) plus close-up shader renders. `e2e/51-motocross-roost-lighting` passed after round 1. **No round-2 change has been seen in a real gameplay frame.**

### Current state (from the one High gameplay frame, before round 2)

Strong: photographed soil with track-shaped detail (wheel passes, berms, braking-bump shading, wet film in hollows); bike modelling (crossed spokes, gold fork tubes, chain, cast finishes); tuff blocks.

Weakest:

1. The concrete start pad was a clean grey slab filling the foreground (`11f4cdf` targets it, unverified).
2. Track surface at chase distance: saturated orange-brown grain, tyre lines that read as low-contrast paint, almost no visible rut depth, no clods or stones lying on it.
3. Grass fields far from the course are flat.
4. Plastics are uniformly saturated and flat.
5. Supercross: no fresh capture; older evidence shows a dark arena, flat dirt, painted-looking lines.

### Remaining work (priority order)

1. **Capture after-frames** for MX (`valley-ridge-mx`) and SX (`arena-nord-sx`) at High; tune the round-2 constants (see risks).
2. **Real rut depth** in `mx-soil-detail.ts`: parallax occlusion on High/Ultra, 8–16 steps over the analytic `mxWheelPass` height in course space (`vMxCourse.xy`), gated with `gateMxDetail(material)` from `terrain-view.ts` or `#ifdef APEX_SCAN_HEX`. Cheaper complement: move groove darkening from albedo into the cavity term (`mx-soil-morphology.ts`, `aomap_fragment` injection, `mxMorphCavity`) so lines stop reading as paint. Fallback: finer camera-local terrain patch (grid today 0.5 m × 1 m).
3. **Loose clods and stones**: instanced on berm lips, shoulders and inside lines (`mx-course-dressing.ts`), density gated by `mxHighDetail()`.
4. **Plastics**: boot-scuff zones on shrouds/side panels, whitened scratches, lower saturation via sheen/clearcoat in `installMotocrossPlasticFinish` (`motocross-detail.ts`); batched sprung meshes carry sprung-frame positions, so zones can be placed in bike coordinates.
5. **Rider fabric**: knit micro-normal and joint-keyed fold normals via a hook on the material passed to `addMotocrossGarment` (`motocross-gear.ts`; v runs along the limb). Torso uses `torsoLeather` in `rider.ts` (MotoGP's file): coordinate.
6. **SX lighting**: floor light pools, stronger lamp-lens glare (`stadium.ts`), darker, tackier SX soil.
7. **Soft-particle dust**: needs a scene depth texture from the shared pipeline (F1 section); today only a near-camera fade exists.
8. Route any heavier new term through `gateMxDetail`.

### Capture tooling

Scripts: `docs/studio/hyperrealism-tooling/motocross/` (`capbuild.sh`, `capture.mjs`, `bike.mjs`, `check.mjs`, `entry.ts`). With W = worktree and S = a scratch dir:

1. `bash capbuild.sh after <worktree>` (or `before <sha>`): copies `src/` to `$S/mx/src-<tag>`, raises the GPU-fence deadline in `renderer.ts` from 45000 to 1800000 ms **in the copy only**, builds `$S/mx/dist-<tag>` (1–2 min).
2. `cd $W && npx vite preview --host 127.0.0.1 --port 5183 --strictPort --outDir $S/mx/dist-<tag>`
3. Copy `capture.mjs` into `$W/test-results/mx-capture/`, then `node test-results/mx-capture/capture.mjs valley-ridge-mx high <tag> 12 gate,ride` (same with `arena-nord-sx`). Shots: `menu`, `gate`, `ride`, `onboard`; output 960×540 PNGs. Each shot pauses (Escape → RESUME SESSION, `workerPause.pending === false`), hides `#app`, waits for 2 fresh `presentation.frames`, screenshots, resumes; rides press `g` and pause after start + N s.
4. Close-ups: copy `bike.mjs`, `check.mjs`, `entry.ts` into `$W/test-results/mx-shader-check/`; `node .../bike.mjs <tag> '[["rear-tyre",{"mud":0.8,"wet":0.9}]]'` (views: three-quarter, side, rear, rear-tyre, front-tyre, drivetrain, helmet); `node .../check.mjs <tag> '[["terrain",{},"t"],["gate",{},"g"],["stadium",{"preset":"medium"},"s"]]'` catches shader compile errors (procedural ground, not scans).

Timings at load ≈ 15: menu 50–80 s, MX briefing ≈ 450 s, gate shot ≈ 150 s, frames 30–70 s, ≈ 15 min per venue.

Pitfalls:

- Use `/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (Playwright's default 1193 shell is missing). llvmpipe alternative: `MX_BACKEND=mesa xvfb-run -a -s "-screen 0 1280x800x24" node ...` with full chrome-1243 (≈ 3 GB RAM).
- The unpatched 45 s GPU fence fails sessions in software GL; use the capture build.
- Don't capture from the vite dev server: `src/` edits reload mid-capture, and fonts 403 because `node_modules` is a symlink outside the allowed root.
- The sim keeps running during slow frames: always pause before a shot.
- The SX entry click timed out at 150 s; untested fix: wait for `settingsTransition.busy === false` and fresh frames first.
- 16 GB RAM shared: tsc during captures got OOM-killed. One heavy job at a time.

### Risks and untested constants

- Moisture: normaliser /0.22, bias +0.16/−0.22, crest +7 % lighter, roughness ≥ 0.9.
- Tyre packing: knob height 0.016 (duplicated from `dirt-bike-model.ts`), fill 18 %/82 %.
- Dust film 0.1 + 0.42·low; "low" is part-local y (sprung frame for batched meshes, not height above ground). Start-gate grates may look over-dusty at coat 0.42.
- Pad dirt assumes the slab's +z faces the gate and rear wheels ≈ 1.45 m behind.
- `RacingRenderer.create` without initial settings never calls `setMxQuality`, so the gate stays open (production always passes settings). Gate state is module-global (one renderer per page).
- e2e not re-run in round 2: `e2e/43`, `e2e/46`, `e2e/49`, `e2e/51` may react to the new terrain attribute, gating or dust film.

## Open world — Solvane Coast festival (`src/rendering/open-world/*`)

### Done

Round 1 (merged in `2f4ffe8`):

| Commit | Change |
| --- | --- |
| `d8793e0` | `water.ts`, `festival-renderer.ts`: open-sea sun glints and whitecaps, High/Ultra via `Water.setDetail` from `setQuality`. |
| `d3960f5` | `festival-road-surface.ts`: pavement cracks and bitumen crack seal, High/Ultra via the shared `festivalRoadDetail` uniform. |
| `79f9dee` | `buildings.ts`: per-pane glazing tilt (≤ ~0.9°) and a faint tempered-glass ripple (`GLAZING`). |
| `88438c0` | `terrain-material.ts`: backlit grass forward scatter and opposition brightening (`TERRAIN_GRASS_SCATTER`, `owGrassDetail`), High/Ultra. |
| `f63bb85` | `buildings.ts`: insulated-glazing reflectance 1−(1−F)^4 (~15 % at normal incidence), diffuse share reduced to conserve energy. |
| `fc9b794` | `buildings.ts`: lapped roof-tile relief, per-tile roughness, lichen (facade cache key v10). |
| `3d7bb12` | `terrain-material.ts`: wet beach band above sea level (`owSeaLevel` from `region.seaLevel`). |

Round 2 (this handover; each checked in game frames):

| Commit | Change |
| --- | --- |
| `8736562` | `water.ts`: glints rebuilt after captures showed polka dots: Gaussian facet slopes (Box-Muller, RMS 0.085 rad), jittered point glints crowding the sun's reflection path. Hook key `festival-open-sea-v2`. Seen at day and sunset. |
| `566e0e8` | `terrain-material.ts`: High/Ultra "sward mosaic" (hue patches tens of metres across, straw patches, tussock mottling fading out by 150–420 m); wider, darker, glossier wet beach (0.55–1.0 m band, albedo ×0.44, roughness 0.17) plus a near-mirror film within 0.1 m of the waterline. Terrain cache key v5. |
| `737024d` | `festival-road-surface.ts`: cracks box-filtered by pixel footprint (thin with distance instead of cutting off at ~15 m); lengthwise cracks along interior lane joints 0.2–0.5 m from the paint; cross cracks one chance per 14 m at 0.8×(0.5+0.5·age); seal half-width 30–65 mm. |

No files outside the open-world scope were touched.

### Current state

Strong: sunset glitter path over the sea (very convincing), daytime glitter in the sun path, sky/clouds/sunset sun, scanned beach sand, distant cliffs, grass fields now a mosaic instead of a uniform lawn, road paint, car body, glazing.

Weakest (worst first):

1. **Grass clumps near roads** render as flat orange/brown "starfish" debris, nearly black at sunset (`horizon-dressing.ts` `buildMeadow` + `festival-meadow.ts` geometry).
2. **Brown blotches in the shallows**: tan patches with dark rims on near-shore water; not caused by the sea finish (on/off test). Suspects: local reflection probe sampling beach/hills on steep wave normals, or the tan shallow colour (0.18, 0.195, 0.14) in `coastal-water.ts`.
3. **Terrain tile seams**: vertical skirts show as a striped wall while tiles stream (gone once fine tiles arrive; can recur after fast travel).
4. **Highway surface** looks very clean; wear and crack seal are subtle (highway material age 0.32).
5. **Whitecaps never appear**: steepness (1 − n·up) rarely exceeds ~0.01 against a ~0.09 threshold, so they are effectively dead code.
6. Grass opposition brightening (sun behind) is not noticeable; forward scatter is plausible.
7. Wet beach band is subtle at grazing views (sky reflection offsets the darker albedo).
8. Shadowed cliff faces at sunset look flat blue.
9. Distant trees are dark rounded blobs.
10. Not evaluated: night, rain, town/facade changes in game, real-GPU performance.

### Remaining work (priority order)

1. **Grass clumps** (`horizon-dressing.ts`, `festival-meadow.ts`): seed colour 0.28/0.23/0.115 is too orange → pale straw ≈ 0.36/0.32/0.20; less blade bend so clumps read upright; check what `installCanopyNormals`, AO and shadows do to thin blades; add backlit transmission; blend base colour toward the terrain grass.
2. **Whitecaps** (`water.ts`): drive by tilt `length(cross(normal, seaUp))` (typically 0.05–0.1, threshold ≈ 0.1), keep the wind-clumped gate; verify with an in-game on/off pair.
3. **Coastal shallows** (`coastal-water.ts`): change shallow colour and reflections separately to find the blotch cause; turquoise-over-sand shallow colour; consider weaker normals near shore or limiting near-horizon reflection lookups.
4. **Terrain seams** (`terrain.ts` + vertex stage of `terrain-material.ts`): geomorph heights toward the next-coarser level near the hand-over distance. Add a per-vertex parent-level height attribute (same a–d diagonal triangulation; level ratio 2, except L2→L3 = 4 because resolution drops 64 → 32); morph factor `smoothstep(0.8, 1.0, hypot(dx, dz, 0.6·max(0, camY − y)) / (split · parentSize))` to match `wantsSplit`; skirt vertices morph with their edge vertex; keep skirts for transients; make loading wait for the finest near tiles.
5. **Road wear** (`festival-road-surface.ts`): stronger wheel-path darkening and polish, an oil-drip line, more crack seal on highways; verify cracks in game on a two-lane road (asphalt age 0.9); confirm scanned-ground hooks don't wash out the road colour changes.
6. **Car paint pearl**: shared `paint-finish.ts` already has flakes and face-to-flop; a colour-shifting pearl needs `festival-car-finish.ts` hooks on clones of the followed car plus per-livery data.
7. **Rock and buildings**: triplanar scanned detail plus large-scale normals on cliffs; ground-contact darkening band at the facade foot; check glazing and roofs in a Port Ilse frame.
8. Distant tree silhouettes/shading; sunset cliff fill light.

### Capture tooling

Scripts: `docs/studio/hyperrealism-tooling/open-world/` (`capture.mjs`, `vite.capture.config.mjs`, `road-probe.mjs`, `road-probe-persp.mjs`, `terrain-probe.mjs`, `shadercheck.mjs`, `r3-capture.mjs`, `verge-cap.mjs`, `verge-cap-off.mjs`).

- Dev server: `npx vite --host 127.0.0.1 --port 5184 --strictPort` (dependency-scan warning harmless). Editing a served file reloads the page and breaks a capture: don't edit during captures, or use `--config vite.capture.config.mjs` (disables hot reload; written but never run).
- `node capture.mjs <outDir> <day|sunset|night> <quality> <views.json> [travel=coast-trap] [weather=clear]`. Views are `{name, camera, target, rel?, draws?, settle?, eval?}` (`rel` = offsets from the player, `settle` = ms after each draw, `eval` = JS before drawing). Loads `http://127.0.0.1:5184/e2e/fixtures/horizon-session.html?quality=high&vehicle=eh3&lighting=day&weather=clear&discovered=all&travel=coast-trap&capture=1&frames=1`, waits for `#loading` to hide and `horizonReview.state().draws >= 1`, then per view `horizonReview.inspect(cam, target)`, `draw()` ×3, `image()`. 960×540, 30-min default timeout.
- Browser: launch `/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` with `--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (Playwright 1.55's default 1193 is not installed).
- Positions: player after `travel=coast-trap` at (-2599.0, 33.72, -2025.0), heading ≈ (+0.995, 0, +0.0995). Day sun offset (-140, 235, -115) ≈ 52°; sunset (-215, 45, -150) ≈ 10°. Sea at z ≈ -2250 to -3020.

| View | Camera | Target |
| --- | --- | --- |
| Coast towards day sun | [-1818, 40, -2732] | [-1874, 0, -2778] |
| Coast towards land | [-1818, 12, -2732] | [-1768, 0, -2682] |
| Beach | [-1818, 2.9, -2665] | [-1790, 0, -2700] |
| Open sea | [-1818, 60, -2732] | [-1650, 0, -2950] |
| Sunset glitter | [-1818, 15, -2732] | [-1900, 5, -2789] |
| Road ahead (player-relative) | (9.95, 1.4, 1.0) | (29.85, -0.4, 2.99) |
| Road side (player-relative) | (20, 2.5, -9) | (30, 0, 0) |
| Grass towards sunset sun (rel.) | (0, 1.7, -12) | (-32.8, -1.5, -34.8) |
| Grass, sun behind (rel.) | (0, 1.7, 12) | (32.8, -1.5, 34.8) |

- Timings: boot 60–80 s; `image()` readback 4–5 min for the first view (shader compiles), then 1–2.5 min per view; five views ≈ 10–15 min under load. Use four draws 15 s apart so fine tiles arrive before the shot.
- In-game on/off test of a uniform: temporarily expose the uniform on `globalThis` inside the install function, flip it in the view's `eval`, remove before committing.
- `scripts/horizon-coast-review.mjs` times out (240 s op timeout at 1280×720); set `HORIZON_REVIEW_EXECUTABLE` to the shell above and raise its timeouts to use it.
- Font 403 every run is harmless (`node_modules` symlink outside the root). 16 GB RAM shared: one capture at a time.

### Risks and untested constants

- Glints: slope 0.085, power 1600, gain 150, 2.4 cells/m, radius 3.5–13 % of a cell, fade 0.16–0.7 m/px. Seen only in software rendering; flicker, TAA and bloom at 60 fps untested.
- Whitecap constants are dead code until item 2 is done.
- `TERRAIN_GRASS_SCATTER`: forward 0.11 (power 5), opposition 0.32 (power 10).
- Sward mosaic: hue ±10 %, straw 34 %, tussock ±8 % (one day view only).
- Wet beach: albedo ×0.44, roughness 0.17, mirror film roughness 0.07.
- Road cracks now evaluate at every distance (extra noise per road pixel on High), performance unmeasured; `festivalRoadDetail` is module-global; `festival-road-surface-v2` changed content but kept its cache key.
- Glazing, roofs and pane tilt seen only in the isolated facade review; night reflectance unevaluated.
- Cache keys: facade v10, terrain v5, `festival-open-sea-v2`.
