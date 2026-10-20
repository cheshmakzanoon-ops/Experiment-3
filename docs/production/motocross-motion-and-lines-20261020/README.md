# Motocross motion, materials and corner-entry lines

This pass connects the rider's body, helmet, cloth and front brake lever to the existing presented bike state, separates cast engine finishes from polished metal, and adds three physical worked entry lines with smoother alternatives. It extends the existing MX250/MX450 and Valley Ridge/Arena Nord content through Three.js geometry, shaders and the shared course simulation.

- Initial checkout: `2618e1016319e694a871fff5c8ad25dd154d5de7`.
- Final integrated upstream base: `ca9e09861a7fa8b5dfc73dda7b5fad626294512d`, retaining the concurrent MotoGP and Festival work, GP rider animation, and upstream off-road suspension equilibrium and reference-geometry corrections. The final course integration uses physics version **16**.
- Final integrated source fingerprint: `d4bc1b881f2e2c81ceff1adce8f30824df7ef3615ad29eb05904cebc9050ff27`; individual changed-file hashes are in [source-manifest.json](source-manifest.json).
- Earlier source boundaries remain separate: [physics-integration-source-manifest.json](physics-integration-source-manifest.json) identifies `3410e58` / `ce20e4…dd19`, [gp-integration-source-manifest.json](gp-integration-source-manifest.json) identifies `c4f674e` / `98f5ce…feeb2`, and [preintegration-source-manifest.json](preintegration-source-manifest.json) identifies the earlier `54c886d` visual captures.

## Riding changes

The worked entry asks the player to manage suspension movement before a corner; the parallel smooth line gives a more settled approach. This makes line choice matter without adding another mandatory jump or changing the existing surveyed jumps. The intended benefit is a more varied approach to the same corners, not a claim that one line is always faster.

| Venue | Entry | Authored length | Maximum raised height | Typical crest spacing |
| --- | --- | ---: | ---: | ---: |
| Valley Ridge MX | QUARRY ENTRY | 28 m | 0.100 m | 3.8 m |
| Valley Ridge MX | SKY BERM ENTRY | 26 m | 0.085 m | 3.6 m |
| Arena Nord SX | STAGE TURN ENTRY | 24 m | 0.065 m | 3.4 m |

These are original gameplay dimensions, not measurements from reference images. Ridge phase bends slightly across the worked line, heights vary, and the relief fades smoothly at its entry, exit and lateral edges. The opposite line remains outside the new bumps' support. The existing small chop also gains a smooth fade at its rough-span boundaries and the track edge.

Physics and rendering sample the same relief function and analytical slopes. A static terrain attribute carries its worked footprint and raised height into restrained clay colour/roughness changes. Mesh silhouettes and normals supply the visible relief. Existing automatic standing recognises the new longitudinal rough spans, including their smoother parallel line; the physical bump height remains specific to the worked line.

Use **OUTDOOR MX** / **STADIUM SX**, select **MX–250** or **MX–450**, and compare the two approaches to these entries. Existing course landmarks, jump boards, riding controls and practice feedback remain relevant to reading the lap.

## Rider and control animation

The final integration retains the upstream fixed chassis reference, fork travel and rigid swingarm. The recorded sprung root supplies chassis heave and pitch; the rendered body stays rigid to that root while the wheels articulate. Recorded vertical front-wheel travel is converted into stroke along the raked fork. The rear axle follows the swingarm's circular arc, keeping the arm and chain at fixed length. In the simulation, current load and preload change static spring equilibrium while the suspension reference geometry stays fixed.

Suspension travel beyond the factory reference sag drives a bounded standing brace: the pelvis lowers by up to 6.5 cm, moves slightly rearward, and the torso and elbows adjust while the existing inverse kinematics solves the limbs. Seated hips retain their saddle position. This is an authored pose response to the suspension snapshot, not a second body simulation or a measured biomechanical model.

Gaze reads chassis pitch from the authoritative rendered root quaternion. Suspension travel separately drives the rider's compression response. The helmet partially compensates for that root pitch and has stronger counter-roll, helping its gaze remain directed along the next section. It still follows steep takeoffs and landings. Pitch, compression and joint transforms are evaluated from the current sample, with no independent animation clock or spring history; the airborne flag does not introduce a discrete pose switch.

