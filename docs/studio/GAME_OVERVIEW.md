# MOTOBOUND — what the game does, where it lives, how to run it

Status date: 2026-11-05, `main`. Everything here was checked against the code on `main`; where a statement
depends on something that could not be verified in the build sandbox (real GPU, Steam client, Windows/macOS),
it says so. The forward plan is in [ROADMAP.md](ROADMAP.md); release gates are in [RELEASE_GATES.md](RELEASE_GATES.md).

## 1. The game in one page

MOTOBOUND is an original, fictional motorsport game written in TypeScript on Three.js, with a deterministic
physics simulation running in a Web Worker. It runs in a browser and, through an Electron shell, as an offline
desktop game intended for Steam. It blends four disciplines in one front end:

| Discipline | What you do | Machines | Where in code |
| --- | --- | --- | --- |
| **Circuit** (plate 1) | Formula, GT, road, rally, kart and prototype racing on closed circuits: free practice, Grand Prix, ghost time trial, qualifying weekend, endurance | 48 four-wheel machines: APX-01, 7 other open-wheel cars, 37 closed bodies (GT, road, rally, trucks), 2 karts, 1 buggy | `src/simulation/` (race, AI, tyres, aero), `src/rendering/` |
| **GP bike** (plate 2) | Road-racing motorcycles with lean/brake physics and racecraft | 9 motorcycles in total: 6 road/GP (GP-R1/GP-R2, superbikes, supersport, classic) | `src/simulation/motogp-physics.ts`, `bike*.ts`, `src/rendering/gp-*`, `bike*` |
| **Dirt** (plate 3) | Motocross (OUTDOOR MX) and supercross (STADIUM SX) on authored courses, with jumps, rhythm sections, berms | 3 off-road bikes (the supermoto also runs on tarmac venues in Wildcard events) | `src/simulation/offroad/`, `src/ui/motocross-*` |
| **Festival** (plate 4) | Open-world Solvane Coast: free roam, 18 events (road race, circuit, sprint, speed traps, drift and skill zones), traffic, towns, map, photo mode | any road machine | `src/simulation/open-world/`, `src/session/free-roam.ts`, `src/ui/festival-*` |

The signature feature is the **Wildcard Series**: 29 events (17 cross-discipline) that put machines on venues they
were never built for — a motocross bike round a 31° banked oval, a hypercar through a harbour tunnel, GP bikes on a
salt-flat runway, trophy trucks on a night street, a formula car down an icy mountain pass. Data:
`src/career/wildcard-series.ts` (+ `src/simulation/circuit-catalogue/wildcard-venues.ts`).

## 2. Content inventory (counted from the code on `main`)

- **51 venues**: 47 circuit layouts (e.g. Aurel Grand Circuit, Vellamar Coast, Hochwald Forest Ring 20.8 km, Col d'Argent
  Mountain Pass, Mesa Speedbowl, Neon City, Iron Quay Docklands, plus the Wildcard-only Level Nine multi-storey car park,
  Haut-Givre ski road, Marram Field airbase, Kalder Dam, Saffron Lane) + 4 dirt venues. Catalogue: `docs/CIRCUIT_CATALOGUE.md`.
- **57 machines** with data-driven character lines (`src/ui/machine-character.ts`) and original colourways
  (`src/rendering/vehicle-bodies/colourways.ts`). Calibration table: `docs/studio/reports/machine-benchmark.md`.
- **29 Wildcard events**, each validated by seeded headless AI races: `docs/wildcard-races.json` (29/29 headless passes recorded on physics v23; the v24 supercross change can move the dirt events, so re-run `scripts/wildcard-races.ts` before release).
- **7 weather states** — clear, changeable, rain, fog, storm (gusts + lightning), dust, snow/ice (frozen-film grip) — each
  with physics (grip, visibility), sky/aerial perspective, road shader, audio and AI/race-control response.
  `src/simulation/weather*.ts`, `src/rendering/weather-atmosphere.ts`, `src/audio/weather-ambience.ts`.
- **Light dial**: venue default / day / sunset / night / live sun (`src/rendering/daylight.ts`).
- **5 licences** (braking, cornering, wet, lean, jump), a career with garage/economy, Events, Championship weekend,
  Driving Academy (`src/career/`).
- **54 achievements** as data (`src/steam/achievements.ts`), records screen and local leaderboards.
- **8 UI languages**: English + de, fr, es, pt-BR, it, pl, tr (`src/i18n/`). The seven translations are model-written
  first drafts that need native review before release.
- **Demo edition** (3 venues, 4 machines, 5 Wildcard events, first licence) built from the same source (`npm run build:demo`).

## 3. How it plays (player flow)

1. **First launch** → a short, skippable first-launch screen (language, input device, discipline) → a guided first lap.
2. **Paddock Board** (main menu, `src/ui/launch-board.ts`): four number-plate discipline selectors, the WILDCARD SERIES door,
   and dials for Circuit/venue (with a track map drawn from the real centreline), Machine, Session, Distance, Weather,
   Light, Tyres, Assists, Grid, Start. `ENTER CIRCUIT` or `PREPARE GRID · START PAUSED`. The right rail opens Career,
   Garage & Settings, Events, Championship, Records, Team HQ, Driving Academy, Photo / Livery, Controls, Credits & Licences.
