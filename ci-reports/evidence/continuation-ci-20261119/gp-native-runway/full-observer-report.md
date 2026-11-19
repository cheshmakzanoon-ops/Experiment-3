# One source-matched mixed3303 observer

## Result and disposition

The recording-only observer **exactly reproduced the original failed race** on the frozen baseline plus throttle-ownership correction. No source or original assertion changed. The diagnostic process exited **0** because numerical reproduction and source stability succeeded; the original race remains **failed** on both pace assertions.

| Original outcome | Observed value |
|---|---:|
| Fastest valid GP lap, rider 0, lap 2 | 91.4372396579149 s |
| Fastest valid superbike lap, rider 1, lap 2 | 90.3703801553851 s |
| GP advantage, SBK minus GP | −1.0668595025297947 s |
| Original required advantage | >0.15 s, with GP faster |
| Finish/classification | All six finished two laps; none retired |
| Crashes / recorded impacts or falls | 0 / 0 |
| Longest stopped interval | 0.5250000000000006 s |
| Outer simulation steps | 24,105 at 1/120 s |
| Maximum authorized loop | Original 48,000 steps / 400 simulated seconds |
| Original wall deadline retained externally | `timeout 120s` |
| Observer simulation wall time | 25.011650704 s |
| Guarded command wall time | 33.329119161 s |

The full observer ran once, sequentially at nice 10. Analysis first read only that trace. A later, separately authorized partial replay stopped at race time 146.107533 s to capture missing profile arrays; its scope and offline native proof are described in `profile-proof.md`. No additional full race, original 51-case gate, full unit run, source correction, integration or publication is part of this package.

## Source identity

Worktree: `/workspace/scratch/0ab62d15db18/gp-baseline-throttle-only`, detached at `a1e2e385251b94f7cc82e123440a0a4c72611d63`.

The only worktree changes remain `src/simulation/bike-ai.ts` (the existing steeringThrottle ownership correction) and `tests/gp-steering-throttle-ownership.test.ts` (three existing native assertions). All 931 production files, the four specified original race/planner tests and the focused fixture were checked against the previously frozen whitelist before and after the observer. The outer guard also checked all **7,459 protected inputs**, with no differences.

| Identity | SHA-256 |
|---|---|
| Candidate bike-ai.ts | `ffc70ab74e818298535eea6c48375df8cd3a5b30ba4ad776370a358eb3358c7d` |
| Complete protected-input manifest | `28843ec8e6f9c2cabd3d3bb09d6afe8a05596edc64c5cc6f41b257e9855c42bd` |
| Existing candidate whitelist file | `c002b18dd97eaa1ee88634ee88495c8943a7ed599fe2e2cb5e157ebebbb9189e` |
| Observer source | `e86111132f1acd135a14a0155be397ccc09aa3f3ee8fdcce63aad38f0928a408` |
| Uncompressed full trace | `752d7c5d3797bdb091fc17c20edf2a3d2758756c0d2f643e5e660073c29976f2` |
| Guard log | `dad47eb535b2c4e9c26f0836c9084fc4d01b68d12d4cdb89df21d1825af06c7f` |

The full whitelist and input manifest are included losslessly. Earlier rejected geometry, cache, spatial and physical-control candidates were not used. Historical trajectory conclusions were not transferred to this run.

## Where the fastest GP lap loses time

These are exact native LapTracker sector durations, not estimates from sampled positions.

| Sector | GP rider 0 | SBK rider 1 | GP minus SBK |
|---|---:|---:|---:|
| 1 | 30.6424537858785 | 30.321041157711306 | +0.3214126281671952 |
| 2 | 25.474351373205295 | 25.778881208657566 | −0.3045298354522714 |
| 3 | 35.320434498831105 | 34.270457789016234 | +1.049976709814871 |

Sector three accounts for almost all net loss. The GP still gains time in the two major acceleration regions. Full native substep residence bins give the following useful localization; their boundaries are quantized at 1/240 s and should not replace the exact native sector totals.

| Station range | GP minus SBK residence time | Observed controlling behavior for GP0 |
|---|---:|---|
| 0–500 m | −0.65417 s | The GP gains on the first straight; a pass is attempted |
| 500–1,400 m | +1.06250 s | Traffic and own approach plan both constrain speed |
| 1,800–2,500 m | −0.67083 s | The GP gains on the second acceleration region |
| 2,500–2,900 m | +0.40000 s | Traffic binds for the entire 7.86250 s interval |
| 2,900–3,200 m | +0.64583 s | Own plan binds for 6.81667 s; traffic for 2.38333 s |
| 3,200–3,600 m | −0.25417 s | The GP regains time on the exit |
| 3,600 m–finish | +0.35417 s | Own plan binds for 6.19167 of 7.79167 s |

“Binds” means a cap is more than 1 m/s below both competing free/own/traffic targets. This is an analysis threshold only. It never affected a game input or rule.

The 2,500–2,900 m interval is particularly clean causal evidence: the target equals the lower traffic cap, the rider brakes, and all substeps have zero material drive cuts, zero steering-target support clipping, zero very-low-front-load episodes and zero 2G-demand saturation. Its lost speed is commanded by traffic planning. The final 400 m is a different branch: the own approach plan supplies the lower target for most of that interval. A single “throttle is still too low” explanation does not fit these observations.

## Throttle, demand and load response

