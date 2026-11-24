# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45394144233
- commit: `09fd6d2637` · engine: unify Festival scheduling and protect input and recording ownership
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-24T12:30:21Z · updated: 2026-11-24T12:45:14Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 11 |  |
| unit-tests (4) | success | 11 |  |
| unit-tests (2) | success | 11 |  |
| unit-tests (3) | failure | 7 | Complete unit-suite partition without source changes |
| offroad-scenarios | success | 7 |  |
| unit-tests (1) | failure | 11 | Complete unit-suite partition without source changes |
| validate | success | 3 |  |
| owner-qa (4) | cancelled | 11 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | cancelled | 11 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa (1) | cancelled | 11 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | cancelled | 11 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | cancelled | 11 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (4) | cancelled | 11 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/16 |
| browser (8) | cancelled | 2 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/16 |
| browser (11) | cancelled | 7 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/16 |
| browser (5) | cancelled | 9 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/16 |
| browser (3) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/16 |
| browser (9) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/16 |
| browser (2) | cancelled | 10 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/16 |
| browser (7) | cancelled | 10 |  |
| browser (1) | cancelled | 10 |  |
| browser (16) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 16/16 |
| browser (6) | cancelled | 2 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (10) | cancelled | 10 |  |
| browser (12) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/16 |
| browser (14) | cancelled | 10 |  |
| browser (15) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 15/16 |
| browser (13) | cancelled | 10 |  |
| publish | cancelled | 0 |  |
