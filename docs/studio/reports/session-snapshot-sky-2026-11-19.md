# Session sky preparation — 2026-11-19

## Correction

Session construction previously captured the generic menu sky before the first simulation snapshot existed. GP preparation then selected its clear photographed sky, and the first draw observed a different `PhotoSky.key`, discarded both generic PMREM bins and captured both again. Those first generic captures were never presented.

`main.ts` now explicitly requests snapshot sky preparation only when constructing a circuit for a new session. Direct renderer construction, showroom construction, Photo and Academy retain their immediate menu preparation. `RacingRenderer.prepare` selects the followed vehicle's actual sky and lighting, waits for its photographs, and captures the recorded cloud coverage before scene compilation. Mixed fields now use the followed vehicle, consistently with `draw`, rather than requiring an all-GP grid.

The actual sky PMREM size, six faces per bin, blur passes, photographed sampler bindings, linear blend, first local cubemap, both camera warmups and both GPU-completion waits are unchanged. No camera-toggle invalidation, quality, deadline or acceptance assertion was changed. Cancellation/disposal at the new yield stops native work; capture errors propagate through the existing preparation failure record and sky ownership transaction.

## Verification

All commands ran under `scripts/source-stability.ts`, with no source changes during checks:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/startup.test.ts tests/session-sky-preparation.test.ts tests/menu-startup-sky.test.ts tests/daylight-environment.test.ts tests/venue-preconstruction.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx eslint src/main.ts src/rendering/renderer.ts tests/startup.test.ts tests/session-sky-preparation.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx tsc --noEmit
```

- Focused tests: **63/63 passed**; lint, typecheck and `git diff --check` passed.
- The new test runs the installed Three PMREM consumer and real photo catalogue/bindings, replacing image decoding and native GL execution. The historical generic-then-GP sequence captures four bins; direct snapshot preparation captures two. All native submissions for the actual GP sky match, including 12 sky face draws, target sizes, blur/mip passes, camera transforms and photo bindings. Both warmups and waits still execute. All four retained sky targets dispose once.
- Startup tests cover actual followed GP/Formula/MX subjects, day/sunset/night/studio, cancellation, disposal and capture failure before compilation/readiness.
- An initial test used the program harness's deliberately independent logical/cubemap viewport state as a sky-capture input. The final fixture starts on the canvas, matching session preparation; no production restoration code was changed to satisfy that fixture.

CPU native-consumer tests do not establish browser timing or rendered-pixel acceptance. The original High, component, gameplay and menu browser gates remain required for the combined candidate.
