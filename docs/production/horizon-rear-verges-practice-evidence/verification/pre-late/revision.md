# Horizon revision: RH3/SC7 rear construction, planted verges, and practice sectors

**Verified 2026-10-20. Latest combined-application TypeScript, lint, and build checks passed. Accepted physical and component/HUD receipts retain their documented source scopes. The bounded full-world browser review did not complete.**

This continuation focuses on the RH3 and SC7 rear construction, the SC7 side intakes, the vegetation framing the Festival roads, and a repeatable practice challenge on the existing Saltmarsh circuit. The existing track geometry, vehicle dynamics, and career results provide the foundation. The new code adds constructed visual depth and a same-car session benchmark that gives each practice attempt a clear target.

## What changed

### RH3 and SC7 body construction

Both RH3 and SC7 use an authored rear-surface deformation shared by the painted shoulders, fascia, lamps, exhausts, and trim. It begins behind the rear tyre envelope, with separate sweep parameters for the two body styles. Adaptive tessellation and transformed normals keep attached pieces following that surface.

Each car has two tapered lamp openings cut through the rear cap. Their surrounds contain recessed walls, dark backing, light guides, separate optical cells, reverse-light segments, and optical covers. The SC7 additionally uses tapered side openings with a surface-following reveal, a deep throat, a closed dark backing, and internal vanes. These additions replace the previously flat rear treatment and the SC7's raised square side surround.

Rear shoulder and lamp construction applies to RH3 and SC7; the side-intake change applies only to SC7. The shapes, dimensions, and topology are original; the reference cars supply visible construction cues. Production sources are [festival-rear.ts](../../src/rendering/vehicle-bodies/festival-rear.ts), [body-curvature.ts](../../src/rendering/vehicle-bodies/body-curvature.ts), [festival-detail.ts](../../src/rendering/vehicle-bodies/festival-detail.ts), [festival-nose.ts](../../src/rendering/vehicle-bodies/festival-nose.ts), [closed-body.ts](../../src/rendering/vehicle-bodies/closed-body.ts), and [body-sheet.ts](../../src/rendering/vehicle-bodies/body-sheet.ts).

The final visual pass also adds a recessed registration mounting well, a separately crowned lower bumper, and a fine bumper seam to both cars. The RH3 has a hatch shut line. These original construction details break up the previous blank rear panel; the well is cut through the painted fascia and checked with rays against the actual rendered geometry. The SC7 intake uses a rough dark liner after the first capture exposed an overly bright inner reflection.

### Road margins and vegetation

The new meadow plan places short inner growth and taller outer bands in irregular patches. A shared clump geometry combines seventeen curved basal blades with two branched seedheads. Instancing, distance fade, wind movement, and quality-dependent density keep the planting bounded. Roots sample the same carved terrain triangles as physics; clearance checks consider the complete clump footprint and neighbouring road segments.

Festival tree and shrub fallbacks now use porous foliage-card crowns. The broadleaf width-to-height correction also prevents broadleaf placements from selecting the conifer atlas tile. The existing trunk and collision placement data remain authoritative. The repository's existing photographic vegetation path can still supply higher-quality plants; no image from the reference pack becomes a new game texture.

Production sources are [festival-meadow.ts](../../src/rendering/open-world/festival-meadow.ts), [horizon-dressing.ts](../../src/rendering/open-world/horizon-dressing.ts), and [vegetation.ts](../../src/rendering/open-world/vegetation.ts).

### A repeatable practice objective

Solo one-lap circuit practice in four-wheel vehicles now measures three sectors. The first two sector crossings use net route station with interpolation; the legal checkpoint finish closes the third. Reversing and repeating a stretch does not earn another sector.

The HUD compares the attempt with one complete clean benchmark for the same event and car in the current Festival session. It shows elapsed sectors, sector deltas, the current sector clock, and a clear Retry action. Leaving the road or legal route, contact, resets, autopilot, incomplete attempts, and invalid progress prevent a clean benchmark. Invalid attempts remain readable and can still be completed. Menu, map, and photo modes suppress the practice display immediately.

The benchmark map is session-scoped and separate from existing saved event/career records. Weather preset and assists are fixed for a simulation, while weather and surface conditions may evolve. Road validity checks the car centre against the road envelope, including authored shoulders; it is not four-tyre adjudication against painted boundaries.

