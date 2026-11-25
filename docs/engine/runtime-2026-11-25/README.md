# MOTOBOUND engine runtime development

25 November 2026 · engine work coordinated through ten waves of six assignments

This handoff covers improvements to the game's runtime efficiency, persistence, session recovery, networking, input, audio guidance and worker scheduling. The implementation changes **18 production files**. It removes repeated work in several hot paths and makes the ownership of asynchronous work more explicit, while preserving the tested simulation outputs and network bytes.

The scope is the underlying engine. The [protected-source audit](w09c-protected-path-audit.md) checks the engine commits against their individual parents and verifies preservation of the separate motocross animation work. These engine commits do not modify models, characters, environments, authored vehicle tuning, rendering, shaders, the main application entry, the simulation protocol or offroad implementation.

## Acceptance and delivery status

<!-- ACCEPTANCE_STATUS_START -->

**Accepted executable source: [`3949139`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/394913934d3c6c9cfbe5ba5251beb7ebe68ee249). The complete focused engine gate passed on its first attempt.**

| Boundary | Verified result |
| --- | --- |
| Task baseline | `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc` |
| Executed source / tree | `394913934d3c6c9cfbe5ba5251beb7ebe68ee249` / `cf9fded4f2bd81567858d5d1e19f873ebd293754` |
| Focused run / job | [45647350422 / 139321807542](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/job/139321807542), attempt 1, successful |
| Lint and unit contracts | Full source/test/script ESLint; **1,351 passing tests across 95 files** |
| Baseline comparisons | All six expected reports passed with exact candidate provenance and clean tracked scope |
| Compiler and product build | Full TypeScript and Vite build passed without model-generation hooks |
| Native browser acceptance | **60 cases passed in 3.0 minutes**, one worker, zero retries; both native desktop recovery cases and worker-idle case passed |
| Native file-service integrity | Recorded service digest verified before and after browser acceptance |
| Coordination | **60 distinct agents completed all 60 assignments in ten waves of six**; the [assignment index](w10d-assignment-index.md) and [ledger](AGENTS.json) record the actual work and completion state |

The [retained result](evidence/3949139/result.json), [six probe reports](evidence/3949139/probes.json) and [complete normalized job log](evidence/3949139/hosted-job.log) preserve the accepted evidence. The uploaded artifact identity is corroborated from its upload log; its ZIP and browser attachments were not downloaded for independent inspection.

This is focused engine acceptance. The broader repository workflow has separately documented preexisting content failures. Mesa/offline-audio/test-binding limits remain explicit below and in the [release evidence](w10e-release-evidence.md).

The final handoff adds documentation and retained evidence. Its [final review](w10f-final-review.md) and coordinator publication check preserve the accepted runtime, tests, workflow and dependency inputs. Earlier failed checkpoints remain visible in [CHECKPOINTS.md](CHECKPOINTS.md); they are not relabeled as successful.

<!-- ACCEPTANCE_STATUS_END -->

## Start here

| What you need | Document |
| --- | --- |
| Understand the engine changes and ownership rules | [Architecture and contracts](w10a-architecture.md) |
| Assess the measured reductions and their limits | [Measurements](w09b-measurements.md) |
| Reproduce the focused gate and baseline comparisons | [Reproduction and maintenance](w10b-reproduction.md) |
| See remaining boundaries and the next useful work | [Limitations and handoff](w10c-limitations-handoff.md) |
| Find all sixty assignments and their outputs | [Assignment index](w10d-assignment-index.md), [machine-readable ledger](AGENTS.json) |
| Check exact accepted source, run and retained evidence | [Release evidence](w10e-release-evidence.md), [checkpoint history](CHECKPOINTS.md) |
| Verify visual-source and concurrent-history preservation | [Protected-source audit](w09c-protected-path-audit.md), [audit manifest](w09c-protected-path-audit.json) |
| Check historical evidence and failure attribution | [Evidence provenance](w09d-evidence-provenance.md), [validation review](w08f-validation-review.md) |
| Read the final independent conclusion | [Final review](w10f-final-review.md) |
| Verify final publication inputs and concurrent-history preservation | [Coordinator publication record](PUBLICATION.json) |

The numbered wave reports are point-in-time engineering records. Their original “pending” statements describe what that author had actually observed. The final release record identifies the later integrated result; historical failures and limits remain useful evidence.

## Delivered engine behavior

