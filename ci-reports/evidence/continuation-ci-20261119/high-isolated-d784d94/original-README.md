# Isolated High diagnostic run d784d94 — frozen evidence

[Workflow run 44559369205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205) and [High job 135684104524](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205/job/135684104524) completed with **failure**. The server commit is `d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6`; its Git tree `b0eb64883e62199a789ba351385718ec80e07a89` was independently verified against local f97e732. This is the isolated diagnostic branch `ci/high-late-startup-20261119`; main remained d8d87c7. No rerun, production edit or publication was performed while collecting this evidence.

## Actual outcome

Dependency installation, source-guarded production build, Chromium setup and Mesa/Xvfb setup passed. The original High test failed at `e2e/graphics-high-journey.spec.ts:786`: its **90,000 ms** state predicate expected `paused` and received `loading`. Actual test duration was **156,008 ms**, retry 0. The High viewport, quality, 300-second test deadline and actual GPU-completion assertions were unchanged. There is no accepted High photo or frame-completion result from this run.

The last successful application diagnostic reports source d784d94 and production fingerprint `3e42326b03d522f705e2bcab4be00f4d25b99cac5ab4d54638a3d1311539b8fa`. That application read is stale relative to the independent worker trace. Browser console errors and captured test page errors are absent; the actual assertion failure remains recorded.

## Late program identities

All four separately retained late summaries fit the eight-record allowance:

| Native program | Shader name | Fragment hash | Recorded native-call evidence |
| --- | --- | --- | --- |
| 419 | PMREM.Background | `85df42ca` | `getProgramInfoLog` returned in 888.3 ms |
| 424 | PMREM.Background | `85df42ca` | Call observed and later work progressed; exact completion duration not retained |
| 436 | Recorded marshal display 0 | `4a8ffded` | `getProgramInfoLog` returned in 5,723.2 ms, during local probe +X at 256×256 |
| 463 | APEX scalable ambient obscurance | `d089587d` | Final in-flight `getProgramInfoLog`, observed for at least 12,198.3 ms, at 480×300 |

The final call is sequence **27296**, started at page time **121852.7 ms**. The latest completed call is the preceding `linkProgram`, sequence 27295. The independent worker remained alive and reported the metadata call in flight. Its stage stayed “Warming shadows and scene reflections…”. Tracked **fenceSync, clientWaitSync and flush counts are all zero**. The first warmup draw had not returned, so its later compile and explicit completion wait had not been reached.

The four program records retain full vertex source and full fragment source except the marshal fragment: its 74,344-character source is explicitly truncated to a 32,768-character prefix, with the full-source hash retained. Program names identify the source's material owner context; native programs can be shared by equivalent materials. Native call duration can include waiting for earlier driver work and diagnostic overhead; it is not isolated shader compilation or GPU execution time.

## Slow upload evidence

All sixteen allowed post-return upload stacks were retained: ten `bufferData`, five `texSubImage2D` and one `compressedTexSubImage2D`. The captured paths reach Three's buffer-attribute upload/binding and uniform-driven `setTexture2D` upload code. They do not reach a unique application resource owner within the bounded stack. The bound program is context, not proof of the uploaded resource's ownership.

The upload-stack allowance ended at sequence **22484**. Later worker records still captured `bufferData` sequence **23553** returning in **3,327.1 ms**, and `texSubImage2D` sequence **23686** returning in **6,512.2 ms**. The latter was the final blocked call in the earlier d8 run; it returned in this run before preparation reached ambient obscurance. Those two later calls have no new post-return stack because the allowance was already exhausted. No additional resource identity is inferred from their bound programs or upload sizes.

`high/native-analysis.json`, `high/late-program-identities.json` and `high/slow-upload-stacks.json` contain the compact exact extraction. `high/native-console-records.jsonl.gz` preserves all 407 decoded startup console records from the trace, including 277 independent worker activity samples. The last trace activity equals the last activity in the attached diagnostic JSON; no conclusion relies on cleanup after the assertion.

## Supported next correction

`compileSceneTarget` prepares material owners attached to scene renderables. `SceneAmbientPass` owns separate fullscreen obscurance, blur and composite materials; its first obscurance draw happens after rendering the full scene. The observed final owner therefore lies outside the initial scene compilation coverage. The narrow correction supported by this trace is preparation of the enabled pass-owned materials against their real targets, with retained metadata resolved before the first warmup draw and all rendering/fence behavior preserved.

The recorded marshal display material is also first selected by the recorded-state update during draw, after initial compilation. Priming that actual recorded state before scene compilation addresses the observed new material owner without inventing flag states. PMREM.Background is distinct from the already prepared CubemapToCubeUV and SphericalGaussianBlur programs. Source excerpts and file hashes are preserved in `source-findings.json`. These are identified coverage gaps, not a claim that any proposed correction has already passed High.

## Preservation

The complete **107,392,120-byte** GitHub artifact is retained as `high-d784d94.zip`, artifact ID **14548105652**. Its SHA-256 was verified against the GitHub artifact metadata and original upload log:

`ac132ac4890f1fc728af150468f5473e2bb73a63a6555bf3dc5d3db116bc1d4d`

The full decoded job log is retained both plain and losslessly compressed; its UTF-8 byte SHA-256 is `35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5`. The original response wrapper is retained too. The extracted Playwright trace is `high/trace.zip`, **54,558,637 bytes**, SHA-256 `81e7597be3f9e6868edada8ab3b221ddb63da0c55ea2d14f37db3f2ffa91985f`.

Final and initial run/job metadata, published commit identity, final artifact listing, extraction helper, original inline diagnostic bodies and report metadata are included. `SHA256SUMS` covers every file other than itself. This directory is frozen after checksum verification; candidate implementation work belongs in a separate worktree.
