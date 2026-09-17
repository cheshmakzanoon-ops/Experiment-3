# Specification coverage ledger

This ledger follows the numbered sections of the supplied directive. “Implemented” means a concrete code path exists; it does **not** certify every aspirational fidelity or performance statement in that section. Approximate/partial sections explicitly state the boundary.

| Section | Topic | Delivery status |
|---:|---|---|
| 1 | NON-NEGOTIABLE ENGINEERING PHILOSOPHY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 2 | THREE-PASS RULE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 3 | REQUIRED TECH STACK | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 4 | REPOSITORY STRUCTURE | Equivalent ownership boundaries in a smaller module tree; not the exact requested directory layout. |
| 5 | GAME LOOP | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 6 | PHYSICS COORDINATE SYSTEM | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 7 | RIGID BODY STATE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 8 | FORCE ACCUMULATION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 9 | INTEGRATOR | Semi-implicit integration and normalized quaternion; no advanced symplectic rotational solver. |
| 10 | WHEEL CONTACT MODEL | Four suspension rays against an analytic ribbon; no tire contact-patch mesh. |
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
| 27 | GEARBOX | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 28 | DIFFERENTIAL | Torque-coupling limited-slip approximation. |
| 29 | HYBRID SYSTEM | Energy-conserving deployment/regeneration; no detailed electrical hardware model. |
| 30 | AERODYNAMICS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 31 | AERO MAP | Analytic tunable aero map, not measured CFD tables. |
| 32 | GROUND EFFECT | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 33 | BOTTOMING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 34 | WAKE / DIRTY AIR | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 35 | SURFACE TYPES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 36 | TRACK SPLINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 37 | TRACK SURFACE STATE GRID | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 38 | RUBBERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 39 | MARBLES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 40 | WATER MODEL | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 41 | AQUAPLANING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 42 | WEATHER TIMELINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 43 | AI ARCHITECTURE | Strategic/tactical/controller frequencies separated inside the physics worker. |
| 44 | AI SPEED PLANNING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 45 | AI RACING LINE | Pure-pursuit offset racing line; no globally optimized minimum-time trajectory. |
| 46 | AI OVERTAKING | Lane selection/commitment, following envelope and side protection. |
| 47 | AI DEFENSE | Side-by-side protection, not a fully strategic defensive behavior tree. |
| 48 | COLLISION PREDICTION | Longitudinal preview and corridor checks, not continuous swept-volume prediction. |
| 49 | AI PERSONALITIES | Small deterministic skill differences; not a rich personality model. |
| 50 | AI ERROR MODEL | Emergent errors, not a calibrated driver-error stochastic model. |
| 51 | COLLISION SYSTEM | Two-capsule chassis approximation; not arbitrary mesh contact. |
| 52 | DAMAGE ENERGY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 53 | DAMAGE PHYSICS | Wing/floor/suspension changes; no detached-part or full crash deformation simulation. |
| 54 | RENDER PIPELINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 55 | PBR | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 56 | CARBON FIBER SHADER | Procedural woven PBR texture, not a dedicated anisotropic carbon BSDF. |
| 57 | WET ROAD SHADER | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 58 | REFLECTIONS | Generated environment reflections; no SSR, ray tracing or live mirrors. |
| 59 | SHADOWS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 60 | LIGHTING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 61 | ATMOSPHERE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 62 | MOTION BLUR | Not implemented: no object/camera motion blur. |
| 63 | SPEED PERCEPTION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 64 | CAMERA DYNAMICS | Damped positional cameras and acceleration offsets, not full six-axis camera dynamics. |
| 65 | COCKPIT CAMERA | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 66 | TRACKSIDE CAMERAS | Circuit-position trackside cameras; no director shot-selection system. |
| 67 | PARTICLES | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 68 | RAIN SPRAY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 69 | TIRE SMOKE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 70 | SPARKS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 71 | AUDIO ARCHITECTURE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 72 | ENGINE SOUND | Original procedural harmonic synthesis rather than recorded engine layers. |
| 73 | TIRE AUDIO | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 74 | SURFACE AUDIO | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 75 | DOPPLER | Approximate stereo/Doppler for nearest engines, not full acoustic propagation. |
| 76 | INPUT PIPELINE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 77 | GAMEPAD STEERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 78 | KEYBOARD STEERING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 79 | WHEEL INPUT | Gamepad-exposed axes/buttons, inversion/deadzone/response mapping. No native wheel force feedback. |
| 80 | TELEMETRY DATA | Delivered player snapshots, normally 60 Hz; CSV timestamps preserve real capture gaps. |
| 81 | TELEMETRY UI | Live plots, CSV and two-lap distance comparison; no full professional telemetry workstation. |
| 82 | REPLAY SYSTEM | Bounded interpolated pose replay, not complete deterministic state reconstruction. |
| 83 | RACE DIRECTOR | Core starts/laps/penalties/classification; no safety car, formation laps or steward simulation. |
| 84 | START LIGHTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 85 | LAP DETECTION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 86 | TRACK LIMITS | Simplified four-wheel outside test and penalty accumulation. |
| 87 | PIT LANE | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 88 | PIT STOP | Timed physical box service and tire/front-wing changes; simplified crew animation. |
| 89 | SETUP SYSTEM | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 90 | HUD DESIGN | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 91 | STEERING-WHEEL DISPLAY | Live canvas display and steering animation; not every steering-wheel button is interactive. |
| 92 | GRAPHICS SETTINGS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 93 | PERFORMANCE BUDGET | Instrumented, but target-GPU performance is not certified. |
| 94 | OBJECT ALLOCATION | Pooled snapshots/particles/recorders; small per-tick/per-frame allocations remain. |
| 95 | LOD | Quality reduction and batching; explicit mesh LOD levels not implemented. |
| 96 | INSTANCING | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 97 | TEXTURE MANAGEMENT | Locally generated small textures and mipmaps; no compressed asset atlas pipeline. |
| 98 | ASSET STREAMING | Not implemented: no asynchronous external asset streaming, because all assets are generated. |
| 99 | PHYSICS WORKER | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 100 | AI WORKER | AI runs in the physics worker, not a second dedicated AI worker. |
| 101 | DEBUG OVERLAY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 102 | VISUAL DEBUGGING | Contact-load arrows and numeric telemetry; not all requested overlays. |
| 103 | UNIT TESTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 104 | PHYSICS PROPERTY TESTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 105 | DETERMINISM TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 106 | FRAME-INDEPENDENCE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 107 | STRAIGHT-LINE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 108 | SKIDPAD TEST | Not implemented as an isolated instrumented skidpad test. |
| 109 | BRAKING TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 110 | SLALOM TEST | No dedicated standalone slalom report; dynamic steering is exercised by circuit tests. |
| 111 | KERB TEST | Shared physical kerbs exercised on circuit; no standalone kerb-impact report. |
| 112 | WET TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 113 | DAMAGE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 114 | WAKE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 115 | AI TESTS | 100-lap dry single-car endurance and shorter multi-car weather scenarios; not 100-lap multi-car proof. |
| 116 | RACE TEST | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
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
| 133 | ACCESSIBILITY | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 134 | AUDIO/VISUAL CONNECTION | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 135 | NO DISCONNECTED EFFECTS | Implemented in the corresponding simulation, rendering, input, audio, UI, storage or test module; see architecture and test evidence. |
| 136 | EVENT BUS | Typed worker protocol and explicit callbacks, not a separate generalized event-bus package. |
| 137 | CONFIGURATION DATA | Central vehicle/setup data with some renderer/AI constants still local. |
| 138 | NO MAGIC NUMBERS | Units and named core settings provided, but some local tuning constants remain. |
| 139 | VERSIONED SAVES | Versioned preferences/setup and best laps; no mid-race checkpoint restore. |
| 140 | DEVELOPMENT PHASES | Implemented as an integrated delivery rather than separate commits for every phase. |
| 141 | THREE FINAL AUDITS | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 142 | ANTI-LAZINESS RULES | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 143 | PLACEHOLDER POLICY | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 144 | COMMENTS | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 145 | CODE QUALITY | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 146 | FINAL REQUIRED SCENARIO | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 147 | FINAL QUALITY STANDARD | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
| 148 | FINAL OPERATING INSTRUCTION | Acceptance target: see actual validation reports and stated limitations; no blanket claim of completion. |
