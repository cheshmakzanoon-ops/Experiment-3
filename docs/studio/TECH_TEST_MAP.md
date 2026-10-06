# TECH_TEST_MAP: build, test and QA surface (Build & QA Engineer)

Scope: everything an implementation agent needs to change this repo safely and prove the change.
All numbers below were **measured on this machine on 2026-10-06 at HEAD `3a6036d`**, unless marked otherwise.
Companion docs: `TECH_RENDER_MAP.md` §10 (budgets) and §13 (render hazards). This doc does not repeat their
renderer internals. It maps tests, gates, the asset integrity chain, the worktree workflow and the capture loop.

Scratchpad root used below:
`S=/tmp/claude-0/-home-user-Experiment-3/378de659-9944-56cf-89fb-195c2dec2c03/scratchpad`

---

## 0. Ten rules (read first)

1. **The machine is small: 4 CPUs, 15 GB RAM, about 29 GB free disk.** SwiftShader renders on the CPU at
   about 9-10 s per 1280×720 Medium frame. **Run captures one at a time** (`flock $S/capture.lock …`, see §9).
2. **Never run the full vitest suite or the full e2e suite.** Vitest takes 8 min, and the 222 e2e cases take
   hours on SwiftShader. Use the per-area subsets in §3 (19-105 s) plus the specific test files for your module.
3. **Never `git add -A` or `git add .`.** In a worktree, the `node_modules` symlink shows as untracked:
   `.gitignore`'s `node_modules/` matches directories only. Any Playwright run, even `--list`, writes an
   untracked `browser-progress.json` to the current directory. Stage explicit paths.
4. **Do not edit any hash-pinned file** (§6): GLBs, `*.glb.gz`, `scripts/author-*.py`, `*.blend`,
   `*.geometry.json`, the `*.manifest.json` hashes, `src/rendering/pit-building-layout.ts`, `docs/MASTER_DIRECTIVE.md`,
   `docs/IMPLEMENTATION_MATRIX.md` rows, `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json` and
   `docs/PLAYER_INDEX_CACHE_AUDIT.json`. There is **no Blender** here, so authored assets cannot be regenerated.
   Change their look at runtime after decode instead.
5. **Never run `npm run format`.** It rewrites 131 files that are not Prettier-clean (64 of them in `src/`). Use
   `npx prettier --write <file>` only on files that already pass `npx prettier --check <file>`. The hot files
   `renderer.ts`, `daylight.ts`, `materials.ts`, `options.ts`, `car.ts`, `lighting-coherence.ts` and
   `ui/interface.ts` are clean.
6. **Port 4173 is already taken** by a long-running `vite preview` (pid 747, started 04:32) that serves the *main
   checkout's* `dist/`. `playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, so a plain
   `npx playwright test` **silently tests that stale build, not yours**. Use `$S/tools/pw-port.config.ts` (§7).
7. **Every Playwright run needs `CHROMIUM_PATH=/opt/pw-browsers/chromium`.** @playwright/test 1.55.1 looks for
   `chromium_headless_shell-1193`, but only `-1194` is installed. Without the variable, globalSetup fails in 4 s.
8. **`npx vitest run` does not run `pretest`.** In a fresh worktree, `tests/supplied-player-lods.test.ts` fails
   with ENOENT until `npm run generate:player-lods` (about 4 s) or `npm run build` has produced the gitignored
   `public/models/supplied-player-lods.bin.gz`.
9. **`docs/studio/*.md` is untracked in the main checkout only.** Worktrees do not contain it, so read it by
   absolute path (`/home/user/Experiment-3/docs/studio/...`). If any agent *commits* a file under `docs/studio/`,
   a later `git pull` in the main checkout aborts on the untracked collision. Leave `docs/studio/` to the
   orchestrator.
10. **The integration branch `claude/funny-mayer-78089j` is checked out in `/home/user/Experiment-3`.** It
    cannot be checked out in a worktree. Work on `studio/<dept>` branches and fast-forward push
    `HEAD:claude/funny-mayer-78089j` (§11 step 5). On the remote it **does not exist yet**: only `main` (= `3a6036d`)
    does, and the local `origin/claude/funny-mayer-78089j` ref is stale. The first push creates it.

---

## 1. Environment facts

| Item | Value |
|---|---|
| Node / TypeScript / Three.js / Vite / Vitest / Playwright | node ≥22.12, TS 5.9.3, three 0.180.0, vite 7.1.7, vitest 3.2.4, @playwright/test 1.55.1 |
| Browsers | `/opt/pw-browsers/chromium` → `chromium-1194/chrome-linux/chrome` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) |
| GPU in browser | SwiftShader through ANGLE/Vulkan (`--use-angle=swiftshader`). CI also uses Mesa llvmpipe (`APEX_BROWSER_BACKEND=mesa`), which needs an X display that this box lacks. |
| Blender / bpy | **not installed.** The `scripts/author-*.py` and `*.blend` pipelines run only in GitHub workflows (`*-authoring.yml`). |
| Python | `python3` with PIL 12.3 and numpy 2.5 (used by `$S/tools/shotdiff.py` and `stats.py`) |
| Git | identity `Claude <noreply@anthropic.com>`; no git hooks; remote `origin = github.com/cheshmakzanoon-ops/Experiment-3`; push dry-run works |
| CI | `.github/workflows/ci.yml` runs on **push to `main` and on PRs only**, so a push to the feature branch does not trigger CI. Jobs: `validate` (`npm run check:stable`), `scenarios` (physics scripts), `browser` (8 Mesa shards, 45 min each). |

---

## 2. Commands and measured timings

