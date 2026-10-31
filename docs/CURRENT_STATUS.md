# Current development status

Updated 2026-10-31. This page separates source integration from successful validation and release readiness.

## Consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, retaining 53 MotoGP development commits without dropping history. See [branch receipt](maintenance/branch-consolidation-2026-10-31.json). Remote branch cleanup is separately verified by the main-only maintenance workflow.

## Validation in progress

- Lint passed locally on the consolidated source.
- TypeScript and the production build passed locally. The build reports a large application chunk (about 14.6 MB minified / 4.5 MB gzip), a loading/performance risk to investigate.
- Full unit tests are still running. No all-green claim yet.
- Formula, GP motorcycles, motocross/supercross and festival must each pass actual browser journeys. Menu presence alone does not prove playability.
- Latest source is not automatically the latest validated release. Inspect the release source identity and CI before claiming equivalence.

## Next acceptance gates

1. Resolve failures without weakening physics, visual or browser acceptance assertions.
2. Exercise each discipline from the real menu through input, driving, pause/resume and exit/restart.
3. Publish only a reproducible build with an exact source identity; verify downloaded and deployed bytes.
4. Establish representative PC frame time, memory and loading budgets, then test on physical hardware.
5. Build a coherent offline product: onboarding, controller flow, progression, race feedback, recovery and presentation.
6. Obtain independent playtests and market evidence before judging commercial readiness.

## Engine direction and commercial target

Three.js and the existing physics engine remain authoritative. A Babylon.js integration is a proposal, not an installed dependency or an automatic rewrite. First prove a specific benefit in an isolated adapter experiment with matching simulation snapshots, asset fidelity and performance; do not run competing rendering loops in production.

The owner's aspiration is US$10,000 profit. No technical test can guarantee sales or profit. Steam readiness requires product validation, packaging, asset rights, target-hardware QA and external demand evidence. This remains an in-development game, not a certified commercial release.
