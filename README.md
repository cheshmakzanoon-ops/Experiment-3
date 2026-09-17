<div align="center">

# 🏎️ APEX / Formula
### A browser racing simulator built around the engineering underneath the lap.

**Original cars. Original circuit. Coupled physics, race systems, telemetry, and procedural presentation.**

[![Build and validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml/badge.svg)](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.180.0-111111?logo=threedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.1.7-646CFF?logo=vite&logoColor=white)
![Physics](https://img.shields.io/badge/Physics-120_Hz_%2F_240_Hz_substeps-orange)
![Status](https://img.shields.io/badge/Status-Engineering_prototype-yellow)

[🚀 Get started](#-get-started) · [🛠️ Tech stack](#-tech-stack) · [⚙️ Engineering](#-engineering-under-the-bodywork) · [🧪 Validation](#-testing-and-validation) · [📚 Documentation](#-documentation)

</div>

---

## 🏁 What is APEX / Formula?

APEX / Formula is an original, single-player Formula-style racing simulation written in **TypeScript and Three.js**. Drive the fictional **2.973 km Aurel circuit**, race AI opponents, change vehicle setup, manage tires and hybrid energy, react to evolving weather, perform pit stops, and inspect the lap through replay and telemetry.

Its central design rule is that a system should change the car, not merely decorate the screen: tire temperature affects grip, fuel changes mass, damage changes aerodynamic loads, water changes contact behavior, and battery deployment consumes stored energy. The dashboard, graphics, and sound consume that simulated state.

> **Project status:** v0.1.0 engineering prototype. This is not an official Formula 1 product, an F1 25 replica, or a commercially validated simulator. Physics coefficients are documented approximations, and the repository does not claim AAA parity, flawless AI, or measured performance on every device. See the [coverage ledger](docs/IMPLEMENTATION_MATRIX.md) for delivered and partial requirements.

## ✨ What you can explore

| | System | What is implemented |
|---|---|---|
| 🏎️ | Vehicle dynamics | Six-degree-of-freedom chassis, four suspension contacts, nonlinear load-sensitive tire forces, combined slip, and forces applied at physical attachment points. |
| 🛞 | Tires and brakes | Soft, medium, hard, intermediate, and wet compounds; surface/carcass temperature, pressure, wear, contamination, flat spots, brake heat, and fade. |
| ⚡ | Powertrain | Torque-curve engine, eight forward gears, automatic/manual shifting, reverse, limited-slip differential approximation, fuel consumption, hybrid deployment, and regeneration. |
| 🌬️ | Aerodynamics | Separate front wing, rear wing, floor, and drag terms; ride-height response, ground-effect choking, dirty air, slipstream, and damage-sensitive loads. |
| 🌦️ | Evolving circuit | Spatial water, rubber, marbles, and temperature; clear, wet, and changing-weather sessions; shared track geometry for visuals and contact queries. |
| 🤖 | AI and race rules | Shared player/AI physics, speed preview, lane commitment, traffic response, starting lights, ordered lap gates, penalties, classification, and results. |
| 🔧 | Pit lane and setup | Physically driven pit approach, stopping, tire service, and exit; garage settings for wings, brake bias, differential, suspension, pressures, camber, and toe. |
| 🎨 | Original presentation | Procedural car and circuit, PBR materials, articulated wheels and suspension, live steering-wheel display, weather effects, and four camera views. |
| 🔊 | Procedural sound | Web Audio engine harmonics, tire/surface noise, wind, weather, impacts, and nearby-car spatial audio. |
| 📊 | Engineering tools | Telemetry graphs, lap-distance comparison, CSV export, force/debug overlays, and bounded pose replay with seeking and playback-speed controls. |
| 🎮 | Browser integration | Keyboard, gamepad, and touch controls; optional cockpit mouse look; versioned IndexedDB preferences and best-lap records. |

## 🚀 Get started

Use **Node.js 22.12 or newer** and a browser with **WebGL2 and module-worker support**.

```sh
git clone https://github.com/cheshmakzanoon-ops/Experiment-3.git
cd Experiment-3
npm ci
npm run dev
```

Open the local address printed by Vite, configure a session, and select **Enter Circuit**. For an immediate demonstration, choose **Free practice** and press **G** to enable the explicitly labelled AI demonstration driver. Press **G** again to take control.

**No backend, account, API key, paid service, or downloaded car/track assets are required.** Geometry, textures, and audio are generated locally. Audio starts after the user enters the circuit.

### 📦 Build and serve

```sh
npm run build
npm run preview
```

The production output is in `dist/`. Deploy that directory to a static HTTPS host. Relative asset paths support subdirectory hosting. Serve the application over HTTP/HTTPS rather than opening `index.html` directly; its modules and physics worker require an HTTP origin. The Vite development server is for local development, not public production hosting.

## 🎮 Controls

| Input | Action |
|---|---|
| **W / ↑** | Throttle |
| **S / ↓ / Space** | Brake |
| **A, D / ←, →** | Steer |
| **[ / ]** | Downshift / upshift; switches to manual shifting |
| **B + throttle** | Reverse when nearly stationary |
| **C** | Cycle chase, cockpit, pod, and trackside cameras |
| **P** | Request/cancel a pit stop; automatic approach, service, and exit |
| **E** | Cycle harvest, balanced, and attack hybrid modes |
| **G** | Toggle AI demonstration driving |
| **T** | Telemetry and CSV export |
| **R** | Replay |
| **F3** | Engineering overlay and contact-load arrows |
| **M** | Mute |
| **Escape** | Pause and release cockpit mouse look |
| **Double-click in cockpit** | Optional mouse look |

Standard gamepads use the left stick and triggers, with shoulder-button manual shifting. Automatic shifting remains active until a manual shift is requested; restarting the session restores it.

Choose **Sport** for filtered steering, traction control, and ABS, or **Unassisted** for the raw tire model. Garage setup changes apply to the **next session**; graphics, audio, and interface changes apply immediately. Heavy-rain sessions select full-wet tires by default; slicks in heavy rain are deliberately much harder to drive.

## 🛠️ Tech stack

Versions below are pinned in [`package.json`](package.json) and [`package-lock.json`](package-lock.json).

| Layer | Technology | Responsibility |
|---|---|---|
| Language | **TypeScript 5.9.3** | Strictly typed simulation state, browser integration, and worker messages. |
| Rendering | **Three.js 0.180.0 / WebGL2** | Scene, procedural geometry, PBR materials, shadows, environment, and postprocessing. |
| Build | **Vite 7.1.7** | Development server, production bundling, worker compilation, and static output. |
| Simulation concurrency | **Web Workers** | Dedicated fixed-step simulation, isolated from rendering. |
| Data transport | **Typed arrays / transferable ArrayBuffers** | Reusable snapshot buffers and compact simulation-to-renderer data. |
| Audio | **Web Audio API** | Synthesized vehicle, tire, surface, weather, and impact sound. |
| Input | **Keyboard / Gamepad / Pointer APIs** | Input filtering, device controls, touch interaction, and optional pointer lock. |
| Persistence | **IndexedDB** | Versioned preferences, setup-related data, and best-lap records. |
| Unit testing | **Vitest 3.2.4** | Physics relationships, determinism, race logic, recording, and geometry tests. |
| Browser testing | **Playwright 1.55.1** | Chromium workflows, screenshots, traces, and console/error checks. |
| Code quality | **ESLint 9.36.0 / Prettier 3.6.2** | Linting, TypeScript-aware rules, and consistent formatting. |
| Automation | **GitHub Actions** | Clean install, lint/test/build checks, simulation scenarios, and browser artifacts. |

Three.js is the only direct runtime npm dependency. The simulation does not depend on a heavyweight game engine or a separate physics engine.

## ⚙️ Engineering under the bodywork

### 🧵 Rendering and simulation have separate clocks

[`physics.worker.ts`](src/workers/physics.worker.ts) owns the simulation. A **120 Hz fixed-step accumulator** advances the world; each tick uses **two 240 Hz contact/rigid-body substeps**. Rendering interpolates snapshots instead of supplying an arbitrary frame delta to the physics solver.

A pool of **five transferable buffers** carries snapshots. Old buffers are returned for reuse. Pausing resets wall-clock accounting; stale player input triggers a braking fallback. Physics errors stop the worker and surface visibly rather than silently resetting the car.

```text
Keyboard / gamepad / touch
          │ bounded controls + explicit commands
          ▼
Physics worker ── 120 Hz world / 240 Hz contact substeps
          │
          ├── vehicle, tires, brakes, aero, fuel, hybrid
          ├── track surface, collisions, weather
          └── AI, timing, race rules, pits
          │ reusable typed-array snapshots
          ▼
Main thread ── interpolated Three.js rendering
          ├── HUD and live steering-wheel display
          ├── procedural Web Audio
          └── telemetry, replay, and persistence
```

### 🛞 Tires are a force model, not a steering animation

The chassis accumulates linear force and torque at suspension and aerodynamic application points. Four suspension contacts generate dynamic loads through springs, bump/rebound damping, anti-roll coupling, and bump stops.

Tire forces use nonlinear, load-sensitive curves with a combined-force limit. A backward-Euler wheel-angular solve with bisection addresses stiff low-speed behavior; braking includes a condition that prevents the brake from accelerating a stopped wheel backwards. Surface and carcass thermal masses respond to slip energy, heat transfer, and cooling.

These are **engineering approximations**, not proprietary tire measurements or a full multibody/finite-element vehicle model. The [architecture notes](docs/ARCHITECTURE.md) explain the assumptions.

### 🌧️ Weather changes the surface beneath each wheel

The Aurel circuit uses an arc-length-indexed spline and shared ribbon geometry. A **512 × 7 surface grid** stores water, rubber, marbles, and temperature. Rain, drainage, evaporation, and tire passage evolve the local cells; contact queries and wet-road shading use the corresponding state.

This permits spatial differences instead of making the whole track a single global wetness value. The track is an original procedural design, not a scanned real-world circuit.

### 🤖 AI drives the same car model

AI strategy runs at **2 Hz**, traffic decisions at **12 Hz**, and control at **120 Hz** inside the physics worker. Curvature preview and a backward braking envelope determine target speed. Tire grip, fuel mass, and aerodynamic condition influence planning.

AI produces controls for the same vehicle code used by the player. Pit service requires reaching the assigned box and stopping; it does not teleport the car into place. Race timing uses ordered gates and forward progression to prevent repeated finish-line crossings from farming laps.

### 📼 Instrumentation is part of the architecture

Telemetry records physics-tick player state at **60 Hz** into a **15-minute ring buffer**. CSV columns use explicit units and expose actual sample timing. Lap comparison aligns traces by lap distance.

Replay stores **full-session numeric pose history at 15 Hz** in paged storage, interpolated for display. It does not advance the live simulation or claim to restore the entire physical world. Storage errors, worker failures, and graphics-context loss have visible failure paths.

### 🎨 Assets are generated by the project

Car bodywork, wings, wheels, halo, cockpit, trackside infrastructure, textures, and sound are procedural. Static geometry is merged by material; repeated elements use instancing. Wheels and suspension remain articulated from simulated state. Generated environment lighting, directional shadows, PBR surfaces, and restrained high-setting bloom complete the renderer.

No proprietary game assets, real team liveries, external fonts, or extracted recordings are bundled. See [asset provenance](docs/ASSET_PROVENANCE.md).

## 🗂️ Repository layout

These are regular source files and folders, not an archive that must be unpacked inside the repository.

```text
Experiment-3/
├── .github/workflows/ci.yml   # Automated build, tests, and browser validation
├── docs/                     # Architecture, coverage, provenance, measured reports
├── e2e/                      # Playwright browser workflows
├── public/                   # Static application icon
├── scripts/                  # Scenario and endurance runners
├── src/
│   ├── audio/                # Web Audio synthesis and state-driven sound
│   ├── core/                 # Math, units, stepping, and reusable primitives
│   ├── input/                # Keyboard, gamepad, touch, filtering
│   ├── rendering/            # Car, circuit, geometry, effects, renderer
│   ├── simulation/           # Physics, tires, aero, AI, track, race, collisions
│   ├── storage/              # IndexedDB, telemetry, replay, CSV
│   ├── ui/                   # Menus, HUD, engineering interface, styles
│   ├── workers/              # Physics worker and snapshot transport
│   └── main.ts               # Application lifecycle and coordination
├── tests/                    # Unit, property, and rendering-geometry tests
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

`src/simulation/` does not import Three.js or DOM APIs. That boundary allows the vehicle and race logic to run in headless Node.js tests as well as the browser worker. Generated `dist/`, `node_modules/`, and transient test output are not committed.

## 📼 Current recording and rendering checkpoint

The current source adds a physically open cockpit, live rear-view cameras, carbon/wet-road shaders, a budgeted local reflection probe, spatial circuit culling and three-level car detail. The rendering integration passed seven Chromium workflows before publication in commit `77c4d3b`.

The recording extension captures **176 telemetry channels at 60 Hz** and **all-car pose replay at 15 Hz** from physics ticks, independently of display rate. Replay pages and spatial surface history use a bounded IndexedDB cache; CSV formatting runs in a separate worker. Rendered punctures, suspension damage and detached components consume actual simulation state. Read [recording and replay architecture](docs/RECORDING_AND_REPLAY.md) for storage failure behavior and verification limits. The [telemetry and keyboard interface](docs/TELEMETRY_AND_INPUT_UI.md) adds seven graph groups, complete-lap distance comparison, and conflict-checked remapping for fifteen keyboard actions.

The original validation results below are historical baseline measurements, not certificates for every later feature.

## 🧪 Testing and validation

```sh
npm run check            # ESLint + Vitest + TypeScript + Vite production build
npm run test:physics     # Four-car dry, changing-weather, and wet scenarios
npm run test:endurance   # 100-lap single-car endurance fixture
npx playwright install chromium
npm run test:e2e         # Chromium workflows, screenshots, and traces
```

### 🔬 Recorded evidence and its limits

The recovered source was checked again on **September 17, 2026**: **49 unit/property tests passed**, along with linting, strict TypeScript checking, and the production build. The live badge above reports GitHub's workflow status separately.

The included [endurance report](docs/endurance-results.json) records **100 dry solo laps**, **two physical pit stops**, approximately **3.424 m maximum non-pit lateral offset**, and intact front-wing/floor health. Its explicitly configured **113 kg starting fuel load** affects real vehicle mass. It is not the short-race menu's standard fuel load.

The included [scenario report](docs/scenario-results.json) covers **four cars × three weather scenarios × 320 simulated seconds**. Every car completed at least four laps; all four fitted intermediates in the changing-weather scenario. Some scenarios include contact damage: the report is not evidence of flawless racing.

These JSON files are measured snapshots from the original validation run. Re-running the scripts refreshes them, including machine-dependent wall-clock measurements. A passing build or headless test is **not proof of visual fidelity, 100 flawless multi-car wet laps, or target-device frame rate**. Browser artifacts and outcomes are available under [GitHub Actions](https://github.com/cheshmakzanoon-ops/Experiment-3/actions).

## 🧭 Current boundaries

The project intentionally distinguishes implemented systems from future fidelity work:

- **Physics:** approximate tire/aero coefficients, BVH ribbon contact, and oriented chassis-box collisions; no experimentally fitted tire dataset, unsprung multibody solver, arbitrary-mesh crash system, or detailed battery chemistry.
- **Presentation:** live rear-view cameras, local probes and car LOD are implemented; screen-space/ray-traced reflections, motion blur, full skeletal driver animation and a streamed external-asset pipeline are not implemented.
- **Racing and devices:** AI still needs broader adversarial traffic testing; no network multiplayer, safety-car/championship system, browser wheel force feedback, or certified device-performance targets.

See the [148-section coverage ledger](docs/IMPLEMENTATION_MATRIX.md) before treating an aspirational requirement as a shipped capability.

## 📚 Documentation

| Document | Contents |
|---|---|
| [⚙️ Architecture](docs/ARCHITECTURE.md) | Coordinate system, SI units, ownership, numerical methods, approximations, lifecycle, and errors. |
| [🧩 Specification coverage](docs/IMPLEMENTATION_MATRIX.md) | Section-by-section implementation status and explicit omissions. |
| [🎨 Asset provenance](docs/ASSET_PROVENANCE.md) | Original procedural content and third-party dependency boundaries. |
| [🏁 Endurance results](docs/endurance-results.json) | Recorded 100-lap dry single-car measurements. |
| [🌦️ Scenario results](docs/scenario-results.json) | Recorded dry, changing-weather, and wet four-car measurements. |

---

<div align="center">

**🏎️ Drive the lap. 📊 Inspect the data. 🔧 Understand the system.**

An original browser racing engineering project — with its assumptions and limits documented alongside the code.

</div>
