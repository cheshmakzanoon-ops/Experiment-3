# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/42761743424
- commit: `9949070d86` · Bench: one-command real-GPU benchmark (journey --gpu, gpu-bench.mjs, tests, owner guide, CI smoke)
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-10T05:22:37Z · updated: 2026-11-10T07:20:33Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 3 |  |
| offroad-scenarios | success | 13 |  |
| unit-tests | cancelled | 30 | Full unit suite without source changes |
| scenarios | success | 12 |  |
| wet-presentation | success | 11 |  |
| browser (5) | failure | 75 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| owner-qa | cancelled | 90 | Run npx playwright install --with-deps chromium |
| browser (4) | cancelled | 90 | Run npx playwright install --with-deps chromium |
| browser (6) | failure | 86 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (7) | failure | 84 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| publish | skipped | 0 |  |
