# Repository map

Start with [README](../README.md) for play instructions and [current status](CURRENT_STATUS.md) for verified progress. Older delivery reports describe their recorded commits, not the present build.

## Desktop product

`desktop/` owns the native application lifecycle and offline asset protocol. `electron-builder.yml` and `.github/workflows/desktop-build.yml` define Windows/macOS/Linux packaging and native launch checks. `scripts/*desktop*.mjs` prepare payloads, launch packaged applications and record checksums. `desktop-out/` is generated output, not source. See [desktop delivery](DESKTOP_DELIVERY.md).

## Engine migration

`src/engine/simulation-component.ts` hosts the existing physics for the new main-engine architecture. `src/engine/babylon/` contains Babylon rendering, snapshot transfer and existing-asset import. `babylon.html` is the explicitly labelled integration preview; the root `index.html` remains the complete Three.js fallback during migration. See [migration gates](BABYLON_MIGRATION.md).

## Runtime code

| Path                                                             | Responsibility                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main.ts`                                                    | Application lifecycle and session orchestration                                |
| `src/simulation/`                                                | Existing deterministic vehicle physics, race control, AI, tracks and snapshots |
| `src/simulation/motogp-physics.ts`, `bike.ts`, `bike-vehicle.ts` | GP motorcycle dynamics                                                         |
| `src/simulation/offroad/`                                        | Off-road courses and surfaces                                                  |
| `src/simulation/open-world/`, `src/session/free-roam.ts`         | Solvane festival world, traffic, activities and session                        |
| `src/workers/`                                                   | Worker execution of simulation and exports                                     |
| `src/rendering/`                                                 | Three.js scene, authored/procedural assets, camera and post-processing         |
| `src/rendering/studio/`                                          | Presentation and environment systems                                           |
| `src/ui/`, `src/input/`                                          | Menus, HUDs, accessibility, keyboard/gamepad/touch                             |
| `src/audio/`                                                     | State-driven audio                                                             |
| `src/core/`, `src/career/`, `src/storage/`, `src/session/`       | Shared logic, progression, persistence and mode lifecycle                      |
| `src/net/`                                                       | Experimental networking; not a hosted multiplayer service                      |

## Assets and provenance

- `public/models/`: shipped authored models. Dedicated `motocross/` and `solvane/` subdirectories serve those disciplines.
- `public/assets/third-party/`: bundled licensed textures, skies and vegetation, with credits.
- `assets/third-party/`: source register and processing recipes.
- `src/rendering/*.manifest.json`: asset dimensions, hashes and integration contracts.
- `authoring/`, `scripts/`, `tools/`: reproducible asset creation and developer tooling.
- `reference/`: visual research packs, not runtime game assets. Do not copy commercial game artwork into shipping content.
- [Asset provenance](ASSET_PROVENANCE.md): licence and attribution register.

## Verification and publishing

- `tests/`: unit, simulation and asset-contract checks.
- `e2e/`: browser journeys and visual/performance assertions; fixtures live in `e2e/fixtures/`.
- `scripts/`: scenario validation, authoring and release helpers.
- `.github/workflows/ci.yml`: required build, unit, scenario and browser gates.
- `.github/workflows/publish-playable-cdn.yml`: source-addressed downloadable release from passing CI.
- `.github/workflows/deploy-playable-pages.yml`: website deployment.
- `.github/workflows/main-only.yml`: remove only fully integrated branches, with concurrency-safe leases.
- `dist/`, `node_modules/`, `test-results/`, `playwright-report/`: generated local output, not source.

## Research and historical evidence

`docs/production/` holds production specifications and acceptance protocols. The many phase/delivery reports under `docs/`, along with `screenshots/`, `lookdev-tmp/` and `scratch-tmp/`, retain prior evidence. They are not alternate game entry points. They remain in place to preserve links and reproducibility; cleanup must not delete assets merely because a folder is called temporary.

`playable/` is legacy publishing material. The supported build is the root Vite application and its `dist/` output. Do not start a second implementation there.
