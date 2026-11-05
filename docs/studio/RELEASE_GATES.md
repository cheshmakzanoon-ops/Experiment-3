# Release gates for a US$5k/month Steam target

## The arithmetic (assumptions, not promises)

- Steam keeps 30%. Net US$5,000/month needs roughly US$7,150 gross.
- At a US$19.99 list price that is ~360 paid units/month, sustained; at US$14.99 ~480.
- Launch spikes decay. Sustaining the figure needs discovery after month 1: updates, seasonal
  sales, content drops, streamer/creator reach and a strong review score.
- Racing sits between two crowded poles (AAA sims and cheap arcade racers). A browser-born
  codebase must clear the "feels like a real game" bar on first launch to survive refunds
  (2 h play window / 14 days).

## Gates

Status key: **V** verified in repo with evidence · **P** partly · **X** needs external evidence/hardware · **N** not started.

| # | Gate | Threshold | Status |
| --- | --- | --- | --- |
| G1 | Clean install builds, typechecks, lints | build + lint exit 0 | V — build, lint, tsc, IP guard clean on main (3ac9c2d) |
| G2 | Unit/simulation suite | 0 failing | V — full vitest run on main 2ed0ae9: **616 files, 6,086 tests, 0 failing** (67 min on a loaded 4-CPU host) |
| G3 | First-launch to first driving ≤ 90 s, ≤ 3 inputs | measured by script | P — first-launch → driving in 1–2 inputs (firstrun.mjs); wall time on real hardware unmeasured (software GL 170–330 s) |
| G4 | Each discipline playable menu → race → results → exit without console errors | formula, GP bike, MX, SX, festival | P — GitHub Actions on ubuntu-24.04/llvmpipe (run 41915850034): browser shards 1,2,3,4,5,8 PASS, 6 and 7 fail (triage in progress); local sweep 75/133 specs; journeys on software GL; festival activities headless |
| G5 | Distinctive front end: identity, controller-first nav, no placeholder copy | art-direction review | P — Paddock Board, Wildcard board, season board, first-launch, results board, gamepad nav; no external art review |
| G6 | "Only here" hook: mismatched vehicle/venue Wildcard series, weather variety | ≥ 12 wildcard events, ≥ 6 weather states | V — 29 Wildcard events (29/29 headless PASS), 51 circuits, 7 weather states incl. snow |
| G7 | Cold load budget | main JS ≤ 4 MB gzip initial; menu interactive quickly | V — initial JS 3.50 MB gzip (budget 4) |
| G8 | 60 fps on min-spec GPU, Steam Deck 40+ fps | hardware measurement | X |
| G9 | Desktop wrapper, offline, persistent saves, fullscreen, gamepad hot-plug | packaged build launches | P — Linux package smoke under Xvfb; Windows/macOS legs written in CI but never run |
| G10 | Steamworks: achievements, cloud save, rich presence | wired + toggled by env | P — 54 achievements + local leaderboards/records; Steam upload path only ever exercised against a fake client |
| G11 | Store page assets: capsule, trailer script, screenshots, description | drafted in repo | P — store kit, 10 screenshots, trailer storyboard, 8-language store drafts (unreviewed). **Capsule art half done in the repo** (reports/marketing-art.md): logo system (`store/BRAND.md`), 18 Steam images at exact sizes with a manifest, safe areas measured, upload checklist; frames are software-GL, so a GPU retake, a real-GPU trailer (only an animatic of stills exists) and a Steamworks-preview look remain |
| G12 | ≥ 10 external playtesters, ≥ 70% would recommend | human data | X |
| G13 | ≥ 10k wishlists before launch | Steam dashboard | X |
| G15 | No third-party IP in shipped assets: no real team/sponsor marks, car silhouettes or node names; every asset has a provenance row | asset audit + IP guard in build and CI | **P (code closed, law open)** — real-brand supplied car is owner-only and out of every product build (dist 166→128 MB), guard runs inside `vite build` and CI; owner/counsel items remain: purge the asset from git history, check whether the public Pages site and release artifacts already published it, trademark clearance of names (see reports/ip-audit.md §6) |
| G14 | Refund rate < 10 %, review ≥ 80 % positive | Steam dashboard | X |

The studio can close G1–G11 inside this repository. G8, G12–G14 depend on hardware, people and
the market. They stay open until real data exists; this repository never claims them.
