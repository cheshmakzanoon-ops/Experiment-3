# Phase 27D — spectator and night-presentation continuation

Base: `537491b41b4eb7fe7d34bcdaa863369bc04d9da6`, on `main`.

This increment closes concrete implementation gaps in distant crowd representation, snapshot-driven spectator reactions and consistent circuit-night lighting. It is **not completion of Phase 27, the full 148-section directive, reference-image visual parity, or Steam release acceptance**.

## Preserve the current repository, not an obsolete starting point

The starting review mentioned two failures at `2009af13`: the pit-render draw budget and the Team HQ reload journey. Those repairs were already published in `988dac65`; its GitHub workflow `35543773466` completed successfully. This continuation does not redo them or relax their tests.

While the continuation was being developed, `e7447b56` added the production `SprayClouds` renderer, continuous floodlight selection and its own tests. The delivered changes preserve that commit and its subsequent axial-projection continuity fix in `537491b4`. Its spray implementation, four-light selection, intensity constant, unit tests, GPU test and report are retained. An overlapping local spray implementation was discarded rather than shipped alongside it. Only unreachable legacy spray calculations are removed from the old point-sprite shader; non-spray particle formulas, emission, lifetime, advection, particle budgets and replay state are unchanged.

## Implemented

### Distant spectators: two triangles, shared identity

`src/rendering/crowd-impostor.ts` adds an original analytic seated-person billboard. It uses two triangles and no new texture, image atlas or external asset. The existing near/mid/far geometric levels remain 600, 360 and 120 triangles per spectator. All four levels share instance matrices, clothing colours, skin colours and stable per-person phase/rank data.

The final handoff occupies 420–480 metres. Each spectator is assigned to exactly one representation by complementary half-open rank intervals. At most two cluster draws are active in a handoff, with staggered individual replacements rather than the whole stand switching at once. This is not transparent crossfading, and an individual's silhouette still changes when its rank crosses the boundary. Held views and replay seeks reproduce the same selection.

The far card receives lighting, fog and scene shadows. It does not cast a camera-facing fake shadow. Near geometric spectators retain their matched colour/depth deformation and real shadows. Bounds include a conservative 35-centimetre margin for arm motion and card orientation. Forced close-up card captures are shader diagnostics, not a claim that flat silhouettes are suitable as close-range human models.

Owners: `crowd-impostor.ts`, `crowd.ts`, `renderer.ts`.

### Spectator reactions from the presented snapshot

`src/rendering/crowd-response.ts` consumes actual live/replayed car position, speed, proximity, impact and pit/retirement fields. A nearby moving car produces restrained attention; closely spaced moving cars produce a stronger battle response. An impact produces a separate flinch and suppresses cheering. Proximity is a cue, not a fabricated completed-overtake event.

The response has no wall-clock event timer, inferred rank-change history, new simulation field or mutation of the source snapshot. Stable spectator phases vary participation and gestures. Rain and distance reduce the movement. The renderer passes the same presented frame used by the other playback-aware components, so pause and rewind restore the same response. The colour and custom depth shaders use identical rotations. Input validation rejects malformed/non-finite frame or location data.

These are bounded seated arm/head responses. Standing spectators, flags, team-specific celebrations, race-start choreography and final human anatomy remain outside this increment.

Owners: `crowd-response.ts`, `crowd.ts`, `renderer.ts`.

### Shared night profile and stronger regression coverage

`circuitLightState` in `daylight.ts` centralizes the night sun/fill/environment/exposure/fog settings. Both `RacingRenderer` and the production circuit survey consume it instead of maintaining divergent hard-coded profiles. Daytime settings are unchanged. The night settings retain a low ambient floor for dark bodywork and infrastructure; they are authored values, not calibrated photometry. The published four-source floodlight weighting and source positions remain unchanged.

Two additional normal Playwright tests exercise the real production spray and crowd shaders. They check perspective scaling, light response, fog, occlusion, near-plane safety, particle-kind exclusion, cleared state, resource disposal, visible reactions, exact held/rewound output and deterministic mesh/card handoffs. Existing tests now verify the actual instanced spray path and its shared storage rather than demand a dead `float plume` string in the point shader. Existing numerical/performance limits and assertions remain intact.

## Measured comparison against 537491b4

The baseline and candidate use the same production simulation snapshots, water fields, particle histories, camera views, resolution and rendering settings, except for the intended night-profile change. These are direct-scene component measurements in Chromium/SwiftShader, **not player FPS or GPU-hardware profiling**.

