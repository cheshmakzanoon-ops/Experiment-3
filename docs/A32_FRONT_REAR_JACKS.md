> Hosted publication update: this revision was reconciled onto newer main and validated on GitHub. See [A32_PUBLICATION.json](A32_PUBLICATION.json). The original local GLB did not reproduce byte-for-byte on the hosted runner. The selected, hash-pinned hosted GLB retains the same dimensions, triangle indices and embedded textures but differs in some UVs, normals and tangents. Its native-texture browser inspection is separate evidence; pixel equivalence is not claimed. A32_VALIDATION.json records the earlier offline checkpoint.

# A32 — Front and rear pit jacks, revision 01

## Implemented scope

Two original, differently proportioned Blender-authored pit jacks replace the
legacy identical jack bases **when the normal asset-loading path installs A32**.
The front has a narrow low fork and smaller wheels; the rear has a wider frame,
reinforced wishbone structure, larger wheels and a different operating lever.
Both retain a rigid frame, pivoting lever, counter-rotating padded saddle,
rolling main wheels, handle grips, release detail and visible pivot hardware.

This is a first integrated source revision, not final art approval. It retains
Three.js, the supplied player car/cockpit/driver, A31 guns, A33 spare wheels,
A34 blankets, garage geometry and all simulation/track/collision rules.
`finalArtApproved` remains `false`. Git source publication is not external-site
redeployment.

## Files and ownership

| File                                                     | Responsibility                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `scripts/author-a32-pit-jacks.py`                        | Parameterized original Blender authoring, export, source inspection and receipt.            |
| `scripts/aurel-a32-pit-jacks.blend`                      | Editable parts, packed original images, assembled export hierarchy and non-exported studio. |
| `public/models/aurel-a32-pit-jacks.glb`                  | Self-contained four-level runtime asset.                                                    |
| `src/rendering/a32-pit-jacks.manifest.json`              | Exact bytes/hash, source hash, geometry counts, scale, sockets and motion dimensions.       |
| `src/rendering/a32-jack-pose.ts`                         | Read-only, snapshot-addressable rigid mechanism solver.                                     |
| `src/rendering/a32-jack-contact.ts`                      | Loading-time fit sampling on the actual retained car surfaces.                              |
| `src/rendering/a32-pit-jacks.ts`                         | Bounded loading, validation, instanced moving parts, LOD and ownership.                     |
| `tests/a32-pit-jacks.test.ts`                            | Structural, mechanical, integration, transport and disposal regression cases.               |
| `e2e/a32-pit-jacks.spec.ts` and matching fixture         | Normal startup and actual-circuit service-frame browser gates.                              |
| `e2e/a32-pit-jacks-offline.spec.ts` and matching fixture | Supplemental, explicitly network-free GPU assembly inspection.                              |

Only three existing runtime files are changed: `pit-crew.ts`, `renderer.ts`, and
`pit-presentation.ts`. The last change widens the visual camera service envelope
from 3.85 to 4.45 metres along the car's longitudinal axis; it does not change
collision bounds. No dependency, lockfile, global formatter, CI policy, other
agent's binary source, garage manifest or shared provenance index is rewritten.
This document supplies the A32-specific provenance record.

The inspected repository uses ordinary Git binary attributes for `.blend` and
`.glb`; it does **not** configure those files for Git LFS. The Blender installation
archive, dependency caches, `.blend1` backups and generated executable app bundles
are not part of this change.

## Scale, hierarchy and pivots

All dimensions are in metres. The runtime convention is **+Y up and +Z from the
operator toward the car**. Blender authoring maps `(x, y, z)` to `(x, -z, y)` so
its standard Y-up glTF export restores the game axes. The front instance rotates
180 degrees around game Y; the rear uses the unrotated insertion direction.

`A32_PIT_JACKS` contains `A32_FRONT_ROOT` and `A32_REAR_ROOT`. Each role has four
rigid parts, each with LOD0 through LOD3 meshes:

- `FRAME_PIVOT` is the grounded reference for the frame.
- `LEVER_PIVOT` is the actual fulcrum of the lifting fork and handle.
- `PAD_PIVOT` is a child of the lever at its end, with runtime counter-rotation.
- `WHEELS_PIVOT` is the main axle and supplies both main wheels.

