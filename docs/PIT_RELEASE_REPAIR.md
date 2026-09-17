# Pit-release repair — 17 September 2026

A circular wait was reproduced in the changing-weather scenario: car 0 waited in
service phase 5 at station 100.2 m while car 3 was stopped 7 m behind it in the
approach lane. The follower braked for the car ahead; the release guard incorrectly
treated the stopped follower as approaching fast-lane traffic. Neither progressed.

The release guard now gives the car ahead priority only when the follower is
stationary (below 0.5 m/s) and separated by at least 6.5 m. The existing controller
still brakes for the leader; a moving or overlapping follower continues to prevent
release. No teleport, velocity assignment, timer escape, or test relaxation is used.

## Executed checks

- `npm run check`: 64 tests, lint, type checking, and production build passed.
- `tests/pit-release.test.ts`: both the decision boundary and a 55-second physical
  two-car circular-wait fixture passed, with both stops completed and zero impact.
- `npm run test:physics`: all three four-car, 320-second scenarios passed. In the
  previously failing changing-weather case every car performed one pit stop and
  fitted intermediate tires; completed lap counts were 4, 4, 4, 3.

The clear scenario still recorded light contact damage (car 2 front-wing health
0.93287), so these short tests are not evidence of flawless multi-car racing.
The longer ten-car acceptance gates are separate and must be rerun. The original
failures in DEVELOPMENT_STATUS.md describe the preceding checkpoint, not this fix.
