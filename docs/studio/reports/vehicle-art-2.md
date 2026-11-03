# Vehicle Art & Animation, wave 2

Branch `studio/vehicle-art-2`, cut from main at 4b66e0e. Everything below was measured or looked at on this
branch; "not tested" is said where it applies. Scope was fixed by the PM: EH-3 hero pass, D7 colourways, D6
drivers, D5 bike fairings, D10/D11 if time, then probe, tests, tsc/eslint and a full 57-machine capture. The IP/hero-car
agent owns APX-01, `supplied-*`, `apx01-*`, the open-wheel APX-01 path and `a61-rival*`; none of those files were touched
(APX-01 is pixel-identical to its baseline, mean abs diff 0.000).

## 1. Status

| Item                                      | Result                                                                                                           | Evidence                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. EH-3 hero pass                         | Done, with two named gaps (section 2.1)                                                                          | `vehicle-screens-2/compare-eh3.jpg`; 5 new tests; 4 existing construction test files now run EH-3 |
| 2. D7 one-red-car                         | Done for all 47 catalogue bodies; player override unit-tested, **not** exercised in the real Photo Studio        | `compare-d7-colourways.jpg`, 5 contact sheets reviewed, `tests/vehicle-colourways.test.ts` (14)   |
| 3. D6 drivers                             | Done (shape, helmet, livery colour); still stylised                                                              | `compare-d6-drivers.jpg`; `tests/driver-arms.test.ts` 13 passed, pose probe 4 passed              |
| 4. D5 SS-600 / SBK-1000 / CR-750          | Done for SS/SBK; CR-750 improved, not finished                                                                   | `compare-d5-bikes.jpg`; `tests/bike-sport-shell.test.ts` (6)                                      |
| 5. D10 karts / D11 trucks                 | D11 improved (DX-8 clearly, RP-6 slightly); **D10 only partly**: the kart nose is rounder but still a flat shell | `compare-d10-d11.jpg`                                                                             |
| 6. Probe, tests, tsc, eslint, 57 captures | All run; results in section 5                                                                                    | `vehicle-screens-2/`, `diff-vs-baseline.json`                                                     |

Before and after captures are in `docs/studio/reports/vehicle-screens-2/`: `<id>.jpg` for all 57 machines (24-46 KB), `before-<id>.jpg`
(copied from the wave-2a `vehicle-screens/`) for the 22 machines used in the comparisons, `compare-*.jpg` sheets, `manifest.json`
(57 shots, no failures, no console errors) and `diff-vs-baseline.json`. All captures are SwiftShader software GL, 1280x720, menu chrome hidden.

## 2. What changed

### 2.1 EH-3 Electric Hypercar (festival default)

- `body-sheet.ts` `eh3`: `frontSweep 0.30`, `rearSweep 0.22`, `sideSculpt 0.04`, `bonnetVents: true` (SC-7 uses 0.28/0.24/0.042). That switches on
  the existing kit by data: swept nose with bonded lamp pockets, two bonnet outlets, a pocketed side duct instead of the flat raised scoop, a pressed lower flank.
  No exhaust (electric).
- New sheet key `signature` (emissive colour, `0x39d7ff`, the menu cyan) read by `addSignatureLighting` in `festival-detail.ts`:
  a continuous emissive blade across the nose in a dark channel, a thin lit line along each wheel-arch ceiling (4), and a continuous bar that
  bridges the two tapered tail lamps (brake-driven `mats.tail`, so it stays a legal red). The geometry is authored on the un-swept end faces and the shared nose/rear warp carries it over the swept
  skin. One shared emissive material (`sharedMaterials.lightBar`), only on LOD0/1, no light source added.
