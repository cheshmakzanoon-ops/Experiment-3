# Final integration regression review

This note records the coordinator's follow-up to the complete application and
unit checks of main commit `8763bfc8e1a811abc93a546d5f8f3179965b4547`.
The observed GPU results are retained in
`docs/studio/reports/evidence/graphics-engine-advancement/components-8763bfc-initial`
and `high-8763bfc-initial`. None of the changes below increases a test deadline,
reduces a quality preset, or relaxes a pixel, race, grip or completion threshold.

## Crown occlusion is not a shadow caster

The High application trace captured a linked `MeshDepthMaterial` program whose
fragment output location was -1 while its framebuffer had an active colour
attachment. Its fragment main function unconditionally discarded immediately
after the clipping-plane chunk. This was the crown contact-occlusion material
in `vegetation/forest.ts`. The renderer temporarily promoted every non-casting
instanced vegetation mesh into the static far shadow bake, including those
projected ground discs. ANGLE rejected the resulting draws.

The renderer now excludes the existing `photoVegetation: 'contact'` category
from the far caster collection. The unused discard-only depth material has
been removed. The visible ground disc, its opacity, its texture and the tree
casters are retained. A production renderer collection test verifies that
cards, trunks and impostors still enter the bake while the contact disc remains
visible and does not enter it. The vegetation quality, photographic vegetation
and far-shadow suites passed 34 tests across three files.

The same High run also recorded five immutable texture allocation errors.
Those are a separate unresolved diagnosis at this checkpoint. The High test
now records repeated `texStorage2D` allocations with both call sites, without
draining GL errors or altering draws. No claim that the crown correction fixes
texture ownership or completes High startup follows from its CPU tests.

## Replay reference: cold state on the same visual assets

The corrected road-presentation GPU fixture at 8763bfc passed physical contact,
flight, landing, held-frame and legacy-control checks. The independent cold
model versus rewound model comparison still differed at 33 pixels, with a
maximum channel delta of five and no coverage difference. The differing pixels
were confined to a six-by-nine-pixel region on the helmet. A separate headless
comparison found exact equality across all 210 graph nodes' matrices, skeleton
matrices, geometry positions and normals, and material properties and custom
uniforms. That does not identify a proven GPU or Canvas2D root cause.

The replay contract now records the same model's first presentation of the
airborne snapshot before it has any animation history. It then presents the
earlier supported snapshot, the continuous flight and landing, and finally
rewinds. The reference therefore has a genuinely cold spring state and the
exact same visual assets as the rewind. It does not compare against the
different spring state of a continuous flight. The original requirement of
zero changed pixels and zero channel/coverage differences is retained. A GPU
rerun is required; CPU checks alone cannot establish that it passes.

## Reflection failures must respect the retry budget

The original visual-coherence fixture asked a failed six-face environment
capture to retry immediately at the same held presentation time. That conflicts
with the bounded retry policy added by the reflection assignment. The fixture
now explicitly checks twenty held updates: no extra submission and the last
complete cube remains published. It then checks no retry at 0.49 seconds and a
successful retry at 0.5 seconds. Successful held frames still perform no work.
No production code or retry interval was changed for this fixture correction.

## A stationary rollover must be clear of a following rival

The festival fixture instantaneously stopped and inverted the player in the
racing line. Under the current authored vehicle hardware, a following rival
was already close enough to collide on the next step. The recorded first
impact was 346,453.73 J. The inverted car consequently slid above the existing
6 m/s recovery eligibility limit until about 3.4 seconds; at the fixture's
five-second deadline it had accumulated only 1.6 seconds of the required
two-second low-speed inversion. Teleporting that moving wreck sooner would
change the production recovery policy.

The fixture now stages its stationary rollover at the recorded legal route
station, toward the road shoulder, and verifies initial separation from every
rival. It uses the production placement method to clear residual wheel and
body velocity. The two-second recovery policy and five-second assertion are
unchanged. It still checks upright replacement, legal progress, continued race
completion within 240 seconds, legal distance and exactly one result. The
corrected fixture recovered at approximately 2.01 seconds in the diagnostic.
The complete festival edge, visual-coherence and reflection suites passed
69 tests across three files.

## Split-grip launch must remain on split grip

The previous differential fixture applied full throttle with no steering on a
world-space split surface. Its limited-slip car drifted 5.15 m sideways while
the open-differential car drifted 0.27 m. It consequently compared cars on
different grip configurations by the end of the 2.5-second launch. The measured
speed ratio was 1.1095, below the unchanged 1.15 requirement.

The fixture now uses the dynamics benchmark's physical pure-pursuit steering
input to keep each car near the centreline. It does not overwrite position,
heading, velocity or forces. Additional assertions verify at every step that
the two driven contact patches remain on their original distinct grip halves.
With the current hardware the measured speed ratio is 1.3570 (10.8743 versus
8.0134 m/s). The original 15% advantage, launch duration and open-wheel spin
comparison remain unchanged; all-wheel-drive and hybrid fixtures are untouched.

A separate diagnosis observed automatic gear hunting under wheelspin. A
candidate engine-RPM downshift guard was tested only in an isolated checkout
and was not accepted into production. This fixture correction must not be
reported as an automatic-transmission repair. The complete drivetrain, active
road-presentation and rider-motion suites passed 25 tests across three files.

The three focused command counts above describe disjoint file sets for this
follow-up. They are not a substitute for the final complete unit suite, original
19-scenario motorcycle matrix or full application GPU acceptance.
