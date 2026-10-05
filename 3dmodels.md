# Experiment-3 — Required 3D Model Production Backlog

Repository: `cheshmakzanoon-ops/Experiment-3`  
Engine: Three.js  
Authoring target: Blender -> glTF/GLB  
Purpose: production backlog for dedicated 3D assets needed to push the game toward AAA-quality presentation.

## Important production rule

The player car, cockpit and driver already exist as dedicated 3D assets. Do not replace them merely to increase asset count. The current cockpit **view/camera framing still needs a dedicated repair and visual validation pass**. The highest-value modeling work is now the circuit environment, pits, people, infrastructure, vegetation, support vehicles, rival-car presentation and venue identity.

A "dedicated 3D model" below means an intentionally authored production asset or modular kit with correct scale, pivots, materials, UVs, LOD strategy and integration metadata. It does not imply that every item must be a separate GLB.

Priority:
- **P1** — should be built first; strongly visible in normal racing, pit approach or common replay views.
- **P2** — second production wave; adds density, variety and believable operations.
- **P3** — later/conditional presentation asset.

## Integrated asset revisions

| Asset | Integrated scope | Remaining acceptance |
|---|---|---|
| A01–A07 | Original concrete/guardrail/fence/impact/gate/marshal/gantry families integrated on the retained Aurel route, three LODs, packed PBR maps and Blender 5.2.2 sources. | First integrated revision; final art, full human lap, hardware, Vellamar placement and interactive recovery remain open. Existing start-state replay only; no new aborted-start race rule. See [infrastructure notes](docs/TRACK_INFRASTRUCTURE_ASSET_PACK.md). |
| A11/A13/A14/A18 + A43/A44/A45 | Two authored start/finish stands, seat LODs, recorded race board, four audience families and articulated marshals. | First integrated revision; final art, broader infrastructure/venue propagation and hardware review remain. See [venue notes](docs/START_FINISH_ENVIRONMENT.md). |
| A41/A42 | Shared near/middle mechanic suit, helmet/gloves and fourteen editable actions; grid routine and all six authored pit roles. | Final human art/hardware approval, natural-motion review and crowd/marshal refinement remain open. See [crew notes](docs/A41_A42_CREW.md). |
| A21 | Four architectural frontage sections across all twelve existing bays, three LODs per section, 43 placement sockets and retained Blender/GLB source. | Final art, driven-lap and hardware approval remain open; neighboring equipment and cockpit repair remain separate. See [A21 notes](docs/A21_HERO_PIT_BUILDING.md). |
| A22 | One working garage, bay 05; retained Blender source, GLB and three LODs. | Final art review, cockpit repair and further environmental refinement remain. See [A22 notes](docs/A22_HERO_GARAGE.md). |
| A24 | One four-position pit-wall station, eight snapshot-driven screens, three LODs and 17 future interaction sockets. | Characters, collision/safety-wall behavior and final art/hardware approval remain separate. See [A24 notes](docs/A24_PIT_WALL_STATION.md). |
| A33 | Front/rear spare-wheel handling set, three LODs, sixteen sockets, state-driven carrying and four stored wheels in A22. | Final art, detailed exchange/condition continuity and representative-hardware approval remain. See [A33 notes](docs/A33_SPARE_WHEEL_HANDLING_SET.md). |
| A35 | Mobile trolley and fixed rack; empty, partial and full loads, eight sockets, three LODs and three bay-05 placements. | Parked visual props only; live handling, final art, full-lap and hardware approval remain. See [A35 notes](docs/A35_TYRE_TROLLEYS_RACKS.md). |

A12 now has a first integrated revision at the six retained Aurel sites, with
three detail tiers, unchanged seat/crowd layouts and editable native source.
[Scope and evidence](docs/A12_SECONDARY_GRANDSTANDS.md). Final art, continuous
human-driven review, representative hardware and exact-source release remain
independent acceptance gates; A72–A75 are not completed by this package.

An integrated revision is not final approval and does not complete related asset-family rows.

---

## P0 — Cockpit view repair before new cockpit art

