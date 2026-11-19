# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44488934042
- commit: `f1068433d4` · Preserve Vellamar road-grade continuity and correct shadow and acceptance contracts
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T08:35:45Z · updated: 2026-11-19T08:58:52Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 11 |  |
| offroad-scenarios | success | 9 |  |
| validate | success | 2 |  |
| unit-tests | cancelled | 19 | Full unit suite without source changes |
| wet-presentation | cancelled | 8 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| browser (2) | cancelled | 11 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/12 |
| browser (10) | cancelled | 7 | Run npx playwright install --with-deps chromium |
| browser (4) | cancelled | 15 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (11) | cancelled | 17 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (6) | cancelled | 9 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/12 |
| browser (5) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (3) | cancelled | 8 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/12 |
| browser (8) | cancelled | 9 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| owner-qa | cancelled | 16 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (12) | cancelled | 7 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/12 |
| browser (9) | cancelled | 5 | Run npx playwright install --with-deps chromium |
| browser (1) | cancelled | 2 | Run npx playwright install --with-deps chromium |
| browser (7) | cancelled | 7 | Run npx playwright install --with-deps chromium |
| publish | cancelled | -1 |  |
