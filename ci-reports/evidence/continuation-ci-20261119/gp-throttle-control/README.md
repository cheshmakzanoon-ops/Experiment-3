# Baseline-only GP throttle ownership control

**Completed: three native baseline failures become three passes, the original wet Poggio case passes, and the original mixed-class pace case still fails. The candidate is not accepted or integrated.** This is the exact previously missing baseline-only control, not another composition of rejected physics patches.

## Exact source scope

The detached source begins at `a1e2e385251b94f7cc82e123440a0a4c72611d63`. It changes only `src/simulation/bike-ai.ts` and adds the three-case focused fixture `tests/gp-steering-throttle-ownership.test.ts`. All other 930 production files and all four original race/planner test files remain byte-identical to the baseline. Source and original-test hashes are retained in the full whitelist manifests.

The existing steering intent already contains the signed sum of path feed-forward and tracking correction, encoded using actual normal reaction. The candidate decodes that same combined demand once for the throttle reserve. It removes no physical contact/TC/ABS protection and adds no gains, grip, lane geometry, passing rule, force/history predictor or timing change. The physical Bike and MotoGP modules retain baseline hashes 5bf7c590 and f4323615; candidate bike-ai is ffc70ab74e818298535eea6c48375df8cd3a5b30ba4ad776370a358eb3358c7d.

## Actual results

| Invocation | Actual exit | Result |
| --- | ---: | --- |
| Baseline native ownership | 1 | All 3 cases fail as intended: both mirrored decomposition controls and normal-reaction decoding |
| Candidate native ownership | 0 | All 3 unchanged cases pass |
| Original mixed GP/SBK seed3303 | 1 | Pace fails: GP 91.4372396579149 s versus SBK 90.3703801553851 s |
| Original wet Poggio seed30101 | 0 | Passes every original zero-impact, zero-crash, classification, penalty and finite-frame assertion |

The mixed race passes its preceding classification, incident-bound and stopped-rider assertions, then fails the original GP-fastest-lap assertion. Its 0.15 s advantage assertion is consequently not reached. The wet test completes within its original 120-second deadline, with 98.45 s reported test time and 102.23 s guarded wall time. Neither run changed its test source or deadline.

All four guarded processes completed; all 7,459 protected inputs stayed unchanged within each invocation. The candidate native and both candidate-race manifests are byte-identical and stored once with an explicit deduplication map in summary.json. The baseline's different manifest is separate. The baseline's expected negative remains a real exit 1 in its original receipt; it is never relabelled as a passing invocation.

The fixture is the first three-case describe block and helpers from the already-existing gp-control-demand-ownership fixture. Only imports needed solely by omitted physical-control sections were removed. Its original source, hash, extraction description and unchanged test-body provenance are retained. This avoids treating the broader history candidate's native success as evidence on the baseline-only composition.

## Evidence and reproduction

Original JSON receipts are verbatim. Logs, full protected-input manifests, source whitelists, production patch, focused fixture and external runner are losslessly gzip-compressed. copy-provenance.json records original and payload sizes/hashes; every decompressed payload was byte-compared with its original. Run `sha256sum -c SHA256SUMS` here to verify stored files.

For source restoration in a disposable checkout at the base commit, decompress and apply reproduction/candidate-production.patch.gz and restore the focused fixture under tests/. The original race files remain unchanged. The retained runner documents the actual external-output source guard; no rerun is required merely to inspect these results.

**Limit:** one of two selected original race gates still fails. There was no original 51 run, full unit suite, calibration, matrix, browser, type/lint pass, integration or publication for this candidate. All processes have stopped. Further source changes or races require the coordinator's next explicit task; the broader rejected sources remain untouched.