Production sources are [circuit-pace.ts](../../src/simulation/open-world/circuit-pace.ts), [session.ts](../../src/simulation/open-world/session.ts), [festival-result.ts](../../src/simulation/open-world/festival-result.ts), [region-data.ts](../../src/simulation/open-world/region-data.ts), [festival-hud.ts](../../src/ui/festival-hud.ts), and [festival-hud.css](../../src/ui/festival-hud.css).

## Reference methodology and exact scope

The [durable reference audit](horizon-rear-verges-practice-evidence/reference-audit.json) preserves the complete 100-entry ledger: filenames, source URLs, SHA-256 values, observations, and inspection scope. It adds six explicit mappings from observed cues to the implemented source.

All **100 compressed JPEG files were SHA-256 verified against their manifest**. All **ten contact sheets were visually reviewed**, covering all 100 images at sheet scale. **Nine images were additionally opened individually:** 018, 032, 036, 041, 042, 050, 085, 097, and 099. These are the previously supplied compressed references, up to 1920 pixels wide. This pass did not newly inspect every full-resolution original.

| Checked artifact | Identity |
| --- | --- |
| Compressed archive | `Forza-Horizon-6-Reference-Pack-Under-30MB.zip`, 27,428,348 bytes |
| Archive SHA-256 | `54c7eead407805b82d0bb29898cdf5271c1fe0b332ce085e95c397ac3f940a26` |
| Manifest SHA-256 | `167fe168603d4f5b7fdedf964d41d046da8136352e238c96718c20c00e2f2eb7` |

| References | Visible cue | Implementation relationship |
| --- | --- | --- |
| 018, 099 | Rear shoulders wrapping layered lamps and recessed structures | RH3 and SC7 rear surfaces and lamp-pocket construction |
| 097, 099 | Dark tapered duct integrated into a curved flank | SC7 side opening, reveal, throat, and vanes |
| 032, 036, 050, 098 | Layered low growth, seedheads, irregular planting, clear route | Meadow bands, porous crowns, and maintained road clearance |
| 041, 042, 085 | Current performance beside a displayed best; clear activity objectives | Original same-car practice benchmark, sector feedback, and Retry loop |

Reference 098 received contact-sheet review only in this pass and supports general foreground layering. The finer car, seedhead, and HUD observations above use the individually opened images.

The timing mechanic is **our original adaptation** of the visible current-versus-best feedback principle. References 041 and 042 show drift-score feedback; they do not establish the three-sector circuit algorithm used here. Photographs also do not establish physical grip, dimensions, lap-time targets, or player enjoyment.

The original audit groups remain intact: 80 retained-context entries, 14 new-focus recommendations, and six promotional entries outside this implementation scope. Those counts describe the review, not a claim of 100 new features or fourteen shipped changes. The implementation mappings identify the specific new work. No reference image pack, screenshot texture, logo, or licensed vehicle mesh is copied into this revision.

## Verification and publication

<!-- ROOT_VALIDATION_START -->

The final integrated parent is `6537fa7b2fe437c6b52cfca8ca9f6f4a7f1da416`, adding the later MotoGP rendering/UI revision to the physics-v15 and MotoX-v16 integration. The recorded simulation identity remains version 16. The verified production source has canonical SHA-256 fingerprint `f9038749a41da649beb24746d8e94c58d4d06348a2d9c38bcc97f4e527703000`. The [final source manifest](horizon-rear-verges-practice-evidence/verification/source-identity.json) records the exact **789-file** set and each file hash; the [post-GP three-phase receipt](horizon-rear-verges-practice-evidence/verification/post-gp-validation.json) records successful full TypeScript, lint of 27 incoming files, and production compilation. The finalizer checks the exact file set and bytes again before writing this report.

The successful **seven-phase physics/integration gate remains scoped to `84472529313a7f8912513eeb1b698566fab1b2bc` / `a8d081390e9bbe7ab3cd9ed45d7eb4ed75d9a2a2ef6dedb35bcb6b522703d404`**, with its original 785-file source identity. [That gate](horizon-rear-verges-practice-evidence/verification/validation.json), [its source/build/audit snapshots](horizon-rear-verges-practice-evidence/verification/pre-gp/publication-audit.json), and both accepted driving receipts remain intact. The [post-GP integration proof](horizon-rear-verges-practice-evidence/verification/post-gp-integration.json) and the finalizer independently confirm **81 Festival files** and the exact **156 core/simulation/lockfile inputs plus the validation runner (157 files total)** are byte-identical. Those measured scopes support retaining the earlier physical and Festival checks; they do not turn old component pictures into new whole-application captures.