Fourteen sockets are retained: for each role, `CONTACT`, `GRIP_L`, `GRIP_R`,
`GROUND`, `WHEEL_L_GROUND`, `WHEEL_R_GROUND` and `STOW`, prefixed
`SOCKET_A32_FRONT_` or `SOCKET_A32_REAR_`. Contact is the **top** of the rubber pad,
not the origin beneath it. Grip points follow the moving lever. Ground witnesses
belong to the stationary frame, not a rotating point on a tyre.

The two source roots are separated for inspection; runtime batches consume the
part-local geometry and solve instance transforms independently. They do not
inherit the studio separation. Only runtime meshes and metadata enter the GLB;
lights, cameras and the studio floor do not.

The source collection `EDITABLE_A32_COMPONENTS` contains 440 retained construction
objects with role/rigid-part/LOD metadata and editable modifiers. Its components
are stored in their individual rigid-part coordinate systems. It is hidden by
default; the assembled `A32_GAME_EXPORT` hierarchy is shown at LOD0 when opening
the file. The export meshes are also directly editable. Editing construction
parameters and rerunning the author script rebuilds the batched runtime geometry;
`--export-only` re-exports the retained assembled export meshes, not an automatic
rebuild of manually edited construction components.

## Geometry and texture budgets

| Representation | Front triangles | Rear triangles | Pair triangles |
| -------------- | --------------: | -------------: | -------------: |
| LOD0           |          21,736 |         22,872 |         44,608 |
| LOD1           |           9,840 |         10,224 |         20,064 |
| LOD2           |           3,204 |          3,528 |          6,732 |
| LOD3           |             868 |            936 |          1,804 |

The GLB is **5,793,632 bytes**, with 32 meshes, 57 nodes, one material and three
embedded 512 × 256 PNG maps: base colour, metallic/roughness and tangent-space
normal. Maps are original deterministic eight-region atlases shared by both
jacks and every LOD. Colour is sRGB; non-colour maps are linear. The un-mipped
RGBA-equivalent image storage is 1,572,864 bytes; mipmaps and actual renderer
storage must be accounted for separately. No 2K/4K texture family or external
texture download is added.

The selected hosted export SHA-256 is
`18cb30d23fe0d393fdc030ff59277e5f049155c18256ea738f5dcf6ca788602f`.
The runtime manifest is authoritative for regenerated bytes and source hashes.
The author checks 24,000 triangles per near jack, strictly decreasing LOD counts
and an 8 MB family export limit. These are ceilings, not targets to fill.

Runtime representation uses eight part draws for one front/rear pair at the
same LOD, rather than one draw per screw. Multiple active crews share the
same role/part/LOD batches and all materials/textures. At most 24 jack instances
are admitted. Up to 32 batches are allocated for the family; only occupied LOD
batches submit geometry. Shadows may add their own passes. No new scene light,
reflection pass, per-jack animation mixer or wall-clock animation is introduced.

LOD thresholds use the existing lens-aware distance helper at nominal 6, 16 and
42 metres with 12% hysteresis. The existing pit-service eligibility and distance
policy remain authoritative. A repeated held snapshot with the same camera does
not upload the jack matrices again. Mirrors use the already presented pose.

## Actual car fitting and motion

Loading-time rays sample the retained `PLAYER_BODY` underside for the supplied
car, and retained static chassis geometry for authored rivals. The approximate
longitudinal stations are +2.80 m at the supplied nose, +2.40 m at an authored
rival nose, and −2.25 m at the rear crash structure. Five samples across each
small footprint choose the lowest surface height and reject absent or markedly
uneven contacts. These are visual fitting measurements, not a mechanical load
rating, a claimed manufacturer jacking specification, or new collision geometry.

`A32JackPose` solves each frame from the actual presented car-local contact point
and `F.JACK_HEIGHT`. Lever angle comes from its fixed length and required pad
height. The root rolls longitudinally to cancel the fork's horizontal arc; the
pad counter-rotates to remain horizontal; the wheel roll is derived from this
absolute displacement. The frame and wheels remain on the service floor
`-0.43 - F.JACK_HEIGHT` in car-local coordinates, matching the retained pit view.
The prop never changes car pose, wheel loads, service duration or race state.

