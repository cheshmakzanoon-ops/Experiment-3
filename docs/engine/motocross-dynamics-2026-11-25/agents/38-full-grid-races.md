# Assignment 38 — mixed twelve-rider race acceptance

## Result: one reproduced integration regression

**Seven of the eight unchanged full-grid race cases pass. Arena Nord clear seed 60724 fails the existing per-rider crash limit:** rider 7 crashes twice during its two laps, while the unchanged limit permits one. The exact same case on untouched task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887` passes with **zero crashes for every rider**. This is a newly reproduced task regression, not a baseline failure or an accepted limitation. It has been handed to the coordinator for a separate causal repair assignment. No limit, course, model, AI tuning, or physics code was changed by assignment 38.

All **96 entrant starts** in the current eight-race matrix are classified, with zero retirements. Every case finishes before its 600-second simulation limit, stays below the 20-second stopped-rider limit, records a holeshot and satisfies the existing soil-activity requirements. Aggregate crash rates remain within their venue limits; that does not override the failed individual-rider limit.

## Unchanged acceptance programme

`scripts/offroad-races.ts --mx-full-grid` runs MX250/MX450 in alternating positions in a twelve-rider field, two laps per race, at Valley Ridge and Arena Nord in clear/rain weather with two seeds each. The outer Simulation step is 120 Hz, with two vehicle/collision substeps per call, hence 240 Hz vehicle integration. The script is byte-identical to b527, SHA-256 `0535744434ca50ab792d206259f454336172de7f39ab969a3411404d08f532b0`.

This is **AI race compatibility and shared-solver acceptance**. The runner sets `autoPlayer = true`; the normal bike driver marks its vehicles AI controlled. It therefore exercises the shared motocross posture, suspension, collision and flight changes, but does not certify the player-only swept first-contact or finite wheel-pickup path. Assignments 33 and 36 provide the separate player-solver evidence. No state, force, terrain, controller target or contact override was used in this acceptance run.

| Venue | Weather | Seed | Race time, s | Crashes, total / worst rider | Longest stop, s | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Valley Ridge | Clear | 60704 | 201.41 | 2 / 1 | 9.33 | Pass |
| Valley Ridge | Clear | 60705 | 204.61 | 1 / 1 | 9.83 | Pass |
| Valley Ridge | Rain | 60709 | 502.87 | 1 / 1 | 13.66 | Pass |
| Valley Ridge | Rain | 60710 | 474.52 | 3 / 1 | 13.37 | Pass |
| Arena Nord | Clear | 60724 | 224.51 | 3 / 2 | 12.91 | **Fail: rider 7 has two crashes** |
| Arena Nord | Clear | 60725 | 213.04 | 1 / 1 | 13.32 | Pass |
| Arena Nord | Rain | 60729 | 241.37 | 1 / 1 | 10.33 | Pass |
| Arena Nord | Rain | 60730 | 212.50 | 1 / 1 | 15.20 | Pass |

There are 13 crashes across the matrix. The failed case records rider 7 `crash-front` at station 168.4 m / adapter time 12.6 s and `contact` at 448.1 m / 54.8 s; rider 5 has one `crash-front` near station 467 m. On the original baseline, seed 60724 finishes in 224.94 s with a 10.90-second longest stop and no crashes. Its other limits also pass.

The sum of the runner's per-race wall measurements is 324.3 seconds. This excludes setup and runs on a shared host alongside other validation, so it is not an engine-performance comparison or a hardware frame-rate claim. No additional 24-case stress sweep was launched.

## First-crash trace and divergence evidence

A short **18-second** observer-only comparison repeats seed 60724 on current and baseline source. It records all twelve riders after each outer tick and captures `dynamics.fall()` arguments, incoming state and callsite, then calls the original method unchanged. These traces do not alter controls or solver state. They confirm that the new first crash is the ordinary `judgeLanding()` verdict, with the player-solver flag false.

At adapter time **12.6041666667 s**, rider 7 is at station **168.3665154548 m**, lateral **−5.4747639301 m**, speed **7.0669923428 m/s**, pitch **−1.2 rad** and pitch rate **−4.0457288478 rad/s**. Its automatic body is **−0.9987818259**, standing **0.9990927319**, dab zero. Front support is **2600.1428615 N** and rear support zero. The preceding landing record at time 12.60 s reports:

- Pitch error **−1.2597313719 rad**, slope **−0.0002677216 rad**.
- Incoming normal speed **4.9328970964 m/s**.
- Air time **0.7583333333 s**, takeoff speed **7.5876611700 m/s**.
- Outcome `crash-front`, with no crossed-landing yaw and no recorded bottom-stop speed.

The baseline does not fall in this window. The incoming attitude is substantially outside the existing safe landing window; suppressing this verdict or loosening a threshold would conceal a real upstream trajectory problem.

The earliest observed difference is substantive automatic-body response at the first world tick: current **−0.0056022049**, baseline **−0.025**. The initial station, speed and heading still agree. To distinguish meaningful motion changes from minute floating-point differences, the paired trace also records the first crossing of declared comparison resolutions:

| Rider 7 quantity | Comparison resolution | First adapter time, s | Current | Baseline |
| --- | ---: | ---: | ---: | ---: |
| Speed | 0.1 m/s | 8.625000 | 13.3893578 | 13.0783974 |
| Lateral position | 0.01 m | 8.650000 | −0.2190153 | −0.2086410 |
| Pitch rate | 0.1 rad/s | 9.050000 | 0.2246940 | 0.1243321 |
| Pitch | 0.01 rad | 9.058333 | 0.0248071 | 0.0147687 |
| Vertical speed | 0.1 m/s | 10.508333 | 0.1022149 | −0.0200220 |
| CG height | 0.01 m | 10.541667 | 0.8352115 | 0.8202208 |

These are analysis resolutions, not new runtime or acceptance thresholds. The route and velocity divergence precede either first flight. The first observed flight starts at **10.825 s / pitch 0.60536685 rad** on current source, versus **11.04166667 s / pitch 0.38728493 rad** on baseline. After the first rear touchdown, the current bike rebounds into another flight with **−8.46287206 rad/s** pitch rate, versus **−2.71122892 rad/s** in baseline's next hop. These observations narrow the investigation to shared ground/posture/contact evolution; they do not isolate one changed mechanism as the cause. In particular, merely observing automatic-body differences first is insufficient to claim that controller alone causes the failed race.

## Source fingerprints and reproduction

The full run's before/after manifest covers **1,042 inputs**: every `src/**/*.ts` file, the unchanged race runner and the lockfile. It is unchanged across the run, SHA-256 **`f7fc1915cb337e84ac059778837f5931bcc6a4b7b732eb6b1c570b0bf94413f6`**. The adapter is **`e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`**. The working branch base remains `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`; task source changes are uncommitted at this checkpoint.

The baseline's 1,038-input manifest is likewise unchanged before/after, SHA-256 `ec48c30ef27d601aa8813f3d0aa9e0b1ab6aa9353435ff624b81fcc484cb5347`; its adapter SHA-256 is `1ba2eeef71ccaac6a07e6657a970f0b54e1ec4ec6cfd93bf21d2d50c24323700`. Both executions use Node v24.22.3.

Current command, from the repository:

```sh
node --experimental-transform-types scripts/offroad-races.ts --mx-full-grid
```

Baseline reproduction, from a separate scratch working directory so the current receipt remains intact:

```sh
OFFROAD_RACE='arena-nord-sx clear seed 60724' node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-baseline/scripts/offroad-races.ts --mx-full-grid
```

Current receipts are retained under `test-results/a38-full-grid/`: `full-grid.log`, the complete `full-grid.json`, `summary.json`, `source-before.json`, `source-after.json`, and `baseline-arena-clear-60724.json`. The original runner output `test-results/motocross-full-grid.json` is also preserved. Baseline and observer evidence are under `/workspace/scratch/e91efca799c8/validation/a38-baseline-grid/`, including the unchanged baseline result, manifest pair, `trace-grid.mjs`, both complete trace JSONs/logs, `trace-summary.json`, and `first-divergence.json`.

The existing runner does not expose per-contact impulse maxima or an every-step NaN counter. The reported classification and race checks therefore must not be relabelled as such measurements. This assignment makes no GPU, animation-quality or human-handling claim. Its sole tracked repository write is this report; it leaves production source, tests, models, character geometry, environments and limits untouched. No validation process remains running. The unresolved race failure is explicitly returned to the coordinator for repair and subsequent revalidation.
