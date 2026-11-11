# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/42971656546
- commit: `25c3f306bf` · feat(gp): integrate and validate MotoGP Round-3 photorealism upgrade
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-11T06:19:50Z · updated: 2026-11-11T08:05:00Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| unit-tests | failure | 34 | Full unit suite without source changes |
| validate | success | 3 |  |
| scenarios | success | 9 |  |
| offroad-scenarios | success | 13 |  |
| wet-presentation | success | 10 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (6) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (7) | failure | 88 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| publish | skipped | 0 |  |
