# Phase 27D — presentation repair and stability increment

Base: `2009af13bc12b333bd3c7e306e96dc399ad6ffc4` on `main`, 20 September 2026.

This increment repairs the two observed Phase 27C failure paths and advances camera composition, distant material filtering and crowd LOD continuity. It is **not completion of all Phase 27D work, final Phase 27 acceptance, the 148-section directive or Steam readiness**. The complete application browser gates must be checked on the resulting commit; local component results are not a substitute.

## Implemented

### Render cost without removing cockpit detail

The original ten RPM LEDs, six wheel buttons and two independent shift paddles now use three instanced submissions. Individual transforms, colours, RPM state and actual shift actions are retained. The paddles preserve their original independent pivot frames and have conservative bounds for the full pull envelope. Mirror-feed ownership remains separate from the static body.

The physical pit-service fixture now measures **99 draw calls**, below the unchanged `<100` assertion, versus **114** in the failed base CI run. Evidence attachments are written before the cost assertion so future failures retain the measurement. No test limit was raised and no car geometry was removed to pass it.

The identical full-car studio view measures **110 -> 95 draw calls**, **88,419 -> 88,419 triangles**, **111 -> 96 geometry resources**, with nine textures in both. Six of seven before/after hero images were pixel-identical; the glove close-up differed only by a negligible raster rounding amount. An extreme helmet crop can submit one extra batch because of conservative aggregate bounds; this is not an assertion that every possible crop is cheaper. These are structural render measurements, not consumer-hardware FPS claims.

Owners: `src/rendering/car.ts`, `src/rendering/driver.ts`.

### Covered-menu responsiveness

The base Team HQ trace showed individual UI reads taking approximately 13–32 seconds and the final reload reaching the overall 300-second deadline. That trace does not establish save corruption. Continuing to submit an expensive orbiting backdrop behind every modal interaction was avoidable work.

A normal modal over the menu now retains its already-rendered backdrop. Input polling, DOM operations and IndexedDB transactions continue independently. Team-page changes and saved transactions do not repeatedly invalidate that backdrop. Resize and graphics changes request a fresh frame; closing the modal resumes the menu. Driving, replay and photo presentation are excluded from this freeze.

The strengthened browser tests retain the original 300-second HQ timeout, 90-second reload expectations, economy assertions, exact study setup values and quality settings. They additionally check continued input polling, no repeated backdrop frames during transactions, one resized frame, resumed presentation after closure and working photo controls. **These full-application tests require the normal CI browser environment: local navigation was blocked by administrator policy, so they were not locally passed or bypassed.**

Owner: `src/main.ts`; regression: `e2e/07-reference-tools.spec.ts`.

### Broadcast composition

Five permanent camera sites (IDs 0, 5, 8, 11 and 17) are moved to authored front-walkway positions rather than underneath or beside nearby stand canopies. The camera director and visible camera hardware consume the same site plan. IDs, shot regions and heights are retained. No roof is hidden and no camera is dynamically teleported to conceal an obstruction.

The tests sample **3,600 canopy sightlines** across 20 cameras, three shot positions, four aspect ratios and 15 rays per composition. Protected road clearances, fixed-site identity, whole-car framing and camera self-occlusion checks remain in force. Real before/after captures were also inspected. This is sampled near-canopy verification, not a mathematical proof of unobstructed views through every object over an entire race.

Owners: `src/rendering/trackside.ts`, `src/rendering/grandstand.ts`.

### Distant terrain/material stability

Procedural finish noise now measures its screen-space footprint and fades unresolved detail toward its mean. Resolved nearby detail is retained. Broad world-coordinate grass variation adds distant continuity without a terrain-height change or a separate draw. Grass apron and distant terrain use the same world field. Asphalt, concrete, paint and kerb finishes receive the same filtering primitive. Physical water, road surface queries and tire behaviour are unchanged.

Owner: `src/rendering/circuit-finish.ts`.

### Staggered spectator LOD handoff

Seeded spectator ranks select complementary, half-open coverage ranges during the 92–108 m and 218–242 m LOD transitions. Every spectator has exactly one rendered representation, instead of an entire cluster switching simultaneously. Colour and depth shaders use the same selection. There is one active mesh outside a handoff band and at most two within it; the transition therefore has a bounded additional vertex cost.

