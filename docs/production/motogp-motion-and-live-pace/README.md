# MotoGP motion, machine detail, venues, and live corner pace

This pass improves the GP-R1 and GP-R2 rider/machine connection, gives the four dedicated GP venues their own grandstand architecture, and adds a live comparison with the player's best clean corner attempt. All new visible geometry and animation are procedural Three.js code.

## Try the changes

1. Select **GP-R1** or **GP-R2**, then **Free Practice** on **Poggio Alto**, **Cape Wrenna**, **Haarveld**, or **Montejaral**.
2. Ride a complete clean corner entry, apex, and exit to establish a personal reference. On the next attempt, the practice card compares elapsed time at the same road position. A negative value means the current attempt is ahead.
3. Compare the exit speed as well as the time. A quicker entry that hurts the exit is easier to identify when both appear together.
4. With the default keyboard mapping, use **Left Shift** for the independent rear brake. The right boot and pedal move together; the front brake does not animate the rear pedal.
5. Use **C** to change camera. Pause with **Escape**, then **Watch Replay** to inspect cornering and braking from the recorded session.

Personal records last for the current session. Compound and surface-condition comparisons are separate; a machine, assistance, or track reset starts a fresh comparison. AI demonstration and replay do not bank human practice attempts. An interrupted, dirty, or discontinuous run cannot replace the best clean attempt.

## Bikes and riders

### Physical rearsets

Both GP machines now have open machined hangers, bevelled edges and actual cutouts, carbon heel guards, hollow serrated pegs, and a connected rear brake pedal. The retained footpeg anchors keep the existing riding fit. The hanger and pedal arm sit inboard of the boot to avoid the penetration discovered during contact inspection.

The fixed components join the existing aluminium, steel, and carbon batches. The close representation adds one articulated pedal draw. This introduces no new material, texture, shader, or frame callback. The authored rearset kit contains approximately 3,680 / 1,624 / 360 triangles at high / medium / far detail.

### Connected animation

The GP helmet is solved relative to the road before removing the torso, sprung pitch, and chassis roll transforms. This corrects the previous interaction between tuck and lean that could point the face outside the corner or down into the road. The rider looks into the bend at speed and uses more steering-led gaze in slow manoeuvres. The head keeps some natural bank rather than remaining rigidly level.

The inside knee opens and retracts continuously as the hips move across the saddle. This removes the abrupt pole change at the centre of a chicane transition. The right boot rotates around its retained footpeg contact while its sole and the pedal share one actuation function. The shin follows the solved ankle.

Every new pose depends on presented snapshot values. There is no accumulated animation clock, so a held frame or replay seek returns to the same pose. Other road-bike and motocross motion retain their previous paths.

## Four venue identities

| Venue | New architecture | Safe stand count |
| --- | --- | ---: |
| Poggio Alto | Raised eaves, warm exposed steel, cream roof, oxblood and green seating | 8 |
| Cape Wrenna | Scalloped coastal sail, blue-grey structure and seating | 6 |
| Haarveld | Repeated folded crown roof and blue seating | 7 |
| Montejaral | Curved sun visor, warm stone and sand palette | 6 |

Thin closed roof shells, visible cantilevers, rear masts, bracing, terrace supports, footings, circulation rails, and printed fascia replace the generic GP stand structure. Each venue now carries its own name instead of Aurel branding. Each stand's architecture uses five merged batches; safe existing seating and crowd arrangements are retained.

The placement review also found two Cape Wrenna terraces crossing back into their own curved track corridor. The GP site filter now samples the full stand footprint against the physical boundary. Sites at 549 m and 1,186 m are excluded, and the later safe authored site at 3,859 m fills one place. Cape Wrenna therefore has six safe stands instead of seven. The riding route and track physics are unchanged.

## Practice gameplay

The prior corner timer recorded an attempt's final time. It now retains 32 spatial splits from the fastest complete clean attempt and compares the current elapsed time at the same position. This follows the player's actual pace profile through braking, apex, and exit instead of scaling the best final time into a constant-speed target.

The trace uses original simulation samples and interpolated crossings. Waiting continues to cost time; duplicate pause samples cannot improve a score. Faster valid runs replace the complete reference trace. Slower, incomplete, or invalid runs cannot corrupt it. The live value is interpolated between the fixed splits; final entry and exit timing keeps the existing crossing interpolation.

At the exit, the card reports time gained or lost and speed relative to the previous fastest complete attempt. Rounded zero uses `±0.00 s`, avoiding a misleading signed zero. This is optional personal practice feedback and does not change the riding controls or simulation.

## Reference use

The supplied 100-image archive was verified against its manifest. All 100 numbered images were reviewed on ten contact sheets, with selected original-size inspection for machine construction, rider posture, and architecture. The full-size selections were REF_004, REF_018, REF_032, REF_036, REF_065, REF_071, and REF_077.

- [Reference integrity receipt](reference-integrity.json) records all 100 hashes and the archive hash.
- [Reference-to-implementation mapping](reference-review.json) records which observations informed each change and the limits of that evidence.

The pack includes non-GP riding and interface imagery as well as racing views. Still images informed posture, construction, and visual proportions; they do not measure real human motion or timing curves. All designs and movement curves here are authored. No reference-game pixels were added to runtime assets.

## Verification and scope

The final commands, source fingerprint, browser outcomes, and compact evidence receipts are recorded in [validation.json](validation.json). Rendered examples are under [evidence](evidence/).

Passing focused checks cover foot/peg/pedal contact, road-relative helmet attitude, continuous knees, clean-attempt timing and invalidation, graphics-cadence independence, GP architecture and track clearance, retained crowd layout, and identical held/restored snapshot renders.

The complete production riding/replay test was attempted twice with its existing workload and deadlines. Both attempts timed out before the session entered riding: the first exhausted the overall test deadline after circuit construction, and the second reached graphics preparation but exceeded the session-entry deadline. These attempts do **not** verify manual riding, camera switching, pause, recorded replay, or resume. Compact trace-derived receipts preserve both failures. The traces do not establish a motorcycle-construction deadlock: the first only reached that stage near its deadline, and the second advanced past it. The remaining full-session validation gap is explicit.

The browser evidence predates the concurrent physics-v14 update. That update was subsequently preserved on main; none of this pass's GP rendering or HUD source files changed during integration. The final build and focused logic checks were rerun on the combined source. Exact source fingerprints and provenance are recorded in the validation receipt.

The browser renderer is Mesa llvmpipe through Chromium, which is software rendering. The focused checks verify correctness and resource behavior; they do not establish performance on a physical GPU. The focused fixtures isolate actual production models and materials; their plain stage backgrounds are not finished track screenshots. Both full-session attempts used Low graphics.

This remains a procedural game rendering style. The work improves construction, movement, and venue recognition, but does not claim photographic realism, scanned anatomy, motion capture, or parity with a commercial MotoGP title. Wheelie pitch is not cancelled by the helmet's suspension compensation. The supplied images are references, not numeric biomechanical measurements.
