# GP pace: pure history versus the admission reservation

## Finding

The 220 m admission reservation changes racecraft and the paths the field takes. It does not remove the GP's underlying free-air pace advantage. The observed class-margin reversal combines **1.000855 s lost by the fastest GP** and **0.640418 s gained by the fastest superbike**. Both mixed trajectories finish with zero falls and zero completed GP passes.

The strongest measured planning issue preceding either trajectory's divergence is circular: the following cap holds a GP at or below the leader's speed while admission requires it already to be closing at 1.5 m/s before choosing the lane that would release that cap. The sampled-frame road-relative intent defect identified separately is a second concrete path ownership issue. Its narrower correction should finish acceptance before any new reachability or passing-policy implementation.

This report is diagnostic evidence, not acceptance of any candidate. No production files, gains, skill, safety margins, or original assertions were changed for this analysis.

## Source identity and diagnostic run

The saved pure-history mixed trace is `../gp-history-mixed-traffic.json`. Its recorded directory name was subsequently reused for another candidate, so attribution is by hashes. Its embedded physics, AI, and adapter hashes match the preserved source at `/workspace/scratch/d611aefdb08c/w27-gp-history-candidate`. The matched solo trace independently records the same physics, AI, and original traffic hashes.

The new observation ran the existing read-only observer against `/workspace/scratch/0ab62d15db18/gp-history-admission-only-control`. Comparing all **930 production files** against the preserved pure-history tree finds exactly one difference: `src/simulation/traffic.ts`, containing the existing 220 m admission-reservation correction.

| File | Pure-history SHA-256 prefix | Admission-only SHA-256 prefix |
| --- | --- | --- |
| `bike.ts` | `8aaa0ede0ff7` | `8aaa0ede0ff7` |
| `motogp-physics.ts` | `2a3bac376e45` | `2a3bac376e45` |
| `bike-ai.ts` | `ffc70ab74e81` | `ffc70ab74e81` |
| `ai.ts` | `5be0791ac44b` | `5be0791ac44b` |
| `traffic.ts` | `58bbe1c1e66f` | `7180a18b826b` |

Full hashes and comparisons are in `source-comparison.json`. The new observer reproduced the original admission-only gate's best lap values exactly. Its complete 2,231-file source guard remained unchanged, process exit was zero, and elapsed time was 22.0375 s. **The observer's successful exit means its diagnostic completed; the reproduced race pace still fails the original assertion.** Its receipt is `admission-3303-observer-status.json`.

## Free-air pace and the exact mixed-race change

The existing matched no-traffic comparison uses the same seed, setup, and skill `.988` for both classes. It records GP-R1 at **86.4281102464 s** and SBK1000 at **88.4180704369 s**, both with zero falls. This is evidence of a 1.9899601904 s class advantage in that comparison. It is not an identical counterfactual for mixed-grid rider 2: rider identity, grid role, and traffic history also differ.

| Mixed race measurement | Pure history | Admission reservation only | Change |
| --- | ---: | ---: | ---: |
| Fastest GP, rider 2 | 90.3311284534 s | 91.3319836340 s | +1.0008551806 s |
| Fastest SBK, rider 1 | 90.3573304271 s | 89.7169128641 s | −0.6404175630 s |
| SBK best minus GP best | +0.0262019737 s | −1.6150707698 s | −1.6412727436 s |
| Falls, all six riders | 0 | 0 | 0 |
| Completed GP passes | 0 | 0 | 0 |

Thus “the GP is 1.615 s slower” describes the new class comparison. It is not the GP's own loss relative to its previous trajectory.

## What first changes

The saved observations sample at 0.2 s intervals; action onset may fall between adjacent samples. The first sampled physical divergence is GP rider 0 around **t = 51.624 s, station 1,938.2 m**. The source difference changes its blocker from rider 1 to none:

