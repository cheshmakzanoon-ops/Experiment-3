# Worker 57 / Wave 10C — distinct-worker ledger and evidence audit

## Disposition

**Audit complete; release this worker slot.** No inconsistency was found in the retained registration identities, wave allocation, source checkpoints, evidence hashes or test-count boundaries. The latest document-integration check identifies sixteen newly introduced relative-link targets to repair before final acceptance, detailed below. This is the same worker 57 if resumed for final reconciliation; a followup must not create a sixty-first count.

**Latest actual inventory: 60 distinct assignments started, 57 coordinator-recorded complete.** Workers **1–56 and 58 are complete**; workers **57, 59 and 60 remain active** until their final handoffs are accepted. All ten waves now have six actual assignments. The coordinator has actually spawned worker 60; this is not a planned slot. This handoff completes worker 57's audit work, but root must acknowledge that completion in its execution record. The current strict receipt is [dated strict audit receipt](../validation/w10c-strict-pending-demonstration.json); final sixty-worker completion is still pending.

The earlier machine-readable snapshot [initial audit receipt](../validation/w10c-audit-initial.json) was captured at **2026-11-25 05:03:41 UTC**. It truthfully records its then-current **59 starts / 56 completions**, with worker 60 not yet started. It remains immutable historical evidence; the later actual inventory above supersedes it. Neither snapshot is retroactively rewritten to claim completion before the handoff.

The working and committed checkpoint-9 ledgers still record **51 started / 48 complete** at this snapshot. Their rows agree with one another. This is the documented full-source-freeze snapshot, not an assertion that later workers did not exist. Root is integrating documentation and will reconcile the ledgers from actual execution records.

## Counting and provenance

| Wave | IDs | Actually recorded started | Recorded complete at capture | Evidence boundary |
| --- | --- | ---: | ---: | --- |
| 1 | 1–6 | 6 | 6 | Original individual handoffs lost; coordinator execution record and explicit committed-code/plan reconstruction |
| 2 | 7–12 | 6 | 6 | Same lost-handoff limitation; first two actual commits retain implementations and regressions |
| 3 | 13–18 | 6 | 6 | All six original handoffs present; committed Wave 3 report and code/tests |
| 4 | 19–24 | 6 | 6 | All six original handoffs present; committed Wave 4 report and code/tests |
| 5 | 25–30 | 6 | 6 | All six original handoffs present; committed Wave 5 report and code/tests |
| 6 | 31–36 | 6 | 6 | All six original handoffs present; native receipts and Wave 6 report |
| 7 | 37–42 | 6 | 6 | All six original handoffs present; executable measurements, source manifests and raw observations |
| 8 | 43–48 | 6 | 6 | All six original handoffs present; six committed reviews and supporting regression/native evidence |
| 9 | 49–54 | 6 | 6 | Final units, static/build and native receipts; CI/scope review and documentation handoffs |
| 10 | 55–60 | 6 | 3 | 55/56/58 complete; 57/59/60 active |
| **Total** | **1–60** | **60** | **57** | **Final completion pending** |

All recorded IDs and task names are unique, IDs are contiguous from 1, and every ID has the required wave and `wXX[a-f]` assignment prefix. Each finished wave has six assignments. Worker 58 is `w10d_final_engine_review`; worker 59 is `w10e_publication_verification`. No planned future assignment was counted.

**Actual spawning and completion are attested by the coordinator's retained orchestration history, persisted into `state.json`.** This auditor directly knows its own distinct assignment and independently validates the record's identities, organization and corroborating work. The reset live registry cannot independently reconstruct all earlier process starts. A differently named report alone is not proof of another agent. Report files corroborate completed work; they do not replace the coordinator's actual spawn/completion records. The coordinator, followups/resumes, unstarted plans, and agents from the earlier task before baseline `1c609b` are excluded.

All **36 original worker handoffs for IDs 13–48** are present. Workers 1–12 have no original scratch handoffs. The draft [Waves 1–2 reconstruction](../WAVE01-02.md) appropriately labels its account as reconstruction from the committed plan, ledger, first two commits and their source/tests. No original quotations, historical test totals, timings or worker-specific discoveries are fabricated. Later tests of those implementations remain later evidence. The retained evidence does not independently establish lost workers' original execution durations or exact original test commands.

## Actual source checkpoints and preserved report history

Read-only local Git object inspection verified all nine state-listed checkpoint SHAs are real **commit objects**, with the exact documented trees, actual parent IDs and UTC committer timestamps. These are the actual published identifiers, not substitute locally constructed commits. The full identities are in [initial audit receipt](../validation/w10c-audit-initial.json) under `source.checkpoints`; the draft [commit history](../COMMIT-HISTORY.md) agrees.