| Check | Result and source scope | Durable receipt |
| --- | --- | --- |
| Full project TypeScript | Passed on final 6537fa7 combined source | [Latest compiler log](horizon-rear-verges-practice-evidence/verification/post-gp-typescript.log) |
| Lint | Earlier full pass, 36 changed files at 844725, then all 27 newly changed TS/JS files after MotoGP integration | [Earlier full pass](horizon-rear-verges-practice-evidence/verification/pre-v15/validation.json), [36-file pass](horizon-rear-verges-practice-evidence/verification/eslint-integrated-changes.log), [latest lint log](horizon-rear-verges-practice-evidence/verification/post-gp-eslint.log), [27-file list](horizon-rear-verges-practice-evidence/verification/post-gp-lint-files.json) |
| Runtime content | Passed at 844725; retained with its original scope | [Content log](horizon-rear-verges-practice-evidence/verification/content.log) |
| Festival regressions | **63/63 passed across 9 files** before v15; relevant Festival implementation retained unchanged | [Retained tests](horizon-rear-verges-practice-evidence/verification/pre-v15/tests.json), [81-file ledger](horizon-rear-verges-practice-evidence/verification/festival-integration.json) |
| Integrated physics/identity assertions | **26 passed** at 844725: air-relative aerodynamics 6, identity/schema 19, SC7 physical opening 1; measured physics inputs remain unchanged | [Parameterized results](horizon-rear-verges-practice-evidence/verification/integration-tests.json), [unchanged-input proof](horizon-rear-verges-practice-evidence/verification/post-gp-integration.json) |
| Production bundle | Passed on final 6537fa7 source with the actual Vite configuration; emitted identity matches the latest canonical fingerprint | [Latest build log](horizon-rear-verges-practice-evidence/verification/post-gp-production-build.log), [built identity](horizon-rear-verges-practice-evidence/verification/BUILD_IDENTITY.json) |
| RH3 practice physics | Accepted clean lap and rejected intentional off-road benchmark recorded at 844725; all 156 core/simulation/lockfile inputs plus the runner still match | [Clean](horizon-rear-verges-practice-evidence/physical-clean.json), [off-road](horizon-rear-verges-practice-evidence/physical-off-road.json) |
| Practice HUD | Retained 19/19 component cases, 12 screenshots, no browser errors; explicitly synthetic status | [HUD review](horizon-rear-verges-practice-evidence/hud/review.json) |
| Car and verge rendering | Retained matched component comparisons, 3/3 views each; relevant recorded source hashes still match | [Cars](horizon-rear-verges-practice-evidence/cars/review.json), [verges](horizon-rear-verges-practice-evidence/verges/review.json) |
| Full Festival browser | Historical startup/first-draw gate did not complete within its fixed deadline; no final-source browser pass claimed | [Unabridged failed attempt](horizon-rear-verges-practice-evidence/session/review.json) |

The latest emitted `BUILD_IDENTITY.json` has version 1 and the final canonical fingerprint. Its `commit: null` is preserved because the build preceded the publication commit; no commit identity is invented. The earlier identity remains at [pre-gp/BUILD_IDENTITY.json](horizon-rear-verges-practice-evidence/verification/pre-gp/BUILD_IDENTITY.json).

The retained selected test receipt from `844725` retains **15 pending/skipped unrelated assertions** as reported; they are not counted as passed. Parameterized cases account for the 26 actual passes. The physical SC7 case exercises the existing 25-second opening pass and bend. The retained Festival suite covers sector interpolation and legal finish, invalidation, reset/autopilot, retry and car scope, career/circuit behavior, car construction/glazing, planting clearance/ground contact, and grass restoration after switching photographic grass to Low. Seven rear-construction cases include 52 oblique probes of the repaired SC7 cap/bumper seam and guards at every LOD.

### Preserved verification history

The first post-GP TypeScript attempt failed because sparse checkout omitted three tracked JSON fixtures: `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`, `docs/production/motocross-reference-review-20261017.json`, and `docs/PLAYER_INDEX_CACHE_AUDIT.json`. The [failed gate](horizon-rear-verges-practice-evidence/verification/post-gp-sparse-initial-validation.json) and [original compiler output](horizon-rear-verges-practice-evidence/verification/post-gp-sparse-initial-typescript.log) remain failed and unedited. The fixtures were restored byte-identically to the integrated parent; [restoration hashes](horizon-rear-verges-practice-evidence/verification/post-gp-restored-fixtures.json) record that check. They are outside the 789-file production fingerprint. No implementation changes or relaxed checks were used to resolve the missing imports.

