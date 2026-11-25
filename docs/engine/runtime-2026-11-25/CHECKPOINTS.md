# Runtime development checkpoints

## Historical audio comparison — `40bf6c7`

Published a closed, byte-verified historical audio dependency graph. The existing native numeric and cleanup assertions remain intact; the candidate bundle continues to use current production inputs. The archive consists of 31 historical dependencies plus the already retained loudness source. No production source changed in this commit.

Focused TypeScript, ESLint, original-dependency hash/graph checks and three negative integrity controls passed. The local Chromium attempt was blocked before any test by the environment's socket policy. Native acceptance is assigned to the repository's existing focused engine workflow; this checkpoint does not claim a browser pass.

During publication, incoming motocross commit `ef503b2` and subsequent CI-report commits were preserved. A changed remote tip rejected the initial expected-parent update; publication was rebuilt on the inspected new parent and succeeded without forcing the branch.

### Hosted acceptance for `40bf6c7`

[Focused workflow 45620922846](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45620922846) completed successfully: 914 tests across 70 files, full TypeScript and product build, then 47 native cases with zero failures. The browser identified ANGLE/Mesa llvmpipe software rendering. This acceptance belongs to the historical-audio harness checkpoint; later production edits require their own integrated validation.

## Atomic records, startup ownership and runtime work — `c501690`

Six production modules changed: compact radio history, sequential input expiry, cancellable startup with recovery diagnostics, record lifecycle/ranking, and atomic saves. The integrated five-file records/startup/radio suite passed 95 tests; queue differential and existing command tests passed 63. Full local TypeScript attempts exceeded memory (one bounded heap exhaustion and process exit137); no pass is claimed for them. Hosted compiler/build/native acceptance is pending for this checkpoint. The reference-harness checkpoint above has its own successful hosted evidence.

Publication used a tree identical to the reviewed local commit, parent `6484ff3`, and an expected-head check without force. Incoming report history was retained, and local worker edits remained unstaged and preserved.

## c501690 hosted acceptance

Commit `c5016905c52da6b87aa400f00b841af7d948ab57` passed focused hosted workflow [45623758794](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45623758794): 1,014 tests in 75 files, complete TypeScript/build, and 47 native browser tests (3.6 minutes). No retries.

A later local six-file integration attempt passed the 16 lane-cache cases then exited 137 from shared-memory pressure; it is not counted as a complete pass. Individual focused agent results and the next hosted source gate are tracked separately.

## acd525f hosted acceptance

Commit `acd525fc148c1378c90cfb23dddee9dd53e4d52c` passed [workflow 45625750491](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45625750491): 1,103 tests in 81 files, full TypeScript/build, and 47 native tests (4.0 minutes).

## 04b7a6e validation and environment recovery

[Workflow 45627137718](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45627137718) passed 1,114 tests in 82 files, then rejected the new IndexedDB fixture's overloaded native transaction `apply` call (TS2345). The correction uses typed reflective delegation, preserving every native argument. Browser tests were skipped by that failed gate; they are not counted as passed.

The shared execution environment disconnected after this commit was pushed. Root continued through the GitHub connector with reviewed, isolated Git trees, expected-head non-forced ref updates, and hosted execution. Agent reports distinguish completed local evidence from unexecuted candidates. Protected content remains outside the permitted write paths.
