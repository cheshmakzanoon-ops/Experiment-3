# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45623759005
- commit: `c5016905c5` · Make record saves atomic and remove repeated runtime queue and snapshot work
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-25T13:27:23Z · updated: 2026-11-25T13:39:21Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 4 |  |
| unit-tests (4) | success | 9 |  |
| offroad-scenarios | success | 7 |  |
| scenarios | success | 8 |  |
| unit-tests (3) | failure | 7 | Complete unit-suite partition without source changes |
| unit-tests (1) | cancelled | 10 | Complete unit-suite partition without source changes |
| unit-tests (2) | cancelled | 7 | Complete unit-suite partition without source changes |
| wet-presentation | cancelled | 7 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa (4) | cancelled | 4 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | cancelled | 4 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | cancelled | 6 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (1) | cancelled | 1 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (1) | cancelled | 2 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/16 |
| browser (3) | cancelled | 6 |  |
| browser (7) | cancelled | 6 |  |
| browser (9) | cancelled | 6 |  |
| browser (5) | cancelled | 1 | Run npx playwright install --with-deps chromium |
| browser (2) | cancelled | 6 |  |
| browser (10) | cancelled | 6 |  |
| browser (6) | cancelled | 6 |  |
| browser (4) | cancelled | 6 |  |
| browser (11) | cancelled | 6 |  |
| browser (12) | cancelled | 6 |  |
| browser (8) | cancelled | 6 |  |
| browser (13) | cancelled | 6 |  |
| browser (14) | cancelled | 6 |  |
| browser (16) | cancelled | 6 |  |
| browser (15) | cancelled | 6 |  |
| publish | cancelled | 0 |  |
