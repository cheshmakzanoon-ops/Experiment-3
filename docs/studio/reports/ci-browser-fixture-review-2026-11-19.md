# Browser CI classification and fixture corrections — 2026-11-19

## Disposition

The completed CI run contains real executed browser failures as well as independent dependency-install failures. Two demonstrated test-fixture defects are corrected locally. **The corrected browser tests have not been run in a browser; all browser acceptance remains pending.** The broader preparation, camera and readback failures remain unresolved. These corrections do not establish a High graphics pass or a physics acceptance result.

## Exact source and evidence

- Run: [Build and validation 44516038410](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44516038410).
- Executed source: `2d67572a9a2ba4daa33311dcc9abed2c1b537632`. All seven full executed-shard logs contain this checkout SHA; their artifact metadata names the same SHA.
- Completed CI report commit: `c53f18073618523d63603577fa8f9b7ab038010c`. Its application, test, script, package and workflow inputs are unchanged from the executed source. This commit only updates CI reporting.
- Local fixture-fix parent: `4082ea5fe90b6eb2959ad69c44ca0b2c77b42ed1` on `continuation-review-20261119`. The two browser specs and the language fixture were byte-identical to the executed source before this patch.
- [Evidence index](evidence/ci-browser-fixtures-20261119/README.md), [48 failure records](evidence/ci-browser-fixtures-20261119/classification.json), [focused check receipt](evidence/ci-browser-fixtures-20261119/fixture-checks.json).

The archive contains the GitHub connector's complete decoded logs for the seven executed browser jobs, with lossless compression and hashes, plus the committed failure digests for dependency installation. No browser artifact ZIP was downloaded. The seven screenshot/trace archives are individually 430–744 MB; their IDs, sizes and source SHAs are retained in the artifact metadata for later targeted diagnosis.

## Executed browser jobs

| Shard | Job ID | Failed | Passed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| 1 / 12 | 135542271724 | 7 | 23 | 0 |
| 2 / 12 | 135542271644 | 11 | 18 | 0 |
| 3 / 12 | 135542271656 | 7 | 20 | 1 |
| 4 / 12 | 135542271613 | 6 | 24 | 0 |
| 6 / 12 | 135542271575 | 6 | 24 | 0 |
| 7 / 12 | 135542271752 | 5 | 23 | 1 |
| 8 / 12 | 135542271668 | 6 | 21 | 2 |
| **Total executed** | | **48** | **153** | **4** |

These jobs installed Playwright and Mesa successfully, then failed their test step after approximately 71–85 minutes. They cannot be classified as dependency-install failures.

| Observed failure | Cases | Interpretation |
| --- | ---: | --- |
| `page.evaluate` survey timeout | 26 | Production survey calls exceeded their existing 300–1800 second test deadlines. The outer timeout alone does not identify the internal stalled operation. |
| Session remains `loading` | 7 | Expected `paused`, `driving` or `briefing` was not reached within the existing allowance. Includes High at 90 seconds, ordinary race entry at 240 seconds and gamepad entry at 900 seconds. |
| Photo studio remains hidden | 4 | `#photoStudio` remained hidden after the ordinary Photo/Livery action. |
| Camera presentation incomplete | 2 | `presentedCamera === requestedCamera` stayed false in wet-night coherence and populated pit journey. |
| Initial one-car frame read as requested full grid | 2 | Crew tests asserted 12 cars after predicates also satisfied by the menu's paused, tick-zero one-car frame. Corrected below. |
| Control actionability timeout | 2 | Decal side selection and Resume Session never became actionable within their existing test deadlines. |
| GPU-dependent English snapshot | 1 | The only printed mismatch is the runtime renderer string, SwiftShader versus Mesa llvmpipe. Corrected below. |
| Explicit GPU preparation completion timeout | 1 | Night secondary-grandstand survey threw `GPU preparation did not complete within 90000ms` from `waitForPreparedFrame`. |
| Screenshot readback timeout | 1 | MX journey screenshot exceeded its existing 60 second screenshot deadline after fonts loaded. |
| Screenshot/closed-page cleanup timeout | 1 | People startup exhausted its 300 second test budget; `cdpSession.detach` then reported that the target was closed. That cleanup error is not evidence of the original stall's cause. |
| Overall test timeout without a narrower logged exception | 1 | A32 normal practice entry exhausted its 300 second deadline. |

