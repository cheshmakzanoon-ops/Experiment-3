# Driver, cockpit and service-character construction

Starting application: `f341dd6e7ede5c2039ddf6ad1b6e9b6a71ae4361`, exact tree
`701f04ac0b1f4867965265bf735c402e086002a5`. Its ordinary CI run `36291469905`
passed. This is a scoped production-art continuation, not completion of the
148-section directive, all-reference parity, human Section 146 or hardware approval.

## Observed baseline and chosen scope

The exact passing shard-8 artifact `10922509545` has SHA-256
`b19d9e26b3bce02fa2c246b1f5e6b0ff0ef0af7c1662d049a3e687fec8d54717`.
The normal clear-day cockpit `f91c1e5eb9c779a9db856aa401d29b6bda1186d5.png`
shows the old palm backs buried behind the suede silhouette: four finger bands
are more prominent than the continuous back of the glove. The normal pit removal
`c3b3fb6370570150f454d595cb15430880c749e4.png` shows the already repaired service
camera. This work does not reimplement or claim ownership of those camera repairs.

The supplied original `003_ps_steeringwheel.webp` and `004_ps_pitstop.webp` were
inspected for broad gloved-hand silhouettes, inset mechanical controls, fitted
cloth and a distinct visor. They are references, not redistributed textures or
licensed artwork. A new inspection of all 100 images is not claimed.

## Integrated implementation

**Hands.** The continuous sculpted dorsal shell sits toward the actual driver
rather than inside the wheel grip. A fitted back panel and two sewn side welts
follow the same evaluated surface; separate knuckle spheres and a floating planar
seam are removed. The four curled fingers, distal index topology, independently
animated thumb, paddle contacts, wrist anchors and steering IK are preserved.
The dark panel and restrained green glove remain lit materials, not emissive paint.

**Seated driver.** The retained nine-joint Blender suit receives fuller forearm
volume, localized elbow compression fans, outer tension ridges and knitted cuff
folds. Original topology, all hardpoints, torso/harness relationship and skin
weights remain. `scripts/author-driver.py` regenerates the editable scene and the
actual integrity-checked GLB; this is not an unused Blender render alongside a
legacy in-game model. The manifest now binds the author with `sourceSHA256`.

**Cockpit.** The display surround is an open, bevelled frame, not a filled plate.
Three bored selector rings, radiused caps, grip ribs and raised pointers occupy
the existing material batches. The selectors move down five millimetres to keep
those real rings clear of the unchanged display aperture. Tick scales use the
actual control-angle limits in metre-to-atlas coordinates. BIAS, ENERGY and DIFF
retain their existing meanings and show their real ranges, using the same one
1024x384 atlas. No fictional controls or new driving inputs are introduced.

**Pit personnel.** The existing fifteen-role rig receives near/mid garment
stations with compression folds and longer tension shapes measured in physical
coordinates, preserving bind endpoints and avoiding row-index-driven creases.
The visor is a front-only closed patch fitted within millimetres of the existing
helmet shell, with a sealed rim and restrained chin intakes. The original vertex
pigment identifies its lower roughness before instance tint, so the opaque shell
and lens share the existing draw. There is no transparent full-scene render pass.
Props, glove cuff/grip coordinates, all fifteen bones, service clocks, visibility
bounds, actor counts, pose-cache ownership and replay state remain unchanged.

Both authoring scripts run under the checksum-verified Blender 5.2.2 LTS build.
The people asset workflow is now a read-only reproducibility check for both
characters. It no longer rewrites authors or pushes exports automatically from
Blender 4.5.1 while another accepted source is being published. It compares all
runtime outputs byte-for-byte and retains editable scenes as artifacts; host
metadata in .blend files is not confused with runtime-byte identity. Ordinary
`ci.yml`, all eight browser partitions and all existing acceptance limits remain.

## Measured component cost

These are selected visible component counts, not full-scene render passes or
consumer-GPU timings. The controlled service uses fifteen actors at installation
clock 3.0 seconds; it is not the earlier removal-clock cost quoted elsewhere.

| Component | Baseline triangles | Candidate triangles | Baseline / candidate submissions |
|---|---:|---:|---:|
| Complete near car | 216,516 | 220,460 | 95 / 93 |
| Middle car | 22,113 | 22,113 | 23 / 23 |
| Far car | 16,517 | 16,517 | 23 / 23 |
| Near service crew/equipment | 181,312 | 240,232 | 6 / 6 |
| Middle service crew/equipment | 157,552 | 189,112 | 6 / 6 |