Both jack operators use the actual moving grip sockets. A31 gun installation
and A32 jack installation are order-independent. The existing machinery palette
retains the other family's tools and the release paddle. Legacy prototypes are
kept only for direct constructor fixtures without installed authored assets;
normal loading rejects a missing or corrupt GLB instead of silently displaying
those prototypes as successful A32 work.

### Explicit service-state limit

The normal crew visibility policy currently includes pit phases **2–5**. A32
uses that same policy. The existing simulation can enter phase 6 and accelerate
while recorded jack height is still reducing. This revision does **not** change
that state machine or claim a completed phase-6 lowering/withdrawal sequence.
The mechanism itself evaluates rising or falling heights deterministically, but
full release choreography, continuous hand withdrawal and final in-game approval
remain separate acceptance work. The asset is not marked complete in
`3dmodels.md`.

There are no new garage placements or a rear garage socket. `STOW` is handoff
metadata, not evidence that a staged garage scene has been integrated.

## Validation and reproduction

Use the repository's pinned Blender 5.2.2, Node 22.12+ and installed dependencies:

```sh
blender --background --factory-startup --python scripts/author-a32-pit-jacks.py
blender --background scripts/aurel-a32-pit-jacks.blend \
  --python scripts/author-a32-pit-jacks.py -- --check-source
npm ci
npm test -- tests/a32-pit-jacks.test.ts
npm run check
npm run test:e2e -- e2e/a32-pit-jacks.spec.ts
npm run test:e2e -- e2e/a32-pit-jacks-offline.spec.ts
```

For a candidate regeneration without overwriting the retained source/export:

```sh
blender --background --factory-startup --python scripts/author-a32-pit-jacks.py \
  -- --output-root /tmp/a32-reproduction
```

CPU tests check exact source/export hashes, GLB structure, packed image presence,
four LOD budgets, actual car-mesh contact, every near-mesh vertex's visual camera
envelope, literal exported socket transforms, rising/falling and rewound poses,
crew arm reach, both A31/A32 installation orders, unchanged frame data, bounded
transport, cancellation and once-only detached-resource disposal. CPU decoding
stubs image decoding explicitly; it does not establish browser texture quality.

The ordinary browser gate verifies production startup/loading and complete
circuit survey views from actual simulated service packets in day, sunset and
rainy-night configurations. The supplemental offline gate transfers hash-verified
bytes directly to an existing browser document, decodes the real embedded PNGs,
and exercises `FormulaCar`, `SuppliedPlayer`, `PitCrewView`, A31, A33 and A32.
Its engineering floor and illumination do not stand in for the circuit's terrain,
weather, mirrors, exposure, normal HTTP startup or hardware performance.

Local evidence and exact pass/failure boundaries are recorded in
`A32_VALIDATION.json`. `A32_OFFLINE_ASSEMBLY_REVIEW.jpg` is an explicitly labeled
contact sheet from the offline production-car/crew inspection. The source gate
passed all 1,362 tests; three supplemental GPU cases retained 27 nonblack images.
The four normal-URL cases were blocked before startup by administrator policy
and are not counted as passes. A first numeric-only run missed black night
readbacks; visual review rejected those captures. Both browser fixtures now use
completed framebuffer readback plus context-loss and nonblack/contrast gates.
The accepted offline evidence was rerun after that correction. A locally passing source suite does not imply hosted CI
has run, the commit has reached GitHub, or a separately hosted game is redeployed.

## Parallel-agent publication

Apply only the A32 commit/patch on a current real clone. Fetch the latest `main`
before integrating. Review concurrent changes to `pit-crew.ts`, `renderer.ts` and
`pit-presentation.ts` semantically; retain A31/A33/A34 work rather than replacing
whole files. Rerun the source and browser gates on the resulting tree. Never
force-push a stale tree, push a source-archive synthetic baseline, or re-export
another agent's binary asset as part of A32.

## Provenance and remaining approval

All A32 geometry, labels and atlas pixels are original and retained in the
parameterized authoring source. Built-in Blender text was converted to mesh; no
font file, team logo, photographic texture, third-party mesh or commercial-game
extraction is included. Existing supplied-car provenance is unchanged.

Remaining approval includes visual clearance around the front wing/diffuser at
all service poses, normal driven pit approach/entry/exit and replay inspection,
phase-6 release choreography, staging/garage integration, weather/mirror/shadow
performance on representative hardware and final material/art review. The
reported cockpit-camera defect is outside A32 and is not claimed repaired.
