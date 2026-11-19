# Mixed seed 3303: current observation, residual reserve and lost progress

The isolated `3e58984` candidate remains unaccepted. Recording-only runs preserve the original six-rider, two-lap Vellamar seed 3303 options, 1/120 s outer timestep and 400 s limit. They preserve the original finish, incident, classification, no-stuck and pace requirements. The candidate exactly reproduces its original failed class-best lap pair. The baseline reproduces its original pace pass; its numerical lap pair was first retained by this recording.

| Source | GP best | Superbike best | SBK minus GP | Total falls |
| --- | ---: | ---: | ---: | ---: |
| `7ac509f` | 88.3459814187 s, car 2 | 89.6619533486 s | +1.3159719299 s | 1, car 2 |
| `3e58984` | 92.1586177498 s, car 0 | 89.9050640936 s | −2.2535536562 s | 1, car 4 |

The class-best change cannot be attributed solely to GP0 becoming slower. GP0's valid second lap changes by +0.7058413461 s, from 91.4527764037 to 92.1586177498 s. GP2's valid second lap changes by +5.1862392199 s, from 88.3459814187 to 93.5322206386 s. Candidate GP4 spends 9.675 s in the second-lap 1900–1950 m bin, averaging 6.468 m/s. GP2 has recorded `follow` and `yellow` limits in the same part of its second lap. The compact recorder does not hook `fall()`: exact incident time and causality still require the separately authorized bounded onset capture.

## Dominant lost-time window is a negative reserve control

Across GP2's second-lap 1850–2150 m window, residence time increases from 4.766667 to 7.283333 s, a 2.516667 s loss. All 37 sampled historical-winning native allocation replays there leave both applied longitudinal forces unchanged. In the 1950–2150 m subwindow, the loss is 2.275 s and all 27 sampled allocation comparisons also leave the pedals unchanged. The residual historical-force reserve does not explain that directly measured large loss.

At 1900–1950 m, the candidate's mean planned limit is 171.054 m/s and free speed is 93.852 m/s, while actual target averages 21.8405 m/s and the logged traffic reasons include 115 `yellow` samples. At 1950–2000 m, the mean target remains 29.4661 m/s and 177 of 185 trajectory samples carry braking, despite free speed 93.852 m/s and planned limit 144.782 m/s. At 2000–2050 m the target returns to 93.852 m/s, but average speed is only 32.259 m/s. This sequence is consistent with incident caution and its acceleration cost. It is not evidence for increasing the tyre budget.

## Residual ownership can bind elsewhere, in both directions

The observation boundary is the actual native `lateralNow` read after the bar actuator commits and before pedals are allocated. The live getter returns the identical original number. A deep native observer clone uses the committed bar, current contacts and prior signed longitudinal forces. Every observed live state hash is unchanged. The exact old-order reserve expression is retained: the historical magnitude, the unchanged G-based pose/target term and the existing controller demand term, including its existing 2G cap.

The recorder queries every active historical-winning state and separately samples nonwinning states at 10 Hz to detect a current-force term that would newly win. Native allocation comparisons use only the 10 Hz historical-winning subset. They hold the already selected controller target, demand, trim and bar request fixed, reconstruct the two pre-actuator scalars, and execute the original allocation/plant on isolated copies. Every original post-bar/pre-pedal boundary and plant input reproduces exactly: 1,552/1,552 baseline comparisons and 1,656/1,656 candidate comparisons.

The term is not always excessive. For example, candidate GP0 at tick 5820/substep 2 has historical magnitude 10.922813 m/s² versus current 11.688101 m/s². Keeping the pose and demand terms unchanged, the native diagnostic allocation reduces drive from 980.636 N to 840.596 N. Conversely, candidate GP2 at tick 22548/substep 2 has historical 15.348528 m/s² versus current 10.110634 m/s²; the pose term is 8.608449 and controller demand is 5.933788 m/s². The held-state native trial changes requested drive actually delivered from zero to 980.453 N. These are present-state ownership examples, not a proof of future arrest or a lap-time prediction.

On candidate GP0's second lap, the 1000–1100 m and 3000–3200 m windows lose 0.266667 s and 0.300000 s respectively. Their native trial effects are mixed. At 1092.306 m, current history releases 239.783 N of additional drive; at 3083.126 m it removes 132.063 N of drive; at 1049.912 m lower current magnitude permits 45.183 N more front braking. A sum of net-force differences cannot be treated as saved time.

No reserve term, pose law, requested-support obligation, control order, capacity limit or passing threshold was changed. The remaining stability problem is the priority. Exact fall onset, capped requested lateral demand, yaw/roll torque and reachable native force should be examined before any production proposal.

## Evidence boundaries

`mixed-reserve-comparison.json` records source identities, full recording and guard hashes, per-rider totals and selected station windows. `mixed-reserve-native-fixtures.json` retains selected complete native states and their signed force histories; raw trajectories remain outside Git. `record-mixed-reserve.mjs` is the exact frozen recorder. The final finisher's lap event is not appended after the original loop reaches FINISHED; its final best/classification and controller bins remain available. No missing sector value is inferred. Nonfinite diagnostic JSON aggregates are null and are excluded from finite averages.
