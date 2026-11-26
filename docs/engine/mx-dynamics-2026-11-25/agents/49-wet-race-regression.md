# Assignment 49 — Shoulder recovery must respect traffic lane ownership

Wave 9. This assignment repaired the wet Arena integration regression found
by assignment 47. The retained runtime change is one additional condition in
`DirtBikeAIDriver.governJump()`, with explanatory comments. No vehicle physics
constant, jump target, crash threshold, race input, model or environment was
changed.

## Result

The original Arena Nord rain seed **60729** now passes its unchanged full-grid
acceptance. Before the fix, rider 7 had two front-first crashes, at 466.3 m and
456.0 m. The retained run has two total crashes on **different riders**, with
at most one per rider; all twelve entrants finish. This is a correction to
steering ownership, not a claim that every racing trajectory is crash-free.

The existing player feedback laps and shoulder-recovery checks remain valid.
All **66 distinct focused tests across five files** pass. All five new traffic
ownership tests fail against the exact pre-fix runtime and pass after the
correction.

| Original full-grid case | Race seconds | Total crashes | Worst rider | Longest stop | Finishers |
| --- | ---: | ---: | ---: | ---: | ---: |
| valley-ridge-mx / clear / 60704 | 233.98 | 2 | 1 | 14.75 s | 12/12 |
| valley-ridge-mx / clear / 60705 | 208.35 | 3 | 1 | 19.15 s | 12/12 |
| valley-ridge-mx / rain / 60709 | 516.14 | 1 | 1 | 16.17 s | 12/12 |
| valley-ridge-mx / rain / 60710 | 507.78 | 1 | 1 | 16.37 s | 12/12 |
| arena-nord-sx / clear / 60724 | 225.72 | 1 | 1 | 13.87 s | 12/12 |
| arena-nord-sx / clear / 60725 | 216.84 | 1 | 1 | 12.41 s | 12/12 |
| arena-nord-sx / rain / 60729 | 219.67 | 2 | 1 | 15.55 s | 12/12 |
| arena-nord-sx / rain / 60730 | 214.07 | 0 | 0 | 11.78 s | 12/12 |

All eight full-grid cases pass, with **96 confirmed entrant finishes** and no retirements. The narrowest stop margin is **0.85 seconds** below the unchanged 20-second limit; this is not a claim of broad safety margin for arbitrary seeds.

The exact built-in **valley-ridge-mx-moto-1** four-lap event also passes: **386.67 race seconds**, **10/10 finishers**, **1 total crash**, at most **1** for any rider, and **13.26 seconds** longest stop. The existing event permits two crashes per rider and a 1,200-second race limit. Configured laps are reported; lapped finishers mean they are not a measurement of every entrant's completed laps.


## Causal investigation

Assignment 47 replayed the untouched upstream commit
`2578271913c264f5ffd6131afea30723df14b65b` using the same Node 24.22.3 and
unchanged original race script. It passed seed 60729 in 219.58 race seconds,
with one crash on rider 10 and a 10.75-second longest stop. The integrated
pre-fix runtime failed the same case in 223.13 seconds, with both crashes on
rider 7 and a 13.29-second longest stop.

Isolated source copies changed one owner at a time:

| Counterfactual | Exact seed 60729 result |
| --- | --- |
| Pre-fix integrated runtime | Fail: rider 7 crashes twice |
| Replace the whole AI file with untouched upstream | Pass: one crash on rider 6 |
| Revert only the new shoulder steering block | Same result as replacing the whole AI file |
| Revert only the first-landing settle latch | Exactly the same failed result as the pre-fix runtime |
| Add a redundant downshift scope guard | Exactly the same failed result; no observed physical/control divergence in the 100-second paired trace |
| Retain shoulder recovery but respect traffic ownership | Pass: one crash each on riders 2 and 7 |

The full-AI counterfactual is not claimed to reproduce every upstream result:
other retained engine/recovery changes are still present. Its purpose is to
isolate the new AI block, not to establish global AI equivalence.

The downshift suspicion was explicitly rejected after reading the complete
caller path. `drive()` already returns to `super.drive()` for a non-player
MX plant before reaching the new two-signal rule. No downshift code was
changed by this assignment.

