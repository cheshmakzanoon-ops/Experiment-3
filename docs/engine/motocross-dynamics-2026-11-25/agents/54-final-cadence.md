# Assignment 54 — final display-cadence acceptance

## Result and scope

The unchanged enhanced cadence benchmark **passes on the final frozen engine source**. Across MX250 and MX450 at Valley Ridge MX and Arena Nord SX, it performs **93,936 matrix comparisons and 79,344 presented-field comparisons with exactly zero measured difference**, using **36,192 actual `BikeShells` rig poses**. The complete eight-recording coverage is present. All **1,132 measured input files remain unchanged** during execution.

This is assignment 54 of 60, wave 9. No production code, tests, benchmark, models, materials, assets, environments, terrain, specifications, Git index or Git refs were modified. The assignment authored this report, its compact evidence receipt, and ignored local run receipts only. It did not repeat the full unit suite, build, or earlier physical-hub and foot-contact sweeps.

The single command started at **2026-11-25 20:13:28.760 UTC**, finished at **20:14:05.669 UTC**, and exited **0** after **36.909 seconds**. The benchmark process has ended; no heavy process from this assignment remains. Elapsed time includes simulation, construction and CPU checks and is not a rendering-performance measurement.

## Reproduction and evidence

Run from the repository root without generation hooks:

```sh
node_modules/.bin/vite-node --script scripts/bench/motocross-field.ts --cadence
```

The runner is byte-identical to the accepted assignment-35 enhanced runner. Its existing tolerances and assertions are unchanged: matrix-element tolerance `1e-8`, exact presented-scalar equality, required live channel activity, accepted shift sequence, LOD identity, and recording immutability.

The committed compact receipt is [54-final-cadence.json](../evidence/54-final-cadence.json). Complete local receipts are in `test-results/a54-final-cadence/`: `run.py`, `run.log`, `command.json`, `before.json`, `after.json`, `recordings.json`, `comparison-to-a35.json` and `summary.json`. The compact receipt includes hashes of the relevant raw evidence files, all eight recording hashes, source and input digests, observed totals, and source changes since assignment 35.

## Complete measured coverage

The original ten world transforms are checked: head/helmet, torso, both hands, both boots, fork lowers, front spinning wheel, rear suspension hub and swingarm. A matrix comparison checks all sixteen elements and is counted once. Playback uses **30, 60, 120, 144 and 240 Hz** display schedules and nineteen common observation times, both on snapshot times and at a fractional offset of `1/75` second. Every recording also revisits observations in reverse order and crosses high/mid/far/high/repeated-paused-high detail levels. The existing far-detail absence of the selector is explicitly checked.

| Observed check | Count | Maximum difference |
| --- | ---: | ---: |
| Original natural-race refresh matrix comparisons | 6,080 | 0 |
| Supplemental controller refresh matrix comparisons | 6,080 | 0 |
| Reverse-order, pause and LOD joint matrix comparisons | 76,000 | 0 |
| High/mid selector matrix comparisons | 5,776 | 0 |
| **All matrix comparisons** | **93,936** | **0** |
| Presented-field comparisons | 79,344 | 0 |
| Actual rig poses | 36,192 | — |
| Retained snapshots | 736 | — |
| Immutable source recordings | 8 | No changed bytes |

The nine scalar channels are fork, shock, steering, standing, dab, body, selector angle, cover and clearance. Every retained snapshot has valid machine, posture and foot-trajectory markers: **92 of 92 for all three markers in each recording**.

Natural flight recordings use the real simulation at 120 Hz and production snapshots at 30 Hz. Supplemental recordings use ordinary braked practice-gate inputs, real 120 Hz simulation, and input updates at 60 Hz. There is no injected pose, trajectory seed, speed, gear, or private-solver result. All twelve requested shifts are observed as actual corresponding gear changes in each supplement, for **48 accepted supplemental shifts**. The six controller-to-snapshot comparisons at each retained supplemental frame produce **2,208 direct field checks**.