| Command | Time (wall) | Result now | Notes |
|---|---|---|---|
| `npm run lint` (`eslint src tests e2e scripts`) | **11.7 s** | 0 problems | Flat config `eslint.config.js`: `no-explicit-any` and `no-unused-vars` are errors; `_`-prefixed names are allowed. Root `*.ts` files are not linted. |
| `npx tsc --noEmit` | **15.9 s** | 0 errors | `tsconfig` includes `src`, `tests`, `e2e`, `scripts` and root `*.ts`, so e2e fixtures and tests are type-checked against `src` APIs. |
| `npm run build` | **28.5 s** | ok | Runs `prebuild` (player LOD check/generation, about 4 s), then `tsc --noEmit` again (about 15 s), then `vite build` (9.2 s). Output `dist/` is about 110 MB: `public/models` is copied, and `index-*.js` is 9.55 MB (2.3 MB gzip). |
| `npx vitest run tests/a.test.ts tests/b.test.ts …` | **1-2 s** for small files | | `vitest.config.ts`: `maxWorkers: 1`, `testTimeout: 120000`, include `tests/**/*.test.ts`, node environment (no DOM, no WebGL). |
| `npm test -- tests/x.test.ts` | 1.6 s | | Same, but runs `pretest` first (LOD check, a no-op when already generated). |
| Full `npx vitest run` | **8 min 2 s** | 218 files, 1914 tests pass | Do not run. Slowest files: secondary-stand-traversal 43 s, endurance-mode 40 s, phase27h6 33 s, qualifying 24 s, racing-line 21 s, pit-release 15 s, physics 13 s, a32-pit-jacks 12 s, engineering 11 s, event-hall-approach 10 s, wet-review-start 9 s. |
| `npm run check` | lint + full vitest + build | | about 9 min |
| `npm run check:stable` | `check` inside a source snapshot | | Fails if any command writes to `src public scripts tests e2e docs .github` or any root file. Only `public/models/supplied-player-lods.bin.gz`, `dist/` and `node_modules/` are exempt. |
| `npx playwright test --list` | about 5 s | 222 tests in 87 files | Writes `browser-progress.json` to the current directory. Delete it. |
| One DOM-only e2e spec through the port wrapper (§7) | **10.9 s** | `e2e/49-hud-footprint` pass | |
| Visual capture (§9), Medium | **409 s** | 7 PNGs, 0 errors | Loading 37 s, then menu, then driving at 165 s, then about 40 s per shot |
| `git worktree add` | 0.7 s, 147 MB | | Plus about 110 MB of `dist/` after a build |

Simulation-only scripts (`npm run test:physics`, `test:dynamics`, `test:race-control`, `test:wet-pits`,
`test:journey`, `test:endurance`) do not touch rendering. Visual departments do not need them.

---

## 3. Vitest per-area fast checks

`$S/tools/fastcheck.sh` (bash) runs a named subset with the `dot` reporter: `bash $S/tools/fastcheck.sh render`
(or `world car character ui assets sim all-visual list`). Run it from the worktree root.
All sets passed at HEAD in the worktree:

| Area | Files / tests | Time | Run when you touch… |
|---|---|---|---|
| `render` | 32 / 274 | **19 s** | `renderer.ts`, `daylight.ts`, `lighting-coherence.ts`, `exposure-meter.ts`, `adaptive-exposure.ts`, `broadcast-grade.ts`, `lens-bloom.ts`, `scene-ambient-pass.ts`, `motion-blur.ts`, `specular-aa.ts`, `far-shadow.ts`, `reflections.ts`, `wet-reflection.ts`, `point-light-work.ts`, `options.ts`, `draw-ledger.ts`, `spray-clouds.ts`, `rain-streaks.ts` |
| `world` | 37 / 298 | **71 s** | `circuit*.ts`, `landscape.ts`, `terrain*.ts`, `venue-*.ts`, `aurel-*.ts`, `materials.ts`, `surface-detail.ts`, `asphalt-aggregate.ts`, `road-macro.ts`, `local-atmosphere.ts`, `trackside.ts`, `grandstand.ts`, `start-finish*.ts`, `static-*`, `scenery-*`, `build-queue.ts`, `tyre-marks.ts`, `effects.ts` |
| `car` | 34 / 325 | **38 s** | `car*.ts`, `bodywork.ts`, `hero-shells.ts`, `paint-finish.ts`, `manufacturing.ts`, `tire-*.ts`, `supplied-*.ts`, `a61-rival.ts`, `mirrors.ts`, `shadow-proxies.ts`, `cockpit*.ts`, `wheel-*.ts`, `menu-preview.ts`, `photo-stage.ts`, `instruments` |
| `character` | 19 / 129 | **33 s** | `driver*.ts`, `people-asset.ts`, `crew-*.ts`, `pit-crew.ts`, `crowd*.ts`, `foreground-person.ts`, `helmet-shell.ts`, `elbow-sleeve.ts`, `grid-*` |
| `ui` | 19 / 238 | **31 s** | `src/ui/**`, `src/core/*`, `storage/data.ts`, `options.ts` (settings) |
| `assets` | 36 / 348 | **105 s** | any manifest, loader `decode*`, `public/models/*`, `src/rendering/*.glb.gz`, `*.geometry.json` |
| `sim` | 23 | not timed | `src/simulation/**` |

Run the area set for **each** area your diff touches, plus `npx tsc --noEmit`. Before you push, also run
`npx vitest run` on every test file that imports a module you changed. To find them:
`grep -l "rendering/<module>" tests/*.test.ts`. A full module-to-test import map was generated at
`$S/test-imports.txt`.

### 3.1 What each render or visual test pins (the numbers that will break)

