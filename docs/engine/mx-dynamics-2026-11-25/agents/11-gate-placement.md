# Agent 11 — selected motocross gate placement

Date: 2026-11-25. Wave 2 implementation of lifecycle finding L05-1.

## Change

`src/simulation/offroad/session.ts` now gives `OffroadSession.place` and the
constructor the same internal `gateAssignments` policy. An explicit gate array
is accepted only when it supplies one distinct integer slot per entrant and all
slots exist on the actual venue gate, including gates expanded for a larger
field. Array indices remain car ids, independent of qualifying/grid order.

An absent or invalid selection falls back for the entire field to the existing
`pickGates(grid, preference)` behavior. It never applies a valid subset of an
invalid selection. The helper also validates direct session/placement callers
that have not passed through `Simulation`'s general option validation.

Physical placement and entrant `slot`/`slotLateral` metadata therefore agree
before the first physics step. The closed-gate correction returns a creeping
bike to its own selected lane. Existing longitudinal setback, grid preference,
gate expansion, jump-start judgment, stage queues, and other format branches
are unchanged.

## Regression evidence

Added `tests/motocross-gate-placement.test.ts`, exercising real `Simulation`
instances and physical body positions rather than only gate metadata.

Before the production change, the explicit-choice tests failed on both venues
for grid `[2, 0, 3, 1]` and gates `[9, 0, 7, 3]`:

| Venue | Player actual lateral | Selected lateral | Difference |
| --- | ---: | ---: | ---: |
| Valley Ridge MX | -4.025 m | +5.175 m | 9.200 m |
| Arena Nord SX | -3.850 m | +4.950 m | 8.800 m |

The new suite covers:

- Explicit per-car choices on both motocross venues, mixed MX250/MX450 entries,
  arbitrary qualifying order, physical body coordinates, and snapshot slot ids.
- A twelve-rider expanded gate in endurance, plus ordinary entrant-order and
  qualifying-order defaults.
- A rider advanced 0.65 m into the closed gate, then corrected by an actual
  `Simulation.step`; its station returns to the start station without a lateral
  jump. All four bikes remain within 0.05 m of their initial lane through another
  sixty held physics steps.
- Whole-field fallback for venue-out-of-bounds, globally allowed but
  venue-invalid, duplicate, negative, fractional, NaN, infinite, partial,
  oversized, and sparse choices. Each case also exercises direct placement and
  constructor entry points with unsanitized options.
- Supermoto choices, plus gate-choice independence for practice, rallycross
  lights, and rally stage queues.

## Validation

Executed installed tools directly, with no npm hooks or dependency operations:

```text
node node_modules/vitest/vitest.mjs run tests/motocross-gate-placement.test.ts -t 'places explicit'
Before fix: 2 expected failures, 18 skipped (the 9.2 m / 8.8 m mismatches above).

node node_modules/vitest/vitest.mjs run tests/motocross-gate-placement.test.ts tests/offroad-meeting.test.ts
After fix: 2 files passed, 27 tests passed; total 26.50 s.
New regression suite: 20 tests, 1.71 s.
Existing meeting suite: 7 tests, including real qualifying and both motos.

node node_modules/prettier/bin/prettier.cjs --check tests/motocross-gate-placement.test.ts
Passed.

git diff --check -- src/simulation/offroad/session.ts tests/motocross-gate-placement.test.ts
Passed.
```

Changes are limited to the owned session file, the new focused test file, and
this report. No models, character assets, geometry, materials, environment data,
vehicle adapters, or base vehicle code were edited. No commit or push was made.
