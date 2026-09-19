# Circuit reference continuation — 2026-09-19

## Baseline, source and scope

This pass continues published source `2f858b2e23c994916b2224d812aa66ec7c1f79a0`, including the cockpit work in `8721bcd5ecc1154facc63d8caf89b36189009328`. That baseline's complete Actions run `35450946136` passed validation, physics scenarios, all three browser shards and playable publication. It is not replaced by an unrelated demo or a new branch.

The recovered `Pasted markdown(6).md` and `docs/MASTER_DIRECTIVE.md` remain byte-identical: SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`. All 148 headings remain in the coverage ledger. This is a further functional, validation and visual iteration for sections 55–61, 95–98, 122 and 128–129, not completion of every acceptance statement in those sections.

The supplied ZIP still hashes to `4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`. All 100 decoded images were inspected in five contact sheets. The existing exclusion of unrelated IDs 048–065 remains. Useful qualitative references for this pass include the barrier/fence treatment in 033, cockpit sightlines in 034/037, and layered circuit/grandstand views in 076–078. Repeated crops, promotional images and unverified platform attribution remain caveats; the ZIP is not 100 independent verified PS5 gameplay frames. No reference pixels, commercial meshes, brand liveries or extracted game assets enter the runtime.

**F1 25 photorealistic parity is not achieved.** The current car, environment, crowds and lighting are visibly simplified. The reference is a target, not a certificate issued by a passing screenshot test.

## Implementation

### Track-bound concrete and catch fencing

The former rectangular barrier blocks are replaced with a bevelled concrete profile, panel gaps, base weathering, small form-tie details and narrow tubular fence supports. Each endpoint follows the same bank and elevation queries used by the existing track. The maximum 0.55 m width and the 0.94 m top above the contact plane retain the previous above-ground visual envelope; this pass does not add a hidden collision wall or change the pit route.

Catch fencing now uses a 0.09 m diagonal wire period rather than large dark diamonds. An analytic periodic-mask integral averages wire coverage over the pixel footprint. At distance the material approaches the covered area instead of displaying an oversized grid. Thin horizontal support rails still alias at some viewpoints; this is not temporal antialiasing or a guarantee of shimmer-free motion.

Both sides are grouped into three material draws per longitudinal span of at most 80 m. Transparent wire retains `depthWrite=false` and does not turn into an opaque shadow caster after batching. Bounds remain spatial rather than one complete-lap mesh.

### Shared apron height and real triangle validation

A close-up exposed a pre-existing mismatch: the grass ribbon began falling away at lateral 15 m, inside the physical barrier, and could sit roughly 0.2 m beneath reachable wheels. The ground profile now reserves falloff for one metre beyond the actual left/right wall. The original flat 40 mm separation from the contact plane remains, keeping grass below the existing gravel overlay. Barrier footings embed a further 15 mm rather than floating above the apron; stand footings and vegetation use the same ground profile.

Testing the height helper alone was insufficient: the old six-column mesh interpolated a remote outside drop beneath the wall and smoothed across the bank clamp. A raycast regression failed against those triangles. Eight columns now put vertices exactly at the two bank-clamp positions and the outside-wall breakpoints. Raycasts against the actual shipping ribbon at multiple sloping locations verify contact-to-grass separation between 28 and 47 mm, including beneath both wall edges. No physics height, surface class or collision envelope was changed. The intermediate failed test is retained in the separate validation evidence. The existing tree-grounding case initially failed because its independent expected formula still used the old 15 m drop; that expectation now uses the real boundary plus one metre, with its original seven-decimal tolerance unchanged.

### Eight original grandstand sites

Eight deliberate locations replace the former sparse tiers with terraced decks, separate foundations, vertical steel posts, cantilever roof ribs, diagonals, handrails, a thin pitched canopy with a shaded soffit, access aisles, original Aurel fascia, and individual seats. Seats and seated spectators are instanced per stand rather than individual draw objects. Spectators remain simplified silhouettes, not detailed animated human assets.

Structures use a level datum above sampled grade and footings that reach the sloping ground. Vegetation placement consults the same stand footprint with an 8 m canopy exclusion margin. Unit tests sample each building edge against the physical driving boundary and require more than 4 m of clearance. This is a concrete layout check, not a universal proof that every distant terrain/prop intersection is perfect.

### Surface and lighting treatment

Original deterministic construction finishes add restrained asphalt paving joints and broad variation, patchier grass, painted-surface grit and chipped/jointed kerbs. These are decorative material finishes. Live rubber, water and marbles still come from the simulation grid; no fake race-state markings, extra physical bumps or wall-clock weather effects were introduced.

The finish hook composes with the existing grazing-angle bump repair and water shader. Sky radiance is normalized before the shared tone map. Environment-map weather bins use the same radiance response and restore the current live uniforms on both successful and failed capture. Exposure values are authored tuning, not measured physical photometry.

## Local validation and preserved failures

`npm run check` passed **541 tests in 55 files**, ESLint, strict TypeScript and production build. The 14 added unit cases cover analytic wire coverage, invalid footprints, both barrier sides' profile/normals, banked endpoint heights, chunk bounds and shadow flags, bump/finish/water hook composition, stand/vegetation corridor clearance, apron continuity, wall-footing embedding and raycast comparison of actual apron triangles with wheel-contact heights. Existing daylight cases now also check radiance restoration. No existing acceptance threshold was weakened, and no simulation, protocol, input or dependency file changed.

The first local headless system-Chromium attempt could not create a WebGL2 context. It is a recorded environment failure, not a render pass. A system Chromium running headed on Xvfb with software ANGLE/SwiftShader provided WebGL2; no browser policy was disabled. A separate new-fixture unused import failed lint and was removed before the successful complete check.

Seven focused browser cases then passed with no failures, retries or skips:

- The unchanged dry/wet full high-preset production reference checks: 12 captures, all 24 sampled HDR cubemap faces finite, unchanged simulation frames and no browser/GL errors.
- The unchanged physical cockpit articulation/seek/disposal case: real recorded controls and five captures; repeated seeks stable at 83 textures / 712 geometries; two cloth-texture and three selector-instance disposal events.
- Two new circuit surveys: six views of the grandstand, barrier and kerb; actual circuit scene, unchanged frame and water grid, no browser/GL errors, and stable repeated-render allocation counters. These are fixed engineering cameras using the direct scene pass, not substitutes for the separate full post-processing checks or a driven lap.
- The unchanged progressive-construction case: synchronous and cooperative construction have the same geometry/index/instance signature. The measured progressive run used 391 tasks, 54 yields and 674.7 ms total work, with an 92.0 ms largest task. That peak is still above the preferred 8 ms slice; cooperative scheduling does not make a single task pre-emptible or certify instant startup on every device.
- The unchanged real pit-service fixture remains at **95 draw calls**, below its original strict limit of 100.

The complete browser suite now contains **31 cases**. The normal GitHub workflow remains the separate publication gate for all application journeys and the native physics scenarios. Selected local cases alone do not establish full-suite success. Its source-identified artifacts preserve the final CI result; no runtime is rebuilt after those checks for `playable` publication.

## Measured graphics trade-off

Same existing three-car fixture, seed 1887, tick 96, 1280 × 720, high preset, original camera logic:

| View | Baseline calls | Current calls | Baseline triangles | Current triangles |
|---|---:|---:|---:|---:|
| Clear exterior | 549 | 575 | 598,450 | 678,018 |
| Clear cockpit | 689 | 773 | 742,685 | 1,031,165 |
| Rain exterior | 549 | 575 | 600,998 | 680,566 |
| Rain cockpit | 680 | 764 | 724,125 | 1,012,605 |

The added infrastructure is not free: +26 exterior and +84 cockpit scene-pass calls, with additional submitted triangles. The first unpaired barrier candidate cost 827 clear-cockpit calls; pairing the material chunks removes 54 of those calls without deleting either side's geometry. End-of-fixture counters changed from 94 textures / 768 geometries to 97 / 922. These are renderer counters from the defined fixtures, not a total GPU-time measurement or a 60 FPS claim. Do not conceal this cost or treat a software-GPU image check as target-hardware profiling.

## Reproduce

```sh
npm ci
npm run check
npx playwright install chromium
npx playwright test e2e/04-reference-visual.spec.ts e2e/05-cockpit-detail.spec.ts e2e/06-circuit-survey.spec.ts e2e/construction.spec.ts e2e/pit-presentation.spec.ts
```

The Playwright HTML report contains PNGs and JSON measurements. Local Linux reproduction with a system Chromium/Xvfb used `DISPLAY=:99 CHROMIUM_PATH=/usr/lib/chromium/chromium` and `--headed`; this is a test-host choice, not an application dependency. Ordinary CI uses its installed Playwright Chromium. Pixel readback and survey cameras are test code, not extra gameplay-loop work.

## Open acceptance work

The procedural car still needs stronger silhouette and aero-surface refinement, cockpit anatomy remains simplified, crowds need better silhouettes and variety, ground transitions and terrain need authored depth, and thin distant structures still need temporal-quality review. Full-lap environment density, dynamic rain/spray readability, audio fidelity and representative-hardware performance remain unproven. This pass does not repair the separate replay recording-buffer gap under producer/consumer stalls documented by the preceding milestone.

The complete human-driven section-146 scenario and the three full audits in sections 2 and 141–148 remain open. The separate AppDeploy website is not updated by a GitHub source push alone.

## Post-publication fence pass

The follow-up merge preserves the published profiled barriers and filtered catch-fence geometry while carrying forward one non-duplicative optimization from the parallel venue review: transparent double-sided chain-link now uses Three.js `forceSinglePass`, because its analytic wire coverage is symmetric and does not require separate front/back transparency passes. The shader and CPU reference also return the exact mean wire coverage when a pixel footprint spans more than 32 complete periods, avoiding cancellation between large periodic integrals at long distance. The physical barrier envelope, fence dimensions, shadow policy, track contact, and simulation state remain unchanged.

## Paddock depth and batching follow-up

The reference-led venue continuation now adds twelve genuinely open, original pit-garage bays with recessed rear walls, service furniture, glazing, roof equipment and real geometric parallax. This follow-up deliberately preserves the newer barrier, grandstand, ground-profile and catch-fence work rather than stacking the older parallel venue implementation over it. No reference pixels, commercial meshes, brand liveries or extracted assets enter the runtime.

Static scene batching now treats render ownership as part of its merge key: shadow casting/receiving, visibility, render order, layer masks and frustum-culling state survive batching, and children below a hidden ancestor are not flattened into the visible root. Five deterministic regressions cover the garage aperture/depth and these batching invariants.

The reconciled source passed **546 unit tests in 56 files**, ESLint, strict TypeScript and the production build. PR #1 head `65aa63b0edc28434bc2da092b64fe67ad93e5da8` then passed GitHub Actions run `35476640815`: validation, native physics/scenario jobs and all three complete Chromium browser shards. The same four runtime/test files were hash-verified before publication to `main`. Full normal `main` CI remains the publication gate for the tested `playable` snapshot.

This remains an incremental reference-quality improvement. One-to-one F1 25 photorealism, representative-hardware performance, the complete human-driven section-146 scenario, the three final audits and the separate replay producer/consumer archival gap remain unresolved.
