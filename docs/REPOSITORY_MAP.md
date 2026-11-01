# Repository map

Start with [README](../README.md) for play instructions and [current status](CURRENT_STATUS.md) for verified progress. Older delivery reports describe their recorded commits, not the present build.

## Desktop product

`desktop/` owns the native application lifecycle and offline asset protocol. `electron-builder.yml` and `.github/workflows/desktop-build.yml` define Windows/macOS/Linux packaging and native launch checks. `scripts/*desktop*.mjs` prepare payloads, launch packaged applications and record checksums. `desktop-out/` is generated output, not source. See [desktop delivery](DESKTOP_DELIVERY.md).

## Engine migration

Migration work belongs exclusively to `babylon-js`; `main` is the restored pre-migration snapshot and must not be changed or merged into.

`src/engine/simulation-component.ts` hosts the existing physics for the new main-engine architecture. `src/engine/babylon/` contains Babylon rendering, snapshot transfer and existing-asset import. `babylon.html` is the explicitly labelled integration preview; the root `index.html` remains the complete Three.js fallback during migration. See [migration gates](BABYLON_MIGRATION.md).

`src/engine/assets/player-lod-data.ts` is the shared renderer-independent LOD codec. `src/engine/babylon/existing-player-primitives.ts` owns original GLB primitive/material/joint correspondence; it does not select LOD tiers. Asset-contract evidence is in [primitive bindings](maintenance/babylon-primitive-bindings-2026-10-31.md).

`src/engine/assets/circuit-ribbon-data.ts` holds renderer-neutral circuit ribbon construction arrays. The Three owner retains its original materials, shader hooks, typed-buffer/normal generation and scheduling. The independent [pre-edit oracle](maintenance/circuit-ribbon-data-2026-10-31.md) validates this boundary; it does not activate Babylon road/paint.

`src/engine/assets/circuit-line-profile.ts`, `tyre-mark-zones.ts` and `indexed-ribbon-normals.ts` retain shared surface semantics and exact indexed normals. `src/engine/babylon/formula-surfaces.ts` and `circuit-paint-finish.ts` supply the bounded live Formula surface path and isolated comparison probes. `surface-preparation.ts` owns compilation/presentation readiness. [Live scope](maintenance/babylon-live-formula-surfaces-2026-10-31.md).

`scripts/native-gpu-trace*.mjs` are harness-only diagnostics. The offline parser is acquired only for the explicit diagnostic job and is not bundled into the game; raw data remains private and only bounded numeric evidence is retained. [Trace protocol](maintenance/native-gpu-trace-2026-10-31.md).

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
- `.github/workflows/main-only.yml`: historical consolidation workflow. Do not run it for this branch split.
- `.github/workflows/babylon-integration.yml`: branch-only GPU qualification, including both uniform transports.
- `.github/workflows/babylon-desktop.yml`: branch-only Windows/Linux/Apple Silicon package and installed-game checks; artifacts only.
- `.github/workflows/babylon-mesa-transport-review.yml`: completed bounded browser diagnostic; automatic trigger retired.
- `dist/`, `node_modules/`, `test-results/`, `playwright-report/`: generated local output, not source.

## Research and historical evidence

`docs/production/` holds production specifications and acceptance protocols. The many phase/delivery reports under `docs/`, along with `screenshots/`, `lookdev-tmp/` and `scratch-tmp/`, retain prior evidence. They are not alternate game entry points. They remain in place to preserve links and reproducibility; cleanup must not delete assets merely because a folder is called temporary.

`playable/` is legacy publishing material. The supported build is the root Vite application and its `dist/` output. Do not start a second implementation there.

The compact [current status](CURRENT_STATUS.md) lists present gates; [development evidence history](maintenance/development-history-2026-10-31.md) preserves the chronological run notes and rejected candidates.

- `src/engine/assets/surface-texel-data.ts`: original deterministic surface/asphalt pixel data and constants, with compatibility exports in the original renderer. Independent pre-edit oracle and scope: [asphalt data boundary](maintenance/asphalt-data-boundary-2026-10-31.md).

