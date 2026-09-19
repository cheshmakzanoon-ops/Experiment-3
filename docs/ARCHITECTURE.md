# Architecture and engineering notes

This describes the current code paths, not certification that every fidelity goal
in [the original directive](MASTER_DIRECTIVE.md) has been met. The numbered
[coverage ledger](IMPLEMENTATION_MATRIX.md) records implementation boundaries.

## Ownership, coordinates and clocks

Body coordinates are right handed: **+Z is the nose, +Y is up, +X is the driver's
left**. Right steering therefore uses negative local X. The internal wheel order
is FR, FL, RR, RL; the helpers and tests in `core/math.ts` and `input/filter.ts`
make the input/render boundary explicit. Length, time, mass, force, torque and
energy use metres, seconds, kilograms, newtons, newton-metres and joules. Angles
are radians, temperatures explicitly Celsius, pressure kPa, and rainfall mm/hour.
Speed conversion to km/h belongs to presentation and reports.

The physics worker owns `Simulation`, `Track`, `Vehicle`, AI and race control.
The 120 Hz accumulator runs two 240 Hz contact/rigid-body substeps per tick. Main
thread input is polled independently at 60 Hz. Inputs and commands are validated;
a 750 ms stale-input condition applies the braking fallback. The accumulator
bounds admitted wall time and reports discarded time, rather than integrating a
large step or pretending overload never happened. Pausing resets clock accounting.

Five transferable render buffers keep previous/current numeric snapshots for
interpolation. Telemetry and replay have separate bounded transport pools and
physics-tick capture clocks. Main-thread callbacks return consumed buffers. A
backlogged consumer receives an explicit recording-gap warning; no fake samples
are inserted. Worker failures stop the session and surface a visible error.

## Vehicle, tires, brakes and energy

Translation is semi-implicit. Angular motion uses body implicit midpoint, a Cayley
rotation and world-torque half kicks. Free-spin energy/world-momentum and applied
impulse tests exercise the production integrator. Contact and aerodynamic forces
act at their application points and generate moments. A body-diagonal inertia
model and suspension kinematics are reduced approximations, not a multibody car.

Four oriented suspension axes query a BVH triangle contact ribbon. Shared normals
stabilize triangle seams. Both tire slip velocity and reconstructed force use the
same orthonormal sampled-road basis at each actual ray intersection; suspension
heave does not become lateral slip. Spring, bump/rebound damping, anti-roll and
progressive bump-stop forces establish wheel loads. Tire forces use nonlinear
load-sensitive longitudinal/lateral curves and a combined-force limit. Water, compound, load,
temperature, pressure, wear, contamination and flat spots affect those forces.
A backward-Euler angular solve with bisection addresses stiff low-speed wheel
motion; brake complementarity does not accelerate a stopped wheel backwards.
The tire coefficients are original approximations, not fitted proprietary data.

Four local floor supports apply unilateral spring/damper and bounded friction
forces at actual contact points, producing pitch/roll moments and dissipated
work. Floor abrasion cannot heal existing collision damage. Hard-surface sliding
work, recorded contact anchors and cumulative counters drive sparks, including
strikes between displayed snapshots. Soft ground and normal damping do not
produce metallic sparks. This is a reduced compliant model, not a swept
deformable chassis; see [road contact and skids](ROAD_CONTACT_AND_SKIDS.md).

Dissipated slip work heats surface and carcass thermal masses. Pressure follows a
simplified absolute-temperature relation. Brake discs receive friction-brake
work, excluding regeneration. Sport ABS releases friction **and** generator
braking; recovered battery energy is limited by actual applied generator torque
and wheel angular speed. Automatic anti-stall opens the clutch below coupled
idle speed while braking. A selected manual clutch remains controlled by the
pedal. No braking fix writes a preferred chassis speed or increases tire grip.

The finite-inertia clutch couples the combustion and hybrid shafts to the geared
axle. Differential locking is a torque-coupling approximation. Front/rear wings,
floor and drag use relative air velocity, including timeline wind. Clearance and
pitch maps, damage, and a three-dimensional wake modify physical forces. Lost
bodywork changes mass; localized impacts affect suspension and tire state.
Full hydrodynamics, CFD, battery chemistry and structural crash deformation are
outside the reduced model. See [aero/dynamics](AERO_AND_DYNAMICS.md),
[angular integration](ANGULAR_INTEGRATION.md) and [clutch](DEVICE_CALIBRATION_AND_CLUTCH.md).

## Circuit, environment and collision

One original Catmull-Rom circuit is arc-length indexed. Track queries provide
position, tangent, curvature, slope and banking; a spatial index narrows world
queries. Contact ribbons and visible kerbs/road share the same construction data.
A 512 × 7 grid stores water, rubber, marbles and temperature. Tire passage and
rainfall/drainage/evaporation evolve real cells, which supply wheel contacts and
the dynamic wet-road texture. The immutable, seekable weather timeline supplies
cloud, rain, ambient temperature and wind from simulation time. Water and thermal
relaxation use stable first-order updates; stopped rain does not erase wet ground.

