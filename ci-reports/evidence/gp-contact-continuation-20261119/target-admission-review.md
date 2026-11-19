# Independent target-admission review

Reviewed the uncommitted `gp-runway` target-only admission diff against history-only base `0594a2b43b9a2769085efa1e1835243927fbb705`. Exact reviewed hashes are in `target-admission-review-receipt.json`. This review did not edit production source or run a race. Engine-owned native gates were still running at review time.

## Finding

No source blocker found in the narrow implementation. Only admission of the new lean target uses the dimensionless support/reaction history. Current physical loads, current stopping capacity, recovery, the stopping-work expression, current-strain observation and the raw rider-request reserve expression are unchanged.

The newly separate `gpReserveTarget` stores exactly the original supported target before admission. The existing nominal allocator floor consumes that value, while the roll controller receives the admitted target. This avoids the saved-trajectory regression where reducing the target also releases up to 3.312085 m/s² of nominal allocation reserve. It does not introduce the rejected paired candidate's admitted reaction or admitted stopping-work function.

The per-step reserve target is overwritten by every live `gpSteer` call before longitudinal allocation. The unchanged `gpAssistLive` gate prevents stale reserve values from being used in manual, walking, airborne or recovery paths. Placement/remount and leaving optional road contacts reset the new fields through `resetRoadControl`; support loss makes the ratio zero, and returning support uses the existing 1/9-second response. The only production call to enable GP physics is during vehicle construction, so the new state begins at its Infinity reset sentinel.

The nonbinding target path retains the exact old `atan2` arithmetic. Across the 959 saved native rows, the implemented binding `atan2(margin * admitted * reaction, reaction)` differs from the offline `atan(margin * admitted)` shadow by at most 1.11e-16 rad in one row. No computed admitted limit exceeds the original native supported limit in those rows.

## Fixture and control review

The two new saved states are exact copies of native incoming `entryState`, input and timestep at tick 9829 / substep 1 and tick 9864 / substep 2. Their expected signed front/rear longitudinal forces match the original plant calls exactly. The test mirrors both signs and validates the preserved original target floor and actual applied force pair. It also covers support disappearance, returning full physical force, common-mode load changes, placement/remount, and inactive-assist stale state. The six recurring front-unload/reload patterns retain the prior native patterns and limits at 120 and 240 Hz.

The implementer addressed the test-strength suggestion during review: the saved-onset case now asserts the changed actual front inverse request from the saved admitted lateral request and the single native rear preview, including an increase in the arrest direction. The first native attempt also exposed JSON's loss of signed zero; the test now expects the native front-brake zero as `-0` explicitly. Production source was unchanged by these test corrections. The follow-up test hash is retained in the review receipt.

No closed-loop acceptance follows from this review or the saved-state shadow. The original controls and complete race gate remain required. Accepted physical changes also require the parent-owned simulation identity update.