| Native planner output | Pure history | Admission reservation only |
| --- | ---: | ---: |
| Decision | PASS / COMMITTED | RACING LINE |
| Blocker | 1 | none |
| Speed-cap rule | clear | settle |
| Traffic target | 95.3363 m/s | 77.2846 m/s |
| Held line-relative lane | 3.5703 m | 0 m |

At that point both current speeds remain approximately 63.438 m/s. The change is not simply a lap-time flag: blocker ownership changes lane candidates, their scoring, lane-change rate, and follow-cap behavior. The resulting physical trajectories then diverge.

GP rider 2 first differs around **t = 57.824 s**, after an existing straight-end abort. In the history run, blocker 5 is reacquired while `passTarget` stays −1, the held lane becomes approximately 6.24 m, and the traffic target is approximately 102.19 m/s. With the admission correction it stays on RACING LINE, has no blocker, and has a target of approximately 85.69 m/s. Full original rows for these windows are preserved in `causal-state-windows.json`.

## Where the fastest GP loses time

Linear interpolation of the 0.2 s observations places approximately **0.918 s** of rider 2's additional lap time in stations **400–800 m** on lap two:

| Station range | History time | Admission-only time | Extra time | Mean speed, history → admission |
| --- | ---: | ---: | ---: | ---: |
| 400–600 m | 2.4299 s | 2.9117 s | +0.4818 s | 82.56 → 68.62 m/s |
| 600–800 m | 3.3421 s | 3.7781 s | +0.4360 s | 60.14 → 53.18 m/s |

The admission-only rider is traffic-capped in every sampled frame in those two sectors, using a binding criterion of traffic target at least 1 m/s below both free and own planned speed. Only four of twenty-nine history samples are binding by the same criterion. The history rider is displaced from the racing line; the admission-only rider follows it. The admission-only native corner plan is more permissive there and its path correction is smaller, which points to traffic/path ownership rather than reduced tyre or engine capability as the immediate speed limit.

Over rider 2's complete second lap, sampled traffic-binding time rises from approximately **27.2 s to 44.4 s**. These are diagnostic sample estimates, not replacement gate measurements. The exact original best-lap difference remains the value in the table above. `lap-sector-comparison.json` contains all sectors and their assumptions.

The whole field is not explained by one follow-cap total. Rider 0 becomes 2.3541 s slower despite less sampled traffic-binding time, with substantial loss through stations 1,200–1,800 m and larger path corrections. Rider 1 becomes faster. Those later changes involve different path/field histories; this analysis does not isolate all of their downstream mechanisms into a single cause.

## Concrete unresolved planning dependencies

### Following prevents the closing speed needed to initiate the move

Before the two runs diverge, GP rider 0 has a repeated straight-line opportunity with a small gap. At **t = 7.624 s**:

- Gap to SBK rider 1: **19.8007 m**.
- Existing settling reserve: **23.0394 m**.
- GP speed: **52.1577 m/s**; SBK speed: **53.9152 m/s**.
- Native GP traffic target: **53.7322 m/s**, slightly below the contemporaneous SBK speed.
- Advertised free speed/runway: **91.08 m/s / 720 m**.
- Existing gain calculation after reserving 220 m: **103.7850 m**, versus **31.8007 m** required.
- Actual closing speed: **−1.7575 m/s**, failing the unchanged `closeMin = 1.5` requirement.

This pattern persists for approximately 2.2 s while the available advertised runway falls to 600 m. Rider 2 repeats it around t = 9.224–11.024 s. The candidates satisfy the sampled class, gap, corridor, gain, and runway checks but cannot satisfy the current-closing-speed check while held behind the leader. This is a specific dependency to investigate; it does not prove that a safe pass can actually be completed from those states. The advertised runway and free-speed feasibility still need physical verification.

The offline scan uses a corridor narrower than the actual mixed-class corridor and records phase limitations explicitly. Its data are in `closing-admission-bottlenecks.json`.

### A blocker can be reacquired during a recorded retry ban

