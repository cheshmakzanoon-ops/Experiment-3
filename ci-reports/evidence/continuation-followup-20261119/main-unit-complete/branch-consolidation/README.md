# Branch-consolidation failure: preserved ancestry policy

[Run 44617126586](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126586), job `135888697304`, ran `.github/workflows/main-only.yml` from `ffd22598335dfa2a074ebd466e1d53830bb8bb41` and completed with failure.

Checkout and fetch succeeded. The first ancestry preflight failed with the explicit error: `Unmerged branch babylon-js retained. Integrate it before retrying.` The step exited 1 before the branch-deletion loop was reached. This is the workflow's intended fail-closed policy, not a runner, authentication, dependency-installation or syntax failure. No branch was deleted by this job.

GitHub comparison reads against exact main `ffd2259` establish:

| Branch and observed tip | Ahead of main | Behind main | Disposition |
| --- | ---: | ---: | --- |
| `babylon-js` at `3a25fe45640d84ded064c122b5015f0e0ad9827d` | 45 | 369 | Diverged; unique history cannot be deleted under the policy |
| `ci/high-late-startup-20261119` at `991cf4fc17f46e102318f25b643bc160789203a2` | 4 | 3 | Diverged; isolated unaccepted graphics candidate |
| `claude/fervent-edison-2fnn2i` at `ba97ffeba35abf62e366c5d5be35a0b31f3d183b` | 0 | 145 | Fully ancestral, but all-branches preflight prevents any deletion while another branch is unmerged |

`ancestry.json` retains exact comparison URLs, source SHAs, merge bases and counts. The complete decoded job log is `job.log.gz`; the immutable workflow is retained in the parent `source/` directory.

There is no evidence-backed infrastructure code fix to apply here without changing the policy. Removing the failing check, ignoring its exit, silently skipping divergent branches, or merging the failed rendering candidate solely to satisfy cleanup would weaken the existing acceptance boundary. The concrete next step is a reviewed integration/disposition decision for the 45 unique Babylon commits and the active graphics candidate. Any future cleanup must retain the existing ancestor preflight and expected-tip deletion leases.

This audit made no workflow or branch change.
