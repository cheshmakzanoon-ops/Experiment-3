# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44492180743
- commit: `414c9ac352` · Guard retired GPU preparation and stabilize road-bike contact control
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T08:58:31Z · updated: 2026-11-19T09:17:40Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 17 |  |
| offroad-scenarios | success | 8 |  |
| validate | success | 2 |  |
| unit-tests | cancelled | 18 | Full unit suite without source changes |
| owner-qa | cancelled | 13 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | cancelled | 13 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| browser (4) | cancelled | 12 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (6) | cancelled | 6 | Install Mesa software graphics and virtual display |
| browser (5) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (7) | cancelled | 13 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (10) | cancelled | 12 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/12 |
| browser (12) | cancelled | 8 | Run npx playwright install --with-deps chromium |
| browser (8) | cancelled | 13 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| browser (1) | cancelled | 10 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/12 |
| browser (3) | cancelled | 10 | Install Mesa software graphics and virtual display |
| browser (11) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (9) | cancelled | 9 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/12 |
| browser (2) | cancelled | 11 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/12 |
| publish | cancelled | -1 |  |
