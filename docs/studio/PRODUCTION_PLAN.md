# PRODUCTION PLAN: Apex Formula, "F1 25 look" programme

Owner: Studio Producer / Executive Producer. Status: plan only. No source file was changed and nothing was committed.
Inputs: `ART_BIBLE_A.md` (AB-A), `ART_BIBLE_B.md` (AB-B), `GAP_ANALYSIS.md` (GAP), `TECH_RENDER_MAP.md` (TRM),
`TECH_WORLD_MAP.md` (TWM), `TECH_ACTORS_MAP.md` (TAM), `TECH_UI_FEATURES_MAP.md` (TUF), `TECH_TEST_MAP.md` (TTM).
All line numbers refer to HEAD `3a6036d`. Rebase first and re-locate anchors by content if the lines have moved.

**Mission.** Push Aurel/Vellamar toward EA F1 25 on PS5 in Three.js r180 only. The targets are: hyper-real lighting and
materials; dense, branded venues; a motion language; F1-style HUD and front end; and the missing F1 mechanics. Every result
must be measurable against the reference images (described in words only; never copy them) and must keep the test and
asset contracts intact.

**Shape of the programme.** There are 33 departments in 3 waves and 17 two-department slots, because the 4-CPU box allows
only 2 concurrent departments. Each department works in its own worktree on `studio/<id>`. It rebases and pushes to
`claude/funny-mayer-78089j`, and it commits and pushes after every green increment.

---------------------------------------------------------------------------------------------------
## 1. Producer decisions (canonical values where the docs disagree)

