# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44502345613
- commit: `152643b15f` · Trace High startup and retain graphics and engine acceptance evidence
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-19T10:05:15Z · updated: 2026-11-19T10:52:37Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| unit-tests | failure | 43 | Full unit suite without source changes |
| offroad-scenarios | success | 10 |  |
| scenarios | success | 11 |  |
| validate | success | 2 |  |
| wet-presentation | success | 14 |  |
| owner-qa | cancelled | 43 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (9) | cancelled | 43 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/12 |
| browser (11) | cancelled | 43 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/12 |
| browser (6) | cancelled | 40 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/12 |
| browser (2) | cancelled | 43 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/12 |
| browser (4) | cancelled | 37 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/12 |
| browser (1) | cancelled | 41 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/12 |
| browser (5) | cancelled | 42 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/12 |
| browser (10) | cancelled | 43 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/12 |
| browser (12) | cancelled | 33 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 12/12 |
| browser (7) | cancelled | 43 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/12 |
| browser (3) | cancelled | 21 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/12 |
| browser (8) | cancelled | 27 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/12 |
| publish | cancelled | 0 |  |
