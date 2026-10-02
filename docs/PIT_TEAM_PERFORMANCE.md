# Coordinated pit-team performance

## Scope

The existing 15-person service cast now uses distinct authored performances for
all six roles: four gun operators, four tyre removers, four installers, a front
jack operator, a rear jack operator and a release operator. The shared A41/A42
body, helmet and glove geometry is retained; this is movement/coordination work,
not another character-model replacement or final visual approval.

Five new keyed Blender actions (`tyre_remove`, `tyre_install`, `front_jack`,
`rear_jack`, `release_service`) extend the original nine to fourteen. The original
nine key definitions are unchanged. Runtime samples still come from evaluated
Blender actions, and tests compare actual exported GLB playback against them.
Regeneration can move previously rounded pose components by about 1e-6; this is
not a claim that every serialized pose byte remains identical. The shared meshes
are checked for exact equality.

## Coordination and contacts

`pit-role-performance.ts` samples each role using the recorded service phase and
clock. Authored pelvis, torso, head and bend-plane motion is contact-retargeted;
hand grips, tyre position and actual jack geometry remain authoritative. A long
traffic hold clamps the release performance rather than looping or signalling
permission to depart. No animation callback writes to race control.

`pit-footwork.ts` shares tyre-handler routes with the actual carried-wheel code.
Alternating landing contacts are fixed in car space instead of being dragged by
the moving actor root. Knees receive a bounded analytic pole correction around
the existing two-bone bend circle; neither limb endpoints nor bone lengths are
changed to hide floor clipping. Pelvis correction respects maximum leg reach.
Both jack operators use support anchors referenced to the unlifted jack, then
step clear only after the recorded lift height reaches zero. The fully lowered
jack geometry, grips and operator move to the same lateral clearance position.
There is no new independent equipment timeline or decorative wheel exchange.

## Physical jack defect corrected

The baseline commanded 0.19 m of jack lift throughout pit phases 3--5 and only
began lowering after phase 6 permitted departure. A production probe found the
car moving while jack height was still positive. This revision commands lowering
in the existing phase-5 repair/clearance window, after installation and tightening.
The lift/lower speed remains 0.16 m/s; tyre replacement still occurs at 2.2 s, and
safe release is still no earlier than 5.2 s and remains traffic-gated. No service
phase durations, tyre parameters, AI rules, track geometry or saved settings are
changed. This is a deliberate physical timing correction, not purely visual work.

## Renderer cost and lifecycle

There is still one shared 172,800-byte bone atlas at the existing 180-person
capacity. Six reusable samplers replace the gun-only sampler; there are no new
per-person mixers, meshes, materials or GPU submissions. Additional sampling and
contact CPU work must be measured rather than reported as free. Existing pit
visibility and return-to-race lifecycle are retained; this revision does not add
persistent garage crowds or new pit approach/retreat navigation outside service.

## Validation

- `pit-role-performance.test.ts` checks fourteen exports, distinct role motion,
  all fifteen actual uploaded actor poses, contact/reach constraints, fixed
  support feet, loaded-hub rejection, held traffic, arbitrary rewind, unchanged
  input frames, original meshes/key definitions, and twelve simultaneous teams.
- Production simulations on both circuits verify physical jack lowering before
  departure, the real 2.2-second tyre-state replacement and 5.2-second minimum.
- Existing actual A32 meshes and their glove contacts are exercised during
  lowering/withdrawal; existing people, geometry-envelope and replay tests stay.
- The populated-pit browser journey uses ordinary menus, an actual requested
  stop and the recorded replay. It checks all roles, surveys seven service
  instants, plays the recorded service continuously, and keeps pause/rewind
  assertions. Baseline and candidate use matching camera/graphics settings.
- Optional `PIT_TEAM_CIRCUIT=vellamar PIT_TEAM_NIGHT=1` runs the same actual
  journey in wet night conditions; `CREW_BASELINE=1` omits only assertions for
  newly added fields while retaining the baseline journey and images.

Author with pinned Blender 5.2.2:

```sh
blender -b --python-exit-code 1 --python scripts/author-crew-performance.py
npm run check
npm run test:e2e -- e2e/28-race-pit-presentation.spec.ts --grep 'populated pit journey'
```

Tests and software-rendered footage are integration evidence, not representative
hardware performance or final natural-motion certification. Original supplied
player/cockpit/driver, A61 rival assets and the fourteen-action native scene remain
retained. Cloth dynamics, general terrain-aware footsteps, crowd/marshal upgrades,
more realistic finger articulation and final human visual approval remain open.

## A32 contact-survey continuation

The first complete main regression found six A32 browser cases still asserting
that a fully withdrawn jack pad must touch the original chassis socket. The
actual withdrawal was about 91 mm at the first failing sample; the new service
behaviour correctly moves the lowered equipment out of the departure corridor.
Both circuit and offline native-texture surveys now retain the original 10-micron
tracking/floor tolerance while distinguishing loaded/lowering contact from the
specified lateral clearance route. All original samples remain, with an added
real service sample at full withdrawal before the 5.2-second release minimum.

An independent test-side oracle does not import the runtime clearance function.
Negative controls reject early/loaded withdrawal, wrong direction, missing
withdrawal and vertical/longitudinal errors. CPU readback exercises the same
actual jack geometry and uploaded part matrices through production-simulated
stops on both circuits. No runtime, physics, asset, timeout, retry, graphics preset
or original case is changed by this contact-survey correction.
