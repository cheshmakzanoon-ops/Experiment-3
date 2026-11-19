# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707
- commit: `d8d87c73a8` · Publish reviewed continuation a1e2e38
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T15:17:06Z · updated: 2026-11-19T16:52:24Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| unit-tests | cancelled | 45 | Full unit suite without source changes |
| validate | success | 3 |  |
| scenarios | success | 16 |  |
| offroad-scenarios | success | 7 |  |
| wet-presentation | success | 12 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (3) | failure | 79 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/12 |
| browser (9) | failure | 81 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/12 |
| browser (7) | failure | 76 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (4) | failure | 71 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (1) | failure | 88 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/12 |
| browser (10) | failure | 72 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/12 |
| browser (12) | failure | 54 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/12 |
| browser (8) | failure | 77 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| browser (5) | failure | 72 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (11) | failure | 73 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/12 |
| browser (6) | failure | 82 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/12 |
| publish | skipped | -1 |  |
