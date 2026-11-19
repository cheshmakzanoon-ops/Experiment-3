# Startup precompilation candidate a02e516 — CI evidence

[Run 44563795294](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44563795294) completed with **failure** because High missed its original readiness predicate. Component, gameplay, build and menu-entry jobs passed. The run belongs to `ci/high-late-startup-20261119`, server commit `a02e516cf3a58b33e4f783ecb37baafeed0e6ba5`, tree `a9c5d75554b2805b42eea1f393e01e616bbc5d9d`, identical to local candidate `872fa9d06edbcbb57b47167f0c99a660bb9bb3ef`. Main remained d8d87c7 when this isolated candidate was published. No rerun, source edit or publication was performed during collection.

## Results and scope

| Job | Result | Evidence |
| --- | --- | --- |
| gpu — 135699933098 | 7/7 passed, 51.221499-second invocation | Component receipt, original PNG hashes and JSON attachments |
| gameplay — 135699936147 | 1/1 passed; test 157.093 seconds, invocation 164.701241 seconds | Low 640×400 populated dusk drive, measured capture and recorded replay |
| high — 135699929521 | 0/1 passed; test 173.669 seconds | Original 90,000 ms state predicate expected `paused`, received `loading` |
| build — 135699931724 | Passed | Final job metadata; detailed build evidence owned by ci_engine |
| menu-entry — 135700617960 | Passed | Final job metadata; detailed menu evidence owned by ci_engine |

The original graphics gpu, gameplay and High job mappings were copied into the isolated workflow without changing their commands, environment, deadlines or assertions. High remains 960×600 at High quality, with its 300-second test deadline and actual native GPU completion requirements. These runs use software Mesa/llvmpipe; they establish functional results for that backend, not physical-hardware performance. No accepted High active chassis or photo views were produced.

The detailed build/menu package is separate: `/workspace/scratch/0ab62d15db18/ci-prewarm-menu-a02e516`. Final API records in this package identify all five jobs, while the logs and artifact inspection here cover gpu, gameplay and High.

## Component pixels

The frozen d8 component receipt identifies 32 PNG attachments from artifact 14544128271. The candidate has the same 32 attachment names. **26 are byte-identical.** The six different PNGs are the road-bike supported, airborne, landed, cold-seek, rewind and legacy-control views. Each changes only **53–67 pixels out of 153,600** (0.0345–0.0436%), with a **maximum channel difference of 1/255**, and no alpha changes. These are measured differences; the evidence does not assign a cause.

The seven original component cases passed. Five diagnostic JSON values are exactly equal to d8. Festival differs only in six CPU `lastBakeMs` values. Road-bike diagnostics differ in two measured values: cold-seek changed pixels 335→337, and flight coverage differences 3562→3561. All other road-bike values match. The original tests and thresholds are unchanged.

`components-receipt.json` preserves all attachment hashes, exact baseline identities and JSON differences. `component-pixel-comparison.json` records the raw pixel measurements. The PNG payloads remain in the original artifact and raw component extraction; the compact package does not duplicate them.

## High: observed progress and timing

The failed readiness predicate spans **89,999.878 ms** in the Playwright trace. The last successful main-thread diagnostic reports the candidate commit and fingerprint `309319589892bdad8078295f2458ebe55403c1708b2ec8b5d8bcb36d8f24555b`.

Its completed preparation stages were GP models **404.9 ms**, photographed sky **147.7 ms**, photographed ground **4.6 ms**, scene compilation **14,064.3 ms**, and scene material metadata **303.2 ms**. The diagnostic was last read **52.1 ms into post-processing preparation**. That snapshot is stale relative to the independent worker, which subsequently observed shadow preparation and then the first warmup draw.

The worker's post-processing-to-shadow observations are separated by **103.563 ms** of console reception time. This is observed phase progress, not an exact native timing measurement. The first warmup begins **50,263.657 ms into the readiness predicate**, leaving **39,736.221 ms** before its deadline. The last worker observation arrives **39,646.675 ms after warmup begins**. Exact clocks, timestamps and qualifications are retained in `high/stage-timings.json`.

### Final native command

