# Agent 12 — bounded motocross remount motion and stranded-player recovery

## Changes

Owned production file: `src/simulation/bike-vehicle.ts`.
New regression file: `tests/motocross-remount-continuity.test.ts`.

The changed recovery behavior requires both `classId === 'motocross'` and
`tireFamily === 'knobby'`. The non-MX rider update keeps its existing per-axis
approach, heading assignment, and readiness semantics.

- The physical MX rider now turns toward the motorcycle through the shortest
  angular difference, bounded to 4 rad/s. This uses the existing on-foot turn
  rate and handles both directions across the `+pi/-pi` seam.
- The complete XZ displacement is bounded to `BIKE_RECOVERY.jogSpeed * dt`.
  Diagonal motion therefore obeys the same 4 m/s bound as cardinal motion. The
  final partial step reaches its target without overshooting.
- A ready motorcycle waits for the rider's turn before ordinary remount
  completion. This prevents a bounded entry turn from becoming an angular snap
  when `riding` copies the motorcycle heading. The existing `maxPush` timeout
  and its bounded marshal assistance are preserved.
- `BikeVehicle.restart()` accepts an optional rider/stranded/wrong-way reason
  and intentionally ignores it in the base implementation. The stationary
  throttle timeout passes `'stranded'` only for MX/knobby machines, selecting the
  existing dirt-bike approach/run-up and rear-wheel recovery policy. Other
  definitions still receive `undefined`, preserving their default restart
  policy, including supermoto.

No dirt-bike adapter file, model, character, geometry, material, environment,
venue, recovery constant, or pre-existing test was edited. No dependencies,
build generators, npm lifecycle hooks, commits, or pushes were run.

## Regression coverage

The new file has 18 tests. It inspects the production simulation rider state,
not a rendering substitute.

| Coverage | Assertion |
| --- | --- |
| Four cardinal and four diagonal directions | Actual planar displacement is 4 m/s at 60, 120, and 240 Hz; direction is preserved; partial strides do not overshoot. |
| Both pi seams | The numeric remount heading approaches along the short arc at no more than 4 rad/s, in the correct direction. A zero-duration update preserves XZ, heading, and tumble. |
| Front, rear, left, and right natural approaches | Both MX450 and MX250 advance through the ordinary separated → remount → riding state machine. Every angular step, including both transitions, stays within 4 rad/s. Remount XZ travel stays within 4 m/s. Recovery finishes within the existing budgets. |
| Ready bike, unfinished rider turn | A rider pi radians away at 1.49 s of remount turns before control returns, without a replacement angular snap. Completion remains below `maxPush`. |
| Determinism and held snapshots | Two independently initialized recoveries publish identical rider state sequences. Repeated `writeBikeBlock()` calls publish identical held frames. |
| BARN DOUBLE approach timer | The ordinary rider restart stays at the original approach. Repeated stationary timeout ticks select the stranded policy and enter the visible push. Recovery finishes beyond the jump, riding, with zero crashes within the existing six-second test budget. |
| Actual wet BARN DOUBLE stall | A manually controlled MX450 at the existing 315.4 m / -1.52 m fixture holds real full-throttle drive in second gear. `Simulation.step()` supplies physics and calls recovery; no per-tick speed override or direct restart is used. The bike stays below 0.5 m/s for almost six seconds, enters remount at the existing timeout, and reaches riding beyond the jump within `stuckSeconds + maxPush + 1`, without crashes or a station jump of 0.12 m. |

The direct approach-timer contract and the full physically stalled world case
are separate tests. The former catches the missing restart reason at the
extended approach boundary; the latter verifies the real session caller.

## Validation performed

All commands ran directly from the shared checkout without npm hooks.

```bash
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-remount-continuity.test.ts tests/motocross-rider-recovery.test.ts tests/motocross-push-gait.test.ts
```

Passed: **3 files, 22 tests**. The existing assisted-push completion assertion
and the existing rider-recovery assertions were unchanged.

```bash
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-ai.test.ts -t 'pushes a beached front tyre|gives a stranded rider|physically crosses timing gates'
```

Passed: **6 selected tests**, with 36 intentionally unselected tests. These
cover beached front-wheel and stranded approach recovery at BARN DOUBLE and
SUMMIT TABLE, plus physical timing-gate crossing during long assisted recovery.

```bash
node --max-old-space-size=384 --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

Passed: `pass: true`, `mismatches: []`, **5 cases**. All recorded trajectories
and checkpoints remained byte-identical for Formula, GP, road, supermoto, and
rallycross. The already-authorized global physics category changed from 39 to
40; the baseline runner explicitly permits that identity change and still
checks the raw trajectory bytes. No candidate evidence file was written and
the baseline was not modified.

```bash
node node_modules/eslint/bin/eslint.js src/simulation/bike-vehicle.ts tests/motocross-remount-continuity.test.ts
node node_modules/prettier/bin/prettier.cjs --check tests/motocross-remount-continuity.test.ts
git diff --check
```

Passed: ESLint, new-test formatting, and whitespace checks. Only the new test
file was formatted with Prettier; the production file was not reformatted.

```bash
node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit --pretty false --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --allowImportingTsExtensions --resolveJsonModule --isolatedModules --skipLibCheck --noFallthroughCasesInSwitch --types vite/client,node tests/motocross-remount-continuity.test.ts src/build-flags.d.ts
```

Passed: targeted strict TypeScript checking of the new regression and its
transitive production imports, using the repository's compiler options. An
earlier full-config attempt with a 512 MB heap exhausted that heap before
diagnostics. It is not recorded as a passing full-project compile. Full-project
resource and compilation gates remain centralized with the root agent.

## Explicit deferred boundary

The positional transition from remount to riding still copies the rider to the
motorcycle, including the existing 0.55 m beside-bike offset and any accumulated
lag on long assisted pushes. This patch does not claim that this first riding
position is bounded by jog speed. Its completion-continuity assertions cover
heading; the XZ bound covers the remount state itself.

This is a physical constraint, not a reason to weaken the existing long-push
tests: five seconds at 4 m/s permits only 20 m of rider travel, while real
surveyed assisted paths include approximately 31.6 m at the BARN DOUBLE
approach. The existing dirt-bike assistance moves the motorcycle across those
longer paths within the five-second budget. A rider constrained to 4 m/s cannot
reach that endpoint in the same interval.

Per root direction, distance-aware recovery timing/trajectory design and the
positional handoff are reserved for a later wave. No post-riding hidden heading
channel, timeout extension, speed-limit relaxation, asset change, or assertion
relaxation was added here. The existing hard timeout also retains precedence
over the ordinary heading-readiness gate; the tested natural recoveries finish
their turn before that timeout.