3. **Loading board** (per-discipline identity) → race briefing (quick start or grid presentation) → lights.
4. **Driving**: keyboard, gamepad (menu navigation works with a pad), touch. Cockpit/chase cameras, pit stops, DRS,
   flashback, replay, telemetry (`T`/`R`/`X`), AI demonstration (`G`). Defaults in `README.md` § Controls.
5. **Results board**: podium, gaps, medal/pay, next-up suggestion, local share-card PNG export.
6. **Settings**: graphics presets with a GPU suggestion and live frame rate, **HUD SCALE** (100–150 %, automatic 115 % on
   short screens), sound mix (master/engine/effects/ambience/menu sounds), language, text size, colour-blind tyre palette,
   reduced motion, bindings and calibration.

## 4. Technical map (where things are)

```text
src/main.ts                  application lifecycle, session orchestration
src/simulation/              deterministic physics + race rules (worker): vehicle, tyres, aero, damage, AI, race control,
                             weather, circuit catalogue (circuit-catalogue/), offroad/, open-world/
src/workers/                 simulation worker and snapshot transport (snapshot header contract: tests/snapshot-header-contract.test.ts)
src/rendering/               Three.js scene: cars (procedural + authored GLB), bikes, venues, sky, weather, post
src/ui/                      Paddock Board, HUDs, menus; design system tokens in front-end.css, type-floor.css
src/career/ src/storage/     progression, economy, saves (IndexedDB), recordings
src/audio/                   synthesised engine voices (loudness model), bus mixer, ambience, UI cues
src/i18n/                    t()/N_ translation core, lazy dictionaries per language
src/steam/ src/desktop/ src/release/   achievements, Steamworks bridge, desktop bridge, demo gates, wishlist/store link
src/core/lazy-data.ts        lazy geometry tables (initial JS 14.6 MB → 3.5 MB gzip)
desktop/                     Electron shell (own package.json), save mirror, Steam integration, packaging
scripts/                     validation, benchmarks, build flavours, IP guard, bundle budget, i18n check
scripts/studio/tools/        studio tooling (journeys, capture, benchmarks, sweeps — see its README)
tests/ e2e/                  6,086+ unit tests (616 files), 136 Playwright specs
docs/                        engineering and production docs; docs/studio/ is the studio record
.github/workflows/           CI (ubuntu-24.04) + validation/authoring workflows; desktop-packages.yml matrix
```

Physics identity: `SIMULATION_VERSION = 24` (`src/core/session-identity.ts`; history in its comment). Any change to seeded
behaviour must bump it and update the pinned test.

## 5. How to run, build, test, package

```sh
npm ci
npm run dev                 # Vite prints the local address
npm run build               # tsc + vite build; the IP guard runs inside the build
npm run check:bundle        # initial-JS budget (4 MB gzip) + IP guard on dist/
npm run check:i18n          # all 7 dictionaries vs the English catalogue
npm test                    # vitest (616 files / 6,086 tests)
npm run lint && npm run validate:content
npm run test:physics        # scenario scripts; test:vehicles, test:offroad, test:open-world, test:bikes
npm run build:demo          # Steam demo edition → dist-demo/ (+ IP guard)
npm run build:qa            # owner/review build for QA only — never publish (the IP guard refuses it)
npm run desktop:install && npm run desktop:pack      # Electron unpacked build (Linux); dist:win / dist:mac in CI
```

Browser specs: `npm run build && npx playwright install --with-deps chromium && npm run test:e2e`. DOM-fixture specs run
quickly without WebGL via `scripts/studio/tools/pw-dom.config.ts` (see the header of that file). Software-GL runs are slow;
see [ROADMAP.md](ROADMAP.md) § Known problems for what that means for the real-game specs.

Build flags: `MOTOBOUND_DEMO=1` (demo edition), `APEX_SOURCEMAP=1` (ship sourcemaps), `MOTOBOUND_SUPPLIED_PLAYER=1` and
`MOTOBOUND_REVIEW_TOOLS=1` (owner/QA builds only; a build containing them can never pass `check:ip`).

## 6. Quality gates that exist in the repository

- **IP guard** (`scripts/ip-guard.mjs`, deny-list `scripts/ip-denylist.mjs`): fails the build if a real brand/team/sponsor
  string, the removed owner-only car, or a commercial-game reference appears in `dist/`; runs in `vite build` and in CI.
- **Bundle budget** (`scripts/bundle-budget.mjs`), **i18n check**, **content validation** (`scripts/validate-content.ts`:
  protected names, medal ladders, venue geometry), **seeded race harnesses** (`scripts/wildcard-races.ts`,
  `catalogue-races.ts`, `bike-race.ts`, `offroad-races.ts`, `open-world.ts`).
- **Studio harnesses**: `scripts/studio/tools/` — `festival-qa.ts` (every festival activity headless), `machine-benchmark.ts`
  (57 machines), `bike-ai-sweep.ts`, `audio-render.mjs`, `journey.mjs` (real-game journeys), `hud-measure.mjs`,
  `store-shots.mjs`, `capsule-art.mjs`, `e2e-sweep.mjs`.
