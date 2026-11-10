# MOTOBOUND launch execution plan

Plan of record for taking `main` from "in development" to a Steam launch that can plausibly reach net US$5,000/month.
It turns the owner's decisions (grill-me session, 2026-11-09) and [ROADMAP.md](studio/ROADMAP.md) into phases with exit
gates. Gate numbers (G3, G8, ...) come from [RELEASE_GATES.md](studio/RELEASE_GATES.md). **Status is updated in the
table at the bottom whenever a phase item changes; every claim there links to evidence (a commit, a CI report or a file).**

## Owner decisions (fixed inputs)

| Topic | Decision |
| --- | --- |
| Scope | Keep all four disciplines (formula, GP bikes, motocross/supercross, open-world festival); polish evenly. Pitch: **"Any machine, any venue"** — offbeat pairings + the 29-event Wildcard Series. |
| Stack | TypeScript + Three.js + Electron. No rewrite; invest in performance, streaming and WebGPU where it pays. |
| Team and money | Owner + AI agents. No budget beyond Steam's US$100 fee. Free / CC0 / licensed assets only. |
| Legal | Only original assets ship (APX-01 hero car). The removed real-brand model stays in git history only; the repo should be made **private** by the owner and the model must never reach a build, a Pages deploy or a release. `ip-guard` stays blocking. |
| Business | US$19.99, free demo, Next Fest, launch in ~4–6 months. Gate: ≥ 10k wishlists before launch; the date slips if it is missed. |
| Multiplayer | None at launch. Async instead: ghosts, daily/weekly challenges, leaderboards. |
| Hardware | Gamepad-first, full wheel support, keyboard fallback, Steam Deck Verified target. Gate: measured 60 fps on a GTX 1660 / RX 580 class GPU (and Deck at low settings). |
| Verification | Owner runs builds on real hardware and sends frame-time captures + "felt wrong" notes; owner recruits 5–10 outside playtesters. |
| Audio | CC0 / royalty-free libraries, licence logged per track; **no generative-AI audio**. Engine sound stays procedural. |
| Languages | EN + FR, DE, ES, PT-BR, IT, PL, TR at launch (known errors fixed). CJK and Russian after launch. |

## Working agreements

- Work on `main`, small commits, push as we go. `main` is the only remote branch (see `main-only.yml`).
- CI is the only source of truth for browser and cross-platform results. The VM has no usable `gh`, so
  `.github/workflows/ci-report.yml` publishes run summaries, failure digests and downscaled screenshots to
  [`ci-reports/`](../ci-reports/) on `main`. To inspect any run, edit `ci-reports/request.json`
  (`run_id`: a number or `"latest"`, `workflow`, `shots`, `artifact_pattern`, `max_shots`, `width`, `log_lines`) and push.
- "Verified" means a command or CI job result is cited. Anything about feel, frame rate on real GPUs or sales is a hypothesis
  until the owner's hardware notes or Steam data say otherwise.
- Do not weaken a test to get green. A stale pin is replaced with evidence; a slow cold start gets a longer deadline only
  with before/after measurements.

## Phases and exit gates

### Phase 0 — green CI, clean builds, measurement tooling
1. CI reporter so results are readable without `gh` (done: `ci-report.yml`, `scripts/ci/ci-report.sh`).
2. Stop report-only / markdown-only pushes from spending ~10 runner-hours (done: `paths-ignore` in `ci.yml`).
3. Triage browser shards 6 and 7, `scenarios` / `offroad-scenarios` timeouts against a fresh run; classify each failure as
   REGRESSION / STALE / ENVIRONMENT; fix with tests.
4. One-command real-hardware benchmark for the owner (frame-time percentiles at Low / Medium / High, boot-to-menu,
   menu-to-driving) built on the existing in-game Performance capture.
5. Build hygiene: confirm the Pages deploy and release builds are product builds guarded by `ip-guard`.
- **Exit:** `Build and validation` fully green on `main`; benchmark runs from one command and its JSON is committed or attached.

### Phase 1 — real hardware (owner-dependent)
Owner runs the benchmark and journeys on a discrete-GPU PC and a Steam Deck; we fix the top frame-time hot spots found;
key art is retaken on a GPU. **Exit:** G3, G8, G9, G10 closed with numbers.

### Phase 2 — content and feel (all four disciplines, evenly)
Audio (music from licensed libraries, engine character per discipline, ambience), vehicle art gaps (cockpit/driver, karts,
trucks, CR-750), localisation fixes (plural-capable strings, known translation errors), gameplay gaps (GP mixed-field falls,
long wet festival events, economy pacing, idle timeouts), first two hours (FTUE), async features (daily/weekly Wildcard
challenge with ghost + leaderboard). **Exit:** ≥ 10 external playtesters, ≥ 70 % would recommend (G12), no blocker.

### Phase 3 — demo, wishlists, launch
Demo build on Steam, Next Fest, creator outreach, store page with retaken art and trailer ([LAUNCH_PLAN.md](studio/store/LAUNCH_PLAN.md)).
**Exit:** G13 ≥ 10k wishlists; then launch; watch G14 (refund < 10 %, ≥ 80 % positive).

### Phase 4 — post-launch cadence (12 months)
Seasonal Wildcard drops, venues, weather, regions; Cyrillic/CJK; evaluate online.

## Status

| Item | State | Evidence |
| --- | --- | --- |
| 0.1 CI reporter | done | commit `9fafa3f`, `ci-reports/build-and-validation.md` |
| 0.2 CI trigger hygiene | done | commit `0394101` |
| 0.3 CI triage | in progress | waiting on run for `a27e738` |
| 0.4 Hardware benchmark | built, unmeasured | `scripts/bench/gpu-bench.mjs`, `tests/gpu-bench.test.ts` (6 tests), [HARDWARE_BENCHMARK.md](HARDWARE_BENCHMARK.md); CI smoke `bench-smoke.yml` (software GL, proves plumbing only); needs the owner's GPU for numbers |
| 0.5 Build hygiene audit | not started | |