The final tested code/test revision is **`9119c7683d821d145f15ed64a03ee3406595b58d`**, tree **`3b704f846c3283c21e73f8f5c3febf670a773c63`**. Production checkpoints **7/8/9** share the exact full `src` tree **`ad28ec3acb55feb301e13232614a14c4230abcae`**. The final tree contains **1,116 production leaves**, of which **29 differ from the task baseline**. Checkpoints 4/5/6 likewise share their measured production tree, so their historical measurements are not mislabeled as final-build measurements.

The actual checkpoint-9 parent is **`ec7f7ce0dc4361d27aa0ae141f7ca216d4c261e6`**. The locally reachable first-parent chain from checkpoint 1 through 9 contains **25 commits: nine programme checkpoints and 16 interleaved `ci-report[bot]` commits**. Each bot commit changes only the `ci-reports` root tree. Every programme checkpoint retains its actual parent's `ci-reports` tree. These metadata checks establish preserved concurrent report ancestry through checkpoint 9; final remote publication remains worker 59's separate responsibility.

`publication.json.head` currently names **`5f1ab00233bb28f814d3f71962707f95fe37eee1`**, a local integration identity. It is explicitly **excluded** from the nine published checkpoint list. Its payload tree matching the final tree does not make its SHA the published commit.

The independent final-endpoint metadata refresh compares the prior scope auditor's explicit **3,883 protected tracked leaves** against actual baseline and checkpoint 9. All have identical mode/type/blob identities. No binary assets were downloaded or read for this check. The underlying scope classification and per-method review remain worker 53's evidence; this worker did not redo all 107 code hunks or claim to inspect every authored binary byte.

History is shallow at the retained boundary. Metadata proves the named commits, retained intervening chain and endpoint trees; it does not prove unseen history, transient uncommitted edits or remote/runtime-loaded assets. Final documentation publication must retain the tested revision and identify its own actual commit separately.

## Non-overlapping presentation of overlapping validation

| Execution | Independently checked retained evidence | Correct interpretation |
| --- | --- | --- |
| Final local units, checkpoint 9 | Exactly **1,852 unique assertion identities in 128 unique physical files**, all passed; selection matches results; own before/after source receipt stable | One final invocation; historical and targeted reruns are not added |
| Focused CI, checkpoint 9 | Raw log **506 passed / 42 files**, exact commit/tree receipt, reported artifact identity/digest | These 42 files and 506 cases are entirely contained in the local 128/1,852 result; do not add them |
| Broader CI, checkpoint 9 | Four raw logs independently enumerate **901 distinct physical files**, **9,598 cases**, **9,594 passed / four failed** | Local 128-file inventory is a subset; this is a separate execution, not a second pool of unique tests |
| Published focused browser gate | Raw log **37 passed**, nine-file selection, Mesa llvmpipe receipt | Separate browser selection; keep distinct from unit counts |
| Final local native/replay gate | **37 unique cases / nine files**, every case passed once with retry 0; SwiftShader receipt; source and dist unchanged; same build identity as worker 50 | Same browser selection on another software backend; do not claim 74 unique browser cases |
| Final local static/build | All five existing checks exit 0; raw log hashes match manifest; exact checkpoint 9 product/full identity | Compiler/lint/build/budget/IP checks are not test-case counts |

Broad shard totals are **2,433 + 2,418 + 2,496 + 2,251 = 9,598 cases** across **226 + 226 + 226 + 223 = 901 files**, with no duplicated physical file in the parsed logs. The four failure names exactly match worker 55's independently baseline-established livery, catalogue/calibration, i18n and catalogue-growth partition. Their test-file Git identities remain unchanged from task baseline. The 35 task-associated fixture/contract failures are absent from these final broad logs; the historical 39-failure and initial local 34-failure records remain valid earlier results.

The final CI artifact's digest is checked against the retained API-reported metadata; this worker did **not** download or independently hash that remote ZIP. Worker 52's earlier checkpoint-7 artifact inspection remains separately source-pinned. No whole-repository green conclusion follows from the final four broad-unit failures or the still-separate browser/owner-QA status. The mixed-history night timeout remains unresolved.

Worker 49's aggregate source hash and worker 50/51's aggregate source hashes use different serialization algorithms. Their different strings are not a source mismatch. Each before/after pair is stable under its own defined algorithm, and exact Git/build identities supply the shared provenance.

## Evidence organization and precise limits

The draft's **27 copied evidence entries** match their declared sizes and SHA-256 hashes. A combined committed-docs plus draft-overlay check resolves **283 local Markdown link targets with zero missing targets**. This check validates target existence, not heading fragments; worker 54 separately checked heading/link structure. Dated handoff phrases such as “pending” must stay dated, with the authoritative final README/VALIDATION stating the reconciled outcome.

