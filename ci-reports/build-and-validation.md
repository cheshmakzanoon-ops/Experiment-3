# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/43370913255
- commit: `f40439fffd` · Motocross venue: denser verge and field grass, gated by quality tier
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-13T05:16:10Z · updated: 2026-11-13T05:25:34Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| offroad-scenarios | cancelled | 9 | Full offroad calibrations and races without source changes |
| validate | success | 3 |  |
| scenarios | cancelled | 9 | Run node --experimental-transform-types scripts/vellamar-race.ts clear,changeable |
| unit-tests | cancelled | 9 | Full unit suite without source changes |
| wet-presentation | cancelled | 5 | Run npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/42-full-scene-index-budget.spec.ts e2e/30-race-finish.spec.ts |
| owner-qa | cancelled | 5 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (1) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (2) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (5) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (3) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (6) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| browser (7) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (8) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (4) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| publish | cancelled | 0 |  |
