# Vellamar Coast Circuit

An original coastal-mountain Grand Prix circuit. It is not a copy or trace of
any real venue. Every system reads the same `CircuitDefinition`
(`src/simulation/circuits.ts`) through `Track`: the contact ribbon, rendered
road and kerbs, collision boundary, AI racing line and braking envelope,
sectors, lap validity, the water/rubber grid, grid slots, pit lane, venue
placement, terrain blend and the minimap. Aurel stays the default and is
byte-identical to its former hard-coded profile (tested).

Select it from the main menu (`Circuit` row) for any mode. The choice is
validated like every other session option (`validateOptions`), and unknown
values fall back to Aurel.

## Layout

| Quantity | Value |
| --- | --- |
| Lap length | 3,997 m |
| Elevation | 2.0 m (coast straight) to 45.1 m (ridge) |
| Steepest grade | 6.9 % (Oliveto climb, s ≈ 1,497 m) |
| Authored banking | up to 4.7° (Ridge Sweep, Lantern) |
| Track width | 15.2–16.2 m |
| Sectors | thirds of the lap, as on Aurel |

| Corner | Lap distance | Apex radius | Character |
| --- | --- | --- | --- |
| T1 Faro | 1,030 m | 33 m | Heavy stop at the end of the coast straight under the lighthouse headland |
| Ascent | 1,262 m | 48 m | Uphill switchback into the climb |
| Oliveto | 1,560 m | 74 m | Climbing left through the olive terraces |
| Ridge Sweep | 1,751 m | 151 m | Fast banked left onto the ridge |
| Belvedere | 2,999 m | 24 m | Hairpin at the summit, the slowest corner |
| Cascata | 3,195 m | 39 m | Downhill esses |
| Lantern | 3,490 m | 354 m | Long banked descending sweeper |
| Marina | 3,813 m | 223 m | Kink onto the coast straight past the yacht club |

Sector 1 is the flat coast straight, T1 and the start of the climb. Sector 2 is
the climb and the fast ridge. Sector 3 is the summit hairpin and the descent back
to sea level.

### Shared paddock template

The six control points around the start line are a rigid copy of Aurel's pit
straight. Catmull-Rom splines are affine-invariant, so the pit lane, garages,
grid slots, box positions and the authored A21 pit-building frontage sit on the
same pit-straight curvature. `pitBuildingLayout` places the A21 bays on Vellamar
within `A21_BAY_TOLERANCE` (0.12 m, 0.02 rad). The test checks this, and still
requires Aurel to match exactly.

## Venue

`src/rendering/venue-plan.ts` holds each circuit's authored content in lap
distance and side. The same clearance, footprint, ground and waterline rules
apply to both circuits:

- **Grandstands** at the start/finish, T1 Faro, the Ascent, Belvedere, Cascata
  and Lantern.
- **Service areas**: recovery at 1,150 m, 2,420 m and 3,420 m; maintenance at
  1,720 m, 3,040 m and 3,700 m. Each one resolves at its authored distance and
  side (tested).
- **Districts**: Faro concourse, Oliveto works, Belvedere terrace and the
  Marina yacht club. The plazas terrace up to 3.5 m of relief and are rejected
  below the waterline.
- **Landmark**: an original tapered masonry lighthouse on the headland beyond
  T1, with a lamp that the venue night lighting drives
  (`src/rendering/venue-lighthouse.ts`).
- **Planting**: umbrella pine, cypress and olive character zones.
- **Signage, braking boards and gantry**: 50/100/150 m boards before T1,
  Oliveto, Belvedere and Cascata. The gantry reads `VELLAMAR / COAST CIRCUIT`.

### Terrain and sea

`src/rendering/terrain.ts` builds a natural landform: a sea shelf south of an
irregular coastline, an inland slope, rolling hills, a ridged mountain range and
the T1 headland. It blends to the road over 185 m, so terrain never rises within
0.9 m of the road surface (tested around the whole lap). The sea
(`src/rendering/sea.ts`) is a physical-material water plane with a tiled wave
normal map at datum 0. Trees, districts, services and the lighthouse are all
rejected below the waterline.

## Race evidence

`scripts/vellamar-race.ts` runs a 10-car, 3-lap race through the production
simulation, AI, pit service and race control. It uses no teleport, grip bonus
or pose override, and writes `docs/vellamar-race.json`.

| Weather | Result |
| --- | --- |
| Clear | Every car finishes. Best lap 80.99 s, top speed 297 km/h, no penalties, zero impacts |
| Changeable | Every car finishes, and every car physically enters the pits and fits wet-weather tyres when the storm arrives |

The changeable run first exposed an AI defect. With the whole field pitting on
the same lap, a car that had yielded to a pit-bound rival scored the pit-entry
lane as a "slow car ahead" overtaking penalty. It stayed out of the lane and
missed the entry. `TrafficPlanner` now lets a car queue in the destination
corridor during a pit approach, and the swept separation test still decides
safety. The Aurel physics, classification and pit suites still pass.

## Open items

- The lighthouse, sea, districts and planting are procedural runtime geometry,
  not Blender-authored assets with editable sources. The matching 3dmodels.md
  rows stay open.
- The coastline and mountain silhouette need human art review. Section 146
  acceptance is not claimed.
- Hardware frame times on Vellamar have not been measured. The browser captures
  here use software rendering (Mesa llvmpipe) and say nothing about GPU
  performance.