*Renderer / lighting / post* (see TECH_RENDER_MAP §13 for line numbers):
- `dusk-readability`: sunset `sun = 2.8·(1-0.88c)`, `exposure = 1.01-0.03c`, `skyRadiance = 0.26+0.12c`,
  `fogDensity = day×1.18`, `fill ∈ (0.27+0.2c, 0.6]`, `environment ≥ 0.24-0.06c`. `circuitLightState(c,t,'day')`
  must deep-equal `daylightState(c,t)`. `applyCircuitLightPalette` makes the sun warm (r>b) and the fill cool (b>r),
  leaves intensities at 1, and is exactly reversible.
- `visual-coherence`: `sun.shadow.normalBias` is 0.004 at sunset and 0.008 at day/night. Sunset warmth under full
  cloud is <25 %. Night sun is below day sun. Rain and spray materials use `lights:true`, include
  `precipitationLighting` and `getDistanceAttenuation`, and set `depthWrite:false`. It also covers exposure-ownership
  rules across camera cuts.
- `sky-linear`: Preetham saturation thresholds. `skyLinearGain` is ≈0.513 at turbidity 2.96, **0.523 at 2.3 (the
  configureSky default)** and 1.54 at sunset turbidity 5.6. The shader must contain `uniform float skyLinearGain` and
  `*skyLinearGain,retColor,sundisk)`.
- `sky-order`: Sky `depthWrite=false`, `depthTest=true`, not transparent, vertex `gl_Position.z = gl_Position.w`, sorted last.
- `daylight-environment`: SkyEnvironment uses 0.125 cloud bins, capture `skyRadiance = 0.32+0.2·cover` and 4 retained targets.
  Wet-road shader strings: `roadState.gb *= surfaceDeposits`, `mix(normal, dryRoadNormal, wet * mix(0.35, 0.9, puddle))`,
  and the derivative guards `if (min(dx2, dy2) < 1e-16) return surf_norm;`.
- `weather-reconciliation`: the sky blend material is GLSL3, `toneMapped=false` and NoBlending, with no tonemapping
  or colorspace chunk. Caller renderer state, including tone mapping, is restored after a failed capture. Crowd
  `userData.weatherExposure` is 0.32 or 0.25.
- `reference-rendering`: `daylightState` sun decreases monotonically with cloud, `fill < 1`, and storm fog is denser
  and darker. Sky `sunPosition == SUN_OFFSET`. `shadowAnchor(…, 2048, 38)` snaps in the light frame.
- `exposure-key`: `METER_KEY` day > sunset > night. Adaptation clamps at +0.85 / -0.7 EV. Base exposures are
  day 0.912, sunset 1.006 and night 1.12. The measured Aurel log-luminances must centre to |mean EV| < 0.05, so
  **retuning sun or sky radiance changes real frames and needs these meter fixtures re-measured**.
- `broadcast-presentation`: presets `msaa` 0/2/4, AO off/on/on, bloom off/on/on, `filmGrade:true`.
  `AMBIENT_OCCLUSION` radius in (0.2, 2), `maxPixels ≤ 96`, `nearStart ≥ 0.8`, `nearEnd ≤ 3`, frozen. Every
  `GRADE_PROFILES` entry has contrast in [0, 0.4), saturation in (0.9, 1.25), vignette ≤ 0.2,
  **grain = fringe = sharpen = 0**, and tints in (0.85, 1.15).
- `presentation`: settings `version` 6. Migration yields `graphicsPreset('high')`. `validateGraphics` clamps
  (resolutionScale 0.5-1.5, motionBlur ≤ 0.6, textureSize {128..1024}, shadowSize {0,512,1024,2048}).
- `settings-transition`: **two literal `GraphicsOptions` objects (17 keys)** at lines 32-48. A new graphics key causes
  a `tsc` error until it is added to both, with distinct values.
- `lens-bloom` (13-tap down / tent up, soft knee, firefly clamp, half-res pyramid), `motion-blur` (off by default,
  needs float buffers, restores clear colour and targets), `specular-aa` (patches `lights_physical_fragment` once,
  marker `apexSpecularAA` after `geometryRoughness`), `far-shadow` (patches the directional loop of
  `lights_fragment_begin`; bake without cars or people), `point-light-work`, `reflections` (probe cadence, softboxes
  hidden from camera views, state restore), `wet-reflection` (skipped when dry, on Low, or under water).
- `race-view-continuity` runs the **real `RacingRenderer.prototype.draw`** on a hand-built fixture
  (`tests/race-view-continuity.test.ts:135-200`). A new `this.x` read in `draw()` before the shadow anchor must
  be added there or optional-chained. `startup` pins the `prepare()` order.
- `infrastructure-render-budget` / `operations-render-budget` / `draw-ledger`: `DRAW_PHASES = environment, probe,
  mirrors, wet, shadow, composer, other`. **Adding a phase** requires that phase in every
  `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json` `drawBreakdown` and in the inspection rule (only `other` and
  `shadow` may carry work in fixed inspections).

*World / surfaces*: `aurel-vegetation` (foliage `alphaTest 0.45`, `transparent:false`, shared depth and distance maps),
`aurel-environment` (shader must contain `venueFinishResponse()`, `apexLocalDensity`, `fwidth(grid)`,
`roughnessFactor=clamp`), `race-surface-atmosphere` (asphalt aggregate is deterministic, periodic and resolution-independent,
and **only asphalt maps change**), `wet-broadcast-fidelity` (water-film clearcoat lobe on wet asphalt only; marshal LED
`color == emissive == expected hex`), `printed-panels` (`printedBack` uniform `0x2b3236`), `road-macro`,
`circuit-detail`, the shadow-bounds tests, and `graphics-continuity` (static batching keeps every triangle, UV,
normal, colour and transform).

