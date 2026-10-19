# Horizon R6 — tyre plumes, local night lighting and clean landings

This pass extends the original MOTOBOUND Festival / Solvane Coast section in Three.js. It adds structured, lit dry tyre plumes, bounded illumination from existing storefronts and festival bulbs, and a clean-landing skill that uses actual vehicle motion. Existing R4 road/car/activity work and R5 coast, atmosphere and rival-passing work remain in place.

The work began at `9e5ff534ecf4d8391eaa7075a284b141544de7ee` and incorporates the subsequent `d09921545ddcebe2b34ed4a85dab36deeafab969` engine update. The new wheel-momentum physics is the basis for the final driving checks.

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

Implementation: [skill-chain.ts](../../src/simulation/open-world/skill-chain.ts), [session.ts](../../src/simulation/open-world/session.ts), [festival-hud.ts](../../src/ui/festival-hud.ts), and [festival-airtime.test.ts](../../tests/festival-airtime.test.ts).

## Relationship to the 100 reference images

The full [R4 individual reference ledger](HORIZON_R4_REFERENCE_REVIEW.json) remains the 100-entry observation/provenance record. This pass recovered the original compressed review pack and verified all 100 JPG files against the ledger's `compressed_review_sha256`: one matching file for every ID 001–100 and zero mismatches. This confirms the compressed review inputs, not the original full-resolution bytes.

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

Final committed-source results and measured browser evidence are recorded in `HORIZON_R6_VALIDATION.json` once the source-matched review has completed. In-progress local runs are not acceptance evidence. In particular, the initial effects run passed 34 assertions but exited with an unhandled Vitest worker RPC timeout, so it requires a clean rerun. The initial Quarry control was recalibrated after the upstream wheel-momentum update made the old 28 m/s control a genuinely qualifying flight.

The pre-R6 baseline [Build and validation #650](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39284585710), at `d09921545ddcebe2b34ed4a85dab36deeafab969`, passed lint, content, typecheck and build. It already failed two `race-view-continuity.test.ts` cases because a fixture lacks `setGrandPrixGrid`, plus the Kestrel rallycross joker accounting scenario. These baseline failures are distinct from the focused Horizon review; a passing Horizon review must not be represented as a passing full-repository release gate.
