# MotoGP reference and start-grid review — 19 October 2026

## Evidence checked

The reviewer reopened every original numbered image in the tracked [100-image archive](../../../reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip). Ten fresh, labeled contact sheets displayed references 001–100 at up to 640 × 360 pixels each. REF 014 and REF 016 were also opened at their original resolution to inspect starting-box shape and rider arrangement. The temporary sheets are inspection artifacts; no reference-image copies are added by this pass.

The manifest contains exactly the sequence 001–100. Each image payload was hashed directly from the archive and all 100 SHA-256 values matched `MANIFEST.csv`. Archive SHA-256: `478517180397aa7022b508264e2e6383f721ea930a4035ef314e2e8fb421e7c6`.

| Manifest source group | Images |
| --- | ---: |
| Official PlayStation Store captures | 10 |
| UI, menus and HUD | 3 |
| Gameplay, models and tracks | 34 |
| Official trailer frames | 49 |
| Official-store detail crops | 4 |

The [existing image-by-image observations](../../MOTOGP_THREEJS_REFERENCE_REVIEW.md) remain the detailed source index. Fresh inspection confirmed these roles: **65 direct GP references and 35 contextual references**. Context includes minibikes, street/dirt machines, career scenes, promotional text, and cinematic closeups whose framing does not directly prescribe GP gameplay.

| Sheet reviewed | Direct GP references | Contextual references |
| --- | --- | --- |
| 001–010 | 001, 002, 003, 004, 006, 008, 010 | 005, 007, 009 |
| 011–020 | 013, 014, 015, 016, 017, 018, 019, 020 | 011, 012 |
| 021–030 | 021, 022, 027, 030 | 023, 024, 025, 026, 028, 029 |
| 031–040 | 031, 032, 033, 034, 035, 036, 037, 038, 039 | 040 |
| 041–050 | 048, 049, 050 | 041, 042, 043, 044, 045, 046, 047 |
| 051–060 | 052, 053, 055, 056, 058, 059, 060 | 051, 054, 057 |
| 061–070 | 061, 062, 063, 064, 065, 067 | 066, 068, 069, 070 |
| 071–080 | 071, 072, 073, 074, 075, 076, 077, 079, 080 | 078 |
| 081–090 | 082, 085, 086, 087, 088, 089, 090 | 081, 083, 084 |
| 091–100 | 094, 095, 096, 098, 099 | 091, 092, 093, 097, 100 |

This is coverage of the sources, not a claim that 100 new features were implemented. The previous rubber-path, wet-surface, circuit construction and ground-contact improvements remain in place.

## Specific track improvement

REF 014 and REF 016 show a staggered three-rider arrangement and short U-shaped front-wheel markings. REF 052 clarifies start spacing; REF 062 and REF 089 show restrained grid paint continuing along the pit straight. The prior source still painted 2.3 m × 4 m car boxes around the GP motorcycles.

The new GP marks are 1.30 m wide, with 0.70 m returns, 8 cm strokes and a 1 cm render separation from the asphalt. These visual dimensions are original choices guided by the photographs and the game's existing motorcycle dimensions; they were not measured from the source game. Each vertex follows the production track's elevation and bank. The marks use three non-overlapping quads, receive shadows and add no shadow-casting walls.

The GP paint and launch-rubber coordinates come from the same `gpGridSlot()` helper used by the real simulation. The longitudinal spacing comes from the [FIM's 22 June 2026 commission decision](https://www.fim-moto.com/en/news/news-detail/article/fim-grand-prix-world-championship-decisions-of-the-grand-prix-commission): three riders per row, a 4 m stagger and a 12 m repeat. [MotoGP's 10 July 2026 notice](https://www.motogp.com/en/news/2026/06/20/la-grille-de-depart-modifiee-a-partir-du-gp-dallemagne/1077438) confirms that layout taking effect in Germany. The lateral spread is an original, width-bounded placement choice. The screenshots establish the arrangement, not its numerical spacing.

Only an entirely GP field selects this arrangement. Other motorcycles, cars and mixed fields retain their original two-column starts and paint. Grid selection belongs to the whole snapshot field, independently of which vehicle is followed. The road shader uses a separate session-grid uniform and twelve packed rear-contact coordinates; it adds no textures or draw calls. Both GP prototypes have a 0.75 m rear-axle offset from their placement datum, so every launch path begins under its actual rear tire.

The two paint families share the original worn-paint material and retain at most two spatially culled layers. After their first construction, menu and replay switches change visibility without rebuilding geometry. Source: `src/rendering/grid-paint.ts`, `src/rendering/circuit.ts`, `src/rendering/studio/road-detail.ts`; shared placement and session selection: `src/simulation/gp-grid.ts`.

## Focused verification

- The seven `gp-grid-paint.test.ts` cases and seventeen existing `road-detail.test.ts` cases passed. They cover actual simulated rear-contact coordinates, graded paint geometry and upward normals, exact original car/road-bike attribute buffers, independent field/followed-vehicle selection, 90 layout changes, retained geometry and material ownership.
- `e2e/gp-start-grid.spec.ts` passed on an observed **SwiftShader WebGL2** adapter. Dry and wet held frames matched their respective hashes; returning to each original layout restored its original pixels; the GP launch layout visibly differed from a control retaining old two-column launch paths. Browser and GL error counts were zero.
- The controlled Poggio Alto road/paint view used **4 draw calls** for both layouts. Submitted triangles changed from **2,336 to 1,976**; paint itself changed from **432 to 72 triangles**. The retained GP paint geometry occupies **5,040 bytes**. The fixture's resources remained at **6 geometries, 4 textures and 2 programs** across the complete sequence.
- The original-grid and GP-grid images were visually inspected. The new compact marks form three diagonal columns and retain asphalt between the stamps, with corresponding single-contact launch paths.
- TypeScript `--noEmit` and ESLint over the changed rendering and focused-test files passed.

The isolated view contains production road and paint components. It is not a complete venue image, a driven race, or a physical-device performance measurement. Full-application integration and other agents' model/handling changes require their own final verification receipts. The first browser attempt rejected a malformed new shader-hook key before rendering; that key was corrected, and both subsequent focused browser runs passed.
