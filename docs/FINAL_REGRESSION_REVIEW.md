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

## A closed renderer cannot start another normal-map mip

A separate lifecycle review found that closing the normal-residency owner
prevented new jobs but allowed an already waiting job to submit every remaining
mip after its readback completed. The application replaces a circuit renderer
on the same canvas immediately after disposal. Those later submissions therefore
used a retired renderer after the canvas could belong to its replacement.

The counterexample starts two complete compressed chains, suspends each first
pixel-pack read, closes the owner, and then completes the submitted reads. The
old implementation performed nine draws rather than the two already submitted.
The correction checks ownership before each further mip: submitted reads drain
and their temporary targets are released, while an incomplete conversion returns
the original complete compressed chain. It never publishes a partial chain,
changes normal texels or cancels an unfinished GPU read. The existing one-mip
completion case remains valid. The counterexample fails before the correction
and passes afterward; 27 distinct normal, decoder, texture ownership and renderer
lifecycle tests across four files pass. Scoped lint, formatting and full
TypeScript checks pass as well.

The subsequent f106 GPU trace identifies all five repeated allocations as
1024x1024 BC7 RGBA with eleven mip levels, after the menu renderer was disposed.
The installed Three r180 upload and property modules reproduce the exact call
tuple `[3553, 11, 36492, 1024, 1024]` twice on the same native texture handle:
renderer disposal clears the upload properties while the retired texture
manager still retains its source-to-handle map. Resuming its next mip therefore
attempts another immutable allocation. The durable dependency-level negative
control reproduces that failure; the suspended normal-read integration with
the ownership guard performs only the original allocation and returns the
intact compressed source chain. Both new tests pass, alongside all nine normal
residency cases. This establishes a causal CPU reproduction of the traced GL
error. The changed application still requires its new High GPU run, and this
result alone does not establish successful High startup.

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

## Ridden MX laps need player flight inputs

The ridden-lap fixture deliberately withholds the AI mark so it exercises the
player's ground and flight solvers. It nevertheless passed the course AI's
ground route corrections directly into flight: lateral lane corrections became
player bank/whip inputs, and planned ground braking became front-wheel pitch
control. Production marked AI flight neutralizes those axes and uses its own
rear-wheel pitch controller. The fixture's claim that withholding the mark
changed nothing else was therefore incorrect.

The fixture now retains the course planner's ground inputs and releases steering
and the front brake while airborne, as a player making a straight jump would.
It still withholds the AI mark, retains ordinary Sport assistance, and adds
checks that the player solver remains active and the lap really enters flight.
Both courses, seed 61007, two laps, the 260-second deadline, zero-fall assertions
and one-second stall limit are unchanged. The original fixture fails 17/18;
the corrected fixture and independent riding/contact suites pass 45/45 under
the source-stability guard. Production offroad AI and player force code were
not changed by this correction; rejected route-control experiments were removed.

A separate observer still records rough-corridor wall contacts during the
corrected Valley lap. This result establishes the specified completion and
handling contract, not a repaired production AI route or collision-free riding.

## Completed component GPU rerun

Published commit `f1068433d49dc494a3373af99d12d89483308ac8` passes all seven
component fixtures in run 44488933964. The road-bike replay now has exactly zero
changed pixels, channel delta and coverage difference on rewind, held and
restored views. Physical contact, flight and landing checks and their negative
controls also pass. The complete compact Low driving/replay journey passes.

The same source's full High test still fails the unchanged readiness deadline.
Its five immutable BC7 allocations are retained with paired call stacks, while
the missing-fragment-output errors are absent. Thus the crown correction is
verified, but a completed High application view is still required. The normal
lifetime correction above was not included in this published checkpoint.

## Resume retained normals under the replacement renderer

Published `414c9ac35213a65e3d11d1145b681561f8a8483d` confirms zero captured
graphics errors after the lifetime correction. Its component GPU job passes
all seven fixtures and its complete Low driving/replay journey also passes.
The full High journey still fails the original 90-second readiness predicate.
Its resident concrete, gravel, meadow, lawn and asphalt normals retain their
complete compressed source chains; only rock finishes decoded RGBA8.

