# MotoGP rear-chassis reference review

This pass addresses the rear assembly visible in the chase and rear-quarter cameras: the swingarm silhouette, axle hardware, enclosed undertail and attached damper. It uses new Three.js geometry and the existing production materials. The references guide shapes and material relationships; the metre dimensions and suspension hardpoints are authored for this game's two GP motorcycles, rather than measurements inferred from photographs.

## Review of the original 100 images

The original `reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip` was opened again for this pass. All 100 original images were visually reviewed on ten labelled contact sheets covering REF 001–010, 011–020, 021–030, 031–040, 041–050, 051–060, 061–070, 071–080, 081–090 and 091–100. REF 018, REF 071 and REF 087 were additionally inspected at their native 1920 × 1080 resolution for the rear assembly. The contact sheets preserve original image content; no generated illustration substitutes for reference evidence.

The archive contains 10 official PlayStation Store images, 3 UI/menu references, 34 gameplay/model/track references, 49 official trailer frames and 4 store detail crops. Retain the existing review's distinction between 65 direct GP references and 35 context references. These are not 100 independent PS5 gameplay captures, and a still image does not establish the game's grip, suspension tuning or race rules.

The existing [complete reference ledger](../../MOTOGP_THREEJS_REFERENCE_REVIEW.md) and [previous production audit](../motogp-riding-refinement/REFERENCE_AUDIT.md) remain the full provenance and scope record. This document records the focused design decisions rather than duplicating that ledger.

| Integrity check | Result |
| --- | --- |
| Numbered originals | All 100; exact REF 001–100 sequence |
| Individual SHA-256 checks against `MANIFEST.csv` | 100 matching; 0 mismatches |
| Archive size | 36,997,717 bytes |
| Archive SHA-256 | `478517180397aa7022b508264e2e6383f721ea930a4035ef314e2e8fb421e7c6` |
| `MANIFEST.csv` SHA-256 | `f023269e46872465e9f69e41bb97e82be2a7d821cc28c27fa6559f8751176ef2` |
| Ordered image-hash receipt SHA-256 | `c790c78c827408c5c44f5043d8bc388bbebb7e041d145f9dbc288f04d0b3dc42` |

The ordered receipt is UTF-8 text containing one `NNN:sha256` line per image in manifest order, with a final newline. It can be reconstructed directly from the archive's manifest without storing another copy of all 100 photographs.

## Evidence to implementation

| Reference | Visible observation | Implemented response |
| --- | --- | --- |
| REF 018, “Bike and rider close-up” | The side profile has a tapered, dark carbon-covered rear arm; restrained machined adjuster hardware sits around the axle. | Closed, rounded carbon spars taper in depth and width. Thin aluminium adjuster plates, dark adjustment slots, steel axle nuts and captive tension screws provide small hard highlights. |
| REF 071, announcement trailer 48.99 s | Low rear-quarter view: the tyre and bodywork dominate; the under-tail is compact and shadowed, with limited exposed bright mechanics. | A formed 2 mm carbon tray closes the underside; a narrower, tucked damper replaces the large exposed spring. |
| REF 087, launch trailer 19.85 s | Following view: a dark tail underside above the broad tyre, with asymmetric exhaust and slim chain/axle details. | Preserve the existing exhaust, tyre, chain and pegs; reduce the bright rear-arm area and keep daylight between the tyre hugger and undertray. |
| REF 053 / 059 / 061, launch trailer 27.67 / 5.20 / 7.64 s | Racing and rear-quarter silhouettes reinforce the tyre/body mass and compact mechanical detail. | Preserve the current GP body and rider proportions; assess this smaller mechanical change from a production rear camera. |

The main original-image hashes for this scope are:

| ID | SHA-256 |
| --- | --- |
| REF 018 | `00bd3c544fc28315189390e7385bca13607075a56e9583ae9d7d460d393c05e8` |
| REF 071 | `fb52560156425a4e7af52300b22fbce2624e237d5c25b9acb852695eca106bd7` |
| REF 087 | `533e2916681ba97b49f5a69d4febc7614d8700a149d04d888a9286f789bed46f` |

The comparison also used retained production screenshots in [the prior contact pass](../motogp-contact-pass/gp-live-clear-chase.png), [wet gameplay](../motogp-riding-refinement/evidence/wet-gameplay.png) and [GP body refinement](../motogp-refinement/gpr1-after.png). Those images document the earlier product state. They are not a new same-camera before/after capture of this patch.

## Geometry and articulation

`src/rendering/gp-rear-chassis.ts` creates the GP-only rear parts. `src/rendering/bike.ts` places rigid body pieces in the existing sprung and swingarm batches. The other motorcycle families continue through their original construction branch.

The compact damper has two named attachment points: a clevis on the sprung body and a small pin on the moving swingarm. Each pose transforms those existing points, places the damper between them, and changes the coil's length. The barrel, polished shaft, collars and eyelets keep their dimensions. This is presentation driven by the existing fork/shock snapshot; it adds no suspension solver, timer, texture, material object or allocation in the pose update.

An independent sweep of actual production attachment matrices measures eye separation of 266.81–279.35 mm for GP-R1 and 265.11–277.64 mm for GP-R2, with aligned eye/pin axes. The fixed shaft and barrel retain at least 87.1 mm and 117.1 mm respectively to the opposite eye, and at least 46.6 mm of telescoping overlap. The final chain regression checks every new rear-part triangle against connected boxes enclosing the complete real chain loop, with its 16 mm axial / 6 mm radial envelope and an additional 1 mm clearance. It covers the actual GP-R1 and GP-R2 pivot-to-axle lengths at every detail level, as well as the representative constructor length. It also rejects a chain centre inside a closed solid and includes a deliberately obstructed positive control.

