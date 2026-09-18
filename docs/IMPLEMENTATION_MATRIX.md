# Specification coverage ledger

This ledger follows the numbered sections of the supplied directive. “Implemented” means a concrete code path exists; it does **not** certify every aspirational fidelity or performance statement in that section. Approximate/partial sections explicitly state the boundary.

| Section | Topic | Delivery status |
|---:|---|---|
| 1 | NON-NEGOTIABLE ENGINEERING PHILOSOPHY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 2 | THREE-PASS RULE | OPEN: functional and focused validation passes exist; three complete passes for every subsystem are not certified. |
| 3 | REQUIRED TECH STACK | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 4 | REPOSITORY STRUCTURE | Equivalent ownership boundaries in a smaller module tree; not the exact requested directory layout. |
| 5 | GAME LOOP | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 6 | PHYSICS COORDINATE SYSTEM | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 7 | RIGID BODY STATE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 8 | FORCE ACCUMULATION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 9 | INTEGRATOR | Semi-implicit translation; implicit body midpoint/Cayley rotation with world-torque half kicks. Free-spin energy/world-momentum and forced-impulse regressions pass. |
| 10 | WHEEL CONTACT MODEL | BVH triangle ribbon queries along suspension axes, shared seam normals, contact tests; contact-patch/multibody refinement remains. |
| 11 | SUSPENSION CORNER | Spring/damper/ARB/bump stop; no unsprung-body multibody model. |
| 12 | TIRE MODEL | Nonlinear approximate tire curves; no experimentally fitted commercial tire dataset. |
| 13 | SLIP RATIO | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 14 | SLIP ANGLE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 15 | PACEJKA-LIKE FORCE CURVES | Pacejka-inspired function; not calibrated Magic Formula coefficients. |
| 16 | LOAD SENSITIVITY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 17 | COMBINED SLIP | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 18 | TIRE TEMPERATURE | Two thermal masses; not a finite-element tire thermal model. |
| 19 | TEMPERATURE GRIP CURVE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 20 | TIRE WEAR | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 21 | FLAT SPOTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 22 | TIRE CONTAMINATION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 23 | BRAKE SYSTEM | Front/rear distribution and fade; no detailed hydraulic circuit. |
| 24 | BRAKE THERMALS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 25 | LOCKUP | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 26 | ENGINE MODEL | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 27 | GEARBOX | Neutral, reverse, eight forward ratios, torque-cut shifting and invalid-downshift guard. Finite-inertia friction clutch supports actual free revving and pedal-controlled torque transfer. |
| 28 | DIFFERENTIAL | Torque-coupling limited-slip approximation. |
| 29 | HYBRID SYSTEM | Energy-conserving deployment/regeneration; no detailed electrical hardware model. |
| 30 | AERODYNAMICS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 31 | AERO MAP | Sampled 2D clearance envelope plus independent pitch calibration; actual chassis floor-station clearance, wing settings, damage and wake feed force accumulation. Original engineering calibration, not measured CFD. |
| 32 | GROUND EFFECT | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 33 | BOTTOMING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 34 | WAKE / DIRTY AIR | Smooth finite 3D wake volume, continuous speed/distance/lateral/vertical boundaries, heading alignment and slipstream drag reduction; regression sweeps cover cutoff continuity. |
| 35 | SURFACE TYPES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 36 | TRACK SPLINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 37 | TRACK SURFACE STATE GRID | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 38 | RUBBERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 39 | MARBLES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 40 | WATER MODEL | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 41 | AQUAPLANING | Smooth load-, speed-, water- and compound-dependent grip reduction. No random binary aquaplaning; hydrodynamic contact-patch simulation remains outside this reduced model. |
| 42 | WEATHER TIMELINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 43 | AI ARCHITECTURE | Strategic/tactical/controller frequencies separated inside the physics worker. |
| 44 | AI SPEED PLANNING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 45 | AI RACING LINE | Pure-pursuit offset racing line; no globally optimized minimum-time trajectory. |
| 46 | AI OVERTAKING | Lane selection/commitment, following envelope and side protection. |
| 47 | AI DEFENSE | Side-by-side protection, not a fully strategic defensive behavior tree. |
| 48 | COLLISION PREDICTION | Swept track-coordinate trajectory/corridor prediction with lane commitment and pit merging; adversarial racecraft validation remains open. |
| 49 | AI PERSONALITIES | Seeded personality parameters and tactical risk/headway differences; not all requested traits have full behavioral effects. |
| 50 | AI ERROR MODEL | Emergent errors, not a calibrated driver-error stochastic model. |
| 51 | COLLISION SYSTEM | Sweep-and-prune broad phase, 15-axis oriented chassis boxes, rotational normal/friction impulses, barrier corners; wheel/convex manifold refinement remains. |
| 52 | DAMAGE ENERGY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 53 | DAMAGE PHYSICS | Contact-localized suspension damage, puncture radius/pressure/grip, wing/floor aero loss, bounded physical and rendered fragments, repair mass bookkeeping. Full crash deformation is not claimed. |
| 54 | RENDER PIPELINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 55 | PBR | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 56 | CARBON FIBER SHADER | Dedicated band-limited carbon roughness and micro-normal GLSL, browser shader tests passed at the rendering checkpoint. |
| 57 | WET ROAD SHADER | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 58 | REFLECTIONS | Real mirrors plus double-buffered local probes; source/target separation, failure cleanup and environment-only restoration are tested. No SSR/ray tracing; these are alternatives in the directive. |
| 59 | SHADOWS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 60 | LIGHTING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 61 | ATMOSPHERE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 62 | MOTION BLUR | Not implemented: no object/camera motion blur. |
| 63 | SPEED PERCEPTION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 64 | CAMERA DYNAMICS | Analytic critically damped local inertial cockpit offsets, independent heading filtering and chase translation feed-forward; 24–144 FPS regression coverage. |
| 65 | COCKPIT CAMERA | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 66 | TRACKSIDE CAMERAS | Twenty fixed authored rigs, predictive pan/zoom, track-distance coverage, cut hysteresis and replay-seek resets. Complete-lap unit coverage; final shot-obstruction review remains. |
| 67 | PARTICLES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 68 | RAIN SPRAY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 69 | TIRE SMOKE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 70 | SPARKS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 71 | AUDIO ARCHITECTURE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 72 | ENGINE SOUND | Original procedural harmonic synthesis rather than recorded engine layers. |
| 73 | TIRE AUDIO | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 74 | SURFACE AUDIO | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 75 | DOPPLER | Approximate stereo/Doppler for nearest engines, not full acoustic propagation. |
| 76 | INPUT PIPELINE | Actual device sampling, calibration, response and simulation input on an independent 60 Hz timer; worker stale-input safety retained. Render-suspension browser regression added. |
| 77 | GAMEPAD STEERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 78 | KEYBOARD STEERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 79 | WHEEL INPUT | Explicit device selection, asymmetric steering/pedal calibration, clutch/paddle mapping and disconnect guards. Version-4 profiles preserve earlier calibrations; real hardware certification remains open. |
| 80 | TELEMETRY DATA | 181 actual-state telemetry channels captured at fixed 60 Hz in the physics worker, bounded transport/ring buffers and asynchronous CSV export. |
| 81 | TELEMETRY UI | Eight selectable graph groups include clutch torque/slip, the requested driver/chassis/tire channels and complete-lap distance comparison; truncated/gapped laps are labelled rather than fabricated. |
| 82 | REPLAY SYSTEM | 15 Hz all-car numeric pose pages, bounded resident IndexedDB replay cache, asynchronous seeking, original spatial water/rubber history, explicit recording failures. Permanent replay-library UI is not included. |
| 83 | RACE DIRECTOR | Explicit grid/lights/racing/results states; whole-field chequered classification, lapped finish, penalty ordering, automatic cooldown and explicit timeout DNF. Full safety-car and local-flag policy remain open. |
| 84 | START LIGHTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 85 | LAP DETECTION | Eight ordered forward gates; interpolated finish and sector crossings, persistent third-sector record, no discontinuity-earned progress, invalid-lap tagging. |
| 86 | TRACK LIMITS | Four wheel tread-width samples against each local asphalt/paint boundary; no chassis-centre or fixed-width penalty. Kerbs/runoff are outside the documented legal edge. |
| 87 | PIT LANE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 88 | PIT STOP | Physical box entry, tire-object replacement, four-foot jack support, contact-safe release and forward drive-through/retry for missed boxes. Detailed mechanic animation remains partial. |
| 89 | SETUP SYSTEM | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 90 | HUD DESIGN | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 91 | STEERING-WHEEL DISPLAY | Live canvas display and steering animation; not every steering-wheel button is interactive. |
| 92 | GRAPHICS SETTINGS | Independent physical render scale, texture cap, shadows, mirrors/probes, particle/vegetation density, crowds, bloom, FXAA and anisotropy. Optional motion blur remains absent. |
| 93 | PERFORMANCE BUDGET | Instrumented, but target-GPU performance is not certified. |
| 94 | OBJECT ALLOCATION | Pooled snapshots/particles/recorders; small per-tick/per-frame allocations remain. |
| 95 | LOD | Three separate car geometries with hysteresis and articulated wheels; player remains full detail. Track/prop spatial culling is implemented. |
| 96 | INSTANCING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 97 | TEXTURE MANAGEMENT | Actual immutable-canvas texture resampling/restoration, mipmaps and hardware-bounded anisotropy; live displays and data textures excluded. No compressed external asset atlas. |
| 98 | ASSET STREAMING | Not implemented: no asynchronous external asset streaming, because all assets are generated. |
| 99 | PHYSICS WORKER | Fixed-step worker and pooled render/telemetry/replay transport. Input polling no longer waits for requestAnimationFrame; stale-input safety remains. Target-hardware profiling is separate. |
| 100 | AI WORKER | Strategic/tactical AI runs with the simulation inside the physics worker; a separate worker is an optional candidate, not an implemented independent thread. |
| 101 | DEBUG OVERLAY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 102 | VISUAL DEBUGGING | Contact-load arrows and numeric telemetry; not all requested overlays. |
| 103 | UNIT TESTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 104 | PHYSICS PROPERTY TESTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 105 | DETERMINISM TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 106 | FRAME-INDEPENDENCE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 107 | STRAIGHT-LINE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 108 | SKIDPAD TEST | Instrumented 80 m skidpad at 15/25/35 m/s using the production vehicle solver; measured lateral G compared with actual speed/radius, radial RMS error and speed tracking. |
| 109 | BRAKING TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 110 | SLALOM TEST | Six repeated steering cycles with yaw-amplification and post-input recovery measurements on an isolated runway. |
| 111 | KERB TEST | One-sided 25/55/85 mm kerb fixtures record contact loads, suspension travel, vertical G and floor-contact work using the production vehicle solver. |
| 112 | WET TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 113 | DAMAGE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 114 | WAKE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 115 | AI TESTS | 100-lap dry single-car endurance and shorter multi-car weather scenarios; not 100-lap multi-car proof. |
| 116 | RACE TEST | Two ten-car three-lap clear/changing-weather whole-field classification fixtures with pit service and measured sectors. The full manual audiovisual scenario remains separate. |
| 117 | PLAYWRIGHT TESTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 118 | PERFORMANCE REGRESSION | Runtime instrumentation and CI diagnostics, not a certified GPU regression benchmark. |
| 119 | ERROR POLICY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 120 | NUMERICAL SAFETY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 121 | PHYSICS TUNING | Engineering coefficients are approximations; no proprietary real-car reference calibration. |
| 122 | VISUAL QUALITY PASSES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 123 | CAR MODEL REQUIREMENTS | Original lofted bodywork, multi-element wings, halo, wheels, suspension and cockpit; not AAA artist-authored fidelity. |
| 124 | COCKPIT QUALITY | Modeled cockpit and live controls, but no fully detailed tactile replica. |
| 125 | DRIVER ANIMATION | Steering-mounted hands/arms and an external helmet; no full skeletal driver animation. |
| 126 | VISUAL SUSPENSION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 127 | TIRE DEFORMATION | Load-driven visual compression and flat-spot term, not full tire deformation geometry. |
| 128 | TRACK DETAIL DENSITY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 129 | NO PROCEDURAL SLOP | Controlled original procedural design; final aesthetic judgment still requires visual review. |
| 130 | CIRCUIT PHYSICS FIDELITY | Visual/contact geometry shared; one original circuit, not surveyed circuit data. |
| 131 | UI PRINCIPLE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 132 | MENU PERFORMANCE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 133 | ACCESSIBILITY | Scalable interface, patterned/text flags, high-contrast instruments, adjustable shake and remapping. Optional motion-blur control is absent because the effect is not implemented. |
| 134 | AUDIO/VISUAL CONNECTION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 135 | NO DISCONNECTED EFFECTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 136 | EVENT BUS | Typed worker protocol and explicit callbacks, not a separate generalized event-bus package. |
| 137 | CONFIGURATION DATA | Central vehicle/setup data with some renderer/AI constants still local. |
| 138 | NO MAGIC NUMBERS | Units and named core settings provided, but some local tuning constants remain. |
| 139 | VERSIONED SAVES | Version-4 graphics/accessibility/preferences migrate versions 1–3 without discarding bindings, device calibration or setup. Versioned replay pages remain separate. |
| 140 | DEVELOPMENT PHASES | OPEN: development has not passed all thirty-one phase gates. |
| 141 | THREE FINAL AUDITS | OPEN: the three complete final project audits have not been completed. |
| 142 | ANTI-LAZINESS RULES | No success declaration from compilation or a single scenario. Full master completion remains open. |
| 143 | PLACEHOLDER POLICY | Release-critical placeholder review must be repeated before final completion. |
| 144 | COMMENTS | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 145 | CODE QUALITY | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 146 | FINAL REQUIRED SCENARIO | OPEN: component and browser workflows cover portions; the complete combined final scenario has not passed as one end-to-end acceptance test. |
| 147 | FINAL QUALITY STANDARD | OPEN: the complete final perceived-physics and visual quality standard is not certified. |
| 148 | FINAL OPERATING INSTRUCTION | OPEN: iterative implementation and evidence continue; no full-spec completion declaration. |
