# Geometry preparation candidate: hosted CI evidence

Source `b8f1445cb07d57b35ac1c5dd45e54b01d6aaec92`, tree `8d33f4ce7255a56398689914b1a78fe4a74833ba`; [run 44630631215](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44630631215).

**Five jobs are terminal. Build, gameplay, GPU and menu passed; High failed.** All 16 original browser cases are accounted for: 15 passed, 1 failed, no skips or retries. Full job logs are retained losslessly; case counts cross-check against each original runner summary.

## High failure boundary

The original 90-second readiness poll expected `paused` and still observed `loading` at `graphics-high-journey.spec.ts:786`. It failed before the prepared-scene assertions, active GP chassis checks and two completed photo views. The whole case lasted 150.846 seconds; that is not the readiness allowance.

Shadow/reflection warmup began 35.634467 seconds after the readiness poll began and completed in 42.1871 seconds. Offscreen pit-service warmup began at 77.821567 seconds and was still incomplete after 12.1107 seconds in the last diagnostic. Preparation reported no error. The last GPU queue snapshot had 2 submissions, 0 completions, 703 deferred callbacks, 11 flush refreshes, 11.7331 seconds pending and no failure.

The first pit-service fence covers the preceding whole chase submission as well as the new offscreen work. Its pending time must not be attributed solely to pit-service rendering. The source-order excerpts and unchanged-source comparison preserve that ownership boundary.

The 42.1871-second labelled chase stage contains 84 observed activity samples spanning 41.499979 seconds. Between the first and last samples, summed wrapped API CPU counters increase only from 210.7 to 2072.9 ms, a delta of 1.8622 seconds. Repeated 1–1.5-second plateaus follow already-returned useProgram calls with no wrapped call in flight. Most elapsed time is therefore outside this API accounting; it is not identified by the retained slow upload or shader-query calls.

The last native activity was a returned `clientWaitSync`, with no call in flight. The retained late program 423 / fragment `26f0f279` had a 926.7 ms `getProgramInfoLog` CPU call during the earlier shadow/reflection stage. One 468.5 ms `bufferData` call for 144 bytes has a PMREM `_halfBlur` stack in that same earlier stage. These observations do not identify isolated GPU execution time or the owner of all pending work. No console error or warning was captured.

## Provenance and scope

All four browser artifact ZIPs match both the GitHub byte count and SHA-256 digest. Build artifact metadata is retained without downloading the 79 MB build archive. `all-case-results.json` preserves every original case ID/title/location/status, and compressed report details retain original result data. The exact one-commit source comparison records two rendering changes and four added native-test/helper files; the hosted workflow, original browser gates, Playwright configuration and dependency lock are unchanged.

The candidate remains unaccepted by the High gate. No test, timeout, fixture or production source was changed by this audit.

Reproduce the extraction with `python3 extract-geometry.py ARCHIVE_DIRECTORY OUTPUT_DIRECTORY`, after running the parameterized `analyze-high.py` on the verified High ZIP and `analyze-native-gap.py HIGH_OUTPUT_DIRECTORY`. The original archive filenames and hashes are recorded in `artifact-receipts.json`.
