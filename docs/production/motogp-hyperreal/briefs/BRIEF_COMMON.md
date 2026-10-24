# MotoGP Hyperrealism Programme — Common Brief (read fully before starting)

You are one of five specialist workers on a coordinated push to take the **MotoGP section** of
MOTOBOUND (TypeScript + three.js 0.180 browser racing game) from "amateurish and cartoony" to
**hyperrealistic**, matching a 100-image MotoGP 26 (PS5) reference pack. The project manager
(PM) assigns you one workstream. Stay inside it.

## What "the MotoGP section" is
- Machines: `gpr1` (GP-R1 PROTOTYPE) and `gpr2` (GP-R2 PROTOTYPE) in `src/simulation/bike-definitions.ts`.
  Physics opt-in: `src/simulation/bike-vehicle.ts` (`definition.id === 'gpr1' || 'gpr2'`).
- Ruleset `'gp-motorcycle'`. GP circuits: `src/simulation/circuit-catalogue/motorcycle-gp.ts`
  (`poggio-alto`, `cape-wrenna`, `haarveld`, `montejaral`).
- Read the history first: `docs/MOTOGP_R6_RACE_SHELL.md` (latest pass), `docs/motogp-physics-model.md`,
  `docs/MOTOGP_THREEJS_CONTACT_PASS.md`. Six earlier passes added *detail* but the result still
  reads like a toy. Our job is not more parts — it is **believability**: proportion, mass, light,
  material response, motion.

## The references (your north star)
Extracted at: `/tmp/claude-0/-home-user-Experiment-3/983cfd5e-605f-54c5-80ad-8f45bf036f1f/scratchpad/refs/MotoGP26_PS5_100_Reference_Images/`
- Start with the 5 contact sheets in `CONTACT_SHEETS/`, then open the full-res images named in your brief.
- `MANIFEST.csv` lists every image. Rights: re-create principles only. **Never** copy real team
  names, sponsor logos, rider names or liveries (no Ducati/Lenovo/Michelin/Monster etc.). Use the
  repo's existing fictional names (MOTOBOUND, MERIDIAN OIL, AUREL BANK...).

## The current state (what the user is unhappy with)
Baseline captures from the real simulation + production renderer (High preset, Poggio Alto,
live race, AI riding the player bike) are in:
`docs/production/motogp-hyperreal/baseline/ (Medium; the High baseline run did not complete)`
(`chase-*.jpg`, `cockpit-*.jpg`, `trackside-*.jpg`, `metrics.json`). Older evidence: `docs/production/motogp-race-shell/*.jpg`.

PM's diagnosis of why it reads cartoony (all workstreams together):
1. **Light**: flat, high-ambient look; weak key-light shadowing; no photographic contrast, depth or lens character.
2. **Bike**: slab-sided, toy-proportioned shell; paint reads as plastic; no visible mechanical depth through the fairing gaps; tyres and wheels lack real-world finish.
3. **Rider**: doll-like (oversized round helmet, tube limbs, stiff pose); does not ride the bike like a MotoGP rider (no deep tuck, no aggressive hang-off/elbow-out, no head into the corner, no feet down at standstill).
4. **Onboard**: giant gold toy fork caps fill the view; no fairing/screen/dash composition like REF_017/074/088.
5. **Track**: flat uniform asphalt and grass; billboard trees; run-off and kerbs lack the painted, rubbered, worn real-world look.
6. **Feel**: the motion of bike + rider + camera does not convey 160 kg / 300 hp / 1.5 g braking / 60° lean.

## Ground rules
- **Scope**: MotoGP only. The same codebase runs F1, motocross and an open-world festival. Any
  change to shared systems (renderer, materials, circuits, cameras, shared tyre code) must be
  **gated to GP machines / GP sessions / GP venues** or demonstrably non-regressive for other modes.
- **Procedural only**: Blender is not installed and blender.org is blocked. Author geometry,
  textures (canvas / DataTexture / shader) and materials in TypeScript like R6 did.
