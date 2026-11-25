# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45557220333
- commit: `6c96144dad` · Prevent cross-mode startup races and smooth remote presentation clocks
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-25T05:58:24Z · updated: 2026-11-25T06:09:32Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 3 |  |
| unit-tests (3) | cancelled | 10 | Complete unit-suite partition without source changes |
| offroad-scenarios | success | 6 |  |
| scenarios | cancelled | 10 | Run node --experimental-transform-types scripts/race-classification.ts |
| unit-tests (1) | cancelled | 10 | Complete unit-suite partition without source changes |
| unit-tests (4) | success | 8 |  |
| unit-tests (2) | cancelled | 10 | Complete unit-suite partition without source changes |
| wet-presentation | cancelled | 7 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa (4) | cancelled | 6 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | cancelled | 5 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (1) | cancelled | 7 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | cancelled | 4 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (8) | cancelled | 1 | Download tested build (attempt 1 of 3) |
| browser (7) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/16 |
| browser (6) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (13) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 13/16 |
| browser (16) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 16/16 |
| browser (5) | cancelled | 6 |  |
| browser (12) | cancelled | 6 |  |
| browser (10) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/16 |
| browser (4) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/16 |
| browser (11) | cancelled | 6 |  |
| browser (3) | cancelled | 6 |  |
| browser (1) | cancelled | 6 |  |
| browser (9) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/16 |
| browser (2) | cancelled | 6 |  |
| browser (14) | cancelled | 6 |  |
| browser (15) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 15/16 |
| publish | cancelled | 0 |  |
