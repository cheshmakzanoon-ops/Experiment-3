# Architecture and engineering notes

## Ownership and units

World and body coordinates are right handed: X right, Y up, Z forward. Distances are metres; time is seconds; mass is kilograms; force is newtons; torque is newton-metres; angles are radians; tire/track/disc temperatures are degrees Celsius; tire pressure is kPa; energy is joules. Display conversion to km/h is confined to UI and reports.

The worker owns the Simulation, Track, Vehicle, AIDriver and RaceDirector instances. Main-thread input sends bounded controls and explicit state commands. The worker validates inputs, detects stale input after 750 ms and applies a braking fallback. A 120 Hz accumulator admits at most 0.2 seconds of wall time in one iteration and explicitly records discarded wall time. Each tick runs two 240 Hz contact/rigid-body substeps. A late renderer does not determine simulation dt.

Five typed-array buffers form a transferable snapshot pool. The main thread holds the newest two for interpolation, copies selected fields into bounded recorders, then transfers old buffers back. Pausing resets wall-clock accounting; resuming cannot inject elapsed pause time into physics. Physics errors stop the worker and produce a visible error rather than silently resetting a car.

## Vehicle model

The chassis integrates linear momentum and body-diagonal angular inertia, including the gyroscopic term. Forces at contact or aero application points accumulate torque. Four oriented suspension attachments query the same analytic surface used to construct track geometry. Spring, bump/rebound damping, anti-roll and quadratic bump-stop forces establish dynamic normal loads. The car model is not an unsprung-mass multibody suspension solver: unsprung mass and suspension kinematics are approximations.

The tire model is inspired by nonlinear steady-state force curves, not a fit to proprietary tire data. Its combined longitudinal/lateral output is limited to a load-sensitive force circle. Surface grip, water, temperature, pressure, wear, dirt and flat spots modify the peak. A backward-Euler angular solve with bisection handles stiff low-speed tire dynamics; a brake complementarity condition prevents a brake from accelerating a stopped wheel backwards. Lateral relaxation length and full transient tire carcass deformation are not implemented.

Slip power heats the tire surface. A separate carcass thermal mass exchanges heat with the surface and environment. Pressure follows a simplified absolute-temperature relation. Brake heating uses friction-brake torque, explicitly excluding regenerative torque. The hybrid model tracks battery energy, deployment efficiency and regeneration headroom; it is not a detailed inverter, engine or battery-chemistry simulation.

Aerodynamic loads scale with relative-air-speed squared. Front and rear wing, floor and drag terms are separate. The floor map includes choking at very low height and loss at excessive clearance. Damage and a spatial wake change these terms before integration. The maps are tunable engineering approximations, not CFD measurements.

## Circuit, surface state and collisions

A sampled closed Catmull-Rom design is arc-length indexed. Binary distance lookup provides track position, tangent, curvature, slope and banking. A uniform spatial hash accelerates world-to-ribbon queries. Kerb waveform, widths, elevation and boundaries are shared between simulation and rendering.

A 512 by 7 grid stores water, rubber, marbles and surface temperature. Rainfall, drainage, evaporation and tire passage update it at a lower frequency; wheel contact reads the relevant cell. Wetness is not just a screen overlay. The wet material uses a corresponding data texture for surface darkening/roughness. However, the rendering does not implement true screen-space or ray-traced moving-car reflections.

Collision broad phase uses proximity checks. The car narrow phase approximates each chassis with two overlapping longitudinal capsules; angular effective mass, low restitution, Coulomb friction and positional correction resolve contacts. This is not a general arbitrary-mesh collision engine. Barrier segments visually follow the same lateral limit function as collision queries. A wide pit corridor includes a fast lane and an off-line service box.

## Race and AI

Start-light timing includes a seed-derived hold. The first valid forward finish crossing arms timing, then eight ordered gates must be crossed before another lap counts. Reversing across the line or skipping intermediate gates cannot farm laps. Four wheels outside the road invalidate the lap; repeated distinct excursions produce penalties. Pit speed enforcement is a simplified single penalty per passage.

AI strategizes at 2 Hz, evaluates traffic at 12 Hz and controls at 120 Hz. Preview curvature and a backward braking envelope set target speed. Actual tire grip, mass and aero health influence planning. A lane commitment avoids repeated side swapping; side-by-side corridor protection and following speed constraints reduce contact. Drivers share exactly the same engine, tire, contact and damage code as the player. Differing skill parameters are not differing grip coefficients.

The AI is not a fully featured professional racecraft system. Rare contacts, poor recovery after severe user-created pile-ups, and missed service approaches remain areas for further adversarial testing. Pit-box overshoot has a physical reversing recovery path. Wet sessions default to suitable tires; starting on slicks in heavy rain is not part of the successful standard wet scenario.

The session pauses at the player's chequered flag. Competitors not finished are honestly labelled RUNNING. Formation laps, safety cars, red-flag restarts, steward investigations, full championship calendars and network multiplayer are not implemented.

## Rendering and audio

All visual models, textures and sound synthesis are generated by this project. Static bodywork and infrastructure are merged by material; crowds, barriers, trees and suspension rods are instanced. Wheels, steering and suspension remain articulated. The three quality levels reduce resolution, shadows, crowd/particles and bloom. Explicit model LOD meshes and asynchronous asset streaming are not yet implemented.

The renderer uses PBR materials, ACES output, a generated sky/environment, a camera-following directional shadow map, and restrained bloom at the highest setting. Cockpit/chase camera offsets use actual accelerations and a damped spring. Car force/damage state drives visible wing changes, tire compression, disc heat and particles. Mirror surfaces are reflective materials, not live rear-view cameras. Motion blur is intentionally absent.

Web Audio starts from a user gesture. Engine harmonic bands depend on RPM and load; tire noise derives from force/slip power, surface/water noise from contact state, and impacts from actual damage impulses. Nearby engine voices use distance attenuation, stereo positioning and an approximate Doppler factor. Procedural synthesis is not equivalent to professionally recorded, layered real-car samples.

## Persistence, replay and errors

Version-1 IndexedDB records store validated preferences and best-lap records. Import/export only handles setup JSON, with version, type, size and finite-value checks. No network writes or analytics are performed by the app. No mid-race save/restore, replay file import/export or cloud sync is implemented.

Replay is a bounded 20-minute, 15 Hz pose history interpolated at display rate. It does not restore/re-simulate the full physics state. Telemetry records delivered player snapshots, normally 60 Hz, in a 15-minute ring. CSV time stamps expose gaps; no samples are fabricated to claim a constant capture rate. Lap comparison uses distance, and requires two completed recorded laps.

Settings failures surface as notices and leave session-only operation available. Missing WebGL2, worker startup failure, uncaught physics errors and graphics-context loss stop the session with an actionable error. The build intentionally does not claim crash-free behavior on untested browsers or GPUs.

## Three review passes

1. Functional integration: common surface geometry; all controls routed to bounded inputs; rendering, audio, telemetry and replay consume simulation state; pit stops require actual arrival.
2. Engineering review: low-speed wheel chatter removed, regenerative disc heating corrected, ordered lap gates tested, collision energy checked, multi-instance scratch state isolated, renderer wall-time statistics separated from bounded camera dt, and rear-tire wear added to AI service decisions.
3. Presentation/lifecycle review: original car/track/UI; articulated suspension and live steering display; instancing/merging; keyboard/gamepad/touch mappings; pause/focus resets; typed lifecycle, explicit limitations and reproducible CI artifacts. Browser visual review is recorded separately from type/build validation.
