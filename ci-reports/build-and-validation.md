# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580
- commit: `ffd2259833` · Complete CI coverage and correct three retained browser fixtures
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-19T21:16:38Z · updated: 2026-11-19T22:44:21Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 9 |  |
| offroad-scenarios | success | 16 |  |
| unit-tests (1) | success | 10 |  |
| unit-tests (4) | success | 9 |  |
| unit-tests (2) | failure | 16 | Complete unit-suite partition without source changes |
| validate | success | 2 |  |
| unit-tests (3) | failure | 7 | Complete unit-suite partition without source changes |
| wet-presentation | success | 12 |  |
| owner-qa (4) | failure | 35 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | failure | 46 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (1) | failure | 35 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | failure | 63 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (12) | failure | 68 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/16 |
| browser (1) | failure | 69 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/16 |
| browser (5) | failure | 84 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/16 |
| browser (7) | failure | 55 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/16 |
| browser (10) | failure | 63 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/16 |
| browser (9) | failure | 60 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/16 |
| browser (4) | failure | 66 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/16 |
| browser (14) | failure | 40 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 14/16 |
| browser (11) | failure | 54 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/16 |
| browser (16) | failure | 60 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 16/16 |
| browser (15) | failure | 51 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 15/16 |
| browser (6) | failure | 57 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (2) | failure | 59 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/16 |
| browser (13) | failure | 56 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 13/16 |
| browser (3) | failure | 62 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/16 |
| browser (8) | failure | 52 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/16 |
| publish | skipped | -1 |  |
