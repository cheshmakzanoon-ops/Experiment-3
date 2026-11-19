# Road contact ownership at overlapping runoff ribbons

The circuit collision mesh extends up to 35 metres from the centreline to provide road shoulders and runoff. Around a tight hairpin, that auxiliary ribbon can cross the road on the opposite leg. A nearest triangle raycast previously treated the overlapping runoff as another physical road deck. The road motorcycle's new suspension correctly responded to the resulting false height step, which exposed the geometry error as a launch and pitch crash.

## Reproduced failure

The unchanged Ardennes GP race with seed 1000 produced this front-contact query at 21.708333 seconds:

| Quantity                            |               Observation |
| ----------------------------------- | ------------------------: |
| World contact X                     |       596.7179217552888 m |
| World contact Z                     |      1154.1124977119468 m |
| Actual local road station           |              362.398509 m |
| Actual lateral position             |                0.450027 m |
| Local asphalt triangle height       |      3.3190813810431576 m |
| Incorrect selected height           |      3.4574170550967267 m |
| False step                          |      0.1383356740535691 m |
| Incorrect triangle's source station |              310.357910 m |
| Distance to that source centreline  |               34.049906 m |
| Incorrect mesh band                 | 13, the outer runoff band |

When the rear wheel reached that false patch, the trace recorded a 116,368.94 N rear support load. The bike launched, rotated nose down in flight, and triggered the existing pitch crash condition near station 374. The source road was gently descending; this was not a physical crest demanding a speed cap or spring retune. The original first 40 seconds produced four rider falls. The corrected query produced zero for all four riders.

## Geometric correction

`TriangleBVH` accepts an optional contact ownership predicate. It evaluates the actual triangle hit point before replacing the current nearest distance. A rejected auxiliary patch therefore cannot prune a legitimate surface behind it. Generic BVHs without a predicate retain their previous behavior.

`TireFootprint` applies the same predicate to its actual face, edge or vertex support point. A car's finite tire crown cannot recover the false surface that the centre ray rejected. The test uses the contact point rather than the wheel centre or ray origin, so oblique rays and edge contacts obey the same rule.

The production `TrackContactMesh` provides the predicate:

- Core asphalt, paint at the road edge, and kerb triangles keep ordinary geometric nearest-hit selection.
- Broad painted shoulders cannot cover another local road/kerb corridor.
- Outer runoff cannot cover another local road/kerb/shoulder corridor.
- The existing height-aware nearest-route query identifies the layer. Genuine upper and lower core road decks keep their geometry and ordering.
- Ownership uses horizontal distance to the actual closest centreline point, including at tight corners. A 0.1 micrometre boundary tolerance handles floating point seams; heights and forces are never blended or clamped.

No road height, spring rate, damping, gravity, available grip, crash threshold, AI speed limit, or tire law was changed by this fix. Off-ribbon ray misses remain misses so existing callers retain their fallback policy. The mesh vertices, triangle count, BVH construction and runoff rendering are unchanged.

## Verification

`tests/road-contact-ownership.test.ts` adds eight tests covering:

1. Rejected nearer candidates without hiding valid deeper surfaces, including oblique and upward rays, finite reach and a real miss.
2. Shared ownership for finite crown face, edge and vertex contacts, with an unfiltered raised-patch negative control.
3. The exact Ardennes coordinate above, with an unfiltered raw BVH proving the incorrect 13.8 cm raised triangle is present.
4. A 401-point, 2 cm-spaced sweep through stations 359–367, with no holes, less than 1 mm successive height change and matching car-tire support. The unfiltered geometry exceeds 15 cm of false height along this sweep.
5. Both actual nearby road legs plus valid kerb, paved shoulder and outer runoff contacts away from overlap.
6. An oblique ray through the actual failure location and the finite ribbon's outside boundary.
7. All four contacts of the production car across the former step, with continuous local road height and all 1,200 observed wheel steps supported.
8. Both decks of the real nine-metre figure-eight overpass, including finite crown support and the upper deck's nearest-hit priority.

The combined targeted run passed **58 tests in seven files**: the new ownership tests, existing BVH/contact tests, tire-footprint tests, continuous road-bike contact tests, road-bike suspension tests, production road-contact tests, and the overpass route integration. This preserves the separate fast crest, ballistic flight, zero airborne tire force, landing, momentum, braking-load and timestep consistency checks. TypeScript, scoped ESLint and formatting also passed.

The separate GP integration reviewer reran the unchanged seeded hairpin gate against this surface fix and its own control corrections. Those race results belong to the full physics integration report; this document does not substitute the local 40-second reproduction for full-race acceptance.

## Query cost

A local Node CPU probe used the unchanged Ardennes mesh, 512 stations, warmed queries, five alternating trials of 20,000 casts per case, and the same output/sample path with ownership enabled or disabled. These measurements describe this execution environment and are not a game frame-rate or physical-GPU benchmark.

| Probe                                       | Previous median |   Owned median | Additional nearest-route calls per 20,000 casts | Global route scans | Misses |
| ------------------------------------------- | --------------: | -------------: | ----------------------------------------------: | -----------------: | -----: |
| Road, offsets 0 and ±3 m                    |  4.071 µs/query | 4.289 µs/query |                                              65 |                  0 |      0 |
| Road and runoff, also offsets ±10 and ±20 m |  5.502 µs/query | 6.173 µs/query |                                          19,979 |                  0 |      0 |

Mean tested triangles were 24.481 to 24.495 for the road probe and 23.355 to 23.393 for the mixed probe. Core road/kerb candidates bypass the spatial query; only an actual candidate in a broad auxiliary band needs ownership resolution. The predicate and scratch track point are allocated once per mesh. This adds no contact-query objects; the existing `Track.nearest` helper retains its own spatial-hash lookup and allocation behavior.

## Limits

This assigns priority to paved road corridors where auxiliary ribbons overlap them. It does not remesh the rendered runoff, resolve every overlap between two distant runoff patches, add swept body collision, or change the established route layer separation rule. Future terrain tessellation can eliminate such redundant auxiliary geometry entirely. The narrow ownership rule protects the physical driving surface now, while retaining real bridge decks and legitimate road features.
