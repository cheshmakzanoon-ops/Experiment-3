# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/43839758878
- commit: `8b168cb298` · Renderer: detect the supercross arena from its built stadium bowl
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-16T09:26:30Z · updated: 2026-11-16T11:17:48Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| unit-tests | failure | 30 | Full unit suite without source changes |
| validate | success | 2 |  |
| scenarios | success | 11 |  |
| offroad-scenarios | success | 9 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 9 |  |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (7) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (6) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| publish | skipped | 0 |  |
