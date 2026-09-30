# A36 — Aurel workshop equipment, revision 01

## Scope

Four original Blender-authored props complete another part of A22 bay **05**:
a rolling seven-drawer tool chest, a medium portable flight case, a larger wheeled
flight case and a freestanding workshop bench. These are movable-equipment
**designs**, parked in this revision; they are not new built-in wall cabinets.

The chest has separate drawer faces and pull recesses, a lined and rimmed top,
formed push handle, key barrel, swivel castor forks, two brake pedals and original
markings. Both flight cases have lid/body separation, aluminium edge extrusions,
corner protection, recessed latch hardware, hinge knuckles and carry handles.
The larger case has its own proportions and wheeled base. The bench has square
section legs, cross-members, diagonal support, levelling feet, a lower shelf,
working surface and a small vice.

No supplied player car, cockpit, driver, A21-A35 source asset, garage architecture,
race rule, collision shape, service timing, tyre-state channel or dependency is
replaced. Cockpit repair remains a separate P0 issue.

## Source and reproducible handoff

| File | Responsibility |
|---|---|
| `scripts/author-workshop-equipment.py` | Parameterized original mesh, atlas, LOD and canonical GLB authoring. |
| `scripts/aurel-workshop-equipment.blend` | Editable component collection and assembled export meshes, with packed maps. |
| `public/models/aurel-workshop-equipment.glb` | Self-contained, four-variant runtime library. |
| `src/rendering/workshop-equipment.manifest.json` | Exact hashes/bytes, geometry counts, sockets, placement and provenance. |
| `src/rendering/workshop-equipment.ts` | Bounded acquisition, validation, batching, garage attachment and disposal. |
| `scripts/verify-workshop-equipment.py` | Standalone source/export receipt check. |
| `tests/workshop-equipment.test.ts` | Geometry, transport, placement, LOD and ownership tests. |
| `e2e/a36-workshop-equipment.spec.ts` | Real startup and full-production-factory visual surveys. |
| `e2e/fixtures/workshop-equipment.ts` | Actual circuit, native maps, normal scene lighting and moving inspection cameras. |

The authoring source uses Blender **5.2.2 LTS**. The retained 334 construction
objects remain editable in `EDITABLE_A36_COMPONENTS` (hidden by default).
`A36_GAME_EXPORT` opens with the near representations visible. The three detail
levels are deliberately constructed, not three simultaneously visible copies.
The `.blend` is compressed, so its file header need not be plain `BLENDER`.

The custom glTF writer serializes evaluated Blender meshes, retaining per-corner
normals, UV seams, triangle winding and metadata. Vertices are quantized to six
decimal places and triangles sorted deterministically. `--export-only` exports
edits to the retained assembled meshes and sockets; it does not rebuild manually
edited construction parts. Rebuilding the parameterized design uses the normal
command. Blender save metadata is not claimed byte-identical across hosts.

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 --python scripts/author-workshop-equipment.py
python scripts/verify-workshop-equipment.py
npm ci
npm test -- tests/workshop-equipment.test.ts tests/hero-garage.test.ts
npm run check
APEX_BROWSER_BACKEND=mesa LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe \
  xvfb-run -a npm run test:e2e -- e2e/a36-workshop-equipment.spec.ts e2e/43-hero-garage.spec.ts
