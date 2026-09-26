# Race-surface material continuation

Base: `e34bf178862086673bcc417e9d5e7a4a4fd6cd4e` on `main`.
This is a graphics implementation increment, not closure of Phase 27H.6, final
character art, the complete Section 146 journey, physical-hardware performance,
or Steam acceptance. All previous rear-signal, crew/canopy and test repairs stay.

## Implemented

- **Tyres at every distance.** Each reduced tyre now shares its own physical
  wheel's material with the near representation. Wear, dirt, compound and wet
  appearance are observed before the reduced-car early return. A pit compound
  change or replay seek therefore cannot leave the distant tyre stale or clean.
- **Original drainage detail.** Intermediate and wet compounds get distinct,
  footprint-filtered circumferential/chevron channels and restrained normal
  relief. Slicks remain slick. These are material details, not cut geometry or
  a second contact/tyre-force model. Immutable local coordinates preserve the
  pattern through authored UV islands, wheel rotation and carcass deformation.
- **Wet rubber and lit markings.** Recorded rainfall and loaded-wheel contact
  water drive a bounded darkening/roughness response, with no hidden timer or
  state history. Sidewall compound markings now receive ordinary scene lighting
  instead of remaining unlit through night scenes. This is an instantaneous
  presentation observation, not a claim of simulated fluid retention.
- **Stable circuit and venue joints.** Asphalt joins, kerb joints and district
  stone/timber/metal/paving seams use an integrated periodic coverage filter.
  Derivatives are taken before wrapping/staggering. Unresolved detail tends to
  its coverage rather than disappearing or turning into a broad dark band.
  Existing PBR lighting, local atmosphere and regional weather hooks remain.

## Measured scope and cost

Native construction of the retained authored car, with all three LODs allocated,
retains **136 geometries, 41 materials, 7 textures, 196,146 vertices and 240,214
triangles** before/after. These are total allocated component counts, NOT a frame's
submitted counts. Immutable tyre coordinates add **236,952 bytes** to attribute
storage: **7,709,820 -> 7,946,772 bytes** in this construction fixture. This is not
process RAM or driver VRAM. No new geometry, texture, render pass or dependency is
introduced. Surface work adds fragment arithmetic; no hardware FPS gain is claimed.

The native observation fixture completed 32 LOD transitions without changing
geometry/material/texture ownership, changing input snapshots, or losing a wheel.
Independent numerical coverage checks used 245 parameter combinations, each
compared with 20,000 reference samples; maximum observed absolute error was 0.0008.
Native Mesa compiled 28 shader stages and linked all 14 ordinary/instanced material
variants. Fixed-camera native tyre captures compare the retained before shader
with slick/intermediate/wet/dirty/rewound states. Native rasterization is NOT a
browser or full-game capture, and its software timings are not consumer-GPU data.

## Browser and acceptance gates

`tests/race-surface-finish.test.ts` adds numerical, authored-geometry, state,
resource and composable-shader regressions. `e2e/31-race-surface-finish.spec.ts`
uses the actual authored tyre and FormulaCar LOD owners, tests visible compound
and contamination differences, exact held/rewound images, stable warmed renderer
resources, and all four venue materials. It attaches original PNG/JSON evidence.
The controlled inspection hides unrelated car meshes only inside the fixture.
It does not modify the game or replace any populated-race, pit, wet/night, replay,
physics or ordinary CI gate. Test names and source links are not executed passes.

Local Chromium could not create WebGL2. External interactive review did not start
because its browser-service wallet lacked credit; no purchase was made. Local
locked npm packages were unavailable, so full lint/unit/type/build/browser results
must come from this commit's unchanged GitHub CI, not from an older green run.

Normal-resolution whole-lap footage, broad car/cockpit/people art approval, a
continuous human-driven race and representative hardware measurements remain open.
Do not deploy the historical checked-in `playable/`. Publish only the ordinary
CI release for the exact successful source SHA and verify deployed identity.

## Browser-fixture origin correction

The first hosted run, `36279391565` for `8bb1d388`, passed all 1,153 unit
cases, strict TypeScript/build, native simulation scenarios and wet-presentation
checks. The new material browser fixture failed before rendering: its opaque
blank document lacked `crypto.subtle`, so the retained authored-asset integrity
check could not run. The failed screenshot, trace and report are retained in that
run's `browser-validation-6-of-8` artifact; it is not a passing material receipt.

The follow-up serves only the isolated fixture document at the ordinary test
server's loopback origin. It asserts and records actual secure-context/WebCrypto
availability before invoking the unchanged authored-asset decoder. It does not
mock the hash, bypass asset integrity, start a hidden game, change a shader, relax
pixel/resource checks, or alter the workflow. The follow-up's complete hosted
suite must pass independently; the old run cannot certify the repaired fixture.
