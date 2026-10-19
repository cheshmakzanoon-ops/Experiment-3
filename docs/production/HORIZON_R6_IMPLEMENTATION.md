# Horizon R6 — tyre plumes, local night lighting and clean landings

This pass extends the original MOTOBOUND Festival / Solvane Coast section in Three.js. It adds structured, lit dry tyre plumes, bounded illumination from existing storefronts and festival bulbs, and a clean-landing skill that uses actual vehicle motion. Existing R4 road/car/activity work and R5 coast, atmosphere and rival-passing work remain in place.

The work began at `9e5ff534ecf4d8391eaa7075a284b141544de7ee` and incorporates the subsequent `d09921545ddcebe2b34ed4a85dab36deeafab969` wheel-momentum update. The later swept-chassis collision and synchronized-animation work was also preserved, through `5ba247c25bbe3ec793655517e5fa4e39162b40e9`. The Quarry probe was repeated on that integrated head with numerically identical results. The subsequent Motocross and MotoGP commits through `9d5c5582530bbb66de2a170edd6775f3a3947b1b` were also preserved. Their changes do not modify the Festival four-wheel physics, skill evaluator or dry-cloud/practical-light implementation; their application-wide source fingerprint is distinct from the earlier accepted browser evidence.

## What the player sees

### Smoke and dust

Festival-owned `Effects` instances opt into a dry-cloud shader. Smoke and loose-ground dust use two filtered scales of procedural density, an irregular soft edge, and age-dependent movement within each existing puff. The round billboard footprint avoids the former velocity-axis turn when a camera crosses the wake. Projected area is preserved while its shape changes.

The density is attached to the existing particle seed and measured size. Pause and replay therefore retain the same state. Smoke receives restrained internal shading and a directional backlit edge; local spotlights contribute only their actual attenuated scene light. Dust retains its surface-dependent colour. Darkness does not introduce an emissive smoke term.

The change adds no particle, texture, model, render target or draw pass. Particle births, capacity, motion, wind and lifetime remain in the existing `Effects` / `EffectPlayback` path. Water spray and other venues retain their existing optical path. These are lit, structured billboards; they are not a fluid simulation or true volumetric multiple scattering.

Implementation: [dry-cloud-density.ts](../../src/rendering/dry-cloud-density.ts), [spray-clouds.ts](../../src/rendering/spray-clouds.ts), [effects.ts](../../src/rendering/effects.ts), and the Festival renderer's explicit opt-in.

### Night streets and festival bulbs

`HorizonDressing` records sockets at its existing shop signs and harbour festoon bulbs. `FestivalPracticalLights` reuses four unshadowed Three.js spotlights, aimed outward/down from those real emitters at the carved ground. They contribute diffuse and specular light to the existing road, buildings and car materials.

| Quality | Maximum active practical lights |
| ------- | ------------------------------: |
| Low     |                               0 |
| Medium  |                               2 |
| High    |                               3 |
| Ultra   |                               4 |

Selection is limited to 42 metres around the camera, with one slot per frontage or bulb string. Retention bias prevents needless reassignment; a light fades to zero before moving. Storefronts behind their own facade are excluded. The scene has 635 accepted sockets and four allocated light resources; distance, quality and night strength determine which can illuminate a view.

The source cones are constrained to remain outside their own facade. Their limited range reduces spill, but unshadowed lights cannot provide general occlusion through other buildings. The work adds no shadow-map pass or environment-wide brightness increase. Photograph-derived colour and placement guide the result; exact physical intensity cannot be recovered from still images.

Implementation: [festival-practical-lights.ts](../../src/rendering/open-world/festival-practical-lights.ts), [horizon-dressing.ts](../../src/rendering/open-world/horizon-dressing.ts), and [festival-renderer.ts](../../src/rendering/open-world/festival-renderer.ts).

### Clean landings that extend a skill chain

