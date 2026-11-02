# GPU job scheduling without a workflow-wide lock

The six actual test shards of `1f1be9d3` completed, preserving all artifacts:
32 existing cases passed and the three A09 cases failed the diagnosed submitted-
shader guard. Its `verify` summary remained queued with no steps. Corrected
`81af5607` then remained pending with no jobs behind the branch-wide workflow
concurrency group. No old aggregate pass is inferred from the shard results.

## Bounded scheduling change

Concurrency now belongs to the GPU matrix job, keyed by branch and suite, rather
than the entire workflow. `cancel-in-progress: true` still cancels obsolete heavy
work within each suite. A queued summary therefore cannot hold a workflow-level
lock needed by a later commit's test jobs. GitHub explicitly supports matrix
context in [job-level concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The verifier's original `always()`/branch condition, `needs: gpu`, and
`test '${{ needs.gpu.result }}' = success` command are byte-identical. Failed,
cancelled, skipped or missing dependencies do not qualify. All six required
selectors, 35 browser cases, runner choices, deadlines, artifact policy and
read-only permissions remain unchanged. Native workflows are untouched.

This removes a structural dependency, not a guarantee of runner capacity,
execution ordering or service availability. Already queued historical runs may
remain queued until GitHub schedules or terminates them; their actual conclusions
must be recorded separately, never replaced with assumed success.

## Validation

A dedicated GPU-only CPU contract verifies per-suite/branch grouping, absence of
a workflow-wide lock, retained cancellation and unchanged fail-closed verifier.
The existing CPU command is unchanged; one additional required test step and its
path trigger were added. No native-triggering file changed.

The exact two-file patch passed 27 focused tests, actionlint 1.7.7, YAML semantic
comparison, formatting/diff checks, full TypeScript, canonical project ESLint and
desktop TypeScript. Independent review found no source blocker. Scheduling efficacy
and fresh rendering qualification remain to be observed after publication.
