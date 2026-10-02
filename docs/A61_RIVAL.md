# A61 — original rival exterior refinement

## Scope

Refines the retained APX-01 rather than importing a commercial-game asset or
replacing the supplied player. One editable Blender scene keeps all 41 mechanical
roles and an assembled inspection view. Three independently verified GLB exports
provide close, middle-distance and distant/mirror geometry.

The high-detail pass sculpts the sidepod undercut/shoulder and nose highlights,
adds rolled diffuser-channel lips, a supported exhaust shield, a flanged rain-lamp
housing, connected endplate edges, an airbox lip/splitter and wheel-cover ribs.
The existing paint, carbon, livery, tyre and weather materials remain connected.
This is an original incremental exterior refinement, not a wholesale new car or
final AAA-art approval.

## Integration

Only opponents receive A61. The supplied player car/cockpit/driver and original
APX source remain unchanged. Static surfaces are merged only inside their proper
rigid groups; steering, camber, wheel spin, stationary uprights, service removal,
rotor motion, wing damage, rear signals and livery state keep their existing owners.
The middle/distant bodies are derived from the same source, not the older
procedural stand-ins. Mirrors may select coarser detail without changing the main
view selection. Renderer-owned prototypes and instance geometry retain separate
lifetimes; failed acquisition disposes already loaded tiers and surfaces an error.

## Measured CPU geometry census

The focused test instantiates the real FormulaCar with a stub texture canvas,
not a WebGL renderer. Visible geometry submissions are 93 before/after at close
range. Added stationary wheel hardware increases middle/distant submissions from
23 to 27; it is not falsely reported as a draw reduction. Triangles for the
complete posed rival are approximately 228k close, 46k middle and 24k distant.
The three prototype exports together transfer less than 2 MB compressed. These
counts do not establish GPU frame rates or 1080p/60.

## Reproduction and acceptance

Run pinned Blender 5.2.2 with:

```sh
blender -b --python-exit-code 1 --python scripts/author-a61-rival.py
npm run check
npm run test:e2e -- e2e/53-a61-rival.spec.ts
```

The author checks the retained native source's hash before touching it, writes
`scripts/a61-rival.blend`, and generates the three GLBs/manifests. The manifests
identify source and author hashes. Existing `apx01-assembly.blend`, all supplied
player bytes and physics configuration are not rewritten.

Unit tests inspect actual decoded meshes, independent mirrored clones, UVs and
normal bounds, tier integrity, unchanged attachment envelopes, suspension/steer/
service/damage and exact rewind. Browser tests use normal menus with twelve cars
on Aurel in clear daylight and Vellamar in wet night conditions. They inspect a
real rival from front/rear/side and enter actual moving racing; the renderer
reports which cars use the new geometry. Matching baseline capture uses the
same UI/camera sequence against the previous production build. Software-rendered
captures are visual/integration evidence, not consumer-hardware measurements.

Final human visual approval, representative hardware frame times, close-rival
racecraft, distinct A62 body variants and the separate human-animation milestone
remain open. A successful build is not an assertion of F1 25 parity.