Four-wheel cars can earn an air bonus after a genuine road or dirt-trail launch. The evaluator arms after 0.6 seconds of forward loaded-wheel driving above 12 m/s, then requires at least 0.35 seconds unloaded and eight metres of measured horizontal travel. It accepts at most three seconds of flight.

Points remain provisional during flight. A clean touchdown must approach the sampled ground, stay upright and regain stable front/rear axle contact for 0.25 seconds within a bounded 0.8-second recovery window. A short suspension bounce is allowed, but it restarts that stable-contact timer. A qualifying landing awards `150 + round(min(2, airborne seconds) × 100)` before the existing chain multiplier.

The HUD shows `AIR · LAND CLEANLY`, then `LANDING · HOLD YOUR LINE`, with measured seconds and metres. It hides the bank countdown during the attempt. A successful landing displays `AIR · CLEAN LANDING`, or `GREAT AIR · CLEAN LANDING` for at least one second airborne, and extends the existing chain.

Reset, travel, vehicle changes, impacts, spins, flips, invalid motion and assisted driving clear provisional attempts. Tiny repeated hops cannot accumulate into one paid jump. A bounded grass-crossing attempt can recover to the road, while prolonged off-road driving still loses its chain and cannot rearm an air reward. Banking a previous chain preserves the physical run-up to an immediately following crest. Motorcycle scoring remains on its existing adapter.

No ramp, terrain height, vehicle force, traction coefficient or scoring snapshot is manufactured by this feature. The automated physical fixture uses the authored Quarry Track crest near station 1992 metres. Its initial tangential approach velocity is controlled and declared in the test; its flight, tyre loads and landing are produced by the production simulation. This is automated physical evidence, not an unassisted human playtest.

The [retained physical measurement](horizon-r6-evidence/airtime-measurements.json) includes the complete executed probe, source hashes, approach setup and timeline. On the integrated wheel-momentum physics:

| Quarry approach                 | Longest unloaded interval | Measured horizontal air distance | Maximum chassis clearance |                 Air points |
| ------------------------------- | ------------------------: | -------------------------------: | ------------------------: | -------------------------: |
| 32 m/s initial tangential speed |                0.800000 s |                      22.263802 m |                1.035978 m | 230, after stable recovery |
| 24 m/s control                  |                0.066667 s |          Not a qualifying flight |                0.511808 m |                          0 |

The qualifying run has zero impact/off-road frames and a minimum body up-vector Y of 0.959339. The older 28 m/s control became a genuinely qualifying flight under the upstream physics; lowering the control to 24 m/s measures a real nonqualifying case rather than forcing the expected result into the score.

The [current-head remeasurement](horizon-r6-evidence/airtime-integrated-measurements.json) repeats the exact retained program after the swept-collision integration, with stable source hashes before and after execution. Both speeds ran sequentially and the process exited successfully. Every nested measurement and sampled timeline value matches the original evidence. The 32 m/s approach setup produces an actual takeoff speed of 27.780129 m/s; it does not maintain an assigned speed through the jump.

Implementation: [skill-chain.ts](../../src/simulation/open-world/skill-chain.ts), [session.ts](../../src/simulation/open-world/session.ts), [festival-hud.ts](../../src/ui/festival-hud.ts), and [festival-airtime.test.ts](../../tests/festival-airtime.test.ts).

## Relationship to the 100 reference images

The full [R4 individual reference ledger](HORIZON_R4_REFERENCE_REVIEW.json) remains the 100-entry observation/provenance record. This pass recovered the original compressed review pack and verified all 100 JPG files against the ledger's `compressed_review_sha256`: one matching file for every ID 001–100 and zero mismatches. The [retained integrity record](horizon-r6-evidence/reference-integrity.json) includes the archive hash and all 100 check results. This confirms the compressed review inputs, not the original full-resolution bytes.

