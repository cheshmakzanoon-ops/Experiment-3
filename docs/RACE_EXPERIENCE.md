# Race-experience continuation

Base: `08768aa52141612d14b3479cbfded2bc699e4473` on `main`.
Runtime source fingerprint: `be09b3c0fc31eba9e5510cd21f3b1a49c09f5e1fed1b4a842bbfb3f16e7bc210`.

This is a scoped rendering correction, not completion of Phase 27, the entire
race-quality milestone, final art, a human-driven race, or Steam acceptance.
The baseline's successful hosted run is `36251426949`; that result does not
certify this continuation. Publication, candidate CI and deployment are separate.

## Implemented changes

1. **Rear-signal continuity.** The actual FormulaCar rear lamp is owned by the
   car root rather than its high-detail body. One lamp now survives every LOD
   handoff. Recorded brake/time interpolation updates its emission before the
   reduced-model early return. Its anchor and intensity agree with RearSignalField;
   an opponent can no longer lose the lamp solely because its body LOD changes
   while retaining a red-lit spray plume. No signal timing or physics rule changed.
2. **Pit-crew garment construction.** High and middle authored crew meshes retain
   their topology, skin weights, bone atlas, poses, equipment and service timing.
   Bind-space cloth panels add a shoulder yoke, side/knee/elbow reinforcement,
   front-only closure and narrow piping. Existing joint weights distinguish the
   torso, sleeves and legs, so crossing an arm does not project a chest panel onto
   it. Narrow seams filter with their pixel footprint. This is lit cloth albedo,
   not emissive decoration or a replacement claim for every character category.
3. **Canopy lighting continuity.** Crossed foliage cards already use normals for
   an aggregate crown volume. Their colour shader now undoes the double-sided
   face reversal only for smooth volume normals. Camera movement therefore does
   not invert the same crown's lighting across a card. Atlas coordinates, alpha
   threshold, depth/distance shadows, placement, geometry and instancing remain.
   This approximation is not intended for individually modeled thin leaves.

## Cost and ownership

The existing twelve-triangle rear lamp adds one submission per visible reduced-LOD
car; high-detail ownership still renders one lamp, without a duplicate. Cloth and
canopy changes add shader work, not textures, geometry, particles or render passes.
These are structural cost statements, not measured consumer-GPU frame-time claims.
All original authored binary assets and the original 148-section directive remain
unchanged. Simulation, input, audio, workers, storage, dependencies and CI gates are
unchanged. No settings-reset wrapper or additional branch is required.

## Validation

`npm run check` passed locally: lint, 108 unit-test files / 1,131 tests, TypeScript
and production build. The six new unit cases exercise actual FormulaCar LOD
ownership and recorded emission; normalized authored garment regions; shared
colour/shadow skinning; and composable, bounded foliage shader hooks. The no-op
canvas used in one unit test is explicitly geometry/state evidence, not imagery.

`e2e/30-race-finish.spec.ts` adds real WebGL comparisons of production components:
lamp pixels at all three LODs; plain-control/tailored crew pixels at both actor
LODs, held/rewound poses and warmed renderer resource counts; and front/back canopy
pixels with an uncorrected control. PNGs and numerical JSON are attached. These
controlled fixtures do not replace the retained full-application race, pit,
dry/sunset/wet-day/wet-night suites or their normal CI assertions.

Local navigation was explicitly blocked by administrator policy and local Chromium
could not create WebGL2. No bypass was attempted. Candidate GPU results must come
from authorized hosted browser validation, not the unit-test count above. Native
scenario logs and fresh source-bound acceptance output are retained separately
from historical checked-in numerical reports.

The historical `PHASE_27H_MATRIX.md` remains the baseline's dated source-bound
snapshot, not this increment's acceptance certificate. Generate the current matrix
with `node --experimental-transform-types scripts/phase27h-matrix.ts --json <path>`.
For this runtime fingerprint it retains all 148 directive rows and 100 references:
0 PASS / 230 PARTIAL / 2 FAIL required rows; 16 excluded references. None of these
statuses is upgraded by a neighbouring test or a publication event.

## Delivery and remaining work

The checked-in `playable/` is historical. Use this exact source's successful
ordinary CI release artifact, or rebuild its immutable source with the locked
packages and require byte-for-byte equality with that artifact before deployment.
Verify the public SOURCE_COMMIT.txt and smoke-test real driving, pause/resume,
settings persistence, assets and workspaces on the same deployed revision.

Normal-resolution candidate footage still requires review. A complete manual race,
physical controller/wheel acceptance, representative CPU/GPU frame-time and memory
profiling, broad character final art, and subjective handling quality remain open.
No physics adjustment is justified merely to make software-rendered CI run faster.
