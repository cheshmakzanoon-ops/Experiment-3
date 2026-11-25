# Assignment 32 — live suspension pose reaches the existing rig

## Result and scope

Added `tests/motocross-live-pose-coherence.test.ts`: eight passing moving-trace regressions through the production `BikeShells` consumer. No production files, model definitions, meshes, materials, terrain, vehicle specifications, or existing tests were changed. No git operations were performed.

The outgoing current-pose suspension strokes and bounded reversal interpolation reach the existing fork, wheels, and swingarm coherently. No additional renderer suspension filter or newly reproduced rig timestamp defect was found. This conclusion does **not** establish exact wheel/terrain contact: the existing reduced force-contact coordinates and articulated drawing differ substantially on steep faces, as quantified below.

## Independent coordinate oracle

The test reads the real drawn front wheel, sliding fork lowers, rear hub, and articulated swingarm. Its oracle expands the existing mount algebra independently; it does not call `MotocrossAxles.hub`, `rearHub`, or `lowerY`, and it does not pose a second model as a reference.

Bike coordinates are +Y up, +Z forward, and +X along a neutral axle. For final physical pitch `p`, CG height `Y`, longitudinal arm `a`, fixed free reach `H = cgHeight + factorySag`, and sampled terrain height `h`, the reduced outgoing stroke is:

`stroke = clamp(h - (Y + a*sin(p) - H*cos(p)), 0, travel)`.

Front `a` is `cgToFront`; rear `a` is `-cgToRear`. The force compression remains the incoming quantity. The test independently checks the final gap before checking the actual downstream joints; the existing assignment-13 suite owns force-law evaluation.

The drawing converts vertical fork travel through the existing 0.47 rad rake. In local coordinates, with `df = fork - factorySag.fork`, steering `s`, and axle offset `o = 0.022 m`:

- Front hub X: `o*sin(s)`.
- Front hub Y: `frontRadius - cgHeight + df + sin(rake)*o*(cos(s)-1)`.
- Front hub Z: `cgToFront - tan(rake)*df + cos(rake)*o*(cos(s)-1)`.
- Rear hub Y: `rearRadius - cgHeight + shock - factorySag.shock`; rear Z follows the fixed-length circular arm about `(0, -0.36, -0.15)`.

The physical body-to-root mapping is also checked independently at every recorded state. Its rotation is yaw, then nose-up pitch `p + 0.06*automaticBody`, then crown-corrected lean. Its height is the physical CG lowered by `(cgHeight-crownRadius)*(1-cos(chassisLean))`. Manual fore/aft input stays neutral in these traces, so the recorded rider body equals automatic posture. The additional posture angle reached 0.05854 rad; ignoring it would produce a false contact/coherence diagnosis.

The actual model root must equal the presented host pose. Its sprung group must apply no second heave or pitch. Both hub world positions and axle directions must match the independent algebra, the arm endpoint must meet the rear hub, actual joint strokes must remain inside mechanical travel, and all four `PresentedFrame` wheel compression/length channels must describe those same strokes.

## Live coverage and measured errors

Eight six-second traces combine MX250/MX450, Valley Ridge/Arena Nord, and jump/whoops. They use the ordinary production `Simulation` vehicle/track/frame writer, placement 12 m before RIDGE TABLE, TABLETOP, or the first whoop section, and `rideLine()` controls. Approach speeds are 13.5 m/s, 13 m/s, and 8 m/s respectively. Every physical step is 1/120 s; no contact or chassis pose is fabricated. The direct adapter rig supplies only the snapshot time.

There are 5,768 recorded physical states including initial placement, 11,520 ordinary actual-rig poses at common 120 Hz display times from 30/60 Hz publication pairs, and 736 additional LOD/pause/seek poses: **12,256 actual rig poses** total. The ordinary pairs exercise fractions 0.25, 0.5, 0.75, and 1; selected dynamic/contact intervals additionally exercise 0.125 and 0.875. High, mid, and far representations produce identical root/joint/hub matrices for the same requested pose after camera changes, unrelated endpoints, reverse-order queries, and repeated pause samples.

All eight traces remain riding with zero crashes and contain takeoff, touchdown, and one-axle support. Per trace, takeoffs/landings range from 2 to 10 and one-axle physical states from 125 to 283. Maximum physical pitch reaches 0.613 rad, dynamics lean 0.331 rad, and steering 0.184 rad.

| Bike | Venue / trace | 30 Hz mean / maximum hub error | 60 Hz mean / maximum hub error | Actual recovered joint extrema |
| --- | --- | ---: | ---: | ---: |
| MX250 | Valley jump | 0.776 / 38.574 mm | 0.146 / 15.170 mm | 48 |
| MX250 | Valley whoops | 0.606 / 8.304 mm | 0.130 / 5.721 mm | 86 |
| MX250 | Arena jump | 0.680 / 38.952 mm | 0.156 / 22.418 mm | 15 |
| MX250 | Arena whoops | 0.782 / 54.773 mm | 0.188 / 34.114 mm | 22 |
| MX450 | Valley jump | 0.758 / 30.106 mm | 0.146 / 16.328 mm | 58 |
| MX450 | Valley whoops | 0.676 / 13.732 mm | 0.132 / 5.015 mm | 41 |
| MX450 | Arena jump | 0.747 / 45.399 mm | 0.153 / 13.081 mm | 13 |
| MX450 | Arena whoops | 0.762 / 31.279 mm | 0.161 / 21.810 mm | 25 |

