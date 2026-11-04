# Vehicle Art & Animation, wave 3

Branch `studio/vehicle-art-3`, cut from `main` at 0b8ec67 (which carries the original authored APX-01, the A61 levels, the
VOLTEX livery and wave 2). Everything below was measured or looked at on this branch; "not tested" is said where it applies.
Scope from the PM: raise the screenshot appeal of the hero cars and close remaining defects, in order: (1) APX-01,
(2) D5 CR-750 and the GP-R1 corner frame, (3) D10/D11 karts and trucks, (4) D8 grazing highlights, (5) animation probe.
`which blender` is empty on this host: all work is procedural code in `src/rendering/` (no `.blend` or GLB was touched; the
hash-pinned A61 / `apx01-shell` assets are unchanged). `scripts/ip-denylist.mjs` stays clean: the IP guard ran inside every
`vite build` I made (`IP guard: clean`) and `tests/ip-audit`, `ip-denylist`, `ip-guard` pass.

## 1. Status

| Item                                                      | Result                                                                                                                                                                                                               | Evidence                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. APX-01 livery                                          | **Done.** Aero endplates indigo with a volt rail; the fictional sponsors are decals (title on both endplates, a partner mark on the rear plate, both partners on the rear wing's upper element)                      | `compare-apx01-showroom.jpg`, `compare-apx01-lab-wings.jpg`, `compare-apx01-lab-closeups.jpg`, `lab-after-apx01-wingTop.jpg` |
| 1. APX-01 wings / "white stripes"                         | **Done.** Root cause found (section 4): the wings are now raw satin carbon, front, rear and beam                                                                                                                     | same sheets, `before-apx01.jpg` / `apx01.jpg`                                                                                |
| 1. APX-01 paint / clear coat                              | **Not changed** beyond D8. Pearl iridescence was tried in the lab and rejected (section 3.2)                                                                                                                         | lab experiment only                                                                                                          |
| 1. APX-01 cockpit, driver, wheels, tyres, floor, diffuser | **Inspected, not changed** (section 3.3): no defect found at this level that code can fix; the gap to a photographic cockpit is asset work                                                                           | `lab-after-apx01-helmet.jpg`, `lab-after-apx01-cockpit.jpg`, `lab-after-apx01-diffuser.jpg`                                  |
| 1. APX-01 brake-disc glow                                 | **Already present; verified** with a temperature sweep in the probe and visible in the lab corner shot. Heat shimmer: **not done** (needs a refraction pass, not cheap)                                              | probe table, `lab-after-gpr1-bikeKnee.jpg` (GP-R1 rotor)                                                                     |
| 2. D5 CR-750 fairing                                      | **Improved, not finished**: the bullet tapers to a glass nose with a bracket instead of a tin can                                                                                                                    | `compare-cr750-lab.jpg`, `compare-cr750-gpr1-showroom.jpg`                                                                   |
| 2. GP-R1 corner frame                                     | **Done for the model and the capture tool**: knee-slider sparks, rotor glow at braking, a 57 degree corner preset. **Not wired** into the Photo Studio UI (UX-owned)                                                 | `compare-gpr1-corner-lab.jpg`, `lab-after-gpr1-bikeKneeRear.jpg`, `tests/vehicle-art-3.test.ts`                              |
| 3. D10 karts                                              | **Improved, still low detail**: moulded panels, two different noses, pods with inlets, a front axle                                                                                                                  | `compare-karts-lab.jpg`, `compare-karts-trucks-showroom.jpg`                                                                 |
| 3. D11 trucks                                             | **Improved**: upright face, lamps in the face, arch lips, plated bumper                                                                                                                                              | `compare-trucks-lab.jpg`, `compare-karts-trucks-showroom.jpg`                                                                |
| 4. D8 grazing highlights                                  | **Partly done**: a shader hook on paint and carbon (nose, splitter, bonnet highlights calmer on 35 bodies), plus the wing-material fix for the case it did not reach. The windscreen-base flare (glass) is untouched | `compare-d8-showroom.jpg`, `tests/grazing-cap.test.ts`                                                                       |
| 5. Animation probe                                        | **Extended** (section 6): APX-01 through the production path, kart and truck bodies, GP knee sparks                                                                                                                  | `tests/vehicle-pose-probe.test.ts`, 9 tests                                                                                  |
| All 57 machines captured, numeric diff                    | **Done** (section 5): 57/57, 0 errors                                                                                                                                                                                | `vehicle-screens-3/`                                                                                                         |

All captures are SwiftShader (software GL), 1280x720, menu chrome hidden. Before = the `main` build (0b8ec67) captured with the same
harness at the start of this wave; after = this branch. The showroom orbit is deterministic, so the pairs are a fair A/B.

## 2. What changed

### 2.1 APX-01 hero livery (`src/rendering/apx01-livery.ts`, `car.ts`)

The base livery (`car-livery.ts`) is shared by the twelve team schemes and left the aero in loud accent colour: on the VOLTEX car the
volt-green front endplates were the largest, flattest shape in every screenshot, and the rear endplates carried a dark gradient with
nothing on it. The player car now wears its own layer on the same paint material (`HeroLivery`, only for entrant 0 on the authored car;
rivals are unchanged, tested):

- front endplates (all faces): indigo (the scheme's secondary) with a volt rail along the top edge; the title sponsor along the outer face;
- rear endplates: indigo with a volt rail, the title and a partner mark;
- rear wing upper element: both partner marks in volt ink, readable from behind;
- the marks are the fictional brand atlas (`brand-atlas.ts`), drawn once into a 1024x512 RGBA atlas and projected onto the flat plates and the
  nearly flat wing in car space. An outward-normal varying (`vHeroN`) keeps the decal off the inner face of a plate (that face would be mirrored);
- a livery edit repaints the same texture (`HeroLivery.repaint`, called from `FormulaCar.setLivery`), so the sponsor text and the accent follow the
  Photo Studio / team livery;
- no triangles, no extra draw call, no light. Frames were fitted to the real near-level plates, and `tests/apx01-livery.test.ts` pins them
  to the decoded `a61-rival-near` geometry so an asset change cannot silently move a decal off its plate.

The wings' `alloy`/carbon roles use a satin carbon (specular 0.3, roughness 0.62) instead of turned aluminium and lacquered carbon (section 4).
Net: the player's near level is **229,000 triangles in 93 draws** in the lab census (95 before, same triangles); the 250,000 budget of
`tests/a61-rival.test.ts` and the e2e budget (not run) have the same headroom as before.

### 2.2 D8 grazing-Fresnel cap (`src/rendering/studio/grazing-cap.ts`)

A shader hook (`grazing-cap-v1`, house hook style, idempotent, baked constants, no uniform) chained on car paint (`installTeamPaint`, `flankLivery`,
`bodyPaint`, the APX accent) and on `carbonMaterial()`. For a skin that faces the sky and is seen at a glancing angle it:

- scales the specular and clear-coat IBL radiance by `1 - 0.85 * up * (1 - N.V)^1.6`;
- clamps what is left to `1.4 / weight` sky units (a bare multiplier cannot tame the sun disc, which is tens of times brighter than the sky);
- applies the same factor and a `1.1 / weight` ceiling to the direct specular and the clear coat's direct specular after the lights are summed.

A side flank (`up = 0`) and a bonnet seen head on keep exactly the radiance they had; roads, glass and venue materials do not carry the hook
(the weather team wants a wet road's grazing reflection). **No pinned lobe constant changed**: `tests/supplied-lookdev.test.ts` (clear coat 0.6 /
roughness 0.08 of the owner-supplied look-dev) is untouched; the cap lives in the shader only. CPU references (`grazingCapFactor`,
`grazingCapCeiling`) and 4 tests pin the maths and the injection order (after the IBL fetch, before the IBL gain, direct term before the totals).

### 2.3 D5 CR-750 and the GP-R1 corner frame (`bike.ts`, `rider.ts`, `gp-slider-sparks.ts`, `menu-preview.ts`)

- CR-750: the six-section torpedo ended in a flat disc and read as a tin can. The loft now tapers to a nose that _is_ the lamp: a glass dome in a
  chrome rim on a short bracket under the shell. It is a rounder, more cafe-racer shell; it is still an egg, not a full fairing.
- Knee-slider sparks: the rider solver already folds a knee back until its slider skims the road (`gpClearJoint`); it now records that contact
  (`Rider.kneeDown`) and `GpSliderSparks` draws it as 36 additive sprite points per slider, a **pure function of the presented time** (hash of
  spark index and burst cycle, world gravity in the machine's frame, no pool, no wall clock, identical after a seek). Gated twice: the clamp must be
  engaged AND |lean| must pass 0.72 rad, ramping in to 1.0 so it never pops. The spark origin is the shin bone's transform of the slider's fixed offset
  (`Rider.kneeSliderWorld`): the first version looked the mesh up by name and found it merged away (caught in the lab, fixed).
- Rotor glow at braking was already there (`gpDiscGlow`, red from 620 C). In the corner shot at 900 C it is the red ring on the front disc.
- Corner preset: `GP_CORNER_PRESET` and an optional `MenuPose` for `menuPreview` (57 degrees of lean, 25 cm hang-off, hand on the brake, 900 C rotors,
  chassis quaternion rolled about its contact patch). The car lab renders it (`--preset corner`); a unit test checks 55-60 degrees, the roll and that
  the real `BikeShells` lights the sparks from it.

### 2.4 D11 trucks and D10 karts (`closed-body.ts`, `open-wheel.ts`)

- Trucks: the bonnet profile stayed level almost to the face and then dropped square (it used to droop like a sports car and left no face for hardware).
  `DX-8` (the only truck outside the festival detail kit) gets round headlamps with trim rings and a driving lamp below each in the face; every truck gets a half-ring arch lip
  round each wheel arch; a truck without a bullbar (`RP-6`) gets a plated bumper with two fog lamps and tow hooks. All `detail < 2` only.
  `RP-6` uses the festival lamp kit, so its hood-edge lamp pods are unchanged.
- Karts: the nose cone, the side pods and the nose ridge are `mouldedPanel` extrusions with rounded edges instead of ellipsoids. SK-125 gets a long wide wedge
  with a ridge behind the chrome bumper and long pods with an inlet; DK-100 a short pointed cone and short pods; both a front axle and track rod.

### 2.5 Tooling

`scripts/studio/tools/car-lab/` (new): the production classes (`FormulaCar` with the A61 levels and the authored driver, `VehicleBodies`, `BikeShells`) in a
minimal studio scene, 20-60 s per machine instead of a game boot, any named view and pose (`--pose`, `--preset corner`, `--eval`). It is _not_ the game's
lighting (no sky, grade, DOF), so lab shots are compared with lab shots; the showroom captures are the evidence for the final look. Row added to the tools README.

## 3. Honest look

### 3.1 What reads better

- **APX-01** (`compare-apx01-showroom.jpg`): the lime slab is gone; the front wing reads as violet planes, dark satin flaps and an indigo endplate with VOLTEX; the rear
  endplate carries VOLTEX / KESTREL TIME and a volt rail; the rear wing top carries the partners (lab `wingTop`). It is a coherent livery now, not an accent-colour afterthought.
- **D8** (`compare-d8-showroom.jpg`): the white-hot spots on GT-8F's nose and splitter, XF-2's nose and splitter lip and SC-7's bonnet are visibly calmer; the paint keeps its
  clear-coat highlights on the flanks. **XF-2's windscreen-base star is still there**: it is glass, and glass carries no hook (left alone on purpose in this pass).
- **Trucks, karts**: the DX-8 and RP-6 fronts are square, with hardware, instead of a rounded hump; the karts have a bodywork shape and two different silhouettes.
- **GP-R1 corner** (`compare-gpr1-corner-lab.jpg`): the lean, hang-off and red-hot rotor make a real hero frame. The sparks are small: from three metres they are a few gold dots
  behind the knee (`lab-after-gpr1-bikeKneeRear.jpg`); a close camera shows them better.

### 3.2 Still weak, said plainly

- **APX-01 in the showroom is still a small, dark car on a black void** (UX owns the framing and the backdrop, D9). The deep indigo reads flat there and nothing separates the body from the
  void; a showroom rim light would do more for this screenshot than any model change.
- Paint: I tried `iridescence 0.4` on the hero paint in the lab (`irid-*`/`pearl*` runs): a faint magenta/teal shift at grazing angles, but it also turned the indigo endplates
  purple and costs a shader feature for one car. Rejected, not shipped.
- A few thin dark authored strakes cross the rear endplate decal (visible in `compare-apx01-lab-closeups.jpg`); they are part of the `rear_carbon` asset.
- **Karts are still toy-like**: the driver is the shared pawn with a flat visor, there is no seat shell or steering column detail, and in the showroom a kart fills about a fifth of the
  frame (`showroomFit` floor, UX).
- **CR-750** is a smooth egg with a lamp, not a half fairing with a screen.
- **DX-8**: the new face lamps and the existing bullbar lamp row crowd each other; **RP-6**'s hood-edge pods (festival kit) look like an afterthought on the new square face.
- Cockpit, driver, tyres and floor: see 3.3.

### 3.3 Inspected, not changed (APX-01)

Lab views at the real cockpit eye (0, 0.41, -0.48) and a helmet close-up: the butterfly wheel with its live display, rev lights and buttons, violet gloves on the grips, the carbon-weave halo,
the team helmet with its iridium visor, the HANS tethers and the sidepod inlet all read cleanly at the distances the game uses; the helmet livery follows the team colours. Tyre sidewall
text is `MOTOBOUND` / `SLICK 18` (fictional marks only) and reads the right way round; I first suspected a mirrored sidewall and checked it. The diffuser and floor edges are authored
geometry (scalloped around the tyres, fences present). I found no defect I could fix in code at this level; the photographic cockpit gap measured by the IP agent is asset work (section 8).

## 4. D8 root cause: the white stripes were the wings' material, not a grazing angle

The audit called the APX-01 front-wing flaps "blotchy white" a grazing-Fresnel effect. Measured in the real showroom build:

| Experiment (real `vite build`, one machine, one capture each)                  | Flaps                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------- |
| baseline                                                                       | white-cream                                        |
| wing carbon replaced by a flat red `MeshBasicMaterial`                         | red: the strips are the wing carbon / alloy meshes |
| grazing cap on paint and carbon (both strengths, with ceiling and direct term) | **unchanged**                                      |
| wing carbon cloned with clear coat 0                                           | still white-cream                                  |
| wing carbon with clear coat 0, specular 0, roughness 1, anisotropy 0           | dark                                               |
| wing carbon as the floor's satin carbon                                        | warm grey                                          |
| wing carbon as satin with specular 0.3, roughness 0.62 (shipped)               | dark taupe                                         |

So the whiteness is the base specular lobe of lacquered carbon mirroring the bright sky and sun at the flap's _tilt_ (N.V about 0.5, a mirror geometry, not a grazing one), which a
grazing-angle cap cannot reach. The cap does work where the geometry really is grazing (splitters, noses, hood edges: section 5). Why the cap did not move the flaps in
the game while the same hook darkens them in the lab: not isolated (the lab uses a room environment, the game a physical sky with a sun disc; my ceiling should have bitten but did not
move the pixels). I stopped at a material fix that I could verify and left the question open (section 8).

## 5. Capture and regression

`docs/studio/reports/vehicle-screens-3/`: `<id>.jpg` for all **57** machines (final, 24-46 KB), `before-<id>.jpg` for the 14 machines that changed on purpose, the compare sheets,
`manifest.json` (57 shots, 0 failed, 0 console errors), `before-manifest.json`, `diff-vs-baseline.json`, `diff-vs-wave2a-screens.json`.
Throughput under host load 4-8: boot 52-70 s, then 4-17 s per machine; 57 machines in 11.8 minutes for the baseline (706 s) and 10.5 minutes for the final run (629 s).

Numeric diff vs the `main` baseline captured at the start (`scripts/studio/tools/vehicle-diff.py`, mean absolute per-channel difference over the frame):

| Group                                                   | Machines                                                                                                                      | Mean abs diff                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Changed on purpose, body or livery                      | APX-01, DX-8, RP-6, SK-125, DK-100                                                                                            | 1.44, 1.85, 1.55, 1.26, 1.20                                            |
| Changed on purpose, small region                        | CR-750                                                                                                                        | 0.35 (the fairing is a small part of the frame, below the 0.5 line)     |
| Changed by the D8 hook only (paint / carbon highlights) | 35 closed bodies                                                                                                              | 0.53 (SP-71) to 1.37 (PR-3); every one looked at in five contact sheets |
| Unchanged by design                                     | the eight other bikes: GP-R1 0.13, GP-R2 0.07, MX-450 0.18, MX-250 0.09, SM-450 0.07, NR-900 0.04, SS-600 0.05, SBK-1000 0.06 | the bikes do not carry the hook and the framing did not move            |
| Closed / open-wheel bodies under the 0.5 line           | HF-86 0.47, RL-2 0.46, RG-63 0.42, CR-1 0.42, VC-62 0.40, HF-76 0.39, BG-2 0.25, HF-67 0.16                                   | a small highlight change                                                |

40 of 57 are above the 0.5 line; none of the 40 is unexplained: 5 are the intended restyles, 35 are the D8 hook on paint and carbon. No missing part, floating wheel, z-fight, black body or error
screen in any of the 57 final shots (five contact sheets, plus every changed machine eyeballed in a before/after pair). The literal comparison asked for, against the wave-2a baselines in
`docs/studio/reports/vehicle-screens/`, is in `diff-vs-wave2a-screens.json`: all 57 differ (4 to 6 mean abs on the busiest), because that folder predates wave 2's colourways and the
original APX-01 car; it cannot serve as a regression baseline any more, which is why the true A/B above was captured on `main` first.

## 6. Animation probe (numbers, not images)

`tests/vehicle-pose-probe.test.ts`, 9 tests (4 old, 5 new), real `Simulation` driven by the production AI, every 1/30 s snapshot fed to the production render classes:

| Quantity                                                                              | APX-01 (A61 levels, hero livery)                                                        | SK-125     | DK-100     | DX-8       | RP-6       | GP-R1                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ---------- | ---------- | ---------- | -------------------------------------------------------- |
| Peak speed in the run                                                                 | 81.6 m/s                                                                                | 33.7       | 29.0       | 48.8       | 44.3       | 73.7                                                     |
| Steering wheel vs recorded steer (Pearson r)                                          | -1.000                                                                                  | -1.000     | -1.000     | -1.000     | -1.000     | handlebar 1.000                                          |
| Front wheel yaw vs recorded `W.STEER`, max error                                      | 0                                                                                       | 0          | 0          | 0          | 0          | n/a                                                      |
| Rear wheel spin: rendered / recorded advance                                          | 1.000                                                                                   | 1.000      | 1.000      | 1.000      | 1.000      | 1.000 / 1.000                                            |
| Hub travel range                                                                      | 39.5 mm                                                                                 | 7.3 mm     | 5.4 mm     | 20.9 mm    | 22.5 mm    | fork 57.3 mm                                             |
| Hub vs recorded length r                                                              | -0.999                                                                                  | -0.962     | -0.920     | -0.930     | -0.920     | 1.000                                                    |
| Brake lamp, coasting / braking (controlled pair)                                      | 0.75 / 2.37 (lap)                                                                       | 0.55 / 3.2 | 0.55 / 3.2 | 0.55 / 3.2 | 0.55 / 3.2 | n/a                                                      |
| Driver arm bone lengths, range                                                        | 0.000 m (upper, fore)                                                                   | n/a        | n/a        | n/a        | n/a        | glove to grip 0.059 m, constant                          |
| Arms reach the wheel                                                                  | 100 % of 720 frames                                                                     | n/a        | n/a        | n/a        | n/a        | n/a                                                      |
| Rotor glow                                                                            | 200 C 0, 500 C 0, 600 C 0.222, 800 C 0.667, 950 C 1.0, 1300 C 1.778, 1600 C 2 (clamped) | n/a        | n/a        | n/a        | n/a        | n/a                                                      |
| Rider roll / chassis roll                                                             | n/a                                                                                     | n/a        | n/a        | n/a        | n/a        | 1.80 / 1.69 rad range                                    |
| Knee on the road (frames) / sparks drawn (frames) / smallest chassis roll with sparks | n/a                                                                                     | n/a        | n/a        | n/a        | n/a        | 62 / 61 of 780 / 0.721 rad (41.3 degrees, the 0.72 gate) |

Reading it: steering, steered wheels, wheel rotation, suspension and bike lean follow the snapshot with the right sign and unit gain on every new machine; the APX-01 lap stays under the 500 C
glow threshold (320 C peak on Aurel), so the rotor glow is probed with a temperature sweep on a rolling frame (every wheel, linear then clamped at 2); the driver's limbs are rigid and always
reach; the kart's brake lamp never lit in a free run (the AI never braked), so it is probed with a controlled coasting/braking pair; the sparks appear only with the road clamp engaged
and past the lean gate (never one without the other, asserted frame by frame). **Turn indicators and hazards do not exist on the player car, the catalogue bodies or the bikes** (ambient traffic
only): asserted by name on the APX-01 graph and recorded as absent by design, not as a gap in the probe. Rider hang-off and the gear/clutch hands were not sampled (as in wave 2).

## 7. Verification actually run

| Command                                                                                                                                                                                                                                 | Result                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npx tsc --noEmit` (final tree)                                                                                                                                                                                                         | 0 errors                                                                           |
| `npx eslint` on every changed `src/`, `tests/`, `scripts/` file                                                                                                                                                                         | clean                                                                              |
| `npx prettier --check` on the same files                                                                                                                                                                                                | clean                                                                              |
| `npx vitest run --maxWorkers=2` on 112 rendering/vehicle/bike/rider/paint/IP files (list: every test that names a touched module)                                                                                                       | 112 files, 1,204 tests, all passed                                                 |
| After the last three edits (knee origin, beam wing): `tests/vehicle-art-3`, `gp-slider-sparks`, `vehicle-pose-probe`, `bike-bodies`, `bike-animation`, `gp-rider-*`, `motogp-reference`, `bike-cockpit-view`, `motorcycle-presentation` | 11 files, 75 tests passed                                                          |
| and `shadow-proxies`, `hero-car-original`, `a61-rival`, `apx01-livery`, `a32-pit-jacks`, `vehicle-pose-probe`, `paint-livery`, `phase27e`                                                                                               | 8 files, 60 tests passed                                                           |
| New test files                                                                                                                                                                                                                          | `grazing-cap` (4), `gp-slider-sparks` (4), `apx01-livery` (4), `vehicle-art-3` (6) |
| `vite build` (product build, IP guard inside it) x8, `vite preview` on 4292-4297                                                                                                                                                        | built in 15-25 s, `IP guard: clean` every time                                     |
| `vehicle-shots.mjs --all`, baseline (`main`) and final                                                                                                                                                                                  | 57/57 each, 0 failed, 0 console errors                                             |

Two failures I caused and fixed along the way (worth knowing because they hide behind canvas stubs): the spark sprite called `createRadialGradient().addColorStop` on the headless canvas stub in 7 GP
tests (now guarded and falls back to square points), and my first apx01-livery assertion read `studioHookKeys` of a material that later installers re-wrap without the key list (now checks the compiled
program).

**Pinned tests I changed, with the reason (each carries a `TEST-UPDATE` comment):**

- `tests/paint-livery.test.ts`: the hook-key list of team paint (`+ grazing-cap-v1`), of a flank skin (`+ grazing-cap-v1`) and the two carbon program keys (`...|grazing-cap-v1`). The cap is a new
  chained hook; no lobe constant moved.
- `tests/shadow-proxies.test.ts`: rival LOD0 shadow draws 92 -> 90. The wings' alloy role is now carbon, so each wing merges its alloy elements into one mesh fewer; the shadow triangles asserted in
  the same test are unchanged.

Not run: the full vitest suite and `npm run check` (shared-host rule), any Playwright spec (`e2e/42-full-scene-index-budget.spec.ts` measures the player's draws and indices in a real scene; the lab census says
229,000 triangles and 93 draws, two fewer than before), a GPU, and an in-session capture of the final hero (`session-shots.mjs` costs about 6 minutes of boot and 20 s per frame here).

## 8. Still broken, not done, not verified

- **The D8 hook does not darken the APX-01 flaps in the real showroom** while it does in the lab; the shipped fix is a material fix (section 4). Nobody has found out why the clamp did not bite there.
  I would not claim the hook solves every up-facing carbon element in the game; it measurably calms paint (35 bodies) and splitters.
- **GPU look**: every number and image is SwiftShader. Bloom, the sun disc, clear coat and the new additive sparks read differently on a GPU.
- **Knee sparks and the corner preset were only seen in the lab**, never in a session or the Photo Studio. The preset is not offered anywhere in the UI (`photo-studio.ts`, `photo-camera.ts`, `renderer.ts`
  and `main.ts` are UI/UX-owned; the hook is `menuPreview(..., GP_CORNER_PRESET)`).
- Cockpit/driver, tyre, floor and diffuser: inspected, unchanged. Heat shimmer: not done. APX-01 paint beyond D8: not changed.
- D9 showroom backdrop and rim light: not mine, still open; it limits every screenshot of a dark car.
- Livery edits on the player's decals were tested at unit level (`setLivery` repaints the atlas); not exercised in a real Photo Studio session.
- The kart showroom framing (`showroomFit` floor 0.55) makes the new kart detail hard to see in the menu; UX owns it.
- `gp-bodywork.ts` and its Blender mesh are still unused in production (wave 2 note, unchanged).

## 9. Recommended next tasks (ranked)

1. A showroom rim light and a lifted void (D9, UX): the hero car is dark on black and small; this is worth more than any further model work for the capsule.
2. Find out why the grazing cap's ceiling does not move the flaps in the real build (a one-hour shader-debug on a GPU host: render `apexCapWeight` as colour), then decide whether the satin carbon is still needed.
3. Wire `GP_CORNER_PRESET` into the Photo Studio as a CORNER pose, and capture the corner frame in a real session (`vehicle-drive.mjs`/`session-shots.mjs` on a GPU host).
4. A real half fairing for the CR-750 (screen, lamp bowl, stays) and a kart seat shell, steering column and a livery-coloured pawn-free driver; kart framing in `showroomFit`.
5. Cockpit pass from the IP report: carbon surround detail, belts, helmet/visor tie-in; heat shimmer on the exhaust only if a cheap screen-space pass exists.
6. Colourways for the bikes and for AI rivals (wave 2's rec 1 is still open).

## 10. Commits

`45b2756` hero livery decals, D8 hook, truck fronts, kart panels, CR-750 bullet, GP knee sparks, car lab; `781e08f` the grazing cap's ceiling and direct term, satin wings, the livery test;
`228878d` GP corner preset, the extended probe, body tests; `9515fab` knee origin from the shin bone, larger sparks; `d4d640b` the beam wing in satin carbon; and the commit that adds this report and `vehicle-screens-3/`.