Near and medium sleeves and pants have one fixed crease morph each. Its influence follows the solved joint bend, gathering cloth inside the elbow/knee while keeping the outer panel and cuff quiet. Existing skinning carries the result with the rider. This adds static morph position/normal storage, not new triangles or a per-frame CPU cloth solve.

The high-detail right brake blade and terminal now rotate together around their inboard pivot, pulled by the recorded front brake input. Rear brake input is independent. Steering, suspension and rigid batching preserve the lever's articulation. The clutch remains static because the presented bike-pose contract has no clutch channel; the global player input system still has its existing manual-clutch binding. This is lever articulation, not a new finger-squeeze system.

The rider/control changes use the shared off-road model path. Dedicated cast materials and their new microfinish are limited to the motocross bike branch.

## Engine material separation

Dedicated aluminium castings and magnesium covers have darker, rougher base finishes, distinct from polished fork tubes and the existing brushed frame. The new cast shader adds subtle grain, pits and broad reflectance variation in metre-space coordinates. Fine detail fades with pixel footprint to limit distant shimmer.

The authored grain scale is 1.25 mm, broad variation approximately 18 mm, and nominal height scale 12–20 micrometres. These are shading design values, not recovered surface measurements. The shader adds no texture, geometry, animation state or draw. It is installed at near/medium detail; distant models retain the revised base materials.

Dry finish changes precede deposited mud. Both dedicated case materials are tagged for the existing recorded-weather response as `metal` with exposure `0.4`, an authored partial-shelter approximation. This preserves separate mud and weather inputs without claiming simulated shelter, material saturation or fluid simulation. The shared exhaust retains its existing heat-tinted finish.

## Original reference provenance

- Archive: `Motocross_PS5_100_Developer_Reference_Images(2).zip`.
- SHA-256: `d8c8fbb62974432e8feafa853917deb45765dccc18be7d1da8ece9be512a9c73`.
- Original directory inside the archive: `Motocross_PS5_100_Developer_Reference_Images/`.
- All **100 original JPEG hashes matched** the [existing source index](../motocross-reference-review-20261019.json). Original filenames, source URLs and supplied metadata remain in that index and the [reference map](../motocross-reference-map.json).
- This pass's reference auditor visually opened **five labelled contact sheets covering all 100 images**, then individually opened **10 originals: 004, 005, 011, 024, 031, 043, 046, 047, 072 and 092**. All-100 coverage means contact-sheet review plus hash verification; it does not mean 100 individual full-image inspections.

The archive contains commercial motocross game screenshots and promotional images. It guides proportions, material contrast, pose composition and riding readability. Static imagery does not establish physical dimensions, braking as the cause of a depicted ridge, motion timing, real-world handling or biomechanics. Prior-pass review coverage is recorded separately in [REFERENCE_REVIEW.md](../motocross-bikes-tracks-20261020/REFERENCE_REVIEW.md).

| Original IDs | Observed cue | Application or scope |
| --- | --- | --- |
| 005, 011 | Duller irregular engine cases contrasted with narrow polished highlights. | Cast aluminium/magnesium separation; preserve polished tubes. |
| 004, 005, 024, 092 | Broad fabric panels, continuous shoulders and local compression folds. | Bend-dependent inner creases; retain the earlier shoulder construction. |
| 005, 011, 024, 031 | Flexed limbs and torso/head orientation distinct from bike attitude. | Bounded suspension brace and partial gaze compensation; no measured response-rate attribution. |
| 043, 046, 072, 092 | Worked lines, broken ridge highlights and smoother parallel passages. | Physical entry relief with a quiet alternative and shared surface shading. |
| 047 | Track readability within a quieter outdoor surround. | Retained environment context; no new forest or venue content claimed. |

No screenshot pixels, sponsor artwork or branded source models were added to runtime. Existing ground scans are separate from this reference archive. This pass does not claim photographic parity with the source games.

## Validation and evidence

Current checks apply to `ca9e098` / `d4bc1b…ff27`, physics **16**. **62 tests across six files** and **18 freshly measured controlled traversals** passed after integrating the corrected suspension equilibrium and reference geometry. Content validation, lint, the full TypeScript check and the final production build all exited successfully; the build fingerprint matches the final source exactly. **All three current GPU cases passed**, producing ten captures with no unexpected or flaky cases. Source-gate evidence is recorded separately in [final-validation.json](final-validation.json), and GPU execution, metrics and capture provenance are in [gpu-v16-validation.json](gpu-v16-validation.json).