Six images were freshly inspected directly for this implementation. A fresh hash check of all 100 files is not a claim of a fresh visual inspection of all 100 scenes.

| Image | Directly observed cue                                                                                   | Selective use in this pass                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 028   | Warm orange lanterns against a cool sky, distinct local pools and dark surrounding grass                | Warm existing festival bulbs with bounded reach; airborne lantern choreography and water reflections are outside this change |
| 040   | Continuous pale rear-tyre smoke with denser rolling regions and soft edges                              | Filtered procedural smoke density, irregular edges and coherent existing particle motion                                     |
| 052   | Warm backlit dirt-race dust, dense near the ground with a mottled rolling edge                          | Surface-coloured dust, two density scales and bounded light response                                                         |
| 066   | Coloured signs and separated projector lamps on reflective white paint, with dark grille/carbon details | Muted original-sign illumination that can contribute to existing material highlights                                         |
| 081   | Bright shop interior/fascia with darker parked cars and isolated wall-light cones                       | Local storefront illumination that retains dark surroundings                                                                 |
| 083   | Blue-hour cool sky and bodywork, warm fascia/brick and distinct pools on coarse asphalt                 | Warm/cool separation and short-range light aimed from authored emitters                                                      |

The reference pack informs observation and technique transfer to the original Solvane world. It does not establish vehicle physics, reproduce every photographed scene, or demonstrate commercial Forza visual parity.

## Verification design and reproduction

[Horizon driving and optics review](../../.github/workflows/horizon-driving-review.yml) builds the exact committed source, runs focused physics/rendering regressions, runs the repository lint/content gates, and records browser evidence with a verified Chromium/Mesa software backend. Its artifact is named `horizon-r6-driving-and-optics`.

The new [effects fixture](../../e2e/fixtures/horizon-r6-effects.ts) records actual `OpenWorldSimulation` sessions: RD2 at Kestrel Drift for smoke, TC1 on Quarry Track for dust, and a rainy TC1 runway launch for water spray. It uses normal event commands and scripted steering/pedals, with no assigned chassis/tyre channels or injected score. Scripted input is explicitly assisted evidence. The full snapshot prefix is replayed through the production effects adapter at three distinct motion times.

Each dry-plume comparison renders the same frozen particle pool with the Festival optical switch off/on/off. The fixture records hashes of the actual snapshot and particle bytes, visible pixel differences, geometry/texture allocations, draw counts, shader errors and WebGL errors. Water must remain pixel-identical. Its carved-ground patch is an isolated optics view, not a full-world screenshot.

The integrated night comparison freezes the production Festival composer, geometry, camera and simulation. Only practical-light intensities are zeroed/restored; the visible light count stays fixed. The repeated off frame must match exactly, while the on frame must show a measurable contribution without additional draw calls, geometry, textures or shadow passes.

The separate [existing browser journey](../../scripts/horizon-browser-review.mjs) exercises the real worker, keyboard throttle/brake, map, photo mode, garage, event entry, assisted race completion, retry, HUD and teardown. A functional software-renderer result does not certify hardware frame rate, all traffic situations or human fun/comfort.

```bash
npm run build
HORIZON_REVIEW_PORT=5188 node scripts/solvane-review-server.mjs
```

In a second terminal with Playwright Chromium installed:

```bash
HORIZON_REVIEW_URL=http://127.0.0.1:5188 \
  node --experimental-transform-types scripts/horizon-r6-browser-review.mjs
HORIZON_REVIEW_URL=http://127.0.0.1:5188 HORIZON_REVIEW_QUALITY=low \
  node --experimental-transform-types scripts/horizon-browser-review.mjs
```

The runners default to SwiftShader locally. CI explicitly selects Mesa/llvmpipe under Xvfb; both are software backends, and each runner rejects an unexpected fallback renderer.

## Validation record

