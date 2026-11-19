# Exposure meter preparation — 2026-11-19

The original High journey on isolated `cc72bfd` reached the exposure meter after the PMREM background correction. Its complete retained fragment source matches `AdaptiveExposurePass` exactly: the 16×12 road/car-region logarithmic luminance encoding. Its first native `getProgramInfoLog` remained in flight for at least 12,149.4 ms when the unchanged 90-second paused predicate failed. This is a bound on an observed native call, not isolated shader execution time or proof of a permanent hang.

`AdaptiveExposurePass.prepareMaterial` now compiles the existing fullscreen owner against its own unchanged target and resolves native metadata before scene submissions. Session preparation calls it only when automatic exposure will be active. It does not measure a frame, read pixels, advance adaptation, modify sampling cadence or bypass GPU completion. Cancellation/disposal stops late metadata work; the existing asynchronous read retains its target until completion.

The focused guarded command passed **89/89** cases:

```sh
node --experimental-transform-types scripts/source-stability.ts -- npx vitest run tests/exposure-preparation.test.ts tests/startup.test.ts tests/session-sky-preparation.test.ts tests/exposure-key.test.ts tests/visual-coherence.test.ts
node --experimental-transform-types scripts/source-stability.ts -- npx eslint src/rendering/adaptive-exposure.ts src/rendering/renderer.ts tests/exposure-preparation.test.ts tests/startup.test.ts tests/session-sky-preparation.test.ts
```

Lint also passed. The seven new cases execute the installed Three program cache and real exposure pass against recorded native calls, with asynchronous readback completion controlled by the test. They prove exact retained owner/cache-key reuse in the actual consumer, full shader equality with the cold consumer, no draw/read/adaptation during preparation, disabled/photo selection, cancellation, disposal while compiling or reading, and restoration on compilation failure. Separate native caches allocate different internal shader-source IDs, so cross-cache comparison uses complete shader text; complete cache-key equality is asserted within the prepared consumer's cache.

The combined candidate still requires typecheck, the remaining active fullscreen-owner preparation proofs, and the original browser acceptance gates. No browser or pixel acceptance is claimed by these CPU tests.