```

Append `-- --export-only` for retained-mesh export or `-- --render` for the
supplemental Blender gallery. That studio render is **not gameplay evidence**.
The permanent authoring workflow verifies committed hashes, re-exports the retained Blender source in an
isolated temporary directory and checks the selected GLB byte-for-byte. It never publishes
changes or moves a branch.

## Scale, placement and interaction boundary

Variant-local units are metres, **+Y up / +Z front**, with the origin on the floor.
The gallery offsets in the library are not runtime placements. Four independent
placement/socket hierarchies describe the chest, two cases and bench in the
existing garage coordinate frame, raised to the existing 0.05 m floor surface.
The chest and bench occupy the front positive-side work zone; the cases occupy
the rear positive-side storage zone. Existing A35 equipment stays on the opposite
side. The car aisle, rear door, fitted cabinets and named crew/engineer access
volumes remain reserved.

The loader rejects overlapping footprints, non-finite transforms or placements
outside the retained work zones. Tests additionally intersect the placement
volumes against triangles of the actual A22 architecture, excluding deliberate
floor contact. These are placement checks, **not added physics obstacles**.
Socket metadata provides future push grips, handles, hinge references and work
surfaces. Interactive drawer opening, case-lid motion, equipment transport and
crew choreography are not implemented by this static revision.

## Materials and performance

One original **512 × 256** atlas contains eight padded surface regions. Three
embedded PNGs provide base colour, metallic/roughness and tangent-space normal
information. Ten-pixel interior gutters separate the regions. The pattern is
original seeded micro-surface variation, not a photographic texture or externally
licensed asset. Built-in Blender text is converted to geometry; no font file is
included. Studio lights, background and camera are excluded from the runtime asset.

The four placements together contain **33,828 / 16,928 / 4,936 triangles**.
The initial GLB is approximately **3.86 MB**; the manifest is authoritative for
exact bytes and hashes. At load time the four props are merged into **one material
batch per LOD**. Only the matching A22 level is visible, with its existing
lens-aware distance/hysteresis. Mirrors reuse that representation. No extra
lights, shadow maps, reflection passes or per-frame geometry construction are
introduced. One main-view batch does not imply only one total submission when
existing shadow or mirror passes render it.

The original library geometry is released after batching. The shared atlas and
three retained batches are disposed once. Cancelled or failed loading releases
partial ownership, and explicit size/hash failures do not silently substitute
prototype art. Normal `loadHeroGarage` loads and attaches A36 before returning;
standalone A22 decode fixtures intentionally remain standalone.

## Evidence and remaining acceptance

`A36_VALIDATION.json` records the exact candidate base, checks and native browser
survey summaries used for publication. The browser suite covers menu/practice/
pause plus the **complete production factory**, not just a stripped garage shell:
A21, A22, A26, the tyre equipment and existing player assets load normally. Fixed
and moving inspections cover dry day, sunset, wet day and wet night. The tests
check LOD switching, renderer allocation stability, WebGL errors and unchanged
simulation-frame/water arrays. CPU tests stub texture decoding; the browser
surveys decode the actual embedded images.

`finalArtApproved` remains **false**. Human-driven full-lap review, representative
physical-GPU profiling, closer artistic refinement and future equipment/crew
interaction remain open. Passing engineering cameras is not final art approval,
AAA parity or a repair of the separately tracked cockpit view. A GitHub commit
is not a redeployment of an external playable website.

## Cross-host export and placement validation

Fresh parametric builds can differ in a few final UV/normal digits; fresh-build
byte identity is not claimed. The inspected local and hosted checkpoint had
identical JSON, positions, triangle indices and all three PNG maps. The largest
normal component difference was 0.000007004 and UV difference 0.000001014.
Opening that hosted retained `.blend` on the local host reproduced its GLB
byte-for-byte. The permanent workflow therefore checks retained-source export,
not an unsupported promise that fresh evaluated normals are bit-identical.
The selected publication hash and native-texture browser evidence remain
authoritative; no pixel-equivalence claim is inferred from the numeric comparison.

The geometry gate detected the initial bench intersecting the electrical
enclosure and stowed hoses. The revised chest centre is (-3.25, 0.05, 3.34) m
and the bench centre is (-1.60, 0.05, 2.95) m, both facing the aisle. All 39,444
near-level A22 architectural triangles were checked against the revised
footprints without altering the garage or relaxing the collision assertion.

## Publication verification — 2026-09-30

Candidate run `36678888908` used base
`a5e16b45f0575f83e60546c1af67ec48f38cc74a`. Its 22 focused tests, full
1,423-test suite (146 files), ESLint, TypeScript and production build passed.
All seven selected browser cases passed: four A22 regressions, normal A36
startup/practice/pause, and dry/wet production-factory surveys. The run is not
labelled successful overall: its final Git-tree publication was rejected with
HTTP 403 after validation. Publication is completed separately through the
authorized repository connection, preserving the tested asset/runtime bytes.

The retained evidence archive SHA-256 is
`817d4569ed754189a97464a17aa69c9ce5590c1c7c880071a960aee31864ce67`.
Its 20 native game captures were reviewed together, with full-resolution
inspection of the chest/bench and flight cases. These remain inspection
cameras, not a completed human-driven service sequence.

Selected GLB SHA-256:
`c7258ca20495c9a9245451ef77ed32e9f937fd8938bb94edafd770790f60c897`.
The selected hosted `.blend` was opened and re-exported locally: its GLB
matched the selected hosted bytes exactly. The source, Blender and GLB hashes
also passed the standalone verifier after recovery. Post-publication CI is
a separate run and is not predeclared successful by this receipt.
