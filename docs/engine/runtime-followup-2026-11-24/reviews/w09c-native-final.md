# Worker 51 / Wave 9C — final native and full-game replay gate

## COMPLETE — PASS at checkpoint 9119c768

Executed the existing combined suite once on **2026-11-25 04:55:09–04:58:08 UTC**: **37/37 cases across nine files passed**, zero retries, skips, flaky cases or failures. The guarded browser process exited 0. Playwright reports 175,752.511 ms total; the complete replay case took **133,586 ms**, within its unchanged 300,000 ms deadline.

**COMPUTE and BROWSER leases were explicitly released to root after inspecting the successful results.** The owned direct Vite preview was stopped. No additional check or source edit is pending. Root retains control of the repository source freeze and publication.

## Exact source and build identity

| Receipt | Value |
| --- | --- |
| Commit | `9119c7683d821d145f15ed64a03ee3406595b58d` |
| Tree | `3b704f846c3283c21e73f8f5c3febf670a773c63` |
| Source fingerprint / BUILD_IDENTITY fingerprint | `c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe` |
| Guarded source SHA-256, before and after | `d3bb494f817402f0723bb35fcc9dadec875669032f8803e0f6eebc9ae7d2584a` |
| Guarded input paths | 3,396; all identical before/after |
| Production dist | 266 files; 135,848,008 bytes; all identical to worker50 before and after |
| Worker50 dist manifest SHA-256 | `78d3adc808eda6f274157a8d7a51146e02cdf508d5454217b2c3a5684b9cea65` |
| Build variant / edition | product / full |
| package-lock.json SHA-256 | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |
| Generated supplied-player LOD file | Absent before and after; no generator ran |

The served BUILD_IDENTITY on 127.0.0.1:4173 matched the exact commit, fingerprint, product variant and full edition. The runner independently rehashed every source input and dist file before and after. All three change arrays—source, dist during run, and dist against worker50—are empty. Git status remained only the pre-existing untracked browser-progress.json receipt. The aggregate source digest uses the same path + NUL + guard-value + LF format as worker50.

## Native runtime identity

- Chromium **140.0.7339.186**, installed headless shell at `/tmp/engine-c71f32882729/browsers/chromium_headless_shell-1193/chrome-linux/headless_shell`.
- Browser executable SHA-256: `003728e0b77eb9d52e4d258594bd55ce22ecd245eb6d3b6858fbd844c901ad7d`.
- Playwright **1.55.1**; Node **v24.22.3**; V8 **13.6.233.17-node.63**; Linux **6.18.57**, x64.
- Verified backend: **ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)**.
- Native WebGL2 framebuffer readback **[64, 128, 191, 255]**, GL error **0**. The standard backend check records softwareRendererDetected=true and physicalHardwareValidated=false.

## Executed coverage

| Existing suite | Passed |
| --- | ---: |
| engine-native-audio | 3 |
| engine-native-channels | 5 |
| engine-native-input | 3 |
| engine-native-lifecycle | 7 |
| engine-native-preview | 7 |
| engine-native-recording | 5 |
| engine-native-resources | 4 |
| engine-native-workers | 2 |
| replay-state | 1 |
| **Total** | **37 / 9 files** |

Every case has exactly one successful result with retry index 0. No test, fixture, assertion, timeout, graphics setting, backend configuration or production input was changed by this worker.

### Full-game stall and exact seek evidence

The original replay case booted the real full-product game with its existing settings: low quality, practice, zero opponents, rain, wet compound. It retained the genuine **8,500 ms main-thread busy stall**.

| Observation | Result |
| --- | --- |
| Replay duration before / after stall | 6.933333396911621 / 15.933334350585938 seconds |
| Telemetry samples before / after stall | 420 / 960; **+540** |
| Recording warnings | Empty after stall and at final inspection |
| Requested / observed first seek position | 0.75 / 0.75 seconds |
| Submitted frames before / after seek | 9 / 10; **exactly one new frame** |
| In-page observation callbacks | 2 |
| First seek presentation time | 6.72410774230957 seconds |
| Replay start | 5.97410774230957 seconds |
| Presentation-time error against start + 0.75 | **0 seconds** |
| First seek pending / playing | false / true |
| Paused endpoint / settled endpoint | 16.133333206176758 / 16.133333206176758 seconds |
| Restart floor / restarted position | 0 / 0 seconds |
| Final held replay position / surface time | 0 / 0 seconds |

The same case passed modal/focus/audio ownership, frozen simulation-frame comparisons, endpoint pause/restart behavior, and empty page/console error assertions. The retained replay-first-frame.png was inspected: it shows the real circuit/car scene and replay controls paused at 0:00. It is a visual receipt, not a pixel-equivalence or performance measurement.