*Car / cockpit*: `phase27e` (8 real cooling slots; "adds no texture or time uniforms"), `phase27h-assembly` (checked-in
role/material scene contract `apx01-assembly.json`), `hero-shells` / `hero-import` (**importing `hero-shells.ts` must
not fetch or resolve URLs**: a Vite IIFE build of the module runs in a VM), `supplied-shader-work`, `decal-coverage`,
`imported-render-budget` (texture budget ownership; the GLTF orientation and colour space are preserved),
`supplied-player` (exact hashes; hub fit to physics), `a61-rival` (near/mid/far derivatives; no extra near draws),
`shadow-proxies` (a rival casts the same shadow triangles in about half the draws), `mirror-detail`, `cockpit-detail`,
`a32-pit-jacks` (measures supplied-player jack fits: front z 2.8, rear z -2.25).

*Characters*: `character-quality` (hashes `scripts/author-driver.py` and `author-people.py`; driver has 9 bones;
crew_high < 6000 tris and crew_mid < 2500; the helmet shader must contain `roughnessFactor=mix(roughnessFactor,.17`;
**sleeve WEIGHTS_0 bytes are hash-pinned**), `people` (`aurel-people.geometry.json` bytes), `crew-performance` (geometry
JSON and GLB hashes), `driver-asset`, `driver-controls`, `elbow-sleeve`, `phase27g-seams`, `graphics-continuity`
(exactly 2 shared textures for glove and suit, with distinct responses; glove emissive 0).

*UI*: `presentation`, `settings-transition`, `race-day`, `gap-timer`, `proximity`, `engineering`, `practice-programme`,
`team-career`, `reference-*`, `tab-evidence`, `review-tools`, `photo-reference`, `acceptance-matrix` (reads
`docs/MASTER_DIRECTIVE.md`).

---

## 4. Per-area recommended fast checks (copy-paste)

| Change type | Minimum before every commit | Before push (adds) | Visual proof |
|---|---|---|---|
| Renderer, post, lighting, sky, fog, exposure | `npx tsc --noEmit && bash $S/tools/fastcheck.sh render` | `world` set if you touch shared shader chunks (`materials.ts`, `specular-aa`, `far-shadow`). For draw-count changes: `e2e/scenery-shadow-budget.spec.ts -g day` (§7). | capture Medium + `shotdiff` |
| World, environment, track surface, vegetation, venue | `tsc` + `fastcheck world` | `fastcheck assets` if any loader or manifest code changed | capture Medium (shots 13 and 20 show the trackside and track) |
| Car body, paint, tyres, cockpit, mirrors, supplied player | `tsc` + `fastcheck car` | `fastcheck assets` (supplied player / rival hashes) | capture (shots 10, 11, 12, 20, 21) |
| Characters, driver, crew, crowd | `tsc` + `fastcheck character` | `fastcheck assets` | capture (11, 21 cockpit gloves; 13 crowd) |
| HUD, menus, CSS, settings | `tsc` + `npm run lint` + `fastcheck ui` | the DOM-only e2e specs `49-hud-footprint`, `28-race-hud-layout -g DOM-only` and `52-vehicle-hud` (§7) | capture shot 00 (menu) + any HUD shot |
| New graphics option | all of the above for `ui` + `render` | edit `options.ts` (preset + `validateGraphics`) and `tests/settings-transition.test.ts` (both literals) in one commit | |

Always finish with `npm run lint` (12 s) if you touched `tests/`, `e2e/` or `scripts/`, and `npm run build` (29 s)
before capturing.

---

## 5. Test categories that are "contracts", not "looks"

Most tests here check **ownership, determinism and restore semantics** ("restores renderer state on failure",
"held frames identical", "disposes exactly once"), not appearance. When you add a pass or material hook, follow
the established patterns or these tests fail:
- Every `onBeforeCompile` hook chains the previous hook **exactly once** and is idempotent (marker string,
  stable `customProgramCacheKey`). Tests call `material.onBeforeCompile(shader)` with
  `T.ShaderLib.standard` sources and `toContain` exact GLSL snippets.
- Every pass restores the render target, viewport, scissor, autoClear, clear colour, tone mapping and visibility
  in `finally`.
- No wall-clock or `Math.random()` in presentation. Use presented time (`H.TIME`). Held, paused and rewound
  frames must be byte-identical (e2e `38-fog-quadrature` held delta 0; `scenery-shadow-budget` 0 changed bytes).
- Loaders **fail closed**: a missing or corrupt asset must throw, never fall back to procedural art
  (`20-phase27h`, `24-coupled-driver`, `driver-asset` tests).

---

## 6. Asset integrity chain: what breaks if you edit X

**Runtime:** every authored GLB loader (`hero-garage.ts:213`, `supplied-player.ts:41`, `concrete-barriers.ts:272`,
`aurel-vegetation.ts:515` and about 25 more `crypto.subtle.digest` call sites) hashes the fetched bytes and
**throws** on a mismatch with `manifest.sha256` / `compressedSHA256`. The URL is cache-busted with
`?v=<sha256[0:16]>`. A changed GLB with a stale manifest means the circuit fails to load. Twenty-four authored
kits are in `public/models/aurel-*.glb`. Nine ship as Vite-imported `src/rendering/*.glb.gz`: apx01-shell,
apx01-driver, a61-rival-near/mid/far, aurel-people, crew-performance, grid-mechanic and start-finish.

**Tests (vitest `assets` set):** each `src/rendering/<kit>.manifest.json` pins up to five things: `url`+`bytes`+`sha256`
(the GLB), `sourceSHA256` (= sha256 of `scripts/author-<kit>.py`), `editable` (`scripts/<kit>.blend`, size
> 10 KB or 100 KB; for quarry, vegetation, event-hall and secondary-grandstands the exact `editableSHA256`),
`triangles` per LOD, and material/mesh/node counts plus socket coordinates. The kit test decodes the real GLB
and checks all of them.

