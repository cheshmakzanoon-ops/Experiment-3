# Assignment 39 — bounded engine work and repeated motion reads

## Decision and scope

The new contact search and supported refinement have explicit work limits. Their measured work on ordinary player flights is concentrated in endpoint terrain sampling; the rare bisection and extra support stages are a smaller share. The foot reader repeats seed validation for its three channels, but it performs no per-read object allocation and preserves stateless pause/seek behavior.

**No production optimization is proposed for this acceptance pass.** Operation counts identify future profiling targets; they do not establish a frame-budget defect or justify changing correct contact timing. This assignment changes only this report. No model, geometry, material, environment, terrain, specification, production source, test assertion or git state was edited.

These measurements apply to adapter SHA-256 `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`, before the coordinator's later assignment-40 grid investigation. They are not claimed as measurements of subsequent source changes.

## Method and fidelity

Task-local scripts import in-memory copies of the actual adapter and reader, adding counters at their existing operations. The repository files remain untouched. Each instrumented player run is compared with the complete result of the unmodified production module, including its physical trace hash. **All 16 paired runs are exactly equal.** All reported player scenario violations remain empty. The selected source fingerprints match before and after measurement.

The physics matrix uses the existing `runPlayerFlight` benchmark: MX250/MX450, Valley Ridge/Arena Nord, 120/240 Hz, and the Sport feedback/held-whip commands. It retains the actual player approach, departure, flight and settlement. It does not enable AI ownership or prescribe a flight pose. These short feature runs complement the full-lap and grid evidence; they do not replace it.

The motion matrix exports the existing controller-recording function in memory. Its body and input sequence are unchanged. Unused renderer imports are omitted from that diagnostic module because raw shader imports require Vite; no mesh rendering is claimed by this measurement. Four real 3.07-second practice recordings contain **48 accepted shifts and 368 retained frames**. Every sampled instrumented foot value equals the production reader exactly.

Browser and full-grid acceptance were running concurrently on the shared host. Consequently this report uses operation counts, not elapsed-time comparisons, FPS estimates, CPU utilization percentages or claims about garbage-collection pauses.

## Contact-search bound and observed frequency

The search evaluates both tyres at the beginning and end of a flight interval. A bracketed axle receives 32 bisections. Both axles may be bracketed independently, so the true worst case is **64 bisections**, not 32 in total. Including the beginning, endpoint and selected-event evaluations gives **67 free-arc evaluations and 134 terrain samples**, before ordinary event/endpoint resampling. This bound follows from the fixed loops; the measured matrix never reached the two-bracket case.

| Physics rate | Player steps | Sweep calls | Free-arc evaluations | All terrain samples | Calls refined to two stages |
| --- | ---: | ---: | ---: | ---: | ---: |
| 120 Hz | 3,240 | 1,617 | 3,570 | 24,453 | 68 |
| 240 Hz | 6,474 | 3,266 | 6,876 | 38,808 | 0 |
| Total | 9,714 | 4,883 | 10,446 | 63,261 | 68 |

The terrain count covers each instrumented scenario's setup, approach, flight and settlement, including ordinary solver/forecast sampling. Its scope is broader than the new sweep alone.

Across the 4,883 sweep calls:

- **4,843 calls** use only the beginning and endpoint: two evaluations and four terrain samples.
- **20 calls** accept an already supported initial boundary: three evaluations.
- **20 calls** bisect one crossing axle: 35 evaluations and 70 terrain samples.
- **Zero calls** bisect both axles.

The complete search contributes **20,892 terrain samples**, or **33.03%** of all terrain calls in these runs. The bisection loop itself contributes **1,280 samples**, or **2.02%**. The ordinary airborne endpoint checks therefore dominate this added sampling work. They establish coherent-time contact and should not be removed by reusing terrain samples from a different pose or timestamp.

The supported solver caps refinement at **16 stages**. In this matrix its maximum is two; the 120 Hz traces add 68 stages, refining 2.10% of their outer steps. All 240 Hz traces use one stage. Refinement refreshes the existing local force equations; it does not recursively run the world, tyre-ground solver, rider controller or terrain sampler.

## Allocation and query opportunities

Source inspection identifies two reusable surface-sample objects, each with its normal vector, created on every `firstFlightContact` invocation. Each free-arc evaluation also constructs the drag result, the finite-input validation array, two wheel results and its returned state. These are source-level temporary allocations; JavaScript escape analysis may eliminate some, so they are not a measured allocation or collection count.

Potential follow-up work, only after a target-device profile establishes need:

1. Keep the two sweep patch buffers on the vehicle, with explicit no-aliasing ownership and unchanged snapshot/replay results.
2. Use scalar finite checks in the drag helper if allocation profiling shows that its three-element validation array survives optimization.
3. Evaluate only the requested axle during each independent bisection. In the observed matrix this could remove 640 terrain queries, only about **1.01%** of the complete scenario count; it would not address the dominant ordinary endpoint work.

No such change was made. Each would need exact physical-trace comparison, including both-contact events and reset/reentrancy boundaries, before acceptance.

## Foot trajectory reader work

The production API reconstructs one of the selector angle, boot cover or boot clearance channels per call. Each call independently validates both recorded seeds and, when necessary, their event join. The actual controller recordings produced the following counts for each three-channel pose:

| Pose interval | Polynomial samples for one consumer | Observed poses across four recordings |
| --- | ---: | ---: |
| Neutral recorded event | 18 | 12 |
| One continuing accepted event | 21 | 936 |
| Interval containing the next accepted event | 39 | 144 |

In total, **3,276 field reads** perform **6,552 seed-validity checks** and **25,488 polynomial samples**. The existing rig and PresentedFrame both call the same three-channel reader, so their combined work doubles the per-consumer count when both inspect the same interval.

The code performs no object allocation inside the reader and has no mutable playback cache. A future pure, once-per-pose API could share seed and join validation across the three fields, retaining the same endpoint, fallback and event decisions. A cache keyed only by array identity would be unsafe because workers can reuse frame arrays and playback can seek or repeat samples. The measured counts do not establish that this duplication is a perceptible frame-time problem; assignment 35 separately establishes the actual rig's deterministic transforms.

## Reproduction and receipts

Temporary diagnostic files are in `/workspace/scratch/e91efca799c8/validation/engine-cost-a39/`:

- `profile.mjs`, `physics-counts.json`, `physics-counts.log`
- `foot-profile.mjs`, `foot-counts.json`, `foot-counts.log`

Run from the project checkout:

```sh
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/engine-cost-a39/profile.mjs
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/engine-cost-a39/foot-profile.mjs
```

The JSON receipts contain per-run counts, trace hashes, source hashes and exact instrumentation-equality results. Additional measured source hashes are:

| File | SHA-256 |
| --- | --- |
| `src/rendering/offroad/mx-foot-pose.ts` | `2bc6a16ba88d105f452e0f73231977f67fc5f3ff7b8bb57cad4ff845e287edb1` |
| `src/simulation/offroad/mx-gear-stroke.ts` | `a4f599f2a9088b5ceb03c3670db811de046bba1ee742a61b9028fcf3892d205b` |
| `scripts/bench/motocross-player-dynamics.ts` | `db0a432f1b1824b43095b446107a63112b9f0e8181781b2cdc940a1244f710eb` |

All diagnostic processes have ended. Source ownership remains with the coordinator and the explicitly assigned later implementer.
