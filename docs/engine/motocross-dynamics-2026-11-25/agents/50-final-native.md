# Assignment 50 — final product build and native motocross acceptance

## Result and owned scope — final native acceptance failed

Compact handoff evidence: [50-final-native.json](../evidence/50-final-native.json). Full traces, images, and resource records remain in the independently preserved task receipt directories described below.

The direct **product/full Vite build passed**. **Final native browser acceptance failed** on the final source fingerprint. The gameplay invocation lost its Chromium page target after attaching the Arena Nord chase screenshot. One authorized diagnostic invocation then timed out at the unchanged 20-minute ceiling with `locator.click: Target crashed` while applying settings; it recorded two GPU-process exits with code 9. The underlying cause remains unproven. Assignment 37's earlier successful run is separate evidence for an earlier fingerprint and does not replace either final-source failure.

The partial gameplay invocation (attempt 2) ran the unchanged `e2e/45-motocross-gameplay.spec.ts` through the unchanged `playwright.motocross.config.ts`, with the original 20-minute test ceiling, one worker, and zero Playwright retries. Valley Ridge/MX450 completed its full path. Arena Nord/MX250 reached manual controls, observed AI course progress, qualifying flight, recorded touchdown, and a checked chase screenshot, but its cockpit, pause, and paddock-return checks were not reached. There are **10**, not 12, actual screenshots from this invocation.

This assignment changed no production code, tests, configuration, model definitions, assets, terrain, environments, or vehicle specifications. Its owned repository document is this report. Logs, receipt helpers, manifests, copied screenshots, and preserved native reports are under `test-results/a50-final-native/`. It performed no git operations and ran no npm prebuild/pretest model-generation hook.

## Build and source identity

This was working-tree acceptance before the coordinated task commit. The product accurately records **`commit: null`**, fingerprint **`d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`**, `variant: product`, and `edition: full`. The build must not later be relabeled as a build of a commit that did not yet exist.

| Command | UTC interval, 2026-11-25 | Elapsed | Exit |
| --- | --- | ---: | ---: |
| Direct `node_modules/.bin/vite build` | 19:43:17.686–19:43:42.380 | 24.695 s | 0 |
| Gameplay invocation, attempt 2 | 19:51:30.509–19:57:23.559 | 353.050 s | 1 |
| Authorized diagnostic invocation, attempt 3 | 20:21:59.257–20:42:04.355 | 1,205.098 s | 1 |

Vite transformed 1,106 modules; its own reported build time was 20.28 seconds. The existing large-chunk advisory was informational. Its IP guard successfully scanned 75 shipped text files and GLB name tables. The output contains **266 files totaling 135,946,574 bytes**. These wall-clock measurements describe this shared execution environment, not rendering throughput or hardware performance.

The before/after manifests capture all files under `src/`, `public/`, and `e2e/`, root package/TypeScript/Vite/Playwright inputs, entry HTML, and the four browser/build-support scripts enumerated in `run.py`: **1,734 inputs**, including **1,126 source files**. The before/after manifests confirm every captured input remained byte-identical across the build and both completed native invocations. The independently observed manifests after the incomplete first invocation also match. Both completed invocations left every built file byte-identical; the diagnostic performed no rebuild.

| Identity | SHA-256 |
| --- | --- |
| All 1,734 captured inputs | `1cbc70336eaaf00b0559a14a7de7b1af09a9ab4589701059b1656b1ffb4afb41` |
| All 1,126 source files | `a91d8e12d2a2f97a8576fcdfe27f71f2f74eed2e08b8d8c926336e8384173d21` |
| All 266 built files, before/after both completed invocations | `fc510344f8e170443957e50410878a25e507f7e765ea92778ecd12dad06fa772` |
| Motocross adapter | `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` |
| Motocross AI | `c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e` |
| Gear-stroke helper | `b2d6e6f437835bc52e9f55c43a6ee9e073e552314f6b9ae82d3d06adbbd5f91f` |
| Chase camera | `248bfb44b7f083fc6abc1389e0af9fafcda13db96f0e97c23c70312949a36917` |
| Motion reader / machine pose | `361ad30ee2e7ae5a3c0202ae471c7423f0e0db14bf98639d390364d83403dc9e` |
| Unchanged gameplay spec | `2a3ba790d17211402c41a212e0f98dd8e8225bf4956ff9d1ef0e06fdb7099be1` |
| Unchanged motocross Playwright config | `0102ddaa005afe284d49d3a49e4ac6bcd57e2f889fa40d6c1ce90400bff60734` |

