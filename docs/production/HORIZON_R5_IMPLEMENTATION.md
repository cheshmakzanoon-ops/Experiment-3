# Solvane / Horizon R5 — coast, aerial depth and rival racing

Implementation record, 2026-10-19. This pass changes the Festival / Solvane Coast renderer, race rivals and event HUD. It integrates the concurrent motocross update at `08be765b0c9abab1f29c4603e2405715b7cd84c8`; the retained R4 acceptance evidence is not R5 acceptance. Final browser outcomes, source hashes and artifact hashes are recorded in [HORIZON_R5_VALIDATION.json](HORIZON_R5_VALIDATION.json).

## Implemented changes

| Area          | Concrete change                                                                                                                  | Source                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coastal water | Terrain-derived shallows, spatial colour variation and restrained broken wash over the existing sea.                             | [coastal-water.ts](../../src/rendering/open-world/coastal-water.ts), [water.ts](../../src/rendering/open-world/water.ts)                                                                                                   |
| Aerial depth  | Altitude-dependent atmospheric attenuation and sky-coloured distance separation on owned lit world materials.                    | [festival-atmosphere.ts](../../src/rendering/open-world/festival-atmosphere.ts), [festival-renderer.ts](../../src/rendering/open-world/festival-renderer.ts)                                                               |
| Ground colour | Continuous, low-contrast farm variation removes the artificial hard contour bands reproduced in the coast baseline.              | [terrain-material.ts](../../src/rendering/open-world/terrain-material.ts)                                                                                                                                                  |
| Rival driving | Persistent passing side, projected vehicle footprints, swept clearance prediction and following when the road cannot fit a pass. | [route-driver.ts](../../src/simulation/open-world/route-driver.ts)                                                                                                                                                         |
| Race feedback | Nearest active rival ahead and behind, with explicit **ROUTE GAP** distances derived from legal race progress.                   | [rival-gap.ts](../../src/simulation/open-world/rival-gap.ts), [session.ts](../../src/simulation/open-world/session.ts), [festival-hud.ts](../../src/ui/festival-hud.ts), [festival-hud.css](../../src/ui/festival-hud.css) |

### Water geometry and ownership

The shoreline is solved against `TerrainField.height` at the actual sea height (`seaLevel - 0.05 m`). The authored coastline only bounds the search; its approximate distance field does not determine water depth. Each offshore sample uses the same terrain height query. Steep harbour edges suppress beach wash. Unresolved crossings, large shoreline jumps and invalid span midpoints leave openings instead of bridging land or estuaries.

The current region produces **641 profiles, 20 chunk meshes, 10,064 triangles, 5,886 vertices and 342,912 geometry-buffer bytes**. Construction makes 28,290 terrain-height queries; the maximum sampled shoreline root error is approximately **0.142 mm**. Sampling is bounded to 768 along-coast segments, with 32 segments per chunk and nine cross-shore rows. These are geometry/work counts, not a frame-rate measurement.

The overlay reuses the existing sea wave shader, normal map and transformed UV phase. Shallow colour and foam receive scene lighting; foam changes roughness and clearcoat instead of becoming an emissive night stripe. Pixel-footprint filtering suppresses unresolved foam detail. Animation reads the existing presented time. Shared `sea.ts` behavior is unchanged, and R5 adds no texture assets or render targets.

A cross-review found abrupt opacity at internal rejected spans. The mesh fades to zero at those boundaries, to half strength one 20 m profile away, and to full strength after two. That correction changed only opacity and preserved the estuary gaps. A dedicated interior-gap regression covers it.

The first GPU comparison then exposed a blue strip between the analytic shoreline and the visible sand. Actual carved, triangulated terrain at coarser LODs shifts the rendered edge inland. At the reviewed camera, projected L3 shoreline positions matched the visible edge to approximately one pixel. Across 636 emitted profile positions, the largest measured inland displacement at L3–6 was 169.780 m. The existing innermost row now extends 256 m inland, with opaque terrain depth clipping the body tint to the visible shoreline. Foam alone retains the analytic wetness mask. This adds no rows or triangles and keeps rejected spans open. A regression that failed before the correction now ray-tests wet-side coverage and dry-side terrain occlusion at eight actual carved-terrain cases. The largest final chunk radius is 542.484 m.

