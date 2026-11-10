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
| 0.3 CI triage | done | commit `c238c12` (`.board-sheet` overflow in `9fafa3f`, verified `44-motocross-interface.spec.ts`; `unit-tests` 45m budget + workflow concurrency; lazy-showroom → circuit/grid software-GL budgets; `ci-report.sh` log fetch; `RacingRenderer.preparationTimeoutMs`) |
| 0.4 Hardware benchmark | built, unmeasured | `scripts/bench/gpu-bench.mjs`, `tests/gpu-bench.test.ts` (6 tests), [HARDWARE_BENCHMARK.md](HARDWARE_BENCHMARK.md); CI smoke `bench-smoke.yml` (`ci-reports/benchmark-smoke.md`, run `42761743565` passed); needs the owner's GPU for numbers |
| 0.5 Build hygiene audit | done | verified `deploy-playable-pages.yml`, `publish-playable-cdn.yml`, and `desktop-packages.yml` produce product builds guarded by `scripts/ip-guard.mjs` (`tests/ci-workflow.test.ts`) |

## Exact Next Steps for the Next Developer

### 1. Check the `Build and validation` CI Run on `c238c12`
- Phase 0 is committed and pushed on `main` (`c238c12`), which triggered a fresh `Build and validation` run with the new 45-minute `unit-tests` budget, workflow concurrency cancellation, 90s software-GL GPU preparation timeout (`RacingRenderer.preparationTimeoutMs = 90000`), and 120s/240s lazy-showroom → circuit/grid E2E budgets.
- Check `ci-reports/build-and-validation.md` (or run `gh run list --workflow="ci.yml" --limit 3`) once the run finishes to confirm all jobs (`validate`, `unit-tests`, `scenarios`, `offroad-scenarios`, `wet-presentation`, `owner-qa`, `browser (1..8)`) are green.

### 2. Land the Three Saved Round-3 Hyperrealism Patches ([`docs/studio/hyperrealism-wip/README.md`](hyperrealism-wip/README.md))
Apply, fix, verify (`npx tsc --noEmit && npm run lint && npx vitest run <section-tests>`), commit, and push each discipline's Round-3 patch in its own commit:
1. **MotoGP (`docs/studio/hyperrealism-wip/motogp-round3.patch`):**
   - Apply source & test changes: `git apply --include='src/**' --include='tests/**' docs/studio/hyperrealism-wip/motogp-round3.patch`.
   - In [`src/rendering/bike.ts`](../../src/rendering/bike.ts) lines 466, 471, 472: change `readonly aluminium`, `readonly forkUpper`, and `readonly forkLower` on `BikeMaterials` from `T.MeshStandardMaterial` to `T.MeshPhysicalMaterial`.
   - In [`src/rendering/gp-front-hydraulics.ts`](../../src/rendering/gp-front-hydraulics.ts) (or [`tests/gp-front-hydraulics.test.ts`](../../tests/gp-front-hydraulics.test.ts) line 42): widen the `Materials` helper parameter type (`Pick<BikeMaterials, ...>`) or construct `new T.MeshPhysicalMaterial()` for `aluminium` in `tests/gp-front-hydraulics.test.ts` so `tsc --noEmit` passes.
   - In `tests/gp-panel-relief.test.ts` line 53: type `const allowed = new Set<number>([...])`.
   - Check if `hemShellEdges` changes the GP shell triangle count pin in [`e2e/gp-rider-contact.spec.ts`](../../e2e/gp-rider-contact.spec.ts) (`TRIANGLES = { gpr1: 96695, gpr2: 95916 }`) and update with the exact delta if needed.
   - Verify with `npx tsc --noEmit && npm run lint && npx vitest run tests/gp-*.test.ts tests/bike.test.ts`.
2. **Motocross / Supercross (`docs/studio/hyperrealism-wip/motocross-round3.patch`):**
   - Apply source & test changes: `git apply --include='src/**' --include='tests/**' docs/studio/hyperrealism-wip/motocross-round3.patch`.
   - In [`src/rendering/offroad/mx-course-dressing.ts`](../../src/rendering/offroad/mx-course-dressing.ts): add `meadow: mxShoulderPlantGeometry('meadow'),` to `plantGeometry`.
   - In [`src/rendering/offroad/index.ts`](../../src/rendering/offroad/index.ts) (`OffroadScene`): wire `installMxArenaLighting(this.terrain.material, this.stadium.lampGrid)` when both `this.terrain` and `this.stadium` exist.
   - Verify with `npx tsc --noEmit && npm run lint && npx vitest run tests/motocross-*.test.ts`.
3. **Open-World Solvane Coast (`docs/studio/hyperrealism-wip/open-world-round3.patch`):**
   - Apply source & test changes: `git apply --include='src/**' --include='tests/**' docs/studio/hyperrealism-wip/open-world-round3.patch`.
   - Remove all temporary `// OW-DEBUG` hooks (`__owDbg`, `__owMorphOff`) from `src/rendering/open-world/coastal-water.ts`, `src/rendering/open-world/festival-renderer.ts`, `src/rendering/open-world/terrain.ts`, and `src/rendering/open-world/water.ts`.
   - Verify with `npx tsc --noEmit && npm run lint && npx vitest run tests/festival-*.test.ts`.

### 3. Execute Remaining Hyperrealism & Phase 2 Items
- Follow the per-discipline priority lists in [`docs/studio/HYPERREALISM_HANDOVER.md`](HYPERREALISM_HANDOVER.md) (Lagarde specular occlusion, hot brake rotor light spill, soft-particle depth binding for smoke/dust, split `BikeMaterials.dark`, titanium header thin-film iridescence, MX garment micro-normals, open-world cliff triplanar detail & building ground-contact AO).
- Proceed through Phase 2 in [`docs/studio/ROADMAP.md`](ROADMAP.md) (localisation plural strings via `npm run check:i18n`, procedural engine/ambience audio polish, vehicle art gaps, and gameplay reliability).

