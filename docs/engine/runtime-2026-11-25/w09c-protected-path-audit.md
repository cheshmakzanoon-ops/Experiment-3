# Wave 9C — protected source and concurrent history audit

Assignment **51/60**, wave **9** · 25 November 2026

## Conclusion

**The ten enumerated engine commits introduce no changes to protected models, characters, environments, rendering, shaders, motocross animation source, offroad simulation, authored vehicle definitions or tuning.** Their immediate-parent comparisons contain **18 distinct production files**, all within the intended engine scope. There are no renamed or deleted files in those ten changes.

The audited tip is [`0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a`][tip], tree `81c96acd7dd712b4865c04939ddf0b82773aede9`. It retains both named concurrent animation commits as ancestors. **Every one of the 19 files changed by those animation commits has the exact animation-commit blob at the audited tip.** This checks retained contents as well as retained history.

The [machine-readable audit manifest](w09c-protected-path-audit.json) records every audited commit and parent, changed path and resulting blob, protected identity set, complete ancestry chain and animation-file identity. This assignment changes only this report and that manifest. It creates no commit, branch or ref.

## Method and attribution

I independently fetched each engine commit from GitHub and compared it with its own immediate parent. The commit API requests explicitly allowed 100 files; the largest returned inventory contains 31, so no inventory reaches that page capacity. I inspected the complete paths, change statuses, previous-path fields and the production/test division.

I then checked Git tree identities independently of the changed-file lists. For each commit and parent, the audit resolves the root, `src` and `src/simulation` trees and compares protected entries by **object SHA, mode and type**. Matching tree objects cover every descendant, including binary content that does not have a textual patch. This produces **97 matching protected identities per commit, 970 equalities in total**.

The checked identities include all asset and authoring trees; rendering and shader trees; the main entry; all offroad, open-world, circuit-catalogue and vehicle-catalogue trees; and every simulation entry except the two expressly authorized optimization files, `surface-thermal.ts` and `track-lane-index.ts`. The exact identities are retained in the manifest. Unchanged identities are deduplicated into two sets: the concurrent rider-animation commit changes the rendering tree between sets, while each engine commit remains equal to its own parent.