`Water` owns the generated normal map borrowed by sea, river and coast, and now disposes it exactly once. Repeated disposal is safe. `CoastalWater` disposes only its own material and geometry. No new constructor arguments or external per-frame calls are required.

### Atmosphere and terrain

`FestivalAtmosphere` reuses the existing analytic `AERIAL_PERSPECTIVE` ray integral with Festival-owned uniforms, a sea-level datum and a 420 m clear-weather scale height. Rain and cloud cover deepen the aerosol layer; extinction follows the current sky/lighting palette. The shader uses the active Three.js camera, including reflection cube-camera faces, and replaces the material fog stage once. It adds no texture, render pass or geometry.

Installation covers owned terrain, road, building and water materials, with listeners for streamed dressing/vegetation and explicit installation on asynchronous detail kits. Disposal removes those listeners. Cached catalogue car materials, custom particles, navigation and HUD retain their existing presentation paths.

The coast baseline exposed hard colour contours caused by `step(0.62, fract(field * 7.3))` acting on interpolated farm metadata. Replacing this threshold with continuous world-space macro/meso variation retains farm presence, biome colour and photographic ground-detail strength. Terrain geometry, height/collision queries and tile LOD are unchanged.

### Rival behavior and HUD

The planner holds its chosen side until the rear bumper clears the passed vehicle. It projects actual body length and width through the relative yaw, includes signed longitudinal/lateral velocity, checks continuous swept overlap over 1.2 seconds, and considers faster vehicles approaching from behind. Road width is sampled through the manoeuvre; a narrow or narrowing road leads to following. Vehicles on another bridge deck are excluded from that road's obstruction checks. Reset, countdown and finish clear the passing state. `PASS LEFT` now agrees with positive route lateral offset; `HOLD LINE` identifies a temporarily occupied merge corridor.

Planning runs at 12 Hz with at most 24 observations and four road-width samples. Steering, pedals, tyre simulation and collision response still move the car. The new gap calculation inspects at most eight participants and uses legal route progress including completed laps. Finished, off-route and non-finite entries are omitted. The HUD labels metres/kilometres as route distance, escapes rival names, and hides this feedback outside an active race or while an overlay owns the display.

## Relationship to the 100 references

The existing [R4 individual reference ledger](HORIZON_R4_REFERENCE_REVIEW.json) remains the complete 100-entry record, with URLs, provenance, observations and application decisions. Its prior review comprises 27 partial technique transfers, 14 preservation decisions, 53 reviewed without a new R4 implementation and six promotional exclusions (031, 054, 062, 065, 084, 088). Those are retained R4 dispositions, not counts of new R5 work.

This turn directly viewed the full supplied compressed review images **028, 029, 032, 036, 040, 044, 080, 081 and 087**. The atmosphere author additionally inspected 029 and 036 directly. The transfers and limits are:

| IDs directly viewed this turn | Observation used in R5                                                               | Limit                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 087                           | Blue-green shallows, deeper offshore water and broken pale shore wash.               | No photographed boat, shoreline geometry, caustics or local reflected objects recreated. |
| 029, 032, 036, 044            | Valley haze and progressively sky-coloured, lower-contrast distant ridges.           | No new photographed mountain, vegetation species, cloud shape or local fog volume.       |
| 028, 040, 080, 081            | Lantern reflections, drift-plume structure and day/dusk storefront lighting studied. | No new implementation is attributed to these details in R5.                              |

All **100 compressed files** were rehashed this turn against both the recovered manifest and the R4 ledger: IDs 001–100, **27,546,467 bytes**, with all SHA256 values, file sizes, review paths and download URLs matching. No mismatch was found. The compressed manifest SHA256 is `167fe168603d4f5b7fdedf964d41d046da8136352e238c96718c20c00e2f2eb7`.

