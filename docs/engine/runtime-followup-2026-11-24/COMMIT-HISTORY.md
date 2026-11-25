# Commit and source history

[Report index](README.md) · [Validation](VALIDATION.md)

The following identities come from coordinator records, read-only local Git metadata and worker59's independent remote verification. The recovered checkout is shallow at the task baseline/first checkpoint; the remote parent-chain review separately establishes the full checkpoint relationship and preservation of concurrent CI report commits. [Verification](reviews/w10e-publication-verification.md); [ancestry receipt](validation/w10e-ancestry-and-preservation.json).

## Baseline and programme checkpoints

Task baseline: [`1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb), tree `9be30d69c06ac08f9eec038334ad0f8bbd65b13b`, committed 24 November 2026, 21:26:48 UTC. Its subject is a CI report update; the baseline comparison uses its complete source tree.

All programme times below are normalized to **25 November 2026 UTC** from the actual committer timestamps.

| Checkpoint | UTC time | Actual commit | Subject and scope |
| ---: | --- | --- | --- |
| 1 | 01:01:04 | [`85ae215329ee1bd1ccc66540cece0cda72d197f7`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/85ae215329ee1bd1ccc66540cece0cda72d197f7) | Fix engine rewind clocks, bounded ghosts and discrete network input. First recording/input/host corrections and regressions. |
| 2 | 01:17:35 | [`5185010e6538d8a9095aca9c4e7964817147e1a1`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/5185010e6538d8a9095aca9c4e7964817147e1a1) | Share network snapshots and preserve controller edge ordering. Completes the early server/controller implementation. |
| 3 | 01:54:49 | [`25a837597de0159a32e2e5d8bad2e9ac74977c22`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/25a837597de0159a32e2e5d8bad2e9ac74977c22) | Reduce engine allocations and close texture, GPU and audio lifetimes. Wave 3. |
| 4 | 02:35:16 | [`f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6) | Bound worker channels and harden engine session and replay ownership. Waves 4–5; principal Wave 7 measurement candidate. |
| 5 | 03:05:46 | [`0f7fecfda61ea7e669f04eebd138c52543144421`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/0f7fecfda61ea7e669f04eebd138c52543144421) | Verify native engine ownership and retain focused runtime gates. Native tests/workflow/evidence; production source unchanged from 4. |
| 6 | 03:36:30 | [`6314ba3ec7d54a0ba1e79a59b8db8f03117e4520`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/6314ba3ec7d54a0ba1e79a59b8db8f03117e4520) | Measure engine kernels and retain exact-output performance evidence. Measurement scripts/raw reports; production source unchanged from 4/5. |
| 7 | 04:06:33 | [`6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c) | Harden engine callback ownership and reduce CSV export memory. Wave 8 reviews/fixes and constructor-domain correction; final production implementation. |
| 8 | 04:26:28 | [`811ac2bc92f4494b1ec99d1fc4201101ccf34c66`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/811ac2bc92f4494b1ec99d1fc4201101ccf34c66) | Verify renderer ownership fixtures and terminal worker recovery. Three test fixtures and focused workflow only; production unchanged. |
| 9 | 04:35:34 | [`9119c7683d821d145f15ed64a03ee3406595b58d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/9119c7683d821d145f15ed64a03ee3406595b58d) | Retain surface rebase coverage across terminal worker failure. Surface-channel test and focused workflow only; production unchanged. |

Checkpoint 9's actual parent is `ec7f7ce0dc4361d27aa0ae141f7ca216d4c261e6`, preserving the concurrent report history. The programme-owned checkpoint-9 delta is two paths, 91 additions / one deletion. Those line counts describe fixture/workflow changes, not production implementation.

## Exact tree identities

