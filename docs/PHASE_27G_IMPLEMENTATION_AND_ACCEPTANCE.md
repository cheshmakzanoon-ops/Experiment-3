# Phase 27G — second-generation presentation and explicit acceptance boundaries

Base: `e02f3832b42f42f2acb77469cce2bcceef367219` on `main`.
The exact Phase 27F run `35625899483` completed successfully on 21 September
2026 at 16:55:13 UTC: validate, scenarios, all three browser shards, wet
presentation and publication. That is the starting gate, not this candidate's CI.

This is implementation work towards 27G, **not a claim that all requested final
art, all 100 reference images, all 148 master sections, the human Section 146
scenario or commercial readiness are accepted**. In particular, code-derived
models remain original procedural art. Adding a rig or a scene does not make it
commercial-character quality. The original directive and lockfile remain intact.

## Implemented work and what it does not certify

| Workstream | Delivered implementation | Remaining acceptance / scope |
| --- | --- | --- |
| 27G.0 | Exact recovered Git tree and successful source-specific Phase 27F CI verified before restructuring. | This new commit needs its own full remote workflow. |
| 27G.1 | Shared three-level vehicle architecture; redesigned nine-station nose, downwash sidepods and engine cover; shared four-element front and two-element rear aero, halo, open airbox, floor fences, correct tyre profiles, shaped rims and closed ventilated rotors. Suspension attachment points derive from the same body envelopes. Brake ownership remains independent of pit wheel removal. | Whole-car proportions, manufacturing detail, intersections, all LOD changes and every moving close view need independent visual acceptance. Original formula-car architecture remains one car, not a roster. |
| 27G.2 | Filtered metre-scaled carbon, turned-alloy and brake/suede treatments; static filtered paint finish kept separate from actual snapshot-driven wet/damage observation; clone-safe shader ownership. Cooling openings, ducts and visor/glove detail retain physical surface placement. | These are authored visual approximations, not measured BRDFs, a physical body-water film or position-resolved impact damage. Full-lighting material calibration remains open. |
| 27G.3 | Wheel and glove use one grip curve; independent curved fingers, opposing thumb, fitted palm, suit/harness revisions and existing physical IK/steering ownership. Photo subject anchors now follow the actual articulated helmet, wheel and mechanical parts. | Anatomical and animation polish remains below the requested commercial reference standard; neither a scanned driver nor final human-art approval is claimed. |
| 27G.4 | Four authored districts within Aurel: orchard club, quarry works, north works and south concourse; shared terrain profile, distinct structures/signage/planting, conservative footprint clearance and registered broadcast solids. A real HQ forecourt/glazed frontage complements the existing workshop, with three original residents. | These are sectors/inspection scenery of the existing location, **not four or sixteen new maps**. Full-lap landscape density, distant detail, venue art and every sightline remain review items. |
| 27G.5 | Shared tailored pit/grid people with shaped helmets and gloves; retained pit-service-state ownership; 24 instanced trackside staff at 12 physical pads with local/finish flags; more differentiated deterministic crowd poses and clothing. Foreground original people have articulated shoulders/elbows/head, shaped faces and closed garment lofts with full-radius joints. | Pit and spectator animation is still bounded procedural posing, not full motion capture or facial performance. Far crowds remain impostors. All close character views require further artistic work. |
| 27G.6 | Explicit day/sunset/night presentation sharing sun direction, skydome, shadows, atmosphere/exposure and cached environment identity; recorded rain/cloud state still supplies overcast and wet appearance. Sunset uses a low warm sun, not a recoloured UI. Existing real contact spray, lights and reflections remain integrated. | No physical volumetric fog, photometrically measured sky, new automatic exposure system or formula-car headlights are claimed. Four-weather full-lap/hardware review remains independent. |
| 27G.7 | Read-only event predicates and bounded watches for moving traffic, actual overlap, packed fields, wet contacts, braking, loaded corners, grid/lights, pit service and incidents. The normal game watches accepted worker/replay snapshots and hashes the actual current canvas. It never moves cars or enables rain/AI to fake an event. | Correct event conditions are not correct framing, continuous cinematography, sound or complete-image equivalence. Panning uses the existing production motion blur, not a new shutter-accumulation photographic simulation. |
| 27G.8 | Corrected reference destinations; 093 is wet cockpit, 026 assists, 070 setup, 033 on-track livery. The existing held-grid photo remains available alongside a live-grid watch. Actual UV-guide drag/keyboard editing and Escape rollback update on-car text decals. Added original two-person, 47-second captioned Team HQ briefing using real local team state, camera cuts, seek/pause/transcript, reduced-motion and owned GPU disposal. | The briefing is silent and scripted, not a branching story campaign, dialogue recording, copied interview or high-fidelity facial performance. Decals remain ten text slots on two flanks, not arbitrary bitmap paint. Online/reverse leaderboard reference 069 remains genuinely unimplemented, rather than being routed to an unrelated academy. All reference UI compositions are not certified complete. |
| 27G.9 | Existing gates retained; numerical/geometric regressions, real-component GPU inspections, normal-navigation attempts, source identity, reference traceability and bounded human/hardware evidence tools. | Actual continuous human Section 146 drive, Windows GPU/CPU/VRAM/loading/frame-pacing measurements, real controller/wheel operation, independent all-reference approval and new-commit full CI remain separate required gates. |