### W08 changes exercised by the native cases

The real suspended AudioContext resumed to running at 48 kHz; the cancelled old preview did not schedule, and a fresh preview did. This is genuine native resume handling, not a fake-success resume fixture.

The wrapped CSV transfer case used 600 rows × 228 columns, a 547,200-byte snapshot, native sender detachment, zero snapshot/continued-recording differences, and exact output bytes. CSV size was **1,268,138 bytes**, SHA-256 `120e22a8e14c8efe4f2ff77b7e952f33abb8c8f33e209c09b0fcb3493bbe5298`, with one unique worker termination. Cancellation/replacement/validation recovery retained exact output, rejected stale success, detached all five snapshots and terminated all five workers exactly once.

All four existing native resource cases passed, including shared registration/pixel ownership, Festival GPU cleanup cycles, and mixed-source circuit teardown after imported/generated listener failures. Existing actual-worker transfer/channel, native input, IndexedDB, audio cadence and lifecycle cases also passed.

## Execution and ownership

Scratch runner invocation:

```sh
NODE_OPTIONS=--max-old-space-size=1024 node --experimental-transform-types /tmp/engine-c71f32882729/w09c-native-final-gate.mjs 9119c7683d821d145f15ed64a03ee3406595b58d 3b704f846c3283c21e73f8f5c3febf670a773c63
```

The runner read worker50's passing receipts under `/tmp/engine-c71f32882729/w09b-work/`, then started only its own server:

```sh
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
```

With CI unset, the unchanged standard config reused that verified server. No npm preview/prebuild/pretest/dev hook, dependency install, asset generation, historical Git-blob read or git mutation ran. Git metadata calls and inherited Vite Git calls used GIT_NO_LAZY_FETCH=1 and protocol.allow=never.

The guarded test command expanded the eight native filenames explicitly, plus replay-state:

```sh
node --experimental-transform-types scripts/source-stability.ts -- node node_modules/@playwright/test/cli.js test e2e/engine-native-*.spec.ts e2e/replay-state.spec.ts --config=playwright.config.ts --workers=1 --retries=0 --forbid-only --reporter=list,json,html,./scripts/browser-progress-reporter.mjs --output=/tmp/engine-c71f32882729/w09c-results
```

The environment selected APEX_BROWSER_BACKEND=swiftshader, the installed Chromium path above, a 1,024 MiB Node old-space limit, and external JSON/HTML report paths. Standard 300,000 ms replay / 60,000 ms expectation deadlines and all existing per-case settings were preserved. The owned preview stopped after the gate; its exit 143 records the runner's normal SIGTERM shutdown, not a test failure.

## Raw evidence

All evidence is outside the repository, except the standard guard-exempt root browser-backend.json and browser-progress.json receipts, which were also copied outside.

- Main manifest: `/tmp/engine-c71f32882729/w09c-native-gate-manifest.json`
- Exact orchestration: `/tmp/engine-c71f32882729/w09c-native-final-gate.mjs`
- Logs: `w09c-runner.log`, `w09c-browser.log`, `w09c-preview.log` in the same scratch directory.
- Full machine-readable report: `w09c-browser-report.json`; case inventory: `w09c-case-results.json`.
- Native backend and progress: `w09c-browser-backend.json`, `w09c-browser-progress.json`.
- Source/dist maps: `w09c-source-before.json`, `w09c-source-after.json`, `w09c-dist-before.json`, `w09c-dist-after.json`.
- Extracted attachments and hashes: `w09c-attachments/`, `w09c-attachment-manifest.json`.
- Full replay attachments: `w09c-attachments/37-recording-stall-continuity.json` and `w09c-attachments/37-replay-ownership.json`.
- HTML report: `w09c-html-report/`.
- Screenshot: `w09c-results/replay-state-recorded-play-e24a8-k-audio-and-focus-ownership/replay-first-frame.png`.

The manifest retains exact commands, runtime identity, source/build provenance, output hashes and the key raw measurements. Success produced no failure trace; the standard retain-on-failure behavior was unchanged.

## Limits and scope

This is native API and software-renderer validation, not physical GPU, speaker, controller, haptics, FPS, browser-heap or whole-engine performance evidence. The native fixture scenarios and the full-game replay have distinct coverage. The 600-row native CSV case does not replace worker45's separate default-size export measurements. The resource cases retain their existing listener ordering and do not prove every vendor/nested-owner fault combination is drained. No broad all-game/browser-suite claim is made.

This worker changed only its external runner, handoff and evidence. No authored models, characters, environments, geometry/material/texture definitions/assets, vehicle tuning, source/config/tests/docs, git state or publication were changed.
