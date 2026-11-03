# Producer board

Updated by the PM after every merge. Status: TODO · DOING · MERGED · BLOCKED.

## Baseline (main @ ebf691d, 2026-11-03)

- `tsc --noEmit`: 0 errors. `npm run build`: passes. `npm run lint`: passes.
- Initial JS chunk 14.6 MB (4.5 MB gzip) — gate G7 open.
- Full vitest: see below once complete. Known red: `tests/motocross-wheel-pickup.test.ts` (5 failed).
- Boots to menu in Chromium (software GL ≈ 45 s; hardware time unmeasured).

## Wave 1 — all merged to main (3899af8)

| Dept | Result | Evidence |
| --- | --- | --- |
| Content | 19 Wildcard events, Level Nine car park, banked-grid jump-start fix | 38 tests, 19/19 seeded races (agent run) |
| UX/UI | "Paddock Board" front end, 4 discipline plates, venue sheets from real centreline, controller menu nav | build, 22 UI test files, e2e menu-access + launch-board |
| Performance | entry JS 14.6 MB → 3.2 MB raw; 4.47 → 3.54 MB gzip initial (budget 4) | `npm run check:bundle`, lazy-chunk e2e |
| Release Eng | Electron shell, atomic save mirror, 54 achievements, Steamworks hooks (fail-closed), store kit | Linux packaged smoke under Xvfb; NOT run on Win/mac/Steam/real GPU |
| Weather | fog, thunderstorm, dust (6 presets total); snow/ice NOT built | weather-states 40 tests, selftest 14/14, matrix |

Integration done by PM: weather glyphs on the board dial, weather options data-driven inside Paddock markup, e2e D-pad test no longer expected-fail (passes on merged main).

## Wave 2 (queued)

- QA Circuit · QA Bikes & Dirt (start with the wheel-pickup failures) · QA Festival
- Vehicle art & animation audit (46 vehicle ids; model/rig/livery/animation review via renders)
- Wildcard UI integration into redesigned menu
- Audio pass (engine voices per class, weather ambience, UI sound)
- Second content wave: more unexpected venues, seasonal "Series" structure and progression pacing

## Known red on baseline (not caused by studio work)

- `tests/bike-session.test.ts` 'finishes a mixed GP/superbike race' — fails identically on ebf691d (GP 83.281 s vs superbike 83.123 s).
- Bike/motocross tyre-contact files failing in the partial baseline run: motocross-wheel-pickup (5), motocross-tyre-contact (4), motocross-contact-traction (3), motocross-collision (2), gp-tyre-contact (2), bike-session (1), bike-setup (1), gp-riding-control (1). Full-suite run was cut at 279/565 files by the 30 min limit under load; rerun when CPU is free. Owner: QA Bikes & Dirt (wave 2).

## Follow-ups from Content
- Wildcard events need: UI (via UX Paddock Board), lighting hints mapped by Environment, browser look at 4 events, new weather states applied to events (fog on the pass, storm on the harbour).
- Road-bike braking limit on tight street circuits; car-drivable motocross lanes; a second unexpected venue.
