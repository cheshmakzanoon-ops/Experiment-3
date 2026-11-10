# Build and validation

- run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/42761053969
- commit: `9fafa3f3a1` · CI: add ci-report workflow so run results, failure digests and screenshots are committed to ci-reports/ (Phase 0 tooling)
- event: push · status: completed · conclusion: **cancelled**
- started: 2026-11-10T05:16:05Z · updated: 2026-11-10T06:51:28Z

| job | conclusion | minutes | failed steps |
| --- | --- | ---: | --- |
| validate | success | 3 |  |
| offroad-scenarios | success | 13 |  |
| unit-tests | cancelled | 30 | Full unit suite without source changes |
| scenarios | success | 8 |  |
| owner-qa | cancelled | 90 | Owner-only and review-tool specs, plus the owner half of the dual-mode specs |
| wet-presentation | success | 13 |  |
| browser (8) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 8/8 |
| browser (1) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 1/8 |
| browser (3) | failure | 88 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 3/8 |
| browser (2) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 2/8 |
| browser (4) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 4/8 |
| browser (7) | failure | 78 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 7/8 |
| browser (5) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 5/8 |
| browser (6) | cancelled | 90 | Run xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:e2e:shard -- 6/8 |
| publish | skipped | 0 |  |