The retained [pre-v15 command receipt](horizon-rear-verges-practice-evidence/verification/pre-v15/validation.json) remains **overall incomplete**, despite its successful 63-test phase. Its subsequent repeated TypeScript command was deliberately stopped with exit -15 before the upstream merge; the [stop note](horizon-rear-verges-practice-evidence/verification/pre-v15/preintegration-stop-note.json) explains that decision, and its [empty output log](horizon-rear-verges-practice-evidence/verification/pre-v15/typescript-final.log) is preserved. The successful final TypeScript and build receipts above supersede that incomplete phase, without relabeling it as passed.

Earlier sparse-checkout TypeScript failures, an earlier failing test iteration/status-transport timeout, and their original logs remain available: [checkout failure](horizon-rear-verges-practice-evidence/verification/initial-checkout-validation.json), [checkout compiler output](horizon-rear-verges-practice-evidence/verification/initial-checkout-typescript.log), [restored tracked dependency hashes](horizon-rear-verges-practice-evidence/verification/checkout-dependencies.json), [initial integration failure](horizon-rear-verges-practice-evidence/verification/initial-integrated-validation.json), [initial tests](horizon-rear-verges-practice-evidence/verification/initial-integrated-tests.json), and [initial test output](horizon-rear-verges-practice-evidence/verification/initial-integrated-focused-tests.log). The [pre-v15 source manifest](horizon-rear-verges-practice-evidence/verification/pre-v15/source-identity.json) retains `e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b`. Its older command receipt uses a separately documented Python path-component ordering; those historical identifiers are not rewritten.

Direct commands avoid the unchanged supplied-character LOD prehooks. The actual production Vite configuration is used for bundle compilation; temporary output omits a duplicate public directory, and the content validator checks the real runtime assets. The retained selected test run keeps the recorded 120-second test timeout and each command's 600-second phase cap. This is targeted integration and production compilation, not a complete repository test-suite or `npm run check` claim. The retained 844725 [physics integration command recipe](horizon-rear-verges-practice-evidence/verification/final-integration.py), [build recipe](horizon-rear-verges-practice-evidence/verification/build.mjs), and [test configuration](horizon-rear-verges-practice-evidence/verification/vitest.config.mjs) are retained.

### Warnings observed in the latest production build

The latest successful combined-source build emitted the observations below. They are read from its actual log without assuming that a warning predates this revision. The earlier build remains available under [pre-gp/production-build.log](horizon-rear-verges-practice-evidence/verification/pre-gp/production-build.log).

- (node:392964) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
- (!) outDir /dev/shm/horizon-b60-validation/post-gp-dist is not inside project root and will not be emptied.
- (!) Some chunks are larger than 500 kB after minification. Consider:

JavaScript chunks above 500 kB in the latest output:

| Emitted file | Size, kB | Gzip, kB |
| --- | ---: | ---: |
| `three-D6R2uBFN.js` | 617.63 | 158.93 |
| `free-roam-C6uOWm7j.js` | 1,341.18 | 360.70 |
| `index-DXg1ioCz.js` | 15,606.98 | 4,696.64 |

Temporary-output warnings and emitted bundle sizes do not establish browser startup time or hardware rendering performance. The [latest command recipe](horizon-rear-verges-practice-evidence/verification/post-gp-checks.py) and [latest build recipe](horizon-rear-verges-practice-evidence/verification/post-gp-build.mjs) retain the fixed 600-second phase caps and actual production configuration.

### Retained physics and UI scope

Both RH3 driving receipts recorded at `844725` supply ordinary external steering, throttle, and brake controls to the actual 120 Hz production simulation. They do not inject a pose, checkpoint progress, or result. The clean capped drive completed in **141.13 simulated seconds**, recorded all three sectors, and established a benchmark retrieved by Retry. Autopilot invalidated the next attempt, and SC7 began with its own empty target.

The intentional steering departure completed in **100.63 seconds**, retaining `off-road`, `valid: false`, and `newBest: false`; Retry received no benchmark. The physical road query observed the departure. The looser ordered-route corridor recorded 0 off-route seconds, which is a different measurement from the centre-on-road gate.

