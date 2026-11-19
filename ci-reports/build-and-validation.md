# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44467539917
- commit: `5942bef713` · Reject disoccluded temporal history with depth-aware reprojection
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T05:47:12Z · updated: 2026-11-19T06:05:42Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 11 |  |
| validate | success | 3 |  |
| offroad-scenarios | success | 8 |  |
| unit-tests | cancelled | 12 | Full unit suite without source changes |
| wet-presentation | cancelled | 6 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa | cancelled | 7 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (9) | cancelled | 5 | Run npx playwright install --with-deps chromium |
| browser (8) | cancelled | 1 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| browser (4) | cancelled | 7 |  |
| browser (7) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (11) | cancelled | 3 | Run npx playwright install --with-deps chromium |
| browser (6) | cancelled | 7 |  |
| browser (3) | cancelled | 7 |  |
| browser (10) | cancelled | 0 | Run npx playwright install --with-deps chromium |
| browser (1) | cancelled | 7 |  |
| browser (12) | cancelled | 7 |  |
| browser (5) | cancelled | 2 | Run npx playwright install --with-deps chromium |
| browser (2) | cancelled | 7 |  |
| publish | cancelled | 0 |  |
