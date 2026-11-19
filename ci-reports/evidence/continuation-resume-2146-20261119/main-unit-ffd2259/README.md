# Complete native unit matrix — published main ffd2259

This package records attempt 1 of [Build and validation run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580) on exact source `ffd22598335dfa2a074ebd466e1d53830bb8bb41`, tree `cc67121b209279498206e4d575251ff866683ba9`.

**Complete execution, failed acceptance:** all 694 committed test files ran once; 6,755 tests passed and two failed. There were no pending or TODO outcomes. The two failures are the unchanged wet Poggio impact and mixed GP/SBK pace requirements. `summary.json` records the exact messages and assertion locations. Assertions after each failing expectation were not reached and are not reported as passing.

## Evidence and reproduction

- `unit-1.zip` through `unit-4.zip` are the original GitHub artifacts, each containing the complete native JSON reporter and test log.
- `job-1.log.gz` through `job-4.log.gz` preserve the full decoded job logs losslessly.
- `remote-metadata.json` binds run, jobs and advertised artifact digests.
- `artifact-receipts.json` records archive and member hashes.
- `source-provenance.json` binds the committed workflow, test selection, guard and failed test sources, plus the installed native Vitest sequencer.
- `inventory.json.gz`, `file-assignments.json.gz` and `all-test-outcomes.json.gz` retain the exact source inventory, partition map and every test result. Test identity is file plus assertion index; repeated titles are not deduplicated.
- `SHA256SUMS` records the 16 retained input/audit files. This README was added after copying the sealed package and is not itself an audit input.

From a checkout containing the exact source objects and the project's installed dependencies, run:

```bash
python /path/to/this/package/audit-units.py --repo /path/to/Experiment-3
```

This command reads retained artifacts and Git objects. It runs no tests and changes no application source, but regenerates derived audit files beside the script. It reconstructs native Vitest 3.2.4 partitioning, verifies all archive sizes and hashes, checks source identity and outer source-guard completion, and recomputes file and assertion totals.

The retained native test durations are 592.62 s, 976.17 s, 410.93 s and 512.04 s for partitions 1–4. All four test steps and artifact uploads are terminal. These results make no claim about browser or owner QA outcomes, which were still running when this unit package was sealed.
