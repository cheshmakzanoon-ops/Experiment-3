# Current-history parity: fresh exact-source result

**PASS: 5,760 of 5,760 paired state comparisons; actual guarded exit 0.** Both source trees remained unchanged. This is a new run on the current bytes, not a transfer of the historical d98e result.

| Side | Bike source SHA-256 | MotoGP physics SHA-256 |
| --- | --- | --- |
| Recorded remote production | `5bf7c5903f4b33ae306eedffc72e23f58ef85c4b5841f2a86153d80918102d9a` | `f43236152c81328f6bb0e0db6573235c492fcf2c8f5c2a84c3ca3976aa844e5b` |
| Preserved current history | `8aaa0ede0ff7cd94ee627dee0f9ecebefdef5a83904490677dfd2c13135225de` | `2a3bac376e45e7de10fdb06674cf4fbf145bbafc8058d62af7e0472d5881e22a` |

The baseline uses `graphics-local-validation`, whose tracked `src` content matches recorded remote commit cd9f2f5 exactly. Its production source is also that of published 2d67572. The receipt records the full commits, Git trees and direct SHA-256 comparisons with the remote Git blobs. No fresh network fetch occurred in this check.

## Modes and comparison

The original harness's inputs are preserved: its `BIKE`/`NOVICE` constructor preset, geometry, speed 30 start, varying lean/rider/throttle/brakes/drive, and alternating 1/120 and 1/240 second steps. Each mode runs both signs for 960 paired steps:

- Standalone GP: MotoGP chassis enabled, without road-contact loads.
- Non-GP road: the original synthetic front/rear contact-load sequences.
- Non-GP standalone: without those contact loads.

That is six completed cases, 5,760 paired comparisons and 11,520 actual `Bike.step` calls. Exact JSON-serialized enumerable state is compared after every pair. The only excluded property name is `previewFront` on the candidate side, matching the old scratch-field exclusion. No other field is omitted. JSON equality is not a comparison of non-enumerable fields, methods or IEEE representations erased by serialization.

**Road-contact GP control is intentionally outside these modes.** No traffic planner, race result or rendering behavior is covered. This parity pass does not accept the current-history candidate, whose original mixed pace gate remains a separate failure.

The small adapted probe changes imports/output handling and adds complete source hashes plus per-case bookkeeping. Its numeric inputs, mode conditions, constructor arguments, timestep and comparator are the historical ones. The historical harness is copied alongside it. `receipt.json` records the exact guarded command, observed actual exit, baseline attribution, and artifact hashes. `result.json` records every case and both source snapshots. `run.log` retains the actual command output.

A later reproduction must use the exact attributed sources and a fresh output path; the probe refuses to overwrite an existing result file. No test was run while packaging this receipt.