No `GL_INVALID`, shader compile exception or missing-fragment-output message is printed in these seven full job logs. Several specs collect browser console errors for later assertions rather than printing them immediately, so absence from job stdout is not proof of an error-free WebGL context. High fails at its grid-ready poll (`graphics-high-journey.spec.ts:667` in the executed source), before the later photo and completed-view assertions. Its diagnostic wrappers are installed during page initialization, so the earlier failure alone does not exonerate that old inspector. The same loading/photo/camera failure family also occurs in tests that do not install it. The inspector-only correction must not be represented as resolving these broader failures.

## Jobs that did not reach browser tests

Shards **5, 9, 10, 11 and 12**, plus **owner-qa** and **wet-presentation**, failed `npx playwright install --with-deps chromium`. Ubuntu package downloads reported HTTP 503 or connection failures, followed by `Unable to fetch some archives` and installation exit code **100**. GitHub marks the subsequent browser-test steps skipped. Build-download steps had succeeded where present; this is a dependency-download failure, not an application assertion result. No browser acceptance can be inferred for these jobs.

## Test-fixture corrections

### English markup retains its runtime GPU assertion

`e2e/63-i18n-layout.spec.ts` previously compared the entire stored settings HTML byte for byte, including the GPU renderer name. The retained baseline contains `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. The executed Mesa job returned `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`. The failure occurred at character 1576 in that span.

The comparison now replaces only the text inside the existing `<span class="gq-gpu">…</span>` in the settings snapshot and its saved baseline with one stable token. The markup, surrounding recommendation, explanatory copy, preset rows, controls and every other scene remain in the exact comparison. The baseline files are unchanged, and capture mode still saves the raw snapshot.

Before normalization, the test separately reads the live DOM value and compares it with a fresh browser query through the existing production `readGpuName` function. That function is re-exported by the test fixture only. Both values are attached as `english-settings-runtime-gpu.json`, including before any assertion failure. A wrong displayed name is therefore still a failure. No production UI or graphics code changes.

### Crew tests wait for the requested prepared session

Both Low and Medium crew tests formerly waited only for tick zero and an acknowledged paused worker. The initial showroom already satisfies those facts. In `src/main.ts`, session entry sets `loading` before awaiting audio, circuit and worker loading; `menuMachineFrame` is cleared later. The new worker's current frame and `renderer.prepare` must complete before application state becomes `paused` for the requested held-grid start.

The tests now await settings-save completion, then after the existing Prepare Grid click poll one diagnostic snapshot for all three facts: state `paused`, renderer purpose `circuit`, and preparation status `complete`. They then execute every original tick-zero, worker pause, 12-car, authored asset, contact, presentation, motion and error assertion. This excludes the stale menu frame without accepting a partial scene. The existing global and expectation deadlines, viewport sizes, quality choices and car counts are unchanged.

The lifecycle was independently reviewed against the actual entry sequence. No extra native unit test was added for a trivial duplicated readiness predicate or string replacement; the existing browser tests directly exercise the affected contracts. Guarded `npx tsc --noEmit` passed with actual exit 0 in 41.36 seconds; guarded ESLint for the three changed fixture files passed with actual exit 0 in 4.48 seconds. All 7,411 recorded inputs stayed stable through those commands. The full commands and input hash are recorded in the evidence receipt. **Browser execution of these corrected fixtures is still pending.**

## Scope and remaining work

Only the two browser specs, their language fixture export, and new report/evidence files are changed. No production renderer, physics, assets, thresholds, workflow, dependency or browser configuration is changed. This patch does not diagnose the internal cause of the 26 survey timeouts, the seven loading stalls, or the incomplete GPU/camera/readback operations. Their exact logs remain available for a later source-matched diagnostic pass. No browser retry, publication or remote mutation was performed.