| You edit… | What fails |
|---|---|
| any `public/models/aurel-*.glb` | runtime integrity throw; the kit test (`hero-garage`, `catch-fence`, …); `pit-building-frontage` (also hashes the garage and pit-wall GLBs); `track-infrastructure`/`trackside-operations` decode; the e2e kit specs |
| a `src/rendering/*.glb.gz` | `hero-shells`, `a61-rival` (hashes the shell, driver and rivals), `driver-asset`, `character-quality` (sleeve weight bytes), `crew-performance`, `people`, `start-finish`, `race-surface-finish`, `a32-pit-jacks` |
| `public/models/supplied-player.glb.gz` (36 MB, pinned `compressedSHA256 269b4d94…`) | **`prebuild`/`pretest`/`predev` abort with "Wrong player source"**, so build, test and dev are all dead. Also `supplied-player`, `supplied-player-lods`, `a32-pit-jacks` and runtime. |
| `scripts/build-player-lods.mjs` levels/params, or `meshoptimizer` version | build aborts with "LOD derivative differs from pinned manifest". Re-pinning needs the explicit `node --experimental-strip-types scripts/build-player-lods.mjs --update-manifest`, which rewrites `src/rendering/supplied-player-lods.manifest.json`. `tests/supplied-player-lods.test.ts` then still pins 172 rows, 516 tiers, an oriented-triangle fingerprint and `docs/PLAYER_INDEX_CACHE_AUDIT.json`. **Do not.** |
| `scripts/author-*.py` (even whitespace) | the kit test's `sourceSHA256` check (about 30 tests) |
| `scripts/*.blend` | size checks; exact hash for quarry, vegetation, event-hall, secondary-grandstands, a61 (`apx01-assembly.blend`) |
| `src/rendering/pit-building-layout.ts` | **`tests/pit-building-frontage.test.ts:35` hashes this TypeScript source file.** |
| `src/rendering/{start-finish,crew-performance,aurel-people,event-hall,a33-spare-wheel-set,secondary-grandstands,grid-mechanic}.geometry.json` | byte hashes in `start-finish`, `crew-performance`, `people`, `event-hall`, `a33-spare-wheel-set` and `secondary-grandstand-assets` |
| `docs/MASTER_DIRECTIVE.md` | `directive.test.ts` (exact sha256 `f508a1b9…` and 148 headings mirrored in `IMPLEMENTATION_MATRIX.md`), `acceptance-matrix` |
| `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json` | `infrastructure-render-budget` unit test and every e2e cockpit budget gate |
| anything under `playable/` | stale release snapshot (`BUILD.json` hashes) used by `publish-validated-release.sh`. Leave it alone. |

**BUILD_IDENTITY:** `vite.config.ts` hashes `src/**`, `package-lock.json`, `index.html` and `vite.config.ts` into
`__APEX_SOURCE_FINGERPRINT__`. It records `commit` only when those paths are clean in git. `dist/BUILD_IDENTITY.json`
and `apexDiagnostics().buildIdentity` expose it. The worktree build at clean HEAD reported commit `3a6036de…`.
Use it to prove which build a capture came from.

**Safe ways to improve authored assets:**
- Runtime material overrides in a separate look-dev step after decode (roughness, envMapIntensity, colour
  grading of maps, detail normals). Keep material and mesh counts unchanged in `decode*()` output, because the kit
  tests count them. Better still, apply the overrides where the circuit or car assembles kits rather than inside `decode*`.
- Procedural TS geometry for new props.
- **New** GLBs with a **new** manifest and loader. Avoid this unless it is unavoidable: every new GLB adds
  repo weight, and the pattern expects an author script.

---

## 7. e2e (Playwright) surface

87 spec files and 222 cases. `workers: 1`, `timeout: 300 s`, `expect.timeout: 60 s`, `retries: 0`, viewport 1440×900.
`globalSetup` (`scripts/browser-backend-setup.ts`) launches the configured browser and requires a SwiftShader
renderer string (or llvmpipe for mesa). It writes `browser-backend.json` (gitignored). Many specs bundle an
`e2e/fixtures/*.ts` file with `vite build({configFile:false})` and inject it into a blank page. **Fixtures import
`src` internals directly**, so `tsc` catches API drift, but behaviour drift shows only in the browser.

### 7.1 Running one spec safely (verified, 10.9 s for spec 49)

```bash
cd $WT                                   # your worktree, after `npm run build`
CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$WT APEX_PORT=$PORT2 \
  npx playwright test -c $S/tools/pw-port.config.ts e2e/49-hud-footprint.spec.ts   # add -g "<title regex>" to select cases
rm -f browser-progress.json
```
`$S/tools/pw-port.config.ts` spreads the main checkout's `playwright.config.ts`. It points `testDir`, `globalSetup` and the
reporter at `$APEX_WT`, starts `npx vite preview --port $APEX_PORT --strictPort` in `$APEX_WT`
(`reuseExistingServer:false`), and writes results to `$APEX_WT/../pw-results-$PORT`. It imports the base config from
`/home/user/Experiment-3`, so it ignores edits you make to `playwright.config.ts` in a worktree.

### 7.2 Classification

- **DOM-only, fast (≤ 1 min): run these freely for UI work.** `49-hud-footprint` (panel area ≤ **12 %** of 1600×900 and
  1920×1080 for `.timing .lap-panel .car-status .instruments .position-badge .session-status`, styled by
  `src/ui/style.css`; now 8.9 % and 6.2 %), `28-race-hud-layout` (titles "DOM-only", including menu reachability
  at several viewports), `52-vehicle-hud`.
- **Isolated GPU fixtures** (blank page plus fixture scene, about 1-10 min each on SwiftShader): 00-wet, 02-05, 10-13, 16, 18, 19, 20, 22,
  27, 30-race-finish, 31-35, 37, 38, 39, 41, 42, 43-45, 55, a32-offline, a34, a35, camera-continuity,
  instruments, motion, weather, scenery-shadow-budget, pit-presentation.
