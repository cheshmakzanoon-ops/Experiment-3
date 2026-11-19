# MOTOBOUND launch execution plan

Updated 2026-11-18 after the main-branch graphics, physics and publication audit.

Plan of record for taking `main` from "in development" to a Steam launch that can plausibly reach net US$5,000/month.
It turns the owner's decisions (grill-me session, 2026-11-09) and [ROADMAP.md](ROADMAP.md) into phases with exit
gates. Gate numbers (G3, G8, ...) come from [RELEASE_GATES.md](RELEASE_GATES.md). **Status is updated in the
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
  [`ci-reports/`](../../ci-reports/) on `main`. To inspect any run, edit `ci-reports/request.json`
  (`run_id`: a number or `"latest"`, `workflow`, `shots`, `artifact_pattern`, `max_shots`, `width`, `log_lines`) and push.
- "Verified" means a command or CI job result is cited. Anything about feel, frame rate on real GPUs or sales is a hypothesis
  until the owner's hardware notes or Steam data say otherwise.
- Do not weaken a test to get green. A stale pin is replaced with evidence; a slow cold start gets a longer deadline only
  with before/after measurements.

## Phases and exit gates

### Phase 0 — green CI, clean builds, measurement tooling
1. CI reporter so results are readable without `gh` (done: `ci-report.yml`, `scripts/ci/ci-report.sh`).
2. Exempt only reports and explicitly listed status/handover prose from full validation; machine-consumed Markdown under docs, source, assets or tests still triggers CI.
3. Triage every browser partition and owner QA against a fresh run. The November 16 eight-shard run reached 90-minute job limits;
   scenery and held-preview failures need exact stage/error evidence. Classify each failure as REGRESSION / STALE /
   ENVIRONMENT and fix it with tests. Scheduling changes alone do not close a GPU stall.
4. One-command real-hardware benchmark for the owner (frame-time percentiles at Low / Medium / High, boot-to-menu,
   menu-to-driving) built on the existing in-game Performance capture.
5. Publish only the exact artifact from a completely successful main validation run. Pages and release consumers must
   retain source/manifest/product/IP checks and reject changes to any input or gate after validation.
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
Demo build on Steam, Next Fest, creator outreach, store page with retaken art and trailer ([LAUNCH_PLAN.md](store/LAUNCH_PLAN.md)).
**Exit:** G13 ≥ 10k wishlists; then launch; watch G14 (refund < 10 %, ≥ 80 % positive).

### Phase 4 — post-launch cadence (12 months)
Seasonal Wildcard drops, venues, weather, regions; Cyrillic/CJK; evaluate online.

## Current status

| Item | State | Evidence |
| --- | --- | --- |
| 0.1 CI reporter | implemented; browser failure evidence now persists before suite completion | `scripts/ci/ci-report.sh`, `scripts/browser-progress-reporter.mjs`, `tests/browser-progress-reporter.test.ts` |
| 0.2 CI trigger/source identity | implemented with a conservative shared policy | `.github/workflows/ci.yml`, `scripts/release-source.mjs`, `tests/release-source.test.ts` |
| 0.3 CI triage | open; fresh full run required | [November 16 report](../../ci-reports/build-and-validation.md): 6,307 unit tests passed, one failed; all eight browser jobs and owner QA canceled at 90 minutes; publish skipped |
| 0.4 Hardware benchmark | built, hardware measurements outstanding | `scripts/bench/gpu-bench.mjs`, `tests/gpu-bench.test.ts`, [HARDWARE_BENCHMARK.md](HARDWARE_BENCHMARK.md); earlier benchmark smoke run `42761743565` is harness evidence only |
| 0.5 Publication hygiene | code and targeted tests updated; live deployment requires a successful full run | Pages and CDN consume `apex-formula-release` from the triggering successful first-party main run; shared identity/asset/IP checks; `tests/ci-workflow.test.ts`, `tests/branchless-release.test.ts` |

The full repair scope is in [CURRENT_STATUS.md](../CURRENT_STATUS.md). Do not copy the
November 5 totals into a claim about current `main`. The local repair environment could
not launch Chromium because of socket `EPERM`; fresh browser rendering evidence must
come from a runnable environment or GitHub Actions. A passing unit test is not visual
acceptance or a real-GPU benchmark.

## Exact next steps

### 1. Close the current validation run using its own evidence

Read the run for the repair commit, including `validate`, `unit-tests`, `scenarios`,
`offroad-scenarios`, `wet-presentation`, `owner-qa` and every `browser` shard. The new
browser reporter stores immediate failure messages, locations, active steps and worker
errors even when the job later cancels. Inspect that evidence before modifying the
renderer or deadlines. Keep all current assertions and release dependencies.

Verify that successful publication uses the same validated product artifact for Pages
and the downloadable release. Main may advance only through report/prose paths without
invalidating that source; runtime, assets, tests, tools and workflow changes require
new validation. `BUILD_IDENTITY.json` and `SOURCE_COMMIT.txt` retain the validated SHA,
not a later bot-report SHA. If the full run fails, the existing playable build stays in
place.

### 2. Use the actual Round-3 state

| Discipline | Main status | Next action |
| --- | --- | --- |
| Formula/shared | Heat haze and soft-particle depth support landed in `dfb00ca` | Capture current gameplay under matched settings and assess remaining art gaps |
| MotoGP | Round 3 landed in `25c3f306bfe231aef448a98fbc2cdc59e6499914` on November 11 | Do not reapply `motogp-round3.patch`; inspect current material/contact behavior |
| Motocross/Supercross | Round 3 landed in `1bffdae9af25ede0c155a2b68dc13a260c411e86` on November 11 | Do not reapply `motocross-round3.patch`; compare current Medium/High dust, shafts and gameplay views |
| Open-world Festival | The broad grass/terrain/art patch remains incomplete and unapplied | Review individual proposed changes against current code, remove capture-only debug globals, and require fresh functional/visual evidence |

The focused Festival shadow/exposure/frame-pipeline repair does not deliver the archived
open-world art patch. The [archive index](hyperrealism-wip/README.md) supersedes the old
instructions to apply all three diffs. Historical screenshots must be labeled with their
source revision; they are not proof of current-head quality.

### 3. Finish visual and handling approval on real hardware

Obtain matched route/camera/preset/weather comparisons for all four disciplines, plus
frame-time measurements using the existing hardware harness. Recent MX/SX lighting,
haze and camera changes are authored choices, so tune or revert them only after such
comparisons. Preserve the licensed Formula asset boundary and the IP guard. The current
low-speed player-bike correction preserves GP/expert and AI semantics; a wholesale
solver replacement needs separate design and validation.

Proceed with the remaining content, audio, localization and gameplay priorities after
the current release gates are green. The historical [hyperrealism handover](HYPERREALISM_HANDOVER.md)
is a research record; check each old remaining-work item against present code before
starting it again.
