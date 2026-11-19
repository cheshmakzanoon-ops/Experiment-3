# GP contact continuation — 19 November 2026

**The production candidates remain isolated and rejected.** The complete original four-file gate on `7ac509f` passed 48 of 51 original cases, with all 25 additive native cases passing. The later narrow current-history candidate `0594a2b` passes its 67 native checks and clears the original Parco 5074 and Ardennes hairpin 1000 failures, but Vellamar 5222 still has one fall and its subsequently tested original mixed 3303 pace gate fails. The final target-only admission trial `e65e13f` passes 83 native cases but fails both original Vellamar 5222 and mixed 3303. Neither later candidate has a complete original 51-case pass. Earlier passes are not transferred to them.

The candidate commits are local. This directory retains their patches so the source does not depend on those local Git objects surviving. `candidate-identity.json` identifies the published production base, the history-only patch chain, and every changed file's SHA-256. `target-only-source-identity.json` separately identifies the final rejected admission trial on top of that history-only candidate. Neither simulation identity 27 nor payload protocol 17 has been changed. An eventual accepted simulation change requires its own identity increment.

## Exact candidate sequence

| Source | Change | Authoritative result |
| --- | --- | --- |
| `ffd22598335dfa2a074ebd466e1d53830bb8bb41` | Published production base | Root's complete baseline suite retained two physics failures: wet Poggio impact and mixed GP/SBK pace. |
| `52ce46448a1048bafb7f5c59b35ea8df61dd3806` | Preserve raw GP AI path acceleration until the current suspension solve | 22 native passes. Original mixed 3303 fails: GP 90.41079570705689 s versus SBK 89.87650940697701 s. |
| `7ac509f9198ae5d5b06c9a17edd2177caa799115` | Decode the combined steering throttle reserve once, using the reaction that encoded it | Original mixed 3303 and wet Poggio 30101 pass. Complete original gate: 48/51; additive native: 25/25. |
| `0594a2b43b9a2769085efa1e1835243927fbb705` | Observe stored tyre strain at current contact preparation for the roll forecast only | 67 native passes; TypeScript and scoped ESLint pass. Original failure triad: Parco 5074 and Ardennes 1000 pass, Vellamar 5222 fails with one fall. Subsequent original mixed 3303 fails: GP 92.15861774982307 s, SBK 89.90506409359712 s. |
| `e65e13f3ff14ae3c02ce81feb6124755781c6e26` | Admit only a returning support ratio for a new target, preserving its previous pedal-reserve floor | Rejected: 83 native passes, but original Vellamar has one new earlier fall and mixed 3303 fails at GP 94.4633581453375 s versus SBK 89.66628928421538 s. |

The complete `7ac509f` gate failed original mixed Parco 5074 (one fall), mixed Vellamar 5222 (two falls), and Ardennes hairpin 1000 (rider 1 fell at station 3148.429820123317 m before the flag). Its 76-case invocation finished normally with exit 1 in 455.0035 seconds. All 14 original bike-session cases passed, including mixed pace and the snapshot round trip; all original dry/wet contact cases passed. Those facts describe that exact source, not the later history-only source.

The original mixed 3303 passing test does not print successful lap times. A later paired diagnostic, run to locate the newly confirmed history-only regression, records the exact passing `7ac509f` result: GP 88.34598141873684 s versus SBK 89.66195334860015 s. It is not a rerun solely to extract a favorable number; its per-rider and station-resolved comparison materially changes the attribution, as detailed below.

## Acceptance boundaries

`original-gate-hashes.json` preserves hashes for the four original gate files. They remain byte-identical to the published base. Seeds, test deadlines, collision requirements, zero-fall assertions, friction coefficients, controller gains and actuator limits are unchanged.

Every included guarded race/native receipt records the command, actual process exit, protected-input manifest digest, start/end times, and source stability. Outputs were written outside the worktree. The `7ac509f` complete-gate manifest is `b1ad6c361fadd12102f4e210b223a12eb65bc507a098e1415e5a0c87be90e2ce`; the history-only native, triad, typecheck, lint and first-fall observer share `754822e6324d760939923ff3220f8b5f9b3993742ec3cfedc4eccea3c3f302e5`.

An older background `ai-contact-only-wet30101` run from the previous session reported a successful child process but `sourceStable:false` because its source changed while it was running. That receipt is explicitly rejected. The new `contact-throttle-wet30101` receipt and the complete `contact-throttle-original51-and-native` receipt are source-stable and are the only wet results used here.

## What the narrow AI corrections establish

