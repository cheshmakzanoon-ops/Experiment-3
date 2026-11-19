# Independent review of minimal history + relative intent

**No functional blocker found in the reviewed cache change.** The original race gates are separate; the coordinator's original trio passed and its broader original 51 run was still pending when this review was finalized.

## Source scope

The candidate is `/workspace/scratch/0ab62d15db18/gp-history-relative-only`. Every file in the captured whitelist matched at review start. Against the graphics/startup boundary 5fb2, the only production differences are `ai.ts`, `bike-ai.ts`, `bike.ts` and `motogp-physics.ts`. Against preserved history, the simulation differences are only `ai.ts` and `bike-ai.ts`; the other five rendering differences are inherited from the 5fb2 baseline.

The force files retain Bike 8aaa and MotoGP 2a3. Traffic remains the original history 58bbe source. There is no 220 m admission change, extended passing profile, current-path handoff, selected-path snapshot, temporal-heading term or wet-path helper change.

## Native negative controls

| Isolated mutation | Result | What fails |
| --- | --- | --- |
| Restore only the old `desiredOffset - lineHere` road consumption | Actual guarded exit 1; 2 fail / 1 pass | Both nonzero slope cases produce 0.025 m unwanted lane displacement; the flat control passes |
| Remove only `!preparingPit` from road-intent capture | Actual guarded exit 1; 1 fail | The cancelled pit approach leaves 0.85572053 m of pit-derived intent instead of the independently sampled 0 m road lane |

The unchanged adapted tests were copied with their exact hashes. Each negative changes only `src/simulation/ai.ts` in its own source copy. Both copies remained stable under their own source guards. No race or broad suite was run by this reviewer.

The three generator cases prescribe independent analytic flat/sloped geometry while retaining the real planner and complete driver update. They require repeated tactical samples and held frames, then inspect lane motion and steering. They no longer depend on selected-path metadata. The pit test uses actual Montejaral geometry and planner decisions; a fixed pose isolates handback between coordinate frames.

## Review findings

Ordinary road decisions retain a lane relative to the authored path at the decision station. Absolute `desiredOffset` remains available to preparing-pit approach and `pitApproachTrafficSpeed`. The road-only guard prevents a pit corridor from contaminating that saved road intent. The existing stalled-car launch fold and low-speed bypass branch remain intact. The default false hook keeps cars and non-GP drivers on the prior expression.

These checks establish the cache's coordinate contract. They do not establish force integration, clipped-edge geometry, wet-path ownership or full-race acceptance. No gains, grip values, original gate assertions or test timeouts changed.

## Comment-only active-source update

The coordinator corrected a misplaced comment after its initial guarded runs completed. That update occurred during the second isolated negative, so the recorded active-candidate aggregate correctly differs before/after. A direct comparison verifies that only the two documentation lines changed. The isolated copies retained their earlier Bike-AI hash and stayed unchanged; their results were not transferred to later bytes. `comment-only-update.patch` and `receipt.json` preserve that distinction.

The positive native and trio JSON receipts are copied as coordinator-observed execution evidence. The only new runs performed for this independent review are the two native negatives above. `SHA256SUMS` covers all files except itself.
