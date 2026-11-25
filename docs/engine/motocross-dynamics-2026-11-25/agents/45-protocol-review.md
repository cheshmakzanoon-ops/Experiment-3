# Assignment 45 — independent snapshot and recorded-motion review

## Conclusion and scope

No newly introduced protocol, layout, legacy-posture, or revised shift-seed defect was found in this review. The complete writer/reader path keeps the optional motocross data separate from car and road-motorcycle contact measurements. The assignment-44 localized-tangent correction remains reconstructible from the existing twelve seed fields after Float32 conversion.

One **pre-existing endpoint robustness gap** was independently reproduced: a finite but impossible front/rear mudguard displacement can reach the actual mesh morph at an exact endpoint. It is documented below for the next owner. The normal controller prevents that value in valid simulations; this is distinct from a physics or native-play regression.

This assignment changed no production source, committed tests, models, geometry, materials, environments, specifications, or git state. Its only authored source-tree document is this report. Diagnostic scripts and receipts are temporary validation artifacts. No child agents were spawned. Assignment 44 owned the gear evaluator, and assignment 40 owned the AI integration repair.

## Layout, identity, and writer ownership

The reviewed constants are **protocol 17**, **24 header floats**, **331 floats per entrant**, and **simulation version 40**. No offset or stride changed during this assignment.

| Contact-tail offset | Contract |
| --- | --- |
| +0 | Car wheel mask, or the distinct road-bike tag 16; MX remains zero |
| +1…+3 | Measured selector angle, boot cover, and clearance |
| +4…+12 | Optional machine derivatives, mudguard flex, and chain response |
| +13…+16 | Optional remount gait |
| +17…+20 | Posture marker and standing/dab/composed-body derivatives |
| +21…+32 | Foot trajectory marker, event, age, direction, six initial conditions, and split adapter clock |

`writeWheelContact` clears all 33 floats before selecting a vehicle contract. A ridden knobby `DirtBikeVehicle` writes its foot state and accepted-event seed; posture is recorded only when its live controller exists and the three rates survive Float32 conversion as finite numbers. Recovery writes the separate remount contract. The car and road readers do not acquire their measurement tags from an MX optional marker. Assignment 41 separately verifies the entire placement payload, inherited car-state poisoning, and all four car readers; this review inspected that test and the real branches rather than counting its results as a new run.

The compact recorder explicitly copies and expands the complete contact tail. This review independently compared all **66 retained tail floats across two actual-writer snapshots**, then compared playback reconstruction. No field was omitted. The full-session recorder also stores complete versioned snapshots; its schema check and page-loading paths were inspected.

`sessionIdentity()` reports physics version 40 independently of snapshot format 17. `recordCategory()` and `recordIncompatibility()` separate a v39 record from the new physics category. The optional zero-marker decoding path still accepts older format-17 poses; it does not claim that an old input journal should resimulate under the new dynamics.

## Live consumers and malformed optional fields

Both `BikeShells` and `PresentedFrame` use the common chassis presentation gate, shared posture reader, and shared foot trajectory reader. A presented interior frame clears the copied accepted-event metadata because its interpolated positions are no longer an authoritative measured seed/age pair. It is explicitly a presentation-only buffer, not another replay or physics snapshot.

The diagnostic exercised **224 corrupt-field cases**: 28 optional/control fields, four replacements (`NaN`, positive infinity, negative infinity, and a large finite value), and either endpoint. Five fractions per case exercise exact endpoints as well as interior fallbacks. The fields include machine state, posture rates, all twelve accepted-event fields, and the three bare foot positions. Primary chassis/rider positions were not corrupted; the goal is optional-data isolation, not a claim that every malformed core snapshot is accepted safely.

Together with the clock cases, the run produced **1,176 actual `BikeShells` poses** and inspected **3,800,832 world-matrix elements**, all finite. An observational wrapper passed the original arguments to the actual model pose method and retained its nine relevant input values: fork, shock, steer, standing, dab, body, angle, cover, and clearance. They agree with `PresentedFrame` within **2.0489096641540527e−8**, the measured Float32 difference. Source snapshot byte digests remain unchanged.

