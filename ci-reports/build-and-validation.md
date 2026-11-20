# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44799542817
- commit: `fd084f77fb` · Record measured motocross race outcomes and the outstanding High GPU failure
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-20T19:09:46Z · updated: 2026-11-20T19:30:23Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| unit-tests (3) | success | 8 |  |
| unit-tests (4) | failure | 8 | Complete unit-suite partition without source changes |
| scenarios | cancelled | 13 | Run node --experimental-transform-types scripts/vellamar-race.ts clear,changeable |
| offroad-scenarios | failure | 5 | Full offroad calibrations and races without source changes |
| unit-tests (1) | success | 10 |  |
| unit-tests (2) | cancelled | 8 | Complete unit-suite partition without source changes |
| validate | success | 3 |  |
| wet-presentation | cancelled | 2 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa (2) | cancelled | 5 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | cancelled | 4 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (4) | cancelled | 5 |  |
| owner-qa (1) | cancelled | 5 |  |
| browser (6) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (7) | cancelled | 5 |  |
| browser (12) | cancelled | 5 |  |
| browser (2) | cancelled | 5 |  |
| browser (15) | cancelled | 5 |  |
| browser (8) | cancelled | 5 |  |
| browser (9) | cancelled | 5 |  |
| browser (3) | cancelled | 5 |  |
| browser (14) | cancelled | 5 |  |
| browser (16) | cancelled | 5 |  |
| browser (4) | cancelled | 5 |  |
| browser (13) | cancelled | 5 |  |
| browser (11) | cancelled | 5 |  |
| browser (10) | cancelled | 5 |  |
| browser (1) | cancelled | 5 |  |
| browser (5) | cancelled | 5 |  |
| publish | cancelled | 0 |  |