The accepted [Horizon driving and optics CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39290190127) tested commit `d9d7d163cbc9abaa1fdd167a6ad68381e0022797`. Its [build identity](horizon-r6-evidence/d9d7/BUILD_IDENTITY.json) records fingerprint `0337913472a4101e8c59241088f9ad1e868be1e5dc57a116755c21f34a8dc23e`, independently reproduced from that commit's raw Git blobs. The [retention record](horizon-r6-evidence/d9d7/retained-evidence.json) identifies the original CI artifact and hashes of the retained, unedited reports and PNGs. [HORIZON_R6_VALIDATION.json](HORIZON_R6_VALIDATION.json) is the consolidated validation record.

| Accepted check                   | Recorded result                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused regression suite         | **88 tests in 12 files passed**, with a clean exit; see [raw test results](horizon-r6-evidence/d9d7/tests.json) and [test log](horizon-r6-evidence/d9d7/tests.log)                                                                                  |
| Build, lint and content gates    | Passed; retained [build](horizon-r6-evidence/d9d7/build.log), [lint](horizon-r6-evidence/d9d7/lint.log) and [content](horizon-r6-evidence/d9d7/content.log) logs                                                                                    |
| Recorded smoke, dust and water   | Three distinct motion samples per scenario; finite production physics, unchanged snapshots and particle bytes, and every repeated off-control frame exactly equal; see [raw optics report](horizon-r6-evidence/d9d7/optics/review.json)             |
| Water isolation                  | All three before/after comparisons have zero changed pixels and zero maximum channel delta; each corresponding original PNG pair is also byte-identical, as recorded in the optics and retention reports                                            |
| Night storefront and festoon     | Both production compositions pass with unchanged physics and camera, exact repeated off frames, two active lights out of four allocated resources, and no added shadow pass                                                                         |
| Browser journey                  | **11 steps passed**, including real worker/input movement, map, photo mode, garage, event/rival HUD, assisted completion, distinct retry, return to free roam and teardown; see [raw journey report](horizon-r6-evidence/d9d7/journey/journey.json) |
| Browser and graphics diagnostics | Zero reported browser errors, failed assets, shader errors or WebGL errors in the accepted optics and journey evidence                                                                                                                              |

Before/after draws and allocations remain equal at every sampled state. The isolated smoke and dust views each retain three draw calls, four geometries and zero textures; water retains four calls with the same allocations. The production storefront remains at 519 calls, 1,738,568 triangles, 533 geometries and 53 textures; the festoon view remains at 391 calls, 2,484,110 triangles, 564 geometries and 53 textures. These measurements establish unchanged counts for the optical toggle, not zero shader cost or target-device frame rate. The [optics report](horizon-r6-evidence/d9d7/optics/review.json) retains every before/after counter.

The accepted Mesa/llvmpipe optics run completed in 1,504.062 seconds, approximately 25 minutes 4 seconds. No GPU stall or timeout was reported in that successful run. The [CI timing excerpt](horizon-r6-evidence/d9d7/ci-timing-excerpt.log) records the two production night compositions at approximately 694 and 704 seconds. The subsequent phased review harness saves partial reports and early phase artifacts, records explicit deadlines, and gives each night composition 18 minutes, with outer process deadlines. Those generous bounds follow the measured software-renderer times; they do not relax image, source, replay or allocation assertions. The accepted `d9d7` screenshots predate that harness change. The phased harness was published in `3f9f0ee97be9ee16270be744f70e151af9cd4011`; its [own follow-up run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39298672730) is tracked separately from the two completed application reviews.

