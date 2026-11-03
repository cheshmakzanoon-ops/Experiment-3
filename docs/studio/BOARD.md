# Producer board

Updated by the PM after every merge. Status: TODO · DOING · MERGED · BLOCKED.

## Baseline (main @ ebf691d, 2026-11-03)

- `tsc --noEmit`: 0 errors. `npm run build`: passes. `npm run lint`: passes.
- Initial JS chunk 14.6 MB (4.5 MB gzip) — gate G7 open.
- Full vitest: see below once complete. Known red: `tests/motocross-wheel-pickup.test.ts` (5 failed).
- Boots to menu in Chromium (software GL ≈ 45 s; hardware time unmeasured).

## Wave 1 (dispatched)

| Dept | Branch | Scope | Status |
| --- | --- | --- | --- |
| UX/UI Director | worktree | art direction, main menu redesign, pause/results restyle | DOING |
| Content | worktree | ≥ 14 Wildcard events + validation + accessor | DOING |
| Environment | worktree | ≥ 3 new weather states (physics + visuals + audio + UI option) | DOING |
| Performance | worktree | split 14.6 MB chunk, measure boot | DOING |
| Release Eng | worktree | Electron shell, Steamworks hooks, achievements, store kit | DOING |

## Wave 2 (queued)

- QA Circuit · QA Bikes & Dirt (start with the wheel-pickup failures) · QA Festival
- Vehicle art & animation audit (46 vehicle ids; model/rig/livery/animation review via renders)
- Wildcard UI integration into redesigned menu
- Audio pass (engine voices per class, weather ambience, UI sound)
- Second content wave: more unexpected venues, seasonal "Series" structure and progression pacing
