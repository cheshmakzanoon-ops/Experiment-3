# Assignment 47 — original calibration and race acceptance

## Result: one confirmed integration regression

**Calibration passes; seven of eight full-grid races pass; the exact four-lap Valley built-in event passes. Arena rain seed 60729 fails the original individual-rider crash limit.** All three original commands completed. No acceptance limit or input was changed.

The failed case records rider 7 `crash-front` at **466.3 m / 83.9 s** and **456.0 m / 176.7 s** (adapter clocks). Two crashes exceed the unchanged allowance of one in two laps. Aggregate crash rate and successful classification do not override that failure.

An isolated, untouched archive of upstream commit `2578271913c264f5ffd6131afea30723df14b65b`, using the same Node **v24.22.3** and installed dependencies, passes the exact same case: **219.58 s**, only rider 10 crashes once, rider 7 has zero crashes, all twelve finish, maximum stop **10.75 s**. Current source yields **223.13 s**, rider 7 twice, maximum stop **13.29 s**. This establishes a regression relative to upstream; it does not isolate the responsible mechanism. Assignment **49** received the reproduction and owns causal diagnosis and repair. No source fix was made by 47.

## Completed original races

| Venue | Weather | Seed | Configured laps | Finishers | Race seconds | Total / worst crashes | Maximum stop, s | Result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Valley | clear | 60704 | 2 | 12/12 | 217.73 | 1 / 1 | 14.75 | Pass |
| Valley | clear | 60705 | 2 | 12/12 | 223.36 | 2 / 1 | 13.29 | Pass |
| Valley | rain | 60709 | 2 | 12/12 | 517.10 | 1 / 1 | 17.79 | Pass |
| Valley | rain | 60710 | 2 | 12/12 | 493.78 | 2 / 1 | 16.33 | Pass |
| Arena | clear | 60724 | 2 | 12/12 | 217.63 | 2 / 1 | 12.70 | Pass |
| Arena | clear | 60725 | 2 | 12/12 | 223.20 | 1 / 1 | 12.79 | Pass |
| Arena | rain | 60729 | 2 | 12/12 | 223.13 | 2 / 2 | 13.29 | **FAIL: rider 7 twice** |
| Arena | rain | 60730 | 2 | 12/12 | 232.52 | 3 / 1 | 11.87 | Pass |
| Valley event | clear | 41001 | 4 | 10/10 | 425.51 | 6 / 2 | 13.69 | Pass |

All **96 full-grid entrant starts** and **10 event entrant starts** are classified, with zero retirements. The full grid records **14 crashes**; the event records **6**. The combined **232 nominal rider-laps** are field size × configured laps (192 + 40). Actual completed lap counters are not exported by the unchanged runner, and `Race.step` permits lapped finishers; nominal exposure must not be described as measured completed rider-laps.

The unchanged requirements are a maximum stop strictly below **20 s**; at most **one crash per rider in two laps**, or **two in four laps**; aggregate bounds **0.5** for motocross and **0.75** for supercross; completion within **600 s** for the grid or **1,200 s** for the built-in event; a holeshot; at least **1,000** affected soil cells and **0.01 m** depth. Only the identified individual-rider bound fails. Arena's covered soil retains wetness zero under its ordinary rain selection.

The prior upstream CI failure of `valley-ridge-mx-moto-1`—rider 9 crashing three times—is **not reproduced**. The current event has crash distribution `[2,0,1,0,1,2,0,0,0,0]`; rider 9 has none. The source-identified CI excerpt is retained in [47-upstream-ci-evidence.json](../evidence/47-upstream-ci-evidence.json). This is a measured change in outcome, without attribution to one particular implementation change.

## Calibration

All **20 surveyed jump configurations**, **20 walking-speed checks**, **24 deliberate short/long gap probes**, and **three standing starts** satisfy the original checks. Hold outcomes are **17 clean and 3 permitted bottom-outs**, not twenty clean landings. Applicable distance ratios range **0.855–0.983** against **0.85–1.15**; the two kicker configurations retain the original exemption.

| Machine | 0–60 m seconds | Original band, s | Crashes |
| --- | ---: | --- | ---: |
| MX450 | 4.529167 | 3.6–5.0 | 0 |
| MX250 | 4.495833 | 3.7–5.2 | 0 |
| SM450 | 4.425000 | 3.8–5.6 | 0 |

## Provenance and scope

Frozen runtime fingerprint: `a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0`. Upstream comparison fingerprint: `d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`.

Before/after hashes and modes match for **1,390 captured files**, including all `src`, `public`, `assets`, `authoring`, both original scripts, selected root inputs and both tracked baseline JSON outputs. The original scripts, event/config/venue definitions and world stepping also match upstream byte for byte. The full manifests and compact receipt carry exact hashes. No model, character, environment, authored input, source, test or git change was made by this assignment.

Commands were direct Node with `--max-old-space-size=512 --experimental-transform-types`, using absolute original script paths and isolated output directories: calibration; races `--mx-full-grid`; races with `OFFROAD_RACE='event valley-ridge-mx-moto-1'`. The upstream comparison uses the same full-grid command filtered only to its existing seed60729 case. No npm hooks ran. Calibration/event JSON retain the original script's historical `npm run` label; the receipt records the actual commands.

The first grid attempt was interrupted after three console summaries during a context transition. Its partial log is preserved and excluded from totals. The completed resumed grid and event have actual exit receipts; calibration was not repeated. All 47 execution sessions ended before this report.

These are native **AI compatibility** checks: the original race runner enables `autoPlayer`, and the calibration rig marks its bike AI controlled. They do not certify player-only handling or browser/GPU animation quality.

## Evidence

- [Compact source-identified receipt and all case metrics](../evidence/47-race-calibration-receipt.json)
- [Original full-grid JSON](../evidence/47-motocross-full-grid.json) and [complete log](../evidence/47-motocross-full-grid.log)
- [Exact built-in event JSON](../evidence/47-valley-event.json) and [log](../evidence/47-valley-event.log)
- [Calibration JSON](../evidence/47-offroad-calibration.json) and [log](../evidence/47-offroad-calibration.log)
- [Untouched-upstream case JSON](../evidence/47-upstream-arena-60729.json), [log](../evidence/47-upstream-arena-60729.log), and [source/mode receipt](../evidence/47-upstream-arena-60729-receipt.json)
- [Before manifest](../evidence/47-inputs-before.json), [after manifest](../evidence/47-inputs-after.json), and [excluded interrupted log](../evidence/47-motocross-full-grid-interrupted.log)