The path tracker computes signed `v² × (feed-forward curvature + tracking correction)`. Encoding that number as a lean using previous suspension load, then decoding it with the current reaction, changed the intended physical acceleration. The raw request now remains available for the existing two AI substeps. The adapter converts it after suspension supplies the actual current load pair. Existing nominal lean, current support and tyre-force limits still apply. The request clears on expiration, a default/zero AI mark, placement or recovery; manual, non-GP and walking inputs retain their established path.

The throttle reserve previously decoded this already-combined steering intent with static gravity and then added the tracking correction's magnitude again. `7ac509f` uses the same contact reaction as the encoding and charges the combined request once. Three native ownership cases cover agreeing/opposing corrections and load-scaled equivalent acceleration. Independent static review found no additional lifetime or serialization defect. The two-substep lifetime matches the actual simulation scheduling, and replay reconstructs the state from the start.

## Exact first-fall observations on `7ac509f`

The external observer calls the original core and native tyre plant once. It records a real riding-to-fall transition, identifies tick/substep provenance, and retains a four-second window. A separate deep clone evaluates current preparation with a positive timestep whose relaxation increment is exactly zero. It does not feed the result back into production. This observation includes current stiffness, force-circle clipping and bar projection; it is not simply a load-scaling estimate. Recorded speed-reset flags distinguish the native teleport/reset branch.

### Parco 5074

The first fall is GP rider 2 at 217.3666666666333 seconds, station 3399.3330487104104 m, before the flag. The absolute core lean limit is crossed at -1.25781840866 rad, with zero collision impact. At the fall, raw and decoded path acceleration agree exactly at +1.8385578569981904 m/s². Stored/current prepared lateral acceleration differs by only 0.000823568 m/s²; its largest difference in the saved window is 0.7252677 m/s².

All 280 retained complete incoming states replay through native `Bike.step` exactly. Controlled one-step substitutions of the recorded final signed pedal forces preserve the allocator's final force pair in every case. Their largest bar change is 0.008185674212046745 rad and largest associated one-step roll-rate change is 0.007373328 rad/s. This proves a force-phase inconsistency, without establishing that it initiates this race failure.

The separate roll decomposition reconstructs all 959 observed native roll-rate and lean results exactly. At an early oscillation sample, station 3347.6949891914846 m, steering precession contributes +2.121814 rad/s², while the controller forecast is -6.795555 versus the actual -4.075916 rad/s². The current-strain contribution there is -0.101424; rider-offset phase contributes +0.012587; measured-wheel-spin difference contributes -0.001202; new yaw contributes +0.399292. Instantaneous magnitude alone does not justify holding that steering moment through the prediction horizon. Previous retained work already rejected that predictor shortcut and finite-force/coupled-moment control integrations.

Over 945 saved 0.06-second horizons, current strain improves Parco roll-rate RMSE only from 0.196833 to 0.195491 rad/s, and slightly worsens the earlier yaw-onset and brake-release intervals. The initial braking trace has a lightly loaded rear, growing yaw/sideslip, then a large yaw reversal as the rear reloads. During that earlier onset actual front/rear forces largely track their requests. The passing result after the later history change is a new trajectory outcome; it is not proof that this earlier Parco mechanism was current-load history alone.

### Vellamar 5222

The first fall is GP rider 4 at 156.45833333335537 seconds, station 1901.1102254282177 m, before the flag. It crosses the positive absolute lean limit without collision impact. Raw and decoded demand agree at -6.3946699683 m/s². The saved window includes substantial contact unloading.

At 156.191667 seconds, stored lateral acceleration is 30.528690 m/s², current preparation is 8.953594, and the actual next native contact produces 9.058821. Both signed longitudinal forces are zero. Pairing the new reaction with the old force predicts -15.08160 rad/s² of roll acceleration; current preparation predicts +1.10191. Five selected complete native states replay 75 recorded values each exactly, including actual plant output before the fall handler resets its reported state.

The independent 0.06-second forecast comparison uses exact 240 Hz step order and interpolates between future boundaries 14 and 15 steps away. On 821 continuously supported, no-fall horizons, current preparation reduces pose RMSE from 0.00641008 to 0.00381872 rad and roll-rate RMSE from 0.21128018 to 0.12312881 rad/s. The zero-Fx subset improves similarly. All 907 complete forecast origins have feasible prior signed forces within the native current circles, so the helper's explicit early force clipping is nonbinding in this comparison. This is a saved-trajectory predictive benefit, not closed-loop race acceptance.

## History-only extraction and its remaining failure

The Vellamar evidence supports extracting only the pure current-history helper and its use in the roll forecast from earlier reviewed `b3be9ab`. The production tyre plant remains unchanged. The existing force-inverse timing, pedal reserve, measured trim, stopping-capacity calculation and steering actuator remain in their original phase; the broader `b3be9ab` final-force/reserve rewrite is not imported.