This verifies the recovered compressed review pack, not the original full-resolution bytes. Original source hashes remain provenance only. The retained all-100 review is not a new all-100 visual inspection, and neither review nor selective technique transfer means that all photographed scenes or requirements were rebuilt. Still images do not establish vehicle physics.

## Physical driving evidence

[festival-rival-passing.test.ts](../../tests/festival-rival-passing.test.ts) includes deterministic driving scenarios using the real vehicle integration and vehicle/barrier collision solvers at 120 Hz with two 1/240 s physics substeps. The implementing agent recorded:

| Metric                                              |  Coast Highway overtake | Ashvale Valley Road stop/follow |
| --------------------------------------------------- | ----------------------: | ------------------------------: |
| Scenario duration                                   |              7.608333 s |                     25.000000 s |
| Rear bumper fully clear                             |              5.483333 s |                               — |
| Time alongside                                      | 0.850000 s / 102 frames |                               0 |
| Minimum projected lateral clearance while alongside |              0.833061 m |                               — |
| Minimum route bumper clearance                      |                       — |                      2.512773 m |
| Final route separation                              |       30.066696 m ahead |               7.012773 m behind |
| Vehicle / barrier contacts                          |                   0 / 0 |                           0 / 0 |
| Recovery requests                                   |                       0 |                               0 |
| Passing-side reversals while alongside              |                       0 |                               — |
| Final follower speed                                |           27.606836 m/s |                    0.003545 m/s |

The existing session sprint regression also completed with a valid race result and rival completions. These bounded automated scenarios establish the listed physical behavior, not human usability, all possible traffic situations or completion of every race.

## Validation

The following scoped Vitest runs passed; overlapping reruns are not added together:

