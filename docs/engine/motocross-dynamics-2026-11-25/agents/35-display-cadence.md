# Assignment 35 — display cadence with active recorded controllers

## Result and owned scope

The production MX250/MX450 rigs produce identical inspected transforms at common requested times under **30, 60, 120, 144, and 240 Hz display playback**, including reverse-order seeks, repeated paused samples, and high/mid/far camera cuts. All measured matrix and presented-field differences are **exactly zero** in the accepted run.

The original race-only runner passed first. Inspection and subsequent measurements showed that its natural jump windows do not exercise every new channel: both outdoor windows have zero dab, cover, and clearance; both stadium windows have no accepted shift event. With coordinator authorization, this assignment extended only `scripts/bench/motocross-display-cadence.ts` to make the existing reproduction command report this coverage and exercise the missing channels with separately labeled real-controller recordings. This report is the only other authored file.

No production code, model definitions, meshes, materials, assets, terrain, environments, specifications, existing tests, or git state were changed by this assignment. The assignment-27 mesh sweep, assignment-29 full driving/replay tests, and assignment-32 physical hub suite were not repeated. No full TypeScript run was started.

## Reproduction and receipts

Run from the repository root, without npm pretest/prebuild hooks:

```sh
npx vite-node --script scripts/bench/motocross-field.ts --cadence
node_modules/.bin/eslint scripts/bench/motocross-display-cadence.ts
node_modules/.bin/prettier scripts/bench/motocross-display-cadence.ts --check
```

The benchmark itself writes only console output. Its existing minimal canvas shim supports material construction; it submits no images to a GPU. Logs and structured receipts were captured under `test-results/a35-display-cadence/`, without overwriting authored reports or generating models.

| Run | UTC interval, 2026-11-25 | Exit | Elapsed | Outcome |
| --- | --- | ---: | ---: | --- |
| Original runner | 18:38:08–18:38:35 | 0 | 26.577 s | Original 6,080 race matrix comparisons pass |
| Extended runner | 18:42:45–18:43:31 | 0 | 46.041 s | Eight recordings and all additional checks pass |
| Focused ESLint | After extended run | 0 | 0.953 s | Pass |
| Prettier check | After extended run | 0 | — | Pass |

The two npx runs emit the environment's existing unknown `http-proxy` configuration warning. It did not change either exit status. Benchmark elapsed time includes simulation, model construction, and CPU verification; it is not a frame-rate measurement.

Receipts: `baseline.log`, `baseline-command.json`, `baseline-before.json`, `baseline-after.json`, `extended.log`, `extended-command.json`, `extended-before.json`, `extended-after.json`, `summary.json`, `lint.log`, and `lint-command.json` in the task-local directory above.

## Recordings and active paths

The natural race recording is unchanged: production `Simulation`, automatic race controls, actual physics stepped at 120 Hz, and 30 Hz production snapshots. Each machine/venue records a sustained real flight and retains 92 snapshots around it. The production `PresentedFrame` sets the host transform; `BikeShells.update()` then poses the real existing rider and bike rigs.

The supplemental recording begins at the ordinary practice gate. It advances the real simulation for 368 calls of 1/120 s, sends ordinary inputs through `applyLoggedInput` at 60 Hz, and retains 92 snapshots at 30 Hz. The input holds the brake, alternates steer and fore/aft rider weight, and requests the assignment-29 sequence of twelve shifts at 66.67 ms intervals. It does not place the bike, assign speed/gear, inject a trajectory seed, fabricate a snapshot pose, or invoke a private solver. Every requested shift must be observed as the corresponding actual gear change.

At every retained supplemental snapshot, all three published posture rates and all three foot positions must exactly equal the Float32 representation of the actual controller observations: **2,208 direct controller-to-recording field checks** across four supplements. The recorded event transitions must retain all **48 actual accepted shifts**. The unchanged production readers reconstruct the same payload during playback.

| Natural race window | First `H.TIME` | Accepted event transitions | Peak standing rate | Peak body rate | Peak dab rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Valley Ridge / MX450 | 21.408333 | 1 | 6.213582 | 5.161519 | 0 |
| Valley Ridge / MX250 | 21.441668 | 1 | 6.207853 | 7.161848 | 0 |
| Arena Nord / MX450 | 26.208334 | 0 | 6.202876 | 9.205320 | 1.819358 |
| Arena Nord / MX250 | 26.341667 | 0 | 6.237989 | 8.714798 | 6.069976 |

All **736 retained snapshots** carry all three valid machine, posture, and foot-trajectory markers. Every natural recording has nonzero recorded fork, shock, and standing rates. The four supplemental recordings each contain twelve accepted event transitions, both dab signs, both body signs, both selector directions, and cover/clearance spanning 0–1. Their peak dab/body rates are 10.122457/4.829741 normalized units per second. They remain seated, so their standing channel is zero; the natural moving recordings provide standing activity.

The runner additionally samples every retained interval at alpha 0.4 and reports where the presented channel differs from Float32 endpoint-linear interpolation. Each supplement has 90 dab, 91 body, 24 selector, 16 cover, and 21 clearance intervals above the 1e-7 reporting threshold. These activity checks establish that the recorded reconstruction paths are exercised; the differences are **not errors against physical truth** or a new accuracy claim. Each channel's range, nonlinear count, and maximum difference is included in the JSON log.

