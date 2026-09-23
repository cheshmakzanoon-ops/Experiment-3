# Phase 27H continuation — isolated renderer import repair

## Scope and publication boundary

This continuation repairs a concrete regression in the retained Phase 27H candidate. It does not claim completion of 27H.0–27H.9, commercial quality, all-image parity, human Section 146 acceptance or physical Windows/controller/wheel validation.

The initially retrieved published `main` was `e31a271c83d5184fc84cec9402b2b8d8ff052372` (tree `00a80c8c80f11351d4e7c28f0f7c7db20bf770d5`). That commit contains the candidate-validation workflow, not the candidate's runtime integration. The recovered candidate was verified against Git tree `f9ccf5b8799ea5aede45ed1fc2d357c74880553b` from workflow run `35808038740`.

The ordinary build of the staging commit passed in run `35808038763`. The separate candidate run `35808038740` failed browser and wet-presentation validation, so its seal was skipped. A green staging build is not evidence that the runtime candidate passed.

The repaired source has not been pushed by this continuation: the available connector exposes repository reads but no write operation, and no authenticated Git CLI publication route was available. The accompanying binary patch is based on the actual published tree, not a fabricated upstream commit. Its application is checked against the complete target tree recorded in the delivery manifest.

During validation, remote `main` advanced to `440bf70dfaa43784b0968fbd853527e365114774` (tree `3a9585c5672d747d24d80df3d4310a57852eed90`). The diff changes only the candidate workflow. Its retained corrected candidate is `d2562149bc047f59aab168dcdae554b0bc314313`. That concurrent repair makes the same runtime correction; its minified/unminified import tests and documentation are preserved here, alongside this continuation's cancellation/browser regressions. Runtime bytes are identical to that concurrent candidate. The delivery base is reconciled to the newer published tree, and an additional patch from the concurrent candidate is provided. No newer game changes are overwritten.

## Reproduced defect

`src/rendering/hero-shells.ts` constructed its asset URL at module evaluation. The existing renderer probes build their real source into an IIFE and inject that bundle into an opaque `about:blank` document. Vite's browser-compatible `import.meta.url` expression cannot resolve a relative model path against that document, so the import threw `Failed to construct 'URL': Invalid URL` before the probe exported its API. The later missing probe-global errors were consequences of that import failure.

The retained code and the repaired code were both bundled and evaluated in actual Chromium. The retained bundle failed before export. The repaired bundle exposed its API without a page error or network request. This is browser module-evaluation evidence, not a WebGL render, a drive or a human approval.

## Implemented repair

Asset URL resolution now occurs inside `loadHeroShells`, after the initial cancellation check and within its cleanup-protected acquisition block. Importing the geometry module does not resolve an asset URL or start acquisition. The normal production build still emits and references the hashed GLB asset.

The change preserves compressed and decoded checksums, response-size bounds, explicit missing/corrupt-asset failures, startup cancellation, owned geometry, timers and disposal. It does not silently fall back to procedural geometry or skip the authored asset in the running application. Simulation files, the original directive, package lock and normal CI workflow remain unchanged.

`tests/hero-import.test.ts` builds the real Vite IIFE and evaluates it in an opaque-document context. It checks exported functions, absence of import-time acquisition and clean rejection of a pre-cancelled load. `e2e/20-phase27h.spec.ts` adds a real Chromium import-isolation regression. Its existing actual-application bodywork, livery, camera and missing-asset assertions are retained.

The delivery also pins checkout text to LF in `.gitattributes` and marks the authored/runtime binary formats as binary. This keeps source-byte acceptance hashes stable across Git checkout settings. The helper rejects an already-converted CRLF checkout before applying the patch rather than silently rewriting existing files. This is checkout reproducibility, not physical Windows validation.

## Executed evidence

The final source fingerprint is `5c5b1a1d7fabee66d5b56a75e72a744a4b3d92c35ce0ce947a459262dce5f2af`.

- `npm run check`: PASS; ESLint, **91 test files / 894 tests**, TypeScript and production build. The existing greater-than-500-kB chunk warnings remain visible; no hardware frame-rate claim follows from this build.
- Focused bodywork/import/matrix/elbow/showroom tests: **5 files / 24 tests passed**.
- The new real-Chromium import-isolation Playwright case: **1 passed**. A temporary external test configuration disabled only the unused preview server for this opaque-document test. The repository's full browser configuration and assertions were not weakened.
- Matrix generation/check: all **148 directive rows + 100 reference rows**, with the updated source fingerprint. Required statuses remain **230 PARTIAL / 2 FAIL**, plus **16 explicitly excluded FAIL rows**. These are whole-requirement acceptance states, not a gameplay-completion percentage.
- Original directive bytes match the supplied `Pasted markdown(6).md`; all 100 archived image hashes match their catalogue entries. Byte identity is not a fresh image-by-image visual sign-off.
- Blender 5.2.2 LTS re-exported the retained `.blend`. Both decoded GLB and canonical gzip hashes match the runtime manifest; the compressed asset remains 70,988 bytes. This verifies the retained authoring pipeline, not final-art quality.

All native scenario commands completed successfully; their measured results are retained in the delivery. The concurrent corrected candidate's wet-presentation job in run `35813261322` passed all three tests, and its images/metrics were downloaded and inspected. These fixture renders use the direct renderer constructor, not the async authored-skin application factory, so they are not proof of the new bodywork's actual-app appearance. Runtime bytes match the delivery, but the full final-tree browser shards and actual-app GLB cases have not been certified in this continuation. The local browser capability probe did not provide WebGL2. They remain mandatory publication gates, and the included apply-and-publish helper stops before commit/push when any automated gate fails.

## Remaining Phase 27H work

The recovered candidate includes the 248-row evidence-bound matrix, three original Blender-exported skins, cloth elbow bridges and the showroom tyre-height correction. It is not the requested entire hero-car/character/environment rebuild. The broader 27H.3–27H.5 art passes, full 27H.6 image discrepancy closure, all three 27H.7 audits, uninterrupted human 27H.8 scenario and real-hardware 27H.9 acceptance remain open. The earlier implementation report retains those limits in detail.

Source, tests and Blender authoring files are retained in the delivery; copyrighted reference artwork, dependencies, credentials and local toolchain binaries are not included. The obsolete one-off staging workflow is removed in the delivery patch; the normal full CI workflow is preserved byte-for-byte.
