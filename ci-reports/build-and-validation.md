# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/42767290434
- commit: `c238c122a5` · Phase 0: resolve lazy-showroom CI timeouts, unit-tests budget, and ci-report log fetch
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-10T06:15:28Z · updated: 2026-11-10T08:41:08Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 2 |  |
| unit-tests | failure | 26 | Full unit suite without source changes |
| scenarios | success | 17 |  |
| offroad-scenarios | success | 10 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| wet-presentation | success | 15 |  |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (6) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (7) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| publish | skipped | -1 |  |