| Run                                                                                                        | Observed result                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tests/festival-coastal-water.test.ts` + `tests/festival-atmosphere.test.ts`                               | **19/19** after the final rendered-shore correction: 8 water and 11 atmosphere.                    |
| `tests/scanned-ground.test.ts` + `tests/terrain-tiles.test.ts` + `tests/festival-atmosphere.test.ts`       | **22/22** after the terrain-colour correction: 8 + 3 + 11.                                         |
| `tests/festival-atmosphere.test.ts` + `tests/aerial-perspective.test.ts` + `tests/terrain-tiles.test.ts`   | **22/22** from the atmosphere agent: 11 + 8 + 3.                                                   |
| `tests/festival-rival-passing.test.ts`                                                                     | **13/13** from the gameplay agent.                                                                 |
| `tests/open-world-session.test.ts` + `tests/open-world-traffic.test.ts` + `tests/open-world-bikes.test.ts` | **20/20** from the gameplay agent: 8 + 7 + 5, giving 33 unique gameplay cases across its two runs. |

The water/terrain runs used `node node_modules/vitest/vitest.mjs run <listed paths> --configLoader runner --cache=false`; the atmosphere agent used `node_modules/.bin/vitest run <listed paths>`; the two initial gameplay runs used `./node_modules/.bin/vitest run <listed paths> --cache=false`. The final 19-case water/atmosphere run includes the upstream integration; the other initial scoped results precede it. Water tests check real-region shoreline/geometry bounds, phase alignment, invalid estuary spans, interior fading, actual rendered-shore occlusion and owned-resource disposal. Atmosphere tests check altitude/weather response, shader-hook composition, camera use and listener cleanup; they do not substitute for a rendered GPU comparison.

### Full suite and upstream integration

The premerge full Vitest invocation covered 443 test files. Its first run returned **3,705 passed and eight failed cases**, plus one suite that could not collect because the generated player-LOD file was initially absent. The eight case failures were unchanged evidence/screenshot CLI helpers whose nested subprocess output capture returned `EPERM` in the restricted executor. Direct CLI execution worked. Approved reruns passed all seven `studio-qa-tools` and all three `review-tools` cases. The standard production prebuild generated the pinned player LODs; all eight `supplied-player-lods` tests then passed. Thus all **3,721 distinct premerge cases across 443 files** are covered by the full run and those three setup/environment reruns. This is not a claim that the first full invocation exited successfully.

After the clean upstream fast-forward, **82 tests across 11 files passed**: motocross body input (10), rider weight (14), shared input (7), network codec (9), network lifecycle (5), session identity (3), open-world worker (1), session (8), ambient traffic (7), Festival bikes (5), and rival passing (13). This reran the physical overtake/follow cases under simulation version 3. The upstream `riderLean` normalization line and its protocol/simulation version changes are preserved.

A separate [actual-simulation compatibility probe](horizon-r5-evidence/rider-input-compatibility.json) ran EH3, GPR1 and SM450 for three six-second input sequences each: absent lean, neutral lean, and alternating ±1. Complete snapshots were byte-identical within each vehicle across 4,326 paired comparisons, with no resets or nonfinite fields. All 36 input-normalization cases passed. This checks that the motocross control addition does not alter these Festival vehicles; it does not compare simulation-version-2 snapshots to version 3.

| Combined gate                       | Final observed result                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`tsc --noEmit`)         | Passed on the merged source; also included in the final standard build.                                                                                                                                                                                                                                                            |
| Full repository lint                | Final `npm run lint` passed on the merged source. The new visual-review runner also passed scoped ESLint, syntax and Prettier checks.                                                                                                                                                                                              |
| Content validation                  | Final `npm run validate:content` passed: `Content valid`.                                                                                                                                                                                                                                                                          |
| Full Vitest suite                   | Full run plus resolved setup/environment reruns described above; 3,721 distinct premerge cases covered. Final water and merged-input scopes reran afterward.                                                                                                                                                                       |
| Production build                    | Final standard `npm run build` passed, including pinned LOD generation, TypeScript and Vite. Existing large-chunk warnings remain.                                                                                                                                                                                                 |
| Browser visual comparison           | Final coast and valley captures **passed**, with matching source fingerprints, zero page/console errors, zero warnings, no failed assets, WebGL error 0 and no context loss. Both before/after pairs were visually inspected.                                                                                                      |
| Added rival HUD browser regressions | Both tests in [49-festival-menu-access.spec.ts](../../e2e/49-festival-menu-access.spec.ts), selected with `--grep 'festival rival'`, **passed** in Chromium. They cover live/escaped feedback, focus and overlay lifecycle plus 1440×900, 900×640, 360×780 and 640×360 layouts.                                                    |
| Actual worker/input/browser journey | **11 steps passed** through real workers, input, simulation and rendering. The [retained report](horizon-r5-evidence/journey.json) confirms manual throttle/brake, map/photo/garage controls, a completed assisted race, live rival-gap text, a distinct retry, return to free roam and teardown. No page errors or failed assets. |

The final production source fingerprint is `c538b01ff753a3f3b9a14f2bfb58dc70ad8eda4f69f75a51ce520eb2d1bd2cb8`. The precommit build correctly records a null commit. Vite hashes `src/**`, `package-lock.json`, `index.html` and `vite.config.ts`; public assets, scripts, fixtures, tests and documents are outside that fingerprint. The validation record separately hashes the changed implementation, review scripts, fixture, tests and retained evidence.

### Matched visual evidence

The baseline is the unchanged source checkout at `7cb7ba1794bb32310b373f4311b6201b7db796a7`. Its coast capture succeeded in an initial combined run that later timed out on the valley; the valid valley baseline was captured in a separate successful run. [baseline-views.json](horizon-r5-evidence/baseline-views.json) retains those individual results and their provenance. The final [visual-review.json](horizon-r5-evidence/visual-review.json) completed both views successfully.

Both before/after pairs use Chromium/SwiftShader, Medium quality, 1280×720, day lighting, clear weather and the same exact cameras. Real saved-discovery travel is followed by photo-mode pause, with one boot frame and five deliberate inspection draws. Presented simulation time differs between runs, so these are matched compositions rather than pixel-synchronous simulations. The review runner's raw `coast.png` and `valley.png` entries are retained as `after-coast.png` and `after-valley.png`; the validation index maps and hashes them explicitly.

| View   | Before                                                     | After                                                    | Visual observation                                                                                                                                                              |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coast  | [before-coast.png](horizon-r5-evidence/before-coast.png)   | [after-coast.png](horizon-r5-evidence/after-coast.png)   | The dark strip at the visible sand is gone. Blue-green shallows and broken pale wash meet the rendered shoreline, and continuous farm colour replaces the hard contour stripes. |
| Valley | [before-valley.png](horizon-r5-evidence/before-valley.png) | [after-valley.png](horizon-r5-evidence/after-valley.png) | Subtle altitude-dependent colour/contrast variation with unchanged terrain geometry. Existing carved-terrain facets and texture repetition remain visible.                      |

The coast view changes from 370 to **372 visible draw calls** and from 1,217,578 to **1,218,602 triangles**, with **50 textures** in both captures. Only two coastal chunks are visible in this composition; total constructed coastal geometry is the 20 chunks / 10,064 triangles reported above. The valley remains at **215 draw calls, 480,620 triangles and 49 textures**. These exact view counts demonstrate bounded added geometry and texture reuse; software-renderer timings are not a hardware performance result.

### Actual browser driving

The [journey runner](../../scripts/horizon-browser-review.mjs) used Low quality at 960×540 on Chromium/SwiftShader. Keyboard throttle moved the actual car **60.584 m**, with an observed speed of **65.171 km/h**; keyboard braking reduced it to **0.074 km/h**. Map route preview, pause/photo orbit and garage transitions passed through the real session and renderer.

The Harbour Opening Run finished in **106.333 s**, with three entrants, a valid two-star result and zero off-route seconds. Race completion explicitly used the production assisted autopilot, which is labelled in both the report and UI. It is not a claim of an unassisted human finish. The live worker's rival model matched the HUD's literal names and metre/kilometre formatting; the rival row hid at results and in free roam. Try Again started a distinct second run, which the review abandoned through normal UI without claiming a second completion or duplicate reward. Exit removed the HUD, terminated the session and released session geometry. [Event screenshot](horizon-r5-evidence/journey-event.png) · [Results screenshot](horizon-r5-evidence/journey-results.png).

### Reproduction and scope

Run the normal repository build, lint and content gates with `npm run build`, `npm run lint` and `npm run validate:content`. The final shoreline/atmosphere regression command is:

```bash
node node_modules/vitest/vitest.mjs run tests/festival-coastal-water.test.ts tests/festival-atmosphere.test.ts --configLoader runner --cache=false
```

Serve the repository with Vite, then run the portable [coast/valley review](../../scripts/horizon-coast-review.mjs):

```bash
HORIZON_REVIEW_URL=http://127.0.0.1:5173 \
HORIZON_REVIEW_OUTPUT=/tmp/horizon-coast-review \
HORIZON_REVIEW_QUALITY=medium \
HORIZON_REVIEW_IDENTITY="$PWD/dist/BUILD_IDENTITY.json" \
node --experimental-strip-types scripts/horizon-coast-review.mjs
```

The runner uses installed Playwright Chromium by default; `HORIZON_REVIEW_EXECUTABLE` can specify a local executable. `HORIZON_REVIEW_SCENES=coast,valley` selects compositions and `APEX_BROWSER_BACKEND` uses the repository's existing backend helpers. The real driving review uses the same URL/output/identity/executable environment variables with `HORIZON_REVIEW_QUALITY=low` and `node --experimental-transform-types scripts/horizon-browser-review.mjs`. The build and served source must agree; a stale expected fingerprint fails before acceptance.

The [Horizon session fixture](../../e2e/fixtures/horizon-session.ts) exposes coastal geometry, atmosphere uniforms and source identity for these diagnostics. Visual acceptance covers the two fixed day/clear photo compositions and the real session journey. It does not establish every camera, grazing angle, quality preset, weather condition or hardware GPU.

The atmosphere is an analytic aerosol layer without volumetric clouds, cloud shadows or local fog volumes. Water remains a bounded shaded surface without shoreline fluid simulation, refraction, caustics or new local planar reflections. No hardware FPS result or commercial-reference fidelity claim is made.
