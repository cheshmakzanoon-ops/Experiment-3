# MotoGP: carbon brakes, fitted gloves and course bridges

This pass adds procedural Three.js detail to the existing GP-R1 and GP-R2,
a recognisable approach landmark to each dedicated GP circuit, and more useful
traffic guidance while leaning. It builds on the formed bodywork, leather
materials, boots, course boards and barrier covers from
[the preceding pass](../motogp-course-and-machines/README.md).

## Reference grounding

The repository already contains the 100-image MotoGP26 archive and an
[image-by-image review](../../MOTOGP_R5_REFERENCE_REVIEW.md). This pass uses that
existing review and its identified visual features. The original image pixels
were not reopened in this execution environment; this is not a new claim of
100 freshly inspected images.

| Existing reference observations | Implementation |
| --- | --- |
| REF003/060/086: distinct friction band, carrier and brake hardware | Solid carbon annulus, open six-web carrier and floating bobbins |
| REF057/073/076: close-fitting fingers, gauntlet and molded knuckle protection | Fitted GP gloves with unequal finger wraps and mirrored thumbs |
| REF034/062/063/077: substantial overhead course architecture | Original truss bridges with venue identity, grounded supports and clear span |
| REF077/090: a nearby rival and two riders abreast | GP traffic cues derived from actual relative positions and road heading |

Photographs provide appearance and construction cues, not calibrated dimensions.
The 8 mm carbon-disc thickness is grounded in
[Brembo's 2024 MotoGP technical release](https://www.brembo.com/en/ComunicatiStampa/2024/20240304-PR_Brembo_MotoGP_Moto2_Moto3_World_Championship_2024_ENG.pdf).
Carrier windows, glove tailoring and bridge dimensions are original authored
geometry. The changes add no downloaded textures, external model loads or
runtime dependencies.

## Bikes and riders

The previous GP front disc was a 22 mm thick drilled rotor with separate bobbin
cylinders. The new assembly has a 340 mm outer diameter and an 8 mm solid carbon
friction band. A connected six-web carrier has real open windows and an axle
bore; hollow bobbins bridge the carrier and the friction material. High and mid
detail retain this structure, while far detail uses the carbon annulus alone.

The existing radial caliper jaws move inward by 7 mm on each side so their pad
faces meet the new disc faces. The rear housing bridges also move outside the
spinning friction band's envelope. Calipers stay with the fork lower; discs and
carriers use the existing wheel-spin node. Steering, fork travel, brake input,
wetness and replay continue to use the recorded production pose.

The new GP gloves replace the rounded-box palm and repeated finger tubes with
a fitted palm/gauntlet, differently sized wrapped fingers, a medial thumb and
a shaped knuckle bridge. They retain the existing wrist and grip anchors and
reuse the rider's materials. The non-GP glove path remains separate.

| Per-part construction | High detail | Mid detail | Far detail |
| --- | ---: | ---: | ---: |
| One front rotor assembly | 2,024 triangles / 3 material meshes | 1,288 / 3 | 128 / 1 |
| One GP glove | 1,752 triangles / 3 material meshes | 820 / 1 | Existing far glove |
| Previous GP glove | 1,912 triangles / 3 material meshes | 1,212 / 1 | Existing far glove |

Rotor parts join the existing rigid wheel batches. The high-detail pair of
rotors adds 1,088 triangles; the pair of gloves removes 320, for a combined
768-triangle increase per complete high-detail GP model. These are geometry
inventory measurements, not GPU frame-rate measurements.

## Circuit identity and racing guidance

Poggio Alto, Cape Wrenna, Haarveld and Montejaral each receive one original
overhead truss bridge on a verified straight approach. The bridge gives the
approach a recognisable silhouette and carries the course identity. Its
supports sit outside the physical track boundary; placement excludes pit
facilities, other track sections and occupied spectator/venue footprints.
The span preserves 6.7 m of road clearance.

Each bridge is a locally culled, five-material assembly. It does not introduce
a collision obstacle into the riding surface. The existing corner distance
boards remain available as precise approach references.

GP proximity now uses a normalised horizontal heading instead of the rolled
body's compressed lateral axis. The left/right interpretation follows the
motorcycle coordinate convention, with motorcycle-sized overlap ranges. This
keeps nearby-rider arrows useful during deep lean. The riding guide consumes
the same result, so an alongside opponent takes precedence over draft/pass
advice. Existing marshal and tyre warnings retain their priority.

## Validation and limits

The execution environment provided no usable shell or WebGL browser. A
temporary Vercel sandbox request was denied. Consequently this pass does not
claim a local TypeScript build, npm/Vitest run, screenshot review or full-game
performance result.

The brake geometry was executed in isolated V8 using the real Three.js r180
CommonJS distribution and its official geometry-merge implementation. Only
TypeScript annotations were removed from the standalone modules; a minimal
assertion runner executed the seven geometry test cases. All seven passed.
The retained [geometry receipt](geometry-validation.json) records those results
and the runtime scope.

Two-sided ray tests detect occupancy as well as surface clearance. Across
15,840 ray/mesh checks, the former caliper bridge produces 18 rotor-centre
occupancy hits; the corrected housing produces zero. This is sampled geometry
evidence, not a continuous collision proof.

The fitted gloves were also executed with actual Three.js r180 and the
production batching functions. All 784 sampled grip-contact rays passed across
high/mid detail and both hands. The nearest intersections are 17.151 mm and
17.552 mm from the 17 mm grip centre for high and mid detail respectively.
The [glove receipt](glove-validation.json) retains exact ranges and counts;
the complete Rider/Vitest and WebGL checks were not executed in that isolated run.

The bridge constructor was executed against a synthetic straight using actual
Three.js and the repository's static geometry merger. That fixture produced
five meshes and 5,970 triangles, with finite geometry and a footing raycast
within 0.000000006 m of its expected surface. Actual four-course placement and
rendering remain CI checks; this synthetic measurement is not a count for
every venue.

The committed regression coverage includes:

- Carbon band dimensions, material ownership, carrier openings, bobbin bores,
  finite geometry, detail budgets and caliper clearance.
- Fitted glove shape, handedness, grip clearance and geometry budgets.
- Placement, clearance, local culling and resource bounds on all four GP courses.
- Lean/heading traffic direction, malformed frames, warning priority and
  preservation of the existing car-proximity behavior.
- Production-model brake, rider-contact and course browser sequences with
  dry/wet states, held frames and rewind restoration.

The existing [MotoGP focused review workflow](../../../.github/workflows/motogp-review.yml)
runs the added tests alongside the original production build, contact,
presentation, course, dry-riding, wet-riding and menu-entry checks. Full-suite
and browser results must be read from the workflow for the published commit;
isolated geometry checks do not establish those results. Existing frame,
resource, drawing and model-budget gates remain in place.

## Try it

Run `npm ci`, then `npm run dev`. Select **GP-R1** or **GP-R2** and one of
**Poggio Alto**, **Cape Wrenna**, **Haarveld** or **Montejaral**. Use a close camera
to inspect the gloves and front brake assembly. A race with opponents exercises
the corrected proximity arrows and alongside guidance.

Default controls remain W/S for throttle/front brake, A/D to steer, Left Shift
for the rear brake, C for camera and Escape for the session menu.
