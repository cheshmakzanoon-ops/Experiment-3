# Phase 27H.1 — APX-01 complete mechanical assembly

## Scope and acceptance boundary

This change implements the **27H.1 car-only work package**, based on the supplied
`Pasted markdown(9).md`, lines 84–98, and the original whole-car requirements in
`docs/MASTER_DIRECTIVE.md`. Its exact starting point is
`3de67663f5d6461c29129e16bdcbd6f91c630935`.

**Implementation and acceptance are distinct.** The assembly, live bindings and
regression coverage are implemented. Full normal-game visual acceptance remains
open: this development runtime's managed Chromium rejects localhost with
`ERR_BLOCKED_BY_ADMINISTRATOR` and cannot create the required WebGL context.
CPU geometry inspection is not a replacement for the actual-game gate. No
reference-parity, final-art, controller/hardware or Steam-release approval is made.
`finalArtApproved` remains `false`.

The driver, steering controls, mirrors' camera feeds, physics, pit-service state
machine, environment, spectators, game modes and Aurel validation staging are not
rebuilt or altered. Driver-quality work belongs to 27H.2, not this change.
The existing global acceptance matrix has refreshed source/file hashes, with all
248 row statuses preserved. No acceptance is silently promoted.

## Visible work

The native editable assembly is `scripts/apx01-assembly.blend`. It contains 41
explicit mechanical/material roles and an assembled linked inspection view.
The earlier engine and sidepod skins remain original input assets; this is not a
claim that every surface was discarded and remodelled from nothing.

| Area | Implemented change |
| --- | --- |
| Front aero | Four densely sampled closed airfoil elements, bevelled endplates, actual connected pylons and surface-evaluated cascade spacers. A compact trailing envelope removes the previous overlap with the front tyre's full steering sweep without moving physical wheel hardpoints. |
| Rear aero | Two shaped elements, thin gurney, bevelled endplates, swan-neck supports, flanges and fasteners, plus a separate lower beam assembly. |
| Floor/diffuser | A continuous double-skin venturi floor with a 12 mm edge, bounded Hermite transitions, and fences that follow the same surface rather than floating above it. |
| Body/safety cell | A longer, deeper nose collar meets the cockpit shell; the dorsal fin's entire sampled lower edge sits in the engine cover. Halo, airbox and mirror-shell roles are included in the authored assembly. |
| Cockpit integration | Contoured bucket shell, bolsters and padding replace the two solid seat boxes. Existing driver, restraints and moving controls are retained. |
| Wheels | Separate front/rear forged-rim profiles, curved inboard spokes, rolled bead lips, carbon covers, centrelock bores and nuts, and small manufactured fasteners. |
| Tyres | Rounded 96-segment shoulders, correct bead/crown dimensions, original moulded APX lettering, and the existing state-driven contact deformation. No font file or licensed tyre artwork is shipped. |
| Brakes/uprights | Swept hollow brake scoops replace flattened inlet rings. Forged carriers expose upper/lower sockets; split calipers surround perforated ceramic discs. Independent rotor-owned mounting bells stay with the brakes during a wheel change. |
| Suspension | Aerodynamic-section links terminate at the actual carrier sockets instead of wheel centres. Span, camber and steering follow the existing recorded physical state at every LOD. Chord orientation is explicitly constructed, rather than arbitrarily rolling the section. |
| Tail | A tapered crash enclosure, hollow exhaust lip and recessed outlet are integrated with the existing live rain light. |

## Ownership and live state

`apx01-assembly.json` is the bounded role/material contract.
`HeroShells` keeps its import-time URL isolation, compressed/raw SHA256 checks,
finite metre-space validation, cancellation, size bounds and per-renderer
prototype ownership. Every runtime car receives owned clones. Mirroring reverses
triangle winding as well as X positions/normals; it does not rotate brake ducts
backwards.

The document validator permits only the expected 41 static roles, one primitive
and one named material slot per role, the required UV/normal/position attributes,
embedded bounded buffers and the two used material/quantization extensions.
External buffers/images, arbitrary texture resources, rigs, animation, unknown
roles and unbound material slots remain rejected. Rigged humans need a separate
pipeline; this loader is not widened into an unrestricted importer.

Blender preview materials are rebound to the game's live materials. Paint,
livery editing, carbon finish, tyre condition/compound, brake heat and wet paint
remain driven by the existing renderer. No replacement is flattened across a
motion boundary: wing meshes belong to their damage group, rims/tyres to the
removable spinning wheel, ducts/uprights/calipers to the steering carrier, and
discs/bells to the independent rotor. Live mirror glass remains separate.

No production load failure silently falls back to an unlabelled procedural car.
Explicit fixture callers without an authored asset retain their pre-existing
procedural path. The shared nose/wing/fin envelope also updates those callers and
reduced geometry, rather than creating incompatible car proportions at distance.

