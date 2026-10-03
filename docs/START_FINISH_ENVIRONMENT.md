# Aurel start/finish environment — integrated revision 1

## Bounded scope

The existing Aurel grandstand sites at -72 m and +55 m retain their footprints,
seat locations, aisle centres and crowd occupancy. A11/A13/A14 replace their old
terraces/roof furniture with one authored modular family: cantilever roof ribs,
concourse depth, stairs/handrails, ground-fitted footings and formed seat shells.
Three detail levels share a silhouette; repeated bays/seats are instanced.

A18 installs one supported race-information screen in the gap between the stands.
It displays actual snapshot rank, car number, completed laps, speed and pit state,
with recorded time/rainfall. Updates are capped at 4 Hz, pause holds the texture,
rewind restores recorded readings and session reset invalidates a stale grid.
This is a live **data board, not a rendered camera/video feed**. Existing circuit
lighting and wet-surface systems remain authoritative.

A43/A44 add four near/middle audience head/hair families on the retained original
body pattern, keeping stable clothing/skin/height cohorts and planted seated or
standing correspondence. Four keyed pivot-rig actions (idle, clap, cheer, phone)
are evaluated in Blender at 30 Hz and sampled from an immutable quaternion atlas.
This is not full-body motion capture or a complete sit/stand transition system.
Actual nearby traffic/collision evidence controls reaction; phases are offset by
stable spectator identity. Far silhouettes/impostors remain economical.

A45 uses the established A41/A42 suit, helmet and gloves at the existing protected
marshal posts on both circuits. Keyed head/pole controls plus contact retargeting
keep the holding glove attached to the pole. Recorded local flag selection is
unchanged; yellow/blue/chequered presentation never writes race-control state.
Flag deformation is shared by colour, directional-shadow and point-shadow passes.

Near Aurel start/finish fence posts gain authored collars, fastening and anchor
hardware in the existing steel batches. The original profiled concrete, filtered
wire, collision envelope, pit openings and drainage are retained. This does not
complete every A01–A07 asset or add an interactive recovery gate.

## Retained data and source

`author-start-finish.py` checks the retained people source hash before reusing its
original pattern. It exports `start-finish.geometry.json`, the independently
retained compressed GLB, an integrity manifest and `scripts/start-finish.blend`.
The native file contains an assembled 80-metre stand plus editable prototypes,
LOD families and six named audience/marshal actions. All assets are original.
Player/cockpit/driver, A61 rivals, crew/pit actions, physical track definitions,
physics, race timing, saves and HUD remain unchanged.

## Validation and acceptance

`tests/start-finish.test.ts` checks finite owned geometry, reflected winding and
bounds, measured road/aisle clearance, exact source/export hashes, real GLB action
playback against evaluated pose samples, LOD selection, immutable snapshots,
paused/rewound action samples and marshal glove contact under local signals.

`e2e/55-start-finish.spec.ts` enters the real application and exercises the full
production renderer at day/sunset/wet-night on a twelve-car race. It captures the
stand, audience, screen, fence and marshal views, checks nonblank pixels, errors,
allocation stability and deterministic pose/board rewind. Fixed-camera surveys
are additional inspection evidence, not a substitute for the existing cockpit,
pregame, populated-pit and full-race browser journeys.

Local ordinary-page navigation was rejected by this executor's browser policy.
Both unchanged baseline and candidate supplementary local Mesa shader surveys
also returned invalid programs/black frames. Those captures are failures, not
visual approval; use the normal GitHub browser backend for release evidence.

Do not infer hardware FPS from software-rendered CI or vertex counts. Record
matched scene draw/triangle counts, actual shader errors and source identity.
`finalArtApproved` remains false: natural-motion review, greater facial/clothing
variety, broader venue propagation and representative hardware measurements are
still open. No final AAA-quality claim is made by the asset or test manifest.
