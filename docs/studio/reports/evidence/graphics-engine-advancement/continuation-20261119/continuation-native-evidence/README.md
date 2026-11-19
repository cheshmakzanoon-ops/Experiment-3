# Continuation native evidence

This package preserves existing evidence from the 2026-11-19 continuation. **It does not accept a candidate for release.** Native geometry and ownership checks are deliberately separated from original race gates. Several candidates passed narrow native checks and subsequently failed the original races; their receipts are retained without rewriting that history.

No application test or race was run while staging this package. Original receipts, logs, patches, and probes are byte-for-byte copies. The publication-motion sample projection and arithmetic replay are derived from the existing trace; they run no simulation. The full trace and all candidate trees remain outside this package. Startup and High-rendering evidence already committed in the repository is not duplicated.

## Index and integrity

`index.json` maps every payload file to its original path, SHA-256, size, evidence group, and exact candidate/source attribution. It also records historical source hashes from the receipts. Candidate directories are historical locations, not portable source bundles. `SHA256SUMS` covers every package file except itself, including `index.json`.

Verify copied-file integrity from this directory:

```sh
sha256sum -c SHA256SUMS
```

## Evidence groups

| Directory | Evidence | Acceptance limit |
| --- | --- | --- |
| `following-horizon/` | Native current-follow versus prospective-pass horizon proof, six-case positive and negative controls | Mechanism proof only; dual-horizon candidate failed later original races |
| `selected-path-lifecycle/` | Nine cases for unclipped intent, existing local clamp, capture order, handback and invalidation | Selected-path candidate failed later original races |
| `publication-motion/` | Existing onset review plus compact 480-sample projection and arithmetic replay | Spatial movement and clipped preview deltas cannot be treated as temporal lane velocity; not a full fall attribution |
| `relative-pit-cancellation/` | Desired-offset consumer review and real-planner pit-cancel positive/negative test | Transition fix proven; relative-intent original triad rejected |
| `admission-only-control/` | Pure history plus existing 220 m admission correction; original Montejaral 5111 passed | One causal control, not complete candidate acceptance |
| `geometry-only-controls/` | Original Vellamar 5222 and mixed 3303 gates | Both fail: one fall; GP best 2.44077508 s slower than SBK |
| `wet-path/` | Independent geometry, width1 compatibility, targeted wet race, source manifest, patch and logs | Wet-path correction only; no dry-pace rescue claim |
| `snapshot-width/` | Real native wet↔dry passing-profile snapshot regression | Two positive passes and two intended negative failures; no race claim |

The wet-path and snapshot-width test code was committed in 4c9b858, but the associated evidence receipts/probes were not tracked; they are included here. Initial test-fixture/setup failures remain included and are explained by their original receipts. They are not application failures.

## Reproducing small probes

Run the following against the exact source identified in `index.json`, with the repository's installed Node dependencies. Use a fresh output path so historical evidence is not overwritten. These commands are documentation; packaging did not execute them.

```sh
node --experimental-transform-types following-horizon/gp-runway-consumer-proof.mjs /absolute/source/path /absolute/new-output.json
node --experimental-transform-types wet-path/gp-scaled-path-geometry.mjs /absolute/source/path /absolute/new-output.json
python publication-motion/replay-publication-motion.py
```

For a native test draft, place it in `tests/` of a **separate source checkout or disposable harness** of the attributed source; preserve its `../src` imports, use that source's `vitest.config.ts`, and copy the real `scripts/source-stability.ts` entry point. Then run:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/TEST_NAME.test.ts
```

Do not put a draft into a candidate while a source guard is running. If a harness uses a source-directory symlink, independently hash the real source before and after: the guard protects the link itself, not its contents. The included receipts record those underlying source hashes for the native harness checks.

Original race commands and exact filters are preserved in the admission and geometry receipts. Reproducing them is optional separate work, not part of this evidence-staging task. The geometry runner's two failures and the admission control's one pass must not be combined into an invented overall pass.

## Publication-motion projection

`native-rider-samples.json` keeps all 480 recorded frames of the observed rider and only the fields needed for the original rate calculations, without interpolation or numerical rounding. It records the full original trace's SHA-256, original path and size, candidate source hashes, and scenario options. The replay uses actual timestamp differences. Its 1.6 m/s count criterion merely summarizes recorded intervals; it changes no controller or acceptance threshold.

All absolute paths inside copied receipts remain historical evidence. Use the package-relative locations listed in `index.json` to locate their copies here. No source acceptance or publication is implied by this package.