## The defect

A paired native simulation found the first physical divergence at public tick
**2465**, 20.541667 seconds after simulation start. Rider 7 was approaching the
opening TRIPLE on an unlocked clear plan. The shared traffic planner reported
**ABORT / FOLLOW**, which means it could not find a safe lane and had chosen
its current corridor. The new shoulder controller nevertheless replaced the
square-to-lip command with a recenter toward the held feature lane.

At the first observed conflicting command, the lip controller requested
−0.495894 steering and the shoulder controller substituted −0.5. Later in the
same blocked approach, it replaced **+0.499622** with **−0.5**. This was a
control-ownership violation, regardless of whether that particular tiny
initial difference would eventually produce a fall: a local shoulder aid
was choosing a lateral path the traffic planner had not cleared.

The correction allows the additional shoulder recenter only while the
planner's decision is `RACING LINE`. Passing, following and caution states
retain the calibrated square-to-lip behavior. This matches the existing
rhythm-runup controller's ownership rule. Free shoulder recovery, its bounded
command, its speed target and its landing corridor are unchanged. The
first-landing latch remains unchanged.

## Regression coverage

The new `tests/motocross-jump-traffic-priority.test.ts` covers both MX machines,
both shoulder sides, provisional and committed clears, and blocked, passing
and caution decisions. It checks that traffic-owned lanes do not receive an
extra recenter; ordinary line following still receives the existing bounded
inward steering. Pedals and the jump plan are unchanged by the ownership
choice.

A native twelve-rider seed 60729 test also exercises the real traffic planner.
It observes the first *unsaturated* blocked-lane command, since two saturated
commands could coincide accidentally and hide the defect. Its wrapper is
restored after execution. The pre-fix file fails all five cases; the retained
file passes all five.

| Focused file | Distinct tests | Result |
| --- | ---: | --- |
| `motocross-jump-traffic-priority.test.ts` | 5 | Pass |
| `motocross-jump-corridor.test.ts` | 14 | Pass |
| `motocross-landing-plan.test.ts` | 9 | Pass |
| `motocross-player-dynamics.test.ts` | 20 | Pass |
| `motocross-forgiving-handling.test.ts` | 18 | Pass |
| **Total** | **66** | **Pass** |

The final five-test ownership rerun replaces the same file in the preceding
48-test group; it is not added again. The pre-fix expected failures are causal
evidence, not acceptance passes. The handling suite retains the existing
zero-fall and less-than-one-second stall limits for both player feedback lap
scenarios. Strict targeted TypeScript, ESLint and whitespace checks pass.

## Source identity and reproducibility

Input runtime fingerprint:
`a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0`.

Retained runtime fingerprint:
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`.

Retained AI source SHA-256:
`48b1a697e912e999dc04b423bdf3fab1fdf0204c7f656717d2063ea311e94462`.

The complete fingerprint uses the same 1,129 source/configuration files and
path-plus-NUL framing as the production build identity. The adapter and
contact solver were not edited. Final checks record the same runtime before
and after execution.

Run the ordinary acceptance commands directly, avoiding asset-generating npm
lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
  tests/motocross-jump-traffic-priority.test.ts \
  tests/motocross-jump-corridor.test.ts \
  tests/motocross-landing-plan.test.ts \
  tests/motocross-player-dynamics.test.ts \
  tests/motocross-forgiving-handling.test.ts
node --experimental-transform-types scripts/offroad-races.ts --mx-full-grid
OFFROAD_RACE='event valley-ridge-mx-moto-1' \
  node --experimental-transform-types scripts/offroad-races.ts
```

Machine-readable causal evidence, the original race outputs and their logs
are linked from [49-wet-race-regression.json](../evidence/49-wet-race-regression.json).
These are CPU simulation and controller results, not browser/GPU verification.
The original limits remain 600 seconds for each full-grid race, 20 seconds
for any continuous stop, and at most one crash per rider in each configured
two-lap full-grid case. The built-in event retains its own field, seed,
weather, four-lap format, 1,200-second limit and two-crash per-rider limit.
