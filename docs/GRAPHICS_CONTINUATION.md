# Graphics continuity, authored people and measured geometry storage

Gameplay baseline: `c7a430442ff5d3aceda78fdb708c007dfbdbf6f1`.
Observed publication ancestor: `ea114ce31bd544490d3a9084faaeceb95be30f43`.
Runtime fingerprint: `7f1f7ce34c9624fd80d100391ebfcb275e8e5c6908ef7dc404f50bc3d3bb2033`.

This is an implemented and locally tested correction batch within the planned
full-race graphics milestone. It is **not completion of every work package,
final-art approval, a physical-hardware benchmark, a verified public deployment,
or Steam readiness**. See `GRAPHICS_CONTINUATION_VALIDATION.json` for exact
executed checks and remaining gates. Publication is verified independently of
this document; a local commit is not evidence that remote main advanced.

## Evidence first

The baseline was recovered from exact-source GitHub run `36197922222`, source
artifact `10891220120` and browser partition artifact `10892000417`. Current-source
cockpit, wet-night and pit images were inspected, not an older demo build. The
review identified subdued cockpit material/legend definition, strong wet-road
highlights and distracting short-scale terrain variation. Source inspection
also found two objective problems: reduced cars discarded their live sidepod
livery, and static merging expanded indexed geometry into repeated triangle
vertices.

