# Assignment 56 — engine handoff and checkpoint reconciliation

## Result and ownership

The engine handoff is written in [README.md](../README.md), and [CHECKPOINTS.md](../CHECKPOINTS.md) has a dated **2026-11-25 UTC final-resolution appendix**. All earlier checkpoint text and failure observations are preserved. This assignment authored only those two documents and this report.

The README is a substantive developer/user entry point: it explains what changes in physical contacts and visible motion, links the architectural contracts and independent evidence, gives measured before/after examples, identifies the exact accepted scope, and supplies direct reproduction commands. The appendix reconciles the initial contact-time, foot-path, integration, recording, race, gear-extremum, optional-motion and camera findings with the later completed acceptance.

**This is the completed prepublication documentation handoff.** A50's final isolated browser diagnostic and the main-ref publication remain unresolved at this report's handoff. Those states are explicitly pending in the documents. Root owns their final reconciliation from the actual completed reports and publication receipts after this assignment releases ownership; no test or publication result has been invented.

## Evidence reconciliation

The final acceptance table identifies the actual combined selection: **165 distinct files and 1,836 passing cases**, not a sum of overlapping historical runs. It separately identifies all **eight AI races**, **96 classified starts**, **192 rider-laps**, **nine total crashes**, maximum one crash per rider per race and a **14.60-second** maximum stop. Calibration is correctly described as twenty passing configurations with **17 clean and three permitted bottomed hold-speed outcomes**, plus the rolling and applicable gap-window checks.

The final cadence results remain CPU transform and recording-consistency measurements: **93,936 matrix comparisons, 79,344 field comparisons and 36,192 actual rig poses**, with zero measured differences at the tested playback observations. AI races are not substituted for player-solver acceptance, and CPU matrices are not substituted for GPU submission or perceived display smoothness. [A49](49-final-units.md) · [A52](52-final-races.md) · [A54](54-final-cadence.md)

The measured-improvement table labels the source stage of every comparison. In particular, A25's before/after is an intermediate implementation and its wheel-pickup comparison uses **240/480 Hz continuation**, not a blanket claim about all step rates. The body/stance, gear and camera numbers retain their actual trajectory, units and observation scope. No diagnostic-case count is added to the final 1,836 tests.

The inherited CI comparison remains **48 passes/four failures in the same 52-case selection on both source revisions**. It does not claim that the complete repository CI is green or that only four failures exist outside the measured selection. [A42](42-baseline-ci.md)

## Scope, compatibility and unresolved limits

The handoff records **18 runtime paths, 37 test paths and four benchmarks**, plus documentation. It links A51's independent **1,772-file** protected-byte/mode audit and the inverse edit that reconstructs the original `bike.ts` exactly from the allowed reader/import changes. “Models unchanged” means authored content and construction are unchanged; the driven animation is intentionally different. [A51](51-protected-scope.md)

The actual current source identifiers and readers were checked directly: simulation identity **40**, protocol **17**, header **24**, entrant stride **331**, contact tail base **298** and size **33**, optional posture/body rates, the twelve foot-trajectory fields, and the three shared foot-sampling calls in `bike.ts`. The source map distinguishes authoritative incoming force/compression from displayed outgoing travel.

Known limitations are retained: reduced spring/torque work consistency, the forward-only impact-speed constraint, coarse terrain and force-point geometry, bounded supported refinement, unobserved commands/impacts, long-session Float32 header timing and graphics/real-world calibration limits. The contact-search wording explicitly states that bisection refines an endpoint sign bracket and does **not** guarantee the earliest crossing through arbitrary nonmonotonic or thin in-step terrain. A45's optional fender endpoint defect is marked resolved by A47 rather than repeated as an open current defect.

The source commit object `39d9d497880e92801a7d77de6af2639b4186bfcc` is identified only as **prepared**. Its tree is `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`, with parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. Neither the existence of that object nor a matching tree is called a successful main-ref update. The retained working-tree artifact's `commit: null` is not replaced with the prepared SHA. [A53](53-build-provenance.md)

## Reproduction review

The commands call installed Node/Vitest/Vite/ESLint/Playwright tools directly. Reading `package.json` confirmed that the repository's npm `pretest` and `prebuild` hooks invoke player-model generation, so they are not used in the reproduction path.

The exact full combined-unit selection is linked to A49's complete command and inventory. The README deliberately states that the motocross glob alone represents only 128 files and 1,278 cases at this revision. Race/calibration examples run in a fresh output directory, unset the actual `OFFROAD_RACE` filter and preserve the tracked calibration JSON. Browser commands retain the unchanged test, configuration, Low/SwiftShader backend and actual cache-setting requirements.

Reading `evidence/51-protected-scope.py` exposed a qualification relevant to future reproduction: its source protection checks also pin the original inherited CI-receipt head and reject later `ci-reports/` changes. The README identifies it as a historical frozen-candidate audit, with published-source identity verification delegated to the separate read-only BUILD_PROVENANCE recipe. This prevents an unrelated future CI receipt update from being described as an authored-model regression.

No command in this assignment ran a test suite, benchmark, build, browser journey or model generator.

## Lightweight verification and handoff

A local relative-link check inspected **63 README links** and **11 checkpoint links**. All existing-target links resolve. The only presently absent targets are the separately assigned `LIMITATIONS.md` and `AGENT_LEDGER.md`; their owners must finish them before final documentation publication. No numerical or code gate was rerun for these documentation-only edits.

The read-only source check reports **no unstaged differences under `src/`, `tests/` or `scripts/`**. The staged tree remains exactly `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`. No source, test, benchmark, asset, model, environment, specification, index or ref was edited by this assignment.

Root may now update the pending native/publication status and close the final ledger using actual evidence. The historical native interruption/crash and intermediate regressions must remain visible even if a later attempt succeeds. Ownership of README, the appended checkpoint section and this report returns to root; this assignment's active slot is released.
