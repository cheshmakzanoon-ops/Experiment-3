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
| `flashcheck.mjs` | End-to-end flashback check in a live session. |
| `fastcheck.sh <area>` | Per-area vitest subsets (render, world, car, character, ui, assets, sim). |
| `pw-port.config.ts` | Playwright config for a worktree build on a private port (`APEX_WT`, `APEX_PORT`). |
| `stats.py`, `px.py`, `crop.py`, `mergeshots.py`, `frametimes.py` | Image crop statistics, pixel probes, montages and frame-time extraction from capture `diag.json`. |

The canonical capture and KPI tools are `scripts/studio/capture-matrix.mjs`, `look-metrics.py`,
`shotdiff.py` and `signoff.mjs`.
