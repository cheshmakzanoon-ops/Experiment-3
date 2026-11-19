# Retained fixture corrections — 19 November 2026

Local commit `29e8b14` is based on `57d1a98`. It changes exactly three existing e2e fixture/spec files. Production source, original assertions, tolerances, test discovery, seeds, graphics settings and deadlines are unchanged.

## Demonstrated causes and corrections

1. `e2e/fixtures/gp-contact-effects.ts`: the controlled flat-road object implemented `sample` and `nearest`, but lacked the native `Track.cast` operation now used by `BikeVehicle.writeBody`. It now implements bounded ray/flat-plane intersection and writes the flat normal in both sampling paths. The real production bike pose is still used.
2. `e2e/fixtures/apx01-assembly.ts`: the fixture starts with `Simulation.makeFrame`, which contains valid measured contact blocks. It changed legacy wheel travel while leaving authoritative recorded `C.HUB_LENGTH` frozen. Production correctly preferred the latter, producing the observed 0.06 m mismatch against the independently authored socket oracle. The fixture now authors the same known travel into both input representations. It retains the original 2e-6 endpoint tolerance and socket calculation; it does not clear the validity mask or derive expected endpoints from renderer output.
3. `e2e/09-reference-depth.spec.ts`: the count poll dereferenced a temporarily unpublished renderer during asynchronous replacement. Its callback now returns zero while that owner is absent. The unchanged assertion still requires a strictly positive actual geometry count and retains its original deadline. Later active-state, frame-preservation, focus and page-error assertions remain unchanged.

## Actual verification

- Exact baseline source reproduces all three exceptions in `native-proof.json`.
- Corrected GP source constructs and poses the real `ContactBike` through nine lean/pitch combinations with finite physical transforms.
- The complete original APX `exercise` function runs using the real GLB loaders, real `FormulaCar` and native Canvas 2D. Baseline reproduces `Upright joint detached: 0.060000004698496916 != 0`. Candidate passes all 68 poses and 2,176 suspension endpoint checks, plus original memory/LOD, driver contact, pit ownership, damage, brake heat, paint/livery texture-budget, mirror and rewind assertions. No geometry substitute or stubbed canvas pixels are used.
- The exact original geometry-survey poll callback throws against an unpublished renderer. The corrected callback observes `[0, 0, 12]` and the original greater-than-zero predicate accepts only the final state.
- `node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/gp-contact-effects.test.ts tests/wheel-contact-recording.test.ts tests/phase27h-assembly.test.ts`: **65 tests in three files passed**, exit 0.
- Source-stability-wrapped `npx tsc --noEmit`: **passed**, exit 0.
- Source-stability-wrapped ESLint on the three changed files: **passed**, exit 0.
- Prettier check on the three changed files and `git diff --check`: **passed**, exit 0.

These are CPU/source checks. No browser or WebGL pass is claimed, and no existing end-to-end requirement is replaced. The reference-depth callback can still fail the original readiness deadline if the actual renderer does not become ready.

## Proof transport

`run-fixture-proof.mjs` bundles the exact baseline/candidate fixture sources with the installed esbuild and executes them in Node. The only environment adapter supplies native `@napi-rs/canvas` Canvas 2D through `document.createElement('canvas')`; actual WebCrypto, actual loaders, source geometry and source assertions run unchanged. The first proof invocation stopped at a missing esbuild text loader for existing shader imports. The second invocation adds that loader and passes; both logs are retained. `native-proof.json` records exact fixture source SHA-256 values and checks the candidate inputs remain unchanged afterward.

The generated bundle files are temporary and need not be committed. `review-package/` contains the compact report, proof, reproduction script, logs, source patch and SHA-256 manifest suitable for retention with the coordinator's CI record.