| Area | Concrete improvement | Why it matters |
| --- | --- | --- |
| Saves and records | Atomic IndexedDB read/modify/write, private mirror snapshots, stable tie ranking and generation-owned presentation | Concurrent accepted records no longer depend on a separate read/write window; delayed completion cannot update a departed records owner |
| Desktop recovery | Persisted revisions are read in the write transaction; committed ownership is separated from reservations; foreign writes or failed reconciliation block incremental certification | A returning writer cannot certify a native snapshot that omits another writer's committed values |
| Startup | Cancellation settles the caller even when loading or creation remains pending; late instances are disposed; failure recovery retains the original cause | A canceled launch releases its caller promptly and cannot adopt or restore an obsolete session |
| Network runtime | Bounded queue expiry, owned server deadlines/callbacks, earlier canceled-handle lookup retirement and consuming packet output | Less repeated queue/copy work, clearer teardown, and preserved recipient packet ownership |
| Worker lifecycle | Periodic physics intervals park when no work can run; generation checks reject old callbacks; flashback preserves diagnostic choice and outstanding credit | Paused or failed workers do not keep their physics interval alive, and rewind keeps inspection coherent |
| Input and audio guidance | New controller mapping ownership can notify its own fault; gear advice follows recorded vehicle limits; unused guidance routes are deferred | Retry behavior remains responsive, advice matches the powertrain, and disabled guidance avoids cold route construction |
| Simulation and radio hot paths | Compact radio history, bounded lane FIFO bookkeeping and fewer frozen-default thermal signature checks | Removes repeated copies and checks while preserving the compared outputs |

The implementation and independent review links for each row are collected in the [architecture guide](w10a-architecture.md). The guarantees have deliberate boundaries: accepted persistence may outlive presentation; canceled events may remain as heap tombstones; prepared packets and transport still copy; and simultaneous full desktop reconciliation with writes is not made globally atomic.

## Measured work reductions

These observations belong to accepted source `92e2dc2` and its six actual-baseline probes. Each row has its own workload and unit; the values should not be added into a whole-engine memory or speed total.

| Tested workload | Original module | Candidate module |
| --- | ---: | ---: |
| Radio: 600 observations of 24-car frames | 600 history slices; 19,123,200 copied bytes | 0 history slices; 0 copied bytes |
| Input expiry: 248 dense sequential slots | 30,876 pending-key visits; 248 deletes | 0 visits; 248 deletes |
| Lane cache: 6,144 successful FIFO evictions | 6,144 fresh key iterators | 0 fresh key iterators |
| Thermal: four rain Track updates | 14,349 signature-refresh calls | 8 calls |
| Codec: twelve prepared 12-car recipient packets | 12,876 counted copy bytes | 6,228 counted copy bytes |

The prepared codec result is a **51.6% reduction in the counted copy bytes**; its assembly copies remain. The lane ring adds at most 2,048 resident-key references. Thermal still performs the same counted matrix-selection requests and cell advances. These qualifications are part of the result, not optional footnotes. See [measurement definitions, timings and exact outputs](w09b-measurements.md).

The accompanying real-Simulation comparison checks 363 complete frames, 363 unrounded race-state observations and 27 checkpoints of eight surface arrays across three weather scenarios. Each scenario runs one simulated second. The full-Simulation cases do not stress lane eviction; a separate 8,192-miss trace supplies that evidence. The probes substitute declared historical modules into the same candidate dependency graph, rather than comparing two complete historical application builds. These measurements do not establish hardware FPS, power savings or physical-network latency.

## Evidence that can be inspected

The [focused workflow](../../../.github/workflows/engine-runtime-validation.yml) now records exact source identities, runs full lint, selected engine and affected legacy suites, all six baseline comparisons, TypeScript and the product build, then the native browser suite. It preserves failure status through its logged pipelines and disables retry acceptance.

The witnesses cover different boundaries deliberately. Controlled worker tests can force stale callbacks and exhaust delivery credits. Native DedicatedWorker tests use actual browser messages, timers and transfers. Native audio uses an actual OfflineAudioContext and rendered PCM. Desktop recovery combines actual browser IndexedDB with the production Node file service through an explicit Playwright binding. That bridge does not establish Electron preload or IPC acceptance. The [validation review](w08f-validation-review.md) explains those boundaries and the source guard's declared scope.

The repository's broader workflow has four proven preexisting content failures involving APX-01 livery, translations and GPR-1 catalogue/calibration data. This session's own harness failures are separately retained and corrected. A successful focused engine gate is not a claim that the complete repository workflow is green. The [provenance review](w09d-evidence-provenance.md) identifies the earlier completed failed jobs and distinguishes them from this session's work.

## Concurrent animation and source ownership

Through `0bc9543`, the independent audit covers ten engine commits, 18 distinct production files and **970 matching protected blob/subtree identities**. Both named animation commits remain ancestors, and all **19 files** changed by them retain their exact animation-commit blobs at that audited tip. The engine work is attributed through each commit's immediate-parent diff, so legitimate incoming rendering changes are not mislabeled as engine edits. See the [complete audit and its limits](w09c-protected-path-audit.md).

This directory is the current task's `runtime-2026-11-25` record. The earlier `advancement-2026-11-25` implementation and its 914-unit/47-native acceptance remain prior-session work. The [provenance report](w09d-evidence-provenance.md) records the relationship between those histories.
