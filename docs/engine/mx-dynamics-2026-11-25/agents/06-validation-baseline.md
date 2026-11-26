# Agent 06 — non-MX preservation baseline and validation map

## Captured before implementation

Baseline: `../evidence/non-mx-baseline.json`.
Runner: `scripts/bench/mx-dynamics-preservation.ts`.

Captured at `2026-11-25T20:27:16.326Z`, checkout HEAD
`f3b39eb8e1b02fc0677086819fc384b6ceacefc2`, Node `v24.22.3`, physics category 39.
Initial `git status --short` showed no tracked modifications. Only this runner,
the evidence JSON and this report were added by Agent 06. No production, geometry,
model, material, venue or environment files were changed.

Every case uses clear Aurel, practice mode, sport assists, seed 73021, one scripted
player and one same-machine AI opponent at skill 0.9. The runner applies a fixed
integer-tick throttle/brake/steering/rider-weight/clutch/shift schedule for 1,200
steps at 120 Hz (10 simulated seconds). It hashes the initial snapshot and every
subsequent `Simulation.writeFrame()` snapshot as raw native-endian Float32 bytes.
Each case includes 1,201 snapshots, 686 floats per snapshot, 3,295,544 hashed bytes,
and 11 independently hashed one-second checkpoints. No frame fields are omitted,
rounded or normalized; `stepMs` and `dropped` retain their deterministic zero
defaults. All snapshots must be finite and the player must reach more than 1 m/s.

| Machine | Complete trajectory SHA-256 | Peak player speed (m/s) |
| --- | --- | ---: |
| Formula `apx01` | `0e1a963b4d6ef505e93734d3fa076717ab2ec3b1b61a3e52902600a4b081ebec` | 34.2037 |
| GP `gpr1` | `caa1ee1bceba1b016b331d5bd9497740dc96338d26544cc81d26a37380e41b56` | 36.3135 |
| Road `sbk1000` | `67fccf665aaa07b5b529316e8b8f00308e44614fc5634de4a19fea773a922239` | 24.2691 |
| Supermoto `sm450` | `0a173e5467298367869dbabbd730d367eaaec2b1788432978f175b9d3aa00283` | 23.8554 |
| Rallycross `rcx6` | `60b324e80ee59b92c2a4b53560bfbb7408506501e4408defa6e5db35fe0d2560` | 32.2277 |

The JSON separately records full validated options, session identity, record
category, protocol version, input hash, runner hash, and key engine source hashes.
Comparison enforces identical raw trajectories, checkpoints, options, protocol,
input schedule, runner and identity content. Only `identity.simulationVersion`
and `category.physics` may differ, so a deliberate global category bump does not
hide a behavioral regression. Engine source hashes are provenance, not equality
gates, because the MX implementation is expected to change those sources.

### Reproduce and compare

Run from the repository root, serially:

```bash
node --max-old-space-size=384 --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

Add `--output docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-current.json`
to save the candidate capture. Output files use exclusive creation and cannot
overwrite the baseline or an existing candidate capture. Omit `--compare` and
provide a new `--output` path to make an independently named capture. Do not edit
the runner after capturing this baseline: its hash is part of the comparison.

Validation performed here:

- Baseline capture completed successfully for all five cases.
- A fresh invocation against the captured baseline returned `pass: true`,
  `mismatches: []`, `cases: 5`, baseline/current physics both 39.
- Direct Prettier formatting and direct ESLint on the new runner passed.
- No production suites, full races, browser sessions, builds or asset generators
  were run by this agent.

Scope: these are exact ten-second clear-Aurel regression witnesses, not an
exhaustive proof for every discipline, weather condition or race duration. The
`rcx6` case covers its vehicle dynamics on Aurel, not a terrain rallycross heat or
joker routing. The existing suites below supply the broader behavioral coverage.

## Existing validation commands and focused coverage

`package.json` defines `test` as `vitest run`, `test:e2e` as `playwright test`, and
`test:offroad` as the calibration script followed by the race script. Use direct
installed binaries below: `pretest`, `prebuild`, `predev`, and `prebuild:demo`
invoke `scripts/build-player-lods.mjs`. `scripts/build-qa.mjs` also calls that
generator internally. Those entry points can rewrite protected assets and are
unnecessary for this engine validation. This finding is from `package.json` and
`scripts/build-qa.mjs`, not a reason to change those files.

### Focused MX behavior matrix

The following groups cover the existing MX dynamics contracts. Each brace item
names an existing test file. Run one group at a time; the checked-in Vitest config
already uses one worker and a 120-second per-test timeout.

```bash
# Contact, support, soil, thermal and cornering mechanics.
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-{ground-physics,contact-impulse,contact-traction,tyre-contact,rut-contact,braking-bumps,berm-lines,thermal,cornering-reserve,forgiving-handling}.test.ts

# Player air control, weight transfer, input transport and crash/recovery behavior.
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-{riding,rider-weight,body-input,landing-prediction,collision,rider-recovery,shoulder-recovery,dab-ground}.test.ts