The earlier local run that passed 34 assertions but exited with a Vitest worker RPC timeout remains excluded from acceptance evidence. It is superseded by the successful committed-source run above. The [physical remeasurement on integrated `5ba247c`](horizon-r6-evidence/airtime-integrated-measurements.json) remains numerically identical to the original Quarry probe. The subsequent [integrated-engine browser run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39290292406), at `14270a4058ec547102b4aedb5430faac9c52fc7c`, also passed the build, lint/content gates, all 88 focused tests in 12 files, every optical comparison and all 11 journey steps. Its optics step completed in 24 minutes 37 seconds and its driving journey in 2 minutes 42 seconds. The [separate retained record](horizon-r6-evidence/14270/retained-evidence.json) preserves that run's identity and raw reports. The original `d9d7` screenshots below continue to illustrate the feature comparisons. The [integrated comparison record](horizon-r6-evidence/14270/review-comparison.json) reports differing particle hashes and some scene counters between runs; every within-run optical switch, repeated-control and allocation assertion still passes. Direct inspection of the two integrated night views and the results panel found no new visible blocker.

### Direct review of the retained images

All eight images below were directly inspected against the freshly viewed reference cues. The [visual review record](horizon-r6-evidence/visual-review.json) separates that image judgment from automated pixel and allocation checks. The before/after images are original 960 × 600 CI captures with no editing or resampling.

| Comparison                                 | Before                                                                | After                                                               | Directly observed change                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke — isolated carved-ground optics view | [Before](horizon-r6-evidence/d9d7/optics/smoke-1-before.png)          | [After](horizon-r6-evidence/d9d7/optics/smoke-1-after.png)          | Blurry bright ovals become a more connected plume with irregular translucent lobes and soft breakup, closer to reference 040. The centre is denser and whiter, with no visible hard billboard boundary. |
| Dust — isolated carved-ground optics view  | [Before](horizon-r6-evidence/d9d7/optics/dust-1-before.png)           | [After](horizon-r6-evidence/d9d7/optics/dust-1-after.png)           | A subtler change from soft disconnected dabs to broken ochre wisps and varied density. This supports reference 052's uneven wake, while retaining low contrast against the ground.                      |
| Storefront — full production composer      | [Before](horizon-r6-evidence/d9d7/optics/night-storefront-before.png) | [After](horizon-r6-evidence/d9d7/optics/night-storefront-after.png) | A cool local pool reaches the pavement and curb with slight wet-road spill. The upper facade, shop windows and surrounding street remain dark, consistent with the separation in references 081/083.    |
| Festoon — full production composer         | [Before](horizon-r6-evidence/d9d7/optics/night-festoon-before.png)    | [After](horizon-r6-evidence/d9d7/optics/night-festoon-after.png)    | A broad, restrained warm pool reveals foreground asphalt texture while the distant street and existing lamp pools retain their appearance, consistent with references 028/083.                          |

No concrete visual blocker was found in these comparisons: no obvious wall backspill, abrupt light-cone edge, excessive ambient brightening or hard particle rectangle is visible. Smoke is the clearest visual gain; dust and practical lighting improve more selectively.

The isolated plume stills do not establish wheel-contact alignment, visibility through a full driving scene or temporal shimmer quality. Dust is shown under neutral lighting, so this pair does not demonstrate reference 052's strong sunset backlighting. The red car changes negligibly in the storefront composition; that image supports pavement and wet-road illumination more clearly than improved car reflections. The night streets retain visibly repeated architecture and comparatively simple vehicle forms. These captures support localized realism improvements, not a complete match to the reference photography, general building occlusion, a human playtest or hardware-performance certification.

### Broader repository status

The pre-R6 baseline [Build and validation #650](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39284585710), at `d09921545ddcebe2b34ed4a85dab36deeafab969`, passed lint, content, typecheck and build. That historical run failed two `race-view-continuity.test.ts` cases because a fixture lacked `setGrandPrixGrid`, plus the Kestrel rallycross joker accounting scenario. The concurrent `9d5c5582530bbb66de2a170edd6775f3a3947b1b` commit supplies the missing fixture method and its assertion. The [general CI run for that commit](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39297624742) was queued when reviewed, so current full-repository status remains unconfirmed. The historical failures and the focused Horizon success must not be represented as a fresh result for the full repository.
