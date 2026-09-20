# Phase 27C — full-lap cohesion: implemented increment, acceptance still open

Base: `d8fa4e7430f520656d6d97d4b0e71a1db905bd1d` (`main`, 20 September 2026).
Source tree: `b8e45058744e062a20cc63ca36f989f42d716f6f`.

This is a substantial rendering/integration increment, **not completion of Phase 27C, the original 148-section directive, commercial visual parity, or Steam readiness**. Changes were authored against an exact recovered GitHub source artifact. They have not been pushed or deployed. The original `MASTER_DIRECTIVE.md` is unchanged, SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`.

## Implemented changes

### Car, cockpit and driver

The car now has recessed original sidepod ducts rather than an opaque surface masquerading as an opening. Only the original terminal cap is removed; the skin is retained, with separate duct walls, a lip and recessed cooling matrix. Brake ducts and uprights belong to the rigid steering/heave carrier, while centre-lock detail belongs to the rotating/removable wheel. Rear crash support and an open exhaust outlet add original mechanical depth. These are rendering details, not new physical cooling, crash or thermal models.

A newly shaped helmet shell, narrower smoked visor, seals, hinges and restrained original crown marking rotate about a neck-centred pivot. Actual recorded/interpolated vehicle G channels drive bounded head motion. No looping animation, invented driver likeness or proprietary texture is used. The wheel grips now have closed ends.

Gloves use separately shaped, tapered fingers, knuckles, seams, palm reinforcement and cuffs. All eight non-thumb finger meshes are closed and consistently wound. Index/paddle and thumb interactions retain actual observed shift and ERS events. Sculpted sleeves, torso and restrained harness geometry replace the previous basic sleeve forms. Shoulder anchors stay fixed to the seat and the original two-bone lengths stay constant: an initial shoulder-motion experiment failed reach checks at steering lock and was removed. This remains simplified procedural anatomy; it is not the final artist-quality cockpit pass.

Owners: `car.ts`, `car-mechanical-detail.ts`, `cockpit.ts`, `driver.ts`, `driver-anatomy.ts`.

### Crowd and terrain

The existing grandstand occupancy and seat positions are retained. Spectators now have original seated silhouettes, arms, hands, feet, clothing and skin variation. Thirty-five spatial clusters share instance transforms/colours between three geometric detail levels. Each cluster has only one visible level; per-person phases avoid synchronized movement. Small upper-body motion uses presented simulation time, not wall time. The colour and custom depth/shadow shaders share deformation. Rain reduces movement. The renderer owns updates and disposes the custom materials.

The three levels use 600, 360 and 120 triangles per person. This is not a far-distance billboard/impostor system, a standing/flag-waving event-driven crowd, or a blended LOD transition. Those promised improvements remain open.

Far terrain now uses the existing original grass material with metre-scaled UVs, bringing it closer to the track apron without adding a terrain draw or changing terrain heights. It is not a full terrain/vegetation asset overhaul.

Owners: `crowd.ts`, `grandstand.ts`, `landscape.ts`, `circuit.ts`, `renderer.ts`.

### Six authored service areas and lighting placement

Three recovery and three maintenance sites add grounded pads, parked original vehicles, equipment shelters, storage and cones. Whole footprints are sampled against the physical road/pit boundary, stands and camera positions, rather than accepting just a safe centre point. The same plan excludes vegetation; 650 trees are retained without growing through these sites. The measured minimum site clearance is 14.8102 metres beyond the protected road boundary. Geometry costs 25,680 triangles and 48 draw-owning meshes before the circuit's later mixed-scene spatial batching.

The parked vehicles are scenery. No operating recovery AI, safety car, new access-road network or barrier opening is claimed. The shelter/vehicle models remain deliberately bounded procedural assets.

The 34 lighting masts use ground-aware placement and avoid stand footprints and sampled camera sightlines. Their feet follow the actual banked grass apron. Existing night presentation remains reversible; this is not calibrated photometry or final wet-night exposure acceptance.

Owners: `venue-service-plan.ts`, `venue-service.ts`, `venue-lighting.ts` and construction integration in `circuit.ts`.

### Broadcast framing and camera self-obstruction

All 20 physical replay-camera positions are preserved. Shot families, speed-bounded predictive lead, filtered pan and aspect-aware framing keep the whole car inside a conservative optical cone. Resizing a paused view reframes without inventing another camera cut; ordinary pause retains the pose.

Actual GPU captures exposed an important existing error: some views were inside their own camera bodies/barrels or platform rails. Camera hardware is now behind the optical origin and rails are below it; props are not hidden and rig coordinates are not moved to disguise the problem. Sixty sampled self-occlusion rays cover the 20 rigs. This is not an exhaustive all-world obstruction proof.

The tiny lens materials no longer request physical transmission. That unnecessary material flag previously caused a whole-scene transmission pass. This is a structural render-cost correction, not a consumer-hardware FPS claim.

Some roof edges still intrude into camera compositions, especially views 05, 08 and 11 in the survey. All-camera final composition and continuous cut quality remain open.

Owners: `trackside.ts`, `track-infrastructure.ts`, `venue-lighting.ts`, `renderer.ts`.

## Evidence and execution boundaries

The delivery package contains raw measurements, source-module hashes, original rendered PNGs, comparison captures and the native regression reports. It contains no supplied commercial reference images and no extracted game assets.

| Gate actually executed | Result |
| --- | --- |
| Seven focused native oracle groups, real Three.js 0.180.0 | Passed |
| Driver steering/load envelope | 7,614 poses; fixed anchors and limb lengths |
| Four-aspect broadcast projection | 47,584 projected car corners checked |
| Camera hardware self-occlusion | 60 sampled rays across 20 rigs; passed |
| Real crowd colour/depth shader | Visible movement; pause and rewind exact; repeated resource counts stable |
| Hero component rendering | Seven new views plus the same seven baseline views; no reported WebGL/console error |
| Circuit component surveys | 81 captures: all 20 cameras, six service areas and one crowd view in dry day, wet day and wet night |
| Survey state preservation | Every capture retained its recorded source frame and physical water state |
| Existing native simulation/race scripts | All eight exited zero; changing-weather journey passed all 14 checks |
| Changed TypeScript syntactic transpilation | 23 files, no syntactic diagnostics; **not a full type check** |
| Captured runtime-source provenance | All captured module hashes match the delivered source |
| Protected source trees | Core, simulation, workers, storage, input and audio unchanged |

The eight existing native scripts are `validate.ts`, `dynamics-benchmark.ts`, `marshal-integration.ts`, `wet-pit-integration.ts`, `integrated-driving.ts`, `rotation-benchmark.ts`, `pit-integration.ts`, and `race-classification.ts`. Their new raw reports are in the delivery evidence directory, not substituted for historical checked-in reports. The 100-lap endurance test was not rerun.

The authoring environment could not install the locked npm toolchain. Actual attempts to run `npm run check`, `npm test` and `npm run build` did **not** pass: ESLint/Vitest were absent and Node/Vite type definitions were missing. Global TypeScript was 5.8.3, not the lockfile's 5.9.3. No dependency version was changed to hide that limitation.

For GPU evidence, real recovered Three.js 0.180.0 and production modules were compiled into isolated in-memory fixtures and rendered in headful Chromium under Xvfb using SwiftShader. No Three.js mock was used. Browser navigation was blocked by administrator policy; the allowed in-memory component route was used instead. These fixtures cover real geometry, materials, shadows, effects and simulation snapshots, **not the complete Vite-built application, RacingRenderer postprocessing, UI, IndexedDB, audio, or player input journey**. New normal Vitest and Playwright wrappers are included for execution in the standard installed toolchain; their normal runners were not locally certified.

Circuit positions came from an uninterrupted production-simulation AI lap: 7,477 ticks in clear weather and 8,577 in rain. The rain-night pass changes presentation only. Individual survey captures include recorded nearby history for effects; they are not proof of frame-perfect temporal quality throughout a full driven race.

### Measured cost, not a performance claim

At the identical front/rear three-quarter studio view, draw calls rose from 91 to 110 and triangles from 73,267 to 88,419. Renderer-reported geometry resources rose from 92 to 111; texture count stayed at nine. This is an explicit quality cost that still needs representative-hardware profiling and full-frame LOD tuning. SwiftShader screenshot/readback timings are not player FPS. No 60/120-FPS claim or memory-leak certification is made.

## Reference and master-directive traceability

The retained per-image ledgers remain authoritative; classifications are not upgraded merely because a counterpart exists. The original ZIP was recovered and reviewed in five contact sheets, with focused close inspection where needed. This is not a renewed high-resolution acceptance of every image.

| Reference cues | This increment | Remaining discrepancy |
| --- | --- | --- |
| 003, 008, 009, 030, 073, 088 | Hands, cockpit construction, helmet, load/action-driven occupancy | Simplified anatomy, suit detail, lighting and material response; no licensed likenesses |
| 022, 042, 077, 078, 090 | Original ducts, uprights, locks, tail and close-view evidence | Full silhouette/material/LOD convergence still unfinished |
| 001, 007, 039, 044, 089, 098 | Seated crowd clusters, grounded service zones, terrain material continuity, 20-camera survey | Bespoke architecture, service-road network, distant terrain and crowd variety incomplete |
| 010, 068, 082, 093, 096 | Existing real wetness and spray retained and surveyed with new scene | Dense spray remains visibly particle-based; full temporal and cockpit visibility review open |
| 079, 080, 087 | Grounded, sightline-aware lighting placement and wet-night survey | Night exposure, shadows, landmarks and atmosphere still below target |

Hardware references 048–049 and unrelated 050–065 remain supplementary/excluded as recorded. Management, narrative, online/friends leaderboards and other applicable non-racing references are not silently removed from the overall scope, nor claimed complete here.

This advances sections 54–68, 95–98, 122–129 and 134–135. It does not close the three-pass rule, sections 140–141, 146–148 or previously partial requirements. Core simulation improvements are neither replaced nor relabelled as newly implemented.

## Open Phase 27C acceptance

The hero car still needs an artist-led whole-silhouette/material review, including possible apparent suspension/geometry intersections in close views. Near driver/crowd anatomy is still simplified. Vehicle wear/heat presentation, full venue/service-road architecture, far crowd impostors, event-driven crowd reactions and blended LODs are not finished. Whole-lap cockpit/chase/broadcast motion must still be reviewed for aliasing, specular flicker, shadow stability, reflection transitions, popping and camera cuts. Roof-edge compositions, wet spray appearance and night readability remain visible deficiencies.

The full installed-toolchain build, complete unit/browser suite, representative-hardware profiling, real wheel/gamepad review, all applicable reference quality comparisons and human-driven Section 146 audiovisual run remain required. This increment must not be presented as a finished commercial game.

## Reproduction after installing the locked dependencies

```sh
npm ci
npm run test:phase27c
npm run check
npm run test:physics
npm run test:e2e
```

The new `test:phase27c` script executes the seven focused invariant groups directly. Seven Vitest wrappers and five browser tests are also added to the existing suite without weakening its assertions. `e2e/11-phase27c.spec.ts` retains its rendered attachments for manual review. Source publication and deployment remain separate actions.