Manifest aggregate means SHA-256 of each Python-path-sorted `path + NUL + file SHA-256 + newline` entry. The independently recorded `comparison-to-a37.json` finds exactly four changed shared inputs since assignment 37: the chase camera, machine-pose reader, AI, and gear-stroke helper. Assignment 50 also adds `scripts/vite-lazy-data.ts` to its manifest capture; assignment 37 checked that script separately. The extra captured path is not a production change.

## Attempt history and failure boundary

The first invocation was interrupted before producing a completion receipt. Its executor session became unavailable, the preview port was closed, and its last log showed Valley course preparation at 19:45:25 UTC. No exit code or test assertion result was available. That incomplete invocation is separately preserved under `interrupted-attempt-1/`, including its input manifest, partial image, log, observed unchanged source/build manifests, and `interruption.json`. The old standard HTML report still belonged to assignment 37 and was explicitly rejected as evidence for that attempt.

After notifying the root coordinator, preserving the incomplete attempt, and rechecking source/build equality, the unchanged journey was restarted against the same build without rebuilding. This second invocation produced a real, complete failure report: **1 unexpected failure, 0 passed, 0 flaky, 0 skipped**, retry index **0**, test duration **345,498 ms**. It was not a timeout. The first interruption and this native failure must remain separate facts.

The retained Playwright trace shows the Arena chase image's GPU completion and new-image checks passing. The PNG was attached. The next read-only `window.apexDiagnostics()` call failed with **`page.evaluate: Target crashed`** at the capture helper's post-attachment diagnostic, before the camera-switch key was pressed. The trace contains a page-closed event at 345,810.069 ms; the failed evaluate began at 346,784.929 ms. These are trace-relative times, not wall-clock timestamps.

The last successful diagnostic returned at trace time 333,824.931 ms. It identified the expected final fingerprint, `state: driving`, explicit AI enabled, no page-lifecycle suspension, and `gpuFrameQueue.failure: null`. Its most recently presented simulation time was 71.9417 seconds. The field-finiteness assertion had already passed during the Arena riding checks. These observations bound the failure; they do not diagnose why Chromium crashed.

For attempt 2, no retained Chromium exit signal, native crash dump, heap sample, or cgroup kill event establishes a cause. Resource pressure, browser/driver failure, and a production fault have not been distinguished by that evidence. One coordinator-authorized diagnostic invocation followed; it also failed, as documented below. No additional retry ran. The preview port was confirmed closed after each completed invocation.

## Attempt 2 — partial gameplay evidence

The test selected Low quality through the real production settings form, used the normal DIRT menu and keyboard controls, and observed the actual app, simulation worker, and renderer. It did not inject simulation state. Both eight-rider venues reached a prepared gate and accepted forward/rearward body positioning and throttle while AI was disabled. AI demonstration was then explicitly enabled for course-progress, flight, and touchdown observations.

| Acceptance stage | Valley Ridge / MX450 | Arena Nord / MX250 |
| --- | --- | --- |
| Selected machine and actual menu image | Passed | Passed |
| Prepared eight-rider gate and actual image | Passed | Passed |
| Manual rider-weight/throttle checks | Passed | Passed |
| Real AI progress, qualifying flight, touchdown | Passed | Passed |
| Independent field mechanical animation and finite worker frame | Passed | Passed |
| Checked actual chase image | Passed | Passed; page crashed immediately afterward |
| Cockpit presentation and actual image | Passed | Not reached |
| Pause acknowledgement, held worker tick/frame, actual image | Passed | Not reached |
| Return to selected-machine paddock | Passed | Not reached |
| Complete per-venue JSON attachment | Present | Not reached |
| Final browser-error-array assertion | Not reached for whole journey | Not reached |

Only Valley's complete diagnostic journey JSON was attached before the failure. Its retained measurements are:

| Valley observation | Value |
| --- | ---: |
| Manual speed / throttle / AI state | 7.50295 m/s / 1 / false |
| Forward / rearward body observation | +0.67967 / −0.80631 |
| Observed AI interval | 20.20833 s |
| Signed forward progress | 236.85384 m |
| Maximum recorded flight time | 0.27500 s |
| First observed touchdown normal speed | 0.92609 m/s |
| First observed touchdown pitch error | +0.11170 rad |
| Advancing rendered time across observations | 16.29563 s |
| Riders with independent front/rear mudguard animation | 8 of 8 |
| Maximum safety-car phase | 0 |
| Worker observations / held paused worker tick | 39 / 7,840 |