This is a deterministic spatial handoff, **not transparent crossfading, a far impostor system or event-driven standing/flag animation**. The existing 600/360/120 triangles-per-person levels and occupancy are retained. Pause and rewind restore exact rendered state. Tests cover 1,024 ranks at 14 distances and actual GPU colour/depth handoff renders.

Owner: `src/rendering/crowd.ts`; existing Phase 27C crowd oracles are extended to assert per-person exclusivity rather than falsely requiring one entire cluster LOD during transitions.

## Validation actually executed locally

| Gate | Result |
| --- | --- |
| Locked-toolchain `npm run check` | PASS: ESLint, 713 unit tests in 67 files, TypeScript and production Vite build |
| Seven focused browser/component tests | PASS in headed Chromium with real Three.js and SwiftShader |
| Circuit survey | 81 actual rendered views: 20 cameras, six service areas and one crowd view in clear day, rain day and rain night |
| Pit-service scene | PASS: real simulation service snapshot, wheels removed, 99 calls; original budget retained |
| Instrument/control regressions | PASS: display cadence, LED colours/positions, button colours/positions, paddle poses/bounds, pause behaviour |
| Crowd shaders | PASS: visible movement, exact pause/rewind, bounded handoff and stable repeated resource counts |
| Eight existing native simulation scripts | PASS; integrated changing-weather driving fixture passes all 14 checks |
| Full application/HQ browser journey | Not locally executable because navigation was blocked; inspect normal CI for this commit |
| Representative consumer hardware and manual audiovisual driving | Not executed |

The native scripts were `validate.ts`, `dynamics-benchmark.ts`, `marshal-integration.ts`, `wet-pit-integration.ts`, `integrated-driving.ts`, `rotation-benchmark.ts`, `pit-integration.ts` and `race-classification.ts`. Fresh reports are kept in the delivery evidence, not substituted for historical checked-in reports. The 100-lap endurance run was not repeated.

Dependencies were recovered from the repository's successful locked-toolchain artifact. No package version or lockfile changed. Local GPU tests used headed Chromium 144, while normal CI uses its pinned Playwright browser; this environmental difference is explicitly retained. Headless local WebGL initialization and full-page local navigation attempts did not pass. The allowed component fixtures exercise actual geometry/material/shadow code but do not certify the complete application's postprocessing, UI, input, storage or audio journey. Vite's existing large-chunk warning remains visible.

## Scope preservation and reference traceability

`docs/MASTER_DIRECTIVE.md` is unchanged: SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`. Package-lock SHA-256 remains `0ee732475bc70f3bec4bfa7787f904d51bc28c185534dff3762f2d18801bbc59`.

Core, simulation, worker, storage, input and audio source trees are unchanged. Existing physics, pit, replay, telemetry and setup behaviour are preserved. Work stays on `main`, with no replacement application or new publication branch.

This advances graphics/material/camera/LOD requirements in sections 54–68, 95–98 and 122–129. It preserves the applicable per-image reference ledgers rather than marking all 100 images complete. Cockpit references 003/008/009/030/073/088 retain their original detail at lower submission cost; circuit/crowd references 001/007/039/044/089/098 inform clearer compositions and continuity; wet/night cues 010/068/079/080/082/087/093/096 are regression-surveyed, not newly declared matched. The supplied commercial screenshots are reference inputs, not shipped game assets.

## Still open before Phase 27 acceptance

Artist-quality whole-car silhouette/material and close driver-anatomy review; apparent geometry intersections; deeper service-road/building/landscape architecture; far crowd impostors and event reactions; dense-spray appearance and calibrated wet-night exposure; continuous temporal review of camera cuts, shadows and reflections; all applicable image-by-image quality acceptance; representative-hardware frame-time/VRAM/loading budgets; real wheel/gamepad driving; the complete human-driven Section 146 audiovisual scenario and three final audits. Steam packaging and release readiness are not certified by this increment.

## Reproduction

```sh
npm ci
npm run check
npm run test:phase27c
npm run test:physics
npm run test:e2e
```

For the locally exercised component subset: `npm run test:e2e -- e2e/instruments.spec.ts e2e/pit-presentation.spec.ts e2e/11-phase27c.spec.ts --headed`. Do not replace the complete browser gate with this subset.
