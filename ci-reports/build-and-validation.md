# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/43710103167
- commit: `29733d921b` · Motocross rider kit: stitched panel seams, compression creases, armour shells, jersey neck roll
- event: push · status: completed · conclusion: **failure**
- started: 2026-11-15T11:41:03Z · updated: 2026-11-15T13:17:35Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| offroad-scenarios | success | 8 |  |
| validate | success | 3 |  |
| scenarios | success | 14 |  |
| unit-tests | failure | 39 | Full unit suite without source changes |
| wet-presentation | success | 14 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (6) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (7) | failure | 87 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (3) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| publish | skipped | 0 |  |