| Check | Status / evidence | Scope and limit |
| --- | --- | --- |
| Final suspension, rider and identity tests | **PASS: 62/62 tests in 6 files** | Reference geometry 10; sprung pose 19; rider motion 6; control animation 4; lever contact 4; simulation identity 19. These are the tests rerun on the final version 16 source. |
| Recorded track comparisons | **PASS: 18/18 traversals**, 9 worked/smooth pairs; [track-validation.json](track-validation.json) | Fresh version 16 results: all completed with zero crashes. MX450 at 9 m/s and both bikes at 13 m/s traverse all three entries with the same scripted controller and AI/NOVICE aid profile. Maximum worked-line fork range is 88.783027 mm; maximum sampled airborne time is 7/240 s, with zero airborne ticks on the quiet lines. These are controlled entries, not manual full laps. |
| Content validation | **PASS**, exit 0 | Repeated on the final source; completed in 17.704 seconds. Exact command and exit evidence are retained in final-validation.json. |
| Typecheck and lint | **PASS:** full `tsc --noEmit` and ESLint on 22 changed TypeScript files, both exit 0 | Repeated after the final `ca9e098` integration. ESLint completed in 30.262 seconds and TypeScript in 548.035 seconds under shared load. These durations describe validation, not runtime performance. |
| Final production build | **PASS**, exit 0 | Vite completed in 222.514 seconds. The output's build fingerprint exactly matches `d4bc1b…ff27`; see final-validation.json for the source-gate receipt. |
| Final version 16 GPU fixtures | **PASS: 3/3 cases, 10 captures**, actual process exit 0; [gpu-v16-validation.json](gpu-v16-validation.json) | MX250 high/mid/far geometry, MX450 onboard visibility and contacts, and reversible suspension/gaze/lever poses at 1280×800 on verified SwiftShader. All ten captures had finite geometry and GL error 0; page/console error assertions passed. Maximum hand/ankle error was 2 cm within the 3 cm contract. This exercises the production bike-model fixture, without a live race worker or venue traversal. |

The unchanged traversal runner was executed once on version 16. Its prior receipt is preserved as [physics-v15-track-validation.json](physics-v15-track-validation.json). Across the comparison pairs, the largest change in measured fork range was 0.009615 mm and the largest change in front-force range was 0.004766 N; completion, crash and sampled-airborne counts were unchanged. These comparisons use new measurements rather than carrying version 15 values forward.

### Historical evidence

[validation.json](validation.json) retains the completed checks at the earlier `ce20e4…dd19` and `98f5ce…feeb2` boundaries. Their test counts overlap the current checks and are not added to the final 62-test count. The completed full-application journey remains tied to its version 15 source; it was not rerun as a full journey after the version 16 suspension and model changes.

| Earlier check | Recorded outcome | Source and scope |
| --- | --- | --- |
| Physics and feature checks | **PASS: 123 tests across 12 distinct files in two clean invocations** | `3410e58` / `ce20e4…dd19`: 75 feature tests in eight files and 48 kinematics/control tests in four disjoint files. Details remain in validation.json. |
| Shared-rider integration and source gates | **PASS: 25 tests in 4 files**, content validation, lint, typecheck and production build | `c4f674e` / `98f5ce…feeb2`, recorded separately in validation.json and [gp-integration-source-manifest.json](gp-integration-source-manifest.json). This predates the final off-road suspension integration. |
| Earlier GPU fixtures | **PASS: 4 cases, 13 captures**; [gpu-metrics.json](gpu-metrics.json) | `54c886d` / `6d6a739…47b7d`: MX250 high/mid/far, MX450 cockpit and reversible compression, and three entry lines. All GL codes were zero. Contact error was 2 cm within the 3 cm contract; mesh interpolation error was at most 1.21 cm. These captures predate the version 16 bike geometry. |
| Earlier full-application journey | **FAILED / incomplete**, exit 1 at 1440×900, Low/Mesa; [preintegration-gameplay.json](preintegration-gameplay.json) | `54c886d` / `6d6a739…47b7d`: Valley completed riding, camera, pause and return. Arena passed progress/flight/touchdown checks, then its chase screenshot timed out after 60 seconds before the camera/pause/return flow. The cause remains unresolved. |
| Completed full-application journey | **PASS**, exit 0: both venues at 960×600, Low/Mesa; [gameplay-validation.json](gameplay-validation.json) | `3410e58` / `ce20e4…dd19`: player inputs, explicit AI handover, progress, flight/touchdown, chase/cockpit, pause and return, plus the final error check. Valley progress was 274.14 m; Arena 151.89 m. This establishes the recorded version 15 journey. It does not establish final version 16 full-journey behavior, hardware FPS, or the cause of the earlier higher-resolution timeout. |

