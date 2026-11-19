# Current-contact observation with the reviewed AI handoff

Source `3e58984936a9e1ba2821580688a723fb93053fa4` is the exact five-file observer-only delta from `375cf3a`, applied to immutable contact/throttle source `7ac509f`. All original acceptance test files are unchanged. There is no new force allocation order, capacity model, reserve policy, gain, test bound or simulation-version change.

The original Ardennes1000 failure motivated a bounded paired recording and a native saved-state replay. The replay identifies a current-history forecast difference that survives the actual native inverse and steering-rate limit at tick10612/substep2. Other captured states reach identical clamps. This justified a small closed-loop candidate; the local command discrepancy itself did not establish race repair.

| Guarded check on this exact source | Result |
| --- | --- |
| Focused native scope | 72/72 passed |
| Original Ardennes1000 | Passed |
| Original snapshot | Passed |
| Original mixed3303 | Failed: GP92.15861774982307 s versus SBK89.90506409359712 s |

All four receipts have the same protected-input manifest and source-stability passes. The mixed race passed its preceding finish, incident and no-stuck assertions; its original GP-faster assertion failed, so the later 0.15-second advantage assertion was not reached. The conditional expansion to the other failed cases and full 51-case gate stopped at this known failure.

The complete logs and input manifest are compressed losslessly; every receipt pins its original log size and SHA-256. `source-identity.json` binds the commit/tree, checked commands and a source/test restoration patch from published main `ffd2259`. The patch is for isolated research and review, not a main integration proposal. `SHA256SUMS` covers retained evidence existing before this README.
