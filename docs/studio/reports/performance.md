# Performance and build report (Performance & Build Engineer)

Branch `studio/perf-bundle-split`, cut from `main` at `ebf691d`. Gate G7 (cold load budget).
Environment: 4 CPUs shared with other studio agents (load average 10-20 during every browser run),
Chromium with SwiftShader (software GL). Absolute times below are therefore slow and noisy; byte
counts, CPU-time figures and long-task windows are the trustworthy numbers. Nothing here was
measured on a real GPU (gate G8 stays open).

## Result

|                                                                                       | before                              | after                                                                                                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Entry chunk, Vite report                                                              | 14,642.71 kB raw / 4,474.39 kB gzip | 3,228.53 kB raw / 1,055.38 kB gzip                                                                                          |
| Initial JS: entry + `three` + everything index.html preloads (`npm run check:bundle`) | 14.55 MiB raw / **4.40 MiB gzip**   | 11.02 MiB raw / **3.52 MiB gzip** (budget 4.00: passes)                                                                     |
| Entry + `three` only (what loads before the showroom data)                            | same as above                       | 3.67 MiB raw / 1.16 MiB gzip                                                                                                |
| Loaded only when a circuit session starts                                             | 0 (all in the entry)                | 1.22 MiB gzip: start/finish and grandstand tables, motocross kit, physics worker, plus `free-roam` (festival, already lazy) |
| Entry module evaluated (`apexDiagnostics` defined)                                    | 2,951 ms                            | 2,449 / 1,763 / 2,089 ms (three runs)                                                                                       |
| Main-thread long tasks before the GL phase (sum of the first two)                     | 5,220 and 6,943 ms (two runs)       | 4,738 / 3,773 / 2,890 ms (three runs, last is the final build)                                                              |
| JS heap after menu and forced GC                                                      | 39.8 MB                             | 33.4-33.6 MB                                                                                                                |
| Sourcemaps in `dist/`                                                                 | 17.8 MiB                            | 0 (opt in with `APEX_SOURCEMAP=1`)                                                                                          |
| `dist/` total                                                                         | 184.0 MB                            | 166.3 MB                                                                                                                    |
| Menu-time rival bodywork GLBs (a61 near/mid/far)                                      | 1.78 MB fetched and decoded         | not fetched (opponents only)                                                                                                |

Gate G7 "initial JS <= 4 MB gzip": met, 3.52 MiB. The stretch target (<= 2.5 MiB) is **not** met.
The reason is structural and listed as task 1 below: the menu showroom still builds the pit/grid
crew and the venue landmark, so 2.37 MiB gzip of crew and venue tables must be resident before
the menu.
Only the 1.16 MiB entry is "small"; I am not reporting that as the initial figure because the
showroom data is genuinely needed before the menu (index.html now modulepreloads it).

Time to menu-interactive did not change measurably: 47.8 s, 69.2 s and 80.1 s for the old build
and 63.9 s, 66.2 s and 59.3 s for the new one, at different machine loads. Under SwiftShader a single
54-68 s main-thread task (`TextureBudget.apply` canvas resampling plus shader link waits, see Hot spots)
dominates, which bundle size cannot move. The measurable client-side gains are bytes, memory and
the JS that runs before the GL phase.

## Measurements

### Where the 14.6 MB went (baseline entry, 14,299 KiB rendered)

Attribution uses Rollup's per-module rendered length (the sourcemap method mis-attributes JSON
modules, which have no map, to the neighbouring source file). Generated JSON tables were 74.8 %:

