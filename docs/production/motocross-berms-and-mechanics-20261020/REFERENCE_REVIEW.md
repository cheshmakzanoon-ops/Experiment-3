# Motocross reference review: berms, mechanics and rider contact

## Provenance and coverage

Baseline: `468749bfc706283f7ba9b9a57752c32130d3959a`.

The original `Motocross_PS5_100_Developer_Reference_Images.zip` was recovered for this pass. Its SHA-256 is `d8c8fbb62974432e8feafa853917deb45765dccc18be7d1da8ece9be512a9c73`. All **100 original JPEG hashes** match both the archive's `REFERENCE_INDEX.csv` and the supplied hashes in the repository's [existing reference ledger](../motocross-reference-review-20261019.json). The existing ledger retains every filename, source URL and supplied description; it is not duplicated here.

The reference reviewer visually inspected all 100 originals on five labelled contact sheets, twenty images per sheet. Originals **001, 002, 005, 007, 042, 070 and 082** were also opened individually. The all-100 claim describes contact-sheet inspection and byte verification, not individually opened full-resolution inspection of every image.

These references are commercial motocross game screenshots and promotional images. They provide visual guidance rather than real-world measurements, physical calibration data, performance evidence or a licence to redistribute source artwork.

## Cues informing this pass

| References | Observation | Design application |
| --- | --- | --- |
| 001, 005 | Wheel spokes run in opposing directions between hub flanges and rim attachment points; nipples and shaped hubs are visible in close side views. | Review the MX wheels' spoke lacing, flange construction and rim attachments in [dirt-bike-model.ts](../../../src/rendering/offroad/dirt-bike-model.ts). These are original mechanical forms, not measurements traced from pixels. |
| 002, 007 | Recessed radiator surfaces sit behind spaced guards and the shrouds; hoses and layered mechanical parts occupy the lower frame. | Replace the solid-block appearance with depth, open guard framing and cooling connections while retaining the existing chassis and suspension attachment. |
| 002, 005, 070 | Raised elbows belong to an attack/start posture, while other poses have lower arms. Fabric maintains a continuous shoulder and bent-elbow silhouette, with folds concentrated around the joints. | Refine the rider's contact and sleeve transitions without treating every high-elbow pose as a defect. The original grip/peg targets remain the constraint, and the existing torso/armhole connection must continue through standing, braking and onboard views. |
| 007, 014, 022, 024, 029, 042, 046, 071 | Banked corners have distinct paths across their width. Riders use differing lean, body position and corner radii. | An original timed berm-practice activity encourages trying inside, middle and outside lines on the game's existing course. Timing and line validation come from simulation samples; target speeds and scoring are not inferred from a static screenshot. |
| 007, 042 | Flat, bright course markers have recognizable broad faces against the worked dirt. | Replace the cylindrical edge stakes with gently bowed, tapered plastic blades while preserving their existing placement, clearance envelope and shared instance budget. |
| 035, 042, 046, 050 | Worked dirt, ruts, banks and irregular shoulders make the course legible against surrounding terrain. | Preserve the existing worked-soil and course-shape work. These views inform track readability; they do not establish that a new verge shader or a new physical layout is necessary. |
| 082 | The large left motorcycle visibly has an expansion-chamber exhaust. | Retrospective visual support for the already implemented MX250 two-stroke distinction. That distinction is retained work, not a new feature of this pass. |

## Baseline comparison and limits

The baseline comparison used the committed [bike captures](../motocross-bikes-tracks-20261020/bike/) and [course captures](../motocross-bikes-tracks-20261020/course/) from the preceding pass. In `braced-front.jpg` and `helmet-and-gear.jpg`, the upper sleeves have an abrupt shoulder transition and angular elbow outline. Their existing armhole overlap is retained as a constraint for further changes. These are historical baseline captures, not new renders of this pass.

The preceding course fixture contains sampled local terrain patches; its documented distant gaps are a fixture limitation. They were not treated as proof that the production world has missing ground. References involving ATVs, UTVs, other biomes, menus, licensed branding or event spectacle remain contextual; no additional vehicles, branded assets or one-to-one source-venue reproduction is claimed.

The startup service-warmup correction is supported by the repository's session rules and preparation behavior, not by the image archive. Motocross motos disable pit service, whereas practice and time trial can still enable it. Reference fidelity does not justify skipping a required GPU completion gate.

No screenshot pixels or source sponsor artwork are added to runtime. This review establishes provenance and design traceability. Build, browser, contact, gameplay and performance validation belong to the final implementation report and are not implied by this document.