The final recorded start is **bufferData sequence 23566**, a **1,584-byte** `ARRAY_BUFFER` upload with `STATIC_DRAW`, framebuffer **434**, cube face **34073 (+Z)**, viewport **256×256**. The preceding `bufferData`, sequence **23565**, returned. The final worker still observed sequence 23566 in flight for **at least 1,223.7 ms**; no return was captured before the readiness failure. This is an observation at the deadline, not proof of a permanent hang.

The stage remains “Warming shadows and scene reflections…”. Recorded **fenceSync, clientWaitSync and flush counts are all zero**. The first warmup draw had not returned, so its subsequent compilation and explicit completion wait were not reached. This result does not identify an explicit GPU-frame fence timeout.

Only two late metadata owners were retained, both `PMREM.Background`: programs **421** and **426**, fragment hash `85df42ca`, with untruncated shader sources. Program 421's metadata request returned in **1,420.7 ms**; later native work proves both calls were passed. The final call is an upload, not a metadata query.

All 16 post-return slow-upload slots were filled by sequence **21764**: five `bufferData`, ten `texSubImage2D`, and one `compressedTexSubImage2D`. They contain generic Three attribute/binding or texture-uniform upload paths. The final call at 23566 is outside that allowance and had not returned. Its application resource owner is therefore unknown. Program 148 is merely the program currently bound at the final upload; it is not proven to own the resource or the queued driver work.

Recorded cumulative native CPU-call time includes **22,690.2 ms** in `texSubImage2D`, **12,000.1 ms** in `bufferData`, **1,155.5 ms** in compressed texture uploads, and **2,345.9 ms** in program-info queries. These durations can include earlier queued work and host scheduling; they are not isolated GPU execution times, and the counters exclude phases where the monitor is inactive.

### What preparation is and is not verified here

The candidate's `SceneAmbientPass.prepare` returned before shadow warmup. However, the unchanged native-monitor regex is inactive during the new “Preparing post-processing materials” label, so this CI trace does **not** directly record individual AO, blur or composite metadata completions. The early 32-program and 64-first-use limits also omit the recorded-display owner. Aggregate scene metadata rises to 138 before warmup, compared with 137 in d784; that is consistent with display priming but is not independent owner-specific proof.

The candidate did not reach AO rendering. Its lack of a late AO record cannot establish end-to-end effectiveness. Prior d784 reached a late ambient-obscurance metadata call; this candidate stops earlier in the local reflection draw. Variation between these runs cannot be treated as a controlled performance improvement or regression.

The artifact retains **375 startup records**, including **247 worker activity records**, in `high/native-console-records.jsonl.gz`. The bounded attached startup JSON, last application diagnostic, late identities, upload stacks and compact native analysis are also preserved. No browser console errors or captured page errors were recorded. ci_audit independently confirmed the raw final-command and cap observations.

## Supported next step

High remains unaccepted. The final small upload does not justify another production correction by itself. If diagnosis continues, the missing evidence is bounded owner-specific preparation completion and geometry/texture upload ownership before the first reflection draw, with the same quality, deadlines and GPU requirements. No production patch or rerun was made from this result.

## Preservation

Complete decoded job logs are preserved losslessly with deterministic gzip. Every graphics archive was downloaded once and checked against GitHub's advertised byte count and SHA-256. `large-archive-manifest.json` identifies the retained full archives and the extracted full High trace. The High archive is **107,327,006 bytes**, SHA-256 `b0deacfe1d1748072ca74969082a138737db435819e50431f9e1b68f04d061a4`; the gameplay archive is **13,062,125 bytes**, SHA-256 `d552438f3f40cf673b750ec8164f9a8133ea178f73d3e1b6b7d59e9ba5b63096`; the component archive is **791,591 bytes**, SHA-256 `e3123107fb6b04e64a88520282e6ff4da095107cceb99e6bc7bcb5791092b83f`.

The compact package includes receipts, complete compressed logs, final source/run/job/artifact identities, selected original JSON attachments, bounded raw native records and this analysis. It omits duplicate ZIP, PNG and video payloads, which remain in `/workspace/scratch/0ab62d15db18/ci-prewarm-a02e516`. Copy provenance records whether an included file is a byte-identical copy or a lossless gzip transform. `SHA256SUMS` covers every file except itself; the package is frozen after verification.