## Cost and evidence

The current manifest contains **102,551 prototype triangles**, **2,331,204 raw
bytes** and **1,142,562 compressed bytes**. Prototype counts are not the rendered
car total: wheels are instantiated four times and existing cockpit/driver geometry
is added. The real-car CPU fixture records **202,124 / 22,101 / 16,505 visible
triangles** at high/mid/far detail and **18,648,332 typed-array geometry bytes**
including all owned LOD meshes. These bytes exclude textures, GPU allocations and
other heap overhead; they are not a GPU-memory or whole-grid budget claim.

`PHASE_27H1_VALIDATION.json` anchors the native file and GLB hashes and records the
verification boundary. The test run passed lint, **932 unit tests in 92 files**,
TypeScript, production build and the unchanged physics scenario command.
The separate rotation benchmark, ten-car pit integration and clear/changeable
race-classification scenarios also pass.
The 38 new unit cases cover all roles, material/attribute rejection, reflection,
front tyre clearance, open ducts, perforations, connected aero supports, rotor/
wheel ownership, tyre deformation/rewind and malformed geometry.

The real FormulaCar CPU browser fixture passes **68 poses and 2,176 suspension
endpoint comparisons**, including full steering/travel/camber, all three LODs,
pit-wheel separation, independent disc/bell spin, damage, brake heat, live paint,
mirrors, cockpit visibility and history-independent tyre reconstruction. Every
update checks that the input simulation frame is unchanged. Its opaque-document
SHA256 adapter is test-only; production uses WebCrypto unchanged. Hosted CPU
timings are diagnostic observations, not target-hardware acceptance.

The normal-app front view was attempted and failed at navigation with
`ERR_BLOCKED_BY_ADMINISTRATOR`, before game startup. The full browser shards,
normal-game moving visual inspection and representative Windows GPU/controller
acceptance remain **NOT RUN here**. The pre-existing Vite large-chunk warning is
not suppressed or misrepresented as a resolved issue.

## Reproduce asset authoring and inspection

Use the retained Blender **5.2.2 LTS** toolchain and lockfile dependencies.
`--python-exit-code 1` is important: a Python exception must stop the pipeline.
Authoring deliberately regenerates the native assembly; after manual edits to the
native file, run **only the exporter** to preserve those edits.

```sh
node --experimental-transform-types scripts/apx01-seed.ts test-results/authoring/seed.json
blender --python-exit-code 1 --background scripts/apx01-shell.blend --python scripts/apx01-author.py -- test-results/authoring/seed.json scripts/apx01-assembly.blend
blender --python-exit-code 1 --background scripts/apx01-assembly.blend --python scripts/apx01-export.py -- src/rendering/apx01-shell.glb.gz
npm run check
npm run test:physics
npm run test:e2e -- e2e/20-phase27h.spec.ts e2e/22-apx01-assembly.spec.ts e2e/23-apx01-views.spec.ts
```

The exporter quantizes a real Blender glTF export using standard
`KHR_mesh_quantization`; it is not a private geometry format. Positions and
normals use signed 16-bit components, UVs unsigned 16-bit, with explicit positive
node decode transforms. It refuses extra attributes and excessive geometry,
emits deterministic gzip metadata, writes the manifest, and leaves no raw export
in `src/`. Re-exporting the retained native file produced byte-identical gzip and
manifest outputs.

Optional **CPU inspection, not actual-game screenshots**:

```sh
node scripts/apx01-inspect.mjs test-results/apx01/runtime-car.json
blender --python-exit-code 1 --background --threads 2 --python scripts/apx01-inspect.py -- test-results/apx01/runtime-car.json test-results/apx01/inspection
```

`CHROMIUM_PATH` can select an installed Chromium executable. The inspection tool
extracts actual posed FormulaCar geometry, including its normal hierarchy and
canvas textures. Blender then renders a clearly separate neutral studio. It does
not reproduce Three.js shaders, weather, postprocessing, application asset-loading
behaviour or GPU timing. The six supplied CPU views must never be described as
normal-application acceptance images.

## Remaining 27H.1 exit gate

Run the actual application on a WebGL-capable machine and inspect the same car
from front, rear, side, three-quarter, cockpit, chase and broadcast views while
stationary and moving, including steering, kerbs, braking, damage and replay.
Execute all unchanged browser shards and wet-presentation checks. Resolve any
observed defects before approving final art. Neither successful import nor these
CPU-only renders closes that gate. This does not start 27H.2–27H.6 or Phase 28.

## Subsequent coupled-driver continuation

`PHASE_27H12_IMPLEMENTATION.md` records the later 27H.1/27H.2 continuation from
`50d13c9`: separate Blender skin support, cockpit/driver construction, normal-game
view regression repair and coupled mechanical verification. The car-only scope
and limitations above describe this earlier implementation, not the later work.
