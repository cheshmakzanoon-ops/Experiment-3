# MOTOBOUND

**A desktop motorsport game. Circuit racing, open roads, two wheels or four.**

MOTOBOUND targets **Windows, macOS and Linux executables**, built from TypeScript with **Babylon.js as the main-engine direction** and the existing custom vehicle/race simulation retained as a component. The shipping product is an installed, offline-capable desktop game, **not a browser website**.

[Current status](docs/CURRENT_STATUS.md) · [Desktop delivery](docs/DESKTOP_DELIVERY.md) · [Repository map](docs/REPOSITORY_MAP.md) · [Babylon migration](docs/BABYLON_MIGRATION.md) · [Development releases](https://github.com/cheshmakzanoon-ops/Experiment-3/releases)

> **In development, not a finished commercial release.** Desktop packaging and Babylon migration are being validated. The first Babylon scene is an explicitly labelled integration workbench, not the final graphics or complete game. Existing Three.js content remains available as a temporary migration fallback; it is not being discarded. Signing, macOS notarization, representative-hardware performance, full gameplay qualification and Steam integration remain open.

## Desktop builds and downloads

| Platform            | Development packages     | Native CI runner    |
| ------------------- | ------------------------ | ------------------- |
| Windows x64         | EXE installer            | Windows             |
| macOS Apple Silicon | DMG and app ZIP          | Apple Silicon macOS |
| macOS Intel         | DMG and app ZIP          | Intel macOS         |
| Linux x64           | AppImage and tar archive | Linux               |

[Desktop build workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/desktop-build.yml) builds and launches each packaged application on its target operating system. Source-addressed development prereleases are published only after all four native build/launch jobs succeed. Each package has SHA-256 checksums and embedded source identification. **Do not assume packages exist or passed until the workflow and release actually show them.**

Initial packages are **unsigned development builds**. Windows reputation/signing and macOS signing/notarization have not been configured. These builds are for development testing, not a claim of retail distribution readiness.

The desktop runtime uses Electron to provide a consistent bundled Chromium runtime for Babylon/TypeScript. It does not open a browser tab or depend on the hosted preview. Assets load from a restricted local application protocol. The renderer is sandboxed, has no Node.js access, and does not receive general filesystem or shell APIs.

## Latest verified progress · 2026-10-31

- Windows x64 and Apple Silicon packages build and pass offline Babylon launch, pause/restart and renderer-isolation checks in [native run 41168620134](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41168620134). Intel macOS and Linux build their packages but fail headless graphics initialization; CI renderer repairs are pending. No four-platform prerelease has passed yet.
- GP AI completes the real catch-and-pass without contact and reproduces its replay snapshot. Shared traffic and GP approach/riding checks: **28/28 passed**.
- Motocross hard-stop recovery now exchanges momentum without inventing launch energy. Latest focused suite: **568/572 passed**. Four soil-contact cases and the separate mixed GP/superbike pace case remain open. Test-contract corrections for finite wheel inertia are itemized in the [validation ledger](docs/maintenance/validation-2026-10-31.json).
- Babylon is still an integration workbench, not final-quality graphics. Native keyboard driving and original-model import are added to the next desktop validation run; full four-discipline presentation, performance and playtesting remain required.

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