The first full-travel test exposed an undertray/tyre-hugger intersection. Raising the tray at the two middle rear stations corrected the shape before acceptance. Its forward clevis junction and the existing wheel, chain and peg positions remain fixed. The tests use the rear tyre radius plus a conservative 35 mm allowance for the existing hugger and require more than 8 mm of remaining vertical clearance after production sprung compression and pitch.

A later independent occupied-volume review found a second real defect that grip/peg anchor tests could not reveal: the initial outboard swingarm neck crossed the planted boot by more than 60 mm. That candidate was rejected. The final neck begins inboard of the boot and chain, moves outward below the lower chain run, and joins the retained rear-arm/axle profile. Pivot collars follow the inboard neck, and short diagonal clevis braces connect it to the unchanged lower damper pin. The rider, pegs and chain do not move to conceal the collision.

The [independent mesh-clearance receipt](mesh-clearance-validation.json) validates the corrected source after the upstream animation merge. It checks both GP motorcycles, all three detail levels, nine fork/shock combinations and both entire boots against every new rear part. Its 8 mm projection grid finds zero occupied-volume overlap across 9,533 compared columns, with at least 71 comparisons in every foot/pose case. Reinstating the rejected profile in a temporary control reproduced the original collision. The integrated unit regression uses a finer 4 mm grid and additionally checks both exact former failure columns while confirming boot material is still present there.

## Resource and verification receipt

Measured production-model costs and focused checks are recorded below. The comparison baseline is commit `9e5ff534ecf4d8391eaa7075a284b141544de7ee`; later unrelated integration changes do not alter the rear assembly.

| Model / detail | Triangles before → after | Attribute/index bytes before → after | Mesh objects before → after |
| --- | ---: | ---: | ---: |
| GPR1 / high | 109,337 → 107,617 | 4,554,128 → 4,262,688 | 109 → 114 |
| GPR1 / mid | 43,448 → 42,152 | 1,951,532 → 1,824,332 | 86 → 91 |
| GPR1 / far | 12,588 → 11,444 | 692,008 → 551,640 | 46 → 46 |
| GPR2 / high | 101,636 → 99,916 | 4,321,924 → 4,030,484 | 104 → 108 |
| GPR2 / mid | 43,008 → 41,712 | 2,009,204 → 1,882,004 | 82 → 86 |
| GPR2 / far | 9,870 → 8,726 | 617,276 → 476,908 | 44 → 44 |

Material and texture counts are unchanged at each detail level (34 materials / 19 textures for both high-detail GP models). The byte figures sum geometry attribute and index payloads from the scene inventory; they are not a GPU-memory reading.

The controlled rear-only comparison for the four other road-motorcycle families (SBK1000, SS600, NR900 and CR750), each at high/mid/far detail, retains exactly the baseline geometry and posed-transform SHA-256 values: 12 of 12 identical. All six GP chain/sprocket geometry hashes also match their baseline values. A final inventory refresh after the neck correction and upstream integrations reproduced these costs and confirmed all 12 non-GP geometry/pose hashes and six GP chain hashes against the original baseline. Every source hash in the independent mesh-clearance receipt also matches the final files. The [final rear validation receipt](rear-chassis-validation.json) preserves the exact hashes, inventories and completed unit commands.

Focused ESLint passed for the new module, production integration, unit test and browser fixture/spec. The earlier focused four-file run passed all 29 assertions: 10 rear-chassis cases, 7 production rider-contact cases, 10 chain-integrity cases and 2 motorcycle-body cases. This includes both GP motorcycles at all three detail levels through full suspension travel. The overall local command nevertheless exited 1 because Vitest reported one worker RPC `Timeout calling "onTaskUpdate"` after 557 seconds in the heavily loaded shared environment; this is not recorded as a clean completed gate. After the occupied-volume correction, the rear-chassis and chain-integrity command completed cleanly: 20 tests in two files passed, exit 0, in 86.64 seconds. Adding the actual-production-arm chain assertions was followed by the affected rear-chassis suite alone: all 10 cases passed, exit 0, in 64.53 seconds. That final run includes the finer 4 mm boot-volume sweep, both former failure columns, all six real arm/detail variants, attachment checks and held/restored resource checks. The integrated production report retains the separate final type/build/browser status.

The original rendering gates remain fewer than 110,000 expanded triangles and fewer than 220 rendered calls for the high-detail fixture. Triangle counts include expanded instanced geometry. Mesh-object counts are a CPU scene inventory, not a GPU draw-call benchmark.

`e2e/gp-rear-chassis.spec.ts` uses the actual `BikeModel` and the established scene/material/weather fixture in one fixed rear-quarter camera. It captures static dry, compressed dry and compressed wet states for GP-R1 and GP-R2, then repeats and rewinds those inputs on the same model. Assertions cover changed pose/weather pixels, identical held/restored pixels, stable resources, unchanged source snapshots and zero page/WebGL errors. Planned attachments are:

- `gpr1-rear-static-dry.png`, `gpr1-rear-loaded-dry.png`, `gpr1-rear-loaded-wet.png` and `gpr1-rear-chassis-receipt.json`;
- the same four names prefixed `gpr2`.

Browser evidence is pending the integrated browser run. The local environment has no Chromium executable, and the approved Playwright browser download failed with HTTP 503 responses. No browser pass, physical-device frame rate or equivalence to the reference game's renderer is claimed here. The integrated [production report](README.md) records the final browser/build outcome and evidence paths.
