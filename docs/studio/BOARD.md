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

## Wave 2a — merged to main (6ffc9c5)

| Dept | Result |
| --- | --- |
| QA Bikes & Dirt | Re-landed contact-impulse physics + GP racecraft fixes dropped by the restore commit; GP standstill-launch fix; e2e fixture fix. Previously red files now green. Physics version bumped 18 → 19 (PM decision). 7 test expectations were re-landed from upstream ec93c56 (listed in qa-bikes-dirt.md). |
| Vehicle Art | 57/57 machines captured; EH-3/SC-7 white-hole fix (25 bodies); showroom framing per machine size; rigged driver arms (steering follows); numeric pose probe. |

### New blockers/defects from wave 2a
- **G15 IP blocker:** default APX-01 uses `supplied-player.glb.gz` = real F1 car + real sponsor sheets (D4). Needs replacement/licence decision. Also the 36 MB asset is the largest boot fetch.
- `tests/bike-session.test.ts` 'mixed GP/superbike race' still red; margin worse (GP 0.45 s *slower* than superbike). Real balance defect.
- Open art defects D5–D11 (SS/SBK/CR fairings, open-cockpit drivers, 37 bodies share one livery, kart/truck low detail, showroom backdrop).

## Wave 2b / 3a — merged to main (aecec04)

| Dept | Result |
| --- | --- |
| UX wave 2 | Wildcard board (19 events, medals, start from card, results medal + pay), LIGHT dial, HUD identity layer, UI sound cues, CONTINUE; DIRT-series chip bug fixed |
| QA full-flow | 6 journeys (formula practice/race, time trial, GP bike, wildcard, festival) complete with 0 console errors on software GL; Escape-pause bug fixed; festival loading bar stages; P19 test fixed. Festival "hang" was slow software GL, not a deadlock |
| Vehicle Art 2 | EH-3 hero pass, 47 colourways, shared driver rework, sport bike shells |

## Wave 3b + test health — merged to main (ebaf773)

| Dept | Result |
| --- | --- |
| QA Bikes 2 | GP AI follows its braking plan: sweep falls 277 → 6; physics v20 |
| Weather 2 | snow/ice, dawn fog-cover channel, mist/floodlight shafts, visibility race-control ladder, 2 wildcard events; physics v21 (fog preset changed) |
| UX 3 | career season board, first-launch screen, results board + share card, settings guide + accessibility, restyled screens |
| Test health | first full unit run on merged main: **5720 pass / 31 fail of 5751 tests (596 files)**; 30 fixed (weather-2 header fixtures, rendering fixtures, stale contracts); 1 left: mixed GP/superbike race |

## Merged since: bikes 3, calibration, audio, localization, festival QA, e2e sweep (main 2ed0ae9)
- Full unit suite: **616 files / 6,086 tests, 0 failing**.
- e2e sweep: 75/133 specs run (53 pass), Paddock Board 720p overflow regression fixed (reviewer widened the fix to 789 px), 12 specs ported to the lazy showroom.
- 8 UI languages (7 model-written drafts needing native review), 29 Wildcard events 29/29 headless pass, festival 18/18 activities complete headlessly, GP riders pass slower bikes (GP faster in ~94% of mixed races; out-of-sample falls level with main).

## In flight now (wave 7)
- Marketing art (logo, Steam capsules, key art), UX 4 design-critic pass + hero framing fix, Vehicle art 3 (hero car, bikes, karts, trucks).

## Previous in-flight list
- Content 2 (4 venues + 8 wildcard events), Release 2 (demo build, Steam leaderboards, packaging CI, store screenshots), Bikes 3 (mixed-field passing without falls; branch studio/physics-test-health has the unmerged pass logic).

## Wave 3 (historical)

| Dept | Scope | Status |
| --- | --- | --- |
| IP/Legal + hero car | original APX-01 hero, supplied real-brand asset out of default builds (dist 166 → 128 MB), IP guard in build + CI, notices | MERGED 17550e8 after REJECT → rework → re-verify. Owner/counsel items open (history purge, check already-published Pages/release artifacts). Polish: hero car is cropped by the paddock rail in the menu framing |
| QA Bikes 2 | GP bike AI crash rate, GP-vs-superbike pace, dirt journeys | DOING |
| Environment 2 | snow/ice, dawn, visibility rules, wildcard pairings | DOING |
| UX 3 | career front door, first-run, results, settings, remaining screens | DOING |

## Not measurable in this sandbox (open, honest)
- Frame rate / load time on real GPUs, Steam Deck, Windows; Steam client; external playtesters; wishlists; refunds. These decide whether US$5k/month is reachable and no amount of in-repo work closes them.

## Remaining queue

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