A first camera-only calibration is implemented and under the permanent production-renderer evidence gate. The source socket and supplied meshes remain unchanged. See [P0 framing evidence](docs/P0_COCKPIT_FRAMING.md); final visual approval is still open.

The existing 3D cockpit should be retained, but its first-person presentation needs correction.

Required work:
1. Reproduce the current flawed cockpit view in the actual game.
2. Recalibrate eye position, pitch and cockpit FOV independently from the pod camera.
3. Verify the supplied eye socket and chassis-space transform.
4. Check halo clearance, steering-wheel visibility, display readability and road visibility.
5. Test full steering lock, braking, kerbs, camera shake, wet conditions, pause and replay seeking.
6. Prevent the inertial camera from clipping the imported cockpit geometry.
7. Validate common aspect ratios and resolutions.
8. Add a visual regression gate once framing is approved.

This is primarily a camera/integration repair, not a request for another cockpit mesh.

---

# 1. Track edges and race infrastructure

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A01 | P1 | Modular concrete race barriers | Proper end profiles, joints, recesses, contact wear and several controlled damage variants. |
| A02 | P1 | Steel guardrail kit | Corrugated rails, overlapping sections, posts, transitions and believable end treatments. |
| A03 | P1 | Catch-fence kit | Angled posts, tension cables, ground anchors, gates and stable fine-wire treatment. |
| A04 | P1 | Impact absorbers / tyre walls | Segmented blocks, wraps, straps, connectors and worn variations. |
| A05 | P1 | Recovery/access gates | Hinges, latches, posts and gate leaves that connect service routes to the circuit edge. |
| A06 | P1 | Marshal-post assembly | Shelter, stairs/platform, equipment mounts and protected working area. |
| A07 | P1 | Start-light gantry | Rear structure, supports, housings, wiring routes and maintenance access. |
| A08 | P2 | Flag-panel / timing-sensor housings | Physical mounts, service boxes, cables and connector details. |
| A09 | P2 | Braking-distance / sector-board kit | Thin physical boards with supports, backs, feet and controlled wear. |
| A10 | P2 | Trackside broadcast-camera kit | Camera body, lens hood, rain cover, tripod/platform and cable routing. |

# 2. Grandstands and spectator infrastructure

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A11 | P1 | Hero start/finish grandstand | Distinctive roof silhouette, layered facade, structural depth and underside detail. |
| A12 | P1 | Secondary grandstand modules | Straight, corner, end and extension modules with shared visual language. |
| A13 | P1 | Sculpted stadium seats | Shaped shells, backs, mounts and controlled color variation for nearby rows. |
| A14 | P1 | Grandstand structural bays | Beams, columns, bracing, roof ribs, joints and terrain-connected footings. |
| A15 | P2 | Stairs, landings and handrails | Connected circulation with believable widths and protected aisles. |
| A16 | P2 | Under-stand concourse frontage | Doors, shutters, recessed facilities, queue rails and service areas. |
| A17 | P2 | Hospitality balconies | Deep glazing, shading, balustrades and limited visible interior furniture. |
| A18 | P1 | Large video-screen installation | Screen housing, rear bracing, weather protection and maintenance access. |
| A19 | P2 | Timing/scoring tower | Signature vertical structure with readable display hierarchy. |
| A20 | P2 | Canopy, flag and banner supports | Structural mounts, tensioning hardware and cloth-ready geometry. |

# 3. Pit building, garages and pit wall

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A21 | P1 | Hero pit-building frontage | Strong architecture, depth, bay variation and convincing roof/ground connections. |
| A22 | P1 | Fully dressed working garage bay | Work zones, wall systems, service equipment, lighting and practical organization. |
| A23 | P2 | Garage-door mechanisms | Tracks, slats, brackets, recesses and open/closed configurations. |
| A24 | P1 | Pit-wall command station | Covered workstation, screens, chairs, cases, cables and team surfaces. |
| A25 | P2 | Garage partitions / storage walls | Modular dividers, cabinets, drawers, worktops and practical material breaks. |
| A26 | P1 | Overhead garage service rig | Lighting housings, trays, hose reels, suspended fittings and supports. |
| A27 | P2 | Garage signage / bay-number system | Physical fascia and backplates with replaceable original graphics. |
| A28 | P2 | Pit-building roof equipment | HVAC units, ducts, vents, drains and roof-access detail. |
| A29 | P2 | Apron drainage / utility trenches | Recesses, slots, covers, joints and service channels integrated into the pit lane. |
| A30 | P2 | Rear garage logistics entrance | Loading edges, service doors and equipment staging connecting to the paddock. |