Here “hub error” compares the drawn world hub to its independently reconstructed physical pose at the same intervening 120 Hz time. It includes root/joint interpolation approximation and Float32 publication. Across all traces the means are **0.723 mm at 30 Hz** and **0.152 mm at 60 Hz**. Lower publication frequency is not asserted to reproduce every unobserved event exactly.

The distinct consumer-coherence error—drawn hub versus the algebra of the **same presented** pose—is at most **1.655e-8 m**. Published endpoints versus the full-precision physical expectation differ by at most **4.199e-6 m**, principally world-coordinate Float32 quantization. All 1,440 shared 30/60 Hz publication endpoints have exactly identical inspected matrices.

The 308 recovered extrema occur in actual articulated joints outside the endpoint stroke envelope but inside physical travel, with corresponding extrema in the intervening physical samples. Their summed absolute error is 0.12952 m versus 0.44371 m for the minimum error imposed by endpoint-only bounds. This checks that reversal reconstruction survives the actual model consumer.

Incoming force compression differs from the outgoing stroke by 19.13–70.39 mm at the per-trace peaks. Applying a counterfactual additional 20 ms filter to the outgoing strokes would displace a visible hub by 37.29–111.63 mm. The native actual-rig endpoint checks reject that delay.

### Largest interpolation residual

The 54.773 mm result is MX250/Arena whoops, tick 695 (5.79167 s), front hub, between ticks 692 and 696. Both recorded wheel contact flags remain loaded, and bottoming remains zero. A separate read-only direct-adapter reproduction shows the unobserved final solver step:

| Quantity | Tick 695 | Tick 696 |
| --- | ---: | ---: |
| Front sampled terrain height | 0.041883203 m | 0.164408711 m |
| Outgoing fork | 0.099251745 m | 0.218865087 m |
| Front force | 1,469.101 N | 7,016.981 N |
| CG height | 0.916021466 m | 0.913192289 m |

The 122.526 mm terrain-height increase within one 8.33 ms solver step is unresolved by that publication interval. The reconstruction spreads this change before the measured final step. This is a limitation of reconstructing sparse samples, not a mismatch between the displayed scalar and the actual rig. No new event-timing claim, production correction, or weakened check was introduced.

## Existing force-contact versus visible-wheel discrepancy

The test measures 6,085 loaded, non-airborne axle states with final gaps strictly inside travel. It derives a rounded-tread support point from the actual hub/axle convention and existing radius/width, first against the force-patch normal and then sampling the actual terrain at that different horizontal location. It deliberately does not assert zero distance to the reduced force point.

The worst terrain residual is **−364.167 mm**, MX450/Arena jump, tick 137 (1.14167 s), rear wheel. Physical pitch is 0.612956 rad, additional posture pitch 0.007047 rad, dynamics lean −0.055387 rad, rear stroke 0.136099 m, and incoming rear force 4,387.478 N.

- Reduced force point: `(47.079907, 1.030366, 21.594533)` m.
- Coherent authored hub: `(46.687578, 1.277712, 21.626294)` m.
- Analytic rounded-tread support: `(46.522284, 0.975543, 21.644408)` m.
- Terrain height at that support X/Z: `1.339711` m.
- Signed discrepancy along the force-patch normal: `−0.316298` m, decomposed into `−0.311568` m from the existing articulated/rounded-wheel versus reduced-force geometry and `−0.004731` m from posture/crown root mapping.

The existing force patch uses fixed horizontal CG-to-axle arms; the drawing rotates the complete lower hub offsets and samples support farther up the face. That difference exists even with perfectly synchronized suspension. The inspected `dirt-bike-model.ts` and `motocross-axles.ts` are byte-identical to the read-only `b527a7e0` baseline. That baseline also has the same fixed-horizontal force-point, pitch-gap, posture-pitch, and crown-drop conventions. The numerical decomposition explains the current-pose discrepancy without attributing it to the new publication correction. It is not a claim that the exact baseline trajectory has the same maximum.

This support diagnostic is analytic rounded-tread geometry, not a GPU/triangle penetration measurement. It identifies a substantial pre-existing modeling limitation; it is not presented as acceptable physical wheel contact. Correcting it would require separately owned contact/geometry-convention work. No protected definitions were modified.

## Reproduction, validation, and limits

```sh
MX_POSE_REPORT=1 node_modules/.bin/vitest run tests/motocross-live-pose-coherence.test.ts
node_modules/.bin/eslint tests/motocross-live-pose-coherence.test.ts
```

Final run: **8/8 passed**, 19.84 s total, 15.46 s test execution. Focused ESLint passed. Test SHA256: `4816049da122be1d3cb43e8f9b872e0d059c721263699f01361cfeb831e6eb06`.

The two publication rates decimate the same physical trace; independent publication-schedule side effects belong to the existing cadence suite. This assignment verifies 120 Hz physical stepping, direct adapter publication, the real `BikeShells` consumer, and deterministic joint matrices. It does not claim worker/browser scheduling, physical GPU performance, 240/480 Hz convergence, exact terrain conformity, perceptual quality, or additional foot/character mesh acceptance. No full TypeScript run was started; the coordinator owns that gate.
