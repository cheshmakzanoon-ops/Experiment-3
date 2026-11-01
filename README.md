# MOTOBOUND

> **Migration branch: `babylon-js`.** Babylon development continues only here. `main` remains the exact pre-migration snapshot restored from `20e0716`; do not merge this branch into main or run branch cleanup. Historical results below identify their own source commits.

**A desktop motorsport game. Circuit racing, open roads, two wheels or four.**

MOTOBOUND targets **Windows, macOS and Linux executables**, built from TypeScript with **Babylon.js as the main-engine direction** and the existing custom vehicle/race simulation retained as a component. The shipping product is an installed, offline-capable desktop game, **not a browser website**.

[Current status](docs/CURRENT_STATUS.md) · [Desktop delivery](docs/DESKTOP_DELIVERY.md) · [Repository map](docs/REPOSITORY_MAP.md) · [Babylon migration](docs/BABYLON_MIGRATION.md) · [Development releases](https://github.com/cheshmakzanoon-ops/Experiment-3/releases)

> **In development, not a finished commercial release.** Desktop packaging and Babylon migration are being validated. The first Babylon scene is an explicitly labelled integration workbench, not the final graphics or complete game. Existing Three.js content remains available as a temporary migration fallback; it is not being discarded. Signing, macOS notarization, representative-hardware performance, full gameplay qualification and Steam integration remain open.

## Desktop builds and downloads

| Platform            | Development packages     | Native CI runner    |
| ------------------- | ------------------------ | ------------------- |
| Windows x64         | EXE installer            | Windows             |
| macOS Apple Silicon | DMG and app ZIP          | Apple Silicon macOS |
| Linux x64           | AppImage and tar archive | Linux               |

[Migration desktop validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/babylon-desktop.yml) creates branch-only test artifacts without publishing releases. The historical [desktop build workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/desktop-build.yml) builds and launches each packaged application on its target operating system. Source-addressed development prereleases are published only after all three supported-target build/launch jobs succeed. Each package has SHA-256 checksums and embedded source identification. **Verified development download:** [source `b0b3ccc`](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-b0b3cccb54502898312efe5f884c2c254ddc48f2-41183949366-1), published after all three native lanes passed. Newer main commits require their own validation; this link identifies an immutable tested build. Later retained-mode qualification found decoder/security-policy and Linux graphics issues, documented below; this is not four-mode acceptance.

**Latest validated migration test builds:** source `6c1ded7` passed Windows x64, Linux x64 and Apple Silicon packaged-app checks plus all four existing-content compatibility journeys. The [branch validation run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41330696588) contains `motobound-package-win-x64`, `motobound-package-linux-x64` and `motobound-package-mac-arm64` artifacts (currently retained until 2026-11-08). These are unsigned test artifacts, not a new GitHub release or complete four-mode Babylon/Steam qualification. A later `a68a1ba` repeat again missed Linux’s startup gate, so stability remains unqualified. Main is unchanged.

Initial packages are **unsigned development builds**. Windows reputation/signing and macOS signing/notarization have not been configured. These builds are for development testing, not a claim of retail distribution readiness.

The desktop runtime uses Electron to provide a consistent bundled Chromium runtime for Babylon/TypeScript. It does not open a browser tab or depend on the hosted preview. Assets load from a restricted local application protocol. The renderer is sandboxed, has no Node.js access, and does not receive general filesystem or shell APIs.

## Current implementation and recorded qualification · 2026-11-01

- **Original starting-grid markings:** an isolated Babylon owner preserves the original Formula grid geometry and dry paint finish. CPU/build checks pass; a fifth GPU shard now checks original-reference factors, road occlusion, ownership and recovery. This is not live activation or wet/shadow parity. [Scope](docs/maintenance/babylon-grid-paint-isolated-2026-11-01.md).

- **Original Aurel gantry:** the Aurel A07 gantry structure passed isolated GPU/image qualification with exact original geometry, placement and atlas pixels. Live startup on `9c3b04b` passed all 18 WebGL journeys and Windows/macOS installed-app checks. Linux still fails later after car presentation; banner/lamp behavior and full environment parity remain open. [Scope](docs/maintenance/babylon-start-gantry-2026-11-01.md).
- **Original start lamps:** the five original start lamps preserve original geometry/material values and use existing race snapshots only. Live `3a3e977` passed all 22 GPU journeys, including early-paused startup, and Windows/macOS installed checks. Practice remains dark; Linux still fails later after car presentation. [Scope](docs/maintenance/babylon-start-lamps-2026-11-01.md).
- **Lamp facing correction:** `6164be1` preserves original CCW faces and passed all 22 GPU journeys, including cap-position/normal comparison and an old-error negative control. Windows/macOS installed checks passed. Linux instead timed out during an early paused-startup wait without a recorded GPU loss; cause remains unproven. [Evidence](docs/maintenance/babylon-procedural-facing-2026-11-01.md).
- **Paused startup publication:** exact `ccb5fbe` passed all 28 GPU cases, including actual completed-image reuse and an unchanged unmasked 1440×900 canvas after genuine resize/redraw. Windows/macOS packaged checks and four compatibility journeys passed. Linux passed initial startup but timed out during rebuilt-surface presentation after Restart, then lost its GPU context; full Linux remains failed. [Guard and evidence](docs/maintenance/babylon-paused-startup-publication-2026-11-01.md).
- **Original start/finish stripe:** isolated `e5609e7` passed all 28 GPU cases, including the corrected original-road depth reference with all 81 fixed samples. Live startup is now wired after the environment batch, with independent fresh-frame receipts; live `f0ca199` passed all 28 GPU cases and Windows/macOS packaged checks; Linux still misses the final startup fence deadline. [Scope](docs/maintenance/babylon-start-finish-stripe-2026-11-01.md).
- **Shared environment presentation:** existing gantry, lamps and banner prepare sequentially, then share presentation frames while each retains its own two-completion requirement. Stripe follows independently. The combined source passed 1,285 CPU tests and all GPU cases. Windows/macOS packaged checks pass; Linux reaches all-assets-ready but its final frame is late, so startup remains unqualified. [Ownership and limits](docs/maintenance/babylon-environment-batch-2026-11-01.md).
- **Paused preparation handoff:** a bounded scheduling change defers a surplus paused submission after a newly completed frame, allowing the next preparation owner to proceed. The existing deadlines and two-completion readiness requirements remain unchanged. Exact `6c1ded7` passed all 25 GPU cases and all three packaged-app targets, including four compatibility journeys each. This single run does not certify universal performance. [Scope](docs/maintenance/babylon-paused-preparation-handoff-2026-11-01.md).
- **Native observation correction:** `e10eefe` passed Windows/macOS installed checks and all four existing-content journeys. Linux's unchanged first-pause gate timed out with the original gantry still installing; new bounded observations record the actual pre-timeout state, without a GPU fault or a Linux-fix claim. [Evidence](docs/maintenance/native-startup-readiness-observation-2026-11-01.md).
- **Original start banner:** isolated `757c162` passed all three banner GPU cases, with exact same-canvas factor images, hardware-sRGB sampling and plain back-face behavior. Live `6b07b0a` passed all 25 GPU journeys, including early-paused startup, and Windows/macOS installed checks; Linux still misses its startup gate. [Scope](docs/maintenance/babylon-start-banner-2026-11-01.md).

- **Qualified application checkpoint (`f996583`):** live Formula grounding and both uniform transports passed all **15 SwiftShader WebGL journeys**. Windows x64 and Apple Silicon macOS passed packaged Babylon checks plus all four existing-content compatibility journeys. Linux still fails during a native graphics wait followed by GPU-process loss; no all-platform release is qualified. Original models, renderer and physics remain preserved. [Exact scope/results](docs/maintenance/babylon-live-grounding-2026-11-01.md).

- **Branch-local live grounding:** the isolated implementation passed all 13 GPU journeys on `7e9cbb6`. Existing Formula road/paint materials now consume original vehicle grounding poses; no models, geometry or physics are replaced. The live workload passed on `f996583`; native Linux remains unqualified. [Scope and pending gates](docs/maintenance/babylon-live-grounding-2026-11-01.md).

- **Earlier native qualification (`0076e3c`):** Windows and Apple Silicon passed 855 contracts and all four installed compatibility journeys. Required Mesa passed original-model/wheel checks, then failed Formula preparation with final GPU loss; publication was skipped. The same source passed all 12 Babylon WebGL journeys. [Native run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41272683767) · [GPU run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41272683640).
- **Recorded settings/keyboard result (`cf76725`):** 27/28 passed, including both Festival controller and corrected map-policy cases. The original cold paused-grid loading requirement still fails. [Run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41232073393).
- **Verified preparation boundary:** supplied-model index preparation moves eligible uploads before the owned warmup draw, and frame completion precedes post-draw program queries. A real-GL parity probe and stronger bidirectional menu-keyboard coverage are wired into Actions. Calibration reports now identify measured source/runtime/physics and reject changing inputs. These changes do not yet establish a Linux repair. [Graphics details](docs/maintenance/supplied-index-preparation-2026-10-31.md) · [Calibration provenance](docs/maintenance/calibration-provenance-2026-10-31.md).
- **Rendering evidence:** the normal settings/loading suite passed **8/8** on `80d9fe4`, including its original paused-grid deadline. This does not establish repeatability: the profile and separate night workload still fail. In the paired DOF experiment, preparing that exact shader early moved the long wait to bloom without an overall improvement; the experiment remains excluded from normal builds.
- **Automatic gearbox recovery (physics v21):** the published source now passes the independent full 57-vehicle strict CI calibration and full scenario job, including continuous driving. Older v18/v19/v20 records remain preserved; the rejected road-RPM guard remains removed. [Mechanism and exact deltas](docs/maintenance/automatic-cut-recovery-2026-10-31.md) · [CI](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41232073397).
- **Current graphics diagnosis:** a separate nonpublishing Mesa compatibility scope isolates the retained game; required full Babylon/compatibility journeys remain unchanged. Sticky first-fault handling preserves GPU exits instead of replacing them with later observation timeouts. Ubuntu24 still stops before graphics initialization on its sandbox-helper configuration; no security change has been made.
- **Download baseline:** the [source-addressed `b0b3ccc` development release](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-b0b3cccb54502898312efe5f884c2c254ddc48f2-41183949366-1) passed all three native lanes under its earlier, weaker checks. It is not current-source or complete four-mode acceptance. Later Windows/Apple Silicon four-mode passes are recorded in [current status](docs/CURRENT_STATUS.md).
- **Existing physics retained:** GP catch-and-pass and shared traffic checks pass; the separate mixed GP/superbike pace regression remains open. The latest focused motocross suite passed **572/572** after physical fixes and documented finite-inertia contract corrections. The `0066f1c` full unit suite passed **5,606/5,607**, with the known GP pace failure; its full scenario job also passed, including all 14 continuous-driving checks. Its longer Arena Nord supercross scenario also found a traffic queue behind a stranded rider; that investigation remains open. Historical frozen-suite failures remain in the [validation ledger](docs/maintenance/validation-2026-10-31.json). An [unaccepted motion/projection checkpoint](docs/experiments/motion-projection-22-stage1/README.md) is archived for review without changing the running physics.
- **Opt-in Babylon index tiers:** the original-model WebGL probe passed all tiers and exact full-detail image restoration, with unchanged material/rig ownership. Automatic gameplay tier policy remains disabled. [Contract](docs/maintenance/babylon-index-tiers-2026-10-31.md) · [6/6 renderer journeys](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41228521961).
- **Babylon scalar-height repair:** the corrected renderer probe passed 8/8, with exact Three-reference normal comparisons, genuine-normal isolation and exact raw restoration after disposal. The real model-loading path now applies the repair under its existing GPU preparation lease. The `a937cac` WebGL run passed all 8 cases, including ten enabled materials after completed presentation and clearing on restart; native qualification remains separate. [Details](docs/maintenance/babylon-height-parity-2026-10-31.md).
- **Live Formula surface boundary (`b451a2e`):** the original full road and edge paint are now selected only for canonical Aurel/Vellamar Formula contexts, with coarse fallback elsewhere. Startup compiles the actual variants and requires two ready GPU completions before asset inspection. The `b451a2e` full-lap probes passed with GL0. After correcting recovery-fixture event ordering, `cee488b` passed all 11 GPU journeys, including actual context restoration and explicit rebuild. Windows/Apple Silicon passed; Linux GPU loss remains unresolved. Asphalt layers, grounding and light pools remain unported. [Boundary](docs/maintenance/babylon-live-formula-surfaces-2026-10-31.md).
- **Private GPU diagnosis:** one narrowly authorized service-API observation on `89a04a8` retained valid numeric evidence while gameplay failed. Selected graphics wrappers completed, but open decoder work remains unexplained; missing producer-tail/unselected-call limitations remain. The temporary one-shot trigger is retired. No raw trace upload or Linux repair is claimed. [Protocol and results](docs/maintenance/native-gpu-trace-2026-10-31.md).
- **Shared circuit geometry boundary:** original Three road/paint/kerb ribbon buffers now come from a renderer-neutral component. Independent pre-edit fixtures match every vertex, normal, index and auxiliary-attribute byte; materials, shader hooks, detail and physics stay unchanged. The live Formula adapter now consumes this shared geometry; its larger workload has separate qualification requirements. [Evidence](docs/maintenance/circuit-ribbon-data-2026-10-31.md).
- **Live original dry asphalt:** canonical Formula road meshes now share the original three-texture procedural substrate, with ownership, context-loss and restart guards. Exact live source `f2cf877` passed all 12 real-WebGL journeys, including both full canonical venues, resource disposal and loss/rebuild. Windows/Apple Silicon native checks also passed; Linux remains blocked by later GPU loss. Wet/scanned/road-state layers and lighting parity remain unported. [Live scope](docs/maintenance/babylon-live-dry-asphalt-2026-11-01.md).
- **Original asphalt data boundary:** deterministic texture generators and exact constants now live in a renderer-neutral component. Independent pre-edit bytes and complete factory/shader snapshots remain unchanged. This prepares material reuse; it does not activate Babylon asphalt shading. [Evidence](docs/maintenance/asphalt-data-boundary-2026-10-31.md).
- **Babylon asset contract:** the original 172 geometry parts now have explicit primitive/material/joint bindings, with a shared renderer-independent LOD-data codec. Actual-import tests compare all original indices and vertex attributes; full detail remains selected. This is migration infrastructure, not completed LOD or visual parity. [Details](docs/maintenance/babylon-primitive-bindings-2026-10-31.md).
- **Asset reuse:** original Formula driver steering and rigid wheel motion now follow authoritative snapshots in Babylon. The original Basis v1.50 decoder runs under the unchanged strict security policy; all 74 textures / 3,543 outputs matched exactly. Windows and Apple Silicon native four-mode runs confirmed the CSP repair. [Decoder evidence](docs/BASIS_TRANSCODER.md).
- **Offline graphics investigation:** a separate, source-pinned structural-summary tool is checked in with bounded private processing and synthetic parser/lifecycle tests. It is not connected to application/workflow capture, does not reprocess historical raw traces and does not diagnose or repair the Linux failure. [Scope](docs/maintenance/offline-gpu-structural-route-2026-11-01.md).
- **Runtime-comparison infrastructure:** fixed official 45.2.1/44.10.1 archives and an isolated comparison harness passed offline checks, including 79 top-level tests. No native launch, active workflow or shipped downgrade is enabled. [Scope and remaining gates](docs/maintenance/electron-runtime-ab-offline-2026-11-01.md).
- **Original grounding data preserved:** the Formula footprint/constants and presented-pose calculations now have a renderer-neutral owner, checked against a frozen pre-edit original oracle. Full types/lint/build, 293 Babylon contracts and 160 original/neutral/look checks passed. This does not yet activate grounding in Babylon. [Boundary](docs/maintenance/formula-grounding-data-2026-11-01.md).
- **Isolated grounding probe:** the original Formula grounding plugin and independent road/paint lighting probe pass source/build checks (357 Babylon contracts and 160 original/neutral/look checks, with overlap). The first real-GPU run on `ec93c56` passed the twelve retained journeys but the new candidate failed shader linking due to integer precision mismatch. The precision and inventory corrections passed on `7e9cbb6`; live integration and native/standalone transport checks subsequently passed on `f996583`. The complete game is not yet migrated. [Scope and pending GPU gate](docs/maintenance/babylon-grounding-probe-2026-11-01.md).
- **Physics experiment held:** the isolated motion/contact candidate passed all 57 strict calibrations and ten off-road race gates, but Arena’s AI-driven player slot crashes more often. Its code remains unapplied; the complete 74-entrant comparison is [archived here](docs/experiments/motion-projection-22-stage3-results/RESULTS.md).
- **Still in development:** Babylon remains a labelled integration workbench. Complete four-discipline presentation, material/environment parity, controller-only qualification, representative-hardware performance and playtesting remain open. Academy promotion exposes the full venue, but its cold visibility/loading deadlines are not yet met. [Detailed evidence and remaining gates](docs/CURRENT_STATUS.md).

Intel macOS validation remains available as a separate manual experimental workflow. It reuses the same build/check implementation, never publishes, and is not a supported download target yet.

## Engine and content ownership

- **Babylon.js:** primary rendering/game-engine migration destination.
- **Existing simulation:** vehicle physics, tyres, suspension, racing AI, race control, off-road and festival systems remain authoritative. A second physics engine must not double-integrate vehicles.
- **Existing assets and systems:** preserve models, materials, animation, audio, controls, saves and progression. Reuse or port them with explicit fidelity checks.
- **Three.js:** temporary compatibility path for the already-developed content while Babylon reaches parity.
- **Desktop shell:** offline packaging, application lifecycle, window/fullscreen behaviour and platform delivery.

The quality target is a polished, enjoyable, replayable desktop game with high-end presentation. Passing tests, installing Babylon or producing an EXE alone does not satisfy that target. No revenue or profit is guaranteed.

## Find each discipline

| Experience             | Existing content entry                                     | Main implementation                                           |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Formula circuit racing | **FORMULA**, then select the session                       | `src/simulation/`, `src/rendering/`, `src/ui/f1-hud.ts`       |
| GP motorcycle racing   | **GP MOTORCYCLES**, or GP-R1/GP-R2 with a compatible venue | `src/simulation/motogp-physics.ts`, `src/rendering/gp-*.ts`   |
| Motocross / supercross | **OUTDOOR MX** or **STADIUM SX**, then a ride preset       | `src/simulation/offroad/`, `src/ui/motocross-presentation.ts` |
| Open-world driving     | **OPEN WORLD**, or **SESSION → Festival · open world**     | `src/simulation/open-world/`, `src/session/free-roam.ts`      |

These are original fictional motorsport disciplines, not licensed F1, MotoGP or Forza products. Their full migration into Babylon and the desktop experience is ongoing. The desktop **Game** menu provides the temporary existing-content fallback during that work.

Existing systems include practice, ghost time trials, qualifying, Grand Prix and endurance events; AI rivals; weather, tyre wear, fuel, damage and pit service; a career and garage; replays, flashback and telemetry; and Solvane festival activities, traffic and photo mode. Availability and validation depend on the selected discipline. Online racing remains an experimental implementation, not a hosted multiplayer service.

## Run the desktop development build

Requirements: Node.js **22.12+**, npm, and a supported desktop OS with WebGL2-capable graphics. Dependencies are pinned in the lockfile.

```sh
git clone https://github.com/cheshmakzanoon-ops/Experiment-3.git motobound
cd motobound
git switch babylon-js
npm ci
npm run desktop:dev
```

Build native development packages for the current platform:

```sh
npm run desktop:package
```

Products go to `desktop-out/`. Cross-platform delivery is performed by the native GitHub Actions matrix, not by assuming one operating system can certify another. The desktop app opens the Babylon migration entry; the complete existing-content fallback is available from its Game menu.

## Controls

The existing input controller is retained, including saved mappings, gamepad calibration, steering smoothing, shift actions and focus-loss safety. Default bindings:

| Input            | Action                                                        |
| ---------------- | ------------------------------------------------------------- |
| W / S            | Throttle / brake                                              |
| A / D            | Steer                                                         |
| [ / ]            | Downshift / upshift                                           |
| G                | AI demonstration                                              |
| Escape           | Pause / resume                                                |
| F11 or Alt+Enter | Desktop fullscreen                                            |
| C                | Camera in the existing content; Babylon camera parity pending |
| P                | Pit request                                                   |
| T / R / X        | Existing-content telemetry / replay / flashback               |

On motorcycles, the normal brake is the front brake and the clutch binding is the rear pedal. The full controls and per-mode support live in [bindings](src/input/bindings.ts) and [current status](docs/CURRENT_STATUS.md). Unsupported Babylon presentation actions must be reported honestly, not silently treated as implemented.

## Development and verification

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run desktop:compile` | Type-check and compile the desktop main process                   |
| `npm run desktop:prepare` | Build renderer and prepare the offline application payload        |
| `npm run desktop:package` | Produce current-platform native packages                          |
| `npm run check:stable`    | Guarded lint, content validation, complete unit suite and build   |
| `npm run test:physics`    | Dynamics, race control, wet pits and integrated driving           |
| `npm run test:offroad`    | Off-road calibration and race scenarios                           |
| `npm run test:open-world` | Festival routes, traffic and motorcycle scenarios                 |
| `npm run test:e2e`        | Renderer/browser journeys, complementing native application tests |

The full unit suite is divided into four **required** CI partitions with no excluded tests. Native build/launch checks and the focused Babylon WebGL workflow supplement the existing release gates. Software-renderer results do not certify physical GPU performance or PS5-level presentation.

## Secondary engineering previews

The [hosted preview](https://cheshmakzanoon-ops.github.io/Experiment-3/) and [Babylon workbench](https://cheshmakzanoon-ops.github.io/Experiment-3/babylon.html) are secondary development tools. They are not the shipping product or proof of desktop readiness.

For fast renderer iteration, `npm run dev` starts Vite. `npm run build` produces `dist/`, and `npm run preview` serves it locally. Browser-based automation remains useful for WebGL/UI diagnostics, while installers and desktop lifecycle are tested separately on Linux, Windows and macOS.

## Repository and documentation

- [Repository map](docs/REPOSITORY_MAP.md): where code, models, authoring tools, tests and historical evidence live.
- [Current status](docs/CURRENT_STATUS.md): verified progress, failures and deployment identity.
- [Desktop delivery](docs/DESKTOP_DELIVERY.md): packaging, isolation, CI and signing limitations.
- [Babylon migration](docs/BABYLON_MIGRATION.md): existing-engine component boundary and per-mode parity gates.
- [Architecture](docs/ARCHITECTURE.md), [modes](docs/MODES.md), [asset provenance](docs/ASSET_PROVENANCE.md).
- [GP physics](docs/motogp-physics-model.md), [motocross physics](docs/motocross-physics-model.md), [GP workstream history](docs/MOTOGP_HYPERREAL_PROGRAMME.md).
- [Production specifications](docs/production/) and [original master directive](docs/MASTER_DIRECTIVE.md) retain historical requirements. The latest desktop product direction in this README and `AGENTS.md` supersedes browser-first delivery language in older reports.

`main` is the sole development branch. The [consolidation receipt](docs/maintenance/branch-consolidation-2026-10-31.json) preserves the integrated branch tips. Historical reports are evidence for their own revisions, not automatic certification of current code.
