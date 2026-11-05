# Hyperrealism capture tooling

Headless capture and shader-check scripts written by the four section agents of the hyperrealism pass. How to run
each one, timings and pitfalls are in [../HYPERREALISM_HANDOVER.md](../HYPERREALISM_HANDOVER.md) under each
section's "Capture tooling".

| Folder | Section | Main entry points |
| --- | --- | --- |
| `f1/` | Formula cars and circuits | `run.mjs` + `capture.ts` (copy to `test-results/f1-capture/`), `check.mjs` shader harness |
| `motogp/` | GP bikes and riders | `reference-capture.mjs`, `race-capture.mjs`, `ao-capture.mjs`, `compare.py` |
| `motocross/` | Outdoor MX and stadium SX | `capbuild.sh` + `capture.mjs`, `bike.mjs`, `check.mjs` |
| `open-world/` | Solvane Coast festival | `capture.mjs`, `road-probe*.mjs`, `terrain-probe.mjs`, `shadercheck.mjs` |

These are development aids, not product code: they are outside `tsconfig`/eslint scope and are not part of the
build. They contain absolute paths from the session that produced them; adjust paths to your worktree first.
