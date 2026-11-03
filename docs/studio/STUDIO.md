# MOTOBOUND studio operating model

Target: a Steam-ready indie release that can plausibly earn US$5,000/month net revenue.
No test can guarantee sales. The studio therefore tracks **measurable readiness gates**
([RELEASE_GATES.md](RELEASE_GATES.md)) and keeps unverifiable claims labelled as hypotheses.

## Org chart

| Role | Owns | Reports |
| --- | --- | --- |
| Producer / PM (lead session) | backlog, merges to `main`, release gates, honesty of status | the owner |
| UX/UI Director | front-end identity, menus, HUD language, flow, accessibility | board |
| Gameplay QA — Circuit | formula/GT sessions: menu → grid → race → results → exit | board |
| Gameplay QA — Bikes & Dirt | GP bikes, motocross, supercross | board |
| Gameplay QA — Festival | open world, activities, photo mode | board |
| Content Design — Tracks & Events | new venues, mismatched vehicle/venue "Wildcard" events | board |
| Environment Art — Weather & Time | weather types, time of day, surface response | board |
| Vehicle Art & Animation | model audit, rider/driver animation, liveries | board |
| Performance & Build | bundle split, load time, memory, frame budget | board |
| Release Engineering | desktop wrapper, saves, Steam hooks, CI, store-page assets | board |

## Rules

1. `main` is the only long-lived branch. Existing branches are not touched.
2. Each agent works on a short-lived branch `studio/<dept>-<topic>` created from current `main`.
3. Merge into `main` only after: `npm run build` (includes tsc), `npm run lint`, and the
   affected vitest files pass. Then delete the branch (local and remote).
4. Never weaken, skip or delete an existing test to get green. Fix the code or fix the test's
   genuine defect and say why.
5. Every agent ends with a written report in `docs/studio/reports/<dept>-<date>.md`:
   what was checked, what was fixed (files), what remains broken, evidence (commands, outputs).
6. No licensed names, logos or liveries (F1, MotoGP, Forza etc.). Content stays original.
7. Do not invent verification. "Not tested" is an acceptable status; "works" requires evidence.

## Cadence

Wave → agents report → PM merges and updates [BOARD.md](BOARD.md) → next wave from the top of the backlog.