- **Full application journeys** (menu, then race; slowest; avoid): 07-09, 15, 17, 23-26, 29, 36, 46-48, 50, 51, 53, 54,
  56, 57, application, audio, calibration, construction, performance, replay-state, settings-transition,
  presentation, spatial-audio, the a26/a31/a33/a36 kits, aurel-quarry/vegetation, event-hall, secondary-grandstands. `28-race-pit-presentation`
  and `29-populated-race-review` drive full laps and can take far longer than 5 min each on SwiftShader.

### 7.3 Pixel-sensitive specs (compare their own renders: held vs live, A vs B)

`38-fog-quadrature` (max channel Δ ≤ 1, mean < 0.01, held Δ = 0), `30-race-finish` (max Δ ≤ 1), `13-wet-lighting-closure`
(axial max diff ≤ 2), `37-race-surface-atmosphere` (registered asphalt must *change* by mean > 0.1; rewind is exact),
`39-supplied-player` (LOD review mean Δ < 2; tier 4 exact), `41-player-render-budget` (decal Δ mean < 0.5, opaque and
coverage < 0.05), `42-full-scene-index-budget` (every held HDR channel preserved), `scenery-shadow-budget` (**0 changed
bytes** in shadow equivalence), `12-presentation-continuity` and `27-visual-coherence` (held and rewound identical),
`35-aurel-race-quality` (dusk balanced luma > prior), `03-skid-contact` / `motion` / `weather` / `aurel-quarry` (pixels
must change: > 5, > 100, > 100, > 500). These compare two renders of the same build, so global look changes pass
**unless they add nondeterminism** (time, random, accumulation without reset).

### 7.4 Budget-sensitive specs

`scenery-shadow-budget`, `56-track-infrastructure`, `57-trackside-operations`, `aurel-quarry`, `aurel-vegetation`,
`event-hall` and `secondary-grandstands` call `requireInfrastructureRenderBudget` / `requireOperationsInspectionBudget`:
a Medium 1280×720 cockpit complete frame may exceed the baseline by at most +2 % in calls **and** triangles
(day 2345 calls / 10.74 M tris, sunset 3173 / 12.55 M, night 3457 / 13.15 M). The `composer` phase must stay
< 1800 calls. Direct-scene inspections must stay < 1800. `41` and `42` require index and LOD work to be monotone.
`04-reference-visual` needs > 10 draws and > 10 000 tris per view. **This is the gate most likely to block a visual
upgrade.** Either keep extra passes out of the counted phases' growth (half-res full-screen quads cost 1 call),
or re-pin the baseline JSON in a dedicated commit. Re-pinning breaks `tests/infrastructure-render-budget.test.ts`
only if the structure changes. Record the justification.

### 7.5 UI contract used by e2e **and** by the capture tool

Keep these labels, ids and names stable (count = specs using them): button text `ENTER CIRCUIT` (29), `GARAGE &
SETTINGS` (23), `APPLY & SAVE` (23), `GO STRAIGHT TO LIGHTS`; selectors `[name=quality]` (19), `#opponents` (35),
`#weather` (8), `#mode`, `#loading` (4), `#raceBriefing`, `[data-action=modalClose]` (9); and
`window.apexDiagnostics(visual?)` (41 specs). Its `.state`, `.renderer.camera`, `.renderer.drawCalls`,
`.renderer.drawBreakdown` and `.visual.census` are read by tests. Pressing `c` cycles cameras. A UI redesign may
restyle these elements but must not rename them.

---

## 8. Git worktree workflow (verified end to end)

Probe results: `git worktree add <S>/wt-probe HEAD --detach` took 0.7 s (147 MB). Symlinked `node_modules`;
`npx tsc --noEmit` took 15.6 s (0 errors); `npm run build` took 28.5 s (OK; LOD derivative regenerated and matched the manifest,
4.2 MB). `vite preview --port 4311` served the build; the capture worked (0 errors); all six area sets (19-37 files each,
1612 tests) passed; `git worktree remove --force` took 0.4 s. It removed the symlink only, and the main `node_modules` was intact.

What a worktree needs beyond `git worktree add`:
1. `ln -s /home/user/Experiment-3/node_modules $WT/node_modules`. This creates an untracked file, so never stage it.
2. `npm run generate:player-lods` (or any `npm run build/test/dev`) to create the gitignored
   `public/models/supplied-player-lods.bin.gz` (4.2 MB, about 4 s).
3. Nothing else. All 26 large `public/models` files are tracked as plain binaries (no LFS), so they are present.
4. Disk: about 150 MB per worktree, plus about 110 MB per `dist/`. Twenty worktrees fit in the 29 GB free, but delete `dist/` and worktrees when done.

Creating a worktree on a branch: `git -C /home/user/Experiment-3 worktree add -b studio/<dept> $WT <base>`. You
cannot use `claude/funny-mayer-78089j` there (it is checked out in the main checkout), and you cannot push into that
branch through the local repo (`receive.denyCurrentBranch`). Integrate through the remote as in §10.

---

## 9. Visual capture loop

Tool: `$S/tools/capture.mjs`. It uses Playwright's library API with `/opt/pw-browsers/chromium` and SwiftShader.
It opens `--url`, sets quality through **GARAGE & SETTINGS → [name=quality] → APPLY & SAVE**, shoots the menu,
selects practice (`#mode`), `#weather` and `#opponents`, clicks **ENTER CIRCUIT**, skips the briefing, waits for
`apexDiagnostics().state === 'driving'`, then shoots 4 views (pressing `c` between them, 3 s apex), holds ArrowUp
for `--drive` seconds (default 10) and shoots twice more. It writes `diag.json` (renderer scalars: drawCalls,
triangles, frameMs, gpuMilliseconds, exposure fields, …) and `errors.txt` (page errors and console errors).

