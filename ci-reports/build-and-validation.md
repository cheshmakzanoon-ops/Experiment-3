# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/43240576806
- commit: `6475c67163` · Motocross physics: feet-up low-speed balance, load-aware roll and grip-loss allowance
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-12T14:45:53Z · updated: 2026-11-12T16:21:32Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| scenarios | success | 9 |  |
| unit-tests | failure | 35 | Full unit suite without source changes |
| validate | success | 2 |  |
| offroad-scenarios | success | 10 |  |
| wet-presentation | success | 7 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (7) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (6) | failure | 89 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| publish | skipped | 0 |  |