# 4. Pit-service and workshop equipment

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A31 | P1 | Wheel-gun close-up model | Grip, trigger, casing, socket, connectors and proper hand contact. |
| A32 | P1 | Front and rear jack models | Distinct silhouettes, wheels, pivots, levers and car-contact pads. |
| A33 | P1 | Spare-wheel handling set | Race-wheel-compatible carry and storage states with correct service interaction. |
| A34 | P1 | Tyre blankets and controllers | Fitted cloth, seams, handles, cables, controller boxes and folded variants. |
| A35 | P1 | Tyre trolleys / racks | Frames, castors, retainers and partially loaded versions. |
| A36 | P1 | Tool chests / flight cases / benches | Reusable family with drawers, latches, handles, castors and restrained wear. |
| A37 | P2 | Cooling fans / blowers | Grilles, ducts, supports and power cables. |
| A38 | P2 | Compressed-air / hose stations | Bottles, regulators, carts, connectors and deliberately routed hoses. |
| A39 | P1 | Pit-release device | Readable release hardware, mounting structure, pivots and operator grip. |
| A40 | P2 | Fire / spill-response equipment | Extinguishers, cabinets, trolleys and spill-response containers. |

# 5. People and character production

Existing people assets should be refined and diversified rather than discarded.

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A41 | P1 | Pit-crew body/suit refinement | Better shoulders, elbows, knees, proportions, folds and deformation. |
| A42 | P1 | Crew helmets, visors and gloves | Better silhouettes, seals, cuffs, finger forms and tool-grip contact. |
| A43 | P1 | Front-row spectator family | Distinct original heads, hair, body proportions and clothing for close replay views. |
| A44 | P1 | Middle-distance crowd family | Economical seated/standing silhouettes with coherent outfit groups. |
| A45 | P1 | Marshal character upgrade | Proper clothing, protective gear, posture and believable flag-hand contact. |
| A46 | P2 | Race engineers | Original faces, headsets, team clothing and seated/standing poses. |
| A47 | P2 | Grid mechanics / technicians | Shared rigs for kneeling, checks, carrying equipment and leaving the grid. |
| A48 | P2 | Photographers / camera operators | Cameras, straps, weather clothing, headsets and protected-location poses. |
| A49 | P2 | Stewards / security / venue workers | Distinct silhouettes and role-specific accessories. |
| A50 | P2 | Spectator accessories / rainwear | Caps, phones, bags, flags, jackets and weather gear. |

# 6. Vegetation, terrain and close ground detail

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A51 | P1 | Near-track broadleaf trees | Irregular crowns, branches, bark/root transitions and several age/shape variants. |
| A52 | P1 | Tall/narrow tree family | Complementary vertical silhouettes appropriate to Aurel's landscape identity. |
| A53 | P1 | Orchard tree family | Managed trees and row-end variants for the existing Orchard district. |
| A54 | P1 | Grove / treeline modules | Layered groups that create depth rather than isolated repeated trees. |
| A55 | P2 | Shrubs, hedges and undergrowth | Varied height and edge profiles connecting structures and planted areas. |
| A56 | P2 | Grass / verge clusters | Sparse silhouette geometry for near views, blended into ground materials. |
| A57 | P1 | Quarry cliffs / retaining walls | Recognizable rock profiles, ledges and terrain connections for Quarry. |
| A58 | P2 | Rock / cut-stone family | Related forms with controlled scale variation. |
| A59 | P1 | Drain / kerb-end / ground-transition kit | Detailed slots, joints, ends and verge connections without changing physics. |
| A60 | P2 | Background landforms / skyline | Lightweight ridges, terrain masses and sparse distant structures. |

