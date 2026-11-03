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
| G1 | Clean install builds, typechecks, lints | build + lint exit 0 | V (baseline) |
| G2 | Unit/simulation suite | 0 failing | see BOARD |
| G3 | First-launch to first driving ≤ 90 s, ≤ 3 inputs | measured by script | N |
| G4 | Each discipline playable menu → race → results → exit without console errors | formula, GP bike, MX, SX, festival | N |
| G5 | Distinctive front end: identity, controller-first nav, no placeholder copy | art-direction review | N |
| G6 | "Only here" hook: mismatched vehicle/venue Wildcard series, weather variety | ≥ 12 wildcard events, ≥ 6 weather states | N |
| G7 | Cold load budget | main JS ≤ 4 MB gzip initial; menu interactive quickly | N (14.6 MB / 4.5 MB gz today) |
| G8 | 60 fps on min-spec GPU, Steam Deck 40+ fps | hardware measurement | X |
| G9 | Desktop wrapper, offline, persistent saves, fullscreen, gamepad hot-plug | packaged build launches | N |
| G10 | Steamworks: achievements, cloud save, rich presence | wired + toggled by env | N |
| G11 | Store page assets: capsule, trailer script, screenshots, description | drafted in repo | N |
| G12 | ≥ 10 external playtesters, ≥ 70% would recommend | human data | X |
| G13 | ≥ 10k wishlists before launch | Steam dashboard | X |
| G15 | No third-party IP in shipped assets: no real team/sponsor marks, car silhouettes or node names; every asset has a provenance row | asset audit + replacement | **P (code closed, decisions open)** — the real-brand `supplied-player.glb.gz` is owner-only (`MOTOBOUND_SUPPLIED_PLAYER=1`), out of `dist/` and the bundle; APX-01 is the original authored car; every shipped asset has a row in [reports/ip-audit.md](reports/ip-audit.md); `npm run check:bundle` fails on a real-brand string or owner-only binary. Open: owner/counsel decisions listed there (history purge, reference material in the repo, name clearance, look-alike risk). Not legal advice. |
| G14 | Refund rate < 10 %, review ≥ 80 % positive | Steam dashboard | X |

The studio can close G1–G11 inside this repository. G8, G12–G14 depend on hardware, people and
the market. They stay open until real data exists; this repository never claims them.
