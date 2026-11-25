# W09F — publication, ancestry and source provenance

Assignment **54/60**, wave 9. This independent audit passes for published
candidate `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`, tree
`5f466294eca0b188db58375a1caf4cd76088527b`. It verifies preserved history,
available publication receipts and recorded source identities. It does not
certify a future documentation tip or substitute for compiler, build or native
acceptance at this candidate.

The complete checks, actual path lists and hashes are retained in
[`evidence/publication-audit.json`](evidence/publication-audit.json). This
assignment changed only that evidence file and this report. Git and GitHub
operations were read-only: no fetch, checkout, index, branch or ref mutation;
no compiler, build, test, timing workload, asset generation or child agent.

## Preserved history and remote observation

The original baseline `350119e8ec0606e8c5de5b3ab80df41104025679` is an
ancestor of the candidate. The local repository is shallow and does not contain
the earlier implementation object `9119c7683d821d145f15ed64a03ee3406595b58d`.
That absence was not treated as an ancestry failure. An independent
[GitHub comparison](https://github.com/cheshmakzanoon-ops/Experiment-3/compare/9119c7683d821d145f15ed64a03ee3406595b58d...350119e8ec0606e8c5de5b3ab80df41104025679)
reports one commit ahead, zero behind, and merge base `9119c768`; its returned
baseline commit has that earlier implementation as its sole parent. Together
with the local chain, this establishes continuity from the preceding engine
work through the current candidate.

The first-parent chain after the baseline contains **21 commits**: the prior
programme's documentation publication, nine current audit/implementation/
acceptance publications, and **11 CI-report commits**. All eleven CI commits
change only `ci-reports/`. Every non-CI commit in this interval preserves its
parent's entire `ci-reports` subtree. In particular, `714632a`, `769b9bf` and
`691d3a1` remain ancestors; no intervening report branch was discarded.

The independent remote-ref observation found main at
`ac4367bdf9a98a34a1123d7a325df41587a690e9`, whose sole parent is the audited
`774e62fa` candidate. Its 25 changed paths are all under `ci-reports/`.
The report writer removes older browser/owner-QA excerpts while updating its
latest result; those historical contents remain in ancestor Git objects.
This later report commit was communicated to the coordinator for preservation.
The audit did not fetch it or move the local checkout during another agent's
source comparison. The remote observation is a point-in-time fact, not a claim
that main cannot advance again.

## Available publication receipts

Five durable receipts are available in the coordinator's session directory.
Their commit parents and tree IDs match the actual Git objects, and every
receipted commit is an ancestor of the candidate.

| Receipt      | Published commit | Recorded parent | Changed paths | Result                                |
| ------------ | ---------------- | --------------- | ------------: | ------------------------------------- |
| Checkpoint 4 | `9922926`        | `909f549`       |            36 | Parent, tree and recorded count match |
| Checkpoint 5 | `6a1c76f`        | `aaaf500`       |            36 | Parent, tree and exact path set match |
| Checkpoint 6 | `6cb1c88`        | `fd8cb3f`       |            44 | Parent, tree and exact path set match |
| Checkpoint 7 | `26efaeef`       | `714632a`       |            49 | Parent, tree and exact path set match |
| Checkpoint 8 | `774e62fa`       | `691d3a1`       |            23 | Parent, tree and exact path set match |

Checkpoint 4's earlier receipt contains an entry count, not a path list. Its
complete actual 36-path diff is therefore retained in this audit, while exact
receipt-path equality is correctly marked unavailable. No claim is made that
missing earlier scratch receipts were independently inspected. Their Git
commits and ancestry remain available and are included in the full chain.

These checks establish exact published objects and preserved ancestry.
Git objects alone do not record whether an API request used `force: false` or
an expected-parent lease. The available durable receipts do not include an
independent transport log of those mutation flags. The coordinator's recorded
publication procedure uses them; this audit does not overstate parent/tree
verification as independent proof of every historical HTTP argument.

## Candidate source versus the preceding checkpoint

`26efaeef` and `774e62fa` have the **same complete production subtree**:

```text
src tree: 2d1bcc0f9b29f06761b8eb5c650bbbb53dd159a3
```

There are no changes between them in `src/`, `e2e/`, `scripts/`, `.github/`,
dependency manifests, TypeScript configuration, or the Vite/Vitest/Playwright
configurations. The executable-input changes are exactly five test files:

- `engine-ui-opening-review.test.ts`: the explicit `unknown` bridge at the
  deliberately constructor-free fixture boundary.
- `engine-cross-mode-startup.test.ts`, `engine-festival-frame-pacing.test.ts`,
  `engine-network-advancement-composition.test.ts`, and
  `engine-page-lifecycle.test.ts`: formatting changes.

The W09B evidence records identical raw emitted JavaScript for the cast repair
and identical emitted JavaScript after the stated whitespace normalization for
the four formatting changes. This audit independently matched its before/after
source hashes to the `26efaeef` and `774e62fa` Git blobs. It did not rerun those
compiler/emitter checks. C8 is consequently **production-identical**, but it is
not a documentation-only revision: its corrected test inputs still require
their own full semantic and CI result.

## Measurement source provenance

Eight canonical measurement artifacts were inspected. Every recorded commit
is an ancestor of the candidate. Across their deduplicated manifests, **510
repository commit/path/hash entries**, **22 installed-dependency entries** and
**nine workload/helper files** matched their recorded bytes. Workload/helper
bytes also match the candidate's committed versions. There were zero source
hash mismatches. No benchmark or timing workload was rerun.

| Measurement                  | Recorded current source | Recorded current inputs changed at `774e62fa` |
| ---------------------------- | ----------------------- | --------------------------------------------- |
| W07 lane                     | `aaaf500`               | None                                          |
| W07 surface                  | `aaaf500`               | None                                          |
| W07 network                  | `6a1c76f`               | `src/net/server.ts`                           |
| W07 audio                    | `6a1c76f`               | None                                          |
| W07 attribute ranges         | `6a1c76f`               | `src/rendering/attribute-ranges.ts`           |
| W07 combined simulation      | `6a1c76f`               | None                                          |
| W08 snapshot crossover       | `6cb1c88`               | `src/net/server.ts`                           |
| W08 revised attribute ranges | `26efaeef`              | None                                          |

The differences are deliberate reviewed refinements. W07's original range
measurement is historical evidence; the W08 follow-up measures the revised
helper. The server's later twelve-recipient routing policy must be described
separately from measurements of the ordinary and prepared codec variants.
An earlier source's timing is not automatically a whole-server or final-policy
timing merely because the codecs remain unchanged.

Lane, surface and simulation source initialization captures the actual current
HEAD without requiring a caller-supplied expected-current revision. The helper
then checks that HEAD, every recorded input byte/hash, and relevant Git status
remain stable. This audit verified those captured identities against their
actual committed blobs. Optional absence of a preselected current revision is
recorded separately from a conflicting revision or dirty source; no conflict
was found. All present expected-revision values match their captured commits,
and the recorded graphs are clean.

This source audit does not establish the scheduler's isolation from unrelated
host work, revalidate every numerical claim, or turn local CPU measurements
into native GPU, physical-device or game-wide frame-rate evidence. Those
measurement limits remain in the subsystem reports and W10 claims review.

## Checkpoint and validation provenance

The six archived checkpoint source/tree/lock receipt sets match their actual
ancestor Git objects and dependency-lock bytes. Their status distinctions are
preserved:

| Source     | Focused unit result  | Native result in its archive | Overall checkpoint |
| ---------- | -------------------- | ---------------------------- | ------------------ |
| `b594cfc`  | 579 tests / 48 files | 37 passed                    | Success            |
| `955bc20`  | 813 tests / 62 files | 37 passed                    | Success            |
| `9922926`  | 820 tests / 65 files | 41 passed, 4 failed          | Failure            |
| `6a1c76f`  | 820 tests / 65 files | 45 passed, 2 failed          | Failure            |
| `6cb1c88`  | 820 tests / 65 files | 46 passed, 1 failed          | Failure            |
| `26efaeef` | 914 tests / 70 files | Skipped, zero executed       | Compiler failure   |

At `26efaeef`, TS2352 prevents the chained Vite build and all native stages.
Earlier native passes are not substituted for that source. At this handoff,
the coordinator reports that corrected-source workflow **45592833399**, job
**139131185041**, has passed focused units and full TypeScript/Vite build while
its native stage is still running. The actual corrected-source artifact and
final acceptance belong to W09B/W09C; this audit does not claim it has already
inspected a final native result.

Even a later passing shared-gate case must retain the distinction between its
strict test-only `vec4` image witness and the recorded MeshBasic/`vec3`
software-renderer diagnostic limitation. None of these receipts validates
physical hardware. The larger repository's failures and cancellations remain
the separate W09D classification scope.

## Read-only refresh for the final documentation tip

The coordinator should preserve the observed CI-report descendant before
publishing final documentation, then inspect the actual published tip. The
following checks are read-only; replace the two full SHA values with the
eventual verified values. Do not use an unfetched remote-tracking ref as a
substitute for an API-observed published commit.

```sh
audit_tested=774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86
audit_final=REPLACE_WITH_ACTUAL_PUBLISHED_SHA
git merge-base --is-ancestor "$audit_tested" "$audit_final"
git show -s --format='%H %T %P %s' "$audit_final"
git diff --name-status "$audit_tested" "$audit_final"
git diff --name-only "$audit_tested" "$audit_final" -- \
  src tests e2e scripts public .github package.json package-lock.json \
  tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts
```

For a documentation-only refresh, the complete changed-path list must be
confined to `docs/` and `ci-reports/`; the executable/configuration/content diff
must be empty. Record the tested source commit and later documentation tip
separately. If any other path changed, inspect and validate that actual change
instead of inheriting an earlier exact-source result. Compare the final remote
ref and its parents again, because CI may publish another report meanwhile.

**Acceptance:** ancestry, available publication receipts, source identities
and preserved report history pass at the identified candidate. Final native
acceptance and the eventual documentation tip remain explicitly separate.
