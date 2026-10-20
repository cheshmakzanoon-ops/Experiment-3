# MotoGP: connected controls, rider deformation and corner feedback

## Delivered scope

This pass restores the exact 18-file pending MotoGP patch after the previous working environment and approval expired. It improves GP-R1/GP-R2 mechanical presentation, rider clothing deformation, four circuit landmarks and personal corner-practice feedback. It does not replace the motorcycle physics solver, redesign circuit layouts or establish commercial-game photorealistic parity.

### Bikes: connected front controls

`GPFrontHydraulics` adds a supported radial master-cylinder assembly, reservoir feed, paired-caliper crossover and fork-mounted guide brackets. The two compliant hoses join the existing caliper leads to the steering guides through suspension travel. GP-R1 and GP-R2 receive High and Mid versions; Far silhouettes and other motorcycle families retain their prior path.

The geometry follows absolute recorded fork displacement, not elapsed rendering time. A shared 32-interval shape table avoids a per-frame length solve over normal travel. The animated mesh has 350 vertices at High and 182 at Mid. Tests cover anchor attachment, fork clearance, mirrored winding, bounds, reuse and deterministic pose restoration. This is visible hydraulic hardware and hose animation, not a new fluid-pressure simulation.

### Riders: shoulder and hip volume

Three short attachment frames and a Hermite centreline replace the two-frame garment-root blend that could pinch the shoulder and hip. Cross-sections follow quaternion-interpolated frames while retaining the existing surface topology. Two precomputed position/normal morph targets gather and relax small folds according to solved root and joint flex.

The sewn openings, protected joint rings and cuffs remain fixed. Existing grip, peg and joint targets are unchanged. The new regression sweep checks tuck, braking, both hang-off directions and recovery poses at High and Mid detail. It also checks replay restoration and absence of per-pose garment buffer uploads. This is authored deformation, not motion capture or a general cloth solver.

### Circuits: four identifiable control buildings

The GP paddock control-building path now uses original venue-specific architecture: Poggio Alto has stepped terraces and a terracotta pier; Cape Wrenna has an oval coastal lookout and raked supports; Haarveld has an angular glazed lantern and folded roof; Montejaral has deep shade edges and vertical screens.

Each keeps the existing tower station and a bounded 14 by 14 metre footprint, with the foundation aligned to the banked garage frontage. Construction checks cover road clearance, window visibility by raycast, finite geometry, seven merged material meshes, fewer than 3,500 triangles and one 1024 by 256 identity texture per building. These are construction budgets, not measured full-scene GPU performance. Non-GP courses retain the previous building path.

### Gameplay: entry and exit feedback

Free Practice now reports entry-to-apex and apex-to-exit times. Later attempts compare both phases with the same fastest complete clean run, rather than inventing a target from unrelated best splits. A fast entry followed by a slow exit therefore becomes distinguishable from a genuine whole-corner improvement.

The timing uses interpolated crossings of original simulation snapshots. Existing clean-streak and eligibility rules remain: replay, AI handoffs, cuts, contact, discontinuities and pit assistance cannot improve a manual record. The added split text is hidden in compact landscape layouts; the existing speed and control readouts retain priority.

## Reference review

The source remains `reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip`, checked against `docs/MOTOGP_R3_REFERENCE_INDEX.md`. All 100 REF image payloads matched the published SHA-256 records and were unique. During recovery, all 100 were visually reviewed in five 20-image contact sheets; this is not a claim that every original was reopened at full resolution.

| Work | Relevant existing references | Interpretation |
|---|---|---|
| Brake hardware and routing | REF_018, REF_022, REF_065, REF_076 | Connected mechanical layers and routing; dimensions are authored, not inferred measurements. |
| Rider garment | REF_071, REF_098 | Fitted limb silhouettes and continuous attachment; motion response is authored. |
| Control architecture | REF_032, REF_062, REF_077 | Supported observation volumes, recessed glazing and recognisable pit-row endpoints. |
| Corner feedback | REF_015, REF_027, REF_035, REF_083 | Compact peripheral feedback, not copied commercial interface assets. |

No supplied reference image is used as a new runtime game texture in this pass.

## Recovery and source identity

The recovered patch SHA-256 is `e99c4fb219a779045e32239224353eb68325c94cea3d50e3141a145fcccf1270`.

Local validation used the verified source artifact for `81ee98b646ce88fe0d48f427f5e80e9a65fcc347` plus the recovered patch. Its source ZIP SHA-256 is `0029b46b87f00dd4aa90b2b3be7a926558a0401951d1c023aacee0e5e2e9bfe3`.

The exact Three.js 0.180.0 runtime was recovered from that revision's existing production sourcemaps for isolated execution. The old production build itself was not rebuilt with this patch and is not a delivered patched build. Temporary dependencies and verification adapters are not application changes.

Remote Festival changes through `47de488ddefb3c2a4d3daf513d0841c7c0ea6d07` were compared with the recovery baseline and do not overlap these 18 paths. Publication is based on that newer remote tree so those changes and the existing physics and motocross work are preserved. Local receipts do not establish full integrated verification of the later Festival tree.

## Validation completed during recovery

| Check | Result and scope |
|---|---|
| Recovered patch | All 18 files apply cleanly; uploaded Git blob hashes match the recovered local bytes. |
| Focused regression bodies | 103 passed, 0 failed, 0 skipped across nine files using a standalone Node assertion adapter. This was **not** a normal Vitest invocation or the full unit suite. |
| Content validator | Production `scripts/validate-content.ts` completed: `Content valid`. |
| TypeScript syntax | All 16 changed TypeScript files transpile without diagnostics. This is **not** semantic typechecking. |
| Reference integrity | 100/100 hashes matched; 100 unique REF payloads. |
| 3D component review | Module import succeeded, but Chromium could not create a WebGL context. No resumed 3D screenshots or visual acceptance are claimed. |
| Offline HUD review | The separate Blob-module fixture failed to import before assertions; no responsive-browser pass is claimed. |
| Full build, lint and CI | Not completed locally. Locked dependency installation was unavailable; the requested offline-workspace job had no artifact at the last check. |
| Full riding/replay and device FPS | Not verified in the resumed environment. |

The 103 focused cases cover `gp-front-hydraulics`, `gp-rider-deformation`, `gp-rider-garment`, `gp-race-control`, `gp-corner-practice`, `gp-radial-caliper`, `gp-brake-rotor`, `gp-rider-contact` and `gp-rider-glove` test files. Their committed test bodies remain ordinary Vitest tests. A temporary external adapter mapped the used assertion/hook API to Node's test runner; it did not change application code or suppress failed assertions.

The focused MotoGP workflow includes the added lint/unit targets and paddock review. Existing build, browser deadlines, full validation and publication gates remain in place. A source commit must not be interpreted as a passed build, a deployment, or completed visual acceptance.

## In-game review path

After a build of this source passes validation, choose GP-R1 or GP-R2 and Free Practice on Poggio Alto, Cape Wrenna, Haarveld or Montejaral. Ride manually through a complete clean corner, then repeat it to compare entry and exit phases. Inspect the controls under braking and fork compression, and the rider's shoulder/hip transitions during tuck and direction changes. The new circuit landmarks are beside the pit facilities, not new track layouts.
