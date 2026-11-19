# Complete unit-suite partitions — 19 November 2026

The original Build and validation run [44553045707](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707), on `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`, stopped its unit job near the existing 45-minute limit. Its logs contain completed results for 528 of 694 test files: 5,958 passing tests and two failing tests. The remaining 166 files have no completed result in that log. This is an incomplete suite, not a pass. The log does not identify the initiator of the cancellation.

## Change

`unit-tests` now uses four native Vitest partitions. Each runner executes `npm test -- --shard=<index>/4`, retaining the existing asset-generation pretest, source-stability guard, test configuration and 45-minute job limit. The matrix contains every index exactly once and disables fail-fast so one regression cannot cancel the other partitions. All four results remain required through the existing `publish.needs` gate. No test, assertion, timeout, fixture, source application or release condition is removed or relaxed.

Each partition records the original console output and a structured JSON report outside the source tree. An always-running artifact step retains those results, including failures and partial console output. Pipeline failure propagation remains enabled.

## Local verification

- Parsed the actual installed Vitest 3.2.4 configuration, discovered its complete test specifications, and invoked its configured native sequencer for each partition. Counts: **174, 174, 174 and 172 files**. Their union is all **694** discovered files, with **zero missing, extra or duplicate assignments**. This is inventory verification; no test bodies were executed by this inspection.
- `node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/ci-workflow.test.ts tests/delivery-status.test.ts tests/release-source.test.ts`: **88 tests in three files passed**, exit 0. The existing release-source checks still reject changed inputs and unvalidated publication.
- Scoped ESLint and `git diff --check`: passed.

The installed `vitest list --filesOnly` command reports the unpartitioned inventory even when given `--shard`; it was therefore not used as evidence of partition coverage. Coverage was verified through the same configured native sequencer used when tests execute.

The two observed production race failures and all browser failures remain separate issues. Partitioning makes the complete suite observable; it does not fix or accept those regressions. Hosted completion on the changed workflow remains pending until the next run.
