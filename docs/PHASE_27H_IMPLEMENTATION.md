# Phase 27H — authored bodywork and evidence-bound closure

> Historical 27H increment. The later car-only mechanical assembly and its still-open visual acceptance are recorded in [PHASE_27H1_IMPLEMENTATION.md](PHASE_27H1_IMPLEMENTATION.md). Original acceptance claims below are not upgraded by that work.

This is an implementation increment, **not completion of 27H.0–27H.9**, not F1 25 parity and not commercial-release approval. The unchanged 148-section master directive and the original 100-image archive remain authoritative. Missing features and absent human/hardware evidence must not be relabelled as accepted.

For the subsequent import regression, executed continuation checks and publication boundary, see [the import repair report](PHASE_27H_IMPORT_REPAIR.md).

## Delivered runtime changes

The running application's asynchronous renderer now loads three original APX-01 body skins exported from the retained native Blender scene. Nose, engine cover and sidepod profiles have revised surface proportions and 1.2 mm manufactured edge bevels. The actual .blend is `scripts/apx01-shell.blend`; this is not a photograph, an extracted commercial car or a whole-car final-art replacement. The mirrored sidepods continue to receive independent live livery materials. Wings, suspension hardpoints, wheel pose, driver, damage and mirrors remain independently owned by the existing game.

The 70,988-byte compressed GLB uses standard KHR_mesh_quantization. Both compressed and decoded byte identities are verified before parsing. The loader handles normal static hosting and hosts that decode gzip; an HTML response, missing file, corruption or cancelled startup cannot quietly become an "authored" procedural fallback. Network reads are bounded, startup cancellation aborts the request, and each renderer owns its prototypes and each car its copies. Normalized attributes are expanded before metre transforms and the glTF/runtime paint V convention is explicitly converted.

Driver elbows now use short, deforming cloth bridges driven by the two existing IK bones instead of spherical joint beads. Their vertex buffers, topology, UVs and work vectors are retained across updates; unchanged poses do not upload new geometry. The bridge stays inside a fixed culling bound and welds its UV-seam normals. Finger cross sections are less cylindrical while retaining the established X/Z wheel-contact curve. These changes do **not** certify zero clipping, final anatomy or cinematic character quality.

The screenshot-driven continuation also fixes the real menu/showroom tyre burial. The old menu pose omitted its track coordinate, so the level stage sampled the wrong road elevation, and its body height placed tyres another 19 mm too low. A dedicated static-preview builder now keeps longitudinal position, world pose, wheel radius and suspension length consistent without inventing contact forces or moving a simulated car. Regression tests inspect actual tyre vertices against the podium.

## Exact acceptance matrix

`docs/PHASE_27H_MATRIX.md` includes D001–D148 and R001–R100 individually. The generator verifies the immutable directive SHA-256, preserves source-line clause identifiers, checks actual source/test paths and retains source-file hashes. PASS requires clause-specific evidence tied to the current source fingerprint. Test routes, whole-application renders, independent human inspection and physical Windows hardware evidence are separate gates. No neighbouring feature, duplicate image, screenshot thumbnail or generated test fixture may approve another row.

The initial ledger has **230 PARTIAL and 2 FAIL required rows, plus 16 explicitly excluded/not-implemented rows**. These are acceptance statuses, not a percentage of gameplay implemented. The two exact absent image targets are R069's reverse/online/ghost features and R084's separate vehicle-series target. Historical catalogue limitations may have been superseded by later code; the matrix does not falsely reclassify existing pre-grid preparation, audio guidance, text decals, photo depth-of-field or headquarters rendering as newly absent.

Run:

```sh
node --experimental-transform-types scripts/phase27h-matrix.ts --check
node --experimental-transform-types scripts/phase27h-matrix.ts --json test-results/phase27h-matrix.json
```

A reviewer can supply `--receipts relative-file.json`. Every receipt names the exact requirement digest, source fingerprint, clause IDs, evidence kind, operator, timestamp and artifact SHA-256. Files must exist within the chosen workspace. Synthetic unit fixtures are not published as actual receipts. This is provenance validation, not a way to prove a person is human from an arbitrary JSON assertion; independent review of the original recordings and operator identity remains necessary.

## Reproducible Blender export

```sh
blender --background scripts/apx01-shell.blend --python scripts/hero-export.py -- test-results/authoring/rebuilt.glb.gz
```

Blender 5.2.2 LTS reproduced the retained compressed and uncompressed hashes locally:

- GLB: `98bc137389b32427bf5362f6db39e5956e55eda6aec6cf7913f0d040891bfbf9`
- Canonical gzip: `0d091d333c355a5c25b3244becf4c6f49689d7beda9cf6adbf671b091e6713a5`
- Maximum measured component position quantization error: 0.000016216 m.

The export script never overwrites runtime assets automatically. Editing the .blend requires deliberate regeneration, manifest review, geometry/UV tests and new rendered inspection. The game has no Blender runtime dependency and no external model host or decoder service.

## Validation and remaining work

New executable tests cover exact GLB decoding, geometry/normal/UV preservation, cancellation, corruption, resource ownership, elbow pose bounds and seams, all 248 matrix rows, stale/misattributed evidence, artifact integrity and the human/hardware gates. New Playwright cases use the **actual application**, verify loaded authored geometry and paint, capture showroom/native-camera output and require explicit failure for a missing asset. Existing CI assertions, all three browser shards, wet-presentation checks and native physics scenarios are retained.

Local lint, TypeScript, unit and production-build checks are recorded in the accompanying delivery logs. Native Blender export was executed. The local browser cannot create WebGL2 and local navigation is blocked by administrator policy; no browser policy was changed. GPU acceptance must use the exact candidate's GitHub Actions run, not the previous green commit or a component screenshot. The current candidate's workflow result is authoritative for its executed browser/scenario gates.

### Import-lifecycle correction

The failed candidate's browser traces identified 17 probe failures from one import-time `new URL` on an `about:blank` inline-bundle page. Asset URL resolution now occurs only when `loadHeroShells` is actually called. The production factory still requires the checksum-verified Blender asset, and missing/corrupt assets remain explicit failures. No existing browser assertion or timeout is weakened. Two new regressions build and execute the real minified and unminified Vite IIFE and assert zero URL construction during module import. These tests establish import safety, not graphics approval.

### Still open, without substituted approvals

27H.1–27H.2 still need independent final-art and close-up clipping approval. 27H.3–27H.5 still need the requested full human-world, Aurel-environment and lighting/weather/broadcast final-art work and assessment; this increment does not claim those broad passes are finished. 27H.6 requires actual image-by-image comparisons and closure of remaining depicted functionality; no fresh all-100 visual sign-off was performed here. 27H.7 requires all three full-project audits and recorded defect closure. 27H.8 requires the real uninterrupted human Section 146 drive from launch through telemetry. 27H.9 requires representative physical Windows hardware, controllers/wheels, CPU/GPU/VRAM and frame-time measurements. Hosted Linux/SwiftShader runs are not substitutes.

Additional cars, game modes, sixteen distinct maps and final Steam readiness are not claimed by this increment.
