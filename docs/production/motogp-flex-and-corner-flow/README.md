# MotoGP rider flex, connected controls, and corner flow

This pass improves the GP-R1 and GP-R2 connection between rider and machine, gives the four dedicated GP venues consistent track-edge identities, and adds a clean-corner streak to Free Practice. The work uses procedural Three.js geometry, skinning, and material shaders. It builds on the existing rearsets, road-relative gaze, continuous knee movement, venue architecture, and personal corner-pace comparison.

## Try the changes

1. Start the app with `npm run dev` and open the address printed by Vite. Select **GP-R1 Prototype** or **GP-R2 Prototype**, **Free Practice**, and **Poggio Alto**, **Cape Wrenna**, **Haarveld**, or **Montejaral**. **Sport** assists provide the existing assisted riding setup.
2. Use **W / S** for throttle/front brake and **A / D** to steer. **Left Shift** operates the independent rear brake. These are the [default bindings](../../../src/input/bindings.ts); saved custom bindings take precedence.
3. Use **C** to change camera. In a close view, compare a tuck, upright braking, and a leaned corner: the waist bends while the hands and feet retain their control contacts. The right index and middle fingers cover and squeeze the front lever when its high-detail representation is active.
4. Complete a clean entry, apex, and exit, then link the next corner. The practice card shows corner time, comparison with your best clean attempt, exit speed, **CLEAN STREAK**, and the next corner to connect. A negative time delta means the current run is ahead of your own best pace at that road position.
5. Pause with **Escape** and choose **Watch Replay** to inspect recorded riding. **G** toggles the existing AI demonstration; AI driving and replay do not earn human practice records or streaks.

## Rider and bike animation

### A connected, flexible racing suit

[GpRiderSpine](../../../src/rendering/gp-rider-spine.ts) distributes the torso over pelvis, lumbar, and chest frames. A tuck increases spinal flex, braking reduces it, and cornering adds bounded waist twist and lateral bend. The existing saddle position remains the pelvis anchor. The shoulders, sleeves, helmet, and gaze follow the chest; hips and trouser attachments follow the pelvis.

The torso, armour, zipper, collar, and panels share skin transforms, so their attachment follows the suit as it bends. The existing hand/grip and boot/peg targets remain the constraints for the limb solve. Recovery explicitly restores the existing rigid slide, jog, and remount pose. All new articulation is computed from the presented snapshot, with no accumulated render-time spring or animation clock.

### Fingers follow the actual front lever

The high-detail right glove has articulated index and middle fingers with fixed segment lengths. Their targets come from the real moving brake blade after steering transforms; the rest of the hand retains its grip. A swept, rounded blade replaces the former straight bar while retaining its hinge and existing aluminium material. Its contact surface sits within the glove's authored reach.

[gp-front-brake.ts](../../../src/rendering/gp-front-brake.ts) defines the blade, contact points, and squeeze angle; [GpBrakeFingers](../../../src/rendering/gp-brake-fingers.ts) solves the finger joints. Presented front-brake input drives both. Rear-pedal input does not squeeze the front lever. Release, recovery, and invalid numeric front-brake input have explicit fallback poses.

### Detail and resource scope

- The flexible torso applies to **high and medium GP riders**. Distant GP riders retain the existing rigid representation. Other road kits keep their existing path; the merged motocross path retains the upstream compression and landing response.
- Articulated brake fingers and the swept blade apply to **high-detail GP bikes**. The fingers add one skinned hand mesh using the existing glove material and a ten-bone palette. The blade replaces its existing mesh.
- The torso uses one shared three-bone skeleton and preserves its original material batching and triangle count. Animation updates bone transforms; it does not rewrite or upload vertex buffers each frame. Owned skeleton resources are disposed with the rider.

These are resource-design constraints, not a claim about frame rate on a physical GPU.

## Four track-edge identities

[gp-edge-design.ts](../../../src/rendering/venue-kit/gp-edge-design.ts) assigns one coherent kerb and paved-apron scheme to each GP venue.

| Venue | Kerbs | Paved apron |
| --- | --- | --- |
| Poggio Alto | Tuscan red and warm stone | Sage green |
| Cape Wrenna | Coastal blue and chalk | Blue-green |
| Haarveld | Heath blue and ochre | Deep blue, with ochre markings |
| Montejaral | Oxide red and limestone | Warm red-brown |

The paint follows the actual bend on each side: a broad outside entry/exit apron and a shorter inside apex apron. Straights keep a narrower outer band. The existing grain, paint wear, tyre dirt, and weather material chain remain active. The four original palettes replace generic corner-by-corner colour cycling on these GP venues.