These samples prove the checks they satisfy, not a clean landing or a crash-free full lap. The `ticksBeforeRelease` array was empty; the mandatory held-gate assertions passed, but there is no additional per-tick release sample set to claim. Arena's completion log and preceding passed trace assertions establish its riding-stage checks without inventing a complete Arena report that was never attached.

## Attempt 2 — graphics and images

The native backend identity is **ANGLE / Vulkan 1.3 / SwiftShader Device (Subzero)** with WebGL2. The setup's framebuffer pixel readback was `[64, 128, 191, 255]`, GL error zero. Runtime versions were Node v24.22.3, Playwright 1.55.1, and Vite 7.1.7.

There are **ten distinct 1280×800 PNGs**, independently preserved under `screenshots/`: six Valley captures (menu, gate, rearward weight, chase, onboard, pause), and four Arena captures (menu, gate, rearward weight, chase). `screenshots.json` records names, dimensions, byte sizes, and SHA-256 hashes. The duplicate attachment copies in the ordinary output directory are not counted as extra captures. The outdoor gate and Arena chase image were also visually inspected; they contain the real rider/course/HUD presentation. No image, model, or environment was edited.

This is partial functional execution using Low quality on a software renderer. It does not establish physical-GPU FPS, High/Ultra quality, continuously perceived smoothness, manual-player browser jump completion, all four machine/venue browser combinations, full-race reliability, or real-bike calibration. In particular, the ten images cannot substitute for the missing Arena cockpit and pause stages.

## Reproduction and preserved evidence

Run from the repository root without generation hooks:

```sh
node_modules/.bin/vite build
PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/e91efca799c8/pw-browsers \
APEX_BROWSER_BACKEND=swiftshader \
APEX_MOTOCROSS_JOURNEY_QUALITY=low \
APEX_MOTOCROSS_JOURNEY_PROGRESS=1 \
node_modules/.bin/playwright test e2e/45-motocross-gameplay.spec.ts \
  --config playwright.motocross.config.ts
```

The config uses a fresh preview on port 4197 with `reuseExistingServer: false`. The original test, assertions, capture checks, zero-retry setting, and deadlines were not edited.

Key receipts under `test-results/a50-final-native/` are the build and journey command/log records; the before/after input and dist manifests; `build-identity.json`; `environment.json`; `browser-backend.json`; `comparison-to-a37.json`; `summary.json`; `screenshots.json`; Valley's complete journey JSON; `last-observed-diagnostics.json`; and `crash-analysis.json`. The exact HTML report, its 25,012,022-byte failure trace, extracted report JSON, and all ten image attachments are independently preserved so a later run cannot erase this failed invocation. The first interrupted invocation remains in its separate subdirectory.

The root coordinator's full TypeScript/ESLint receipts and the separate physics sweeps are separate evidence; this report does not claim to have executed them. Source/build publication equivalence must use the recorded final input hashes and fingerprint. **Final browser acceptance failed; neither completed invocation finished the journey.**

## Attempt 3 — authorized diagnostic result

The root coordinator released **one** diagnostic invocation after assignment 49, the final **eight-case, 12-rider matrix**, and assignment 54's dense-rig benchmark had finished. The exact existing build, original journey/config, assertions, capture paths, one-worker setting, and zero Playwright retries were retained. There was no rebuild, workaround, source change, deadline extension, or further run. Only `DEBUG=pw:browser` and a bounded read-only resource observer were added.

```sh
python test-results/a50-final-native/diagnostic-run.py --coordinator-released
```

The helper launched:

```sh
DEBUG=pw:browser \
PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/e91efca799c8/pw-browsers \
APEX_BROWSER_BACKEND=swiftshader \
APEX_MOTOCROSS_JOURNEY_QUALITY=low \
APEX_MOTOCROSS_JOURNEY_PROGRESS=1 \
node_modules/.bin/playwright test e2e/45-motocross-gameplay.spec.ts \
  --config playwright.motocross.config.ts
```

Its preflight verified all 1,734 captured inputs, all 266 built files, the exact `commit: null` build identity, preservation of the prior failure, the task-local browser cache, and the absence of an unrequested executable/Xvfb override. Both DEBUG launch records identify the executing binary as `pw-browsers/chromium_headless_shell-1193/chrome-linux/headless_shell`. The SwiftShader framebuffer identity check passed again.

The diagnostic result is **1 unexpected failure, 0 passed, 0 flaky, 0 skipped**, result status **`timedOut`**, retry index **0**, test duration **1,200,671 ms**, and command exit **1**. Its errors are the original **`Test timeout of 1200000ms exceeded`** and **`locator.click: Target crashed`** at the production **APPLY & SAVE** control.

