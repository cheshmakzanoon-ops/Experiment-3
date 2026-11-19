# Published graphics CI — completed, High remains rejected

Exact published source: **d8d87c73a8f3e921e865acdc02c61e84b8c877a7**. Workflow [44553045749](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045749) completed with **failure**. The coordinator verified its Git tree matches reviewed local checkpoint a1e2e38; the job logs, artifact metadata and embedded Playwright reports independently name the published source.

## Actual results

| Job | Result |
| --- | --- |
| gpu / 135661597661 | Seven component browser fixtures pass in 33.995 seconds. All 32 attached PNGs are byte-identical to committed components-2d67572 evidence. Six diagnostic JSON values also match exactly; the Festival JSON differs only in six lastBakeMs timing observations. |
| gameplay / 135661596996 | The original complete Low 640x400 populated drive, performance capture and recorded replay journey passes. Playwright invocation duration is 235.021 seconds. Captured build identity is this published commit with production fingerprint 3e42326b03d522f705e2bcab4be00f4d25b99cac5ab4d54638a3d1311539b8fa. |
| high / 135661597584 | Fails the unchanged 90,000ms grid-ready predicate at graphics-high-journey.spec.ts:698: state remains loading instead of paused. Playwright reports test duration 166.069 seconds. No accepted High gameplay/photo frame is produced. |

Every job passed build, Playwright dependency installation and Mesa installation before its browser step. These are executed test outcomes, not installation failures. Backend is ANGLE/Mesa llvmpipe; this package makes no physical-GPU, consumer-frame-rate or console-quality claim. The Low capture's software-renderer timing remains in the original JSON, including its 51 samples over 30.318 seconds.

## High native diagnosis

The changed inspector's fragment queries no longer dominate the observed stall: 140 completed getFragDataLocation calls total 21.5ms, compared with 13 calls totaling 29,627ms in the prior2d run. This is source-specific observed CPU-call time, not GPU execution time.

Initial retained material metadata completes before any tracked draw: 137 program-log calls total 227.5ms and 137 fragment-output queries total 20.9ms. First-chase warmup begins at page time 105487.6ms. Three additional programs are linked and queried during that warmup:

- Program419, fragment85df42ca: query at105610.2ms, 2D framebuffer416/256px, before any tracked draw; call costs approximately1.1441s.
- Program424, same fragment: query at106829.4ms, 2D framebuffer421/256px, after12 ordinary draws; call costs approximately0.7637s.
- Program436, fragment4a8ffded: query at118831ms, first cube face+X, after63 ordinary and24 instanced draws, 1,883 buffer uploads and90 texture uploads; call costs7.643s.

The final observed in-flight call is a later **texSubImage2D**, sequence23686 at page145578.2ms, cube face+Z, framebuffer432/256x256, current program260/fragment191a251a. Its preceding texStorage2D returned. The independent worker remains alive and reports at least3.516 seconds in flight. Completed bufferData calls total17.2544s; completed texSubImage2D calls total11.2739s; compressedTexSubImage2D calls total1.5602s. Those costs include instrumentation and may include waiting for earlier driver work; they do not isolate shader compilation or transfer bandwidth.

Retained fenceSync, clientWaitSync and flush counts are all zero. The failure is still inside the first warmup draw, at stage “Warming shadows and scene reflections…”. The later compile-after-draw and explicit GPU-frame-wait stages have not been reached in the retained trace. Moving those later operations is not justified by this trace.

The last successfully read application diagnostic is stale at2026-11-19T15:20:47.567Z and reports loading with no preparation snapshot. It cannot supersede the independent worker's later stage/native observations. No console/page errors were captured. Existing caps retain32 program summaries and64 first-use stacks; they were consumed during earlier setup, so the names and call-site stacks of the late programs are unavailable. No material/geometry owner is guessed.

## Next useful diagnostic

If the production resource owner must be identified before a correction, retain a separate bounded set of getProgramInfoLog summaries/stacks during first-chase warmup, where this run has only three new calls. For completed slow buffer/texture uploads, a stack can be captured after return only when the existing slow-call threshold is met, avoiding thousands of speculative stack captures. Preserve all quality, dimensions, deadlines, assertions and actual GPU-completion checks. The current evidence supports investigating mixed late program setup and lazy resource uploads inside reflection warmup; it does not establish a single complete production fix.

## Evidence and integrity

The original decoded job logs are gzip-compressed. Full artifact identifiers, archive hashes, source identity, final job/run status, extracted JSONs and four successful Low screenshots are retained. Large original artifact ZIPs and duplicated component images remain outside this compact package; copy-provenance.json records every stored file and omitted archive. All compressed files decompress byte-for-byte to their originals. SHA256SUMS covers every other stored file.

No local browser, production/test edit, CI retry or publication occurred while collecting this evidence. Main CI44553045707 remains a separate workflow and is not accepted by these graphics results.
