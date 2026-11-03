# Studio helper tools

Developer helpers used during the F1 25 look programme (see `docs/studio/`). Run from the repo root
(or a worktree with `node_modules` linked). Browser tools use SwiftShader through the system Chromium;
set `CHROMIUM_PATH` if Playwright cannot find one.

| File | Purpose |
|---|---|
| `capture.mjs` | Simple capture: menu, four cameras, driving. `node scripts/studio/tools/capture.mjs <out> --url http://127.0.0.1:<port>` |
| `qcap.sh` | Shader check then `scripts/studio/capture-matrix.mjs`, both under a capture lock. Scratch dir: `$STUDIO_SCRATCH` (default `$TMPDIR/apex-studio`). |
| `shadercheck.mjs` | Loads the build and fails on shader compile / page errors. |
| `menushot.mjs` | Front-end menu screenshots. |
| `uxshots.mjs` | Real-game menu screenshots at 1280x720, 1920x1080, 1024x600 and 390x844, plus the GP, dirt, festival and settings scenes (JPEG). |
| `uxdom.mjs` + `ux-fixture.ts` | Fast DOM-only screens of the real Interface (menu per discipline, pause, results, settings, controls, championship) with no WebGL boot. |
| `quickstart.mjs` | Menu-to-driving probe counting inputs (G3). Software GL on a shared host is far slower than hardware: the time is an upper bound. |
| `flashcheck.mjs` | End-to-end flashback check in a live session. |
| `fastcheck.sh <area>` | Per-area vitest subsets (render, world, car, character, ui, assets, sim). |
| `journey.mjs` | FULL-FLOW QA: menu -> configure -> start -> keyboard drive -> pause -> resume -> results -> exit -> second session, for `formula-practice`, `formula-race`, `time-trial`, `gp-race`, `wildcard`, `festival` (`--list`). Records timings, console/page errors, simulation snapshots tapped from the physics worker, screenshots, memory, optional CPU profiles (`--profile`) and machine-checked findings into `--out`. Run with `node --no-warnings --experimental-transform-types scripts/studio/tools/journey.mjs --journey <name> --out <dir> [--url ...] [--quality low]`. |
| `keyboard-driver.mjs`, `driver-selftest.mjs` | The journey tool's closed-loop digital driver (throttle/brake/left/right from centreline pursuit) and its headless tuning harness against the production `Simulation` (`... driver-selftest.mjs aurel apx01 150 practice`). Tuned for four-wheel cars; it cannot hold a GP bike on keyboard steering. |
| `journey-summary.mjs`, `journey-evidence.py`, `profile-callers.mjs`, `ai-only-race.mjs` | Digest of a journey directory; copy it into the repo as JPEG + JSON evidence; attribute a CPU profile's hot native calls to their JS callers; an all-AI control race (`... ai-only-race.mjs kansai-east gpr1 4 3 73021`) to tell an AI fault from one the player caused. |
| `pw-port.config.ts` | Playwright config for a worktree build on a private port (`APEX_WT`, `APEX_PORT`). |
| `stats.py`, `px.py`, `crop.py`, `mergeshots.py`, `frametimes.py` | Image crop statistics, pixel probes, montages and frame-time extraction from capture `diag.json`. |

The canonical capture and KPI tools are `scripts/studio/capture-matrix.mjs`, `look-metrics.py`,
`shotdiff.py` and `signoff.mjs`.