| module                                                    |    KiB | gzip KiB (JSON file) | first needed                      |
| --------------------------------------------------------- | -----: | -------------------: | --------------------------------- |
| `crew-performance.geometry.json`                          |  2,499 |                  655 | showroom (PitCrewView)            |
| `start-finish.geometry.json`                              |  2,279 |                  507 | circuit session                   |
| `human-kit.json`                                          |  1,849 |                1,085 | showroom (crew, marshals, crowd)  |
| `a33-spare-wheel-set.geometry.json`                       |  1,471 |                  300 | showroom (PitCrewView)            |
| `aurel-people.geometry.json`                              |  1,176 |                  244 | showroom (PitCrewView)            |
| `mx-authored-kit.mesh.json`                               |    667 |                  224 | motocross session                 |
| `gp-bodywork.mesh.json`                                   |    281 |                   80 | showroom (bike shells)            |
| `event-hall.geometry.json`                                |    260 |                   82 | showroom (VenueLighting landmark) |
| `secondary-grandstands.geometry.json`                     |    211 |                   22 | circuit session                   |
| physics worker (`?worker&inline`, base64)                 |    469 |                  148 | session start                     |
| UI (`src/ui`), incl. `reference-catalogue.ts` 133         |    564 |                      | menu                              |
| `three/examples` loaders in the entry                     |    269 |                      | showroom                          |
| everything else (renderer, simulation, career, audio ...) | ~2,000 |                      | menu                              |

Evidence/review/reference code (`reference-*`, `review-*`, `tab-evidence`, `presentation-review`,
`session-review`, telemetry plots, replay pages) is about 250 KiB rendered in total, roughly 8 % of
the new entry. Not lazy-loaded (task 3).

### What parsing actually costs

CPU time to compile and evaluate (Node `vm.SourceTextModule`, best of 5-7, load-insensitive):

|                                                                       |                               CPU ms |
| --------------------------------------------------------------------- | -----------------------------------: |
| old entry, 13.96 MB, parse + compile only                             |                                   85 |
| new entry, 3.08 MB, parse + compile only                              |                                   64 |
| all nine JSON-table chunks, parse + compile + `JSON.parse` evaluation | 64 (showroom set 44, circuit set 20) |

So raw parse/compile was never the problem (V8 pre-parses megabyte-long string literals cheaply).
The wins are bytes read from disk, resident heap (tables stay alive as JS arrays), and the work
the old entry did before the loading screen could appear. Background-thread parse times seen in
the trace (`v8.parseOnBackground` 0.9 s old entry versus 2.1 s for the new entry plus preloaded
chunks) are wall time on an oversubscribed machine and should not be read as a regression.

### Menu boot (headless Chromium, SwiftShader, 1280x720)

Method: `PerformanceObserver('longtask')`, a 2 ms poll for `window.apexDiagnostics`, CDP
`Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`, CDP tracing for V8 compile events.

| run                              | load avg |        entry evaluated | long tasks before GL (start + duration, ms) |   menu |    heap |
| -------------------------------- | -------: | ---------------------: | ------------------------------------------- | -----: | ------: |
| old, run A                       |      ~10 | n/a (mark added later) | 1,056 + 2,613; 4,393 + 2,607                | 80.1 s | 39.7 MB |
| old, run B                       |      ~15 |               2,951 ms | 1,158 + 1,786; 3,028 + 5,157                | 69.2 s | 39.8 MB |
| new, run 1 (tracing)             |      ~15 |               2,449 ms | 462 + 1,972; 3,168 + 2,766                  | 63.9 s | 33.4 MB |
| new, run 2                       |      ~20 |               1,763 ms | 271 + 1,481; 2,503 + 2,292                  | 66.2 s | 33.4 MB |
| new, final build (modulepreload) |      ~12 |               2,089 ms | 718 + 1,280; 2,627 + 1,610                  | 59.3 s | 33.6 MB |

With the preload hints the showroom data chunks are requested at 25 ms next to the entry (they
were requested at 2.7 s, after the entry had run, in runs 1 and 2).

After the early JS window the old and new builds both show one 54-68 s main-thread task
(`TextureBudget.apply` and shader link waits under SwiftShader) and a 6-9 s task when the menu is
revealed. Requests at the menu are identical apart from the rival GLBs; the largest is the hero
`supplied-player.glb.gz` (36.1 MB) plus `supplied-player-lods.bin.gz` (4.2 MB), then KTX2 ground
textures (about 1.2 MB each). All other `public/models/*.glb` (aurel pit, garage, barriers ...) are
requested only by the circuit build, as intended.

### Session start (Free practice, Aurel, solo)

