# Hardware benchmark (owner guide)

The release gate G8 needs real numbers from a real GPU. This is the one command that produces them.
Nothing in this repository has been measured on a GPU yet; until you run this and send the report, every
frame-rate statement is a hypothesis.

## Run it

Requirements: Node 22+, a checkout of this repo, a machine with a discrete or integrated GPU (not a VM / remote desktop).

```
npm ci
npx playwright install chromium     # once
npm run bench:gpu                   # builds dist/ if missing, then runs 3 journeys x Low/Medium/High at 1920x1080
```

Takes roughly 20–40 minutes. Close other apps; plug a laptop into power and select its high-performance mode.
If the window never appears or the GPU shows as "SwiftShader" / "llvmpipe", add `--headed`.

Useful options:

| Flag | Meaning |
| --- | --- |
| `--journeys formula-race,gp-race,motocross` | Which flows to drive (`node scripts/studio/tools/journey.mjs --list` lists all, incl. `festival`, `supercross`, `rallycross`). |
| `--qualities low,medium,high` | Graphics presets to sweep. |
| `--target-quality medium` | The preset the pass/fail targets apply to. Use `low` for a Steam Deck run. |
| `--viewport 1280x800` | Use this for Steam Deck. |
| `--min-avg 58 --min-p5 45 --max-stall-ms 250 --max-boot-s 30` | The targets. |
| `--allow-software` | Run on an emulator anyway (smoke test only; the report says NOT HARDWARE). |

## What you send back

The folder `bench-out/<timestamp>/` contains `bench-report.md` (a table) and `bench-report.json` (every number).
Send both, plus the model of your GPU and CPU, your OS, and any moment where the game "felt wrong" (stutter, input lag,
wrong sound, confusing menu) with the venue and machine you were using.

## How to read it

- `avg fps` / `median` — presented animation frames per second while driving (first 3 s dropped).
- `p5` / `p1` — the 5th / 1st percentile second: how bad the bad seconds are. A game that averages 60 but has
  p5 = 30 stutters.
- `max stall ms` — the longest main-thread gap; over 250 ms is a visible freeze.
- `heap +MB (2nd session)` — JS memory growth across a second back-to-back session; large growth means a leak.
- The pass/fail targets apply to the `--target-quality` preset only: a mid-range GPU (GTX 1660 / RX 580 class)
  must hold average ≥ 58 fps and p5 ≥ 45 fps with no freeze over 250 ms, and boot to the menu in ≤ 30 s.

The deeper in-game tool (pause menu → **Performance capture**, see [PERFORMANCE_VALIDATION.md](PERFORMANCE_VALIDATION.md))
records every frame interval including GPU time where the browser exposes it; use it to investigate a failing cell.
