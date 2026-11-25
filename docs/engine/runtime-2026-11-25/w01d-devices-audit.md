# W01D — input and audio audit

Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. Read-only review and
direct production-module probes; no production or test edits. Read `SESSION.md`,
the prior advancement README/change guide, devices audit/review and resource
bounds report. Findings below are additional to their completed work.

## 1. P2 — gear accessibility cues ignore the recorded vehicle

**Source:** `src/audio/driving-cues.ts:170–189`. `DrivingCueDirector.sample()`
uses `gear < 8`, `rpm > 11800` and `rpm < 4800` for every vehicle. The actual
caller, `RacingAudio.update()`, receives the presented vehicle snapshot and
enables cues for a live human. `GameApp.buildRenderer()` configures this director
for every circuit vehicle (`src/main.ts:690`), without a Formula-only gate.

**Production-function probe:** construct a real default `Track`, a director,
and a valid one-car racing frame; enable only gear cues. Set `R.VEHICLE` using
the actual `vehicleIndex()`, speed 35 m/s and throttle 1. Observed:

| Vehicle | Actual limiter / shift RPM | Current / maximum gear | Sample RPM | Returned cue |
| --- | ---: | ---: | ---: | --- |
| `tc1` | 8,100 / 7,600 | 3 / 6 | 8,090 | `null` |
| `gpr1` | 18,200 / 17,600 | 6 / 6 | 18,190 | `upshift` |

Thus the touring driver never receives the intended high-RPM cue, while the
motorcycle driver receives an impossible upshift at top gear. These are current
catalogue values, read from `vehicleDefinition(id).spec`, not invented tuning.

**Narrow repair:** resolve the recorded vehicle and derive eligibility from its
existing forward-gear count and shift/rev range. Preserve authored cue tones,
arbitration, cooldown and the current Formula behavior. Establish an explicit
compatible downshift policy rather than carrying 4,800 RPM across every engine.
Acceptance should cover the two witnesses, an ordinary Formula upshift, electric
single-speed drive and different maximum forward gears. No vehicle/profile edit
or rendering/protocol change is required.

## 2. P2 — a second calibration failure can skip the required pause

**Source:** `src/input/controller.ts:153–166,395`. `deviceFault()` resets input
but invokes `deviceLost` only when its message differs from `lastFault`.
`lastFault` clears only after a fully successful pad sample. A fresh mapping
object unblocks the previously suppressed device, but does not reset that fault
episode. The actual settings transaction replaces `this.input.settings`
(`src/main.ts:3664`); its `deviceLost` action is what calls `suspendPlayback()`
(`src/main.ts:3150–3152`).

**Production-controller probe:** use a connected standard pad with its mapped
steering axis unavailable. The `deviceLost` callback disables the controller,
matching the host's pause ownership. Then replace settings with a structured
clone, enable driving again, and sample the same still-invalid device.

| Observation | Initial failure | Failure after settings retry |
| --- | --- | --- |
| Total `deviceLost` calls | 1 | **1** |
| Controller enabled afterward | false | **true** |
| Status | Missing steering axis | Same missing steering axis |

The second sample resets controls and suppresses the pad, but leaves gameplay
running because no pause action is emitted. A later keyboard sample may then
publish controls despite the newly failed controller validation.

**Narrow repair:** scope fault suppression to a device/mapping ownership episode,
or separate message deduplication from the mandatory pause action. Do not clear
the latch on every ordinary reset, which would defeat repeated-fault suppression.
Test a repeated failed mapping retry, no repeated callback within the same
suppressed episode, and recovery after a genuinely valid sample. No host edit is
needed to fix the missing action.

## 3. P3 — disabled driving audio eagerly constructs its entire guide route

**Source:** `src/audio/engine.ts:69–73` constructs `DrivingCueDirector` before
validating settings. Its constructor (`driving-cues.ts:74–76`) always constructs
`GuideRoute`, including when the shipped default is `enabled: false`.
The real callers are renderer installation and settings application
(`src/main.ts:690,3673`).

**Production-owner probe:** wrap a real default Track's `at` method with a
counter, then call `new RacingAudio().configureDriving(track,
validateDrivingAudio(null))`. No audio context is needed. Observed disabled
diagnostics, **744 Track.at calls**, and two retained route arrays totaling
**11,904 bytes** for a 2,972.727 m track. `GuideRoute` also executes two braking
sweeps and creates one temporary three-number array per sample. All this work
precedes any enabled cue. The bytes are array payload, not measured heap/GC.

**Narrow repair:** lazily create the director/route when enabled cues actually
need it, retaining the current track/settings separately. Test default-disabled
configuration, later enablement on the current track, and a disabled track switch
followed by enablement. Keep the route algorithm in the protected rendering file
unchanged. This is an operation/allocation finding; no FPS or timing gain claimed.

## Probe and scope boundary

All three probes ran together under
`node --experimental-transform-types --input-type=module` from the repository;
exit 0, under one second reported process time. They imported the current actual
production classes and catalogue. Only DOM/gamepad event targets were stand-ins;
no methods under test were substituted. No test suite, browser, installation,
build, git write, protected-content mutation or new performance benchmark ran.
