# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44455572076
- commit: `7857ef1b6b` · Align release and Festival checks with repaired main
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-19T04:02:47Z · updated: 2026-11-19T05:36:52Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 11 |  |
| validate | success | 2 |  |
| offroad-scenarios | success | 10 |  |
| unit-tests | success | 29 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 12 |  |
| browser (6) | failure | 81 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/12 |
| browser (7) | failure | 74 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (11) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (2) | failure | 83 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/12 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (10) | failure | 86 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/12 |
| browser (9) | failure | 80 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/12 |
| browser (1) | failure | 66 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/12 |
| browser (12) | failure | 83 |  |
| browser (3) | failure | 47 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/12 |
| browser (5) | failure | 89 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (8) | failure | 79 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| publish | skipped | -1 |  |