Click to `driving`, software GL on the loaded box: old 532 s, new 443 s at 1280x720 and 250 s at
LOW quality 640x360. Load differed between runs, so this is **not** claimed as an improvement. The
new build started the session with no page or console errors and created the physics worker from
its lazily fetched chunk. Rendered frames: `presentation.frames` 2 at `driving` and 5 within
30 s at LOW; SwiftShader cannot produce more on this machine.

### Frame-time hot spots (30 s CDP CPU profile while driving)

No JS hot spot is visible. At 1280x720 the main thread was 97.3 % idle (607 ms `(program)`);
at LOW 480x270 it was 84.4 % idle, 11.8 % `(program)`, with the largest JS-attributed entries
`bufferData` 461 ms, `postMessage` 189 ms and `getBoundingClientRect` 74 ms over 5 rendered
frames. The frame is bound by the software rasteriser, not by JS. A useful frame-time profile
needs a hardware GPU (gate G8). Nothing was changed for frame time.

Boot hot spots from a CPU profile taken from navigation to menu (identical in old and new build):

1. `TextureBudget.apply` (`src/rendering/texture-budget.ts`): 36.5 s (old) / 43.0 s (new) of
   self time, 66 % of boot, in `drawImage` resampling of generated canvases onto accelerated 2D
   canvases. Likely a SwiftShader artefact (accelerated 2D canvas readbacks), but unverified on
   a GPU. Candidate fix, not applied because it needs a hardware A/B: resample on a CPU-backed
   canvas (`willReadFrequently`) or on a worker-side `OffscreenCanvas`.
2. `cloudDetailVolume` (`src/rendering/studio/sky-clouds.ts`): 1.5-1.9 s self time on the loaded
   box. A 64^3 x 3-octave Worley loop with a `%` wrap and three float reads in the innermost
   27-neighbour loop. Output must stay bit-identical; hoisting the wrap and cell lookups out of
   the inner loop is safe and local but sits in a file the weather/time agent owns, so I did not
   touch it.
3. three's program link-status check (`getProgramParameter`, `three:3780`): 5.4-6.3 s of synchronous
   shader compile/link wait; `KHR_parallel_shader_compile` is unavailable under SwiftShader.

## What changed