The additive native fixture and observer tests come from that reviewed source. The new fixture's force-phase assertion explicitly checks the unchanged previous-force inverse, since this isolated candidate does not claim final-force ownership. An existing rear-allocation isolation test now explicitly supplies its prescribed zero roll forecast. Its assertions remain unchanged, and two unmocked mirrored controls verify the physically nonzero response to residual front strain whether unsupported rear history is present or absent. The 67-case native run, typecheck and scoped lint all pass on the exact race-tested source.

The remaining original Vellamar fall is a different event: GP rider 2 at 83.60833333334594 seconds, station 3023.892904528202 m, speed 16.775707285857244 m/s, lean +1.2504284486424766 rad. All 959 actual current-history queries match the independent native preparation probe exactly. All 959 roll steps reconstruct exactly; five full native replays match 87 recorded values each. The final second has no airborne/unloaded rows or applied pedals, so a final-state zero-force observation does not identify the initiating cause.

The exact earlier controller reconstruction matches target, reported reserve and front request at all 959 origins. Although final signed force pairs differ from old pairs in 621 calls, resolving stopping capacity with the final pair changes the bounded request by more than 0.01 m/s² in only ten, with maximum 0.109937. A larger zero-rate endpoint-reserve gap occurs earlier during a roll that later settles; it is not yet shown to trigger the later runaway.

The apparent passing-runway lead was independently ruled out locally. Every one of 960 saved stations has native geometric runway zero, including all 330 `PASS / COMMITTED` rows. Consequently `passPace` returns zero regardless of the old profile's Infinity value. `blocker` stays -1; that commitment is generic `trackPass` bookkeeping, not the pace-aware runway admission. The separately valid finite-horizon correction has not been imported to chase this failure.

The remaining investigation concerns the early rising roll, current contact support and the force available to arrest that roll. No support-admission, gyro, route or gain change is included in `0594a2b`.

## Rejected target-only admission trial

The saved history-only Vellamar trajectory shows a changing ratio of support capacity to normal reaction. On 101 of 192 origins in the early 81.6–82.4-second rising-roll interval, the current target exceeds a supported limit encountered within the existing 1/9-second response horizon by more than 0.01 rad. The worst target example loses about 0.198 rad of future support even when the origin geometry is held fixed. This is a ratio swing, not a general absolute-capacity peak.

Previous absolute-capacity admission had incorrectly restricted proportional changes in both axle loads. A later paired ratio/reaction implementation also failed mixed pace; `prior-paired-admission-negative.json` retains its source/log identities and negative result. The new trial therefore tested only the dimensionless target ratio, retaining the existing response time and leaving current physical loads, lateral force budgets, current-history observation, reaction and stopping work unchanged.

The saved-path shadow reconstructs all 959 original targets/reserves/front requests exactly. Its two initialization bounds converge before the observed intervention. Its first changed request is at tick 9829/substep 1, time 81.908333 seconds, changing target 0.8565026052 to 0.8248838969 rad and requested lateral acceleration 1.941722321 to 3.126663164 m/s². This supplies a concrete early native test state, not a claimed closed-loop cure.

An independent review caught a reserve-floor implication: merely reducing `gp.leanTarget` also reduces the existing nominal `G*tan(max(abs(psi),abs(target)))` pedal reserve, by as much as 3.312085 m/s² in the saved onset. The trial explicitly retains the exact old supported target in `gpReserveTarget` for that existing floor, gated by the existing live-assist condition. It does not change the raw-request reserve. Two saved incoming states, each mirrored, verify the actual native inverse request and preserve the exact previous signed final pedal forces. Six recurring-support cases, proportional-load invariance, contact-loss/recovery and lifetime checks are also retained.

The first new-test invocation passed 81/83; two fixture assertions exposed JSON's loss of the sign of zero. The corrected assertion explicitly expects the native front-brake `-0`, and adds the direct native request check recommended by the reviewer. The corrected source passes **83/83** under stable manifest `8906d8b3368287cb527426d43047183c14cc3fe6dcc152605d469fb85e76d554`. Production code did not change between those two native runs. No typecheck or lint pass from the prior candidate is transferred to this rejected trial.

The unchanged original Vellamar/mixed pair then fails **2/2**, in 50.023970684 seconds, on that same stable manifest. Vellamar still has one fall; mixed pace is GP 94.4633581453375 versus SBK 89.66628928421538 seconds. The exact first-fall observer shows that Vellamar's remaining event is a new much earlier GP rider 0 fall: 12.683333333333254 seconds, station 123.56426837003528 m, lateral -8.049948 m, speed 38.021855 m/s, lean +1.251833 rad, roll rate +2.797512 rad/s, zero impact. It crosses the original absolute lean guard. Current-history observation remains exact and raw/decoded intent still agrees. This trial is rejected; no further target-admission variant is proposed.