A whole baseline-to-tip file diff would combine this session's engine work with the other contributor's legitimate animation changes. I used that comparison **only to establish the complete ancestry chain**, never to attribute its rendering changes to the engine work. The scope baseline is `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.

Sources: [GitHub parent-relative commit objects][commit-api], [Git tree objects][tree-api], [complete baseline-to-tip ancestry][ancestry].

## Commit-by-commit result

“Production files” in this table counts changed `src/` paths in that individual commit; the total distinct production set is 18.

| Engine commit | Immediate parent | Changed paths | Production files | Protected identities |
| --- | --- | ---: | ---: | --- |
| [`40bf6c7`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/40bf6c7ef42335b9ea20e5a99f2943f3873836c4) | `643f4ab` | 3 | 0 | 97 / 97 equal |
| [`c501690`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/c5016905c52da6b87aa400f00b841af7d948ab57) | `6484ff3` | 25 | 6 | 97 / 97 equal |
| [`acd525f`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/acd525fc148c1378c90cfb23dddee9dd53e4d52c) | `7045264` | 20 | 6 | 97 / 97 equal |
| [`04b7a6e`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/04b7a6e2516020fb971d5e42a2e33973033361b4) | `f8692b1` | 14 | 2 | 97 / 97 equal |
| [`b3b8ec0`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b3b8ec09183734287b71406f8894d07c91eb48c9) | `eb6da21` | 7 | 0 | 97 / 97 equal |
| [`c482ad9`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/c482ad9ce9fdef02660e4880a027d83326c840c4) | `ebd1e3f` | 31 | 2 | 97 / 97 equal |
| [`92e2dc2`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d) | `5bed115` | 11 | 1 | 97 / 97 equal |
| [`e2d1fec`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b) | `acafc35` | 23 | 3 | 97 / 97 equal |
| [`748814f`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/748814f648badd2e355c47c2f6ddc7321a0ed494) | `e2d1fec` | 16 | 0 | 97 / 97 equal |
| [`0bc9543`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a) | `7bf60e8` | 6 | 0 | 97 / 97 equal |

The ninth commit, `748814f`, has the immediately preceding engine checkpoint `e2d1fec` as its exact parent. It changes two existing test harnesses, adds the two native desktop recovery files, extends the workflow, and records reports/evidence. Its complete `src` tree is identical to its parent's.

The tenth commit, `0bc9543`, follows incoming CI-report commit `7bf60e8`, which is a child of `748814f`. I independently inspected that incoming diff: all six paths are under `ci-reports/`. The engine commit changes six paths: the native interval observer's single-assignment binding correction, the measurement report, two failure-evidence files, the ledger and checkpoints. It has no production changes and retains the complete protected identity set. The observer correction replaces a separately declared `let` and later assignment with a typed `const`; it does not change the production worker.

Across the ten commits there are **156 file-change entries and 128 distinct paths**. The entries consist of 100 additions and 56 modifications. No entry has a rename, removal or previous-path field.

| Distinct path category | Count |
| --- | ---: |
| Engine production source | 18 |
| Unit tests | 25 |
| Browser specifications and fixtures | 17 |
| Baseline probe scripts | 7 |
| Focused validation workflow | 1 |
| Reports, assignment ledger and retained evidence | 60 |
| **Total** | **128** |

The historical audio archive is a new test fixture under `e2e/fixtures/`; it does not write the archived modules back into production. The workflow and test additions do not add or regenerate model assets in these commit trees. This source audit is separate from proving what arbitrary future commands might generate.

## Actual production scope

The complete changed production set is small enough to enumerate:

| Area | Production paths |
| --- | --- |
| Audio and radio | `src/audio/driving-cues.ts`, `src/audio/engine.ts`, `src/core/radio.ts` |
| Controller ownership | `src/input/controller.ts` |
| Networking | `src/net/bytes.ts`, `src/net/codec.ts`, `src/net/event-loop.ts`, `src/net/input.ts`, `src/net/server.ts` |
| Session and records | `src/session/session-start-owner.ts`, `src/session/time-trial-records.ts` |
| Simulation efficiency | `src/simulation/surface-thermal.ts`, `src/simulation/track-lane-index.ts` |
| Persistence | `src/storage/data.ts`, `src/storage/desktop-mirror.ts`, `src/storage/leaderboard.ts` |
| Worker scheduling and diagnostics | `src/workers/diagnostics.ts`, `src/workers/physics.worker.ts` |

There are no production changes elsewhere in `src/` among these commits. In particular, none writes `src/main.ts`, `src/simulation/protocol.ts`, `src/simulation/wheel-contact-state.ts`, `src/simulation/offroad/**`, `src/rendering/**` or `src/shaders/**`.

The comparison also preserves complete `assets/`, `authoring/`, `public/` and related authored-content trees at every engine commit. Within simulation, all catalogue subtrees, vehicle/bike definitions, circuits, track construction, terrain, road-contact, pose-kinematics and other nonauthorized entries have identical parent/child objects. This is a content-identity result, not an inference from commit titles.

## Preservation of concurrent animation

The full comparison returns **27 commits, matching its reported total of 27**, with the baseline as merge base, 27 commits ahead and zero behind. All returned commits have one parent and form the continuous chain recorded in the manifest. All ten engine commits and both named animation commits occur in that chain.

| Concurrent commit | Position preserved in history | Changed files preserved at audited tip |
| --- | --- | ---: |
| [`ef503b28033760315eff29b1147f05d2ab426bcf`][animation-ef] | Direct child of the session baseline; ancestor of the first engine commit | 4 / 4 |
| [`e3ad320b1d54fb28db5a3d6b09b1faf7350a0ff2`][animation-e3] | Child of engine checkpoint `b3b8ec0`; ancestor of `c482ad9` and subsequent checkpoints | 15 / 15 |

The four preserved `ef503b2` paths are:

- `e2e/45-motocross-gameplay.spec.ts`
- `src/main.ts`
- `src/rendering/renderer.ts`
- `tests/startup.test.ts`

The fifteen preserved `e3ad320` paths include the rider, dirt-bike model, chase camera, hand brace, motocross mechanics/spine, crowd pass, spectators and stadium, together with its native course-landmark fixture and four motocross tests. The manifest gives each original and audited-tip blob side by side; all match.

Thus the other contributor's work is neither dropped from ancestry nor replaced with an earlier version at these paths. The engine snapshots include the same animation content they inherited.

The coordinator reports using expected-head, non-forced ref updates, including the ninth commit's successful lease against `e2d1fec`. Git object history independently establishes the preserved chain and contents. It cannot independently reconstruct every earlier API argument, rejected attempt or abandoned unreferenced object. This report does not treat those different kinds of evidence as interchangeable.

## Mixed diagnostics test: exact boundary

One existing file contains both circuit diagnostics and an `mx450` check:

[`tests/engine-diagnostics-backpressure.test.ts` at `c482ad9`][diagnostic-file].

I fetched the full 15,095-character parent file and the full 15,065-character child file. The parent-relative patch changes exactly three old lines to three new lines within the circuit flashback case:

- The case title describes rebasing inspection after the held acknowledgement.
- Acknowledging the held old ticket occurs after asserting that no new sample escaped while it was held.
- The assertion requires the resumed sample immediately after that acknowledgement, replacing a second explicit enable command.

Reversing only those exact edits reproduces the **entire parent file byte for byte as decoded text**. Every other byte, including the full case named “accepts the real mx450 dirt contacts at startup and after the first twelve physics ticks,” remains unchanged. No motocross assertion, fixture option or contact expectation was removed or altered. The exact patch and inverse-check result are included in the manifest.

The subsequent listed engine commits do not change this diagnostics file again. None of their named motocross fixtures or test paths appears in a parent-relative changed-file list. Generic engine-native audio/device tests do change, as listed in the manifest; those are engine ownership witnesses, not modifications to rider or environment assets.

## What this audit establishes—and what it does not

This assignment establishes source ownership and history preservation **through `0bc9543`**. It does not extend acceptance to unlisted later commits. Before a final handoff, later commits should receive the same immediate-parent path check; any later production or protected-content change needs renewed review.

No local execution was available or attempted. This is not a new ESLint, unit, compiler, browser or visual acceptance result. The coordinator's exact-source CI evidence remains responsible for runtime claims. In particular, unchanged animation blobs do not by themselves certify identical on-screen behavior under changes to shared engine timing or audio.

The reported inventory is derived from the ten explicitly supplied engine commits, not from authorship heuristics or every commit made on `main` that day. The final audited tip was observed as `main` during this review; another contributor can legitimately advance it afterward. The evidence therefore pins immutable commit and tree identities.

The audit found no protected-path blocker and no missing named animation content. No source correction was needed.

[tip]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a
[commit-api]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/commits/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a?per_page=100
[tree-api]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/git/trees/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a?recursive=1
[ancestry]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/compare/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc...0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a?per_page=100
[animation-ef]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/ef503b28033760315eff29b1147f05d2ab426bcf
[animation-e3]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e3ad320b1d54fb28db5a3d6b09b1faf7350a0ff2
[diagnostic-file]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c482ad9ce9fdef02660e4880a027d83326c840c4/tests/engine-diagnostics-backpressure.test.ts