These checks distinguish raw control coordinates from the final articulated selector: a dab can release the boot from the selector, so the physical selector rotation is not generally identical to the raw foot-angle coordinate. The neutral-dab clock fixture additionally checks that identity. The probe does not feed a synthetic presented frame back into the authoritative recording path or require every auxiliary bone to have a unique matrix under that unsupported reuse.

Non-finite optional machine payloads fall back as a whole; non-finite posture rates keep the ordinary bounded position interpolation; malformed trajectory seeds select measured complete poses. Unmarked data retains its legacy interpretation. The large finite mudguard case below shows why “all matrices finite” is not equivalent to “every malformed morph is mechanically bounded.”

## Independent Float32 assessment of the revised gear seed

The accepted evaluator reviewed here is:

`src/simulation/offroad/mx-gear-stroke.ts` SHA-256 `b2d6e6f437835bc52e9f55c43a6ee9e073e552314f6b9ae82d3d06adbbd5f91f`.

Its far-target Bézier retains the established handoff duration. Only the incoming tangent receives the compact continuation term `v*t*(1 − t/τ)²` on its short interval. At `τ = T`, this term is algebraically the ordinary first Bézier control's contribution. Thus crossing the eligibility boundary does not switch the whole stroke to a differently timed route. When remaining travel tends to zero, only the local correction's amplitude tends to zero; the far displacement keeps its full duration.

An independent diagnostic located six continuation-boundary coordinates on reachable isolated strokes, sampled both sides at offsets down to 1e−12 seconds, and added ordinary 240 Hz and near-extremum interruption times. It then accepted both repeated and reversed commands at clock origins 0, 3,600, 86,400, and 1,048,576 seconds. Each actual initial condition and observed age was independently rounded to Float32 before reconstruction.

| Measurement | Result |
| --- | ---: |
| Accepted-command seeds | 832 |
| Reconstructed position/rate channel observations | 49,398 |
| Maximum position-channel difference | 7.104476218433575e−8 |
| Maximum derivative difference, reported without an acceptance claim | 0.00823102296113176 units/s |
| Non-finite reconstructed values | 0 |
| Mechanical position-envelope violations beyond 2e−12 roundoff | 0 |
| Changed evaluator bytes during the diagnostic | 0 |

The position requirement remains the existing **2e−5** recorded-seed agreement scale. No tolerance was increased. This is an independent quantization/branch-boundary check, not an additional mesh-clearance sweep or biomechanical rate calibration. Assignment 44 retains the physical route/rate and actual-rig acceptance for its correction. No reader, writer, or protocol change is needed by this evaluator revision.

Because the payload records a program's initial conditions, later released changes to the canonical evaluator must consider decoder compatibility explicitly. Current zero-marker legacy recordings do not depend on this new evaluator, and these changes are being integrated before the task's first publication. A future incompatible marked-trajectory meaning must not silently be treated as identical just because the numeric stride stays the same.

## Legacy comparison and clock limits

The unmarked standing/dab/body reader was compared directly with the untouched `b527a7e01ea247f0233a2ec4f2850639bafbd887` module. Both bikes, all 25 pairs of the five rider states, three fields, and seven fractions give **1,050 exactly equal scalar results**. This is a posture compatibility result; it is not an assertion that every unrelated legacy subsystem was retested.

The clock diagnostic uses actual writer, `PresentedFrame`, and `BikeShells` with controlled large clock origins. It does **not** simulate days of riding. At a supplied interpolation fraction, the split foot clock reconstructs the isolated stroke with maximum observed error below **2.984e−8**. The renderer still obeys its existing `H.TIME` gate: if two Float32 header timestamps are equal, it holds the older whole pose until the exact newer endpoint. Its local foot clock does not override that rule.

| Tested origin | Publication rate first showing repeated headers at that origin | Repeated adjacent headers in 240 tested intervals |
| --- | ---: | ---: |
| 0, 3,600, and 86,400 s | None at 15/30/60/120 Hz | 0 |
| 131,072 s | 120 Hz | 112 |
| 262,144 s | 60 Hz | 112 |
| 524,288 s | 30 Hz | 112 |
| 1,048,576 s | 15 Hz | 112 |

Higher publication rates also repeat at the later origins. These powers of two are tested examples, not a claim of a universal first problematic real-world session duration. Header quantization already changes represented interval widths before timestamps repeat. Replay fraction selection and whole-scene motion still use that header time, so precise local-foot reconstruction at a **given fraction** is not a claim of indefinitely precise requested wall-clock or replay timing.

