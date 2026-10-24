# W5 — GP circuit environment (worker id: w5-track)

Read `BRIEF_COMMON.md` first (same folder). This is your workstream.

## Mission
Make the GP venues look like real, used, photographed race circuits: dark rubbered asphalt,
crisp painted kerbs and run-off, real gravel and grass, believable trees and barriers.

## You own (GP-venue-gated)
`src/rendering/circuit.ts`, `circuit-finish.ts`, `surface-detail.ts`, `road-macro.ts`,
`asphalt-aggregate.ts`, `tyre-marks.ts`, `trackside.ts`, `trackside-weathering.ts`,
`track-boards*.ts`, `src/rendering/vegetation/*`, `src/rendering/ground/*`, GP surface entries in
`src/rendering/materials/*`, and visual-dressing fields for the GP venues in
`src/simulation/circuit-catalogue/motorcycle-gp.ts` (no layout/geometry changes that affect
physics or AI). **Not yours**: lighting/haze/grade (W1), bikes (W2), riders (W3), simulation (W4).
The same circuit code renders F1 and festival venues: **gate GP-specific looks to the
motorcycle-GP catalogue venues** (e.g. via the circuit definition's `bikeSafe`/venue/group), and
prove F1 circuits are unchanged.

## Targets (open these references full-size)
1. **Asphalt** — REF_003, 006, 019, 030, 031, 038, 046: darker, fine-aggregate surface with
   micro-sparkle in grazing sun, tonal patching/repairs, a darker rubbered racing line, heavy
   braking-zone rubber and **curving skid/black streaks** through corners (REF_003, 030), dusty
   lighter off-line edges, crisp white edge lines with slight wear. Kill any visible tiling.
2. **Kerbs** — REF_004, 025, 031, 044, 045, 047: flat GP kerbs, glossy paint with rubber
   smears, red/white and coloured variants, correct width and painted transition to run-off.
3. **Run-off** — REF_002, 004, 033, 044, 045: wide painted asphalt run-off bands (green, teal/blue,
   red-white stripe zones) beyond the kerbs; **gravel traps** with real gravel texture and soft
   edges where gravel meets asphalt/grass.
4. **Grass** — mowing stripes, colour/patch variation, near-camera blades at the verge (REF_019, 033, 046).
5. **Trees and hills** — REF_003, 005, 027, 044, 045: dense, volumetric tree lines (better
   impostors/normals/lighting response); the hills behind are forested, not flat cards. (Haze is W1.)
6. **Barriers and signage** — REF_001, 006, 007, 016, 042: air-fence modules and walls with
   printed partner graphics (fictional), catch fencing with posts, marshal posts, grandstand
   crowds that read as people at distance.

## Done means
Before/after live captures (chase + trackside) at Poggio Alto and one other GP venue at High and
Medium; an F1 venue capture proving no change; no new per-frame passes; texture memory noted.