# 7. Rival cars, support vehicles and race-state geometry

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A61 | P1 | AI rival exterior-quality pass | Bring close opponents nearer to the player-car visual standard while preserving physical dimensions. |
| A62 | P2 | Rival bodywork silhouette variants | Small original family of nose, sidepod and wing treatments, not only recolors. |
| A63 | P2 | Recovery truck | Cab, wheel arches, bed, ramps, winch and practical materials. |
| A64 | P2 | Maintenance van / utility vehicle family | Coherent original vehicles with believable wheels, cab and underbody. |
| A65 | P2 | Medical-response vehicle | Properly scaled, purpose-readable parked response vehicle. |
| A66 | P2 | Fire-response vehicle | Compartments, hoses, equipment and a designed service-site placement. |
| A67 | P2 | Team transporters / trailers | Cabs, trailers, doors, wheels and loading connections that explain paddock logistics. |
| A68 | P3 | Safety-car exterior | Build when the game has an implemented safety-car scene/system that uses it. |
| A69 | P2 | Damage / detached-aero set | Fitted wing fragments, broken endplates and bounded debris states. |
| A70 | P2 | Tyre-condition geometry variants | Only for major silhouette changes such as puncture; ordinary wear stays material-driven. |

# 8. Aurel landmarks, paddock and venue finishing

| ID | Priority | Required model / kit | Production brief |
|---|---|---|---|
| A71 | P1 | Aurel event-hall refinement | Improve the existing landmark silhouette, facade depth, entrances and ground composition. |
| A72 | P2 | Orchard Motor Club kit | Refine roof, glazing, terraces, furniture and structural connections. |
| A73 | P2 | Quarry Terrace kit | Refine seating, tensile canopy, stairs, retaining structures and terrain integration. |
| A74 | P2 | North Works workshop kit | Refine sawtooth roofs, bays, loading edges, doors and industrial equipment. |
| A75 | P2 | South Concourse kiosk kit | Deep counters, shutters, storage, canopies and connected pedestrian space. |
| A76 | P2 | Pedestrian bridge / entrance portal | Original landmark with believable supports and a purposeful route. |
| A77 | P2 | Paddock hospitality / tent modules | Coherent awnings, lightweight structures, team identity and service access. |
| A78 | P2 | Site furniture / access-control kit | Benches, bins, queue barriers, turnstiles and lamp housings. |
| A79 | P3 | Parc-ferme / podium set | Rails, weighing area, steps and backdrop for supported finish scenes. |
| A80 | P3 | Trophy / celebration-prop kit | Original hero props for implemented close-up celebration scenes. |

---

# Recommended production order

## Gate 0 — Fix and approve cockpit view
Do this before judging new trackside assets from the driver's seat.

## Wave 1 — One complete pit/start-finish scene
Build:
- A21 hero pit building
- A22 working garage
- A24 pit wall
- A26 overhead services
- A31-A36 core pit tools/equipment
- A41-A45 near crew/marshal refinements
- A11 hero grandstand
- A13 near seats
- A18 big screen
- A01-A07 nearby race infrastructure

Acceptance target: cockpit approach -> pit entry -> service -> pit exit, plus replay views, should look like one coherent place rather than a collection of props.

## Wave 2 — Complete-lap environmental quality
Build:
- A02-A10 track-edge infrastructure
- A12-A20 secondary stands
- A51-A60 vegetation/terrain
- A61 close-rival upgrade
- A71-A75 district/landmark refinement

## Wave 3 — Operational life and logistics
Build:
- A46-A50 supporting people
- A37-A40 secondary equipment
- A63-A67 support vehicles
- A76-A78 paddock/public-space assets

## Wave 4 — Conditional presentation
Build A68-A70 and A79-A80 only when the game systems/scenes that use them are ready.

---

# Assets that should NOT become unnecessary heavy 3D models

Keep these primarily material/shader/effect driven unless silhouette or close parallax requires geometry:

- ordinary road wear and rubber deposits
- fine carbon weave
- small paint scuffs
- dirt films
- tyre scrub and normal wear
- most distant bolts / fasteners
- rain
- spray
- smoke
- sparks
- atmospheric haze
- wet-surface response

More polygons do not automatically create AAA presentation. Camera composition, lighting, animation, material response, density, placement and performance are equally important.

---