Both retained receipts match the rechecked 157-file physics/runner fingerprint `6b5a79e62f11d0f9c985011a08df7f6a8dac76391324e34c530f2e2b9a122313` over `src/core`, `src/simulation`, the lockfile, and the physical runner. The original [v14 clean](horizon-rear-verges-practice-evidence/physical-v14-clean.json) and [v14 off-road](horizon-rear-verges-practice-evidence/physical-v14-off-road.json) JSON bytes remain intact at their original `fdfee2aa9c8b04a21326aaeddf6984b79b2233521544116fb27ab8f5e4745812` scope. The rounded totals happen to match the earlier v14 runs; the current receipts contain the new physics fingerprint and newly measured sector values.

These scripted acceptance drives are not human lap-time targets, a rendered full lap, or a hardware frame-rate benchmark. The separate retained HUD fixture uses the real `FestivalHud`, `CircuitPace`, and Saira font with synthetic status. Its four recorded source/fixture hashes still match. It checks sectors, deltas, invalid results, an actual Retry callback, immediate menu/map/photo suppression, disposal, and desktop, 390/375 px portrait, and 844 px landscape bounds. Four screenshots were individually inspected; all 12 later captures were byte-identical to that run.

### Component images and construction cost

These retained pictures were captured before the final upstream integration. The car report explicitly identifies revised frozen graph `e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b` on parent `c4f674e86de7d9a0e80812bdbf7ac885f2a71a53`. Its baseline substitutes exactly four listed vehicle modules from `93576d20a3b52cc5e28959910b4b408418f53d3b` into that graph; it is not a rendering of the complete old application. The verge report records its two substituted modules, introduced meadow module, and fixture hashes; the HUD report records four relevant hashes. Neither receives an invented full-application fingerprint. Their recorded implementation/fixture hashes, plus the six-module [car inventory](horizon-rear-verges-practice-evidence/car-lod-inventory.json), are checked against the integrated checkout during finalization.

| Matched view | Before | After |
| --- | --- | --- |
| RH3 rear quarter | ![RH3 rear before](horizon-rear-verges-practice-evidence/cars/before-rh3-rear-quarter.png) | ![RH3 rear after](horizon-rear-verges-practice-evidence/cars/after-rh3-rear-quarter.png) |
| SC7 side intake | ![SC7 intake before](horizon-rear-verges-practice-evidence/cars/before-sc7-side-duct.png) | ![SC7 intake after](horizon-rear-verges-practice-evidence/cars/after-sc7-side-duct.png) |
| Medium road verge | ![Medium verge before](horizon-rear-verges-practice-evidence/verges/before-club-verge.png) | ![Medium verge after](horizon-rear-verges-practice-evidence/verges/after-club-verge.png) |

The fixed car cameras retain draw counts of 61 for RH3 rear quarter, 60 for SC7 rear quarter, and 37 for SC7 side intake. Geometry-object, material, and texture counts stayed within their zero-increase guards. Submitted rear-view triangles changed from 127,108 to 132,418 for RH3 and 118,160 to 134,400 for SC7. Repeat captures had identical pixels and the successful receipts recorded no browser, shader, GL, non-finite-attribute, or asset errors.

The retained indexed-geometry inventory compares the same authored source with `rearSweep` disabled and enabled. Its six source hashes still match; these full-buffer counts differ from camera-submitted triangles:

| Car | LOD | Indexed triangles before | Indexed triangles after | Meshes unchanged | Materials unchanged |
| --- | ---: | ---: | ---: | ---: | ---: |
| RH3 | 0 | 131,698 | 132,416 | 56 | 34 |
| RH3 | 1 | 40,482 | 42,236 | 41 | 27 |
| RH3 | 2 | 6,020 | 6,510 | 18 | 17 |
| SC7 | 0 | 121,630 | 137,870 | 55 | 34 |
| SC7 | 1 | 47,007 | 54,871 | 40 | 27 |
| SC7 | 2 | 4,992 | 6,808 | 17 | 16 |

A car attempt hit the unchanged 60-second Chromium launch deadline before loading a page; its [failure receipt](horizon-rear-verges-practice-evidence/cars/launch-timeout.json) remains intact. The accepted retry kept the original launch/render bounds, cameras, and baseline. The revised geometry closes the demonstrated white SC7 cap/bumper slit, and accepted RH3 pixels stayed byte-identical through that bounded correction.

