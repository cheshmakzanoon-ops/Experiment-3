# Wave 7 contact construction and math measurement

Measured 2026-11-25T03:01:05.953Z. Baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`; candidate `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`.

## Results

All exact-output checks passed. 8 real-track meshes matched byte for byte; 2070 road-frame cases matched, including signed zero, near-threshold normals, overflow, invalid inputs and degenerate tangents. 540 real-vehicle clutch cases and 960 paired vehicle substeps matched their complete captured state.

| Timed workload | Operations/sample | Baseline median ms | Candidate median ms | Median paired change | Paired range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Constructor: aurel, 8192 rows | 1 | 206.877 | 201.352 | -2.52% | -43.67% to 31.89% |
| Constructor: poggio-alto, 8192 rows | 1 | 201.129 | 207.549 | -0.58% | -14.35% to 33.88% |
| Road-contact frame.set | 500,000 | 98.881 | 87.839 | -12.02% | -47.78% to -0.81% |
| Explicit dormant AWD coupleClutch | 1,000,000 | 110.905 | 22.178 | -80.16% | -86.13% to -72.66% |
| Catalogue substeps: sk125 | 1,200 | 62.214 | 64.288 | 0.79% | -15.59% to 84.14% |
| Catalogue substeps: rl2 | 1,200 | 71.796 | 78.086 | 9.96% | -17.04% to 25.78% |

Negative change means the candidate was faster for that paired sample. A mixed-sign paired range is evidence of timing noise. Raw samples and warmups are retained in the adjacent JSON.

## Interpretation of this run

The deterministic reductions are established; broad runtime improvement is not. The isolated road-frame loop was faster in all ten pairs, with a median paired reduction of 12.02%. The explicitly invoked AWD method was also faster in all ten pairs, but that branch is dormant in the current catalogue and contributes no demonstrated present-game saving.

The constructor measurements do not establish a stable elapsed-time gain. Aurel was faster in eight of ten pairs, but its pair changes ranged from −43.67% to +31.89%. Poggio was faster in five pairs, and its candidate median duration was higher even though the median paired ratio was slightly negative. Both statistics are retained; a median of paired ratios is not the ratio of the two duration medians.

The actual catalogue substep samples did not improve: sk125 was approximately neutral by paired median (+0.79%, five of ten pairs slower), while rl2 was 9.96% slower by paired median and slower in seven of ten pairs. This is an unresolved aggregate slowdown signal in this local run. It is not discarded as an outlier and does not justify a current-game speedup claim. The integration timing includes the unchanged vehicle solver and the altered road-frame implementation; no AWD coupling call occurs in the authored rl2 trajectory. Exact state equality establishes preserved behavior, not improved aggregate speed.

No repeat run was selected to replace these results. All first-run warmups and measured samples are preserved. The run completed in 25.386 seconds after bundle creation. Peak observed resident memory across children was 255.56 MiB, with a 768 MiB old-space cap and a reported total V8 heap limit of 960 MiB.

## Deterministic operation evidence

At 8,192 rows the original constructor passes 122,895 three-element arrays to normals.set and 114,688 six-element arrays to indices.set: 237,583 literal-array/set operations, containing 1,056,813 numeric entries. The scalar constructor performs none. Both versions write the same 122,895 vertices and 229,376 triangles, and use the same candidate BVH.

Each ordinary accepted road frame uses five Math.hypot calls before and four after. Invalid-input and degenerate-input cases retain baseline results, including state left behind on errors. Existing finite-sum/overflow behavior is preserved.

The AWD method performs one tires.map call per invocation before and none after. Only rear-drive sk125 and dk100 currently enable authored clutchCoupling; the AWD branch is dormant in ordinary catalogue stepping. The explicit AWD timing is a controlled future/caller-path measurement, not a demonstrated current-game speedup. No authored data or tuning was changed to activate it.

## Scope and reproducibility

The harness loads actual original target files using git show. All non-target dependencies are pinned to the candidate revision; the baseline Vehicle imports the actual baseline road frame. The separately changed BVH builder is identical in both constructor variants. Geometry is compared with Buffer.compare against temporary baseline binary files after the old tree is released. Binary Float64 serialization retains signed zero and non-finite frame and vehicle state.

Ten paired samples alternate order after warmup. GC, instrumentation, hashing, object setup and output verification are outside timing. Each child has a 768 MiB old-space cap and only one large contact mesh is live. Runtime: v24.22.3, esbuild 0.25.12, AMD EPYC 9V74 80-Core Processor, linux/x64. Source blob IDs, fingerprints, resource usage and raw timings are in the JSON.

Run from the repository root, alone without browsers or other benchmarks:

```sh
node --max-old-space-size=768 scripts/bench/engine-followup-contact.mjs --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb --candidate f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 --output docs/engine/runtime-followup-2026-11-24/measurements/w07b-contact.json
```

No full-game FPS, GPU, browser or physical-device claim follows from this report. Real-vehicle substep timings combine frame work with the unchanged remainder of integration; small or noisy aggregate changes are reported as measured.

## Read-only diagnosis of the rl2 timing signal

Root requested this follow-up after the compute lease was released. No timing, compilation or test was rerun; all observations below come from the retained samples and source/bundle inspection.

**Executed target methods.** The natural rl2 proof measured 960 road-frame calls and zero coupling calls over 240 substeps. `Vehicle.integrate` invokes one frame per wheel unconditionally. DynamicsTrack overrides contact casts with its analytic runway, so neither TrackContactMesh construction nor the BVH participates in these substep timers. Of the three target changes, only road-frame normal-length reuse executes. The generated bundle confirms that baseline Vehicle constructs the actual baseline frame class and candidate Vehicle constructs the candidate class; no timed per-instance patch is involved.

**Warmup and input scope.** Each variant gets two 600-substep warmup samples before its ten 1,200-substep measurements. That is 1,200 warmup substeps per variant, with no measured steady-state acceptance criterion. The rl2 warmup durations were baseline/current 39.271738/71.501796 ms and then 63.303540/54.440638 ms, showing substantial variability before measurements. The same worker completes sk125 before moving to rl2. Common helper feedback therefore also crosses vehicle definitions. The standalone frame microbenchmark varies bank and normal magnitude; the analytic runway's sampled normals are already unit up vectors (including signed zero components). Its isolated speedup is not an estimate of the active runway frame saving.

**Shared dispatch and runtime effects.** Both Vehicle constructors and both frame classes coexist in the same child. The timed `car.step` and `inputsForStep` sites, and the untimed dynamic constructor site, receive both variants. This creates polymorphic dispatch/profiles in the harness; the distinct integrate/frame function bodies can also reach optimized tiers at different times. These are possible measurement effects, not a proven explanation of the slowdown. GC runs before each run callback, followed by fresh track/car setup outside the timer; allocations during simulation can still cause GC inside a timed sample. The timer measures elapsed time, without CPU affinity, frequency control, per-sample CPU time or optimization/deoptimization traces.

**Ordering does not remove the concern.** Five pairs run each order. The median paired change is +16.299515% for baseline-first pairs and +6.458100% for candidate-first pairs. Thus the aggregate slowdown is present in both order groups and cannot be dismissed as a simple first/second-position bias. sk125's order-group signs differ, illustrating that the harness has residual variability.

| Pair index | Order | Baseline ms | Candidate ms | Paired change |
| --- | --- | ---: | ---: | ---: |
| 0 | baseline → candidate | 82.585223000 | 72.341432000 | -12.403903% |
| 1 | candidate → baseline | 73.970148000 | 89.893320000 | +21.526484% |
| 2 | baseline → candidate | 69.079127000 | 57.308584000 | -17.039218% |
| 3 | candidate → baseline | 82.288887000 | 87.603186000 | +6.458100% |
| 4 | baseline → candidate | 64.470336000 | 81.093282000 | +25.783867% |
| 5 | candidate → baseline | 54.328250000 | 57.354673000 | +5.570625% |
| 6 | baseline → candidate | 53.427763000 | 65.717016000 | +23.001624% |
| 7 | candidate → baseline | 72.014785000 | 81.715896000 | +13.470999% |
| 8 | baseline → candidate | 71.576303000 | 83.242893000 | +16.299515% |
| 9 | candidate → baseline | 80.098430000 | 75.079534000 | -6.265911% |

The exact duration medians are 71.795544000 ms and 78.086408000 ms. The median of paired changes is +9.964549759%; candidate is slower in seven of ten pairs. These are separate descriptive statistics, and neither proves the cause of the elapsed-time change.

**Independent check requested by root.** Worker41 evaluates the risk separately in W07E. A useful control is one implementation and one vehicle per fresh process, equal longer warmup, adequate timed duration, the same exact state oracle, and a separate frame case using actual flat/unit runway normals. That removes shared old/new dispatch and cross-vehicle feedback from the comparison. The first-run data here remains unchanged regardless of the follow-up result.