The painted envelope is stored once as a geometry attribute. It adds no track draw calls, does not move the road vertices or change grip, and supplies no ideal racing line or safe-speed recommendation. Other venue families retain their existing palette selection.

The kerb height calculation now uses `Track.inPitLane`, matching track sampling and contact geometry. This corrects visible raised kerbs across flat pit entries and merges, including Cape Wrenna's left-side pit lane. The correction changes rendered kerb height to match the existing physical surface.

## Clean-corner practice

[GpCornerPractice](../../../src/ui/gp-corner-practice.ts) now links complete clean corners in their actual order around the road, including the lap seam. The HUD retains the result briefly after an exit, then shows the current streak, session-best streak, and next corner between attempts. Existing personal time and exit-speed comparisons remain available.

A dirty or interrupted run breaks the current sequence: this includes crashes, off-track riding, pit control, warnings or penalties, a skipped corner, replay, AI handoff, and discontinuous snapshots. Earned corner records and the best streak survive those interruptions. Duplicate pause snapshots cannot award another corner, and waiting still costs time.

Records are session-only. Corner-time comparisons remain separate for tyre compound and dry/damp/wet conditions; changing either breaks an active sequence. Changing machine, assistance, track, or session resets the records. This is personal practice feedback with no new physics, automatic controls, persistent rewards, or replay-state changes.

## Reference use and limits

The supplied [100-image archive](../../../reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip) was checked against its manifest: **all 100 numbered images matched their hashes, with 100 unique image payloads**. The archive hash, individual image hashes, review scope, and source mapping are recorded in [reference-review.json](reference-review.json). Review covered all five original contact sheets and selected original-resolution rider, machine, and track views.

| References | Implementation observation |
| --- | --- |
| 018 | Curved back and anchored controls in a tuck |
| 065 | Raised chest and glove/grip/lever relationship |
| 071 | Asymmetric hips and waist at an apex |
| 076 | Cockpit mechanical spacing |
| 057, 073 | Glove construction only; neither establishes brake actuation |
| 015, 025, 027, 031, 033, 044, 045, 047 | Coherent kerb/apron relationships and corner-edge composition |

Still images guide visible construction and proportions. Joint dimensions, timing, deformation limits, and the four venue palettes are authored; the images are not motion capture or dimensional measurements. The venues remain original designs. No reference photograph, screenshot, or third-party game asset was added to runtime assets.

The result remains a procedural game rendering style. This pass improves connected motion and track readability without claiming full photorealism, scanned anatomy, or parity with a commercial MotoGP title.

## Validation and evidence

The integration record is [validation.json](validation.json). It distinguishes the final physics-v16 source from the earlier successful physics-v15 build and browser evidence. The final merged rider passed the 23-check GP/MX integration run and its scoped lint/format checks. The full production build for this final source also passed. Two earlier broader browser journeys exhausted their original overall deadlines; their partial results remain separate from passing checks.

| Verification | Outcome |
| --- | --- |
| Final physics-v16 shared-rider integration | **23 passed in four files**: GP spine (7), brake fingers (6), motocross rider motion (6), and motocross control animation (4); 97.79 seconds |
| Final merged `rider.ts` lint and formatting | ESLint and Prettier passed with exit code 0 |
| Final physics-v16 `npm run build` | Passed: pinned asset check, full TypeScript check, and Vite production bundle; 766 modules transformed |
| Earlier physics-v15 `npm run build` | Passed: pinned asset check, full TypeScript check, and Vite production bundle |
| Earlier focused MotoGP unit checks | All 159 checks passed across the initial run and a targeted correction rerun; the corrected assertion follows the new shared lever stroke |
| Earlier track material/kerb checks | 21 passed, including 12 that overlap the focused MotoGP run |
| Earlier physics-v15 integration | 47 passed across rider spine, brake fingers, bike animation, and off-road suspension compatibility |
| Earlier GP brake and rider browser proofs | Three Mesa cases passed, including hold/rewind restoration, moving control contacts, and stable resources |
| Earlier four-venue edge browser proof | The first SwiftShader run passed all four dry/wet/restored schemes; a later artifact-retention run timed out |
| Earlier practice timing/streak HUD | Passed across viewport/text scales and handoffs after the portrait spacing fix |
| Earlier broader motorcycle HUD | Incomplete at the 300-second deadline. A separate 36-sample production-cue diagnostic matched every expected message; it does not replace the browser result |
| Earlier production riding/replay journey | Reached manual riding, independent rear brake, AI handoffs, chase, cockpit, and the pause menu. The 300-second deadline fired at the pause poll; the recorded worker response confirmed pause just after that deadline. Replay navigation and resume were not reached |

