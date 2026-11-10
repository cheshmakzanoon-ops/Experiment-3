# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41915850034
- commit: `eab1d91f6b` · Board: wave 7 merged, first real CI evidence, wave 8 in flight
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-04T21:24:47Z · updated: 2026-11-04T23:47:05Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| offroad-scenarios | failure | 13 | Full offroad calibrations and races without source changes |
| scenarios | cancelled | 15 | Run npm run test:vehicles |
| validate | success | 2 |  |
| unit-tests | success | 25 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 11 |  |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (7) | failure | 58 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (6) | failure | 53 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (2) | cancelled | 91 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (8) | cancelled | 91 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| publish | skipped | -1 |  |
