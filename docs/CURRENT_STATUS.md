# Current development status

Updated 2026-10-31. This page separates source integration from successful validation and release readiness.

## Shipping direction

**Desktop first:** Windows EXE, macOS DMG/app and Linux AppImage/archive builds through native GitHub Actions. Babylon.js is the main engine direction with the custom simulation retained. The website is a secondary engineering preview. The desktop shell compiles and its offline-origin/security policy tests pass. A local Linux unpacked application was produced and its archive inspected: 507 entries, no duplicated node_modules tree. The first native run failed on Windows-invalid historical filenames, macOS LOD reproducibility and headless Linux WebGL availability. The `a99cf63` rerun builds and launch-tests Windows x64 and Apple Silicon successfully. Linux remains blocked at its llvmpipe renderer gate; Intel macOS also builds its packages but fails EGL initialization in the runner. CI-only OpenGL renderer repairs are pending. Stronger keyboard/model-import smoke checks are pending; signing is not configured. See [desktop delivery](DESKTOP_DELIVERY.md).

## Consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, retaining 53 MotoGP development commits without dropping history. See [branch receipt](maintenance/branch-consolidation-2026-10-31.json). Remote cleanup completed successfully in [run 41160579689](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41160579689). A subsequent remote listing contains only `main`.

## Validation in progress

- Lint passed locally on the consolidated source.
- TypeScript and the production build passed locally. The build reports a large application chunk (about 14.6 MB minified / 4.5 MB gzip), a loading/performance risk to investigate.
- The broad integration diagnostic completed: **4,976 passed / 4,994 total, 18 failed, zero skipped**. See the [failure ledger and focused follow-ups](maintenance/validation-2026-10-31.json). Later focused fixes and test-contract reviews are recorded separately; this is not an exact-commit all-green release certification. The latest local motocross run is **572/572 passing** after physical fixes and explicitly documented test-contract corrections. GP mixed-class pace remains open.
- A GP planner repair accounts for finite brake-lever application time. Wet-contact steering recovery is grip-aware without changing the dry controller; all three two-lap GP contact-race cases and the braking approach suite pass in the focused candidate run.
- Formula, GP motorcycles, motocross/supercross and festival must each pass actual browser journeys. Menu presence alone does not prove playability.
- Latest downloadable release remains `playable-3a6036de` (2026-10-06). It is not the latest source.
- Pages is enabled and deployment [41161818741](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41161818741) succeeded. The live site returned HTTP 200 and `BUILD_IDENTITY.json` identified `59fefcb065d38e5436994262b70896b5ddaf184d` when checked at 04:36 UTC. Later commits require their own deployment verification.
- New direct Formula / GP / Open World shortcuts have compatible-session unit tests. Their browser switching checks passed in Babylon integration run 41164885118.
- The motocross airborne limiter regression passes without clamping existing overspeed momentum. A subsequent telemetry fix distinguishes passive wheel pickup from requested braking and retains unloaded-wheel kinematic slip. The subsequent passive hard-stop and touchdown repairs resolve four more cases without new failures. Brake/settling tests now exercise the finite-inertia model rather than assume instantaneous kinematic wheel constraints; the ledger distinguishes those contract changes from code fixes.

## Latest handling verification

- GP overtaking now reserves enough lane-target room for finite lean response. The unchanged real catch-and-pass test completes without contact and reproduces its snapshot exactly. Shared traffic and GP braking/riding checks pass (28 cases); mixed GP/superbike pace still fails.
- Deep MX overlap recovery exchanges forward, vertical and pitch momentum through a passive contact impulse. The original raw/sport launch-height and crash assertions pass. A new 270-case analytic sweep verifies energy loss, not invented launch energy.
- The recovery test follows accumulated travel across the lap boundary and rejects station jumps; its original recovery-time/crash requirements remain intact.
- Finite wheel-inertia acceptance is explicit: braking acts on the rotor immediately and reaches the ground-force check within 16.7 ms. Forward-rider support is checked before 1 mm of fork movement. Settling requires honest sub-0.1% tyre slip and timestep convergence, not an impossible exact rolling clamp under drag.

The last four soil-contact assertions were reviewed against the finite-brush model: independent material coefficients remain exact, while forces can differ through shared chassis velocity and load transfer. The original 40 N material contrast is retained within 16.7 ms, each intermediate force is bounded by its own supported contact, and driven tyres must report nonzero slip. The solver was not changed for this acceptance correction. The full local motocross suite passes, but this does not certify hardware handling or visuals.

## Next acceptance gates

1. Resolve failures without weakening physics, visual or browser acceptance assertions.
2. Exercise each discipline from the real menu through input, driving, pause/resume and exit/restart.
3. Publish only a reproducible build with an exact source identity; verify downloaded and deployed bytes.
4. Establish representative PC frame time, memory and loading budgets, then test on physical hardware.
5. Build a coherent offline product: onboarding, controller flow, progression, race feedback, recovery and presentation.
6. Obtain independent playtests and market evidence before judging commercial readiness.

## Engine direction and commercial target

Owner direction (2026-10-31): **Babylon.js becomes the main engine**, retaining the existing physics/simulation as a component. Migration is underway with a built `/babylon.html` entry and passing engine-boundary unit tests; see [Babylon migration](BABYLON_MIGRATION.md). Four real-browser integration journeys passed in run 41164885118, including the existing Formula model import, controls and lifecycle. Full authored-asset and four-discipline Babylon parity remain pending. Three.js stays available as the existing playable fallback until assets, all four disciplines, presentation and performance meet parity checks. Do not replace the playable game with unfinished diagnostic geometry or run competing render loops.

The owner's aspiration is US$10,000 profit. No technical test can guarantee sales or profit. Steam readiness requires product validation, packaging, asset rights, target-hardware QA and external demand evidence. This remains an in-development game, not a certified commercial release.
