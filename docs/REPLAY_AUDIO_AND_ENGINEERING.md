# Replay presentation, camera-relative audio and live engineering inspection

Continuation from `be8e95ae273dde0a06f8c70ae23f88bd0c8cf38c`, against the
unchanged 148-section `MASTER_DIRECTIVE.md` / original **Pasted markdown(6).md**.
This closes specific integration gaps in sections 64–75, 82, 94, 101–102,
106, 117 and 134–146; it is not a whole-project completion certificate.

## Pass 1 — Functional connections

The previous renderer explicitly disabled its particle emitters during replay.
During live pauses it could also advance and emit particles from a frozen
snapshot because the presentation used clamped wall time. `PresentedFrame`
now interpolates continuous effect/audio channels and quaternions in a reusable
buffer. IDs, surface types, gears, compounds and service states stay discrete.
A fitted-tire pickup counter reset is not interpolated into a negative ramp.
This is a presentation-only buffer: physics, CSV and replay pages keep the actual
original samples, with their existing protocol version 7 and 203 CSV columns.

`EffectPlayback` uses the presented simulation time for both live and replay
particle advancement. A frozen simulation cannot manufacture smoke/rain, move
particles or age their lifetimes. Continuous updates use at most 1/30-second
substeps (at most 60 per update) and trace the emitter through the interpolated trajectory. Seeks,
rewinds and gaps above two seconds clear the pool rather than connect unrelated
locations with a particle trail. The existing 1,800-particle capacity is unchanged.
A seek intentionally does not reconstruct every particle born before the seek;
new emissions reconstruct from the recorded contact/weather state as playback
advances. Particle placement is not claimed to be bit-identical across render
rates, but emission work and simulation-time aging are covered by regressions.

A subsequent paused-view check also exposed continued trackside pan/zoom and
cockpit/chase spring convergence on wall time. Those camera dynamics now consume
a pause-aware presented-time clock; free-look and camera selection remain usable.
A native regression exercises the actual TracksideDirector and inertial camera,
while the full browser replay test requires an unchanged paused listener.

The audio listener now comes from the actual camera position and camera-right
basis. Camera local +X is screen right, unlike this car model's +X-left convention.
Camera velocity is measured per presented simulation second, not wall second,
so changing replay speed does not manufacture a supersonic camera. Camera cuts,
rewinds and discontinuities reset that velocity. Interior engine monitoring stays
centered without self-Doppler. External voices use both source and listener radial
velocity, inverse-distance attenuation and a bounded far-distance fade.

Four stable engine voices are selected relative to the camera, with incumbent
hysteresis. A trackside listener is not forced to retain the distant player car
at the expense of a nearby opponent. Original three-band RPM/torque synthesis is
retained. Voice replacement briefly fades before retuning instead of sweeping
one full-volume engine into another car's pitch. Player contact buses are panned
and attenuated spatially. Ambient rain remains at the listener; trackside wind
uses listener air speed rather than the player's racing speed. The simplified
acoustic model does not simulate buildings, occlusion, propagation delay,
reflections or a complete per-opponent tire/contact graph.

## Pass 2 — Engineering validation

`tests/presentation-time.test.ts` covers continuous/discrete interpolation,
quaternion normalization, malformed pairs, six render rates (24/30/60/90/120/144),
frozen particles, accelerated playback, jumps/rewinds, tire-counter replacement
and disabling particles on a frame with no simulation advance.
`tests/spatial-audio.test.ts` covers camera-right signs, source/listener Doppler,
interior centering, finite/sonic guards, cuts and rewinds, camera-relative voice
selection, identity retention and reuse of the bounded output objects.

`e2e/spatial-audio.spec.ts` renders the actual production `EngineVoices` graph in
Chromium's `OfflineAudioContext`. This is not a mock of oscillator or panner nodes.
Seven one-second, stereo 48 kHz acoustic fixtures check real sample amplitudes,
frequency ratios, far-distance silence and a moving left-to-right pass-by. The
prescribed trajectory is an isolated acoustic test, not an invented driving
result. `spatial-audio-signals.json` retains a measured browser run with the exact
source/test hashes. It does not certify speaker/headphone quality or subjective
commercial-engine fidelity.

The full application browser test now records a wet four-car practice session,
retains actual IndexedDB replay pages and checks all 203 CSV columns/tick spacing.
It requires live and replay rain/spray, frozen live/replay pauses, a trackside
listener, replay-speed changes and a still-paused live worker. It uses normal
settings/buttons and read-only diagnostics, not injected physics poses or fake
worker responses. The complete Chromium/WebGL suite is a publication gate;
local Chromium in this workspace can render audio but cannot create WebGL.

## Pass 3 — Developer inspection and lifecycle refinement

F3 now displays the required section-101 categories: render/physics/GPU timing,
draws/triangles, speed, body-up yaw rate, pitch/roll, all three G components,
per-wheel Fz/Fx/Fy, slip ratio/angle, surface/carcass temperature, wear, surface
material/water, aero front/rear/drag/balance and actual AI target speed/path/
decision. Unknown GPU timing remains explicitly unsupported or pending; it is
not a CPU-derived fabricated GPU number.

An opt-in `EngineeringProbe` copies the actual last-solve wheel query origins,
contact locations/normals, contact-cell rubber/marbles and the actual controller's
AI decision/target offset. It emits at most ten records per simulated second and
allocates no records while disabled. The asynchronous probe's own tick/time are
shown separately from the numeric render snapshot. An inactive AI is identified
as inactive rather than presenting an old target as the human player's intent.
Cyan query rays, amber contact markers and green normal-load arrows use the
physical samples. The renderer does not guess a flat-world normal or report
its original, unchanged visual-track grid as current physical rubber.

