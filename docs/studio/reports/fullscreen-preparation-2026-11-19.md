# Complete High fullscreen preparation — 2026-11-19

## Source correction

The isolated `cc72bfd` High trace identifies the exposure meter as a late native metadata owner. A subsequent read-only audit of the same enabled composer chain found the same missing preparation boundary in bloom, native output conversion and final grading. Preparing only the meter would leave those owners to initialize after expensive scene work was queued.

This change prepares the retained owners used by the real composer. It follows enabled passes, `needsSwap` and the actual final screen owner instead of relying on stale `renderToScreen` flags. Borrowed pass flags, render-target state and shared quads are restored before awaiting compilation. It performs no composer render, clear, draw, readback, simulation tick or buffer swap.

| Owner | Preparation target and selection |
| --- | --- |
| Scene ambient pass | Its existing native AO/blur/composite owners; actual composer write buffer |
| Exposure | Existing 16×12 meter target, only when automatic exposure is active |
| Bloom | Active prefilter, downsample, upsample and composite owners; original pyramid targets and actual composer read buffer |
| Native Three OutputPass | Its public render-time define selection through a compile-only adapter; actual output target and native AgX/ACES + sRGB defines |
| FXAA | Its native ShaderPass owner only when enabled |
| Final grade | Actual screen/offscreen destination and the selected `FILMIC_BLACK` variant |

Photographic look selection is shared between preparation and drawing, so mixed GP fields, day/sunset/night/studio and MX selection cannot diverge through duplicate conditionals. Preparation selects the same tone mapper and grade define that the first draw uses. Shaders are not copied or replaced. The native OutputPass retains its own define selection; temporary sampler/exposure values are restored before awaiting.

The first scene/local cubemap, both warmup views, all bloom levels, meter readbacks/cadence, original quality and dimensions, original deadlines and GPU-completion waits remain. Camera-toggle reflection invalidation was not changed. The existing sky and exposure corrections are separate commits (`062e0da`, `4bfdf815`) atop the native PMREM background candidate.

## Native consumer proof

Eight new tests use the installed Three EffectComposer and program cache, with native GL execution recorded rather than rasterized. The real composer chooses pass order, read/write swaps and screen ownership. Scene rasterization is replaced because its ownership has separate tests; exposure readback has its own seven-case native lifecycle suite.

For AgX and ACES, conditional FXAA, enabled/disabled grade and energy-conserving bloom, cold and prepared consumers emit identical full shaders, defines, sampler/uniform values, blend state, target dimensions/formats, camera state and draw sequence. The ordinary High post chain retains all 14 bloom draws, output and grade; enabling FXAA retains its additional draw. The prepared consumer creates no new native program key or metadata query. Preparation itself emits no draw or clear and does not mutate composer buffers, pass flags, exposure state or the shared bloom quad.

Cancellation and disposal during native OutputPass compilation stop later owners and metadata work. Native compilation failure restores borrowed state and permits retry. The existing native background, reflection, ambient, exposure and sky lifetime tests remain in the combined check.

## Verification

All commands ran through the source-stability guard; every command exited **0**:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/post-processing-preparation.test.ts tests/exposure-preparation.test.ts tests/startup.test.ts tests/session-sky-preparation.test.ts tests/scene-ambient-preparation.test.ts tests/preparation.test.ts tests/lens-bloom.test.ts tests/visual-coherence.test.ts tests/exposure-key.test.ts tests/menu-startup-sky.test.ts tests/daylight-environment.test.ts tests/venue-preconstruction.test.ts tests/reflection-preparation.test.ts tests/pmrem-background-preparation.test.ts tests/reflections.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx eslint src/main.ts src/rendering/renderer.ts src/rendering/preparation.ts src/rendering/adaptive-exposure.ts src/rendering/lens-bloom.ts src/rendering/broadcast-grade.ts tests/startup.test.ts tests/session-sky-preparation.test.ts tests/exposure-preparation.test.ts tests/post-processing-preparation.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx tsc --noEmit
```

**174/174 focused tests passed across 15 files.** `git diff --check` passed. Compact logs and exact checked production/test file hashes are retained in [the evidence directory](evidence/fullscreen-preparation-20261119/receipt.json). Reports/evidence were written after the guarded checks; checked source/test inputs were not changed afterward.

The static-snapshot sky proof is not a guarantee that changing LIVE lighting cannot request a legitimate later capture. These CPU tests do not prove rasterized pixels, browser timing, physical GPU performance or High acceptance. Run the original isolated build, High application, GPU component, gameplay and menu gates on the exact combined candidate before integration. No local browser workaround was attempted.
