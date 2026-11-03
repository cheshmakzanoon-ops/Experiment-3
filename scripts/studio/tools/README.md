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
| `vehicle-shots.mjs` | Vehicle showroom capture: boots the real menu once, sets the real `#vehicle` select for every machine, waits for a completed menu frame of that machine (`apexDiagnostics().menuPreview`) and saves a 1280x720 JPEG (<= 200 KB) each. `--reps` (one per class), `--all`, `--ids a,b`, `--prefix before`, `--skip-existing`, `--chrome` (keep the menu UI). Needs `npm run generate:player-lods` once in a fresh worktree. Output: `docs/studio/reports/vehicle-screens/`. |
| `vehicle-sheet.py` | Contact sheet (cropped car region, labelled tiles) from vehicle-shots captures. |
| `vehicle-drive.mjs` | In-session capture (pick discipline:machine, start, hold keys, JPEG chase/cockpit shots). Reaches the festival HUD but SwiftShader cannot complete a screenshot of the open world: use on a GPU host. |
| `body-audit.mts` | Headless geometry audit of every catalogue body (size vs collision box, tyre radius, hub error, arch clearance): `npx vite-node scripts/studio/tools/body-audit.mts [id ...]`. |
| `quickstart.mjs` | Menu-to-driving probe counting inputs (G3). Software GL on a shared host is far slower than hardware: the time is an upper bound. |
| `flashcheck.mjs` | End-to-end flashback check in a live session. |
| `fastcheck.sh <area>` | Per-area vitest subsets (render, world, car, character, ui, assets, sim). |
| `pw-port.config.ts` | Playwright config for a worktree build on a private port (`APEX_WT`, `APEX_PORT`). |
| `stats.py`, `px.py`, `crop.py`, `mergeshots.py`, `frametimes.py` | Image crop statistics, pixel probes, montages and frame-time extraction from capture `diag.json`. |

The canonical capture and KPI tools are `scripts/studio/capture-matrix.mjs`, `look-metrics.py`,
`shotdiff.py` and `signoff.mjs`.
