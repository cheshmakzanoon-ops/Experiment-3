# Assignment 52 — final race matrix and calibration

## Result

**The complete, unchanged eight-race motocross grid passes on the frozen final source. The existing 20-configuration offroad calibration also passes, with zero band failures.** Both commands completed with exit status 0 and preserved final JSON, full logs, and matching before/after input manifests.

The race matrix classifies all **96 entrant starts**, completing **192 rider-laps**, with zero retirements. It records nine crashes in total, at most one per rider in any race, and a maximum stopped interval of **14.60 seconds**, below the unchanged 20-second limit. Every race finishes inside its existing limit and satisfies the existing holeshot and soil-activity checks.

This completes the matrix-level revalidation requested after A40 repaired the Arena Nord clear seed 60724 failure. That case reproduces the accepted focused result: rider 7 has zero crashes, rider 6 has one allowed crash, race time is 228.85 seconds, and the longest stopped interval is 10.21 seconds. The original A38 failure remains preserved and is not relabelled as a pass.

## Full eight-race matrix

Each case uses the production simulation, two laps, and twelve riders alternating MX450/MX250. The unchanged runner covers both venues, both weather selections, and two seeds for each combination. It advances the Simulation at 120 Hz, with the existing 240 Hz vehicle integration. No race filter, control override, state override, threshold change, or stress-grid expansion was used.

| Venue | Weather | Seed | Race time, s | Classified | Total / worst rider crashes | Longest stop, s | Result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Valley Ridge | Clear | 60704 | 201.41 | 12/12 | 2 / 1 | 9.33 | Pass |
| Valley Ridge | Clear | 60705 | 204.61 | 12/12 | 1 / 1 | 9.83 | Pass |
| Valley Ridge | Rain | 60709 | 502.87 | 12/12 | 1 / 1 | 13.66 | Pass |
| Valley Ridge | Rain | 60710 | 474.52 | 12/12 | 3 / 1 | 13.37 | Pass |
| Arena Nord | Clear | 60724 | 228.85 | 12/12 | 1 / 1 | 10.21 | Pass |
| Arena Nord | Clear | 60725 | 207.95 | 12/12 | 0 / 0 | 14.60 | Pass |
| Arena Nord | Rain | 60729 | 219.58 | 12/12 | 1 / 1 | 10.75 | Pass |
| Arena Nord | Rain | 60730 | 235.95 | 12/12 | 0 / 0 | 10.69 | Pass |

The existing acceptance retains its 600-second runner limit, stopped-rider limit of 20 seconds, individual limit of one crash in two laps, and aggregate crash bounds of 0.5 per rider-lap for motocross and 0.75 for supercross. The soil must affect at least 1,000 cells and reach at least 0.01 m depth; every gate race must record a holeshot. No limits were relaxed to achieve this result.

The completed run began at **2026-11-25 20:13:55 UTC** and finished at **20:18:33 UTC**. The observer wrapper measured 277.418 seconds of elapsed wall time. This is execution provenance on a shared validation host, not a runtime performance comparison or a GPU frame-rate measurement.

### What the race result covers

The runner sets `autoPlayer = true`, and these entrants use the normal AI-controlled solver path. This is acceptance of AI races and the shared suspension, posture, flight, collision, and recovery behavior. It does not replace the separate player-solver evidence for swept first contact and wheel pickup in A33/A36, the unit and contract acceptance in A49, or the rendering and display-cadence acceptance in A50/A54.

The runner does not expose a per-impact impulse maximum or an every-step NaN counter. Those measurements are not inferred from successful classification. Rain is selected through the ordinary venue/weather configuration; the covered Arena Nord course retains its existing dry soil behavior during that selection.

## Existing calibration

The unchanged calibration programme runs the standing starts, surveyed jump hold speeds and applicable ballistic-distance bands, too-short/too-long gap windows, and walking-speed rolling checks. It completed at **20:18:43 UTC**, with exit status 0, **20 surveyed jump configurations**, and **zero band failures**.

| Machine | 0–60 m time, s | Existing permitted band, s | Crashes | Result |
| --- | ---: | --- | ---: | --- |
| MX450 | 4.529167 | 3.6–5.0 | 0 | Pass |
| MX250 | 4.495833 | 3.7–5.2 | 0 | Pass |
| SM450 | 4.425000 | 3.8–5.6 | 0 | Pass |

All twenty walking-speed rolling checks finish successfully. The twelve applicable gap configurations retain their existing short/long failure-window checks. The hold-speed outcomes are **17 `clean` and 3 `bottomed`**; the existing calibration permits non-crashing bottom-outs. These results must not be described as twenty perfectly clean landings.

