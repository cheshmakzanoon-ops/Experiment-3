# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44482949737
- commit: `8763bfc8e1` · Fix shared canvas resizing, rider garment continuity and shadow preparation
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T07:52:20Z · updated: 2026-11-19T08:36:29Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 11 |  |
| validate | success | 2 |  |
| offroad-scenarios | success | 10 |  |
| unit-tests | failure | 36 | Full unit suite without source changes |
| owner-qa | cancelled | 32 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 12 |  |
| browser (6) | cancelled | 31 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/12 |
| browser (11) | cancelled | 28 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (8) | cancelled | 31 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| browser (5) | cancelled | 27 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (9) | cancelled | 29 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/12 |
| browser (3) | cancelled | 30 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/12 |
| browser (7) | cancelled | 27 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (4) | cancelled | 28 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (12) | cancelled | 26 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/12 |
| browser (10) | cancelled | 29 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/12 |
| browser (2) | failure | 0 | Run npx playwright install --with-deps chromium |
| browser (1) | cancelled | 27 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/12 |
| publish | cancelled | -1 |  |
