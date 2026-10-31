# Current development status

Updated 2026-10-31. This page separates source integration from successful validation and release readiness.

## Consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, retaining 53 MotoGP development commits without dropping history. See [branch receipt](maintenance/branch-consolidation-2026-10-31.json). Remote cleanup completed successfully in [run 41160579689](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41160579689). A subsequent remote listing contains only `main`.

## Validation in progress

- Lint passed locally on the consolidated source.
- TypeScript and the production build passed locally. The build reports a large application chunk (about 14.6 MB minified / 4.5 MB gzip), a loading/performance risk to investigate.
- Full unit tests are still running. More than 2,900 cases have been exercised; GP passing/mixed-class pace and multiple motocross contact/collision regressions remain. No all-green claim.
- A GP planner repair accounts for finite brake-lever application time. Wet-contact steering recovery is grip-aware without changing the dry controller; all three two-lap GP contact-race cases and the braking approach suite pass in the focused candidate run.
- Formula, GP motorcycles, motocross/supercross and festival must each pass actual browser journeys. Menu presence alone does not prove playability.
- Latest downloadable release remains `playable-3a6036de` (2026-10-06). It is not the latest source.
- Pages is enabled and deployment [41161818741](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41161818741) succeeded. The live site returned HTTP 200 and `BUILD_IDENTITY.json` identified `eebb4ec847e8e99b669994817a3bd7ec95769f51` when checked. Later commits require their own deployment verification.
- New direct Formula / GP / Open World shortcuts have compatible-session unit tests. Their browser switching checks remain pending.
- The motocross airborne limiter regression now passes without clamping existing overspeed momentum. Five wheel-pickup suite failures reproduce with and without the fix; these remain open.

## Next acceptance gates

1. Resolve failures without weakening physics, visual or browser acceptance assertions.
2. Exercise each discipline from the real menu through input, driving, pause/resume and exit/restart.
3. Publish only a reproducible build with an exact source identity; verify downloaded and deployed bytes.
4. Establish representative PC frame time, memory and loading budgets, then test on physical hardware.
5. Build a coherent offline product: onboarding, controller flow, progression, race feedback, recovery and presentation.
6. Obtain independent playtests and market evidence before judging commercial readiness.

## Engine direction and commercial target

Owner direction (2026-10-31): **Babylon.js becomes the main engine**, retaining the existing physics/simulation as a component. Migration is underway with a built `/babylon.html` entry and four passing engine-boundary unit tests; see [Babylon migration](BABYLON_MIGRATION.md). Browser and authored-asset parity remain pending. Three.js stays available as the existing playable fallback until assets, all four disciplines, presentation and performance meet parity checks. Do not replace the playable game with unfinished diagnostic geometry or run competing render loops.

The owner's aspiration is US$10,000 profit. No technical test can guarantee sales or profit. Steam readiness requires product validation, packaging, asset rights, target-hardware QA and external demand evidence. This remains an in-development game, not a certified commercial release.
