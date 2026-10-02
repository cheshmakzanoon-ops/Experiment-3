# Pre-race mechanic presentation — first playable slice

## Entry and control

On the paddock screen select a Grand Prix or Endurance session, then choose
**PREPARE GRID / START PAUSED**. In the paused grid menu choose
**PRE-RACE PRESENTATION**. Play, pause, or scrub the preparation; use
**SKIP TO START LIGHTS** (or **BEGIN RACE** after clearance) to race.
**BACK TO GRID MENU** returns without advancing the simulation.

The direct ENTER CIRCUIT path and the established paused-grid inspection path
remain available. This is not yet the default garage-to-grid race-weekend flow.

## Implemented

- Separate 24-second presentation clock: briefing, approach, kneel/inspect,
  gather/lift blankets, backward clearance, and a clean handover to the lights.
- The production physics worker remains paused at tick zero throughout.
  No tyre temperature, fuel, grip, qualifying result, or vehicle pose is edited.
- Distance-driven footfalls and one-foot-at-a-time kneeling/rising transitions,
  with fixed support contacts and explicit feet targets on the two-bone solver, and finger-grip constraints on the rendered gloves and blanket loops.
- Original folded-blanket geometry shares its deformation across colour,
  directional shadows, point-light shadows and the CPU contact solver.
- A dedicated Blender-authored close-up garment uses 9,168 triangles, UVs,
  15 bones, shoulder stitching, knee-pad seams, boot tread and compression
  details. Four close crew use it; distant teams retain the existing mid mesh.
  The previous people, player car, cockpit and driver assets remain unchanged.
- A bounded cast (four people per car, maximum 48); no per-frame geometry
  creation. Reflection passes omit this presentation cast. After clearance,
  legacy start props cannot suddenly reappear as the race starts.
- Peripheral event and stage headings keep task contacts visible above the compact
  control strip. Driving guidance is hidden during preparation.
- Keyboard-accessible controls, reduced-motion camera option, hidden-tab pause,
  repeatable seeking, back/re-enter and skip paths.

## Evidence and boundaries

`tests/grid-presentation.test.ts` checks clocks, footfall continuity, reachable
limbs, actual grip residuals, immutable simulation frames, shadow deformation,
and authored geometry/weights. `e2e/50-grid-presentation.spec.ts` enters through
the real menu, plays and pauses the actual preparation clock, captures
inspection/gather/carry/clear views, verifies the paused worker and tests the
handover into driving. The support-foot regression checks 2,400 samples and
requires an unmoving planted foot through every stance and transition.

These are procedural task performances on an authored mesh, **not motion
capture**, not cloth simulation and not completed AAA human art. The mesh,
exchange file and editable Blender scene are retained; `finalArtApproved` stays
false. The rest of the pit service still uses its established assets and poses.
A formation lap, umbrellas, full garage briefing, new racing HUD, close-rival
replacement and expanded race-weekend presentation remain separate work.
Consumer-hardware frame times and human visual approval are not inferred from
software-rendered tests or triangle counts.

## Publication and branch policy

All source lives on `main`. The deleted `playable-cdn` branch is no longer a
release dependency. A successful main validation publishes a source-addressed
GitHub release ZIP with `SOURCE_COMMIT.txt` and `SHA256SUMS`, verifying supplied
asset manifests before publication. This repairs artifact delivery; it does
**not** claim that an old browser-hosted URL has been updated. Serve the extracted
release over HTTP, or deploy those exact bytes through the selected web host.