- Paint: pearl `0xe7eaec` (the sheet's `metallic` finish) over carbon `0x14171a` on the lower body and the greenhouse, with a cyan pinstripe on both edges (section 2.2).
- Tests: `festival-vehicle-detail.test.ts` gained 5 EH-3 cases (kit data and pockets; nose blade continuous, swept, on the fascia; arch lines clear the tyre and stay inside
  the body on both sides at LOD0 and LOD1; tail bar spans the bridge; shared emissive material, absent on LOD2 and on SC-7). `festival-nose-`, `-rear-`, `-side-construction` and
  `-car-surface` tests now loop over `['rh3', 'sc7', 'eh3']` and pass, so EH-3's lamp holes, curved ducts, rear lamp pockets, side intakes and pressed flank satisfy the same ray tests as SC-7 and RH-3.
  (`festival-wheel-construction` was tried with EH-3 and reverted: its spoke-root probe is for split-spoke wheels, EH-3 has mesh wheels.)

Honest look at `compare-eh3.jpg`: the silhouette now reads as a modern hypercar and is clearly not SC-7; the cyan identity is legible in a still. Weak points: the front splitter
is still a flat light-grey plate (D8, untouched), the bonnet outlets and lamps are small, the pearl flake is not visible in a software-GL still, and the showroom orbit never shows the tail,
so the tail bar is verified by geometry tests, not by an image. **Not done from the report's hero list:** raising the articulated rear aero (`solvane-details.ts`) in the showroom; that object belongs to the
festival world, not to the showroom body.

### 2.2 D7 colourways (the 37 closed bodies, plus open-wheel, karts, buggy)

- `vehicle-bodies/colourways.ts` (data, no three.js): 47 `Colourway`s keyed by vehicle id: primary, secondary, accent, `layers` (`roof`, `lower`, `bonnet`, `nose`, `stripes`, `flash`) and `pin`.
  47 distinct primaries; 10 chromatic hue families plus 8 neutrals; the largest family is the warm 30-60 degree group (8 machines, mostly cream, sand and ochre);
  16 machines use a `lower` band, 14 a `roof`, 3 a `bonnet`, 1 twin `stripes`. No machine of a class shares a primary (test). Three machines are still red (XT-1 crimson/black, GB-4 rally red, RS-5 burgundy).
- `vehicle-bodies/body-livery.ts`: the two-tone/stripe layers as one uniform-driven paint hook, installed before the panel gaps so shut lines still cut the second colour. Car-space
  (`vPaintPosition`) masks with filtered edges, so the line is crisp close up and dissolves at distance. A livery edit changes uniforms only: no recompile, no rebuild. The festival contact finish clones paint
  and keeps the hook by reference; `festival-car-finish.test.ts` still passes with EH-3.
- Whose colour: entrant 0 (the player's machine) wears the colourway. **Rivals keep team colour** (`LIVERIES`, which the HUD, tower and minimap also use) and keep exactly the shader program they had (test: no layer hook on a rival).
  Machine colourways for AI rivals were not done. (Rivals' drivers do get the new helmet, neck and shoulders, in team colour.)
- Player override: `VehicleBodies.setPlayerLivery(livery)` (also called from `Renderer.setLivery`, so the Photo Studio's live preview and the saved team livery reach catalogue bodies, and from `FestivalSession.boot` through a new optional
  `FestivalHost.livery()`). An edit that differs from the default identity (`liveryOverrides`, the same test as `liveryCustomised`) recolours paint, accent, helmet, suit and the number board in place; the pattern picks the layer
  (split = lower band, sweep = flank flash, minimal = none); the default livery returns the machine colourway; a corrupt save falls back to it. **Before this change a catalogue body ignored the livery editor entirely** (only `FormulaCar` read it), so this is new behaviour, not just kept behaviour.
- Test change to disclose: `festival-vehicle-detail.test.ts` "releases replaced and cleared cars once" listed the driver suit as a shared, never-disposed material. The suit is now per car (a livery edit has to recolour it without touching other cars), so the test's `ownedResources` lists it and `shared` no longer does.
  The assertions (each owned resource disposed exactly once, shared ones never) are unchanged.

### 2.3 D6 open-cockpit driver

`addDriver` (`common.ts`) is shared by 14 open-cockpit machines and the closed cabins. New: curved wrapped visor (both edges droop toward the cheeks) inside a thin accent rim, a chin guard, a crown stripe in the accent,
helmet shell in the livery colour (it was always the accent, i.e. white), an open-face dome with skin and goggles on a strap for historic cars, neck, HANS yoke, shoulder caps and a rounder torso.
Segment counts drop at LOD2 and the crown stripe is left out. `DriverArms` anchors (shoulder, rest elbow, glove) are untouched, so the arm solve and full-lock sweep are as before: `driver-arms.test.ts` 13 passed.
Look at `compare-d6-drivers.jpg`: a recognisable helmet, neck and shoulders in the car's colour, but still a toy-like figure with a flat black visor and no face detail; D6 is improved, not closed.

### 2.4 D5 bikes

- SS-600 and SBK-1000 (`bike.ts`, `gp-race-bodywork.ts`, `bike-sheet.ts`): the Blender egg cowl, black belly pan, accent stripe and number plates are gone. They wear the GP race shell's moulding set as a `'sport'` variant
  (pointed nose with ram-air mouth, tall screen, creased flanks, tank, tail, inner fairing; forks are visible) **without** the box wings and ground-effect scoops. Screen height follows the sheet (SS-600 1.1, SBK 1.0).
  The player's SS-600 and SBK-1000 wear team schemes 5 (blue) and 4 (white and sky blue) through `SHELL_SCHEME`, applied to shell, paint and rider so the bike is not mismatched with a red rider.
  GP-R1 and GP-R2 are pixel-near-identical to their baselines (0.216 and 0.380).
- CR-750: a bullet half-fairing with a round lamp in a bright rim at headlamp height, ahead of the fork legs (which are visible); the flyscreen is removed (`screen: 0`) because it showed as a grey smear behind the bullet.
  It reads as a cafe racer, but the bullet is still a plain loft, a little torpedo-like. Open.
- Cost: the sport shell adds triangles to two machines; both stay under the GP prototypes' 110,000 gate at high LOD and shrink at mid and far (test).
- `gp-bodywork.ts` and its Blender mesh are no longer used in production (tests still read them): remove in a later cleanup.

### 2.5 D10 karts and D11 trucks

- Karts: nose cone and side pods are moulded ellipsoids instead of slabs and boxes; the gearbox kart (SK-125) gains a chrome front bumper on stays. Honest look at `compare-d10-d11.jpg`: the pods now read as moulded plastic,
  the nose is still a flat shell (it reads as a leaf), and the two karts are still near-identical models differing by colour, pods and bumper. **D10 remains open.**
- DX-8 trophy truck: a row of four lamps on the bullbar, an accent-colour frame round the grille, a steel bumper beam with tow hooks. It reads as structure now, not a black block (part of that black was my own `lower` colourway band, which the new parts break up).
  RP-6: the truck grille crossbar is satin steel instead of chrome, which removes the white glint the audit listed under D8. RP-6's front is otherwise as before.

## 3. Colourway and livery data flow

`bodyLook(vehicleId, entrant, sheet, livery)` -> `BodyLook {primary, secondary, accent, layers, pin, helmet, suit, number, source}` -> `carMaterials` (paint, accent, helmet, per-car suit, number board) and the paint's layer handle
-> uniforms. `source` is `'team' | 'colourway' | 'livery'`. `buildVehicleBody(id, def, sheet, livery?)` is the one entry point; `scripts/studio/tools/list-machines.mts` and `colourway-stats.mts` print the data.

## 4. Capture, regression and what the numbers say

`scripts/studio/tools/vehicle-diff.py` compares two capture folders (mean abs per-channel diff over the whole frame, share of pixels differing by more than 24 levels, bounding box). The showroom orbit is deterministic, so an unchanged
machine is pixel-identical up to edge noise.

| Group                                       | Machines                                                                                     | Mean abs diff vs `vehicle-screens/`                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged by design                         | APX-01, GP-R1, GP-R2, NR-900, MX-450, SM-450                                                 | 0.000, 0.216, 0.380, 0.303, 0.314, 0.485                                                                                                 |
| Unchanged by design, just over the 0.5 line | MX-250                                                                                       | 0.566. The amplified diff image is silhouette-edge noise only (0.19 % of pixels, no structural change)                                   |
| Changed on purpose                          | 50 machines: the 47 catalogue bodies (each has a colourway) plus SS-600, SBK-1000 and CR-750 | 0.63 (GB-4, red to red) to 5.63 (HH-2); every one was looked at in five contact sheets, and 22 are compared in `compare-*.jpg` in detail |

Nothing regressed that I could see: no missing parts, floating wheels, z-fighting or broken body in any of the 57 shots; the game's error screen never appeared; the manifest lists 0 failures and 0 console errors.
Capture throughput under host load 10-25: boot 82-142 s, then 5-37 s per machine; the 57-machine run took 15.6 minutes. A first capture of a build still being written got a stale page; the affected PR-2 shot was redone on a finished build.

## 5. Verification actually run

| Command                                                                                                                                                                                                                                                                                                                                                                                             | Result                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` (final tree)                                                                                                                                                                                                                                                                                                                                                                     | 0 errors                                                                              |
| `npx eslint` on all changed `src/`, `tests/`, `scripts/` files                                                                                                                                                                                                                                                                                                                                      | clean                                                                                 |
| `npx prettier --check` on the same files                                                                                                                                                                                                                                                                                                                                                            | clean (one 3-line reflow in `festival-nose-construction.test.ts` applied)             |
| `npx vitest run tests/vehicle-colourways.test.ts`                                                                                                                                                                                                                                                                                                                                                   | 14 passed                                                                             |
| `npx vitest run tests/bike-sport-shell.test.ts`                                                                                                                                                                                                                                                                                                                                                     | 6 passed                                                                              |
| `npx vitest run tests/festival-vehicle-detail.test.ts`                                                                                                                                                                                                                                                                                                                                              | 11 passed (5 new EH-3)                                                                |
| `npx vitest run tests/driver-arms.test.ts tests/vehicle-pose-probe.test.ts`                                                                                                                                                                                                                                                                                                                         | 13 + 4 passed (the animation probe: steering, wheel spin, suspension, lean unchanged) |
| `npx vitest run` on the nose, rear, side and surface construction files (EH-3 included)                                                                                                                                                                                                                                                                                                             | passed                                                                                |
| One final run of 23 files: the files above plus vehicle-bodies (4), vehicle-cabins (9), festival-car-finish (7), festival-vehicle-glazing (3), festival-wheel-construction (5), tire-contact-animation (10), shadow-proxies (8), bike-bodies (2), gp-race-shell (9), gp-appearance (13), vehicle-catalogue-growth (13), bike-cockpit-view (8), motorcycle-presentation (7), open-world-session (10) | 23 files, 175 tests, all passed                                                       |
| `vite build`, `vite preview --port 4216`, `vehicle-shots.mjs --all`                                                                                                                                                                                                                                                                                                                                 | 57 of 57 captured, 0 failed, 0 console errors                                         |

The full vitest suite and `npm run check` were not run (shared host rule). Known-red baseline files in `BOARD.md` were not touched.

## 6. Still broken, not done, not verified

- **Livery override in the real Photo Studio and in a festival session: not tested.** The Photo Studio only opens in-session and in-session capture does not complete on this software-GL host (wave 2a, section 9). Covered by unit tests on the real `VehicleBodies`
  (colour, layer, number, in-place update, garage swap, rival isolation), not by a browser.
- Festival traffic/rivals: rivals keep team colour; ambient traffic is the separate instanced traffic model and was not touched.
- EH-3: articulated rear aero in the showroom, tail bar and arch lighting in an image (the orbit does not show the tail; the arch line is visible only at the front wheel), D8 splitter/glint.
- D10 (karts still near-identical and low detail), CR-750 bullet shape, helmet detail (flat visor, no face), D8, D9 showroom backdrop.
- Bikes other than SS-600 and SBK-1000 (GP-R1, GP-R2, NR-900, MX-450, MX-250, SM-450, CR-750) keep the team-red scheme: they were out of D7's scope but the showroom still shows five red bikes.
- Brake lights, lit arches and the signature bar were not looked at at night; light bars are always on, with no night boost.
- GPU look: all captures are SwiftShader. Emissive bloom, flake and clear-coat read differently on a GPU.

## 7. Recommended next tasks (ranked)

1. Colourways for the bikes (`bike-livery.ts`/`BikeMaterials` per machine) and for AI rivals in the festival, so the whole showroom and the festival field show variety.
2. In-session livery verification on a GPU host: open the Photo Studio, edit the livery on EH-3, SC-7 and a bike, screenshot, then start a festival run (`vehicle-drive.mjs`).
3. EH-3 follow-ups: showroom tail view, articulated aero, a night boost on the signature light, then one grazing-Fresnel pass (D8) for the splitter and truck glints.
4. D10: a real kart nose and a body difference between SK-125 and DK-100 (a different chassis class, not a recolour); CR-750 fairing refinement.
5. Driver detail: a visor with a gradient and reflections, face for open-face helmets, gloves in the accent.
6. Delete `gp-bodywork.ts` and `assets/gp-bodywork.mesh.json` once `gp-cowl-normals` and `motogp-reference` tests are retargeted.

## 8. Commits

`05bf39f` EH-3, colourways, drivers, truck and kart fronts; `3b099f9` bikes; a third commit adds this report, the capture folder and the diff and statistics tools.