| View | Draw calls, base → candidate | Triangles, base → candidate | Texture resources |
|---|---:|---:|---:|
| Wet day, camera 05 | 153 → 153 | 331,617 → 331,617 | 24 → 24 |
| Wet day, occupied grandstand | 825 → 828 | 1,490,158 → 1,245,486 | 50 → 50 |
| Wet night, camera 05 | 152 → 152 | 331,605 → 331,605 | 24 → 24 |
| Wet night, occupied grandstand | 824 → 827 | 1,490,146 → 1,245,474 | 50 → 50 |

The occupied-grandstand survey removes 244,672 submitted triangles (16.42%) at the cost of three extra handoff draws and three reported geometry resources. The two-triangle card is a 98.33% geometry reduction relative to the former 120-triangle final spectator mesh, **not** a 98.33% whole-game performance improvement. Views with no affected visible far crowd do not show a reduction. All four captures retained identical simulation ticks, effect diagnostics, source frames and physical water state.

## Validation

Final execution results and the exact tested module hashes are included in the delivery's validation evidence. The complete locked-toolchain `npm run check` passed: ESLint, **728 unit cases in 69 files**, full TypeScript checking and Vite production build. The normal build still reports its existing over-500-kB chunk-size warning; that warning was not suppressed or relabelled as optimized streaming.

The **12 selected normal Playwright rendering tests passed on the final integrated source**, including all 81 circuit survey captures and the retained axial-spray continuity regression. No WebGL/page/console error was reported by their asserted probes. The existing pit-service budget remains `<100` draw calls and measured **99**; it was not increased.

All **eight native simulation/race scripts passed** in one successful chained run, including all **14 checks** of the changing-weather driving journey. Their executed simulation/core/script bytes are identical to final source; the last integration afterward changed only the published spray shader, its browser fixture and documentation. Their raw JSON reports and exact code hashes are retained. This is not a human-driven audiovisual journey, and the 100-lap endurance command was not rerun.

The original master directive, dependency lock and protected source trees remain unchanged. The rendering-source hash manifest was verified after execution. Intermediate integration failures were repaired before these final runs; assertions and numerical budgets were not relaxed.

The rendering tests use real Three.js 0.180.0 and production modules in headful Chromium under Xvfb/SwiftShader. The full `RacingRenderer` wet-race fixture includes its actual postprocessing and moving/held chase, cockpit and trackside captures. The 81-view circuit survey is an isolated direct-scene fixture covering 20 cameras, six service areas and a grandstand in clear day, wet day and wet night. These are not equivalent to driving every frame of a complete race through the actual UI.

A full application navigation attempt was blocked with `net::ERR_BLOCKED_BY_ADMINISTRATOR` at the local preview URL. That is an execution-environment limitation, not proof of an application failure or success. Full UI/browser certification, human audio/input review and representative hardware measurements remain separate gates. The environment was not bypassed, and no Three.js mock was substituted.

## Master directive and reference traceability

The exact `docs/MASTER_DIRECTIVE.md` is unchanged (SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`). The lockfile is unchanged (SHA-256 `0ee732475bc70f3bec4bfa7787f904d51bc28c185534dff3762f2d18801bbc59`). No simulation, protocol, worker, storage, input or audio implementation is modified by this continuation.

This advances the LOD/instancing, lighting/atmosphere, visual motion and connected-feedback requirements in sections 60–61, 95–96, 122, 128–129 and 134–135. It preserves the existing sections 67–68 spray implementation. It does not complete sections 140–148 or upgrade unrelated requirement statuses.

The supplied ZIP was recovered for this work. Focused visual review revisited crowd/venue cues 001, 007, 039, 044, 089 and 098; wet-race cues 010, 068, 082, 093 and 096; and night cues 079, 080 and 087, including close inspection of the wet-car reference. This is **not** a new high-resolution approval of every one of the 100 images. Existing per-image ledgers, duplicate classifications, hardware supplements and exclusions remain authoritative. No supplied commercial image, driver likeness, team branding or extracted game asset is included in the build or delivery.

## Still open

The hero-car whole-silhouette/material pass, nearby driver/crowd anatomy, complete venue/service-road/landscape architecture, full crowd choreography, long continuous camera/reflection/shadow/LOD review, realistic layered spray appearance, final wet-night grading, all applicable reference comparisons, real wheel/gamepad play and representative-hardware budgets remain open. The night review still reveals discrete spray lobes and simple background assets. This increment improves specific systems; it does not certify commercial presentation.

No Phase 28 racing-quality work is substituted for these remaining graphics gates. Publication, deployment and Steam acceptance are separate from having a tested local source increment.

## Reproduce

```sh
npm ci
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
npm run test:e2e -- e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts e2e/pit-presentation.spec.ts e2e/11-phase27c.spec.ts e2e/12-presentation-continuity.spec.ts e2e/13-wet-lighting-closure.spec.ts
```

The focused graphics command does not replace the repository's complete unfiltered browser CI command. CI files and test thresholds are unchanged.