- `src/engine/babylon/asphalt-substrate.ts` and `asphalt-substrate-plugin.ts`: original procedural dry substrate, now used by eligible Formula road meshes; full live qualification is separate from its isolated factor probes. Controlled original-reference probe: `e2e/fixtures/babylon-asphalt-parity.ts`; [scope](maintenance/asphalt-substrate-probe-2026-11-01.md).

- `docs/experiments/motion-projection-22-stage1/`: archived, unapplied physics experiment with exact-base patch, read-only verifier and hashes. It does not change this migration branch’s physics 21; see its explicit acceptance limits.

- `docs/experiments/motion-projection-22-stage2-results/`: bounded final-source results supplement, including actual fallback qualifications; no runtime physics activation.
- Live material ownership/readiness evidence and limitations: [dry asphalt integration](maintenance/babylon-live-dry-asphalt-2026-11-01.md).

- `scripts/offline-gpu-structure-*` and matching tests: offline-only fixed structural query and private bounded processor. No application/workflow capture integration. [Qualification and limits](maintenance/offline-gpu-structural-route-2026-11-01.md).

- `src/engine/assets/formula-grounding.ts`: original Formula grounding constants and presented-pose calculation, with original renderer compatibility. Live Formula surfaces now consume this data. [Boundary and oracle](maintenance/formula-grounding-data-2026-11-01.md).
- `docs/experiments/motion-projection-22-stage3-results/`: complete strict/off-road validation and all 74 entrant comparisons; the unexplained Arena regression keeps the source unapplied.

- `scripts/electron-runtime-ab-*` and matching tests: inert, nonpublishing official-runtime comparison infrastructure. No active launch/workflow or shipping runtime change. [Protocol](maintenance/electron-runtime-ab-offline-2026-11-01.md).

- `src/engine/babylon/formula-grounding.ts` and `e2e/fixtures/*grounding*`: live original Formula contact shading with UBO/ordinary-uniform transports and independent reference/metric probes. [Qualified source and remaining platform limits](maintenance/babylon-live-grounding-2026-11-01.md).

- `src/engine/babylon/start-gantry.ts` and `e2e/fixtures/babylon-start-gantry.ts`: original Aurel A07 structure adapter and qualified isolated native-image/GPU ownership probe. Live startup passed its GPU and Windows/macOS checks; Linux remains failed. [Scope](maintenance/babylon-start-gantry-2026-11-01.md).


`src/engine/babylon/gantry-preparation.ts` owns original Aurel A07 startup staging,
ready-frame installation and cleanup after the surface gate. `start-gantry.ts`
preserves the original structural asset, atlas and conformed geometry. Browser
and native receipts verify actual ready resources; full environment migration
remains separate. See [A07 qualification](maintenance/babylon-start-gantry-2026-11-01.md).

`src/engine/babylon/start-lamps.ts` is the original five-lamp owner;
`lamp-preparation.ts` connects it to guarded startup after the gantry. Its isolated
and live GPU plus Windows/macOS checks passed; Linux remains failed. Original geometry and snapshot
authority are retained. [Scope](maintenance/babylon-start-lamps-2026-11-01.md).

`src/engine/babylon/start-banner.ts` and `start-banner-material.ts` own the
original banner canvas/plane and plain backing shader behavior. Same-canvas GPU
qualification passed on `757c162`. `banner-preparation.ts` stages it after lamps
with actual binding and completed-frame receipts; live runtime checks are pending. [Scope](maintenance/babylon-start-banner-2026-11-01.md).

`scripts/native-readiness-observation.mjs` owns bounded harness observations;
`src/engine/babylon/readiness-observation.ts` exposes detached read-only owner
metadata through the existing graphics query. Neither changes readiness gates.
[Scope](maintenance/native-startup-readiness-observation-2026-11-01.md).