The terrain mesh retains 0.5 m lateral / 1 m longitudinal spacing; its interpolation between rows is checked within 2 cm of the smooth contact field, not claimed pointwise identical. New terrain shading adds an 8-byte attribute per vertex. Cloth morphs add static GPU storage. No overall frame-rate or memory improvement is claimed without runtime measurement.

The inherited generic chop formula is not periodic at lap zero; current authored rough spans are unaffected. The new braking-bump sampler itself supports continuous wrapped spans. This is an authoring limitation for future generic rough spans, not evidence of a seam in these three entries.

## Main implementation

- [Rider pose response](../../../src/rendering/offroad/motocross-rider-motion.ts), [rider integration](../../../src/rendering/rider.ts) and [garment morphs](../../../src/rendering/offroad/motocross-gear.ts).
- [Bike integration and lever](../../../src/rendering/offroad/dirt-bike-model.ts) and [cast-metal finish](../../../src/rendering/offroad/motocross-metal-finish.ts).
- [Suspension reference and static equilibrium](../../../src/simulation/offroad/suspension-geometry.ts) and [production off-road vehicle](../../../src/simulation/offroad/dirt-bike-vehicle.ts).
- [Physical bump field](../../../src/simulation/offroad/braking-bumps.ts), [course integration](../../../src/simulation/offroad/course.ts) and [entry authoring](../../../src/simulation/offroad/venues.ts).
- [Terrain attributes](../../../src/rendering/offroad/terrain-view.ts) and [worked-line shading](../../../src/rendering/offroad/mx-braking-bumps.ts).

## Rendered evidence

The final version 16 capture, [rider-compressed-v16.jpg](rider-compressed-v16.jpg), shows the production MX450 rig in a controlled pose elevated **0.3 m above the inspection floor**. The fixture sets pitch to 0.22 rad, adds 0.13 m to both fork and shock compression, and applies front brake input 0.8. It is a posed inspection image, not a simulated landing or track screenshot. In the same production instance, the relaxed/compressed/repeated/rewound sequence produced a 39.97 mm pelvis drop and 0.16 rad lever pull, with identical repeated and rewound PNGs and unchanged resource counts. [gpu-v16-validation.json](gpu-v16-validation.json) records the exact source, software renderer, metrics, original PNG hash and delivered JPEG hash. The JPEG retains the original 1280×800 resolution.

The images below were captured on the earlier `54c886d` integration with source fingerprint `6d6a739e1de29593f9f5262c46f655edb73530a5ad2b3239f043f592c6e47b7d`. They document the materials, rider presentation and track lines at that source boundary. Final bike rendering changed with the version 16 chassis and suspension integration, so these images do not represent the final articulated geometry. They are JPEG encodings at their original resolution; [capture-provenance.json](capture-provenance.json) records the original PNG and delivered-image hashes.

| Capture | Inspection purpose |
| --- | --- |
| [MX250 high detail](mx250-high.jpg) | The actual two-stroke model, rider and case materials in controlled inspection lighting. |
| [Relaxed rider](rider-relaxed.jpg) / [compressed rider](rider-compressed.jpg) | Same production model and camera, changing suspension and front brake. The fixture holds the bike 0.3 m above its floor for pose inspection; these are not simulated landing frames. |
| [Quarry Entry](quarry-entry.jpg) | Valley Ridge physical worked line and its smoother parallel passage. |
| [Stage Turn Entry](stage-turn-entry.jpg) | Arena Nord physical entry relief within the existing stadium components. |
| [Valley Ridge live riding](valley-ridge-live.jpg) | Normal application, eight-rider session, low quality selected through the settings UI; player controls followed by the explicitly enabled AI demonstration. This capture belongs to the earlier source and does not establish high-quality performance. |