The history trace records rider 2 aborting STRAIGHT ENDED around t = 57.424 s, then reacquiring blocker 5 by t = 57.824 s while `passTarget` remains −1. The original rule reserves an eight-second retry interval after a straight-end abort. Code inspection explains the split:

- `trackPass` checks `now < retryAfter` before starting the recorded attempt.
- Earlier blocker selection does not check that retry interval.
- A blocker still adds passing lanes, selects a clear lane preferentially, uses the fast lane rate, and extends `settleUntil`.

The recorded retry ban therefore does not suppress all of the actions associated with a new paced pass. This helps explain why denying an infeasible or aborted attempt can remove speed even when no pass ever completes. Fixing it has not been implemented or shown to improve the original pace gate; it must not be sold as a validated pace correction.

## Prospective reference-speed question

The completed approach profile is a maximum admissible speed by future station. Finding where it drops below `max(currentSpeed, freeSpeed) - 1` certifies a conservative corridor for that constant reference speed. A rider still accelerating can remain below the profile beyond that crossing. The unchanged `0.4` gain factor separately discounts the nominal free-speed difference over the opportunity.

Saved, fully valid 128-sample native profile probes show the conservatism directly:

| Station / current speed | Free speed | Current-speed crossing | Free-speed crossing | Free-speed advertised runway |
| --- | ---: | ---: | ---: | ---: |
| 1,876.55 m / 57.22 m/s | 91.08 m/s | 864 m | 588 m | 588 m |
| 1,838.82 m / 52.84 m/s | 89.10 m/s | 936 m | 648 m | 648 m |
| 165.06 m / 68.88 m/s | 91.08 m/s | 528 m | 372 m | 372 m |
| 1,901.51 m / 60.34 m/s | 93.85 m/s | 816 m | 528 m | 528 m |

The existing 720 m ceiling still applies; the longer current-speed crossings are not permission to advertise more than 720 m. The overspeed control, current speed 95 m/s versus free speed 91.08 m/s, has the same 384 m crossing under both rules.

These are earlier controlled native profile probes with aligned pose, not an exact reconstruction of the current pure-history race states. They establish different conservative bounds, not a physically reachable overtaking trajectory. Combining a constant free-speed horizon with an acceleration-discounted gain can be more conservative than a coupled reachable trajectory; it is **not by itself a dimensional contradiction or proof that a rejected pass is feasible**. The read-only extraction is `prospective-reference-review.json`.

## Deferred reachability proposal

The smallest prospective extension to investigate is to retain the same `closeMin` threshold but evaluate it at the existing predicted lane-clear instant, using actual reachable drive rather than instantly assigning `freeSpeed`. Existing swept collision checks, lane rate, lane pad, close gap, longitudinal caps, gain factor, and 720 m ceiling would remain authoritative.

The current source already supplies native engine torque, gear ratio, driveline efficiency, tyre/load state, drag, and current longitudinal acceleration. However, raw full-throttle engine torque is not a sufficient reachable-acceleration estimate. The physical plant additionally applies the rider's throttle/lever rates, steering support reserve, traction and wheelie limits, current force-pair load transfer, and gradient. The opponent's motion also matters. A proposed predictor must respect these before a future closing-speed comparison is credible.

No prediction helper or admission policy was implemented. No native positive/negative reachability pair was run: the work was explicitly stopped at that boundary when the narrower history-plus-relative-intent source passed its three initial controls and entered broader acceptance. A future change still needs a measured state that truly reaches `closeMin` after the lane clears and a genuine unable-to-close state that the predictor rejects.

## Verification performed

One additional full diagnostic observation of the exact original 3303 admission-only trajectory was run, using the existing observer under the repository source guard. It exactly reproduced the original failed pace values. The pure-history race and solo comparisons were reused from existing evidence. Subsequent work was read-only source comparison and analysis of saved observations/profiles. No additional full race, production edit, gain trial, or assertion change was performed for the reachability proposal.