# AI traffic, approaches, race control and fixed-tick snapshot cadence.
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-{ai,heading-guard,rider-timing,race-control,snapshot-cadence}.test.ts tests/offroad-meeting.test.ts tests/offroad.test.ts

# Measured player practice feedback and entry/HUD behavior.
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross-{landing-challenge,rhythm-coach,berm-practice,flow-practice,hud}.test.ts

# Identity, serialization, generic physics and explicit non-MX integration guards.
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/session-identity.test.ts tests/snapshot-header-contract.test.ts tests/physics.test.ts tests/bike-session.test.ts tests/motogp-physics.test.ts
```

For the full existing MX unit/regression surface, Vitest's path substring filter
also includes the presentation contracts that consume the simulation snapshots:

```bash
node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/motocross- tests/offroad.test.ts tests/offroad-meeting.test.ts
```

### Calibration and complete race suites

These direct script invocations avoid npm lifecycle hooks but do write their
documented JSON reports. Run serially, with a separate budget for long races.

| Invocation | Behavior covered | Report written |
| --- | --- | --- |
| `node --experimental-transform-types scripts/offroad-calibration.ts` | Gate acceleration for MX450, MX250 and SM450; every surveyed MX/SX jump at hold speed; ballistic range; undershoot/overshoot; walking-speed roll-through | `docs/offroad-calibration.json` |
| `node --experimental-transform-types scripts/offroad-races.ts` | Default outdoor MX, indoor SX, rainy enclosed SX, rallycross and stage races, plus every built-in off-road event | `docs/offroad-races.json` |
| `node --experimental-transform-types scripts/offroad-races.ts --mx-full-grid` | Eight two-lap 12-rider mixed MX250/MX450 races across both MX/SX courses and clear/rain settings | `test-results/motocross-full-grid.json` |
| `node --experimental-transform-types scripts/offroad-races.ts --mx-stress-grid` | Twenty-four two-lap 12-rider races with additional seeds across the same courses/weather matrix | `test-results/motocross-stress-grid.json` |

`OFFROAD_RACE=<case-insensitive label substring>` filters the race script. For
example, `OFFROAD_RACE='Valley Ridge'` selects its fixed outdoor race. The full and
stress grid modes label cases by circuit ID, weather and seed, so
`OFFROAD_RACE='arena-nord-sx'` narrows either grid mode to SX. Inspect the report's
`races` count: an unmatched substring currently produces an empty selection.

The race runner checks completed classification, no retired healthy entrant,
maximum continuous stopped time below 20 seconds, discipline crash bounds,
per-rider crash limits and actual soil deformation. Rallycross/stage cases also
check their own joker/start/split rules. Keep those existing assertions intact.

## Browser entry points

The production entry route is `/`: choose the **DIRT** plate, **OUTDOOR MX** or
**STADIUM SX**, then the machine (`mx450`/`mx250`). This is the visible route used
by `e2e/45-motocross-gameplay.spec.ts`; it exercises an eight-rider gate, driving,
cameras, pause and switching between Valley Ridge and Arena Nord. It exposes the
optional `APEX_MOTOCROSS_JOURNEY_QUALITY` setting through the real settings UI.

| Browser spec | Purpose |
| --- | --- |
| `e2e/45-motocross-gameplay.spec.ts` | Actual application journey and production worker snapshots on both MX/SX venues |
| `e2e/48-motocross-practice.spec.ts` | Landing targets, held-brake guidance, autopilot exclusion, measured retry placement, mobile controls |
| `e2e/54-motocross-berm-practice.spec.ts` | Measured berm comparisons in the production HUD |
| `e2e/55-motocross-flow-practice.spec.ts` | Linked-section practice-judge results and mobile control clearance |
| `e2e/42-motocross-bike.spec.ts` | Production bike/rider motion, contact, suspension, recovery and rewind presentation |
| `e2e/43-motocross-world.spec.ts`, `e2e/44-motocross-interface.spec.ts` | Venue presentation and MX entry/live-alert/landing interface coverage |
| `e2e/46-motocross-normal-residency.spec.ts`, `e2e/49-motocross-worked-soil.spec.ts`, `e2e/50-motocross-terrain-continuity.spec.ts`, `e2e/51-motocross-roost-lighting.spec.ts`, `e2e/56-motocross-tyre-traces.spec.ts` | Supplemental surface/contact presentation, residency, replay and lighting regressions |

Focused existing browser command, against the appropriate already-built app:

```bash
node node_modules/@playwright/test/cli.js test e2e/45-motocross-gameplay.spec.ts e2e/48-motocross-practice.spec.ts e2e/54-motocross-berm-practice.spec.ts e2e/55-motocross-flow-practice.spec.ts --workers=1
```

`playwright.config.ts` targets `http://127.0.0.1:4173`, uses one worker, no retries,
300-second test deadlines, and retains failure screenshots/traces. Its web server
command is `npm run preview -- --port 4173` (no preview lifecycle hook is defined).
Outside CI it reuses an existing server; a direct equivalent is
`node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173`.
`APEX_BROWSER_BACKEND` is `swiftshader` by default; `mesa` requires Linux and an X
display and is checked by the existing backend setup. Browser and complete race
suites have only been mapped here, not claimed as passing.