The trace precisely bounds this attempt: the initial menu appeared, GARAGE & SETTINGS opened, and the quality form selected `low`. The APPLY & SAVE action began at trace time **26,054.253 ms**, then waited for the button to be visible, enabled, and stable. A page-closed event appears at **37,569.419 ms**. The action never completed. Consequently **Low was requested and selected, but successful application was not observed**. No motocross venue was entered; there are **zero diagnostic gameplay images and zero completed per-venue journey attachments**. Attempt 2's ten captures remain its own partial gameplay evidence.

Chromium stderr records two GPU-process exits with **`exit_code=9`**, at its logged times `1125/132236.844057` and `1125/132309.714601` (approximately 20:22:36 and 20:23:09 UTC), each followed by GPU-process reinitialization. These component failures are distinct from the parent browser's later normal teardown: the test browser process logged **`exitCode=0, signal=null`** when Playwright closed it after the test timeout. A normal parent-process shutdown does not make the test pass.

### Resource evidence and its limits

The bounded observer retained **121 periodic samples at ten-second intervals plus explicit before/after snapshots: 123 observations**. It recorded host memory, namespace-visible process state/RSS/threads, disk/shared-memory availability, and the availability of kernel/cgroup counters.

| Resource observation | Recorded value |
| --- | ---: |
| Host MemAvailable before launch | 4,904,632 KiB |
| Lowest sampled MemAvailable, 20:22:29.335 UTC | 846,240 KiB |
| Host MemAvailable after termination | 5,083,124 KiB |
| Swap available | 0 KiB |
| Highest sampled sum of visible process RSS | 1,625,056 KiB |
| Workspace free before launch | 270,606,336 bytes |
| Lowest sampled workspace free | 251,514,880 bytes |
| Workspace free after termination | 976,830,464 bytes |

The ten-second cadence can miss peaks. Host memory and the sandbox's visible process list do not establish ownership of every allocation; summed per-process RSS can double-count shared mappings. Cgroup memory counters and `/proc/pressure` files were unavailable. A separate post-event observation found global `oom_kill=7`, but there is no pre-run value or PID association; kernel-log access was restricted. These facts do **not** establish an OOM kill, disk exhaustion, a driver defect, or a physics defect as the cause of either crash.

The coordinator performed two documented housekeeping actions during this same invocation. At **20:24:39.392449 UTC**, removal of a reproducible baseline checkout raised workspace free space from **250,236,928** to **1,102,667,776 bytes**. At **20:33:18.344062 UTC**, removal of the unused full-Chromium download raised it from **367,386,624** to **989,806,592 bytes**. The executing headless shell, all source/dist files, and all evidence were retained; no browser was relaunched or retargeted. Both actions occurred after the two GPU-exit messages. They are recorded environment changes, not proof of causation or recovery. Their original coordinator receipts are copied into the diagnostic directory.

### Preservation, shutdown, and final disposition

The completed diagnostic is independently preserved under `test-results/a50-final-native/diagnostic-attempt-3/`, including `journey-command.json`, `journey.log`, preflight and exact before/after manifests, the native HTML report and **11,900,983-byte trace**, extracted report JSON, resource observations, `kernel-observation.json`, both coordinator cleanup receipts, `diagnostic-analysis.json`, and `terminal-trace-receipt.json`. The trace SHA-256 is `826b3687dba1d0ea152e319991933cc7b66ae2bbb8c99932f5d6bddf3afcbbb3`. The top-level `final-summary.json` provides a compact machine-readable record of all three attempts and sets `final_native_acceptance_passed: false`.

All **88 previously preserved failure/interruption files** still match `preserved-failure-manifest.json`; the diagnostic did not overwrite them. The post-run manifest confirms unchanged source/input aggregate `1cbc70336eaaf00b0559a14a7de7b1af09a9ab4589701059b1656b1ffb4afb41`, unchanged source-only aggregate `a91d8e12d2a2f97a8576fcdfe27f71f2f74eed2e08b8d8c926336e8384173d21`, and unchanged built-file aggregate `fc510344f8e170443957e50410878a25e507f7e765ea92778ecd12dad06fa772`.

**All browser, preview, Playwright, and observer processes have ended.** The post-run process snapshot contains only the receipt wrapper with one thread and its sandbox supervisor; the wrapper then exited with code 1. Both browser-process exit records are retained, and preview port 4197 is closed.

The build gate passed, but the final browser gate failed. The separately passed source, physics, race, replay, calibration, and dense-cadence gates remain separate evidence owned by their assignments. This report makes no claim of completed final-source browser acceptance, physical-GPU FPS, or a proven explanation for the two native failures.
