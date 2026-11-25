# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45700444387
- commit: `2578271913` · docs(engine): publish sixty-agent motocross validation and handoff
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-25T21:01:22Z · updated: 2026-11-25T22:25:02Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 3 |  |
| scenarios | success | 7 |  |
| offroad-scenarios | failure | 6 | Full offroad calibrations and races without source changes |
| unit-tests (1) | failure | 9 | Complete unit-suite partition without source changes |
| unit-tests (4) | success | 9 |  |
| unit-tests (3) | failure | 9 | Complete unit-suite partition without source changes |
| unit-tests (2) | success | 19 |  |
| wet-presentation | success | 6 |  |
| owner-qa (4) | failure | 35 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | failure | 61 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | failure | 47 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (1) | failure | 39 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (6) | failure | 67 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (8) | failure | 67 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/16 |
| browser (3) | failure | 64 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/16 |
| browser (4) | failure | 73 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/16 |
| browser (9) | failure | 63 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/16 |
| browser (7) | failure | 73 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/16 |
| browser (12) | failure | 65 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/16 |
| browser (1) | failure | 38 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/16 |
| browser (14) | failure | 49 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 14/16 |
| browser (16) | failure | 53 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 16/16 |
| browser (13) | failure | 53 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 13/16 |
| browser (15) | failure | 58 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 15/16 |
| browser (11) | failure | 46 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/16 |
| browser (5) | failure | 66 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/16 |
| browser (10) | failure | 54 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/16 |
| browser (2) | failure | 69 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/16 |
| publish | skipped | -1 |  |
