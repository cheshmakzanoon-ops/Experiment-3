# Current development status

Updated **2026-10-31**. Source integration, automated tests, installed-game checks and release readiness are separate claims. [README](../README.md) · [Repository map](REPOSITORY_MAP.md) · [Desktop delivery](DESKTOP_DELIVERY.md) · [Detailed source/run history](maintenance/development-history-2026-10-31.md).

## Product and repository

MOTOBOUND is a **Windows x64, Apple Silicon macOS and Linux x64 desktop game**, built with TypeScript and Babylon.js as the main-engine direction. The existing custom simulation is the sole authoritative physics engine. Full-content Three.js remains a temporary compatibility entry while Babylon reaches parity; the website is only an engineering preview. Intel macOS is experimental and unreleased.

Development stays on **main**. All eight audited branch tips were preserved as ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`, including 53 GP development commits. The integrated extra branches were removed. [Consolidation receipt](maintenance/branch-consolidation-2026-10-31.json).

**Verified downloadable baseline:** [unsigned development build `b0b3ccc`](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-b0b3cccb54502898312efe5f884c2c254ddc48f2-41183949366-1). It passed its earlier, weaker native checks; it is neither current source nor complete four-mode acceptance. New development downloads require all three supported native targets to pass for the exact source. Signing, notarization, Steam credentials and retail qualification are not configured.

## Latest recorded qualification

| Scope | Exact source | Result and boundary |
| --- | --- | --- |
| Required desktop matrix | `210ec1e` | Windows and Apple Silicon passed Babylon plus all four compatibility journeys. Required Mesa failed after cockpit preparation and Formula driving/pause; publication skipped. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41226137639). |
| Linux comparison | `210ec1e` | Mesa compatibility-only diagnostic failed; the full SwiftShader comparison passed. Neither can replace required Mesa. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41226137600). |
| Ubuntu24 diagnostic | `210ec1e` | Contracts passed; launch stopped before app connection on the existing root-owned/mode4755 sandbox-helper requirement. No security configuration change made. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41226137595). |
| Babylon real WebGL | `48bfd15` | All **5 journeys passed** on SwiftShader: original asset import, controls, pause/restart and discipline switching. Screenshots show the original car in the labelled integration workbench, not final presentation. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41225462628). |
| Settings/keyboard/WebGL probes | `48bfd15` | **15 passed / 1 failed**. Six keyboard viewports and index/program probes passed; original paused-grid loading exceeded its unchanged 60-second limit. The prior `ac270f7` 16/16 pass did not establish repeatability. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41225462608). |
| Complete unit partitions | `48bfd15` | **5,482 passed / 1 failed**, known mixed GP/superbike pace. [Full run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41225462578). |
| Continuous/scenario driving | `48bfd15` | Full scenario job passed, including **14/14** continuous-driving assertions; race 614.641 s, maximum 80.167 m/s, gear 8. The rejected launch regression is absent. Same full run. |
| Wet presentation | `48bfd15` | **8/8 passed**. This does not supersede ordinary browser failures or hardware qualification. Same full run. |
| Strict vehicle calibration | `48bfd15` | All 57 vehicles measured with stable source provenance; HF-86 remains outside its top-speed band: 124.09/124.12 km/h versus 305–345. No band relaxed. Same full run. |
| Off-road / full browser matrix | `48bfd15` | Arena Nord traffic-stall failure remains; full browser shards still being monitored. No complete CI pass or release claim. Same full run. |

The `210ec1e` prerequisite repair made native contracts use the existing npm test lifecycle, generating the pinned LOD derivative before tests. The earlier `48bfd15` native jobs passed 545 tests but failed collection of one suite because that generated file was absent; they never launched the game. A fresh archive with no derivative passed 51 affected tests on Node 22 through the corrected lifecycle. The Windows Git-root identity correction separately passed 36/36 tests on the actual Windows runner. [Calibration provenance](maintenance/calibration-provenance-2026-10-31.md).

## What is implemented

- **Existing game retained:** Formula, GP motorcycles, outdoor MX/stadium SX and open-world driving remain discoverable through the compatibility entry. Existing tracks, authored models, shaders, audio, controls, progression and saves are preserved. Availability is not equivalent to complete playtest qualification.
- **Babylon boundary:** fixed-step original simulation, snapshot transfer, production keyboard/gamepad/touch inputs, pause/restart, bounded GPU presentation and the original Formula asset. Original driver steering and rigid-wheel motion follow authoritative snapshots. [Migration](BABYLON_MIGRATION.md).
- **Original asset identity:** all 172 primitive/material bindings and 58 palette joints are validated; Babylon retains an additional non-palette armature bone. Actual-import tests compare every original index and vertex attribute. The shared PLD2 codec remains compatible with existing Three imports. [Binding contract](maintenance/babylon-primitive-bindings-2026-10-31.md).
- **Index preparation:** eligible original compacted index streams are prepared before owned warmup draws, with exact scheduled mirrors and unchanged post-draw counters in verified native receipts. Existing fences precede post-draw program queries. This did not fix Linux GPU completion/loss. [Details](maintenance/supplied-index-preparation-2026-10-31.md).
- **Physics identity v20:** the unsafe road-RPM upshift guard was rolled back after split-grip and continuous-driving regressions. Older v18/v19 records and ghosts remain preserved in their own categories, not relabelled or overwritten. [Rollback evidence](maintenance/vehicle-shift-stability-2026-10-31.md).

## Latest opt-in adapter and verification increment

The Babylon index-tier adapter can switch the original model's verified index streams and restore original CPU arrays under the existing exclusive GPU preparation lane. Geometry, submesh, full-source bounds, materials, skin and animation ownership are retained. A partial allocation/completion failure fails closed and delegates model teardown; transactional rollback is not promised. **The game does not activate this adapter or change its default detail level.** The original-model WebGL probe checks GPU index values, completed frames, resource disposal and exact full-detail pixel restoration; its first Actions execution is pending. [Contract and limitations](maintenance/babylon-index-tiers-2026-10-31.md).

The Festival results DOM test replaces a fixed 100 ms controller-connection delay with evidence of a completed real InputController poll of the new neutral mock pad. HUD/test reads cannot acknowledge that poll. Held-on-connect suppression, production input, exact retry counts and menu assertions stay unchanged. The old trace did not retain first-poll ordering, so this is a fixture-synchronization correction, not proof of a production-controller defect.

Native retained-game observations also expose existing CPU call/triangle totals and seven bounded phase buckets. They are labelled aggregate multipass counters, potentially partial or from a previous frame—not GPU completion or a reconstruction of blocked JavaScript work. No new GL query, rendering hook or acceptance rule is added.

**Local validation:** 281 tests across 27 files passed, root/desktop TypeScript, full lint, content/workflow checks and source-stable production build (Vite 62 s). Four affected suites repeated 39/39 on CI-matched Node 22. Both browser fixtures bundled; 18 selected Babylon/Festival cases were discovered. These checks do not claim execution of the new GPU probe or browser-controller sequence.

## Open acceptance gates

1. Resolve Linux graphics-process failures and repeat cold-loading acceptance without quality reductions, hidden errors or relaxed deadlines. A completed warmup followed by a later crash is still failure.
2. Fix HF-86 automatic-shift hunting, mixed GP/superbike pace and Arena Nord's stalled-rider traffic queue. Rejected physics experiments remain outside production; all existing assertions/bands stay required.
3. Complete all four disciplines in Babylon: environment/material/LOD policy, tyre deformation, animation, audio, UI, weather, pits, progression and replay parity. An integration workbench is not the finished game.
4. Qualify current-source packages, installer upgrade/uninstall, controller-only operation and every entry/driving/pause/restart/exit flow across supported platforms.
5. Measure representative physical hardware, review asset rights, obtain independent playtests and configure signing/notarization/Steam delivery.

The US$10,000 profit aspiration is not a technical test or guarantee. PS5-level presentation and commercial readiness require much more than these automated passes. Historical failures and superseded experiments remain in the [evidence archive](maintenance/development-history-2026-10-31.md) and [validation ledger](maintenance/validation-2026-10-31.json).