- **No new npm dependencies** unless indispensable; `three/addons/*` is available.
- **Budgets**: GP bike high LOD ≤ 110,000 triangles and ≤ 220 draw calls (see `tests/gp-race-shell.test.ts`,
  `e2e/gp-rider-contact.spec.ts`). Don't add a full extra scene render pass per frame. Medium preset must keep working.
- **Determinism**: simulation must stay deterministic (replays, online prediction). Rendering must be
  driven by snapshot/frame state, not wall-clock time, wherever existing code does so.
- Keep the code style of surrounding files (dense, typed, explanatory doc comments). Add unit tests
  for new logic under `tests/`.

## Your working environment
- You run in your **own git worktree**. First thing: `ln -s /home/user/Experiment-3/node_modules node_modules`
  in your worktree root (do NOT run `npm ci` — saves disk and time). If a script needs the
  generated player LODs, run `npm run generate:player-lods` once.
- Machine: **4 CPUs shared by 5 workers**, software WebGL (no GPU). Be economical with browser captures.
- **Capture loop** (the PM built this for you; it is committed):
  ```sh
  xvfb-run -a -s "-screen 0 1280x800x24" node tools/motogp/review/hyperreal-capture.mjs <outDir> \
     --preset high --moments 26,34 --views chase,cockpit,trackside [--weather rain] [--circuit poggio-alto]
  ```
  ~8–15 min at High on software GL (shader preparation dominates). The PM is re-running the
  baseline with it right now; the baseline images appear in the folder above when done. **Do not
  edit the shared harness files** (`e2e/fixtures/motogp-hyperreal-capture.ts`,
  `tools/motogp/review/hyperreal-capture.mjs`) — if one fails for you, copy it into your
  scratchpad folder, fix the copy (absolute import paths into your worktree), and note the
  failure in your report. Run it with `run_in_background`
  and keep working. Use fewer views/moments when you can. Isolated bike/rider studio shots:
  `e2e/fixtures/motogp-reference-review.ts` (`captureBike(view, detail, id, wet)` — see how
  `e2e/41-motogp-reference.spec.ts` bundles it with vite and runs it in Playwright; Chromium is at
  `/opt/pw-browsers/chromium`; launch headless:false under `xvfb-run` with
  `--use-gl=angle --use-angle=gl`). Write your own small scratch runner if useful (keep it out of `src/`).
- Put your captures under `/tmp/claude-0/-home-user-Experiment-3/983cfd5e-605f-54c5-80ad-8f45bf036f1f/scratchpad/<your-worker-id>/`.
  **Look at your captures** (Read the image) next to the named references. Iterate until the
  difference is obvious. A change you have not seen rendered is not done.

## Validation before you hand back
- `npx tsc --noEmit` clean.
- `npx eslint <changed files>` and `npx prettier --check <changed files>` clean.
- `npx vitest run <relevant test files>` — run the suites that cover what you touched. Known
  pre-existing failures (they fail on the base commit too; R6 doc): 25 failures across
  `bike-session`, `bike-setup`, `bike-pit-service`, `gp-braking-approach`, `gp-contact-effects`,
  `gp-control-feedback`, `gp-corner-phases`, `gp-pit-departure`, `gp-riding-control`,
  `gp-seamless-braking`, `gp-tyre-contact`. Don't add new failures; record counts before/after.
- Update existing tests whose pinned numbers legitimately change (e.g. triangle pins) and say so.

## Hand-off
- Commit on your worktree branch in logical commits (`feat(motogp-<area>): ...`). End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RoE6Fb6DiA2D5nEgf3f5sB
  ```
  **Do not push** and do not open PRs. The PM merges branches.
- Final report (concise, factual): branch name + commit hashes; what changed and why (tied to
  reference numbers); files touched (flag any outside your ownership list); before/after capture
  paths; test/lint/typecheck results with counts; known limits and what you'd do next.
