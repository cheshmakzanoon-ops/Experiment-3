# Agent 23 — finite motocross remount position handoff

## Scope and authorization

Owned production work is recovery code in `src/simulation/bike-vehicle.ts` and,
after coordination with root and Agent 21, the recovery methods and the
remounted-only synchronization block in
`src/simulation/offroad/dirt-bike-vehicle.ts`.

New regression: `tests/motocross-remount-handoff.test.ts`.

Root approved the intentional MX-only distance-aware duration contract before
implementation, then approved the corresponding existing-test timing and
planar-fixture changes. Agent 21 released the old recovery test blocks in
`tests/motocross-ai.test.ts`; Agent 24 owns the independent slope/contact
sampling changes in the shared adapter. This report does not claim their
production edits.

No model, character, mesh, material, environment, venue, core `Bike` state
machine, shared `BIKE_RECOVERY` constant, dependency, build generator, npm
lifecycle hook, commit, or push was changed or run for this work.

## Physical behavior

The new behavior requires both `classId === 'motocross'` and
`tireFamily === 'knobby'`.

1. The motorcycle stays still until the actual rider has reached its pushing
   position and heading. The rider's complete XYZ displacement is limited to
   the existing 4 m/s jog speed; the angular rate remains 4 rad/s.
2. The motorcycle follows its actual planned recovery displacement at no more
   than the existing 3 m/s push speed and 1.6 rad/s heading rate. The MX branch
   no longer accelerates a long push into the shared five-second timeout.
3. Once the motorcycle reaches the destination and the pickup has progressed
   for one second, the rider approaches the mounted root in XYZ at 4 m/s.
   Readiness checks the actual seat-position error and angular error. Neither
   the old timeout nor an auxiliary completion flag can bypass those checks.
4. The mounted root target uses the adapter's existing static sag and two
   contact-gap equations, evaluated without changing suspension state. At the
   remounted boundary, the adapter publishes the settled body pose before
   synchronizing the already-converged rider. This prevents a Y jump on the
   first riding tick or its deferred appearance on the following tick.

The non-MX push and rider-update branches retain their original operations,
including the original timeout. The shared `maxPush` remains **5 seconds**.
`remountBudgetSeconds` reports the planned MX duration and remains 5 for
non-MX vehicles; it is not a timeout that permits an endpoint snap.

## Distance-aware budget

Let `D` be the planned horizontal motorcycle distance, `theta` its shortest
heading change, `alpha` the initial rider heading error, `G` the initial
Euclidean XYZ gap to the pushing position, and `S` the final Euclidean gap
from beside the motorcycle to the settled mounted root. `H` is the sampled
total absolute height variation along the actual finite translation/turn
schedule. Sampling uses at most 0.25 m of translation and 0.05 rad of turn per
budget segment.

The planned duration is:

```text
max(5,
    1.5
    + max(G / 4, abs(alpha) / 4)
    + max(D / 3, abs(theta) / 1.6)
    + (H + 0.55 * abs(theta)) / 4
    + S / 4)
```

The 1.5 seconds accounts for the core pickup/mount hold and phase boundaries;
the remaining terms account for acquisition, actual pushing/turning, terrain
and beside-bike catch-up, and final mounting. The trajectory itself uses the
finite rates and actual readiness described above. Tests independently reject
completion faster than `D / 3` and require completion within the derived
deadline plus a small number of simulation ticks.

Measured MX450 results, including the first mounted sample:

| Recovery | Horizontal push | Completion at 60 / 120 / 240 Hz | Derived budget |
| --- | ---: | ---: | ---: |
| BARN DOUBLE extended approach | 31.631 m | 10.850 / 10.833 / 10.829 s | 14.610 s |
| First Valley Ridge jump, push-gait fixture | 20.405 m | 7.133 / 7.108 / 7.100 s | 9.135 s |
| Arena Nord timing gate at station 448 | 29.858 m | 10.267 / 10.242 / 10.237 s | 14.514 s |

Across these measured complete transitions the maximum actual rider speed
was 4 m/s and maximum planar motorcycle speed was 3 m/s, up to approximately
`1e-12` floating-point noise. The BARN distance cannot physically be covered
by a 4 m/s rider in five seconds; the duration change is intentional.

## Existing-test contract changes

All course endpoint, timing-gate, crash, independent effort, and displacement
assertions were retained.

- The push-gait recording loop now uses the computed deadline and also checks
  the actual rider's XYZ displacement through the first riding sample. Its
  recorded velocity must not exceed the existing 4 m/s rider speed.
- The BARN approach timeout test and physically stalled player test use the
  computed recovery duration, with new actual XYZ displacement checks.
- Four existing AI recovery blocks use the computed deadline: Ridge Table's
  stranded drive tyre, the BARN/SUMMIT beached front tyre, the BARN/SUMMIT
  stranded approach, and the two Arena Nord timing-gate fixtures. They also
  check the actual XYZ rider step. Gate and course assertions are unchanged.
- The manual-remount drive-effort test formerly required 4.9–5.1 seconds for
  every recovery. Its observed 15.46 m push now completes in 5.441667 seconds.
  Only that duration assumption changed to actual distance/3 and the computed
  deadline. The subsequent 4–4.3 second effort interval, 3.9–4.1 seconds of
  actual effort, single push, and zero crashes remain unchanged.
- The eight pure planar direction fixtures now initialize rider Y at the
  sampled beside-bike terrain height. Their exact 4 m/s XZ, direction, and
  partial-stride assertions remain unchanged. Previously the fixture also
  requested a 0.168 m vertical correction while demanding the entire 4 m/s
  speed budget in XZ. Separate new tests exercise real XYZ diagonal motion.

## Regression coverage and validation

The new file contains **27 tests** at 60, 120, and 240 Hz. It covers XYZ
diagonal and partial steps, zero-duration holds, position and heading
readiness beyond the former timeout, a distant rider whose motorcycle must
wait, and both MX250 and MX450 production recovery paths. Natural recovery
runs from four approach directions per machine and frequency; long recovery
runs cover BARN DOUBLE, the push-gait fixture, and both Arena Nord gates.
Every complete path checks the first **three** mounted samples, so postponing
the Y snap does not pass.

```bash
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-remount-handoff.test.ts tests/motocross-remount-continuity.test.ts tests/motocross-rider-recovery.test.ts tests/motocross-push-gait.test.ts tests/motocross-ai.test.ts tests/motocross-shoulder-recovery.test.ts
```

Passed: **6 files, 93 tests**, including all **42** existing AI tests and both
shoulder-recovery cases. Before the final batch, the ten selected recovery,
wrong-way, and timing-gate AI tests also passed.

```bash
node --max-old-space-size=384 --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

Passed: `pass: true`, `mismatches: []`, **5 cases**, with byte-identical
Formula, GP, road, supermoto, and rallycross trajectories/checkpoints. The
shared work's physics category is 41 versus baseline 39; the runner's existing
category allowance still checks the raw trajectory bytes. The baseline was
not modified and no candidate evidence file was written.

Direct ESLint on both touched production files and all four touched tests
passed. Prettier checks on the new handoff test and existing continuity test
passed. `git diff --check` passed.

A targeted strict TypeScript compile of the new test and its transitive
production imports passed with a 512 MB heap and the repository compiler
options. No full-project TypeScript compile was run.

## Release

Recovery production/test ownership is released to root. No outstanding
recovery test failure remains. Other agents' slope/contact/AI work in the
shared tree is outside this report's ownership.