The near car retains 45 visible materials and seven material textures; selected
geometry storage changes from 7,097,156 to 7,511,268 bytes. A near service adds
128,608 geometry bytes. The crew's existing 172,800-byte bone atlas and machinery
storage remain unchanged. No additional texture, actor or material pass is used.
Increased service geometry is a real cost; physical-device performance is still
an independent gate rather than inferred from these counts.

## Validation contract

Eight new unit cases prove palm/grip sightline separation, retained finger and
thumb articulation, bored frame/ring geometry, display clearance, source-bound
assets and unchanged hardpoints, front-only fitted lens clearance, composed
idempotent shader ownership, and consistent canonical binds with verbatim sleeve
weights. The previous selector-label test now checks all six
actual heading/range labels rather than expecting the replaced minus/plus text.
Existing driver, cloth, prop-contact and service-envelope tests remain intact.

`e2e/33-character-quality.spec.ts` adds controlled real-GPU complete-car poses and
production-helmet comparisons. It requires actual authored-byte identity,
reachable arms at both locks, unchanged input frames, exact held/rewound pixels,
stable warmed resources, a negative lens-material control and separate lens/shell
roughness witnesses. These fixtures do not approve the art or replace the normal
application driver, populated pit, full-lap weather and recording/replay suites.

Local Chromium could not create WebGL. Blender CPU inspection images establish
geometry only, not game-shader, full-race or hardware approval. Candidate GPU
captures require authorized hosted execution. Source publication, that exact
commit's complete CI, and a public deployed build remain independently verifiable.
Use the exact successful CI release artifact, never historical tracked `playable/`.
The continuous human-driven race, physical Windows/controller/wheel measurements,
subjective handling/audio assessment and broad final-art acceptance remain open.

## Executed source and export checks

The locked local `npm run check` passes 115 files / 1,178 unit cases, ESLint,
strict TypeScript and the production build. Native physics, integrated driving,
rotation, ten-car service, classification and populated-race scripts also pass.
All 29 integrated-driving checks pass; those ordinary automated driver requests
are not a continuous human audiovisual race. The simulation source identity is
unchanged: `0dfddbb3fd97a279d2c9875bb9d03af86c583f17fbb75641176b428d469afe3c`.

Hosted export inspection exposed a real reproducibility difference, rather than
just accepting another checksum: six joint rotations/scales and 38 inverse-bind
float values differed at float32 rounding precision. The maximum bind difference
was 1.1920928955078125e-7. All remaining binary views, geometry, translations,
indices, normals, colours, UVs, joint indices and weights were identical.

The actual driver author now rounds only joint rotations/scales to 1e-6 before
normalizing quaternions and recomputing their matching inverse binds in double
precision. It rejects bind changes above 2e-6; it never rounds vertex or weight
buffers. Applying that exact function to the independent local and hosted raw
exports yields identical GLB bytes. A new regression proves normalized rotations,
world-transform/bind cancellation below 2e-7 and both original weight-buffer
hashes. Full-lock and rewind skin tests still pass without changed thresholds.

The canonical runtime driver GLB is 488,008 bytes, SHA-256
`7887cb43d21cdfbe1f09e167052fe8b6c64546882fe2206ce7b0e27f2684b50e`.
The unchanged crew export reproduces byte-for-byte between the two hosts.
Editable Blender scenes retain their native authoring data; the deterministic
step applies to runtime skin transforms, not a destructive mesh conversion.

The candidate source from hosted run `36312373313` was recovered and independently
checked against the local source: every executable file, runtime GLB, geometry
file and manifest is byte-identical. The retained source artifact `10929670632`
has SHA-256 `78d0513d96dd5ac876479946b0ceb1bbc45e12bd7b60502df97eb22dad072b5c`.

Earlier candidate run `36312025212` passed all seven focused browser cases,
including the normal application both-lock/countersteer/camera/replay journey,
missing-driver rejection, production crew/signal/canopy comparisons and both new
character GPU checks. Its artifact `10929810231` has SHA-256
`2e6328eaff0a80366f87dcf7d7dc9bcfaa543ad0b702b235c75a5aec9b4da9e9`.
The complete helper still failed its separate baseline comparison preparation;
that failure is not relabelled as a passing release. Those captures predate the
canonical bind correction and are not a replacement for this source's full CI.

The temporary tool-recovery and candidate-staging workflow edits are restored
to their original files in the delivered source. The application, both editable
characters, authors, manifests and regressions are actual source files, not
encoded patch loaders or a replacement deployment wrapper. Publication is a
normal fast-forward on `main`; complete ordinary CI and deployment still refer
to the exact resulting commit.
