# High late startup diagnostics

This change adds bounded diagnostic evidence to the original High graphics test. It does not change production source, High quality, the 960×600 viewport, the 90-second readiness predicate, the 300-second test deadline, or actual GPU-completion assertions.

## Source-matched failure

The [High job on published d8d87c7](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045749/job/135661597584) remained loading during its first warmup draw. The worker trace recorded no fence operation; the second compile-after-draw and later frame-completion wait had not been reached. Its last native call was an in-flight `texSubImage2D` on the +Z reflection face.

The existing early program/stack budgets were exhausted before three late `getProgramInfoLog` requests. Their queried programs were 419, 424 and 436; the cumulative count rose from 137 to 140. Program 436 was the third request, and its CPU call lasted 7.643 seconds. That duration may include earlier queued driver work and does not identify isolated shader compilation time.

## Added evidence

The test now retains a separate budget of eight late metadata owners with cached vertex/fragment source summaries and bounded call stacks. It also records post-return stacks for the first sixteen successful buffer/texture uploads taking at least 100 milliseconds. The existing early caps remain unchanged, and separate Node collectors keep these samples after activity-ring eviction.

No additional native GL query, draw, flush or finish is issued. Metadata uses the program actually queried and previously observed shader text. Slow-upload reporting begins after native return and completion timestamp capture. Each shader source prefix is bounded at 32,768 characters, each shader name at 512 and each stack at 4,096; source truncation is explicit.

## Validation and provenance

The candidate spec SHA-256 is `8145efd6bf378e614ea605d69da12984b232ab5311a2981e895cf6c017dc3497`. The base is `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`, tree `51077ee3c9103d7faf139b622aa806bf8652d1f6`, identical to the approved local a1e2e38 tree.

| Check | Actual exit | Outcome |
| --- | ---: | --- |
| Extended composed native-monitor CPU proof | 0 | Candidate passes |
| Same proof on exact old d8 spec | 1 | Expected missing-late-metadata counterexample |
| TypeScript (`tsc --noEmit`) | 0 | Pass |
| Scoped ESLint | 0 | Pass |

All final checks recorded 7,458 unchanged protected inputs. The CPU proof covers native arguments, receiver, return and exception behavior, original GL call counts, exhaustion of the old caps, bounded late source and stack retention, post-return upload capture, and retention after 400 later activity records. An independent read-only review found no blocking functional issue and verified that all three observed late owners fit the new eight-record budget.

The [complete local evidence](evidence/graphics-engine-advancement/high-late-trace-local-proof/README.md) contains exact source snapshots, the review patch, original and extended proof scripts, raw receipts and logs, compressed source manifest, independent reviews and checksums. It also retains an initial failed proof invocation caused by a harness serial assertion; that assertion was corrected without changing the candidate spec. The expected old-source failure remains recorded as an actual exit 1. No browser execution or new CI result is claimed for this patch.

## Limits

An upload's bound program is context, not proof of resource ownership. Bounded serialization and stack capture add diagnostic CPU overhead, so the proof does not establish timing neutrality or a performance gain. A future run can exhaust the first-eight/first-sixteen samples, and an upload needs to return before its new stack can be emitted; the independent worker still reports in-flight calls. Observed-run metadata coverage is verified, but no blanket upload coverage is claimed.

The next CI trace should identify the late shader source and issuing JavaScript paths. This evidence does not justify moving the later compile or weakening High readiness. The separate menu-entry failure was observed at the second completed-cockpit frame wait and remains a distinct diagnosis.