| # | Topic | Conflict | **Decision** (binding for all departments) |
|---|---|---|---|
| P1 | Day sun elevation | AB-A says 50-58° (measured short shadows); GAP says ~32° | **50°**. `SUN_OFFSET (-140,235,-115)` with azimuth kept. lighting-ibl updates the shadow-grid and anchor tests in the same commit. |
| P2 | Sunset elevation | 6.1° now | **≈10°**: `SUNSET_OFFSET (-215,45,-150)`. Key `#ffb26b`, violet shadows `#2e3550-#3a4660`. |
| P3 | Fill / IBL split | AB-A: env 0.38-0.45 with hemi recolour. GAP: env 0.8, fill 0.05, sun 3.4. TRM: apexSpecularIBL | **Diffuse** `environment = 0.42 + 0.08·cover`, so it rises with cover. **Hemisphere** `#8fb6ea`/`#4a4237` at `0.14+0.30c`. **Sun** `3.9·(1-0.94c^1.45)`, colour `#fff0dc`. **Specular** IBL is normalised to the visible dome: shared uniform `apexSpecularIBL = clamp(1/environment, 1, 3.5)`. PMREM gets a ground hemisphere at albedo ≈0.14. Never lower env to hide a bad albedo; fix the material. |
| P4 | Asphalt tone | palette vs shader | Both are allowed. Palette `[106,101,96]` passes the `race-surface-atmosphere` R∈(50,120) guard. Binder `.92+broad*.08`. Judge by the capture: sunlit `#7d7a76-#938b83`, B/R 0.88-0.95. |
| P5 | Chase framing | AB-A: car 38-45 % of width; AB-B: 29-30 % | **36-42 %** (PSQ036 is the primary ref). fov 58→**50** (+4 at speed), distance 5.7→**4.9**, height 1.95→**1.65**, lookAhead 10→13, lookLift 0.42→0.40. Horizon y 0.40-0.44. |
| P6 | Cockpit FOV | 54-56 vs 52 | **54** default through the new graphics key `cockpitFov` (range 44-70). eyeOffset `[0,-0.03,-0.04]`, pitch -0.035. |
| P7 | T-cam | 56 vs 60+5 | vertical fov **58 + min(4, 0.05·v)**, `TCAM_PITCH` -0.06 → **-0.075**. |
| P8 | Compound colours | 3 palettes | `config.ts` COMPOUNDS: soft `#e2262f`, medium `#f5c400`, hard `#f2f2ee`, inter `#2bb04a`, wet `#0a6fd0`. The HUD reads the same values through CSS vars set at install. |
| P9 | Kerbs | 3 m `0xdc553b/0xe8e3cf` | **1.1 m** shader stripes `#c4222a`/`#ecebe6`. The vertex colours at circuit.ts:489 are ignored. |
| P10 | Motion blur | 0.3/0.45 vs 0.35/0.5 | Low 0 / **Medium 0.35** / **High 0.5**. 12 taps, max 3.5 % of width, followed car sharp. |
| P11 | Bloom | | Threshold 3.6 kept. Strength day 0.45, sunset 0.55, night and wet 0.8. Emitters get HDR intensities instead. |
| P12 | Fog / haze | 0.000205 now | Clear `0.00055` at ground with a height falloff of `exp(-(y-y0)/150 m)`; overcast 0.0008; rain 0.0015-0.002; sunset 0.0006; night 0.0004. The colour is view-dependent (sun side `#c9d3dc`, anti-sun `#9db8d3`). |
| P13 | Real marks on the supplied RB19 | GLB carries real sponsor decals | GLB bytes stay untouched (hash-locked). vehicle-paint swaps each real-sponsor `Decal | …` map **at runtime** for an original wordmark from `studio/brand-atlas.ts`. All new art uses fictional brands only. |
| P14 | Dev entries in the menu | hide behind `?dev=1` vs e2e/28 and e2e/30 click them | They stay in the DOM and stay clickable, restyled as a compact low-emphasis TOOLS row. No e2e edits. |
| P15 | HUD layout contracts | the bottom-centre cluster fails e2e/28 L74 and e2e/52 L62 | hud-race makes **only** these deliberate edits: 28 L74 → `left > vw*0.3 && right < vw*0.7`, and 52 L62 → a no-overlap check. Every other assertion stays. |
| P16 | Draw budget | sunset headroom is 4 calls | Allocation in §3. **performance-budget is the only department that re-pins** `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`, once, in slot 16, capped at **+8 %**. |
| P17 | New GraphicsOptions keys | | Only render-core adds them, in one commit: `temporalAA:boolean` (all presets false), `lensEffects:boolean` (false/true/true), `cockpitFov:number` (54, clamped 44-70). No other department adds keys; ask the orchestrator instead. |
| P18 | Rival rebuild from hero geometry (GAP #20) | | **Not scheduled.** The hero is IP-encumbered and the GLBs are hash-locked. Rivals are upgraded at runtime by vehicle-rivals, vehicle-paint and vehicle-tyres-wheels. |
| P19 | Fictional brand list (canonical) | | VOLTEX, NORDFIN, KESTREL TIME, HALCYON AIR, ORBITEL, MERIDIAN OIL, AUREL BANK, VANTA, NORTHLINE, OBSIDIAN. Tyres: APEX CORSA / SLICK 18. Only names on this list (or new invented names added to `brand-atlas.ts`) may appear in textures. |

---------------------------------------------------------------------------------------------------
## 2. Studio rules (every department, no exceptions)

1. **Workflow**: TTM §11 recipe verbatim, with `DEPT=<id>`, `PORT=4300+15·k` (k = department number below), and
   `PORT2=PORT+1`. Run captures under `flock $S/capture.lock`. Never touch port 4173. Never `pkill -f`; use `fuser -k`.
2. Read the studio docs by **absolute path** `/home/user/Experiment-3/docs/studio/*.md`. **Never commit `docs/studio/`.**
3. `git add <explicit paths>` only (never `-A` or `.`). Check `git status --short` first; the `node_modules` symlink and
   `browser-progress.json` must never be staged.
4. **Commit and push after every green increment**, at least once per goal. Message: `feat(<id>): <what & why>`.
   Body lines: `Draw: day <n> (Δ<x>)`, `Capture: $S/shots/<id>-vN`, and, for any pinned-value change,
   `TEST-UPDATE: <file>:<line> <old>→<new> because <reason>`. End with the session attribution trailer.
5. **Before every push**: `npx tsc --noEmit`, then `bash $S/tools/fastcheck.sh <area…>`, then your `tests_to_run`.
   Add `npm run lint` if you touched tests/, e2e/ or scripts/. Run `npm run build` before any capture.
6. Integrate with the fetch → rebase → re-check → push loop (TTM §11 step 5). **Never force-push.** If a conflict falls
   outside your `may_touch`, abort and report it. If a test breaks after a rebase, do not "fix" another department's
   numbers; report it.
7. **Hash-pinned files are read-only**: `public/models/*`, `src/rendering/*.glb.gz`, `*.geometry.json`, `*.manifest.json`
   hashes, `scripts/author-*.py`, `scripts/*.blend`, `src/rendering/pit-building-layout.ts`, `docs/MASTER_DIRECTIVE.md`,
   `docs/IMPLEMENTATION_MATRIX.md`, `docs/PLAYER_INDEX_CACHE_AUDIT.json`, `playable/`. The baseline JSON may be edited by
   performance-budget only. Change authored assets at runtime, after decode and outside `decode*()`, so that the
   material and mesh counts stay intact.
8. **Determinism**: pixels may depend only on presented sim state (`H.TIME`, or `studioTime` from render-core). No
   `Math.random`, `Date.now` or `performance.now`. Held, paused and rewound frames must be byte-identical. Reset on cuts.
9. **Shader hooks** use `studio/shader-hooks.ts` (chain the previous `onBeforeCompile` exactly once, append the cache key
   `|<id>-vN`, use an idempotent marker). Module-scope ShaderChunk patches must still match the `farShadowChunks`,
   `installSpecularAntialiasing` and `installWetRoad` anchors. Never reword GLSL substrings that tests assert.
10. **Hot files**: at most 10 changed lines per department in `renderer.ts`. New logic goes in `src/rendering/studio/<topic>.ts`
    or `src/ui/<topic>.ts`. Add any new `this.x` read in `draw()` **after** the shadow anchor (~:1149), or optional-chain it
    (race-view-continuity fixture).
11. **Budget**: stay within your Medium Δcalls allocation (§3). Measure with capture `diag.json` `drawCalls` plus
    `apexDiagnostics().renderer.drawBreakdown`, and put the number in the commit message. Gate costly work to High, and
    keep the Low tier unchanged or cheaper.
12. **Tests**: never delete, skip, `.only` or weaken a test (no `toBeTruthy` downgrades). Update pinned expectations only
    where the behaviour intentionally changed, in the same commit, with a TEST-UPDATE line. Add new tests for new modules.
13. **Visual proof**: run a Medium capture before and after (High as well before you declare done). `errors.txt` must be
    empty. Run `shotdiff` against `$S/shots/baseline` and against the previous slot's capture. Then **look at the matching
    reference images** and report the art-bible numbers your work order names.
14. **IP**: fictional brands only (P19). Never copy reference pixels, liveries or logos. Never name real sponsors in
    textures or UI strings.
15. Never run the full vitest or e2e suite (qa-signoff is the exception). Never run `npm run format`.
16. **Done** means: the goals are met, acceptance evidence is in your final summary (numbers, capture dirs, test list),
    the worktree is removed and the branch is deleted.

Paths: `S=/tmp/claude-0/-home-user-Experiment-3/378de659-9944-56cf-89fb-195c2dec2c03/scratchpad`; refs in `$S/refs/f1ref/`.
AVIF sources are already converted: `official_ea_*` 020-033 → `$S/artA_conv/<name>.png`; My Team 011-019 → `$S/conv/<name>.png`.

**Reference key** (all paths are under `$S/refs/f1ref/` unless noted):

| Tag | Path |
|---|---|
| `PS0NN` | `official_playstation/0NN_ps_*.webp` |
| `PSQ0NN` | `ps5_review_pushsquare/0NN_push_*.webp` |
| `TX0NN` | `photo_mode_traxion/0NN_traxion_*.jpg` |
| `artA_conv/0NN` | `$S/artA_conv/0NN_ea_*.png`: 020-021 Braking Point, 022-030 tips (TIP), 031-033 customisation (CUS) |
| `conv/0NN` | `$S/conv/0NN_ea_*.png` (My Team) |
| `<site> NNN` | `review_<site>/NNN_*`: techradar, topgear, maxigeek, gamescreed, gamingbolt, vandal, noobfeed, gamecritics |
| `thumbculture NNN`, `cgmag NNN` | `ps5_review_thumbculture/`, `ps5_review_cgmag/` |
| `joinsteer 094`, `onpsx 095`, `ps4hry 097` | `reference_joinsteer/`, `reference_onpsx/`, `reference_ps4hry/` |

Ignore techradar 048-065: they are unrelated images.

---------------------------------------------------------------------------------------------------
## 3. Draw-call and performance allocation (Medium, 1280×720 cockpit cold frame, 12 cars)

Baseline: day 2345, sunset 3173 (+2 % gate = 3236, so only 4 calls of headroom), night 3457. The `composer` phase must stay
below 1800. Programme cap after the re-pin is **+8 %**: day ≤ 2533, sunset ≤ 3427, night ≤ 3734.

| Dept | Medium Δcalls | Notes |
|---|---|---|
| render-core, lighting-ibl, sky-atmosphere, track-asphalt, kerbs, post-lens, camera, hud, weather (dry), vfx (dry), barriers, characters-driver | **0** | shader, uniform or DOM work only; bakes run only on bin change |
| post-motion | ≤ +1 | 0 preferred (fold into the AO composite) |
| shadows-grounding | 0 (High ≤ +80) | the near cascade is High only |
| vehicle-paint | ≤ +12 | carbon-matte floor costs +1 per near car |
| vehicle-tyres-wheels | ≤ +16 | painted covers and anthracite rims |
| vehicle-lamps-brakes, vehicle-rivals | 0 / ≤ +11 | draw-neutral first: reuse materials before `mergeStatic` |
| forest-vegetation | ≤ +40 | 240-700 m buckets; far shadow is baked |
| trackside-branding | ≤ +24 | ribbons merged per ≤ 300 m per side; hoardings instanced |
| ground-cover | ≤ +2 | one instanced tuft mesh |
| terrain-landform | ≤ +2 | skirt |
| crowd-grandstands | ≤ +12 | instanced flags, LOD 0-1 only |
| characters-crew | ≤ +3 | pit and grid scenes only |
| venue-architecture | ≤ +6 | rooftop instancing |
| night-golden-hour | night ≤ +8 | analytic light pools instead of extra point lights |
| **Total** | **≈ +137 (≈ +5.8 % day)** | performance-budget claws back, then re-pins once |

Frame-time guard: a SwiftShader Medium cockpit frame must take ≤ 1.25× the baseline (≤ 11.3 s wall in `diag.json`).
Fragment loops on Medium are limited to 16 taps.

---------------------------------------------------------------------------------------------------
## 4. Schedule (2 concurrent departments per slot; pairs chosen so that hot files never collide)

| Slot | Department A | Department B | Shared-file note |
|---|---|---|---|
| 1 | render-core (W1) | qa-tools (W1) | disjoint |
| 2 | lighting-ibl (W1) | track-asphalt (W1) | disjoint |
| 3 | post-motion (W1) | vehicle-paint (W1) | options.ts:41 only for post-motion |
| 4 | sky-atmosphere (W1) | shadows-grounding (W1) | renderer.ts: sky :326/:944-953, shadows :332-344/:1334-1391; daylight.ts regions differ |
| 5 | post-lens (W1) | hud-race (W2) | disjoint |
| **A** | **Checkpoint A**: orchestrator pulls, QA runs the capture matrix and `look-metrics`, and art review against KPIs 1-9 | | |
| 6 | forest-vegetation (W2) | vehicle-tyres-wheels (W2) | |
| 7 | trackside-branding (W2) | vehicle-lamps-brakes (W2) | |
| 8 | track-kerbs-runoff (W2) | characters-driver (W2) | |
| 9 | terrain-landform (W2) | vehicle-rivals (W2) | |
| 10 | ground-cover (W2) | camera-cockpit (W2) | renderer.ts regions differ |
| 11 | weather-wet (W2) | crowd-grandstands (W2) | |
| 12 | characters-crew (W2) | vfx-particles (W2) | |
| 13 | trackside-barriers (W2) | venue-architecture (W2) | |
| **B** | **Checkpoint B**: full capture matrix (day, rain, sunset, night, pit, grid), KPIs 1-14, budget read-out | | |
| 14 | gameplay-race-rules (W3) | night-golden-hour (W3) | |
| 15 | frontend-menus (W3) | replay-photo (W3) | interface.ts / main.ts regions differ |
| 16 | gameplay-flashback (W3) | performance-budget (W3) | perf re-pins after all visual work has landed |
| 17 | qa-signoff (W3) | (iteration: re-open any department that failed its KPIs) | |

Dependencies: render-core comes before everything (shared uniforms, hook helper, keys). lighting-ibl comes before
sky-atmosphere, vehicle-paint and every capture-judged department. track-asphalt comes before kerbs, ground-cover, terrain,
weather and branding (circuit.ts attributes `apexLine` and `edgeMetres`). vehicle-paint comes before tyres, lamps, rivals,
driver and crew (`brand-atlas`, LIVERIES). post-motion comes before vfx (depth copy) and replay-photo (pan blur). post-lens
comes before replay-photo and frontend (DOF). hud-race comes before gameplay-race-rules (DRS pill) and frontend
(style.css). Every department after slot 2 compares against **the latest checkpoint capture**, not only against
`baseline`.

---------------------------------------------------------------------------------------------------
## 5. Studio KPIs (measured by `scripts/studio/look-metrics.py` on the capture matrix; shot index per TTM §9)

| # | KPI (Medium, day unless stated) | Baseline | Target | Owner(s) |
|---|---|---|---|---|
| 1 | Sunlit off-line asphalt crop (shots 10, 20) | #3e3f44, B/R 1.08, std 2.4 | #7d7a76-#938b83, B/R 0.88-0.95, std ≥ 8 | track-asphalt, lighting |
| 2 | Rubbered line luminance vs off-line | none | 45-65 % at apexes | track-asphalt |
| 3 | Frame luma p50 / p95 / p99 (20) | 0.37 / 0.83 / – | 0.42-0.53 / 0.80-0.88 / ≤ 0.93 | lighting, surfaces |
| 4 | Sky zenith G/B; horizon B−G (13, 20) | 0.92; ≈0 | 0.78-0.85; ≥ 12 | sky-atmosphere |
| 5 | Car cast shadow B/R; lit:shadow; under-floor (10) | ~1.0; 8:1; – | ≥ 1.5; 10-17:1; 20-30:1 | lighting, shadows |
| 6 | Cockpit pixels with luma < 0.06 (11, 21) | 0.31-0.33 | ≤ 0.20 | lighting, vehicle-paint |
| 7 | `diag.reflectionIntensity` | 0.27 | ≥ 0.85 | lighting |
| 8 | Motion: near-road directional gradient energy at 152 km/h (20) vs a 0-blur capture | 0 % | ≥ 35 % reduction; car body sharpness within 10 % | post-motion |
| 9 | Grass crop (13, 20); tree mass saturation | #445e20, sat 0.6; 0.47 | #7f8444-#8e8a4c, sat 0.33-0.47; 0.15-0.25 | ground-cover, forest |
| 10 | Chase car width (20); cockpit wheel width (11); T-cam horizon (12) | 21-26 %; 22-24 %; 0.47 | 36-42 %; 30-38 %; 0.42-0.46 | camera-cockpit |
| 11 | Kerb stripe period (20) | 6 m pair | 2.0-2.4 m pair; red #c4222a ± 20 | kerbs |
| 12 | Visible barrier length carrying fictional boards (13, 20, 21) | 0 % | ≥ 80 % | branding |
| 13 | Crowd crop sRGB std-dev; largest uniform block (13) | uniform maroon | ≥ 27; < 2 % of frame | crowd |
| 14 | Rain (wet capture): streaked reflections 3-5×, plume 15-30 m, red rain-light bloom | not captured | present | weather, vfx, lamps |
| 15 | HUD: no italic or skew; cluster centre x 0.49-0.51; footprint < 12 % (e2e/49) | right block | F1 25 layout | hud-race |
| 16 | Draw calls Medium day / sunset / night; frame time | 2345 / 3173 / 3457 | ≤ 2533 / 3427 / 3734; ≤ 1.25× | performance |
| 17 | Contracts | green | all green; zero diff on pinned paths since `3a6036d` | qa-signoff |

---------------------------------------------------------------------------------------------------
## 6. Department work orders

Format: **Owns** (only this department edits these, freely). **May touch** (the minimal shared lines listed).
**Goals** (numbers are targets). **Accept** (verifiable). **Refs**. **Tests** (`tests/*.test.ts`, plus `fastcheck <area>`).

### WAVE 1: foundation

**D01 render-core**: Engine & Settings Core (Technical Director). Slot 1, port 4315.
- Owns: `src/rendering/renderer.ts`, `src/rendering/options.ts`, `src/ui/presentation.ts`, new `src/rendering/studio/studio-frame.ts`, new `src/rendering/studio/shader-hooks.ts`, `tests/settings-transition.test.ts`, new `tests/studio-frame.test.ts`, new `tests/studio-shader-hooks.test.ts`.
- May touch: `src/storage/data.ts` (defaults only), `tests/race-view-continuity.test.ts` (fixture stub), `tests/presentation.test.ts`, `tests/broadcast-presentation.test.ts`.
- Goals: `StudioFrame` holds the shared uniform objects: `studioTime` (H.TIME), `studioWind` vec4 (H.WIND_X, H.WIND_Z, time, gust), `studioSunDir`, `studioViewProj` and `studioPrevViewProj`, `studioCarCount`, `studioCarNow[12]` and `studioCarPrev[12]` (mat4), and `studioCarPose[12]` (x, z, yaw, groundY; half extents 2.8×1.0 m). · It is updated once per frame by one call after the shadow anchor (~:1155). `reset()` runs on cuts, seeks and resizes. 0 draw calls. · `shader-hooks.ts` provides `chainShaderHook(material, key, fn)` and `injectAfter(shader, chunk, glsl)` (throws when the anchor is missing). · Adds the P17 keys in **one** commit: options interface, preset, validate, presentation UI, both settings-transition literals, and store-only wiring in `setQuality`.
- Accept: tsc 0 errors; fastcheck render + ui green; new tests prove uniform identity sharing, held-frame byte equality and idempotent chaining. Capture: drawCalls Δ = 0, and static shots 11/12/13 inside the noise floor (mean |Δ| ≤ 3). e2e/49 passes.
- Refs: `$S/shots/baseline/*`. Tests: settings-transition, presentation, broadcast-presentation, race-view-continuity, startup, studio-frame, studio-shader-hooks.

**D02 qa-tools**: Build/QA Tooling (QA Engineer). Slot 1, port 4330.
- Owns: new `scripts/studio/capture-matrix.mjs`, `scripts/studio/look-metrics.py`, `scripts/studio/look-targets.json`, `scripts/studio/shotdiff.py`.
- Goals: Productise `$S/tools/capture.mjs` into `capture-matrix.mjs` with these flags: `--lighting day|sunset|night` (through the Academy `lighting:*` action), `--weather`, `--views`, `--pit` (pit-stop TV and cockpit), `--grid` (grid crew), `--drive`, and `--quality`. It writes `diag.json` including `drawBreakdown` and `census`, and `errors.txt`. · `look-metrics.py` measures KPI 1-13 crops from `look-targets.json` (crop boxes per shot index) and prints PASS/FAIL plus JSON. · Produce the missing baselines once: `$S/shots/baseline-matrix/` (rain, sunset, night, pit, grid).
- Accept: `--help` works. A day run takes ≤ 8 min and the full matrix ≤ 25 min. `errors.txt` is empty. Run on `$S/shots/baseline`, `look-metrics` reproduces the AB-A baseline numbers within ±6/255 (asphalt ≈ #3e3f44). Lint passes. Nothing is written into tracked trees (`check:stable`-safe).
- Refs: AB-A §0.1 table. Tests: source-stability.

**D03 lighting-ibl**: Lighting & IBL (Lighting TD). Slot 2, port 4345.
- Owns: `src/rendering/daylight.ts` (the sky shader region :129-367 is reserved for D07), `lighting-coherence.ts`, `reflections.ts`, `exposure-meter.ts`, `adaptive-exposure.ts`, new `studio/ibl-energy.ts`. Tests: `dusk-readability`, `exposure-key`, `reference-rendering`, `daylight-environment`, `visual-coherence`, `reflections`.
- May touch: `renderer.ts:185-186, :325-331, :919-943` (per-frame apply, ≤ 10 lines).
- Goals: Apply P1, P2 and P3 exactly. · `apexSpecularIBL` installer (chained) on all Standard/Physical materials without their own envMap, added at the "Local weather materials" task and in `setCars`. It multiplies `radiance` and `clearcoatRadiance` after `lights_fragment_maps`. · Car `reflectivePaint` gain: total specular ≈ 1.0× the dome. · Ground branch: add `groundAmount` and `groundAlbedo` (linear 0.15, 0.14, 0.12) to the sky shader, used only inside `SkyEnvironment.capture` (:386-423) and restored in `finally`. 2° horizon blend. · PMREM 128 → 256 (:407). High probe 128 → 256 (`reflections.ts:79`). · Re-measure the METER_KEY fixtures so that |mean EV| < 0.05.
- Accept (shots 10, 11, 20): KPIs 5, 6 and 7. Paint on shot 20 shows a sky/horizon band (upper-surface crop peak luma ≥ 0.6). Frame p99 ≤ 0.93. Δcalls 0. Every pinned-value change carries a TEST-UPDATE line.
- Refs: PS002, PS009, TX077, PSQ036, `artA_conv/029`, `artA_conv/033`.
- Tests: dusk-readability, exposure-key, reference-rendering, daylight-environment, visual-coherence, reflections, weather-reconciliation, phase27g-presentation, sky-linear, specular-aa, far-shadow, race-view-continuity.

**D04 track-asphalt**: Track Surfaces: Asphalt and Racing Line (Environment TA). Slot 2, port 4360.
- Owns: `surface-detail.ts`, `circuit-finish.ts`, `road-macro.ts`, `asphalt-aggregate.ts`, `tyre-marks.ts`, `circuit.ts`, new `studio/road-detail.ts`.
- May touch: `src/shaders/wetRoad.frag:8` (the rubber term only).
- Goals: Apply P4. · Sobel normal map from the height bytes (strength 2.5, normalScale 0.6-0.9, NoColorSpace) instead of the bumpMap. Add a 4.5 m meso tile (new seed). Fade the 0.64 m micro tile to its mean over 15-40 m. · Per-vertex `apexLine` (lateral offset from `racingLineFor(track).offsetAt(s)` plus braking weight from `tyreMarkZones`) on the road ribbon. Shader: `line=exp(-.5*(x/.85)^2)`, `diffuse*=1-(.42+.18*brake)*line*smoothstep(0,.3,roadState.g)`, roughness 0.80 → 0.62-0.68 on the line. Physics rubber remains the amplitude. · Braking streak pairs (0.3 m wide, 20-60 m long, ending at the apex); patches -10 to -15 %; tar-snake lines `#2a2927`, 1-2 cm wide, roughness 0.45. Keep the `ROAD_MACRO` constants and the asserted substrings. · Aggregate glints within 6 m. Painted lines `0xf1eee0` → `#e9e7e0`, r 0.55. · **Export a per-vertex `edgeMetres` (|l|−w) on every ribbon** for D15, D19 and D17.
- Accept: KPIs 1 and 2. Δcalls 0. e2e/37 semantics hold (asphalt changes, rewind exact).
- Refs: `artA_conv/029`, PSQ036, PSQ034, PS008, PS001, `artA_conv/027`, techradar 066.
- Tests: circuit-detail, road-macro, race-surface-atmosphere, race-surface-finish, rendering, reference-rendering, tyre-marks, marbles, racing-line, aurel-environment, wet-presentation.

**D05 post-motion**: Post FX A: Velocity, Motion Blur, GTAO, Contact Shadows (Rendering Engineer). Slot 3, port 4375.
- Owns: `motion-blur.ts`, `scene-ambient-pass.ts`, new `studio/velocity.ts`, new `studio/temporal-aa.ts`, `tests/motion-blur.test.ts`.
- May touch: `options.ts:41` (P10), `renderer.ts:379-398` (composer) and the `setStrength` line in `setQuality`.
- Goals: Velocity by depth reprojection (`studioPrevViewProj`) plus rigid car OBB reprojection (`studioCarNow/Prev`). 12 taps, depth-gated, max 3.5 % of width, folded into the SceneAmbientPass composite (0 calls, at most +1). · The followed car stays below 0.5 px of velocity. Photo, menu and replay pause force 0. Keep the `motionBlur.diagnostics()` shape. · GTAO in `obscuranceFragment` (2-3 slices × 6 steps, IGN, multi-bounce, albedo 0.3) with the frozen `AMBIENT_OCCLUSION` bounds and the 0.9-2.2 m near fade. · Screen-space contact shadows (12 steps over 0.3 m toward the sun) written to the AO G channel. · Stretch: High-only TAA behind `temporalAA` (Halton 8, YCoCg clip, off for photo, menu and held frames).
- Accept: KPI 8. Held frames identical. Medium Δcalls ≤ +1. Frame time ≤ +10 %. e2e `presentation.spec` motionBlur active semantics hold.
- Refs: PS002, PS008, PSQ036, PSQ037, TX075, TX080, `artA_conv/022`.
- Tests: motion-blur, broadcast-presentation, presentation, settings-transition, race-view-continuity, startup, visual-coherence, presentation-continuity, render-census, draw-ledger.

**D06 vehicle-paint**: Vehicle Materials: Paint, Carbon, Liveries, De-brand (Vehicle Material Artist). Slot 3, port 4390.
- Owns: `car.ts`, `paint-finish.ts`, `car-livery.ts`, `src/shaders/carbon.frag`, `carbon-normal.frag`, `src/storage/livery.ts`, new `studio/supplied-lookdev.ts`, new `studio/brand-atlas.ts` (the shared fictional wordmark atlas, P19).
- May touch: `materials.ts:16-37` (carbonMaterial), `simulation/config.ts:244-247` (LIVERIES), `supplied-player.ts:363-386` (one lookdev call), `renderer.ts:774-781` (setLivery reaches the RB19).
- Goals: Finish table: gloss (metal 0, r 0.32, cc 1, ccR **0.04**), metallic (metal 0.45-0.6, r 0.38), satin (r 0.48, cc 0.35/0.32), matte (r 0.62, cc 0). · `installPaintFlakes` (constants only, 0.4 mm, fade by 10 m) and orange peel (5-10 mm, slope 0.002). · Saturated LIVERIES `#B3121E #F27C1E #0B5E4F #13235E #E9E9EB #1C5BD8 #E36FA8 #16181B #2BB3A0 #9EA4AA #7FC241 #F2C200`, each with a dark secondary and a light accent. · Flank canvas: gradient sweep, 2-3 px pinstripes, exposed-carbon diagonal, 120 px number, ≥ 3 fictional sponsors. `installLiveryPattern` for the nose and engine-cover chevrons. · Carbon: MeshPhysical `#0e1012`, r 0.36, cc 0.85, ccR 0.07, weave ±18 %, normal slope 0.06, key `apex-metre-carbon-v4-twill-coat`. Floor underside satin r 0.55 with no coat. · RB19 overrides: midnight satin: linear (0.0091, 0.0145, 0.068), r 0.36, cc 0.55/0.10, sheen 0.25 `#23305e` · vermilion, yellow and non-tyre decals: cc 0.6/0.08 · `amplifySuppliedRelief` (carbon ×4000, tyre ×2000) without changing `restoreSuppliedHeightMap` · Car 0: livery tints the RB19 only when the player has customised it (the default keeps the navy look). · P13 de-brand swap, keeping the transparent and single-pass flags.
- Accept: Shot 20: crisp horizon band on the sidepod (peak luma ≥ 0.75, band ≤ 6 px). Rival livery mean saturation ≥ 0.45. · Shot 10: weave crop std-dev ≥ 6 at ≤ 3 m. · Shot 00: no real wordmark visible; the list of swapped material names is logged. · Δcalls ≤ +12.
- Refs: PS002, PS009, TX077, TX080, `artA_conv/022`, `artA_conv/031`, `artA_conv/033`, techradar 047.
- Tests: phase27e, phase27g-presentation, supplied-player, supplied-shader-work, imported-render-budget, decal-coverage, a61-rival, hero-shells, hero-import, phase27h-assembly, graphics-continuity, menu-preview, wing-surface.

**D07 sky-atmosphere**: Sky, Clouds and Aerial Perspective (Atmosphere Artist). Slot 4, port 4405.
- Owns: `local-atmosphere.ts`, new `studio/sky-clouds.ts`, new `studio/aerial-perspective.ts`, `tests/sky-linear.test.ts`, `tests/sky-order.test.ts`.
- May touch: `daylight.ts:129-367` (SKY_SCATTERING, skyLinearGain, configureSky) and `:41-50` (clear turbidity, skyRadiance, fog terms); `renderer.ts:326, :944-953` (≤ 3 lines); reference-rendering, dusk-readability, daylight-environment and weather-reconciliation tests.
- Goals: Turbidity 2.3 → 1.9, rayleigh 2.9 → 3.4, skyRadiance 0.32 → 0.28, zenith push `mix(1,(.92,.97,1.08),smoothstep(.05,.6,y))`. Targets: zenith `#6aa2d6-#70a6cb`, horizon `#b8d4ea-#c8dcef`. Recompute skyLinearGain and update the test with a TEST-UPDATE line. · Baked cumulus panorama per cover bin: 2048×512 HalfFloat, Worley-Perlin, flat bases, 2-step self-shadow, silver lining. 15-30 % cover in the lower 25° for dry weather. Tops `#f6f7f8`, bases `#9aa6b4-#aab4c0`. Overcast `#cfd3d6-#e8eaea` ±6 %. Sampled in the dome and in the PMREM, and stationary. · P12 fog, as a separate term in the fog chunk. The pocket quadrature stays exact (e2e/38).
- Accept: KPI 4. The 2 km ridge reads `#6f7b7a` ±14. Contrast loss at 1 km is 25-30 %. Clouds read as cumulus (judged against TIP024 and PS003). Δcalls 0 per frame.
- Refs: `artA_conv/024`, PS003, PSQ034, TX076, PS010, `artA_conv/029`.
- Tests: sky-linear, sky-order, reference-rendering, daylight-environment, weather-reconciliation, dusk-readability, presentation-continuity, phase27f-atmosphere-audio, aurel-environment, visual-coherence.

**D08 shadows-grounding**: Shadows and Car Grounding (Rendering Engineer). Slot 4, port 4420.
- Owns: `far-shadow.ts`, `shadow-proxies.ts`, `static-instance-shadow-bounds.ts`, new `studio/shadow-filter.ts`, new `studio/car-grounding.ts`, `tests/far-shadow.test.ts`.
- May touch: `options.ts:32` (Medium shadowSize 2048), `renderer.ts:332-344, :1334-1391`, `daylight.ts:101-128` (shadowAnchor), `circuit.ts:143-182` (one `installCarGrounding(m)` per surface material).
- Goals: Medium shadow map 1024 → 2048 (0 calls). · Vogel 12-16-tap IGN-rotated PCF plus an optional 8-tap PCSS (sun 0.53°, penumbra 1.5-6 texels) in `getShadow`, installed after far-shadow. · Analytic under-car occlusion from `studioCarPose` on the road, kerb, run-off, grass and gravel materials: 25-35 % darkening, 0.2 m falloff, still visible in overcast. · High only: near cascade ±12 m at 2048 as directional shadow index 2, with a 10 % blend.
- Accept: KPI 5 (crisp at the tyre contact, edge ≤ 3 px; under-floor 20-30:1). scenery-shadow-budget gives 0 changed bytes. Δcalls Medium 0, High ≤ +80.
- Refs: `artA_conv/033`, `artA_conv/022`, TX076, TX077, PS002.
- Tests: far-shadow, shadow-proxies, static-instance-shadow-bounds, start-finish-shadow-bounds, scenery-shadow-camera, visual-coherence, reference-rendering, circuit-detail, presentation, race-view-continuity.

**D09 post-lens**: Post FX B: Bloom, Grade/LUT, Lens, DOF (Rendering Engineer). Slot 5, port 4435.
- Owns: `lens-bloom.ts`, `broadcast-grade.ts`, new `studio/grade-lut.ts`, new `studio/lens-effects.ts`, new `studio/dof-pass.ts`, `tests/lens-bloom.test.ts`.
- May touch: `renderer.ts:799-807, :1284-1302` (replace BokehPass; bloom strength next to `grade.apply`), plus the `lensEffects` line in `setQuality`.
- Goals: Procedural 32³ LUT per profile (day, sunset, night, studio, wet): sky blue push, foliage -8 % saturation, livery hue shift ≤ 5°. · P11 bloom. · `lensEffects`: sun flare (3-5 ghosts ≤ 4 % when the sun is within 25° of the view axis and depth at sunUV is sky); procedural dirt in the final upsample; rain-on-lens for chase, T-cam and trackside (20-60 drops of 2-12 px, streaking with speed, driven by H.TIME and H.RAIN). · Depth-texture DOF: half-res, 16-24 taps, 2-3 quads, no scene re-render. Used in photo, menu, HQ and pit cinematics and on tele cameras (fov < 20°). Off while driving. · GRADE_PROFILES grain, fringe and sharpen stay 0.
- Accept: photo DOF works in e2e/07. No bloom on asphalt or sky by day (p99 ≤ 0.93). Photo drawCalls drop by the BokehPass re-render. Medium Δcalls 0.
- Refs: TX079, PS010, TX076, TX078, `artA_conv/021`, PS004.
- Tests: lens-bloom, broadcast-presentation, presentation, photo-reference, reference-rendering, visual-coherence, startup, race-view-continuity.

### WAVE 2: content

**D10 hud-race**: In-race HUD (UI Engineer). Slot 5, port 4450.
- Owns: `src/ui/interface.ts`, `style.css`, `race-day-hud.ts/.css`, `compact-race-hud.ts/.css`, `gap-timer.ts`, `proximity.ts`, new `f1-hud.ts`, `f1-hud.css` (`?inline`, injected), `sector-timing.ts`, `tests/sector-timing.test.ts`, `e2e/28-race-hud-layout.spec.ts` (L74 only), `e2e/52-vehicle-hud.spec.ts` (L62 only), `e2e/fixtures/race-hud-layout.ts`.
- May touch: `src/main.ts:953` (update args).
- Goals: AB-B §0.3 tokens. Remove the italics, skews, orange accents and the `.hud-top:before` scrim. Fix the action bar (race-day L356 → opacity 0 while driving, 1 on hover or focus). · Binocular SVG cluster at x .392-.605, y .808-.950: gear 6.4 vh; BATT arc `#9cc054→#e4f084`; 15 rev LEDs (`#22d44a`/`#ff2a2a`/`#3d6bff` at `shiftRPM*(0.80+i*0.0143)`); status line in `#e8b06a`; DRS pill (dim until `R.DRS` exists); tyre widget. · Tower v2: surnames, team bar, compound rings from COMPOUNDS, a CSS-only 5-row window with `:focus-within` expansion, purple `#b418cc` fastest row and a grey player row. · Sector panel: S1/S2/S3 from `SectorBoard` (purple, green `#19c23b`, yellow `#e4c030`), "N / 20", BEST, delta hatch. · Minimap v2: Path2D cache, DPR canvas, sector numbers, chequered S/F, 10 px team dots, `#f5e11c` player triangle. · Banners (4 s), pit-lane panel (`#54e4f0`), 5×5.6 vh start lights, `#e0182a` chevrons, ≤ 5 name tags. · MFD pages generalised (STRATEGY and SETUP appended after DAMAGE).
- Accept: KPI 15. DOM e2e 28 (with the P15 edit), 30, 35, 49 and 52 pass through the port wrapper. Every id and label in TUF §6 is kept. Shot 20: the top-12 % sky crop luma rises ≥ 10 % once the scrim is gone.
- Refs: gamescreed 085, maxigeek 089, ps4hry 097, joinsteer 094, onpsx 095, topgear 070, PSQ036.
- Tests: gap-timer, proximity, race-day, presentation, engineering, circuits, tab-evidence, reference-depth, sector-timing.

**D11 forest-vegetation**: Vegetation and Wind (Environment Artist). Slot 6, port 4465.
- Owns: new `studio/forest-belts.ts`, `studio/foliage-shading.ts`, `studio/conifer.ts`, `landscape.ts`, `canopy-normals.ts`, `foliage-mipmaps.ts`, `aurel-vegetation.ts` (runtime hooks only; the plan and the GLB stay untouched), new `tests/forest-belts.test.ts`.
- May touch: `circuit.ts:330-337` (register belts at p3).
- Goals: 6-12 k belt trees placed 30-120 m behind the boundary (clustered Poisson; 40 % conifer 14-28 m; broadleaf 15-25 m), honouring `plantingClearance`, quarry and gate exclusions. · In `vegetationGroup` with `castShadow=false` and `userData.fullCount`, in 240-700 m buckets. · Canopy `#3f4b3e`, inner `#1c241e`, backlit edge `#7d8f4a`; translucency `0.35·pow(sat(dot(-V,L)),4)`; crown AO 0.55→1.0; alphaToCoverage. · `studioWind` sway applied identically in the colour, depth and distance materials (trunk `0.015h²sin(.6t+φ)`, flutter 2 cm at 3 Hz). Existing trees desaturated toward the same canopy colour.
- Accept: KPI 9 (trees). No bare-lawn hill within 300 m behind the barriers in shots 13 and 20. aurel-vegetation caps hold (650/900, 50-440 chunks). Held frames identical. Δcalls ≤ +40.
- Refs: PS007, TX076, PSQ034, PS010, `artA_conv/029`, maxigeek 089, topgear 068.
- Tests: aurel-vegetation, landform-groves, foliage-crowns, foliage-coverage, far-shadow, scenery-shadow-camera, static-instance-shadow-bounds, aurel-environment, rendering, forest-belts.

**D12 vehicle-tyres-wheels**: Tyres, Wheels and Wheel Blur (Vehicle Artist). Slot 6, port 4480.
- Owns: `tire-finish.ts`, `tire-carcass.ts`, `tire-profile.ts`, `src/shaders/tread.frag`, `car-assembly.ts`, `wheel-pose.ts`, new `studio/tyre-letters.ts`, `studio/wheel-blur.ts`.
- May touch: `car.ts:289-303, :652-670`; `lod.ts:190-199`; `config.ts:79-83` (P8); `supplied-player.ts:363-386, :455-456`.
- Goals: Tread `#2a2a2a` (r 0.75 new, 0.82 scrubbed); sidewall `#1f2022` (r 0.55-0.6). · Compound band at r .312-.326 as two 150° arcs, plus original lettering at r .268-.308 using `tireBind` polar coordinates and a 1024×128 atlas. · Torus rings kept but shrunk (tube 0.0015). · Covers in livery paint; anthracite rims `#2b2e31` (m 0.75, r 0.38) with a lip `#3a3b3e`. · Rotational blur `uWheelBlur = smoothstep(18,45,ω)` on covers and lettering. RB19 wheel materials are cloned per wheel at runtime.
- Accept: shot 10 shows the band and lettering legible at ≤ 10 m. Shot 20 smears the lettering and radially blurs the cover. Δcalls ≤ +16.
- Refs: PS002, TX078, TX080, PS010, PS004, `artA_conv/022`, `artA_conv/032`.
- Tests: race-surface-finish, tire-carcass, a61-rival, visible-wheel-pivots, wheel-pose, supplied-player, phase27h-assembly, graphics-continuity, shadow-proxies.

**D13 trackside-branding**: Trackside Branding (Prop / Graphic Artist). Slot 7, port 4495.
- Owns: new `studio/trackside-branding.ts`, `studio/branding-plan.ts`, `track-boards.ts`, `track-board-plan.ts`, new `tests/trackside-branding.test.ts`.
- May touch: `circuit.ts:300-340` (p3 step), `:581-594` (signs), `:683-693` (gantry banner); `grandstand.ts:67-73` (fascia); `venue-plan.ts:83-88`; `studio/brand-atlas.ts` (add panels).
- Goals: Barrier vinyl on every barrier run, skipping guardrail, impact and gate spans. Ribbons merged per ≤ 300 m per side. Boards 1.0-1.2 m with one sponsor per 80-150 m. Colourways `#16181c`, `#1e2a78`, `#c8102e` and `#f5c400` with white wordmarks; vinyl r 0.7. · 10 % LED boards (emissive 2.5, scrolled by sim time). Hoardings on posts. · 300/200/100/50 distance boards (`#f2f2f2` with black numerals) through the `makeLabel` pass-through. · Restyle the gantry, signs and fascia. ≥ 2 banner bridges. A run-off logo decal API for D15. · Atlas panels 512×128 (TextureBudget). `reflectInWetRoad` on.
- Accept: KPI 12. The test asserts that every atlas word is on the P19 list. Δcalls ≤ +24.
- Refs: PSQ036, PSQ037, `artA_conv/025`, `artA_conv/027`, techradar 066, topgear 070, maxigeek 087, TX076.
- Tests: track-boards, track-infrastructure, trackside-operations, trackside, circuit-detail, rendering, static-transform-group, graphics-continuity, trackside-branding.

**D14 vehicle-lamps-brakes**: Vehicle FX: Rain Light, Brakes, Wet Coat (Vehicle FX Artist). Slot 7, port 4510.
- Owns: `supplied-player.ts`, `supplied-player-materials.ts`, `rear-signal.ts`, `manufacturing.ts`.
- May touch: `car.ts:246-255, :347-356, :631-645, :742`; `lod.ts:164`.
- Goals: Fix the rain light: match `'Light | red lens'` at `supplied-player.ts:384`. · Lamp core at linear 15-30: ×8 player and ×20 rivals at the call sites, not in `rearSignalIntensity`. · LED dot matrix of about 5×6 dots on the existing lamp mesh (shader, 0 draws). Steady in the wet, 4 Hz when harvesting or slow. Keep the name `'Recorded rear signal'` and the parent `car.root`. · Blackbody brake ramp: 450 °C `0x3a0600` ×0.3, 650 °C `0xb21a00` ×1.5, 850 °C `0xff4a0a` ×6, ≥ 1000 °C `0xff8a30` ×12. Outer-radius mask `smoothstep(.12,.19,r)`. Player `discGlow` vec4 driven from `W.DISC_TEMP`. · RB19 wet coat: `installPaintObservation` plus a per-frame `setPaintObservation`.
- Accept: KPI 14 (the rain light blooms with a halo ≥ 3× the lamp and tints the spray red). Heavy braking into NORTH HOOK shows disc glow on both cars. Δcalls 0.
- Refs: PS010, topgear 068, PS007, gamingbolt 082, TX079.
- Tests: phase27e, race-finish, race-surface-finish, supplied-player, supplied-shader-work, imported-render-budget, phase27g-presentation, wet-broadcast-fidelity, recorded-signal-displays, brake-coupling.

**D15 track-kerbs-runoff**: Kerbs, Run-off and Astroturf (Environment Artist). Slot 8, port 4525.
- Owns: new `studio/kerb-runoff-finish.ts`, `venue-plan.ts`, new `tests/kerb-runoff.test.ts`.
- May touch: `circuit.ts:151-219, :489`; `circuit-finish.ts:104-118` (dispatch only).
- Goals: P9 anti-aliased stripes. Per-corner `kerbStyles`: red/white by default, one signature blue `#2a4fa0`/white complex, and one yellow `#e8c43a`/green `#2f8f52` corner. Visual sausage kerbs at 3 apexes. · Ridge normals from `dh/ds` (`kerbHeight` untouched). Paint r 0.5 fresh, 0.85 worn. Rubber `#2a2a2a` on the track-side 30 %, weighted by line usage, plus chips. · Run-off from w+1.1 to w+4: astroturf `#3f9a55` (renders `#98b27b`) or painted 1.5-2 m bands (`#b33a32`, `#2e57a8`, `#3b8a50`, `#d9b23a` over `#6f6c68`) with white chevrons. Drop the `0x8aa58d` tint. 0.3-0.4 m worn-soil seams at `edgeMetres` ≈ 1.1 and ≈ 4.
- Accept: KPI 11. The baseline tan band no longer fills the first 4 m beyond the kerb. Physics/visual agreement tests green. Δcalls ≤ +2.
- Refs: PS006, PS007, PSQ034, PSQ036, TX076, `artA_conv/029`, techradar 044, techradar 066.
- Tests: circuit-detail, contact, aurel-drain-datum, rendering, reference-rendering, race-surface-atmosphere, race-surface-finish, road-macro, aurel-environment, kerb-runoff.

**D16 characters-driver**: Driver Character (Character Artist). Slot 8, port 4540.
- Owns: `driver-materials.ts`, `car-mechanical-detail.ts`, `helmet-shell.ts`, `driver.ts`, `driver-tailoring.ts`, new `studio/helmet-livery.ts`, `studio/supplied-character-lookdev.ts`.
- May touch: `car.ts:515-530` (team helmet instead of the ivory clone), `lod.ts:134-142`, `supplied-player.ts:363-386` (one call).
- Goals: Helmet: r 0.25, cc 1, ccR 0.03, with a per-team procedural design (crown, side flash, chin bar, number, carbon panel, fictional visor strip). · Visor: `#0b1014`, r 0.04, iridescence 1, IOR 1.8, thickness 280-620 nm, cc 1 / 0.015, envMapIntensity 2.5, pushed to `reflectivePaint`. The RB19 `F1CP_MAT_Visor` gets the same values without touching transparent, side or forceSinglePass. · Team suits: MeshPhysical with sheen, sheenRoughness 0.55-0.6, sheenColor 0.6× the suit colour; shared DataTextures kept. · Team gloves with darker suede palms (r 0.85, sheen 0.3). RB19 suit and gloves: sheenColor base×0.6, sheenRoughness 0.5. · Head roll ±6° from lateral g with a 0.15 s lag (deterministic).
- Accept: in shots 11 and 21 the glove hue is within 15° of the team primary. Shots 00 and 12 show a visor sheen and sky reflection. Δcalls 0.
- Refs: `artA_conv/020`, `artA_conv/021`, PS003, PS008, PS009, maxigeek 088, vandal 096, topgear 073.
- Tests: character-quality, cockpit-detail, driver, driver-asset, driver-controls, elbow-sleeve, graphics-continuity, imported-render-budget, supplied-player, phase27g-seams.

**D17 terrain-landform**: Terrain and Far Landscape (Environment Artist). Slot 9, port 4555.
- Owns: `terrain.ts`, `terrain-profile.ts` (no height change inside 680 m), `track-field.ts`, `aurel-quarry.ts` (look hooks only), `sea.ts`, new `studio/terrain-finish.ts`, `studio/apron-skirt.ts`.
- May touch: `circuit.ts:252-285` (Aurel 160 → 320 segments, a `trackDistance` attribute, UV ×.25); `circuit-finish.ts:73-89` (dispatch).
- Goals: Canopy carpet where trackDistance > 350 m and slope < .6: albedo `#2f3d2c-#3f4b3e`, 6-14 m crown-bump normal, dark crevices. · Triplanar strata rock `#8a8378` on slopes > .55 and on the quarry. · Drier south meadows. Anti-tiling with a rotated second sample. · A lap-wide apron-to-terrain skirt over 12 m (generalising `quarrySkirtGeometry`), so that no apron edge floats.
- Accept: in shots 13 and 20 the far hills read as forest in blue haze (with D07). A unit test bounds the apron-to-terrain gap at ≤ 0.1 m. Δcalls ≤ +2.
- Refs: PSQ034, PS010, TX076, PS007, topgear 068.
- Tests: aurel-quarry, quarry-surface-uv, aurel-drain-datum, aurel-environment, circuits, landform-groves, rendering, circuit-detail, scenery-shadow-camera.

**D18 vehicle-rivals**: Rival Car Silhouette and LOD (Vehicle Modeller). Slot 9, port 4570.
- Owns: `lod.ts`, `a61-rival.ts` (runtime only), `cockpit.ts`, `car-surfaces.ts`, new `studio/rival-detail.ts`.
- May touch: `car.ts:200-230` (halo `safety` carbon → paint), `:515-530` (details before `mergeStatic`); `car-livery.ts` (endplate canvas).
- Goals: Draw-neutral details: T-cam pod (black on the lead car, fluoro yellow on the second car); nose antenna and cockpit fins; painted halo with an original slogan; endplate number and wordmark; front-wheel brow winglets. · Reflective mirror glass (`cockpit.ts:93`). · Reduced LOD: painted covers, dark-alloy rims, team helmet. Mid/far LODs keep the livery colours.
- Accept: shots 10 and 12 show the details. At 100-150 m a rival crop shows ≥ 2 livery colours. a61-rival budgets (< 250 k / 65 k / 30 k tris; draws ≤ legacy). Δcalls ≤ +11.
- Refs: PS006, PS007, `artA_conv/028`, `artA_conv/032`, techradar 044, gamescreed 085.
- Tests: a61-rival, hero-shells, hero-import, phase27h-assembly, mirrors, mirror-detail, shadow-proxies, graphics-continuity, wing-surface, visible-wheel-pivots, cockpit-detail.

**D19 ground-cover**: Grass, Near-Grass and Gravel (Environment Artist). Slot 10, port 4585.
- Owns: new `studio/near-grass.ts`, `studio/grass-gravel-finish.ts`, `tests/near-grass.test.ts`.
- May touch: `circuit-finish.ts:49-72` (grass dispatch; ×(.79,1.066,.8) → ×(1.04,1.0,.86)); `surface-detail.ts:121-122` (gravel finish); `circuit.ts:151-174` (visual gravel extended to the wall where physics already says gravel); `renderer.ts` ~:1107 (1 update line).
- Goals: Olive grass `#6c7438`; mowing stripes 3-5 m at ±6 %; 25 m and 90 m macro variation (±12 %); dry patches. · Tufts: InstancedMesh, 3 cards of 0.10-0.18 m, `foliageMipmaps`, A2C, 30-40 per m² on a 64 m camera tile, fading out from 12 to 35 m, `studioWind`, attached to `circuit.group`, Medium and High only, no shadow casting. · Gravel `#b9a98a`: Voronoi pebbles at 40-60 cells/m with cavity darkening, raked furrows every 0.3 m along s; POM within 15 m on High.
- Accept: KPI 9 (grass). Near-verge blades visible in shots 20 and 21. Gravel crop std-dev ≥ 10. Grass and gravel bytes unchanged. Δcalls ≤ +2.
- Refs: `artA_conv/022`, `artA_conv/028`, `artA_conv/029`, `artA_conv/033`, TX076, PSQ034, thumbculture 041.
- Tests: race-surface-atmosphere, rendering, circuit-detail, aurel-environment, wet-presentation, reference-rendering, foliage-coverage, near-grass.

**D20 camera-cockpit**: Gameplay Cameras and Cockpit (Camera Designer). Slot 10, port 4600.
- Owns: `cockpit-framing.ts`, `camera-dynamics.ts`, `camera-detail.ts`, `steering-display.ts`, `mirrors.ts`, `tests/cockpit-framing.test.ts`, `tests/camera.test.ts`.
- May touch: `renderer.ts:124-136, :1056-1061` and the `cockpitFov` read; `supplied-player.ts` (one call adding LED meshes under `suppliedPlayer.root`).
- Goals: Apply P5, P6 and P7. Kerb head-shake of 0.2-0.4°, deterministic. · LCD per AB-B §2.2: gear at 120 px; delta pill `#0f5e1a`/`#3ddc5a`; 4 tyre temperatures; ERS bar `#39d353` with the mode text. · 15 physical rev LEDs (`#00ff40`, `#ff1a1a`, `#2f6bff`, emissive 4-6) and flag LEDs. · Mirror tint `0xd4dde0` → `0xeef2f4`. High mirrors 384×144 at 30 Hz.
- Accept: KPI 10. Cockpit halo top bar at y .22-.30. The LCD is readable in shot 21. Δcalls 0.
- Refs: PS003, PSQ034, PSQ036, PSQ037, `artA_conv/029`, `artA_conv/030`, joinsteer 094, maxigeek 088, vandal 096.
- Tests: cockpit-framing, camera, steering-display, instruments, mirrors, mirror-detail, race-view-continuity, cockpit-detail, broadcast-camera-cycle.

**D21 crowd-grandstands**: Crowd and Grandstands (Crowd Artist). Slot 11, port 4615.
- Owns: `grandstand.ts`, `crowd.ts`, `crowd-impostor.ts`, `audience-actions.ts`, `crowd-response.ts`, `secondary-grandstand-detail.ts`, new `studio/crowd-flags.ts`.
- Goals: 14-colour palette: 50 % team colours (`#C8102E #FF8000 #1E3A8A #F2F2F2 #0B6E4F #FFD200 #111111 #E5007D`) plus neutrals (`#e8e8e6`, `#3a4f6e`, `#1c1c1e`). Cohort share 0.6 → 0.75. Main-stand occupancy ≥ 0.9. · Caps. Instanced flags at 1 per 12-15 people, LOD 0-1, wind and sim time. · Gestures on every stand. Impostor gets a cap, raised arms, a shirt/trouser split and a gradient (keep the 6 indices). · Roof underside `#5a6064` with a shadow line.
- Accept: KPI 13. `crowdLodRanges` and shader strings preserved. Δcalls ≤ +12.
- Refs: PS002, PS007, TX076, TX078, PSQ036, techradar 044, maxigeek 087.
- Tests: people, presentation-closure, presentation-continuity, secondary-grandstands, secondary-grandstand-assets, start-finish, phase27g-venue, weather-reconciliation, graphics-continuity.

**D22 weather-wet**: Wet Weather Surfaces (Weather TD). Slot 11, port 4630.
- Owns: `materials.ts`, `wet-reflection.ts`, `src/shaders/wetRoad.frag`, `weather-presentation.ts`, `rain-streaks.ts`, `precipitation-light.ts`, `tests/wet-reflection.test.ts`.
- May touch: `renderer.ts:719` (wet planar reachable on Medium); `daylight.ts:46-50` (rain haze term, coordinated with P12).
- Goals: Sub-cell puddles (noise biased toward the edges and away from `apexLine`). · Dry line `wet*=mix(1,.55,line·smoothstep(.2,.65,mm)·(1-puddle))`. · Cellular drop rings (.25 m cells). Wet albedo ×0.6, roughness 0.08-0.22. · Medium planar at scale 0.35 with 5-7 vertical streak taps `±k(.004+.03·ccR)` and a Fresnel boost. · Layer 5 reflects the treeline, belts and boards. Off-track puddle mask. Rain streaks at 3-8 %. Car droplet beading 2-6 mm.
- Accept: KPI 14 (3-5× streaks, irregular puddles, an emerging dry line). e2e/13 determinism holds. The `installWetRoad` uniform keys are unchanged. Dry Δcalls 0; the wet Δ is reported.
- Refs: PS010, topgear 068, gamingbolt 082, vandal 096, noobfeed 093.
- Tests: wet-reflection, wet-presentation, wet-broadcast-fidelity, wet-review-start, circuit-detail, daylight-environment, weather, weather-reconciliation, spray-lighting.

**D23 characters-crew**: Pit/Grid Crew and Marshals (Character Artist). Slot 12, port 4645.
- Owns: `pit-crew.ts`, `crew-suit.ts`, `crew-geometry.ts`, `crew-pose.ts`, `grid-presentation-view.ts`, `grid-preparation.ts`, `marshal-staff.ts`, new `studio/crew-accessories.ts`, `studio/crew-wordmarks.ts`.
- May touch: `studio/brand-atlas.ts` (team wordmark panels).
- Goals: Team kits from `LIVERIES[car%12]` with a dark secondary for the yoke and trousers. MeshPhysical sheen 0.3-0.6. · Helmets in the team primary with a smoked gloss visor (iridescence 0.6). · Fictional chest and leg wordmarks masked by `vCrewRegion`. · Grid mechanics wear caps and headsets (≤ +3 draws). Marshals in `0xe6813c` with reflective bands. · Pose desync and look-at, within the contracts.
- Accept: the `--pit` and `--grid` captures show team colours, caps and headsets. Hashes and `CREW_REST` are untouched.
- Refs: PS004 (`conv/004_ps_pitstop_s.png`), topgear 071, gamecritics 092, techradar 047, onpsx 095.
- Tests: crew-performance, character-quality, grid-staff, grid-presentation, pit-role-performance, pit-presentation, pit-material-warmup, people, phase27g-seams, preparation.

**D24 vfx-particles**: Spray, Dust, Sparks and Smoke (VFX Artist). Slot 12, port 4660.
- Owns: `effects.ts`, `spray-clouds.ts`, `debris.ts`, `effect-playback.ts`, new `studio/soft-particles.ts`.
- May touch: `scene-ambient-pass.ts` (a depth copy after opaques, via a D05 hook).
- Goals: Rooster tail per TWM §9.9: vy 3.0-4.5, offset -2.6, size .55-.8, growth 2.6 m/s, life 1.6-2.6 s, peak alpha .5 decaying with age². `EFFECT_CAPACITY` and the birth maths are unchanged. · Hanging mist (25 % of older puffs ×2.5 size at ×.35 alpha). Lit `#d6dadb`, shadow side `#9aa3a6`. HG g .5 toward the sun and the rain light. · Soft particles fading over 0.5 m. · Gravel dust `#c9b597` lasting 2-3 s. HDR sparks (×15). Lock-up smoke `#d9d9d6`.
- Accept: in the rain capture the plume is 1.5-3 m high and 15-30 m long at > 150 km/h, with near opacity .4-.6 and no hard intersection lines. Wet-presentation counts are 17280/8000. Dry Δcalls 0.
- Refs: PS010, topgear 068, gamingbolt 082, thumbculture 041, noobfeed 093.
- Tests: spray-lighting, wet-presentation, visual-coherence, weather, weather-reconciliation, presentation-time.

**D25 trackside-barriers**: Barriers, Armco and Catch Fence (Prop Artist). Slot 13, port 4675.
- Owns: `catch-fence.ts`, `concrete-barriers.ts`, `steel-guardrails.ts`, `impact-barriers.ts`, `circuit-barriers.ts`, `marshal-posts.ts`, new `studio/barrier-lookdev.ts`.
- May touch: `circuit-finish.ts:183-224` (catchFenceMaterial).
- Goals: Galvanised posts `#8d9396` (m .85, r .45). · Coverage-preserving mesh opacity `clamp(1-d/70,.12,.55)` with no moiré, and 3-4 cables. · Armco `#9a9fa8` (m .85, r .33) with a streak normal. · Concrete `#c8c8c4` with joints and tyre rub at 0.2-0.5 m near corners. Impact blocks red `#b8262c`/white or blue `#1e3f8a`. · Overrides are applied where kits are assembled (`decode*` counts unchanged).
- Accept: in shots 20 and 21 the fence no longer dominates (mesh-vs-background luma ≤ 12 % beyond 30 m) and there is no moiré. Kit tests green. Δcalls 0.
- Refs: `artA_conv/024`, `artA_conv/032`, `artA_conv/033`, PSQ037, techradar 066, maxigeek 087, onpsx 095.
- Tests: catch-fence, concrete-barriers, steel-guardrails, impact-barriers, marshal-posts, track-infrastructure, trackside-operations, circuit-detail, scenery-pass-detail.

**D26 venue-architecture**: Buildings, Glazing and Venue Dressing (Environment Artist). Slot 13, port 4690.
- Owns: `venue-materials.ts`, `venue-architecture.ts`, `venue-districts.ts`, `venue-plaza.ts`, `race-structures.ts`, `paddock-detail.ts`, new `studio/glazing.ts`, `studio/giant-screen.ts`.
- May touch: `pit-building-frontage.ts` (material hook lines only; **never** `pit-building-layout.ts`).
- Goals: Glazing: MeshPhysical r .04, F0 .04, env 1.4, plus parallax interior mapping. · Facade seam normals. Instanced rooftop HVAC and antennas. TV towers and light poles. · Stand roofs `#d8dadc` on top and `#5a6064` underneath. · Giant screens: High shows a 256×144 feed at 2 Hz; Medium shows a static emissive card.
- Accept: in shot 10 the pit glass reflects the sky with depth. The layout hash is untouched. Δcalls ≤ +6.
- Refs: PS001, `artA_conv/027`, thumbculture 041/042, joinsteer 094, gamingbolt 081, TX076.
- Tests: venue-landmark, phase27g-venue, event-hall, event-hall-approach, pit-building-frontage, race-structures, paddock-detail, rendering, static-transform-group, graphics-continuity.

### WAVE 3: features, polish, performance, QA

**D27 gameplay-race-rules**: Protocol v11, DRS, ERS Overtake, Pit Strategy, VSC/SC (Gameplay Engineer). Slot 14, port 4705.
- Owns: `src/simulation/{protocol,aero,race,marshal,world,vehicle,ai,circuits,config}.ts`, `src/input/{bindings,button-actions}.ts`, `src/workers/{physics.worker,diagnostics}.ts`, `src/main.ts`, `tests/wheel-alignment.test.ts`, new `tests/drs.test.ts`, `tests/vsc.test.ts`, new `src/rendering/studio/safety-car.ts`.
- May touch: `src/ui/f1-hud.ts` (DRS and overtake), `interface.ts:139-146` (time-of-day and AI-level selects), e2e/28 L279 (tab count 11 → 13, deliberate), `renderer.ts:553-565, :1140` (`setSafetyCar`), `supplied-player.ts` (`PLAYER_DRS` flap).
- Goals: Protocol v11 per TUF §3: HEADER 24, R block of 8, CAR_STRIDE 257. · DRS zones: Aurel `{2180, 2300, 470}`; Vellamar `{3330, 3420, 640}` and `{1800, 1900, 2720}`. Rules: from lap 3; 1.0 s detection; locked out when wet (> 0.3) or under yellow; rear ×(1−.22·drs), drag ×(1−.11·drs); AI uses it; KeyF with a fallback key; flap -0.5 rad over 0.15 s. · ERS overtake: a 4 s momentary mode. · Pit compound choice through the MFD STRATEGY page. · VSC (32 m/s), then the SC (45 m/s, 25 m gaps, original livery, amber bar at ×6 and 2 Hz).
- Accept: new drs and vsc vitests pass (the field never passes the SC; laps keep counting). `npm run test:physics` and `test:race-control` green. DRS is off in benchmark laps. The capture shows the DRS pill lit on lap ≥ 3.
- Refs: maxigeek 089, ps4hry 097, joinsteer 094, onpsx 095, PSQ036.
- Tests: wheel-alignment, physics, race-control, marshal, traffic, driver-brain, aero-surface, bindings, button-actions, input, race-day, qualifying, pit-release, pit-approach, recording, drs, vsc.

**D28 night-golden-hour**: Golden Hour and Night (Lighting Artist). Slot 14, port 4720.
- Owns: `venue-lighting.ts`, `light-footprint.ts`, `point-light-work.ts`, `track-signal-hardware.ts` (emissive only), new `studio/light-pools.ts`.
- May touch: `daylight.ts:57-97` (circuitLightState), `lighting-coherence.ts` (sunset and night entries), `renderer.ts` (the venueLighting update lines), dusk-readability and point-light-work tests.
- Goals: Sunset: key `#ffb26b-#ffc58e`, key/fill 5-7:1, shadows `#2e3550-#3a4660`, sky from `#f2b27a` to `#4a6fa8`, p50 0.15-0.25. · Night: analytic mast pools every 25-35 m (≥ 8 active near the camera at 0 calls) with uniformity ≥ 0.6 (`#5e5d58-#706f67` under the masts, ≥ `#40443d` between); sky `#06090d-#0b0d14`; lamp bloom halo 1.5-3 % of frame height; start lamps at emissive 25.
- Accept: the night and sunset captures meet these numbers. Night Δcalls ≤ +8.
- Refs: `artA_conv/025`, TX078, TX079, TX080, maxigeek 087, `artA_conv/021`, PS004, PS009.
- Tests: dusk-readability, point-light-work, visual-coherence, track-signal-hardware, presentation-continuity, exposure-key, reference-rendering, start-gantry.

**D29 frontend-menus**: Front End and My Team (UI/UX Designer). Slot 15, port 4735.
- Owns: `src/ui/team-hub.ts`, `decal-editor.ts`, new `src/ui/frontend.ts`, `frontend.css` (`?inline`), new `studio/speed-tunnel.ts`, `menu-preview.ts`, `headquarters-stage.ts`, `photo-stage.ts`.
- May touch: `interface.ts:134-151, :186-240`, `main.ts:1118-1130`, `renderer.ts:975-984`, `style.css` (menu sections L141-315 and L2664-2811).
- Goals: AB-B §4.1-4.3: a left list menu (3.3 vh, weight 800, white 2 px pill) with CSS-only tabs. Keep the 8 `.menu-actions` buttons, the Tab path to GARAGE & SETTINGS (13 Tabs after D27; update e2e/28 L279 only if your change alters it, with TEST-UPDATE) and every label. Apply P14. · Speed-tunnel shader (`#07060a`, streaks `#c8203c→#ff4a6a`, floor `#1e5a5a`). · Showroom: camera height 1.2 m, fov 32, slow orbit, DOF from D09, rim lights. · My Team on the HQ stage, drawn once before the modal (`menuCovered`, no new frames). Cards and tokens (`#fc4854`, `#a8fccc`, `#a884cc`).
- Accept: e2e 07, 08, 09, 15, 28 (menu tests) and 30 pass. Shot 00 has no form overflow at 1280×720.
- Refs: `conv/012`, `conv/013`, `conv/015`, `conv/016`, `conv/017` (`_ea_*.png`), thumbculture 040, PS005, `artA_conv/031`.
- Tests: team-career, reference-depth, presentation, menu-presentation, menu-preview, tab-evidence, review-tools, photo-reference.

**D30 replay-photo**: Replay, Broadcast Cameras and Photo Mode (Cinematics Designer). Slot 15, port 4750.
- Owns: `src/ui/photo-studio.ts`, `photo-camera.ts`, `broadcast-cameras.ts`, `broadcast-camera-placement.ts`, `broadcast-sightlines.ts`, `trackside.ts`, `replay-presentation.ts`, new `src/ui/replay-hud.ts`, `replay-hud.css`.
- May touch: `broadcast-grade.ts` `apply()` (a photo-only override, never GRADE_PROFILES), `renderer.ts:782-814`, `interface.ts:184-186` (install call), `main.ts:902-940`.
- Goals: Trackside telephoto at vertical fov 12-24 (with zoom), heights 3-8 m, DOF when fov < 20°, pan blur with the car sharp. · 12.2 % letterbox on cinematic cameras, cuts every 3-6 s biased to battles (< 1.0 s gap), a 2.5 s lower-third. · Replay HUD: full tower (2.95 vh), REPLAY badge, transport that hides after 2.5 s, highlight tags. · Photo: filters (neutral, vivid, cinematic, mono, warm, cool), vignette, grain and saturation sliders, free-roam pan, sun azimuth, shutter blur, frames. Keep `apex-photo-<ms>.png`.
- Accept: e2e 07, 08, 09, 15 and replay-state pass. In shot 13 the trackside view shows telephoto compression and background blur. Gameplay grain is still 0.
- Refs: TX075, TX078, TX080, cgmag 090, thumbculture 039/041/042, PS002, gamescreed 086.
- Tests: broadcast-cameras, broadcast-camera-cycle, broadcast-sightlines, trackside, replay-presentation, photo-reference, broadcast-presentation, presentation, pit-replay-selection.

**D31 gameplay-flashback**: Flashback and Time-Trial Leaderboard (Gameplay Engineer). Slot 16, port 4765.
- Owns: `src/storage/replay-pages.ts`, `src/storage/recorders.ts`, new `src/core/flashback.ts`, `src/ui/flashback.ts`, `tests/flashback-determinism.test.ts`.
- May touch: `physics.worker.ts` (input log and the flashback message), `diagnostics.ts`, `world.ts`, `main.ts` (pause button, KeyX), `bindings.ts`.
- Goals: Write the determinism test **first**: 2×3000 ticks give bitwise-identical `writeFrame` output from logged inputs, including the watchdog brake 0.4. · Log inputs; implement `{type:'flashback', tick}` as a sliced re-sim (~2000 steps per turn); add `truncate` to SessionReplay and TelemetryRecorder. · UI: last 30 s, RESUME FROM HERE, 5 per race. Add checkpoints if a 3-lap re-sim takes > 2 s. · Local time-trial leaderboard: top 10 per circuit in IndexedDB.
- Accept: the determinism test passes. After a flashback the resumed state matches the replay frame (position Δ < 1 mm).
- Refs: topgear 069. Tests: recording, worker-pause, session-review, ghost-lap, telemetry-export, telemetry-plots, physics, core, flashback-determinism.

**D32 performance-budget**: Performance and Budget (Performance Engineer). Slot 16, port 4780.
- Owns: `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json` (sole re-pinner), `texture-budget.ts`, `imported-texture-budget.ts`, `render-census.ts`, `draw-ledger.ts`, `opaque-order.ts`.
- May touch: any `studio/*` module for draw merging (notify the owner), the `options.ts` Low presets, `tests/infrastructure-render-budget.test.ts` (structure only).
- Goals: Measure day, sunset and night cold cockpit frames (Medium, 12 cars) after D01-D30. · Claw back draws: merge buckets, cull new shadow casters, tune impostor distances. · Meet the KPI 16 caps with composer < 1800, keep Low ≤ its baseline cost and the frame time ≤ 1.25×. · Re-pin once, with the per-department deltas listed in the commit.
- Accept: `scenery-shadow-budget -g day`, `56-track-infrastructure`, `57-trackside-operations` and e2e `aurel-vegetation` pass (under flock) against the new pin.
- Refs: `$S/shots/baseline/diag.json`. Tests: infrastructure-render-budget, operations-render-budget, draw-ledger, render-census, imported-render-budget, performance, completed-draw, gpu-frame-gate.

**D33 qa-signoff**: QA Sign-off and Look Contracts (QA Lead). Slot 17, port 4795.
- Owns: new `tests/studio-look-contracts.test.ts` (pins the P5-P12 values, LIVERIES saturation ≥ 0.45, kerb 1.1 m, the P19 word list), new `scripts/studio/signoff.mjs`.
- May touch: any file, for minimal integration fixes only (report each one).
- Goals: At the integration tip: lint, tsc, build, and the **full vitest suite once**. · DOM e2e 28, 30, 35, 49 and 52. GPU e2e 12, 13, 27, 37, 38 and scenery-shadow-budget (under flock). · Capture matrix at Medium and High, plus `look-metrics` (≥ 80 % of KPI checks PASS) and montages against the references per category. · Grep for real trademarks. Run the pinned-path diff check. Write the defect list for the orchestrator.
- Accept: everything above is green, and `git diff 3a6036d --stat -- public/models 'src/rendering/*.glb.gz' 'src/rendering/*.geometry.json' 'scripts/author-*.py' 'scripts/*.blend' src/rendering/pit-building-layout.ts docs/MASTER_DIRECTIVE.md` is empty.
- Refs: all categories. Tests: studio-look-contracts plus the full suite.

---------------------------------------------------------------------------------------------------
## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pinned look tests break on every retune | Same-commit TEST-UPDATE rule. D03 and D07 own the daylight and sky tests. Never weaken a test. |
| renderer.ts / circuit.ts / car.ts merge storms | One owner per file, ≤ 10-line hooks, slot pairing (§4), `studio/` modules |
| Draw budget blows up during wave 2 | The §3 allocation is reported in every commit message. D32 claws back and re-pins once. Expensive work goes to High. |
| SwiftShader time (≈ 10 s per frame) | Medium ≤ 16 taps; bakes at load or on bin change; captures serialised with flock |
| IP (RB19 marks, references) | P13 runtime swap, the P19 list and a test (D13, D33), and no reference pixels in the repo |
| Determinism regressions (e2e 12, 13, 37, 38) | `studioTime` only; reset on cuts; qa-signoff runs the pixel-sensitive specs |
| `docs/studio/` pull collisions | Agents never commit it. The orchestrator owns it. |

Backlog (not scheduled): formation lap (TUF §5.5), reverse layouts, virtual mirror overlay, audio pass (DRS flap, crowd swell,
rain), driver-select screen with rim-lit characters, racing-line assist recolour, an F2 HUD variant.