## Ownership and resource limits

`car-architecture.ts`, `car-surfaces.ts`, `car-floor.ts` and `tire-profile.ts`
own shared high/mid/far envelopes. `wheel-grip.ts` owns the actual hand/grip
contact curve. `manufacturing.ts` and `paint-finish.ts` own separate static and
observed-state finishes; dynamic uniforms are not silently attached to the
static pigment API. `crew-geometry.ts` provides shared instanced morph topology.

`venue-districts.ts` shares placement with vegetation exclusions and broadcast
solid registration. `marshal-staff.ts` uses three instanced batches, no extra
simulation, and bounded local flag queries. Existing 600/360/120 near/mid/far
crowd triangle gates and the two-triangle extreme-distance impostor remain.
The 650-tree cap and four nearby floodlights remain unchanged. The strict
physical-pit `<100` draw-call assertion has not been increased.

HQ residents bake their original material colours into vertex attributes and
share three roughness classes. This preserves the original `<20` HQ mesh gate,
which initially caught a per-person material-batch regression. Art was not
removed and the assertion was not relaxed. The Team Media scene owns a separate
explicitly opened renderer/canvas, bounded resolution, 1024 shadow map, 128
PMREM environment, paused-by-default 47-second clock and full resource cleanup.
It is not loaded as a continuously running second game renderer.

## Reference event and export semantics

From Reference Review choose the event's inspection action. The watch selects
the appropriate camera and observes a current race/replay, or arms for the next
session. The user still chooses weather/opponents and drives or explicitly
selects the labelled demonstration. Pauses, source changes, large gaps, rewind,
camera changes and session changes cannot be stitched into a continuous event.

Once the condition is observed, the actual canvas is encoded and SHA-256 hashed,
with source, session, simulation time, camera, event and occlusion information.
The PNG is canvas-only: **HTML HUD is not included**. Full-application screenshots
and audiovisual review are additional evidence. `humanAccepted` and
`visualAccepted` stay false. Capturing an event does not approve the reference.

The optional offline helpers are deliberately separate:

```sh
node --experimental-transform-types scripts/phase27g-events.ts /new/event-directory
HEADED=1 CHROMIUM_PATH=/path/to/chromium node scripts/phase27g-capture.mjs /new/capture-directory /event-directory
```

The first uses ordinary production simulation/inputs and records true snapshots.
The second composes production rendering/UI components, **not the normal worker
application**, and never substitutes a generic car picture for an unobserved
event. Selected surface maps are final-frame observations, not full surface
replay histories. Empty/black/invalid-GL captures fail rather than count.
Original images, exclusions, hardware supplements, duplicate relationships and
unresolved gaps remain in the all-100 ledger. No source reference pixels ship.

## Validation history and current gate

See the accompanying source-identified evidence summary and local logs. Failed
intermediate checks remain recorded: an unchanged static shader contract caught
an improperly mixed dynamic finish, a low-LOD tyre profile differed in width,
HQ material proliferation exceeded its unchanged bound, and a real pointer test
exposed lost keyboard ownership during SVG replacement. Source fixes preserve
the contracts rather than changing expected outcomes.

A local successful command is not a remote commit or workflow. A blocked normal
application navigation is not a successful browser test. Linux SwiftShader
component images are not Windows hardware benchmarks. A synthetic or autonomous
input sequence is not a genuine human drive. Sparse JSON evidence does not
prove startup, attach video, or certify artistic quality.

The full current validation commands remain:

```sh
npm ci
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
npm run test:phase27c
npm run test:e2e
```

Do not proceed from this document to a blanket Steam-ready claim. More cars,
more genuinely different modes and at least sixteen distinct playable maps
remain future game-development scope, not finished by this increment.