Original reports, raw unit/broad/native results and manifests remain in their assigned external paths; committed Waves 3–8 already retain their published evidence. A report's absolute scratch-path reference does not make that referenced file a published artifact. Root should publish its chosen evidence index/archives with explicit exclusions, rather than imply that entire baseline checkouts, dist, dependencies or large traces have been copied into the report.

During root's documentation integration, a subsequent strict run checked **299 link targets** and identified **16 missing relative targets in the newly copied `reviews/w10d-final-engine-review.md`**. They still resolve as scratch-relative `w10d-work/*`, `w10a.md`, `w09a-final/*`, `w09b-work/*`, `checkpoint9-ci.json`, `w09c*` and `w09f-draft/*`. The exact paths are listed in [dated strict audit errors](../validation/w10c-strict-pending-demonstration.json) and were reported immediately. Root should link them to the integrated evidence/archive index, or retain explicit historical scratch references as plain text when that evidence is not published. The original zero-error 283-link snapshot predates this new report and is not a claim that the integrated documents currently have zero errors.

The final tail is intentionally pending: workers 57, 59 and 60 must deliver and receive coordinator-recorded completion; the sixteen document targets must be reconciled; the coordinator must synchronize `state.json`, [AGENTS.json](../AGENTS.json) and [TASKS.md](../TASKS.md); then final source/publication receipts must name actual commits. Worker 58 has completed. This audit confirms sixty recorded distinct starts, not sixty completions.

## Rerunnable validator and final checklist

The lightweight read-only command is:

```sh
python /tmp/engine-c71f32882729/w10c-work/validate-ledger.py \
  --output /tmp/engine-c71f32882729/w10c-work/audit-final.json \
  --require-final
```

Run after all sixty actual completion records and working ledgers are integrated. The command checks identities and wave allocation; original-report coverage and honest lost-report exceptions; actual checkpoint trees/parents; preserved bot history; protected endpoint metadata; raw local/focused/broad/native count boundaries; copied evidence hashes; and current document link targets. It does not execute the product or tests.

Before integration, add `--draft-overlay` to resolve the worker 54 draft against its intended repository destination. After final publication, optionally add `--published-revision <actual-final-sha>` to check that commit's ledger, production tree and ancestry from checkpoint 9. Offline metadata still cannot independently verify remote visibility; retain worker 59's remote receipt.

Exit **0** means a consistent snapshot; without `--require-final`, it may truthfully remain pending. Exit **2** means strict final mode was requested while real recorded starts/completions or reconciliation remain pending. Exit **1** means an inconsistency or unavailable required audit input. The JSON always includes explicit `errors`, `pending`, counts, authority/limits and input hashes. Do not interpret an ordinary exit 0 as “sixty complete”; inspect the verdict or require strict mode.

Final acceptance requires:

1. Actual coordinator records contain IDs 1–60 exactly once, six assignments per wave, all complete; resumptions are not recounted.
2. [AGENTS.json](../AGENTS.json) and [TASKS.md](../TASKS.md) agree with that execution record. The immutable checkpoint-9 51/48 snapshot remains historical evidence.
3. Workers 58–60 handoffs and final source/publication decisions are actually present, with no planned completion substituted.
4. Final README/VALIDATION distinguish tested checkpoint 9 from later documentation publication, and retain four inherited broad-unit failures plus the unresolved broader browser limitation where applicable.
5. Strict validator exits 0; worker 59 supplies actual remote publication/tree verification and preservation of concurrent report work.

## Operations and deliverables

All work was read-only on the repository. No test, build, compiler, lint, benchmark, browser, network, external message, Git mutation or authored-content/tuning edit ran. Git metadata reads use `GIT_NO_LAZY_FETCH=1`, `GIT_ALLOW_PROTOCOL=none`, `GIT_OPTIONAL_LOCKS=0` and per-command `protocol.allow=never`. No full historical diff or missing-object fetch occurred.

Files: `w10c.md`; [retained validator source](../validation/w10c-validate-ledger.py); [registration anchor](../validation/w10c-registration-anchor.json); [initial audit receipt](../validation/w10c-audit-initial.json); [dated strict audit receipt](../validation/w10c-strict-pending-demonstration.json); [validator instructions](../validation/w10c-validator-readme.md). The initial audit returned zero errors and three truthful pending items in about 0.3 seconds. The later strict run returned exit 1 for the sixteen newly copied broken targets, plus pending workers 57/59/60 and ledger reconciliation; it correctly did not pass prematurely. No COMPUTE lease was used. **Worker 57 assignment complete; slot released.**