## Cadence, order, pause, and LOD checks

The original ten observed world matrices remain unchanged: head/helmet, torso, both hands, both boots, fork lowers, front spinning wheel, rear suspension hub, and swingarm. Each recording runs forward through all five display rates. Equality is checked at nineteen common observations from 0 to 3 s, first on snapshot times, then shifted by 1/75 s to exercise a 0.4 snapshot fraction. The 30 Hz forward run is the stored reference for the other refresh rates.

After each forward run, the same nineteen times are revisited in reverse order. At every requested pose the camera visits 6, 66, 225, 6, and 6 m: high, mid, far, return to high, then repeat the paused high pose. The runner asserts the actual drawn detail name. Every joint matrix is compared with the original forward reference, rather than with a reference generated after the seek. The gear selector is additionally compared between high/mid detail and repeated visits; far detail is explicitly checked to omit it, consistent with the existing model.

The same probes compare nine `PresentedFrame` values: fork, shock, steering, standing, dab, body, selector angle, cover, and clearance. A SHA-256 digest of each source recording must remain unchanged after all playback queries.

| Check | Count | Maximum difference |
| --- | ---: | ---: |
| Preserved original race refresh matrix comparisons | 6,080 | 0 |
| Supplemental controller refresh matrix comparisons | 6,080 | 0 |
| Reverse-order / paused / LOD joint matrix comparisons | 76,000 | 0 |
| High/mid selector matrix comparisons | 5,776 | 0 |
| Presented scalar field comparisons | 79,344 | 0 |
| Actual `BikeShells` rig poses | 36,192 | — |
| Immutable source recordings | 8 | No changed bytes |

There are **93,936 matrix comparisons** in total. A matrix comparison inspects all sixteen elements; it is not sixteen separately counted poses. Each recording contributes 4,524 actual rig poses, 1,520 refresh comparisons, 9,500 joint probes, 722 selector comparisons, and 9,918 scalar comparisons. Matrix tolerances remain 1e-8; presented scalar equality is exact.

## Source freeze and provenance

Each run has before/after manifests over all **1,126 files under `src/`**, plus both benchmark files and the present package/config inputs: **1,132 inputs total**. The aggregate is SHA-256 of sorted `path + NUL + file SHA-256 + newline` entries. No input changed during either run.

| Run | `src/` tree SHA-256 | Complete input SHA-256 |
| --- | --- | --- |
| Original | `89111c3138b310a7da98af2e4456f845c8687086383ffbead89fdd2ba24af067` | `4c92d95da9c1bae3f689b7e3743b538c41c07c7231233bc86086e0701c35b137` |
| Extended | `470c10bf0d7d04d2e37be8380b2050cb6a6c6bd986759b5e74526e08a45192be` | `2c5284749a37cd6dfa1e206a22baf55e70ec83f45fe15d3758abe06bcf66c72a` |

Between the two runs, the coordinator changed `src/simulation/offroad/dirt-bike-vehicle.ts` from `d9ca921a1fe09060769622417be2d6a2698773232c9974f0f516e5b3d4fb8e58` to `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`. The extended run includes the latter source. The only other manifest change between runs is this assignment's authorized benchmark extension. No interpolation, model, or other source file changed between the two observations. These are point-in-time acceptance results, not evidence for an unspecified later revision.

Key accepted input hashes, with complete manifests in the receipts:

```text
scripts/bench/motocross-display-cadence.ts
c3d0062d35bd6110199f966766d086e6f12ff91a160fb7b8ab1d62bc2d85b705
scripts/bench/motocross-field.ts
30f343cceae8e6a6bbd0bd6a72624468371376e06d97e1a635ddcbe9b7f29407
src/rendering/offroad/mx-machine-pose.ts
f80b5f0116fc6c202c47eef3bd93c0ce17498016a50d066c16e2deb02eec74db
src/rendering/offroad/mx-rider-pose.ts
5d8e0e8b5f967d4c3dffaa19d44aa23a92baeef4eac7edf97c9909d914259668
src/rendering/offroad/mx-foot-pose.ts
2bc6a16ba88d105f452e0f73231977f67fc5f3ff7b8bb57cad4ff845e287edb1
src/simulation/offroad/mx-gear-stroke.ts
a4f599f2a9088b5ceb03c3670db811de046bba1ee742a61b9028fcf3892d205b
src/simulation/protocol.ts
eb17339446450136412f774ae2a38babcc45e7a3b2cafab638f70bf809047e0a
src/simulation/wheel-contact-state.ts
a2e64a4b27d4d0d11c86697836e6487a616691a35bf8976cf866c60072a4077d
```

## Limits

This is CPU transform and recorded-controller acceptance. It does not establish GPU submission, worker/browser scheduling, actual display frame rate, perceived fluidity, continuous-time smoothness between the checked observations, or real-bike calibration. The display-rate sweep replays a fixed recording; it does not change the physical integrator time step. The source-snapshot digest verifies playback immutability, not all independent publication-schedule behavior. Physical hub reconstruction, mesh contact, and replay resimulation retain the separately documented scope of assignments 27, 29, and 32. No new regression was observed in this acceptance run.