# Required Blender -> game handoff standard

Every approved asset family should include:

1. Editable `.blend` source.
2. Correct real-world scale.
3. Clean object origins and pivots.
4. Consistent forward/up-axis convention.
5. Clean topology appropriate to its use.
6. UVs and PBR-ready material slots.
7. Texture-resolution budget.
8. Near/mid/far LOD strategy where appropriate.
9. Instancing plan for repeated assets.
10. Collision or occlusion metadata where relevant.
11. Animation rig / sockets where interaction requires them.
12. Deterministic variation controls.
13. Provenance notes.
14. GLB export validation.
15. In-game screenshots at intended viewing distance.
16. Moving in-game validation, not only studio renders.
17. Day / sunset / wet / night checks where the asset is visible.
18. Performance check under mirrors, shadows and weather effects.
19. No change to physical track/collision geometry merely to hide visual mismatches.
20. Final approval only after actual gameplay/replay inspection.

---

# Core production principle

The fastest route to a materially more AAA-looking game is **not** to build random isolated hero assets. It is to make one complete racing environment believable from foreground to horizon, validate it from the cockpit and replay cameras, then propagate that quality around the circuit.

The immediate high-value asset groups are:

1. pit building + working garage
2. pit wall + service equipment
3. near pit crew / marshals
4. hero grandstand + nearby audience
5. barriers / fencing / gates
6. near vegetation + quarry/terrain transitions
7. close AI rival quality
8. Aurel landmark refinement
9. support vehicles and paddock logistics
10. optional celebration/race-state assets after the main race presentation is strong

## A34 authored revision 01

A34 now supplies nine original Blender-authored blanket/controller/cable variants and a socket-aligned, material-batched arrangement in A22 bay 05. Editable source, self-contained GLB, three LODs, integrity manifest and focused tests are retained. This is not heating simulation, A33 wheel handling, final-art approval or cockpit-camera repair. See [A34 scope and validation](docs/A34_TYRE_BLANKETS.md).


## A36 authored revision 01

A36 supplies an original rolling seven-drawer tool chest, medium and large flight cases, and a freestanding workbench. Four garage-local placements in A22 bay 05 share one PBR atlas and three batched LODs. Editable Blender source, self-contained GLB, footprint/transport/ownership tests and production-factory browser surveys are retained. These are parked visual props, not live drawer interaction, crew animation, collision changes, cockpit repair or final-art approval. See [A36 scope and validation](docs/A36_WORKSHOP_EQUIPMENT.md).

## A08–A10 integrated revision 1

Three original Blender families now dress Aurel’s existing signal, braking-board and replay-camera stations. A08 adds local recorded LED presentation; A09 retains the original 18 distance stations and adds two sector boards; A10 retains all 20 optical positions with dry/rain camera and platform geometry. Native sources, bounded LODs, manifests, socket metadata and validation are retained. This is not a new timing engine, mechanical TV tracking, final art or Vellamar propagation. See [scope and evidence boundary](docs/TRACKSIDE_OPERATIONS_KIT.md).


## A55-A60 Quarry integration continuation

The first authored Quarry sector revision integrates two limestone cliff forms,
retaining wall, talus/boulder, retained-drain collars, jointed verge edge, shrub,
hedge, tussock and background ridge families, all with three detail tiers and a
matched editable Blender/GLB source. Ground-conforming placement and graded outer
apron strips preserve the physical circuit and supplied player assets.
See [A55-A60 scope, reproduction and evidence limits](docs/A55_A60_QUARRY.md).
This is one coherent Aurel sector; broader propagation, final art, uninterrupted
human driving and representative-hardware approval remain open.

## A71 authored event-hall revision 1

The released menu repair clears the way for an original Blender-authored event-hall
refinement at the existing Aurel site. Four recessed entrance bays, canopy lobes,
facade detail, approaches and chamfered supports accompany three packed shell tiers.
The eight-draw / 7,000 allocated-triangle limit is retained. Native/GLB/accessor
identities and independent reopen evidence are preserved. This is not A12/A72–A75
completion, a human-driven review, hardware approval or final art.
See [A71 scope and evidence boundary](docs/A71_EVENT_HALL.md).