The original reference pack SHA-256 is
`4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.
R003, R004, R010 and R039 were reopened for a focused review of cloth/material
separation, service composition, wet-car readability and populated night scenes.
This is **four targeted references**, not a new all-100 inspection or parity
claim. No reference artwork, real vehicle model, logo or sound was shipped.

## Implemented corrections

### Indexed static geometry and live distant liveries

`mergeStatic` and `batchScene` now retain indexed vertices. Unindexed inputs
receive sequential indices; vertices are never welded by position, so UV seams,
normals, colours and the expanded triangle sequence survive. Scene batching
retains the existing spatial/material/visibility grouping and animated-root
exclusions. Complete output is prepared before source meshes are removed. An
incompatible merge leaves the source intact and disposes temporary buffers,
instead of silently dropping scenery. Shared source geometry is disposed once.

Both reduced car levels reuse the two existing signed live sidepod materials.
Saved repainting and texture-budget changes therefore reach every distance level.
No additional livery maps or cloned materials are allocated. The two material
boundaries can add two draw batches per reduced car: this is a disclosed cost,
not a zero-cost claim. Existing LOD cutoffs, hysteresis, moving carriers, removable
wheels, damage groups and mirror ownership are unchanged.

The new tests compare expanded triangles/attributes before and after merging,
exercise failure and sharing, and check material identity on both signed sides.
The existing complete-car component test additionally repaints the actual car
across three texture budgets and every LOD, checking texture identity and the
livery canvas pixel colour rather than merely a stored livery label.

### Seated driver, gloves and cockpit controls

The retained `author-driver.py` generates the revised native `.blend`, skinned
GLB and identity manifest. The seated sleeve profiles now taper through the wrist;
compression is concentrated toward the inside of the actual bent elbow rather
than distributed as uniform corrugation. Original garment panels are vertex
colours on the same mesh. Nine joints, skin roles, steering/grip anchors and the
14,432-triangle count remain unchanged.

Suit, glove and reinforcement use distinct roughness and normal strengths while
retaining the same two shared woven textures. Selector headings and small control
marks are larger within the existing 1024-by-384 atlas; the knob finish is more
readable. No emissive fill, new light, extra display texture, changed dial state
or modified physical steering input is introduced.

### Authored pit personnel

The retained `author-people.py` generates the revised native scene, runtime mesh
table and exchange GLB. Garment shoulder/side/waist/cuff panels vary on the actual
skin. Small sleeve-profile corrections and independent helmet jaw/crown shaping
retain the existing topology and contact envelope. Fabric roughness uses filtered
two-dimensional yarn variation through the existing shader chain.

The fifteen-actor service choreography, bone counts, tool and glove contacts,
wheel ownership transitions, ground references and recorded pit clocks are not
replaced. Existing pose, helmet-separation, skin and complete-service framing
checks remain enabled. This batch does not claim an all-character replacement:
marshals, grid staff and headquarters characters retain their existing assets.

### Water-film response, paint filtering and circuit ground

The road's presentation-only clearcoat uses the named visible-light water IOR
approximation 1.333, giving normal-incidence Fresnel reflectance
`((1.333 - 1) / (1.333 + 1))^2`. The existing normal-footprint roughness is preserved
when replacing stock clearcoat roughness; bounded additional variance filters
unresolved aggregate/ripples. Wet paint similarly retains geometric roughness.
The physical water field, tire/grip equations, film coverage, damp/puddle normal
conformance, ripple clock and pit deposit exclusions are unchanged.

The original production-material GPU fixture now measures the actual compiled
water reflectance and effective roughness, as well as its prior normal, pause,
rewind and resource contracts. Matched baseline/candidate diagnostic normal
images are identical. The optical correction is an approximation, not calibrated
water transport or proof that all full-scene night glare is resolved.

The existing world-space grass variation is made broader and less contrasty.
The same three noise evaluations, surface roles, terrain geometry, apron contact
and footprint filtering remain. No props, additional map, texture download,
light or render pass are added. Twenty matched lap-position views, six service
sites and the occupied grandstand were inspected. All 27 matched direct-scene
captures retain identical draw and submitted-triangle counts.

## Measured costs and limits

| Measurement | Baseline | Candidate | Interpretation |
| --- | ---: | ---: | --- |
| Complete-car geometry arrays | 19,427,768 bytes | 8,095,232 bytes | 58.33% reduction in this CPU component accounting |
| Circuit unique geometry backing buffers | 58,190,616 bytes | 54,241,888 bytes | 6.79% reduction; includes inactive LOD geometry |
| Car visible triangles, high / mid / far | 216,516 / 22,101 / 16,505 | unchanged | No silhouette was removed to obtain the storage saving |
| Circuit stored triangles | 1,137,116 | unchanged | Not a per-frame GPU submission count |
| Compressed driver | 208,511 bytes | 209,237 bytes | 726 additional download bytes |
| Compressed people exchange GLB | 183,891 bytes | 192,530 bytes | 8,639 additional exchange bytes; runtime uses the mesh table |

These are specific geometry-array and asset measurements, **not process RAM,
VRAM, consumer-GPU FPS or minimum-PC certification**. Existing renderer/profile
code and regression thresholds are unchanged. Actual frame-time comparisons must
still use matched physical machines, power modes, settings and workloads.

## Validation and preservation

The complete local check passes lint, 1,107 unit cases in 106 files, strict
TypeScript and production build. The eight existing numerical scripts pass;
their new outputs are retained separately rather than rewriting historical
reports. The twelve-car grid and eight-car close-racing/wet-following/pit-service
component scenarios are checked separately. See the JSON record for browser
subsets, failures/repeats and artifact hashes. The 41-case component subset
initially passed 39 cases; both unchanged timed-out cases passed separately
(49.0s and 36.1s). This is not a clean first-pass run or a complete normal-game suite.

Matched GPU captures use actual production materials and geometry, on explicitly
labelled Chromium SwiftShader. Authored-car/driver/crew captures use the real
asset decoders. The circuit survey uses an existing direct-scene fixture with
its legacy car representation; it is **not** authored-car or complete-application
acceptance. Components, full-renderer fixtures, normal application journeys and
physical hardware are not interchangeable evidence categories.

Normal application navigation in this environment returned
`ERR_BLOCKED_BY_ADMINISTRATOR`. No navigation-policy bypass was used. Consequently
this batch does not claim the exact-candidate ordinary-app full-race CI, human
steering/wheel review, hardware frame-time gate, end-to-end Section 146, final
visual approval or live-deployment smoke test.

Simulation, input, workers, storage/replay, audio, dependency files, original
`ci.yml`, the master directive and the static APX-01 car asset are preserved.
The three concurrently published workflow changes between the gameplay baseline
and `ea114ce` were recovered by exact tree/commit identity and retained. They are
not authored by this correction batch and their checks are not its CI results.
No force update, new branch, worktree, source capsule or unrelated project is
introduced. The requirement matrix remains 0 PASS / 230 PARTIAL / 2 FAIL required
rows and 16 excluded references, with updated ownership/source links only.

## Preserved compiled candidate

The existing `playable/` directory now contains the exact successful local
production-build output, without debug source maps. Its source fingerprint and
per-file hashes are recorded in `playable/BUILD.json`. This replaces the stale
recovery payload; it is not an assertion that hosted CI or public deployment
passed. Settings and saved progress are not reset.

## Reproduction and next acceptance

Use the locked Node dependencies and retained Blender 5.2.2 authoring toolchain.

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/phase27h6-racing.ts
node --experimental-transform-types scripts/phase27h-matrix.ts --check
npm run test:e2e
```

The delivered evidence includes reproducible scoped comparison helpers and raw
reports. The next acceptance operation is the exact-source normal-application
race and reference review, followed by matched physical-hardware profiling and
human driving. Outstanding findings should drive the next implementation batch;
these gates must not be approved from local compilation or static pictures.