These optional inspection records are not in archived replay pages. Live
contact/path overlays are therefore hidden in replay and on stale/missing probe
data, rather than misrepresented as recorded history. Core recorded wheel/aero/
body channels remain inspectable in replay. The debug panel scrolls and can be
hidden immediately with F3. Geometry, audio nodes and event-history cleanup are
explicit; unchanged debug samples do not re-upload GPU instance buffers.

`tests/engineering.test.ts` verifies exact source values, copied ownership,
rate limits, disabled/reset behavior, corrupt input rejection, AI activity,
complete category formatting, stale/replay exclusion and physical marker/ray
positions. A paired simulation run is exactly equal with and without the probe,
including numeric snapshots and water/rubber/marble grids. The existing two-origin
browser worker test now also requires real typed engineering responses. The full
application test toggles F3, checks live data and retains an engineering screenshot.

## Slow-display regression

The first browser candidate exposed a real low-frame-rate failure: treating every
half-second presentation gap as a seek repeatedly cleared rain and spray on the
software-rendered runner. The trace recorded approximately one frame per second
and increasing reset counts with zero particle births. This was not accepted as
a pass or hidden by disabling effects. The continuous presentation window now
supports up to two simulation seconds with at most sixty 1/30-second substeps.
Three new 0.5/1/2 FPS tests require exact cumulative emission totals and nonzero
live rain/spray, while frozen frames and large seeks retain their safety tests.
Explicit UI seeks still reset the pool, independently of their time displacement.
This is bounded visual catch-up, not permission to skip or alter physics ticks.

## Scope and retained acceptance boundaries

No file in `src/simulation/` or `src/core/` is changed by this continuation. The
simulation/core fingerprint remains
`30c155c669e4af3f1d5b2a40ab0ce9acd44d5dc19ee82777df8f6c6bf2149484`.
The earlier 50-/100-lap reports remain evidence for that exact physics core and
their separately recorded all-source identities, not fresh runs of this rendering
build. Existing physics/journey, rotation, pit and classification gates remain.

These three passes describe the changed subsystems, not three independent audits
of every file or certification of every master section. The complete combined
section-146 driving/audiovisual acceptance, representative-hardware performance,
independent handling/presentation review and sections 140–148's final quality
obligations remain open. Do not infer full completion from unit counts or an
isolated audio/GPU test.

## Recovery from the failed a18701b publication

Run 35423347163 passed the native gates but failed two browser assertions and
therefore did **not** commit the readable replay/audio candidate into main. Its
retained traces identified a real cockpit heading defect and a camera-observation
race. The source candidate was recovered from that exact run, not reconstructed
from a summary. The original Markdown 6 hash is unchanged.

The camera clock previously returned zero dt above a half-second gap, freezing
its heading filter while the car continued turning. Slow displays now receive a
bounded spring step through two seconds. Genuine discontinuities explicitly
rebaseline camera springs, trackside tracking and listener velocity. The cockpit
orientation retains a small filtered response, with remaining angular lag bounded
to 0.04 radians; it cannot accumulate an off-screen view through a hairpin.
`presentedCamera` identifies the camera actually drawn, distinct from an immediate
UI request. The browser test awaits that real presentation before inspecting the
listener. Instrument visibility and projection thresholds are unchanged.

Ten new camera regressions cover turning at 0.5, 1, 2, 24, 30, 60, 90, 120 and
144 FPS, frozen snapshots, discontinuities and invalid rotations. These verify
numerical presentation behavior, not representative GPU performance.

## Controller remapping and versioned preferences (sections 76, 79, 133, 139)

Nine controller actions are editable: pause/resume, camera, ERS, pit request,
replay, telemetry, mute, engineering and AI demonstration. Pedal, steering,
clutch and paddle mappings remain separate. Integer button indices are bounded
from -1 (disabled) through 127; action/action and action/driving-button conflicts
are rejected before applying or saving. Selecting an unmapped wheel clears the
implicit standard-pad action defaults so the user explicitly selects its buttons.

Settings version 5 preserves v4 graphics and calibrated axes. Legacy auto-selected
standard controllers retain their prior pause/camera/ERS defaults except where a
driving binding already owns that button. Explicitly selected legacy devices
migrate with actions disabled because their mapping type was not persisted;
calibration and pedal/paddle settings are retained. No unsupported mapping type
is inferred from a device name. Existing keyboard bindings also remain intact.

Action edges are sampled independently of physics and rendering. A held button
on connect, rebind or pause cannot repeatedly toggle a menu. Paused input accepts
only a fresh resume edge, never pedals; replay accepts only presentation actions.
Settings forms and menus consume presses without deferring them into a later
race. The action runtime checks driving-button ownership without allocating a
Map on every input poll. Fourteen new tests exercise all nine actions, migration,
conflict rejection, held-button guards and paused-input isolation. The existing
custom-wheel browser test now verifies saved action fields, rejection of a real
paddle conflict, camera switching and controller pause/resume before continuing
its actual clutch and disconnect checks.

The combined candidate has 377 unit/property tests. Lint, TypeScript and production
build are separate gates; the full browser suite must still pass for publication.
This does not close the complete human audiovisual scenario, target-hardware
performance, project-wide three-pass reviews or independent final audits.
