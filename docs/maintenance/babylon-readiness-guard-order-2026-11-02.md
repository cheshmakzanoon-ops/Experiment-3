# Settled-readiness guard ordering

The live A09 Linux run at f9b71f7 completed startup and same-scene restart, then
lost its GPU process with the first authored-model draw pending. All 318 shader/
upload preparations were already complete. This patch does **not** establish a
cause or repair for that failure.

The paused RAF settled predicate previously scanned the exact grid and A09
resource receipts before checking `presentation.pending` and `graphics.settled`.
With a model presentation token held and a GPU draw unfinished, those existing
cheap requirements already force false. The patch moves only the two validators
to the end of that same conjunction. It avoids redundant CPU work on paths that
cannot publish readiness, potentially reducing CPU contention on software GPU
backends; no timing or native stability benefit is asserted.

For the actual typed Boolean diagnostics, the readiness truth conditions are
unchanged. Both exact resource validations still execute on every potentially
ready path (A09 retains the existing short-circuit when grid validation fails).
There is no cached success, sampled validation, changed resource acceptance,
request, frame, receipt, fence, compiler, deadline, driver or security policy.
Public scene-ready, model gates and private retained-restart proofs are untouched.

The existing validators read CPU arrays, cached matrices, registrations and
material/texture/plugin identities; they do not prepare, render, request frames,
query texture readiness, or mutate the later cheap predicate inputs. This
ordering relies on that observational contract and the actual Boolean
`graphics.settled` type, not on arbitrary malformed diagnostic objects.

Tests extract the actual publication expression, cover all 262,144 Boolean
combinations of sixteen cheap requirements and two validator results, require no
full scan for each already-false cheap guard, and require fresh validation and
mutation rejection after a successful ready result. The initial source fails
nine call-count regressions; its Boolean truth table already passes.

## Frozen local checks

The reviewed three-file candidate passed 210 focused tests in five files, full
TypeScript and canonical lint. The full workflow-selected union passed 1,092 tests
in 66 files; the production build passed with its existing chunk-size warning.
All 35 browser cases in 11 files were discovered, not executed locally. Original
red call-count logs and the unchanged-source manifest were retained. Fresh
rendering/native evidence is required before claiming a runtime benefit.
