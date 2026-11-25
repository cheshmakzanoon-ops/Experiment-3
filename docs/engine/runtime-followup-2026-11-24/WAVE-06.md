# Wave 6: native browser validation and continuous checks

All six workers completed. New native tests exercise Chromium APIs and production engine code. The local backend was ANGLE/SwiftShader; exact published checkpoint validation also ran on Mesa in CI. Neither establishes physical-hardware FPS.

## Native evidence

| Assignment | Result | What was established |
| --- | --- | --- |
| Preview audio | 7/7 cases | Native 48 kHz stereo output; mute, stop and menu/paused blur remove scheduled tones; fresh previews remain audible |
| Keyboard and worker input | 3/3 cases | 36 trusted key events and a trusted iframe blur; exact FIFO shifts through the production pump and a DedicatedWorker; held-repeat and widget ownership |
| Worker channels | 5/5 cases | One diagnostics packet while 360 ticks advance; 64-message Festival cap; 200 overloaded pauses add no frames; bounded recovery and terminal failures |
| WebGL resources | 4/4 cases | Exact native CPU/GPU texture pixels; shared storage; six stable rendered Festival disposal cycles; source restoration after listener faults |
| IndexedDB and export | 5/5 cases | Reloaded and resealed rewind branches have zero differing pose words; double surface cutoffs retained; actual transferable CSV worker ownership |
| Existing full-game replay | 1/1 case | Complete modal, seek, focus, audio and recording ownership scenario; source guard and original deadlines retained |

### Audio and input details

Cancellation at the native rendering boundary of 0.1013333333 seconds left both later tone windows at exactly zero peak. A fresh preview remained audible (approximately 0.296–0.299 RMS). Pending canceled graphs rendered digital silence; replacement PCM matched all 96,000 channel samples. A real suspended AudioContext resumed without reviving a revoked request. These are DSP/request-ownership checks, not physical speaker or OS latency measurements.

The keyboard fixture controls sampling time but does not implement its own queue. It uses real InputController, the extracted production GameApp pump, actual circuit simulation and native worker delivery. Actual steps consume `[1, 1, -1, -1, 1, 0, 0, 0]` for the recorded burst. No physical gamepad or vibration result is claimed.

### GPU ownership details

A registration of 1,025 wrappers across three budget groups uses three canvas draws, three GPU textures and 1,025 version increments. Native canvas and GPU comparisons against independent references differ in zero bytes. This demonstrates preserved pixels and storage sharing, not an inferred reduction in GPU allocation relative to the already-shared old implementation.

Across six Festival cycles, active texture/geometry/program counts of 5/6/7 return to the same retained 1/2/4 baseline, including a persistent test probe and fixed Three.js VSM internals. The borrowed renderer draws an exact-color probe afterward without context loss or GL error. Circuit exception cases restore every source and foliage setting, preserve a first thrown undefined value, and release later owners. Read-only observation identifies the remaining one VSM geometry and three VSM programs as backend internals; fixture teardown releases them separately. No authored scene resources are changed.

### Storage and full-game details

Three replay cases force real IndexedDB eviction, reads, rewind page reopening, branch append and a second read. Pose comparisons have zero differing Float32 words. A later surface only 1e-10 seconds beyond the double cutoff is excluded. Session-owned database rows are removed on disposal. This does not claim persistence across a browser restart.

A wrapped 600-row, 228-channel snapshot transfers 547,200 bytes and detaches at the sender while its recorder continues. The 1,268,138-byte CSV matches exactly. Replacement, cancellation, invalid input and recovery retain the correct promise owner; five native workers terminate once each. Maximum CSV memory was not measured by this fixture.

The unchanged full-game replay case passed in 138,932 ms on SwiftShader. Its actual 8,500 ms main-thread stall increased replay coverage from 6.9333333969 to 15.9333343506 seconds and telemetry from 420 to 960 rows, with no recording warnings. The first requested seek at 0.75 seconds submitted exactly one frame. This local dist had the current published engine's source, built before commit publication; the CI run below supplies exact published-commit evidence.

## Focused CI gate

The workflow now selects all `e2e/engine-native-*.spec.ts` cases plus the unchanged full replay. Selector validation finds 37 cases across nine files: 36 native cases and one full replay. Paths cover all 14 native/clock fixtures, all 32 engine-prefixed unit files, network/session sources and the imported test helpers.

A new source-guarded unit step uses direct Vitest, one worker, a 1,024 MiB heap and no retries. The 20-minute workflow deadline, verified Mesa backend, original replay assertions/settings, existing source guards, broad CI requirements and evidence uploads remain intact. No model-generation hooks run.

The first combined unit run passed 381/383 cases and exposed two outdated post-terminal publication expectations. Those cases now assert retained frame ownership, no extra frame or resumed ticks after queued pause/resume, and retain independent clock conservation and fresh-init checks. The complete rerun passed **383/383 tests in 32/32 files** in 73.84 seconds. Actual-worker conservation error remained at most 5.329070518200751e-15 seconds.

## Published checkpoint evidence

Checkpoint `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6` passed compiler, production build and all 13 prior native/replay cases in CI in 2.1 minutes on verified Mesa. [Exact-source CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45534027941/job/138936089887). The new native additions and expanded workflow are published in the next checkpoint and require their own CI outcome.

The complete project compiler also passed with all new native fixtures present. Its sole initial issue was a widened circuit-ID literal in the new channel fixture; preserving that literal type corrected it without changing runtime code. Native measurement JSON and full replay ownership observations are retained in `validation/`.
