# Excluded wet-race result: source changed during execution

The original rainy Poggio case started against local candidate `52ce46448a1048bafb7f5c59b35ea8df61dd3806` at 21:36:06 UTC and ended at 21:37:40 UTC on 19 November 2026. Although the test child returned zero, the guard detected changes in `src/simulation/bike-ai.ts` and `tests/gp-steering-throttle-ownership.test.ts`. The guard correctly records `sourceStable: false` and `passed: false`.

**This result is invalid and must not be counted as a pass for either source.** The receipt, full log and compressed original protected-input manifest are retained here. The preserved source patch and new test later exactly matched the observed concurrent commit `7ac509f9198ae5d5b06c9a17edd2177caa799115`; `unknown-throttle-commit.json` records that content comparison. The commit author's generic identity does not identify which process wrote the files.

The active continuation preserved the old worktree and continued subsequent experiments in separate worktrees. No reverting, force update or acceptance claim was based on this run. `SHA256SUMS` covers the six original evidence inputs; it excludes itself and this later README.
