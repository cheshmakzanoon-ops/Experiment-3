# MotoGP cockpit and riding reference review

## Scope and source check

This pass reviewed all 100 images in the existing archive and applies selected
construction details. It does not claim 100 separate new features or a complete
reproduction of the reference game. The existing [100-row source ledger](../../MOTOGP_THREEJS_REFERENCE_REVIEW.md)
remains the source classification record: 65 direct MotoGP references and 35
context references. The pack contains store images, UI captures, gameplay/model/
track images, trailer frames, and crops; these are not 100 independent PS5 gameplay
captures.

The tracked 36,997,717-byte archive was read without modification. All IDs 001–100
are present and every image matches its manifest hash. All ten newly assembled
contact sheets were visually inspected; selected details were also opened at
their original resolution. Exact archive/manifest hashes and measurement results
are retained in [fork-crown-receipt.json](fork-crown-receipt.json). No reference
bitmaps or generated textures were added to the running game.

## Selected evidence and decisions

| Reference                      | Visible relationship                                                                                                        | Application in this pass                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| REF017, REF074, REF076         | Exposed metallic fork-crown annulus, contrasting central adjuster, and recessed mechanical construction in the rider's view | Replace GP crowns that hid their own adjusters with an open retaining ring, anodised hex, and physically recessed screw slot. |
| REF018, REF065, REF095, REF098 | Continuous leather sleeve/leg volumes and soft transitions around shoulders, hips, and bent limbs                           | Shared with the rider implementation; its own geometry and contact evidence establish that change.                            |
| REF052                         | Prelaunch rider feet resting on the road                                                                                    | Recorded as context; this crown change does not implement a stationary foot-dab pose.                                         |
| REF087                         | Rear chase and apparent front-lift attitude, with the front contact obscured                                                | Useful composition context, but insufficient to derive airborne-steering physics or coefficients.                             |

The photographs establish shape, material, and construction relationships. Crown
dimensions and physics coefficients remain authored values, not measurements
recovered from the images. The separate unloaded-front steering correction is
justified by a reproducible physics defect.

## The occlusion defect and correction

In baseline `7e535707db77f409d941b7776573b945964091ec`, the fork tube's closed top is
at local `y = 0.050 m`. Its opaque cap spans `0.045–0.075 m`, while the detailed
cap, hex, and screw finish at or below `0.0498 m`. Consequently those details
exist in the geometry but cannot be seen through the lid. The retained baseline
cockpit capture also shows plain dark disks at these positions.

`src/rendering/gp-fork-crown.ts` now creates a real annular retaining profile,
recessed seat, and exposed preload hex. High detail adds two screw-head segments
with a 1.6 mm slot and a floor 1.5 mm below the head. Mid detail keeps the annulus
and hex. All visible faces sit above the tube within the old 31 mm radius and
75 mm height envelope. Existing aluminium, anodised-fork, and dark materials
join the existing rigid steering batches. The camera, grip targets, fork travel,
steering articulation, and non-GP construction are unchanged by this correction.

Using the production onboard eye at the same settled pose and speed, the actual
old adjuster faces are visible at **0/12** sampled rays across both GP bikes;
the new faces are visible at **12/12**. Old rays stop 32.68–34.37 mm before their
targets. New target-to-hit error is at most `5.30e-9 m`. This compares each
version's actual adjuster surface; moving the exposed surface above the tube is
part of the fix, not a camera change.

## Geometry cost and verification

The table measures the steering subtree only, isolating this change from the
concurrent rider work. Both GP variants have the same steering inventory.

| Detail | Triangles before → after | Geometry bytes before → after |  Meshes | Distinct materials |
| ------ | -----------------------: | ----------------------------: | ------: | -----------------: |
| High   |          17,002 → 17,874 |         1,190,788 → 1,218,804 | 26 → 26 |            14 → 14 |
| Mid    |            5,596 → 6,076 |             308,056 → 321,432 | 13 → 13 |            11 → 11 |
| Far    |            1,116 → 1,116 |               69,304 → 69,304 | 11 → 11 |              9 → 9 |

The combined rider-and-crown high models measure 100,713 triangles for GPR1 and
93,012 for GPR2. Those combined totals must not be attributed solely to crowns.
Geometry-buffer and posed-transform hashes remain identical for all 12 road
model/LOD combinations (SBK1000, SS600, NR900, CR750 at high/mid/far), and for
both GP far models.

Focused validation passed **13/13 tests** in `gp-fork-crown.test.ts` and the
existing `bike-cockpit-view.test.ts`. The new tests raycast actual opaque
production geometry across both GP bikes, high/mid detail, static sag, brake
dive with steering, and rear loading with opposite steering. They also verify
an open ring bore, real slot recess, instrument visibility, unchanged source
poses, repeat/rewind determinism, and existing steering mesh counts. Reintroducing
the former opaque lid is an independent negative control and correctly blocks
the target. All sampled controls remain in frame; the lowest rear ring lip can
leave the frame during the extreme compressed/steered pose, as expected from the
unchanged camera. ESLint and Prettier checks passed for the authored files.

These are geometry, visibility, and deterministic-pose results. Final browser
captures, normal menu journeys, full application acceptance, and hardware
performance are separate integration evidence; this note does not claim them.

## Initial menu sky preparation

The baseline dry and wet journeys both stopped before GP selection. In the dry
trace, construction still showed 84% approximately 161 seconds after navigation;
the first retained 90% frame appeared approximately 170 seconds after navigation.
The raw message was `100% · Scene ready…`. That trace has no first-draw stage or
native fence observations, so it cannot attribute the remaining stall to a
specific GL call, the scheduler, or GPU execution.

Source inspection did reveal one definite cache mismatch: construction warmed
zero cloud cover, while the actual menu snapshot holds `Float32(0.12)`.
`MENU_CLOUD_COVER` now shares that exact value between the unchanged menu weather,
photographed-sky loading, and environment preparation, with the same lighting
mode and quality. This prepares the cloud field, cloud panorama, both PMREM bins,
and their blended radiance atlas before the first menu draw.

**14/14 scoped tests passed**: five new menu-sky tests, three existing menu-preview
tests, and six existing environment tests. With a stable sky asset key, lighting,
and quality, the cache test changes first-menu work from one PMREM capture, one
cloud-field bake, one panorama bake, and one atlas blend to zero of each. It also
catches the extra blend caused by using unquantized `0.12` during preparation.
Rasterization is mocked in these cache tests. Deadlines, GPU ownership gates,
and presented weather are unchanged; this is not proof that the observed
180-second startup acceptance failure is resolved.