```bash
cd $WT && npm run build                                         # 29 s
(npx vite preview --host 127.0.0.1 --port $PORT --strictPort > $S/preview-$DEPT.log 2>&1 &)
curl -s --retry 30 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:$PORT/   # wait until ready
flock $S/capture.lock timeout 1200 node $S/tools/capture.mjs $S/shots/$DEPT-<tag> --url http://127.0.0.1:$PORT --quality medium
python3 -I $S/tools/shotdiff.py $S/shots/baseline $S/shots/$DEPT-<tag> --montage $S/shots/$DEPT-<tag>-vs-base.jpg
fuser -k $PORT/tcp                                              # stop YOUR preview only (never pkill -f, see hazard 20)
```
Options: `--quality high|medium|low`, `--weather clear|rain|changeable`, `--opponents N`, `--size WxH`, `--drive S`.
Measured: **409 s** for Medium, 1280×720, 7 opponents (load 37 s, settings 53 s, menu 75 s, driving 165 s, then
about 40 s per shot). The cockpit frame took **10.2 s** (gpu 16.1 s), with 1162 calls and 4.43 M triangles. High takes longer.
Put `timeout 1200` *after* `flock` so time spent queueing for the lock is not counted.

Gotchas:
- **File-name camera labels lag one view**: SwiftShader frames take longer than the 3 s wait. Identify shots by
  **index**: `10` chase (grid), `11` cockpit, `12` pod/T-cam, `13` trackside, `20` chase driving, `21` cockpit
  driving. The bottom HUD camera button shows the true view. Baseline files are named
  `10-chase 11-chase 12-pod 13-pod`. My run produced `10-chase 11-chase 12-cockpit 13-pod` for the same views.
  `shotdiff.py` matches by index.
- **Noise floor between two captures of the identical build** (baseline vs worktree probe): static views 00, 11, 12 and 13
  differ by mean |Δ| 1.0-2.9 (1.3-3.2 % pixels > 24). Views with moving traffic (10, 20, 21) differ by 9.5-18.8
  (14-23 %). Mean luma agrees within ±0.02. Treat luma or saturation shifts > 0.03 on 11, 12 and 13 as real.
- `diag.json` keeps only scalar renderer fields. For pass costs, evaluate
  `apexDiagnostics().renderer.drawBreakdown` and `apexDiagnostics(true).visual.census` in a custom script.
- `errors.txt` must be empty. Shader compile errors appear there as `console:` lines.
- Captures must not run concurrently (4 CPUs). `flock` serialises them across agents. Expect to queue.
- Compare against the reference photos by viewing the montage next to images in
  `$S/refs/f1ref/<category>/`. Never copy reference images into the repo.

---

## 10. Hazards list (consolidated)

