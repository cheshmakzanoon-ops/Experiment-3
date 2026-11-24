# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072
- commit: `c4e62c642d` · engine: bound network retries and preserve deterministic service ownership
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-24T14:00:49Z · updated: 2026-11-24T14:21:45Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| offroad-scenarios | success | 4 |  |
| unit-tests (1) | failure | 11 | Complete unit-suite partition without source changes |
| scenarios | success | 11 |  |
| unit-tests (2) | success | 11 |  |
| unit-tests (4) | success | 8 |  |
| unit-tests (3) | failure | 7 | Complete unit-suite partition without source changes |
| validate | success | 3 |  |
| owner-qa (1) | cancelled | 12 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 8 |  |
| owner-qa (4) | cancelled | 12 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (2) | cancelled | 9 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| owner-qa (3) | cancelled | 11 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| browser (1) | cancelled | 7 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/16 |
| browser (11) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 11/16 |
| browser (10) | cancelled | 10 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 10/16 |
| browser (3) | cancelled | 4 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/16 |
| browser (6) | cancelled | 7 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/16 |
| browser (4) | cancelled | 12 |  |
| browser (14) | cancelled | 6 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 14/16 |
| browser (8) | cancelled | 0 | Run node --experimental-transform-types scripts/source-stability.ts -- npm ci --no-audit --no-fund |
| browser (2) | cancelled | 12 |  |
| browser (16) | cancelled | 5 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 16/16 |
| browser (15) | cancelled | 0 | Run node --experimental-transform-types scripts/source-stability.ts -- npm ci --no-audit --no-fund |
| browser (9) | cancelled | 9 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 9/16 |
| browser (7) | cancelled | 2 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/16 |
| browser (5) | cancelled | 3 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/16 |
| browser (12) | cancelled | 12 |  |
| browser (13) | cancelled | 12 |  |
| publish | cancelled | 0 |  |
