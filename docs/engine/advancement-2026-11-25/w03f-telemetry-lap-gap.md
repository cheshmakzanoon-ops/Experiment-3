# Completed telemetry laps: closing capture interval

Wave 3, assignment 18. Scope: `completeLaps()` in `src/storage/telemetry-plots.ts`,
the new `tests/engine-telemetry-lap-gap.test.ts`, and this note.

## Defect and change

The storage audit identified an unvalidated interval at a lap-counter transition.
For the previous lap's rows `[start, i)`, the old continuity check examined only
the intervals ending before `i`. The transition row `i` proves that the previous
lap finished, but a missing capture interval from `i - 1` to `i` did not disqualify
that lap.

Each previous-lap row now checks the time interval to its successor. This covers
the internal intervals and the closing interval through `i`, while the validity
scan still reads only `[start, i)`. The first row of the next lap therefore closes
the previous lap's continuity check without contributing its `lap_valid` flag.

The strict `gap > 0.15` rejection rule, distance bounds, returned `start` / `end`
indices, lap-counter checks, and partial-ring-start behavior are unchanged. An
incoming gap belongs to the closing lap; the following lap is assessed from its
own first recorded row and existing start-distance bound. A well-observed following
lap can still qualify. No recorder or export schema changed.

## Production path reviewed

- `TelemetrySampler.capture()` samples even physics ticks and packs Float32 rows;
  transport exhaustion reports a recording gap instead of inventing samples.
- `packTelemetry()` supplies race time, distance, lap number, and current-lap validity.
- `TelemetryRecorder` retains those rows in its bounded ring and exposes `PlotData.at()`.
- `TelemetryRecorder.draw()` calls `drawTelemetry()`, which selects completed lap
  ranges through `completeLaps()` for comparison. The application's telemetry modal
  uses that draw path.

## Regression coverage

The new tests record protocol frames through the real `TelemetryRecorder.append()`
and `packTelemetry()` path. They cover ordinary crossings and exact returned distance
endpoints; a one-second missing capture just before, at, and just after a crossing;
validity ownership across a clean / invalid / clean sequence; and a wrapped 240-row
ring that starts partway through its oldest lap.

A `PlotData` view retains the recorded channels while supplying double-precision
timestamps for closing intervals below, equal to, and above 0.15 seconds. The exact
case asserts `0.25 - 0.1 === 0.15`, avoiding an accidental Float32 approximation of
the threshold. No threshold tolerance was introduced.

Before the production change, the new suite had **2 failures and 7 passes**: the
one-second transition gap and the 0.151-second closing interval incorrectly retained
lap 0. After the change, both exclude only that incomplete lap.

## Validation

```sh
node node_modules/vitest/vitest.mjs run tests/engine-telemetry-lap-gap.test.ts tests/telemetry-plots.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js src/storage/telemetry-plots.ts tests/engine-telemetry-lap-gap.test.ts
```

Result: **2 test files passed, 22 tests passed**; scoped ESLint exited **0**.
Validation used direct executables, with no npm hooks, build, or browser run.
No UI, style, content, tuning, model, character, environment, or asset files changed.
No Git state was mutated. Ownership is released to root for integration.