| file                                                                                      | change                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/lazy-data.ts` (new)                                                             | Runtime for lazy datasets: `lazyDataset()` facade, `loadLazyData(...groups)`, `LazyDataNotLoadedError`. Small top-level keys stay inline; large keys are getters that throw until loaded.                                                                      |
| `scripts/vite-lazy-data.ts` (new)                                                         | Build-only Vite plugin (`apply: 'build'`). Rewrites the listed JSON imports to the facade, emits each large payload as its own chunk, and adds `modulepreload` links for the `showroom` group.                                                                 |
| `vite.config.ts`                                                                          | Registers the plugin with eight JSON tables in two groups (`showroom`, `circuit`); `build.sourcemap` is now `process.env.APEX_SOURCEMAP === '1'`. The fingerprint file list is unchanged on purpose (other review scripts recompute it).                       |
| `src/rendering/renderer.ts`                                                               | `RacingRenderer.create` awaits `loadLazyData('showroom')` (menu) or `loadLazyData()` (circuit) first, under the existing loading screen ("Loading authored venue and crew data"). The showroom no longer loads the three opponent-only rival bodywork exports. |
| `src/session/free-roam.ts`                                                                | `FestivalSession.start` awaits `loadLazyData()` first.                                                                                                                                                                                                         |
| `src/main.ts`                                                                             | The inlined physics worker is imported dynamically at `start()` (prefetched while audio and the circuit prepare, awaited before `new PhysicsWorker`). Worker code and contracts under `src/workers` untouched.                                                 |
| `scripts/bundle-budget.mjs`, `package.json`                                               | `npm run check:bundle`: fails when initial JS gzip exceeds `--max-gzip-mb` (default 4).                                                                                                                                                                        |
| `scripts/perf-startup.mjs` (new)                                                          | The menu/session/profile harness used for these numbers (long tasks, V8 compile, heap, big responses, optional race and CPU profile).                                                                                                                          |
| `tests/lazy-data.test.ts`, `tests/bundle-budget.test.ts`, `e2e/lazy-chunks.spec.ts` (new) | Runtime, plugin (including an executed IIFE build), budget script and the production-bundle chunk-timing contract.                                                                                                                                             |

Design notes:

- Consumers and tests are untouched. vitest, the dev server and every e2e fixture built with
  `configFile: false` keep plain JSON imports, so the same `loadLazyData()` calls are no-ops there.
  The lazy path exists only in the shipped bundle; its coverage is the browser runs below.
- A premature read fails loudly (`LazyDataNotLoadedError` names the dataset and key) instead of
  returning partial data.
- The groups were found empirically with a temporary read log: the showroom constructor
  (`PitCrewView`, `VenueLighting`, bike shells) reads `a33`, `human-kit`, `crew-performance`,
  `aurel-people`, `event-hall` and `gp-bodywork`; `start-finish` and `secondary-grandstands` were
  first read during circuit construction at 211 s (the motocross kit is not read for Aurel).

## Verification (what I ran)

Static and unit checks (all in the worktree):

| command                                                                                                                                                                                                                                        | result                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run build` (`generate:player-lods`, `tsc --noEmit`, `vite build`), run after the final source change                                                                                                                                      | exit 0, 801 modules                                                                               |
| `npx eslint` and `npx prettier --check` on every changed and new file                                                                                                                                                                          | clean                                                                                             |
| `npx vitest run tests/lazy-data.test.ts tests/bundle-budget.test.ts`                                                                                                                                                                           | 8 tests pass (includes an executed IIFE build of the plugin and the budget script's exit codes)   |
| `npx vitest run tests/startup.test.ts tests/race-view-continuity.test.ts tests/studio-look-contracts.test.ts tests/renderer-resource-lifecycle.test.ts tests/studio-frame.test.ts tests/meeting-flow.test.ts tests/open-world-session.test.ts` | 81 tests pass (the files that import `renderer.ts`, read `main.ts`, or run the free-roam session) |
| `npx vitest run tests/acceptance-matrix.test.ts tests/branchless-release.test.ts tests/browser-backend.test.ts`                                                                                                                                | 13 tests pass (build-identity / release contracts)                                                |
| `node scripts/bundle-budget.mjs`                                                                                                                                                                                                               | exit 0: 3.52 MiB gzip initial; `--max-gzip-mb 1` exits 1                                          |

Browser checks (production build behind `vite preview` on port 4204, headless Chromium with
SwiftShader, one browser at a time). The repo's Playwright config reuses a server on 4173, which on
this machine belongs to another checkout, so I ran the spec through a scratch config that only sets
`baseURL` to my preview.

| check                                                                               | build                    | result                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/lazy-chunks.spec.ts` (menu, then Free practice, Aurel, solo)                   | final                    | **pass, 8.4 min.** At the menu: no `start-finish`, `secondary-grandstands`, `mx-authored-kit`, `physics.worker` or `free-roam` request; `crew-performance`, `human-kit`, `event-hall` requested. After starting: `start-finish`, `secondary-grandstands`, `physics.worker` requested, state `driving`, `presentation.frames` > 1, 0 page or console errors                |
| Free practice to `driving` with a temporary read log                                | instrumented             | reached `driving`; 5 datasets read before the menu, `start-finish` and `secondary-grandstands` read during circuit build; no errors                                                                                                                                                                                                                                       |
| Free practice to `driving`, 1280x720 and LOW 640x360 (`perf-startup` style harness) | before the preload hints | reached `driving`, 0 page errors, 0 console errors, 0 failed requests                                                                                                                                                                                                                                                                                                     |
| GP bike (`gpr1`, Aurel, Free practice)                                              | final                    | circuit build completed to "Almost ready 90 %" (stopped there, before shader warmup), 0 errors                                                                                                                                                                                                                                                                            |
| Motocross (`mx450`, `valley-ridge-mx`, Free practice)                               | final                    | same: circuit build completed to "Almost ready 90 %", 0 errors                                                                                                                                                                                                                                                                                                            |
| Festival (Solvane)                                                                  | final and baseline       | Both builds show the same loading-text sequence and stall at "Loading photographed ground..." for the 420 s window on this machine, with no console error in either. The festival chunk, its module evaluation and the new `loadLazyData()` barrier ran; the world build was **not** observed to finish, so festival reads of lazy tables after that point are unverified |

## Not verified / known risks

- The lazy path is production-only, so vitest and the dev server cannot catch a read-before-load.
  Everything that constructs circuit or crew objects runs after `RacingRenderer.create()` or
  `FestivalSession.start()` has awaited `loadLazyData()`, and the browser runs above passed
  through that for Formula, GP bike and motocross. Replay, photo studio, results, career and
  supercross flows reuse that renderer afterwards; I did not drive them.
- The festival world build did not complete in this environment (same as baseline).
- The full e2e suite was not run (software GL, 7-10 minute session starts on this box). By reading,
  `25-people`, `a31-wheel-gun`, `a32-pit-jacks` and `a33-spare-wheel-set` assert circuit objects
  at menu time (crowd clusters, wheel guns) that the showroom-only renderer does not build
  (`45-motocross-gameplay` itself asserts `presentationPurpose === 'showroom'` and
  `construction.tasks === 0` at the menu), so they look stale independent of this change. Not run.
- No hardware GPU, Steam Deck, or desktop-wrapper run; the wrapper must serve `assets/*.js` as
  modules for the dynamic imports, as it already must for `free-roam`.
- `index.html` grows from 0.96 kB to 1.56 kB (six `modulepreload` links).
- Timing comparisons are between runs under different machine load; treat percentages as
  indicative. Byte and CPU-time figures are exact.

## Recommended next tasks (ranked)

1. **Make the menu showroom crew-free (reaches the 2.5 MiB stretch, about 1.35 MiB initial).**
   The showroom builds `PitCrewView`, `GridPreparationView`, `GridPresentationView` and (inside
   `CircuitScene`) `MarshalStaffView`; the renderer updates them with `visible = false` while the
   menu is up, so they draw nothing there. Construct them only for `!showroomOnly`, move
   `crew-performance`, `human-kit`, `a33-spare-wheel-set` and `aurel-people` (2.2 MiB gzip) to the
   `circuit` group and keep `event-hall` and `gp-bodywork` in `showroom` (the landmark's visibility
   at the menu needs checking before it moves too). The construction costs 0.7-1.3 s of JS on this
   loaded box (a Node micro-benchmark of the three constructors, scratch script).
   `apexDiagnostics()` returns `pitPersonnel` and `gridPreparation` unconditionally, so the
   diagnostics type needs a dormant shape. Also un-stales the four e2e specs above.
2. **Hero asset.** `supplied-player.glb.gz` 34.5 MB and its 4.0 MB LOD index are fetched, hashed and
   decoded for every menu. Re-encode (meshopt/KTX2) or stream the LODs.
3. **Lazy-load evidence/review/reference code** (~250 KiB rendered): `reference-catalogue.ts`
   (133 KiB), `tab-evidence`, `presentation-review`, `session-review`, `reference-*`. They are
   constructed in `GameApp` field initialisers and read by `diagnostics()`, so this needs a
   `GameApp` refactor; kept out of this change to avoid conflicts in `main.ts`.
4. **Boot hot spots** above (`TextureBudget.apply` on a GPU, `cloudDetailVolume`).
5. **CI:** run `npm run check:bundle` after `npm run build`; keep `APEX_SOURCEMAP=1` for
   symbolication builds only.
6. `dist/` is 166 MB, 144 MB of it `public/` (models 90 MB, third-party textures 53 MB). All are
   referenced and fetched on demand; the desktop wrapper can still exclude quality tiers it does not
   ship.

## Reproduce

```
npm run build && node scripts/bundle-budget.mjs          # G7 numbers
APEX_SOURCEMAP=1 npx vite build                          # build with sourcemaps
npx vite preview --port 4204 &
node scripts/perf-startup.mjs --url http://127.0.0.1:4204 --label after [--race] [--profile]
```