| Checkpoint | Git tree |
| ---: | --- |
| 1 | `f0bfcb614006d98d6c8241c8578decf3b323c5fd` |
| 2 | `a0b7a4446dc9f8b477f9d7a34443d044ca560df7` |
| 3 | `40dc98ab64f8b348992e285cd5ec060f0a78596b` |
| 4 | `98ae35c4ec253987e6897ebc13a55dee2c1afb21` |
| 5 | `831bde9df0759e078ae26c8ca289b1da116bb0ad` |
| 6 | `18766f8bf4dbfed1bcec2d2917d760df535f94c8` |
| 7 | `e6d37727eb695278c4934fa11365d6d014c40db6` |
| 8 | `bcb8ac50d931448e1d321f76d5fbb092c89d1cf1` |
| 9 | `3b704f846c3283c21e73f8f5c3febf670a773c63` |

Full-tree identities differ when tests, reports or workflow files change even if production source does not. The final 128-file gate explicitly checked all 1,116 src files against checkpoint 7. [Final result/source manifest summary](validation/w09a-final-results.json).

## Measurements versus final production

Wave 7 benchmarks pin baseline `1c609bf` and candidate `f4d41b0`; checkpoints 5/6 add evidence without changing that production graph. Their timings are not silently relabeled as newly run checkpoint-9 timings.

The final BVH, road-contact and vehicle implementations match the measured candidate. Contact construction adds the later positive-integer guard; the old constructor timing does not separately measure that guard. Later server/resource callback fixes are documented in Wave 8. The CSV measurement uses the exact later schema source identified in its own manifest. [Measurement provenance](WAVE-07.md); [final numeric/source audit](reviews/w08f-physics.md); [CSV manifest](measurements/w08c-csv-memory-manifest.json).

## Concurrent reports and publication limits

The checkpoint-7 scope audit distinguishes 31 changed `ci-reports` paths written by `ci-report[bot]` from 164 programme-owned changed paths. Existing broad workflows and content checks are unchanged. Those bot reports are evidence/history, not engine edits. The later checkpoint comparisons include more concurrent report updates, so the checkpoint-7 path count is not a final-current inventory.

The original protected-content audit covers all seven then-named programme checkpoints and eighteen locally reachable first-parent trees, with shallow-history limits. Later endpoint and remote continuity reviews extend the unchanged authored-content/production identities through checkpoint 9. Checkpoints 7/8/9 and the inspected remote main share src tree `ad28ec3acb55feb301e13232614a14c4230abcae`, containing 1,116 tracked leaves. [Final source/fixture continuity](validation/w10e-source-and-fixture-continuity.json).

At **05:06:13 UTC**, worker59 observed remote main at `350119e8ec0606e8c5de5b3ab80df41104025679`, tree `2224939844137abcd06d1aed0d9618f74e05dc18`, a report-only child of checkpoint 9. The verified remote chain contains 26 parent edges back to the task baseline, including all nine programme checkpoints and 17 report-bot updates. Each programme checkpoint retained its actual parent's ci-reports tree. This is a dated remote observation, not a claim that main can never advance. [Commit summary](validation/w10e-commit-summary.json); [main snapshot](validation/w10e-main-close-snapshot.json); [ancestry and preservation](validation/w10e-ancestry-and-preservation.json).

## Documentation publication

The code/test revision that produced the final unit, build, local native and published focused-CI evidence remains **checkpoint 9**, `9119c7683d821d145f15ed64a03ee3406595b58d`, root tree `3b704f846c3283c21e73f8f5c3febf670a773c63`. Worker59 independently downloaded and SHA-256 verified that exact revision's artifact. [Artifact inspection](reviews/w10e-publication-verification.md); [receipt](validation/w10e-artifact-archive-manifest.json).

The revision carrying this final report is a **documentation/evidence-only update**, identifiable by its actual commit and tree in Git history. It does not change the tested source, tests, scripts, configuration or workflows, and its complete tree is distinct from the tree that generated the validated build. The publication commit has not yet been created; this report does not embed a future hash.

After the coordinator publishes the update while preserving concurrent report work, the **same worker59** will verify the actual remote commit/tree, parent inclusion, main relationship and unchanged executable inputs. Its subsequent receipt and final delivery identify that publication; the completed checkpoint-9 inspection does not pre-certify it. Resuming this worker does not add a sixty-first assignment. [Completed assignment ledger](TASKS.md); [evidence index](EVIDENCE.md); [validation matrix](VALIDATION.md).
