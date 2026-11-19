# Desired-offset consumer review

This review concerns the preserved relative-intent candidate. It is a control-ownership review, not race acceptance.

| Consumer | Coordinate contract | Preserved behavior |
| --- | --- | --- |
| Ordinary road lane approach | Relative to the authored path at the traffic decision station | Hold the decision's sampled relative lane between traffic updates. Do not subtract the changing current authored offset from a cached absolute point every update. |
| Preparing-pit lane approach | Absolute lateral corridor | Keep `desiredOffset` absolute. |
| `pitApproachTrafficSpeed` | Absolute entry corridor | Keep its existing `desiredOffset` argument; this consumer is guarded by `preparingPit`. |
| Stalled-car bypass | Planner path-relative intent on ordinary road | The planner already projects `shiftAt(s) = line(s) - lineAtDecision`. Preserve its existing low-speed immediate-lane branch and launch-to-tactical fold. |
| Placement and long-gap handback | Rebase pose before motion capture | Establish launch from the actual placed lateral coordinate, then capture previous/current selected lane. A pose jump is not lane velocity. |
| Cars and offroad drivers | Existing contracts | The base hook returns false; the Bike override opts GP in. No new offroad path interpretation is claimed. |

The initial relative-intent implementation also overwrote the road lane with a preparing-pit plan, even though the planner uses an absolute corridor for that phase. Cancelling the approach before another tactical sample reused the corridor as a road lane. The narrow correction updates the relative cache only when `!preparingPit`; `desiredOffset` stays absolute. The included real-planner regression passes with that guard and fails when only the guard is removed, showing 0.85572053 m of stale pit-derived lane instead of the prior 0 m road lane.

The positive native test does not accept the relative-intent candidate: its original race triad was subsequently rejected by the physics owner. Earlier selected-path lifecycle proofs likewise do not accept that candidate. Existing receipt language is retained as the historical scope of each check.