Collision broad phase is sweep-and-prune; the narrow phase tests fifteen
separating axes between oriented chassis boxes. Normal and friction impulses
include rotational effective mass. Chassis corners query the physical barrier
boundary, including the wider pit corridor. These are approximate chassis
shapes, not arbitrary detailed vehicle triangle-to-triangle collision meshes.
The original circuit is procedural, not surveyed real-world circuit data.

## Race, strategy and pits

Race control implements seed-derived start timing, ordered lap gates, interpolated
sector crossings, local yellow/double-yellow, blue flags, track-limit and pit
penalties, retirements and whole-field classification. A finished player follows
a cooldown while remaining competitors finish or reach the classification limit;
the session does not immediately freeze every opponent at the player's finish.
Formation laps, safety-car procedure, red-flag restarts and championships are not
implemented. See [race control](RACE_CONTROL_AND_PIT_RESPONSE.md) and [marshals](MARSHAL_RULES.md).

AI strategy runs at 2 Hz, swept traffic decisions at 12 Hz, and controls at 120 Hz.
Preview curvature, backward braking envelopes, actual tire grip, fuel and aero
condition feed target speed. Seeded traits affect risk, reaction, tire care,
energy, defense and bounded mistakes, not special grip or vehicle constraints.
A slick tire on standing water reserves additional control margin while reaching
the real pit stop. Pit approach candidates do not choose passing lanes farther
from the required entry; occupied corridors are handled by existing following
and longitudinal yielding. Normal race overtaking remains independent.

Pit approaches, stopping, jack support, tire-object replacement, repair and release
are physical states. Missed boxes use a driven-through retry on a subsequent lap,
not teleportation or reversing into a busy pit lane. Service crew poses and removed
wheel visuals consume that actual state. Congestion and severe player-created
pile-ups still require adversarial testing; successful fixtures are not universal
racecraft certification.

## Rendering, controls and sound

Three.js WebGL2 renders original generated geometry, textures and shaders. Static
geometry is merged, repeated objects instanced, remote cars use three LODs, and
circuit props have spatial culling. Initial procedural construction runs through a
prioritized cooperative queue with real progress and cancellation cleanup. This
is not streaming unspecified downloaded assets. Individual graphics controls
change real resolution, textures, shadows, mirrors/probes, effects and processing.

The renderer uses PBR surfaces, an original sky/environment, directional shadows,
wet/carbon shaders, true rear-view camera passes and an optional local reflection
probe. Depth-aware camera/rigid-object motion blur is independently adjustable
and off by default. Camera cuts, hitches and replay seeks reset its history; the
HTML HUD remains outside the effect. GPU queries are nonblocking and invalidated
on disjoint/context-loss events. [Performance captures](PERFORMANCE_VALIDATION.md)
measure real intervals and identify the built source, not a guessed consumer GPU.

Articulated wheels, suspension links, driver, steering display, damage, debris and
pit crew follow state. Pooled spray requires loaded tires, actual water and speed;
smoke uses tire slip work, sparks use recorded hard-surface sliding work.
Fractional emissions avoid losing light rain at high FPS. Weather wind drives rain and entrainment.
The same wind is recorded in replay rather than sampled from a second wall clock.
Marble pickup is integrated per loaded tire, debits the touched road cell, and
persists as tread contamination until shed or the tire is physically replaced.
Cumulative pickup drives solid chips; the shared surface texture and per-wheel
tread uniforms expose actual local/recorded conditions without new texture churn.

Keyboard, gamepad, touch and explicitly calibrated unmapped-wheel inputs route to
bounded controls; supported devices may provide vibration. Native wheel force
feedback is not claimed. Web Audio starts from a user gesture. Engine/load bands,
contact spectra, wind, impacts and nearby spatial voices consume state. Procedural
synthesis is not a professionally recorded layered car-audio library.

## Persistence, recording and errors

Settings records are version 6 and migrate supported versions 1–5; IndexedDB's
object-store schema version is separately 1. Setup, calibration, bindings and
graphics are validated. Stored best laps and local preferences require no account
or network write. There is no full mid-race physics save/restore or cloud sync.

Protocol version 9 uses sixteen header floats and 249 floats per car. Four
26-float wheel records start at offset 96; four eight-float debris records start
at 200; seventeen skid-contact values start at 232. Telemetry exports 228 named
channels at 60 Hz into a fifteen-minute ring. The first 211 column names and
positions remain unchanged; the seventeen skid channels are appended. Complete
all-car numeric pose replay is captured at 15 Hz and paged through bounded IndexedDB storage,
with separately recorded surface state. Playback does not rerun live physics.
Missing/incompatible pages, storage failures, cancelled exports and backlog are
reported rather than silently substituted. See [recording/replay](RECORDING_AND_REPLAY.md).

Missing WebGL2, worker startup failure, invalid physical state and context loss
have explicit stop/error paths. Focus loss pauses driving. This architecture and
its automated checks do not substitute for the directive's combined driving
scenario, representative-device performance runs or complete human-quality audits.