The verge fixture fixes camera, terrain, and isolated component lighting. It checks repeated pixels, SwiftShader identity, source bytes, and browser/GL errors. The revised whole-region plan contains 38,886 clumps versus 39,928 in its substituted baseline, with planting concentrated around the circuit. Recorded revised submissions were:

| View | Submitted clumps | Grass triangles | Grass draws | Total scene draws |
| --- | ---: | ---: | ---: | ---: |
| Medium road view | 510 | 78,540 | 4 | 46 |
| Low road view | 189 | 29,106 | 4 | 46 |
| Planting close view | 272 | 41,888 | 2 | 49 |

Plan construction measured 4,033.4 ms in this captured run on a contended host. This is a construction observation, not a target-device frame-rate measurement. Individually inspected matched views show fuller green bases, broken seedhead bands, a clear road, and improved broadleaf silhouettes. The isolated renders establish procedural improvements in constructed depth and planting; they do not establish photographic parity with the reference pack or full-world performance.

### Remaining full-world validation limit

The historical full Festival attempt used the actual assets and worker and recorded fast-travel loading dismissed at **106.13 seconds**. Its combined **startup/first-draw gate exceeded the unchanged 180-second deadline**, so **zero native-driving steps and zero full-world screenshots passed**. The recorded phase groups readiness and the initial draw, and the subsequent observation also timed out. This receipt does not conclusively isolate GPU compilation or establish an environment-only cause.

Browser/network/asset error arrays were empty and its `e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b` production source stayed stable. Browser closure then exceeded its 15-second limit; a subsequent independent process check confirmed no owned process remained. Both the timeout and cleanup receipt are preserved unchanged. There was no longer-deadline, lower-quality, or synthetic-pose substitute for a full-session pass.

The native Start/W/S/R/menu/photo/Retry browser sequence, final-source full-world imagery, and hardware performance therefore remain unverified by this run. The retained physical checks and component/HUD successes keep their narrower scopes.

### Try the change

Choose RH3 or SC7 and start **Saltmarsh Practice Lap** in Festival. Drive to its start, or fast-travel there after discovering it. Complete a clean lap, then use **Try Again** to compare all three sectors with the same car's best complete clean lap in this Festival session. This benchmark is separate from persistent career/event records. Rear-quarter photo mode shows the body construction; the planted verges frame the Saltmarsh route.

Reproduction runners: [HUD](../../scripts/horizon-practice-hud-review.mjs), [car comparison](../../scripts/horizon-r7-vehicle-review.mjs), [verges](../../scripts/horizon-verge-review.mjs), [physical practice](../../scripts/horizon-practice-validation.ts), and [bounded full session](../../scripts/horizon-practice-session-review.mjs).

<!-- ROOT_VALIDATION_END -->

<!-- ROOT_PUBLICATION_START -->

Historical component/reference baseline: `93576d20a3b52cc5e28959910b4b408418f53d3b`. Captured car and attempted full-session graph: `e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b` on parent `c4f674e86de7d9a0e80812bdbf7ac885f2a71a53`. Accepted physics/integration gate: `84472529313a7f8912513eeb1b698566fab1b2bc` / `a8d081390e9bbe7ab3cd9ed45d7eb4ed75d9a2a2ef6dedb35bcb6b522703d404`. Final integrated parent: `6537fa7b2fe437c6b52cfca8ca9f6f4a7f1da416`; final production fingerprint: `f9038749a41da649beb24746d8e94c58d4d06348a2d9c38bcc97f4e527703000` across 789 files. The [current publication audit](horizon-rear-verges-practice-evidence/verification/publication-audit.json) and [preserved pre-GP audit](horizon-rear-verges-practice-evidence/verification/pre-gp/publication-audit.json) retain those distinct scopes. The Git commit containing this document identifies publication. Existing Saltmarsh geometry and earlier front/wheel work remain the foundation, not newly attributed features.

<!-- ROOT_PUBLICATION_END -->

The reproducible DOM fixture is [horizon-practice-hud.ts](../../e2e/fixtures/horizon-practice-hud.ts), with [the bounded runner](../../scripts/horizon-practice-hud-review.mjs). Rendered comparison and physical driving receipts must retain their own recorded scope; a successful component check alone does not establish full-world frame rate or human handling preference.
