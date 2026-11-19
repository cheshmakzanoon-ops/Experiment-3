# 991cf4fc isolated graphics run — final evidence

Exact source **991cf4fc17f46e102318f25b643bc160789203a2**, reviewed local commit **41c57598b017458c010b0d26d1627691c9b726ac**, tree **e40d41dd4894f2975e0e78cbbd9557daa43c0957**. Run **44615583958**, attempt 1, finished **failure**. This is an isolated candidate result, not main CI.

| Job | Verdict | Original browser cases |
| --- | --- | --- |
| build | success | Production build completed |
| GPU components | success | 7 passed |
| Menu and settings | success | 7 passed |
| Gameplay journey | success | 1 passed |
| High GP journey | failure | 1 failed |

All 16 cases ran without retries, skips or flaky results. High failed the unchanged line 786 readiness predicate: expected paused, received loading, configured 90,000 ms and observed 90,000.214 ms. Its total 156,619 ms includes setup and evidence capture. No downstream paused, driving, photo or final High acceptance assertion ran.

## What the trace establishes

The first chase draw began at readiness **+39,843.517 ms**. Its stage lasted **51,138.3 ms**. The next stage, warming offscreen pit-service materials, appeared at **+90,983.346 ms**, approximately 983 ms after the readiness assertion had failed. This is progress beyond the previous late-exposure owner, while the original acceptance result remains failed.

The newest trace diagnostic returned at **+91,044.272 ms**, 1,044.058 ms after failure. It records one warmup frame, one scene-pass frame, one completed six-face local probe, GPU submitted=2/completed=0, and preparation still warming pit materials. That diagnostic is newer than the original last-diagnostic attachment, which was serialized before the chase during post-processing preparation. Both are preserved with their distinct provenance.

The final native worker snapshot was **71.267 ms before** assertion failure. It records a returned drawElementsInstanced call, not an in-flight metadata stall. Its zero fence counts must not be presented as the final application state after the deadline. No cockpit stage, late-program record, GL error or immutable-texture reallocation warning appears.

Subtracting the final pre-chase worker snapshot yields **zero new compileShader, linkProgram, getProgramInfoLog, active-uniform, uniform-location or attribute-location calls** during the observed chase. Instead it records 209 texSubImage2D calls with 27,102.1 ms aggregate CPU-call time and 3,850 bufferData calls with 16,387.7 ms. These durations can include previously queued driver work and instrumentation; they are not pure GPU or isolated transfer costs. Sixteen bounded slow-upload records retain sizes and Three helper stacks, but no texture/buffer identity or asset URL. Equal transfer sizes or the current program do not prove duplicate resource transfer.

## Construction and preparation intervals

Recorded sky preparation took 5,431.1 ms, scene compilation 10,965.4 ms, native scene metadata preparation 244 ms, fullscreen preparation 1,153.8 ms, and shadow-caster preparation 475.1 ms. Construction recorded 445 tasks, 128 yields, 13,420.7 ms work and a 5,369.7 ms maximum task.

The independent worker retained every observed loading-label change even when native tracing was inactive. Its **Far sun shadow** label at trace 68,828.816 ms changes to Scene ready at 74,201.391 ms: a 5,372.575 ms interval that corroborates the 5,369.7 ms maximum allowing reporting overhead. Spatial geometry batching occupied approximately 259.764 ms; it is not the five-second interval. The far-shadow interval has no retained per-native-call breakdown, so its internal cost is not attributed further.

## Retained package

summary.json records exact source, job timestamps, all case counts, original assertion reach, before/after-deadline timing, backend and limits. Complete decoded job logs are losslessly gzipped and hash-verified. Each passing case retains its original title, status, duration and retry. The High directory contains original diagnostic attachments, native records, complete bounded upload stacks, assertion timeline, newer trace diagnostic, worker-label timeline and resource-evidence limits. Source files and the unchanged original test/workflow are retained with SHA-256 provenance. The parser scripts reproduce the principal extraction from the original archives.

All four downloaded artifact ZIPs match GitHub's SHA-256 digest. Original ZIPs remain outside this compact package; the High archive is 106,750,195 bytes. No additional browser run, workflow retry/cancellation, remote write or production source change was performed by this audit.

Backend is ANGLE Mesa llvmpipe software WebGL2. This record does not certify physical-hardware FPS or completed High appearance.
