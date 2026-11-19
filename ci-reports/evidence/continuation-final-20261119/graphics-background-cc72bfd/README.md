# cc72bfd isolated graphics run — exact final evidence

Source **cc72bfd8117ccad37180093c8ec45d7656810686**, run **44611365105**. This is the isolated PMREM-background-owner candidate, not a main CI result. The workflow finished **failure**.

| Job | Verdict | Original browser cases |
| --- | --- | --- |
| build | success | Build completed |
| gpu | success | 7 passed, 0 failed/skipped/flaky/retried |
| menu entry and settings | success | 7 passed, 0 failed/skipped/flaky/retried |
| gameplay journey | success | 1 passed, 0 failed/skipped/flaky/retried |
| High GP journey | failure | 1 failed at unchanged 90,000 ms readiness predicate |

High still received loading instead of paused. Its 154,879 ms total includes setup and evidence capture; the failed assertion itself retained its original 90,000 ms deadline. No paused acceptance, driving acceptance, photo views, or final High acceptance were reached.

## Native evidence

First chase warmup started **34,514.703 ms into the readiness predicate** (trace 86,232.239 ms / page 78,886.7 ms). One late program was retained: native program 465, fragment hash **47dd29c3**, complete fragment length 2,429 characters. Its exact source fragment body matches **src/rendering/adaptive-exposure.ts**, and its active framebuffer was the exposure meter's 16×12 target. The last started command was getProgramInfoLog at page 121,894.5 ms, sequence 27,284, observed in flight for at least **12,149.4 ms**. The preceding linkProgram returned in 0 ms.

No late PMREM.Background record appeared, no cockpit stage appeared, and the retained first-warmup native counts contain no fenceSync/clientWaitSync/flush. This establishes how far the trace got; it does not show a completed first draw. The trace contains no console GL error or warning. Bounded upload records do not prove resource ownership from the current program.

Native CPU-call duration can include queued earlier driver work. The last query is an observed stopping point, not a claim of infinite deadlock or pure shader compilation cost.

## Exact retained evidence

summary.json records source, final jobs/times, all case counts, assertion reach, backend and limits. The three case-results files retain every passing test title, retry and duration. Five job-log gzip files contain the complete decoded logs without dropped lines; log-provenance.json records original UTF-8 lengths and SHA-256 values. The High subdirectory retains original compact diagnostic attachments, full late shader/stack identity, upload records, timeline, and losslessly gzipped trace-derived native records. analyze-high.py can reproduce these findings from the external original High archive.

The original downloaded archives remain outside the repository and compact package. Download receipts verify all four archive SHA-256 digests against GitHub. High archive size is 107,159,750 bytes; its inner trace is 54,473,410 bytes and its digest is retained in the attachment manifest. Large ZIPs/screenshots/videos are deliberately not duplicated into the package.

The exact test source and exposure source are retained with hashes. FULLSCREEN-AUDIT.md separately records the read-only owner audit: default High also lacks preparation for four bloom material owners, Output's selected AgX/sRGB variant, and final grade's FILMIC_BLACK/screen variant. Those are source findings, not additional observed failures.

Backend: ANGLE Mesa llvmpipe software WebGL2. These results do not certify physical-hardware FPS or appearance. This audit made no remote writes and no production worktree changes.
