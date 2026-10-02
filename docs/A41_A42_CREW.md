# A41/A42 — shared mechanic kit and authored task actions

The coordinated pit-team continuation adds five actions (fourteen total), applies
authored motion to every pit role, and fixes physical jack lowering before
release. The original nine-action revision is documented below; see
[Pit-team continuation](PIT_TEAM_PERFORMANCE.md) for current scope and validation.

## Scope and boundaries

This revision retains the Aurel 15-bone skeleton, cuff/grip/sole contracts and the
existing grid and pit state machines. It does not replace the supplied player,
change A61 rivals, edit physics, change tyre-service duration or reset saves.
It is an original body/kit and motion revision, not motion capture, cloth
simulation, completed AAA art or representative-hardware certification.

## Shared body and kit

`author-crew-performance.py` verifies the original people-authoring hash, then
re-patterns chest/back, waist, shoulders, sleeves, hips, knees and boots. Cloth
volumes are joined in a temporary spread-limb authoring pose before returning to
the retained rest skeleton. This prevents the sleeve/flank welding and stretched
armpit membranes found in the first visual review. Up to four normalized skin
influences replace the two-influence limit at shoulder/hip transitions. The
colour, depth and point-shadow programs use the same skinning.

The helmet retains its original envelope, with revised crown/rear contour,
gasket, brow and chin details. Gloves have individual curled fingers, knuckles,
a shaped thumb and fitted cuff; the measured finger-grip socket is retained.
Near and middle suits share one source silhouette. Grid preparation and all
live pit roles now use the same near/middle body, helmet and gloves. Spectators,
marshals and supplied driver remain separate, retained assets.

The native `scripts/crew-performance.blend` includes both suit tiers, the kit,
15-bone rig, nine editable actions and a dressed inspection assembly. The middle
suit is hidden in its default inspection view rather than overlapping the near
suit. Runtime data and exchange GLB are independently retained.

## Authored motion and contact retargeting

Nine original keyed Blender actions are exported: idle, walk, turn, kneel,
inspect, lift, stand, carry and gun_service. Their Bezier keys describe weight
transfer, anticipatory torso lean, head attention, reaches and followthrough.
Runtime tracks are sampled at 30 Hz from the **evaluated Blender actions**;
unit tests play the actual GLB with Three.js AnimationMixer and compare every
bone against those samples. Actions are not labels added to the old procedural
sequence or an export with animations disabled.

The rendering path samples those tracks without one AnimationMixer per person.
Existing route displacement and planted-foot targets remain authoritative. Clip
sampling supplies pelvis/torso/head motion, free-hand movement and limb bend
planes; hand and foot inverse kinematics retarget the performance onto the
actual handles and ground contacts. These are authored poses with procedural
contact retargeting, not unmodified clip playback of every limb.

The walking/carry phase derives from route distance. Adjacent actions crossfade.
The glove fit uses damped contact iteration and a transported forearm frame to
avoid a wrist-orientation singularity during grip acquisition. Intermediate IK
iterations do not rebuild/upload bone matrices. Timelines can be sought in
arbitrary order, including rewind, without accumulating animation state.

The wheel-gun role samples gun_service from the **actual recorded pit clock**.
The gun's alignment, actuation, tyre release and jack timing are not moved to
fit the action. Other pit roles receive the refined kit but retain their existing
procedural task poses; their authored performances are subsequent work.

## Verification

- `tests/crew-performance.test.ts`: source/runtime/exchange integrity; actual
  exported action playback; normalized four-weight skin; left glove winding;
  independent buffers; deterministic samples; retained contacts and full grid.
- Existing grid and people tests retain fixed supporting feet, reachable limbs,
  glove/cuff contacts, unchanged frames, actual simulated pit stops and replay.
  Their skin readback now includes all four influences, matching the GPU.
- `e2e/54-authored-crew.spec.ts`: uninterrupted 12-car preparation at Low,
  plus a separate 12-car Medium pose/shadow survey. Both retain immutable
  physics and real controls; the continuous run also checks race handover.
  The first Medium continuous attempt advanced at roughly 0.03 presentation
  seconds per wall second on llvmpipe and exceeded its checkpoint deadline;
  that failure is not attributed to a stopped clock or fixed by skipping actions.
  No game timing or physical state is changed for the evidence. Baseline and
  candidate use matching settings in both surveys.
- The populated-pit journey in `e2e/28-race-pit-presentation.spec.ts` verifies the
  new shared kit and gun action in an actual recorded tyre service, including
  rewind. No simulation snapshots are injected to manufacture a stop.

Run pinned Blender 5.2.2 with `--python-exit-code 1 --python
scripts/author-crew-performance.py`, then `npm run check`. Browser tests use the
normal menu, worker and renderer. CI screenshots/video are software-rendered
integration evidence, not consumer-GPU frame rates. Final visual approval,
cloth dynamics, more pit-role actions, terrain-aware feet away from current
service/grid areas and crowd/marshal refinement remain open.