## Existing finite mudguard endpoint gap: handoff

The real physics-side `FenderFlex.update()` clamps its position to **−0.32…1**, and the mesh bounds are authored for that envelope. The rendering helper clamps an interior cubic, but its exact-endpoint returns accept any finite recorded flex. The schema checks the contact tag rather than this optional physical range.

Minimal reproduction:

1. Begin with a valid ridden MX snapshot carrying `MX_MOTION.VALID = 1` and the zero contact mask.
2. Replace `MX_MOTION.FRONT_FLEX` or `REAR_FLEX` with the finite value `2`.
3. `sampleMxFender(a, b, car, axle, 0 or 1)` returns **2**; the corresponding midpoint returns **1**.
4. Through actual `BikeShells`, a larger finite replacement `Math.fround(1e30)` appears unchanged in the named front/rear mudguard's `morphTargetInfluences[0]` at the corresponding endpoint.

The exact same helper results were executed against untouched b527: **2 at endpoints / 1 at midpoint**, and the same Float32 1e30 endpoint. Both copies of `dirt-bike-model.ts` have SHA-256 `0eedfe6ff1db8d68de14c4855a6204f1503fadc532268622f71f455987b83566`. Its existing pose method directly applies the sampled flex to the morph. This is therefore **pre-existing and observable**, not an introduced regression or merely an unused metadata NaN.

Normal generated snapshots remain bounded, and NaN/infinite optional values correctly take the new fallback. A narrow follow-up can validate the finite physical range in the optional motion reader while preserving valid endpoints exactly; it requires no mesh/model edit. Root assigned that follow-up to the next replay/endpoint owner. This report records the pre-follow-up state and does not claim that repair has already run.

## Commands, receipts, and provenance

Run from the project checkout:

```sh
node_modules/.bin/vite-node --script test-results/a45-protocol-review/probe.ts
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/protocol-review-a45/seed-probe.mjs
```

Receipts under `/workspace/scratch/e91efca799c8/validation/protocol-review-a45/` include `probe.json`, `probe.log`, `seed-probe.mjs`, `seed-probe.json`, `seed-probe.log`, `fender-endpoint.json`, and the initial source manifest. The probe JSON stores before/after hashes for twelve production inputs, the complete clock table, actual consumer counts, and the out-of-envelope morph observations. No input changed during the accepted complete-consumer run or revised-seed run. The first captured manifest predates assignment 44's update; the accepted run explicitly uses its later hash above.

| Reviewed file | Accepted SHA-256 |
| --- | --- |
| `src/core/session-identity.ts` | `9c2873cd5420281e2d117242bb3a068a5e02be900543a590b6c5514d996d42d5` |
| `src/simulation/protocol.ts` | `eb17339446450136412f774ae2a38babcc45e7a3b2cafab638f70bf809047e0a` |
| `src/simulation/wheel-contact-state.ts` | `a2e64a4b27d4d0d11c86697836e6487a616691a35bf8976cf866c60072a4077d` |
| `src/rendering/offroad/mx-foot-pose.ts` | `2bc6a16ba88d105f452e0f73231977f67fc5f3ff7b8bb57cad4ff845e287edb1` |
| `src/rendering/offroad/mx-rider-pose.ts` | `5d8e0e8b5f967d4c3dffaa19d44aa23a92baeef4eac7edf97c9909d914259668` |
| `src/rendering/offroad/mx-machine-pose.ts` | `f80b5f0116fc6c202c47eef3bd93c0ce17498016a50d066c16e2deb02eec74db` |
| `src/storage/recorders.ts` | `38375defa0d9c3371f93801a6a4c0017dcb9f119376355e064af3f640662ca72` |
| `src/storage/replay-pages.ts` | `5156b30bbe67795225989444e18590a58825fe3cc9750d1c4f22d6cf98a7dfce` |

This is read-side numerical and actual CPU-rig verification. It does not establish GPU rendering, perceived fluidity, full-game long-session behavior, or acceptance of every malformed primary snapshot. No full unit suite, browser journey, typecheck, or publication command was duplicated by this assignment. All owned diagnostic processes have ended.