The page-wide ground store treated these interrupted source chains as fully
prepared because their layers were already resident. A replacement renderer
therefore never resumed the work. The correction retains one pending promise
across a renderer handoff and permits each new owner one preparation attempt.
An already adopted compressed layer temporarily leaves the scanned path so
existing map-swap wrappers release and rebind the completed normal. The cached
asset is reused, and supported completed chains and unsupported formats remain
unchanged. No authored resolution, mip chain, sampling mode, promotion ceiling,
quality preset, startup deadline or GPU completion condition is reduced.

Four of five independent lifecycle cases fail on the original `414c9ac3`
store. All five pass after the change, including replacement attachment both
before and after the retired read settles, readiness through the new read,
actual material wrapper release/rebinding, completed-chain reuse, bounded
failure retry and unsupported-format preservation. The integrated normal,
native Three, ground and handoff command passes 24 cases. Scoped lint and the
complete TypeScript check pass. A new actual High run remains necessary;
these CPU ownership results do not establish its startup time or appearance.

## Vellamar camera controls after the road-profile correction

The complete `b7540527` unit run passes 6,731 of 6,734 tests. Its two production
failures are mixed-class GP pace and wet Poggio contact. The third is the
historical Vellamar replay-camera checksum, following the intentional C1 road
profile correction described in `VELLAMAR_PROFILE_CONTINUITY.md`.

An independent comparison with the unchanged renderer at `e1c34e2` shows that
all 20 records change only their vertical eye position. Their road-relative
platform heights, horizontal positions, IDs, coverage, lenses, tracking,
zoom, shot descriptors and lead times remain unchanged. The greatest eye
height change is 0.4929036605 m, matching the changed local road elevation.
The full comparison is retained in
`studio/reports/evidence/graphics-engine-advancement/vellamar-broadcast-profile-audit.json`.

The fixture keeps all 44 original venue hashes and the same 880-camera
coverage. For Vellamar only, it first verifies each camera's original platform
height above the corrected road and the complete corrected record hash. It
then restores only the 20 explicitly captured historical y coordinates before
checking the original hash. An unexpected horizontal, lens, metadata or
platform-height change still fails. Production camera placement is unchanged.

The focused camera-control, actual hardware-placement and trackside command
passes all 61 tests across three files in 12.51 seconds; scoped ESLint passes.
The retained validation log and test source hash accompany the comparison.

## Reflection conversion prepared before scene draws

The `152643b1` High run still fails its unchanged readiness gate with zero GL
errors. The independent worker's final tracked command is a returned
`linkProgram`, program 144, fragment hash `8a7c27ed`, at a 768×512 viewport.
Exact reconstruction with installed Three r180 identifies `CubemapToCubeUV`.
Three defers this program's normal error-log and uniform/attribute queries to
its first use after the initial local capture. Those queries were not wrapped
in this run, so their elapsed wait is not claimed as directly measured.

The correction retains a shader-only PMREM owner, compiles against the existing
linear composer target before the asset wait, and initializes that same
program's metadata before scene draws. The actual conversion reuses the native
handle and its independent reference. The first local capture still submits
all six faces with the same resolution, format and filtering. There is no
additional capture or PMREM atlas, and shader error diagnostics remain active.

Five installed-Three native-cache tests protect the exact consumer, target/key
compatibility, one initialization, reference lifetime, failed-call state
restoration and retirement. The broader initial scoped command passes 86
cases; after review corrected pending High→Low→High ownership, all 20 affected
native/quality cases pass again. Full TypeScript, scoped lint and formatting
pass. Immutable source `2015839e4cde18eeb351cb357726274fbef56399` also passes the
complete guarded lint/content/build/bundle/IP command. These results do not
establish a new High startup pass. The actual rerun retains its original
960×600 High settings, 90/300-second deadlines and real GPU-completion gates.