The publication source preserves upstream physics-v16 commit `84472529313a7f8912513eeb1b698566fab1b2bc` (parent tree `b7454fb524dbc152b18d21fd031c42773cd43c54`). The shared `rider.ts` conflict was resolved and reviewed to retain both GP spine/fingers and every incoming `sampleMotocrossRiderMotion` contribution: pelvis absorption, torso pitch, elbow lift, gaze pitch, and motocross head roll. The final source fingerprint is `740e256cc3b5a6922d5342e99d61c1ebe61f3268ee63ff5bac0d320a677fe5ee`, covering 785 source-identity files.

The final completed production build matches the physics-v16 fingerprint above. The earlier successful physics-v15 build, fingerprint `74eaa92f5373cf941a7942bc3bccd82caf8179878a3eda8706f5d444956c250b`, on parent `ca9e09861a7fa8b5dfc73dda7b5fad626294512d`, is preserved separately for the browser evidence it supports. **Every retained browser result predates the physics-v16 motocross merge.** The model and track component proofs preceded physics-v15; the corrected practice HUD and production riding attempt used the later v15 integration. Those captures and outcomes are historical evidence, and do not establish browser verification of the final v16 source.

Selected original captures from those earlier stages are retained under [evidence](evidence/): [released brake](evidence/gpr1-lever-released.png), [squeezed brake](evidence/gpr1-lever-squeezed.png), [articulated rider](evidence/mesa-gpr1-rider-corner-actuated.png), [Poggio edge materials](evidence/poggio-alto-dry.png), and [portrait practice HUD](evidence/final-gp-corner-practice-390.png). These isolate production components. The [actual chase](evidence/fullflow-02-gp-moving-chase-guide.png) and [cockpit](evidence/fullflow-03-gp-moving-cockpit-guide.png) captures come from the earlier v15 production game at the existing Low preset used by the functional test.

| Regression coverage | Source |
| --- | --- |
| Fixed finger lengths, actual moving blade contacts, held/restored poses, unchanged geometry buffers, resource disposal | [gp-brake-fingers.test.ts](../../../tests/gp-brake-fingers.test.ts), [gp-brake-lever.test.ts](../../../tests/gp-brake-lever.test.ts) |
| Planted pelvis, chest/seat skin attachment, bounded deformation, remote scene roots, exact recovery restoration, non-finite brake fallback | [gp-rider-spine.test.ts](../../../tests/gp-rider-spine.test.ts) |
| Preserved incoming motocross landing/compression motion and connected control animation after resolving the shared rider | [motocross-rider-motion.test.ts](../../../tests/motocross-rider-motion.test.ts), [motocross-control-animation.test.ts](../../../tests/motocross-control-animation.test.ts) |
| Sleeve/trouser continuity, physical hand/foot contacts, garment and material budgets | [gp-rider-silhouette.test.ts](../../../tests/gp-rider-silhouette.test.ts), [gp-rider-contact.test.ts](../../../tests/gp-rider-contact.test.ts), [gp-rider-suit.test.ts](../../../tests/gp-rider-suit.test.ts) |
| Four palettes, inside/outside envelopes, lap-wrap continuity, unchanged road topology, pit kerbs, shader variant identities | [gp-edge-design.test.ts](../../../tests/gp-edge-design.test.ts) |
| Road-order streaks, lap seam, interruption handling, retained records, session resets, cadence-independent personal timing | [gp-corner-practice.test.ts](../../../tests/gp-corner-practice.test.ts) |

Focused browser checks are defined in [gp-brake-lever.spec.ts](../../../e2e/gp-brake-lever.spec.ts), [gp-edge-design.spec.ts](../../../e2e/gp-edge-design.spec.ts), and [motorcycle-presentation.spec.ts](../../../e2e/motorcycle-presentation.spec.ts). Their fixture renders isolate production components. The [complete riding-flow test](../../../e2e/motogp-riding-flow.spec.ts) uses the normal menu, simulation worker, renderer, and replay controls. Its [attempt receipt](evidence/gp-fullflow-attempt.json) and [trace diagnosis](evidence/gp-fullflow-trace-diagnosis.json) distinguish completed riding checks from unexecuted replay steps. No physical-GPU frame-rate claim is made.
