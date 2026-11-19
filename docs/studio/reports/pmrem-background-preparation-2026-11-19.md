# Retained PMREM background preparation — 19 November 2026

## Scope and disposition

This candidate extends local `872fa9d06edbcbb57b47167f0c99a660bb9bb3ef`, whose tree was published on the isolated diagnostic branch as `a02e516cf3a58b33e4f783ecb37baafeed0e6ba5`. That earlier candidate passed the component, gameplay and menu jobs but failed the original High readiness deadline. This change has completed CPU verification; its browser outcome is pending. It is not a claim that the High startup failure is resolved.

The prior High diagnostic identified two late `PMREM.Background` programs. The installed Three r180 `PMREMGenerator.fromScene` creates and disposes a temporary `MeshBasicMaterial` background on every scene capture. With no other owner, disposing the first bin's material retires its program, so the next bin reacquires and initializes an equivalent program during the drawing stage.

## Correction

`src/rendering/pmrem-preparation.ts` now provides a native `MeshBasicMaterial` owner with the same name, back-face selection and depth settings as r180's temporary background. It compiles on the existing linear target without rendering, copying shader text, allocating another PMREM atlas or changing any capture. The temporary CPU box geometry is released immediately. Tone mapping is restored on success and failure. The helper explicitly requires the installed r180 interface.

`src/rendering/reflections.ts` retains that owner with the already-retained conversion and blur owners. It initializes its metadata at the existing preparation completion point, before the original scene warmup. Native material ownership identifies the background program even if another equivalent material first supplied a different debug name. Partial construction failures release all acquired owners; final disposal releases the retained owner and removes pending work.

The first capture still renders every original face and scenery item at the original resolution. No quality preset, timeout, GPU-completion requirement, simulation code, shadow policy, scene geometry or acceptance assertion changed. Prior ownership tests now count the additional retained owner while retaining their existing cache, cancellation, restoration and lifetime assertions.

## Verification

The new tests execute the installed r180 `PMREMGenerator.fromScene` against the existing native program-cache harness. This is a CPU ownership model, not a browser or GPU rasterizer.

- Across three sky-bin captures, the unprepared consumer creates **three** background program objects. The corrected consumer reuses **one** prepared handle for all **18** background draws.
- The complete sequence of background, sky and blur submissions matches the unprepared native consumer, including camera transforms, target sizes, atlas viewports, tone mapping and clear state. Complete native program-cache keys and vertex/fragment shader sources also match.
- The retained background issues its first metadata query before scene submissions and survives every temporary native background disposal. Releasing the final owner deletes that handle once.
- A program originally named by a different equivalent material is reused correctly and remains alive until that original owner releases it.
- Failure while compiling the background restores renderer state, releases the partial conversion/blur/background owners and permits a clean retry. Existing disposal/re-entry tests continue to pass.

Final commands ran through the existing `scripts/source-stability.ts` guard; all returned exit code **0** with protected inputs unchanged:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/pmrem-background-preparation.test.ts tests/reflection-preparation.test.ts tests/reflections.test.ts tests/startup.test.ts tests/scene-ambient-preparation.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx eslint src/rendering/pmrem-preparation.ts src/rendering/reflections.ts tests/pmrem-background-preparation.test.ts tests/reflection-preparation.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx tsc --noEmit
```

The focused suite passed **83/83** tests across five files. `git diff --check` also passed. The first draft of the new test helper read a native program handle after Three destroyed and cleared it; the final helper records the live handle/source before disposal. That test-helper correction did not change production code.

The [compact receipt and logs](evidence/pmrem-background-preparation-20261119/receipt.json) retain exact commands, exits and elapsed times. The documentation/evidence files were added after the guarded checks; the checked production and test inputs were not changed afterward.

## Remaining work

1. Run the unchanged isolated High, component, gameplay and menu jobs on this exact candidate source, including the original High 90-second readiness predicate.
2. Inspect the resulting native diagnostic for any late background program acquisition and the next unfinished operation. The earlier trace's in-flight buffer upload does not establish the cause of all startup cost.
3. Integrate only after the original browser acceptance gates pass. This patch does not resolve or conceal the separate GP race failures on published main.