| Recording | First recorded time, s | Frames | Accepted shift-event transitions | Poses |
| --- | ---: | ---: | ---: | ---: |
| Valley Ridge / MX450 / natural flight | 21.408333 | 92 | 1 | 4,524 |
| Valley Ridge / MX450 / control supplement | 5.960246 | 92 | 12 | 4,524 |
| Valley Ridge / MX250 / natural flight | 21.441668 | 92 | 1 | 4,524 |
| Valley Ridge / MX250 / control supplement | 5.960246 | 92 | 12 | 4,524 |
| Arena Nord / MX450 / natural flight | 26.208334 | 92 | 0 | 4,524 |
| Arena Nord / MX450 / control supplement | 5.960246 | 92 | 12 | 4,524 |
| Arena Nord / MX250 / natural flight | 26.341667 | 92 | 0 | 4,524 |
| Arena Nord / MX250 / control supplement | 5.960246 | 92 | 12 | 4,524 |

The natural recordings all have nonzero recorded fork, shock and standing rates. The supplements exercise both directions of dab, body and selector, plus full cover/clearance travel. In every supplement, interpolation differs from Float32 endpoint-linear interpolation in 90 dab, 91 body, 24 selector, 16 cover and 21 clearance intervals above the existing `1e-7` reporting threshold. These are activity measurements showing that the reconstruction paths run; they are not errors against physical ground truth. Standing is zero in the braked supplements and is exercised by the moving natural recordings.

## Final-source provenance

Before and after manifests cover all **1,126 `src/` files**, both benchmark files, `package.json`, `package-lock.json`, `tsconfig.json` and `vite.config.ts`. Each aggregate hashes sorted `path + NUL + file SHA-256 + newline` rows. There are **zero changed, missing or added inputs** between these manifests.

| Identity | SHA-256 or Git tree |
| --- | --- |
| Final `src/` aggregate | `5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096` |
| Complete cadence-input aggregate | `7612fc6081b63480df3a153ae9092439fc2fa7a1da3f3ef58b6acd6a108730ea` |
| Root's staged source/test/benchmark tree | `b7f379a7aaea0f807b5623b2c981190c6d1a3a17` |
| Parent commit recorded by root | `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` |

The final `src/` aggregate matches the final assignment-49 unit acceptance. A read-only comparison of every source file and the two benchmark files against their staged Git blobs confirms **1,128 of 1,128 equal**, with zero mismatches. The staged tree identity is the coordinator's recorded complete index tree; this assignment did not create or publish a commit.

Compared with assignment 35's enhanced-run manifest, the only changed inputs are the four intended final runtime fixes: `src/simulation/offroad/ai.ts`, `src/simulation/offroad/mx-gear-stroke.ts`, `src/rendering/offroad/chase-camera.ts`, and `src/rendering/offroad/mx-machine-pose.ts`. Their before/after hashes are preserved in the evidence. No runner or configuration changed. This rerun therefore replaces the earlier cadence result as the final-source cadence acceptance.

## Interpretation and limits

The result establishes deterministic reconstruction of the inspected existing rig transforms and presented fields at common requested playback times across the specified display schedules, reverse seeks, paused repeats and LOD changes. It also checks live recorded-controller coverage and immutable playback inputs.

The canvas shim supports CPU-side material/model construction. No frames are submitted to a GPU by this benchmark. It does not establish hardware FPS, browser-worker scheduling, perceived fluidity, continuous-time smoothness at every unobserved instant, or real-bike calibration. The display-rate sweep replays fixed recordings and does not vary the physics time step. Its camera is a placement probe for LOD, so this benchmark does not independently exercise chase-camera lifecycle dynamics; those remain covered by the focused camera tests and assignment 49's final test run. Browser acceptance and race-matrix acceptance remain separately reported results.
