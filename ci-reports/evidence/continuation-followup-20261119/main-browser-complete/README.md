# Original main browser CI audit

Source `ffd22598335dfa2a074ebd466e1d53830bb8bb41`; [run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580). Latest observation: 2026-11-19T22:44:30.004Z.

**Complete:** all 353 ordinary cases have results (268 passed, 73 failed, 12 skipped), as do all 42 owner cases (29 passed, 13 failed, 0 skipped). Every job retains its full original runner summary, with zero missing, extra or duplicate inventory cases.

Terminal logs are complete and losslessly compressed. Pending jobs have no result inferred. Owner QA uses its separate build.

| Job | Status | Conclusion | Expected | Passed | Failed | Skipped | Complete summary |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| browser (1) | completed | failure | 22 | 15 | 5 | 2 | yes |
| browser (2) | completed | failure | 21 | 16 | 5 | 0 | yes |
| browser (3) | completed | failure | 21 | 17 | 3 | 1 | yes |
| browser (4) | completed | failure | 23 | 18 | 4 | 1 | yes |
| browser (5) | completed | failure | 22 | 17 | 4 | 1 | yes |
| browser (6) | completed | failure | 23 | 18 | 3 | 2 | yes |
| browser (7) | completed | failure | 22 | 16 | 4 | 2 | yes |
| browser (8) | completed | failure | 22 | 19 | 3 | 0 | yes |
| browser (9) | completed | failure | 22 | 17 | 5 | 0 | yes |
| browser (10) | completed | failure | 22 | 15 | 6 | 1 | yes |
| browser (11) | completed | failure | 22 | 17 | 5 | 0 | yes |
| browser (12) | completed | failure | 22 | 15 | 7 | 0 | yes |
| browser (13) | completed | failure | 22 | 17 | 4 | 1 | yes |
| browser (14) | completed | failure | 22 | 19 | 3 | 0 | yes |
| browser (15) | completed | failure | 23 | 18 | 5 | 0 | yes |
| browser (16) | completed | failure | 22 | 14 | 7 | 1 | yes |
| owner-qa (1) | completed | failure | 11 | 8 | 3 | 0 | yes |
| owner-qa (2) | completed | failure | 11 | 8 | 3 | 0 | yes |
| owner-qa (3) | completed | failure | 10 | 5 | 5 | 0 | yes |
| owner-qa (4) | completed | failure | 10 | 8 | 2 | 0 | yes |

Each completed case is matched by exact file/title to the committed Playwright partition inventory, with its inventory ID retained in summary.json. Final test-runner counts are cross-checked against completed-case lines. Exact failure messages and assertion excerpts are preserved in summary.json; full logs include all setup and artifact-upload output.

Reproduce this report by running `python3 reproduce-browser-audit.py`. This parses retained evidence only; it does not execute tests.

## Original GP reference hash failure

The final assertion compares two separately constructed high-detail dry gpr1 captures. The earlier same-instance wet/held/rewind assertions completed before this failure. The original verified artifact supplies all six metrics, the two dry PNGs and the full failing-case record in `fresh-dry-capture/`.

The original images differ at exactly four of 1,024,000 pixels, with maximum channel difference one (bounding box x 644–647, y 253–255). No pixel differs by more than one channel level. The two metrics objects differ only in instance UUID and pixel hash. This narrow result does not clear the original exact-hash assertion, identify its graphics cause, or justify changing its tolerance. The original failure remains recorded.