| Permitted hold-speed bottom-out | Measured bottom speed, m/s | Outcome |
| --- | ---: | --- |
| MX450, Valley Ridge, SKY TRIPLE | 0.31 | `bottomed` |
| MX450, Arena Nord, TRIPLE | 2.41 | `bottomed` |
| MX450, Arena Nord, FINISH TRIPLE | 2.03 | `bottomed` |

No vehicle specification, surveyed jump, terrain, landing verdict, calibration band, or hold-speed formula was changed by this assignment. The calibration output was written into the task's scratch `docs/` directory; the repository's tracked `docs/offroad-calibration.json` was not overwritten.

## Frozen-input proof

The wrapper hashes **1,131 inputs**: every regular file beneath `src/`, both execution scripts, `package.json`, `package-lock.json`, and the tracked calibration JSON. The complete entries agree before and after each command and across both commands. Their canonical manifest digest is:

`f365d1f69d7932707bb109522fbb6cf0e9d46b26f7a93f4965e0f904003ba6ab`

The runner scripts, lockfile, and tracked calibration JSON were also compared directly with the untouched b527 baseline worktree and are byte-identical.

| Input | SHA-256 |
| --- | --- |
| `scripts/offroad-races.ts` | `0535744434ca50ab792d206259f454336172de7f39ab969a3411404d08f532b0` |
| `scripts/offroad-calibration.ts` | `a994af9827d5587dd015533290a5725d458b80e2c176ef74915a73de08672718` |
| `package-lock.json` | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |
| Tracked `docs/offroad-calibration.json` | `bddf79cc6e6d5a0eae68f9c962215a2bc88e3cdde1edffc5d92fd795e343aee2` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` |
| `src/simulation/offroad/ai.ts` | `c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e` |

The final generated full-grid JSON has SHA-256 `6c01d0ea8d27e04635f218be687b3c95cbd22e8e7bc12e703f8651fa31564cfa`. The final generated calibration JSON has SHA-256 `962d469bfd818dbd2dd7fbc5b5e08df6a2bd463ecc614cf2e7892ea294bdd18a`. These are output fingerprints, separate from the unchanged tracked calibration receipt.

## Receipts and interruption handling

All completed receipts are under:

`/workspace/scratch/e91efca799c8/validation/a52-final-races/attempt-02/`

| Evidence | Relative path beneath the completed attempt |
| --- | --- |
| Combined checked summary | `summary.json` |
| Direct baseline runner/lock comparison | `baseline-runner-comparison.json` |
| Full-grid command, final exit and per-case receipt | `grid/receipt.json` |
| Full-grid complete output | `grid/test-results/motocross-full-grid.json` |
| Full-grid stdout/stderr | `grid/run.log` |
| Full-grid manifest pair | `grid/inputs-before.json`, `grid/inputs-after.json` |
| Calibration command, final exit and summary receipt | `calibration/receipt.json` |
| Calibration complete output | `calibration/docs/offroad-calibration.json` |
| Calibration stdout/stderr | `calibration/run.log` |
| Calibration manifest pair | `calibration/inputs-before.json`, `calibration/inputs-after.json` |

An earlier A52 attempt under the sibling `grid/` directory was interrupted by the environment after three console summaries. Its executor session was subsequently unavailable, and no matching process remained. It had no final JSON, after manifest, or exit receipt. That partial attempt was preserved, with `interruption.json` recording these observations, and was excluded from acceptance. The complete second attempt was started only after confirming the original executor could not be resumed. The coordinator's earlier interrupted sweep and A38's complete failing sweep are likewise not substitutes for this final receipt.

## Reproduction

Run directly with Node v24.22.3 from a fresh output directory. The commands below do not invoke npm's asset-generation hooks and keep generated reports outside the repository:

```sh
# Begin in the repository root.
MOTO_REPO=$(pwd)
MOTO_VALIDATION=$(mktemp -d)
mkdir -p "$MOTO_VALIDATION/docs"
cd "$MOTO_VALIDATION"
env -u OFFROAD_RACE node --experimental-transform-types "$MOTO_REPO/scripts/offroad-races.ts" --mx-full-grid
node --experimental-transform-types "$MOTO_REPO/scripts/offroad-calibration.ts"
```

The observer wrapper used for the recorded run is `/workspace/scratch/e91efca799c8/validation/a52-final-races/run-acceptance.py`; it records inputs, streams the unchanged command into a full log, waits for the actual exit, and then records the after manifest and output digest. It never writes a repository input.

**All A52 heavy processes ended at 20:18:43 UTC.** A subsequent process inventory found no race runner, calibration runner, or acceptance wrapper still running. This assignment's only repository write is this report. It makes no source, test, model, environment, specification, or git changes.