## Correct attribution of the history-only pace failure

The original mixed 3303 gate had not previously run on `0594a2b`. Its new exact-source negative control fails at **GP 92.15861774982307 s versus SBK 89.90506409359712 s**. Thus the pace failure predates target admission; it cannot be attributed only to that final filter. The source-stable control finished in 32.946384167 seconds.

Two diagnostic races then run the original setup, seed, vehicles, two laps, timestep and 400-second cap on exact `7ac509f` and `0594a2b`. Observation wrappers preserve receiver, arguments and result and make no extra physical query. Both guards are terminal/source-stable. The history-only observer reproduces the uninstrumented GP/SBK lap numbers exactly. The earlier source reproduces all original acceptance inequalities at GP 88.34598141873684 versus SBK 89.66195334860015 seconds. Their identical recorder is retained, along with both complete compact summaries and native 257-point best-lap references.

The class-best change is not a uniform mechanical pace loss:

- On `7ac509f`, the winning GP lap belongs to rider 2 after a first-lap fall at station 1902.323596 m. Its second lap takes 88.34598141873684 seconds, with a different field separation.
- On `0594a2b`, rider 2 no longer falls. Its best lap is 93.53222063862508 seconds, but its total finish improves by 7.712317 seconds. It follows traffic over substantial early segments and later meets the yellow/settling response from rider 4's new fall.
- Exact native best-lap references assign 2.738447256 seconds of rider 2's 5.186239220-second best-lap loss to stations 1748.805–2248.464 m, including the yellow/settle interval and its slower exit. The following straight carries the reduced entry speed.
- Rider 0 has no fall on either source. Its best lap changes by only 0.705841346 seconds, from 91.45277640368468 to 92.15861774982307, while its total finish improves. Some losses are explicitly follow-limited. Its apparently unimpeded 1748.805–2248.464 m exit loses 0.366796566 seconds, but enters from traffic-selected paths differing by about 2–3 m. That is not a matched-state reserve or tyre-force comparison.

The station split arithmetic is exact native reference data. Other segment statistics are 30 Hz descriptive samples, with extra lap/fall samples, and do not establish one-step causation. The helper excludes stale unstamped steering-throttle values from comparisons and excludes the initial untimed grid approach from first-lap averages. Last-live GP-controller fields can precede a later airborne substep within the same outer tick. The observer also visits the terminal finished tick for the stop counter, where everyone has finished; this does not change the recorded maximum stop.

## Remaining history-only mixed 3303 fall

The source-stable exact-state observer confirms the new GP rider 4 event at **153.05000000002514 seconds, station 1931.934944540114 m**, crossing the native absolute lean limit at +1.2507595372371019 rad with zero impact. The current query equals the independent native preparation probe at all 914 observed origins. Raw intent maps to the expected current-reaction clamp within 1.7763568394002505e-15 m/s²; 20 nominal lean clamps account for larger raw-versus-decoded differences. At the fall the unclipped raw/decoded demand also agrees to floating-point precision.

Its earlier history contains a substantial lateral excursion. At 151.725 seconds/station 1868.636 m it is at lateral -7.877 m while the selected offset is -5.271 m. At station 1876.924 m it is airborne; later loading and unloading accompanies the growing roll before the final fall. The measured path/force phase is recorded, but no new production mismatch is established by this observation alone. It does not justify another feedback, gain or filter change.

## Reproduction and retained material

The original failed complete-gate command is in `contact-throttle-original51-and-native.json`; the later three-case command is in `contact-throttle-history-original-failures.json`. Both logs are complete. Candidate patches reconstruct the source from published `ffd2259`; the combined patch is explicitly named rejected. Original acceptance-file hashes and all changed candidate-file hashes are retained.

The compact summaries keep the native reconstruction residuals, decisive states and complete-analysis hashes. Observer/replay helpers are included. The retained roll-decomposition helper now labels the active forecast as well as the stored/current counterfactuals; the older complete-analysis hash refers to its earlier output without that added reporting field. This does not alter its native numeric reconstruction. Full per-step recordings and analyses remain in the external evidence directory; Vellamar's original recordings also have lossless archives. No additional race was run for the roll decomposition, forecast comparisons, native incoming-state replays or geometric-runway rejection.

The temporary paired-pace checkout was removed after all guarded observations finished; exact commits, patches, source identities and receipts remain retained. Large lossless trajectories are indexed in `latest-external-data-index.json`, while this compact bundle includes their result summaries, exact native lap references, analysis and reproduction helpers.

No production candidate is ready for integration, identity increment or remote publication. A later candidate must pass the unchanged original races on its own frozen source before broader acceptance is claimed.
