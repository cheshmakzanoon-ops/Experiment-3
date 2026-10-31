# Current development status

Updated 2026-10-31. This page separates source integration from successful validation and release readiness.

## Consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, retaining 53 MotoGP development commits without dropping history. See [branch receipt](maintenance/branch-consolidation-2026-10-31.json). Remote cleanup completed successfully in [run 41160579689](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41160579689). A subsequent remote listing contains only `main`.

## Validation in progress

- Lint passed locally on the consolidated source.
- TypeScript and the production build passed locally. The build reports a large application chunk (about 14.6 MB minified / 4.5 MB gzip), a loading/performance risk to investigate.
- Full unit tests are still running. No all-green claim yet.
- Formula, GP motorcycles, motocross/supercross and festival must each pass actual browser journeys. Menu presence alone does not prove playability.
- Latest downloadable release remains `playable-3a6036de` (2026-10-06). It is not the latest source.
- Pages build passed, but deployment failed: the workflow token cannot create the Pages site. The repository owner must select **Settings → Pages → Source → GitHub Actions** before deployment can succeed.
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
