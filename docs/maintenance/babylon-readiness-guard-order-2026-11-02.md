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

## Exact-source runtime result: `fc47782f`

[GPU run 41391688153](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41391688153)
passed all 35 cases and its aggregate. All six artifacts were SHA-verified; 548
isolated PNGs were byte-identical to `f9b71f74`. The live Restart reset tick 53 to
zero, advanced component 2 to 3 while preserving scene 2, and required new ready
completions 13/14. Its canonical state and full reset pixels were exact. Early
pause held tick 629 through real resize/redraw and completions 7/8/9, then resumed
at 658; the paused image was exact. Both decoded image hashes equal the prior
live source. All seven live preparation owners reported completed/can-draw with
no errors, including A09 ready/6/4950/exact scope.

Retained artifact 13118835767 SHA-256:
`eb19fcd4d4f0ff5793d2ff4d72e675a7beffcf7aa0854e0221a12fdc1e273281`.
These are correctness checks on SwiftShader, not a measured CPU/GPU speedup.

[Native run 41391688199](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41391688199)
passed Windows with all four compatibility journeys, original model/wheels/pause,
6/6 then 36/36 and 50/50 receipts, 318 preparations and component 2 / scene 1 reuse.
Windows artifact 13118196996 SHA-256:
`725f0ccd30c4942ee76700ff23ea9af362db6b02b8e505e01229882157ac7c3a`.

Linux passed the complete Babylon path: 6/6, 12/12 and 18/18; 318 preparations;
model presentation, wheel motion, pause and screenshot. It then failed graphics
health in retained `index.html` / Three.js Formula loading at tick zero, with the
first GPU exit 512 at 05:12:00.801 UTC. The saved healthy Babylon snapshot is not
evidence of health in the subsequent compatibility entry. Linux artifact
13117714321 was digest-verified. This is a failed overall native result, not a
Linux repair or evidence that guard ordering caused the different outcome.

macOS subsequently passed all four compatibility journeys and original model/
wheel/pause checks, with ready receipts 6/6, 35/35 and 43/43. It retained 318
preparations, component 2 / scene 1 reuse and A09 ready/6/4950/exact scope.
macOS artifact 13122935203 SHA-256:
`8625e593bdd0a7fc5278156c2bd929af849d5140fef5b72dd2b8ae3657976dc4`.
Linux artifact 13117714321 SHA-256:
`14ac06e17d71e45f82fc18d123dce73017bcbebd62419f0dbd55d590aa820d7b`.
All three packages identify source `fc47782f851db542ebca5a1c5e7304212fb85eaf`
and fingerprint `1c332596daeb5daaee4b096da99e3e9ebda39f01f464e3f27b1e0bd955a6073d`.
Native screenshots do not resolve the distant A09 stations. The overall native
workflow is terminal failure because Linux failed in retained Formula; the
all-platform download baseline remains `468c4cdb`, with no new release.
