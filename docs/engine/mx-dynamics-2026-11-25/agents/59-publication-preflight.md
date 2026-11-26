# Assignment 59 — independent publication preflight

**Result: PASS for the observed final candidate; no engine or scope blocker.**
This is a pre-publication result. It does not record a successful remote update,
browser run, GPU measurement, or complete hosted CI workflow. The remaining
publication conditions below belong to root and assignment 60.

The independently recomputed source fingerprint is
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`,
covering 1,129 source/build-input files. The comparison base is integrated main
`c9c94c7029dbc3e29b18101ef7ccea0a897184d1`; local checkpoint
`b2879248fbce047a299c45b84476adbcc3dbc71f` is provenance, not a published commit.
Full results, input digests, case identities and exact snapshot scope are in
[the machine-readable receipt](../evidence/59-publication-preflight.json).

## Concrete release contents

At this check, the candidate contained **184 paths: 61 code/test/benchmark files
and 123 documentation/evidence files**. These counts precede this report and its
receipt; final documentation additions require manifest regeneration.

| Selection | Files | Independent check |
| --- | ---: | --- |
| Runtime | 9 | Exact reviewed runtime set, with no other source change |
| Tests and test helpers | 46 | Exact closed publication allowlist |
| Benchmark scripts | 6 | Exact closed publication allowlist |
| This pass's documentation and evidence | 123 | Confined to `docs/engine/mx-dynamics-2026-11-25/` |

Every selected file is regular UTF-8 text. No deletion, executable-mode change,
symlink, unexpected path, binary, build output, dependency/cache directory or
temporary publication payload is selected. `test-results` stays outside the
candidate; the checked engineering receipts retain its raw-run provenance.

The independently reconstructed code/test/benchmark tree is
`48e2f2104d145ee02697f3232bfd663d6ba48aec`. Assignment 57's payload files reproduce
that tree and its prepared full documentation tree exactly. Every payload
element's content hash, blob ID, mode and successive tree hash was checked.
The provisional full candidate tree at this boundary was
`42d7bd2c324f05dedbd8bcbf03690cf6f4a39ff5`; it will change when this report and
later publication metadata are included. It is not the eventual publication
tree identity.

## Protected source and authored content

Complete Git tree entries and working files were checked, including legitimate
sparse-checkout absences. Nothing in the protected groups differs from integrated
main; all 291 authored asset/reference files also match the initial
`f3b39eb8e1b02fc0677086819fc384b6ceacefc2` baseline.

| Protected boundary | Files | Content/mode differences from integrated main |
| --- | ---: | ---: |
| Runtime outside the nine reviewed files | 1,117 | 0 |
| Authored asset/reference roots | 291 | 0 |
| Rendering except `wheel-pose.ts` | 714 | 0 |
| Explicit course, terrain, vehicle and jump definitions | 11 | 0 |
| Build/dependency/runtime configuration | 9 | 0 |
| All tracked paths outside the task scope | 9,524 | 0 |

The overlapping rows are not additive. For the protected source/asset/config
union, **1,381 materialized files** have independently recomputed matching Git
blob IDs and modes; **36 unmaterialized files** have the expected skip-worktree
flag and unchanged full-tree entries. No extra tracked, untracked or ignored
source/asset files were introduced in the protected roots. This verifies the
user's constraint against character, model, authored environment and asset edits.

The unchanged preservation runner and baseline were hash-checked against the
final receipt. All **five selected non-MX workloads, 6,005 complete snapshots and
16,477,720 snapshot bytes** compare exactly by their recorded digests and
checkpoints, with only the documented physics-identity normalization. This is
evidence for those selected workloads, not universal non-MX behavioral proof.

## Accepted tests and races still match the source

All **1,556 final full-unit input hashes and modes** still match the authoritative
receipt. Its before/after manifests and five raw run artifacts also retain their
recorded hashes. The 162 test files in the two final suites retain their recorded
contents, and the suite path sets are disjoint.

| Final local gate | Reconciled result |
| --- | --- |
| MX/offroad units | 155 files, 1,736/1,736 tests passed |
| Separate shared-core units | 7 files, 181/181 tests passed |
| Combined count of these two suites only | 162 files, 1,917 distinct passing tests |
| Changed-code lint | All 62 accepted input hashes still match |
| Strict types and production build | Final command receipts pass on the frozen source; the earlier types exit 137 remains historical evidence |
| Original default offroad matrix | 11/11 cases passed, exit 0, no failures, `OFFROAD_RACE` unset; all 1,387 observed input hashes/modes still match |
| Original full-grid matrix | 8/8 cases passed, 96 finishers, zero retirements |
| Exact four-lap Valley event | Passed, ten finishers, zero retirements |

The original race script is unchanged from both the initial and integrated
baselines. The default matrix receipt records the actual direct Node invocation;
the raw JSON's legacy `generated` label containing an npm command is not evidence
that an npm lifecycle command ran. Focused/contact/animation counts overlap the
full sweep and were not added again. Historical `a153c34d…` failures remain
historical and are not described as final-source results.

The accepted full-grid maximum stop remains 19.15 seconds against the existing
20-second bound. The report preserves this finite margin and the documented
reduced-model, sparse-impact reconstruction and approach-cadence limitations.
No new broad test run or stricter, unrequested acceptance requirement was added.

## Claims and publication authorization

Assignment 58's final README/integration reconciliation correctly distinguishes
local passing gates from the unsuccessful browser startup and unproven hosted CI
for the new source. It does not turn the CPU benchmark into a GPU/FPS claim, or
the default matrix pass into an entire hosted-workflow pass. The ledger records
01–59 as spawned at this boundary and 60 as planned; later completion requires
actual agent and publication evidence.

The user explicitly requested committing and pushing this work to main. **No
fresh user confirmation is required.** Root's planned fresh `expected_sha` and
non-force ref update is appropriate when paired with the refreshed main parent:
if main changes concurrently, reject the stale update and reconcile the new head
instead of overwriting it.

### Remaining publication conditions

1. Finish final documentation/status metadata, including this report and the
   actual assignment-60 spawn. Regenerate and verify assignment 57's manifest and
   payloads afterward. The manifest reviewed here was current before these new
   report files were written.
2. Read remote main immediately before publication. Assignment 54's approximately
   00:08 UTC observation of `c9c94c7` is historical, not a later update lease.
   Preserve any concurrent successor changes, rebase the prepared tree as needed,
   and revalidate acceptance if engine inputs change.
3. Compare the final API tree with the exact final local `git write-tree` result
   before moving main. Use the refreshed parent/`expected_sha` with `force: false`.
4. Have assignment 60 verify the actual published commit(s), remote tree, source
   identity, protected scope and observed hosted checks. Record pending or failed
   checks accurately; publication alone does not prove those checks passed.

These are publication steps, not unresolved engine defects. This assignment made
no Git mutation, source/test/asset edit, browser attempt or remote write.