1. **Stale server on 4173**: the default Playwright config reuses it and tests the main checkout's `dist`. Use the port wrapper.
2. **Missing headless shell**: Playwright needs `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
3. **CPU / RAM contention**: SwiftShader captures and e2e are CPU-bound, and the `assets` / `world` vitest sets parse
   tens of MB of GLB, including gunzipping the 63 MB supplied player. Do not run more than about 2 heavy jobs at once. Serialise captures with `flock`.
4. **Untracked junk**: the `node_modules` symlink and `browser-progress.json` are both untracked and not ignored. Stage explicit paths and check `git status --short` before you commit.
5. **Hash-pinned files** (§6): no Blender, so no regeneration.
6. **`npm run format`** rewrites 131 files.
7. **Settings schema**: a new `GraphicsOptions` key needs `options.ts`, both `settings-transition` literals, and the version-6 storage path (`storage/data.ts`) to stay compatible.
8. **Draw budget**: sunset cockpit headroom is about 4 calls (TECH_RENDER_MAP §10). A new `DRAW_PHASES` entry means editing the baseline JSON structure.
9. **`draw()` unit fixture** (`race-view-continuity`) and **`prepare()` order** (`startup`).
10. **Exact GLSL substrings** are asserted (§3.1). Rewording a chunk patch breaks tests even when the visual is the same.
11. **Importing `hero-shells.ts` must stay side-effect free** (`hero-import` bundles it in a VM).
12. **Sky / exposure constants** are pinned (`skyLinearGain 0.523`, METER_KEY fixtures, the dusk formulas). Lighting
    retunes must update those tests deliberately in the same commit, with the reason in the message.
13. **UI labels and ids** used by 20-40 e2e specs and by `capture.mjs` (§7.5).
14. **Concurrent pushes to one branch**: expect non-fast-forward rejections. Always fetch, rebase, re-run the fast checks, then push. Never force-push.
15. **`docs/studio/` untracked collision** in the main checkout (rule 9).
16. **Main checkout drift**: `/home/user/Experiment-3` does not auto-update when others push. The orchestrator runs
    `git -C /home/user/Experiment-3 pull --ff-only origin claude/funny-mayer-78089j` (and rebuilds `dist` there
    only if someone needs port 4173).
17. **Determinism**: no `Date.now()`, `performance.now()` or `Math.random()` in anything that affects pixels. Held and rewound frames must be identical.
18. **e2e fixtures and source APIs**: renaming or exporting differently breaks `e2e/fixtures/*.ts` at `tsc` time. Fix the fixtures in the same commit.
19. **`check:stable`**: any build or test step that writes into tracked trees fails CI. Keep generated files in `dist/` or the scratchpad.
20. **`pkill -f <pattern>` kills your own shell**: the Bash tool's command line contains the pattern (observed exit 144).
    Stop servers with `fuser -k <port>/tcp`, which is verified to kill both npx and vite and nothing else.
21. **Never kill or reuse the 4173 server** (pid 747). Other tooling may rely on it. Pick ports 4300-4899.

---

## 11. Agent validation recipe (copy-paste)

```bash
### 0. Per-agent setup (once) ###########################################################
DEPT=lighting                                   # your department slug, unique
AREA=render                                     # fastcheck area: render|world|car|character|ui|assets
PORT=$((4300 + RANDOM % 600)); PORT2=$((PORT + 1))   # private ports: preview / e2e
REPO=/home/user/Experiment-3
S=/tmp/claude-0/-home-user-Experiment-3/378de659-9944-56cf-89fb-195c2dec2c03/scratchpad
INTEG=claude/funny-mayer-78089j
WT=$S/wt-$DEPT
git -C $REPO fetch origin
BASE=$(git -C $REPO rev-parse --verify -q origin/$INTEG || git -C $REPO rev-parse $INTEG)
git -C $REPO worktree add -b studio/$DEPT $WT $BASE
ln -s $REPO/node_modules $WT/node_modules
cd $WT && npm run generate:player-lods          # ~4 s, creates the gitignored LOD derivative
# Studio docs live only in the main checkout: $REPO/docs/studio/*.md

### 1. Inner loop (every edit) ##########################################################
cd $WT
npx tsc --noEmit                                 # ~16 s, must be 0 errors
bash $S/tools/fastcheck.sh $AREA                 # 19-105 s; add a second area if your diff spans two
npx vitest run tests/<module-specific>.test.ts   # tests importing the module you changed:
#   grep -l "rendering/<module>" tests/*.test.ts

### 2. Visual proof (each meaningful step) ##############################################
npm run build                                    # ~29 s
(npx vite preview --host 127.0.0.1 --port $PORT --strictPort > $S/preview-$DEPT.log 2>&1 &)
curl -s --retry 30 --retry-connrefused --retry-delay 1 -o /dev/null -w 'preview %{http_code}\n' http://127.0.0.1:$PORT/
flock $S/capture.lock timeout 1200 node $S/tools/capture.mjs $S/shots/$DEPT-v1 \
  --url http://127.0.0.1:$PORT --quality medium   # ~7 min; also try --quality high
cat $S/shots/$DEPT-v1/errors.txt                 # must be empty
python3 -I $S/tools/shotdiff.py $S/shots/baseline $S/shots/$DEPT-v1 --montage $S/shots/$DEPT-v1-vs-base.jpg
# Then Read the montage and the matching refs in $S/refs/f1ref/... and judge by eye.
fuser -k $PORT/tcp                               # kills npx + vite of YOUR port only

### 3. Optional targeted e2e (UI: DOM-only specs; render: budget gate, one lighting) #####
CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$WT APEX_PORT=$PORT2 \
  npx playwright test -c $S/tools/pw-port.config.ts e2e/49-hud-footprint.spec.ts
# Render budget: ... e2e/scenery-shadow-budget.spec.ts -g "day"   (slow; run under flock $S/capture.lock)
rm -f $WT/browser-progress.json

### 4. Commit (explicit paths only) #####################################################
npm run lint                                     # ~12 s
git status --short                               # node_modules and browser-progress.json must NOT be staged
git add src/rendering/<files> tests/<files>      # never -A / .
git commit -m "feat(<dept>): <what changed and why>"   # plus the attribution trailer your session requires

### 5. Integrate and push (fast-forward only; retry on races) ###########################
for i in 1 2 3 4 5; do
  git fetch origin
  if git rev-parse --verify -q origin/$INTEG >/dev/null; then git rebase origin/$INTEG || { git rebase --abort; echo "CONFLICT: resolve manually"; break; }; fi
  npx tsc --noEmit && bash $S/tools/fastcheck.sh $AREA && git push origin HEAD:$INTEG && break
  sleep $((5 + RANDOM % 20))
done

### 6. Cleanup when your department is done #############################################
fuser -k $PORT/tcp; rm -rf $WT/dist; cd $REPO        # leave the worktree dir before removing it
git -C $REPO worktree remove --force $WT && git -C $REPO branch -D studio/$DEPT
```

Notes on the recipe:
- The recipe was dry-run here for steps 0, 1 and 6: worktree on `studio/qaprobe`, LOD generation, `fastcheck render` 19 s
  (32 files pass), `git status` showing only `?? node_modules`, then remove and delete the branch. `git fetch` does not prune, so the
  stale `origin/claude/funny-mayer-78089j` (= `3a6036d`) is used as the base until somebody pushes.
- Step 5's rebase picks up other departments' commits. If a fast check fails after the rebase, the break may come
  from the *other* change. Do not "fix" their pinned numbers blindly. Report it to the orchestrator.
- A commit that deliberately changes a pinned value (a sky constant, preset, exposure key or budget baseline) must
  change the test in the **same commit** and say so in the message. Never weaken an assertion to `toBeTruthy` or delete it.
- Before declaring a department done, run one capture at **High** (`--quality high`) as well as Medium. Captures run at
  1280×720. The CI e2e viewport is 1440×900.

---

## 12. Helper files created for the studio (scratchpad, not in the repo)

| Path | Purpose |
|---|---|
| `$S/tools/fastcheck.sh` | per-area vitest subsets (§3) |
| `$S/tools/pw-port.config.ts` | Playwright on a private port from a worktree (§7.1) |
| `$S/tools/shotdiff.py` | index-matched capture comparison plus side-by-side montage (§9) |
| `$S/tools/capture.mjs`, `stats.py`, `px.py`, `crop.py` | pre-existing capture and image-statistics tools |
| `$S/shots/baseline/` | HEAD captures (Medium); `$S/shots/wt-probe/` is a second capture of the same build (noise floor) |
| `$S/test-imports.txt` | test file → imported `src/` modules map (all 218 test files) |
| `$S/vitest-baseline.log` | full-suite run at HEAD (per-file timings) |
