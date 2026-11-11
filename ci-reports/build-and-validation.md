# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/42969399777
- commit: `1bffdae9af` · Fix motocross leaned camber physics, deep-contact normal projection, and upgrade 3D bike/venue models and graphics
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-11T06:00:19Z · updated: 2026-11-11T06:20:11Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 8 |  |
| offroad-scenarios | success | 11 |  |
| validate | success | 2 |  |
| unit-tests | cancelled | 19 | Full unit suite without source changes |
| wet-presentation | cancelled | 9 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa | cancelled | 12 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (4) | cancelled | 10 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (2) | cancelled | 17 |  |
| browser (1) | cancelled | 12 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (6) | cancelled | 12 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (5) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (8) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (7) | cancelled | 17 |  |
| browser (3) | cancelled | 17 |  |
| publish | cancelled | -1 |  |
