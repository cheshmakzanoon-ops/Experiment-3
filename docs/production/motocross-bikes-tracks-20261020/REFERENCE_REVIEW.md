# Motocross reference review — 2026-10-20

This pass recovered the supplied **100-image motocross reference archive** and used it to refine bike construction, rider equipment and course identity. All 100 recovered JPEG hashes match the [existing source index](../motocross-reference-review-20261019.json). The images are commercial game screenshots and promotional images, rather than real-world photographs or physical calibration data.

## Provenance and review coverage

- Archive: `Motocross_PS5_100_Developer_Reference_Images(2).zip`.
- Archive SHA-256: `d8c8fbb62974432e8feafa853917deb45765dccc18be7d1da8ece9be512a9c73`.
- Original-image directory inside the archive: `Motocross_PS5_100_Developer_Reference_Images/`.
- Baseline source commit: `9cfeef8ef6ea050561b62d3db2ad2f22a52b3cd7`.
- The [compact audit](reference-audit.json) records all 100 original relative filenames, recovered hashes and review methods. Source URLs and supplied metadata remain in the [existing source index](../motocross-reference-review-20261019.json) and [reference map](../motocross-reference-map.json).

The reference auditor visually reviewed **five labeled contact sheets covering all 100 images**, then individually opened originals **004, 005, 011, 018, 035, 041, 042, 043, 044, 045, 049 and 059**. The bike reviewer independently confirmed individual-original inspection of **011 and 012**, plus the 001–020 contact sheet; that reviewer did not independently full-view 005. The rider reviewer confirmed individual-original inspection of **004, 005 and 011**. Thus, **13 distinct originals** received individually opened review across the team. The all-100 coverage claim refers to contact-sheet review and hash verification. Original 018 was opened later while checking for a two-stroke-specific exhaust reference; it remains context only, with no such attribution.

## Reference cues and design decisions

| References | Observed visual cue | Application in this pass |
| --- | --- | --- |
| 005, 011, 012 | Irregular cast cases, tapered mechanical members, attached housings and open frame spaces. | Split crankcase and scalloped covers, four-stroke water jacket/cam cover, coolant housing/routes, curved sump guard, tapered swingarms with axle slots, bored axle lugs and an open silencer passage. These are original modeled forms; dimensions were not measured from screenshots. |
| 004, 005, 011 | Compact helmet crown and chin, thin ridged peak, inset goggles, shaped boot shins/ankles and tapered toes. | Revised helmet shell and vented peak with attached supports; continuous boot calf/instep/toe, layered closures, protective panels, ankle relief and shaped sole; tapered glove fingers. |
| 004, 005 | Matte fabric and broad joint folds contrasted with hard helmet and boot surfaces. | Preserve the existing garment system and distinguish soft glove/cloth surfaces from the revised hard equipment. Retained garment work is not counted as new content. |
| 035, 041, 042, 044, 045, 059 | Fractured rock, talus and ridge silhouettes; open structures with bracing, feet and recognizable distant outlines. | Quarry massing at QUARRY, an original timber barn at BARN DOUBLE, and a braced viewing deck/canopy at SKY TRIPLE. Foundations follow the terrain and canopy supports meet the fabric. |
| 043, 049, 059 | Readable rhythm faces, banks, low lane-edge furniture and recognizable jump approaches. | Original physical approach boards reproduce the production course profile and surveyed takeoff/landing zone. Site planning reserves riding lanes, existing furniture, stands and selected camera sightlines. |

The bike implementation is in [motocross-castings.ts](../../../src/rendering/offroad/motocross-castings.ts) and [dirt-bike-model.ts](../../../src/rendering/offroad/dirt-bike-model.ts). Rider changes are in [motocross-gear.ts](../../../src/rendering/offroad/motocross-gear.ts), [motocross-rider-equipment.ts](../../../src/rendering/offroad/motocross-rider-equipment.ts) and [rider.ts](../../../src/rendering/rider.ts). Course geometry and placement are in [mx-course-landmarks.ts](../../../src/rendering/offroad/mx-course-landmarks.ts) and [mx-course-sites.ts](../../../src/rendering/offroad/mx-course-sites.ts).

The barn is an original Valley Ridge design. The quarry, deck and approach boards interpret the references' shapes, materials and composition; they do not reproduce branded source venues. The profile boards are a gameplay design decision, and their diagrams come from the same course profile used by the simulation.

## Scope of evidence

No reference screenshot pixels, sponsor logos or branded source models were added to runtime. New forms use procedural Three.js geometry; board artwork is generated from course data. Existing ground scan materials are separate from this screenshot archive. Static imagery does not establish real-world performance, physical impulses or recommended jump speeds. The later two-stroke powertrain correction is driven by the vehicle definition and authored mechanical layout; no specifically verified two-stroke screenshot is claimed here.

Historical baseline captures informed the initial comparison and are listed in the audit. They are not fresh renders of the baseline commit. The adjacent [geometry contact probe](geometry-contact-verification.json) records a focused construction check of the barn foundation, canopy contacts and landmark envelopes. Final build, gameplay and GPU validation are documented separately by the implementation owner.