On GP0's entire valid lap 2, the corrected steeringThrottle ceiling materially lowers the otherwise available throttle for only **0.26667 s**. The sideslip throttle ceiling does not materially bind. Native demand reaches its 2G ceiling for **0.21667 s**. Material physical drive reduction occurs for 26.35000 s, including acceleration regions where the GP gains time; that duration alone is not evidence of a fault.

The saved actual gpPedals inputs and native steeringThrottle returns reconstruct every sampled GP lap-2 throttle exactly: **maximum absolute reconstruction error 0**. This checks the recorded speed command, opening-rate ceiling, sideslip ceiling, steering ceiling and remaining-brake ceiling against the actual command.

The sampled planning-versus-steering correction magnitude differences are small on this source. GP0 lap 2 has mean absolute difference 0.0227670728 m/s², maximum 0.0911340296 m/s², and no 10 Hz sample above 0.1 m/s². This run does not support reviving an earlier broad planner/steering phase change.

## Concrete current-source lead: runway-driven traffic cap switching

The native planning calls contain a short, measurable switch from settle to follow and back while the own plan still permits a much higher entry speed:

| Native planner race time | Reported runway | Traffic rule | Traffic cap |
|---|---:|---|---:|
| 145.54086604925837 s | 696 m | settle | 88.32852120861573 m/s |
| 145.63253271592495 s | 108 m | follow | 74.89577094440038 m/s |
| 145.9075327159247 s | 648 m | settle | 88.47860435190174 m/s |

At the middle call, GP0 is at 2,182.134828 m, travelling 81.184053 m/s. Its supplied free pace is 89.837300 m/s. SBK1 is 71.346703 m ahead, travelling 72.647043 m/s. The blocker is −1. The earlier settle hold has expired, so the rule depends on the reported runway.

The subsequent actual control samples show throttle closing to zero, brake rising to 0.20, applied drive falling to zero, and front/rear load transferring from approximately 400/2,299 N to 1,752/835 N. The own next-profile speed remains above the actual GP speed. As speed falls, the reported own runway returns to Infinity, which passPace caps to the geometric runway; the traffic cap rises again, the lever releases, and throttle reopens. These are actual native calls and measured plant response, not a counterfactual race.

The source connection is precise:

1. `BikeAIDriver.limitSpeed` assigns `planRunway` to the first future profile sample below **current speed minus 1 m/s**; absent such a sample it stays Infinity.
2. `passPace` supplies the minimum of this value and the geometric straight runway.
3. `TrafficPlanner.evaluate` switches its slower-class cap between settle and follow at the existing `PASS_PACE.settleRunway` boundary, unless an existing settle hold is live.

A current-speed crossing of a local profile dip can therefore change a tactical runway by hundreds of metres, make the traffic cap brake, and restore the longer runway after that braking. Similar settle/follow switches occur later in the same recorded lap. The later native same-array replay in `profile-proof.md` isolates this speed-dependent discontinuity from station, geometry, grip and path changes. It does **not** prove that changing it will recover the required lap advantage safely, nor that it explains every sector-three loss.

The first straight also demonstrates that generic pass suppression is not the whole result: GP0 acquires SBK1 as a blocker at 40.147 m with a 43.768 m gap, then aborts for STRAIGHT ENDED at 357.991 m with 204 m reported runway and a still-positive 27.083 m gap. There are no completed GP passes in this race. Those actual events replace, rather than inherit, historical passing narratives.

## Recommended minimal next step

Keep the throttle-only candidate isolated. The later native profile proof establishes a focused candidate direction: make the scalar runway consumed by passPace describe a braking feature of the valid solved profile, rather than the first crossing of measured speed minus 1 m/s. A stateless upcoming profile trough/braking-event definition is the narrow candidate to specify in a native fixture. Its exact semantics need review before implementation; the solved speed caps and physical brake controller should remain authoritative. The supplied `planner-transition-window.json` contains the actual recorded scalar call inputs, selected planner state, outputs and nearby control/load samples. It is not a complete TrafficPlanner restoration snapshot, and no full evaluate replay was attempted from it.

Do not start with gains, grip, class pace, pass thresholds, test bounds, controller geometry or timeouts. A profile-feature definition may hold a conservative short runway through this mild dip, so a lap-time improvement cannot be promised. A correction still needs its own native negative/positive evidence, unchanged original race gates and source stability. Own-plan losses near 2,900–3,200 m and the final 400 m remain a separate unresolved contribution.

## Evidence and reproducibility

`trace.json.gz` is the lossless full trace (72,288,296 bytes restored). It contains 11,706 six-rider 10 Hz snapshots, all 6,283 unfinished GP native planner evaluations, all 42 native lap/sector events, source receipts, method invocation counts, and full-substep 100 m aggregates. Non-finite numeric telemetry is encoded explicitly as strings. Fixed-size planner arrays may retain stale tails; the report does not treat those tails as valid evaluated candidates.

`observer.json` is the original outer guard receipt. Its `passed: true` describes the diagnostic command, not the original race acceptance. `analysis.json` and the two CSV files contain the computed findings. The observer and analysis programs are included. The offline analyzer never imports game code or advances a simulation.

The exact guarded invocation is in `observer.json`. Reanalysis, after restoring the trace, is:

```sh
python gp-throttle-mixed3303-analyze.py trace.json ./analysis-output
```

`copy-provenance.json` maps every compact payload to its original uncompressed bytes and hashes. All compressed payloads were decompressed and byte-compared during packaging. `SHA256SUMS` freezes the package.
