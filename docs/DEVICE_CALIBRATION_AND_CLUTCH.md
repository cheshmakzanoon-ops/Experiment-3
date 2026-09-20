# Calibrated devices and physical clutch

## Scope

This checkpoint implements the master directive's wheel calibration and clutch control path. It does not certify physical hardware compatibility, native force feedback, or completion of the full master directive.

## Input ownership

Automatic selection uses only a browser-standard gamepad. Unmapped wheels require explicit slot and device-ID selection in Garage & Settings. A different device reusing the slot never receives the saved calibration. A disconnected device pauses active driving once. A malformed/missing configured channel pauses the session and suppresses that profile until settings are reapplied; keyboard controls remain available. Nonstandard paddles use configured button numbers, not Xbox assumptions. A held button during connection/resume is not a new shift edge.

Steering captures left/center/right values independently; asymmetric travel and reversed axes are supported. Throttle, brake and clutch each capture released/fully-pressed values, independently of the others. A live monitor exposes the actual raw axes and pressed buttons. Incomplete, degenerate, non-finite and mismatched-axis captures are rejected. All captures are draft state until Apply, and modal replacement/close aborts polling and listeners.

Deadzone, saturation and exponent act after normalization. Wheel mode bypasses keyboard slew limiting. Explicit keyboard steering remains available. At the original clutch checkpoint, settings versions 1 and 2 migrated to version 3; the new clutch key does not steal a previously assigned Shift key. The default clutch key is Left Shift, and manual clutch mode is opt-in.

## Physics

`FrictionClutch` couples finite engine inertia (0.34 kg m²) to the two rear-wheel inertias through the selected gear ratio. Source torque first advances engine momentum; the clutch exchanges an equal/opposite angular impulse limited by 760 Nm times engagement and timestep. The unclipped impulse is computed from the sum of inverse engine inertia and gear-referred wheel inverse inertia. Slip work is the impulse times average pre/post relative shaft speed; it is nonnegative in the isolated solve. Tire/road forces are operator-split after this coupling rather than overwritten with prescribed wheel velocity.

Pressing the clutch opens the torque path. The engine can free-rev in neutral or with the clutch pressed, shifting unloads the shaft, and releasing the pedal transfers torque through the normal tire solver. Automatic launch control derives engagement from engine speed and disconnects at rest with no throttle. The powered idle governor consumes fuel; motor deployment still debits actual battery energy. Engine drag dissipates rotation rather than clamping RPM. These coefficients are documented engineering approximations, not measured race-engine data.

Five new telemetry channels expose clutch pedal, engagement, shaft torque, slip heating, and combustion torque. At that original checkpoint, snapshot protocol version 3 and 181 named CSV channels distinguished the extension. The current recording protocol is 7 with 203 channels; settings versions are independent. The telemetry screen includes a clutch/engine group.

## Verification

`tests/calibration.test.ts` covers endpoint normalization, sparse/reused device slots, migration, custom paddles, disconnects and malformed mappings. `tests/clutch.test.ts` checks dissipative impulse transfer, reverse/neutral/shift behavior, physical free-rev-to-launch and serialized state. `e2e/calibration.spec.ts` drives the actual settings UI with synthetic Gamepad snapshots, persists calibration, then exercises the real simulation clutch and disconnect pause. Synthetic device tests do not stand in for a real wheel/pedal hardware test.

## Browser interface reference

The W3C Gamepad specification defines sparse/reused indices, unmapped versus standard devices, and normalized axes: https://www.w3.org/TR/gamepad/. The device-ID format is browser-dependent; a browser/driver change may require reselection and recalibration. The implementation uses only Gamepad-exposed inputs; it does not send undocumented device reports.

## Controller-action continuation (settings version 6)

The former hard-coded camera/ERS/pause buttons are replaced by a saved action table.
Camera, ERS, pit request, telemetry, replay, AI demonstration, mute, engineering,
pause/resume and held reverse can be assigned or disabled individually. All values
are integer button indices or -1 (disabled). Duplicate actions, active pedal/paddle
conflicts, unknown actions and missing live-device buttons are rejected before Apply.
Inactive axis-pedal button slots do not reserve unrelated buttons.

Versions 1–5 migrate into version 6 without changing existing steering calibration,
setup or keyboard assignments. Version-4 independent graphics fields survive the
migration. For versions 1–4, automatic standard-pad profiles retain the earlier three
action defaults; explicitly selected devices start with no guessed action bindings.
Version-5 explicit assignments are retained. A legacy
action conflicting with a drive button becomes disabled, never stealing that control.

The input pump may poll a restricted UI-action list during pause/replay without
sampling or sending drive axes. Pause/resume requires release and repress; a held
button across connection, resume or input ownership changes does not fire again.
An action that changes input ownership aborts the old update before it can leak
pedals into replay. The paused settings/telemetry editors cannot be dismissed by
an accidentally held resume button. Explicit keyboard fallback remains available.

Thirty-one additional unit tests cover schema migration, conflicts, malformed
indices, every edge-triggered action, held reverse and ownership transitions.
The full calibration browser case now also exercises settings rejection, persistence,
custom-wheel camera selection and pause/resume; that full navigation-dependent
case still requires execution in an environment that permits application navigation.

Version 6 retains the canonical `mapping.buttonActions` field introduced by the
concurrent remote version-5 candidate. Its nine saved actions are preserved and
reverse is introduced as an unbound held control, not inferred from another
button. All ten fields are explicit in new saves; malformed maps are rejected.
Action edges use one shared dispatcher, consume simultaneous/forbidden presses,
and establish a fresh baseline after focus loss. A button pressed in a hidden tab
cannot silently resume the session on return. Forty-five native action cases
include the retained concurrent tests, version-5 migration and this focus guard.
