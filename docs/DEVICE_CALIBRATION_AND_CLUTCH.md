# Calibrated devices and physical clutch

## Scope

This checkpoint implements the master directive's wheel calibration and clutch control path. It does not certify physical hardware compatibility, native force feedback, or completion of the full master directive.

## Input ownership

Automatic selection uses only a browser-standard gamepad. Unmapped wheels require explicit slot and device-ID selection in Garage & Settings. A different device reusing the slot never receives the saved calibration. A disconnected device pauses active driving once. A malformed/missing configured channel pauses the session and suppresses that profile until settings are reapplied; keyboard controls remain available. Nonstandard paddles use configured button numbers, not Xbox assumptions. A held button during connection/resume is not a new shift edge.

Steering captures left/center/right values independently; asymmetric travel and reversed axes are supported. Throttle, brake and clutch each capture released/fully-pressed values, independently of the others. A live monitor exposes the actual raw axes and pressed buttons. Incomplete, degenerate, non-finite and mismatched-axis captures are rejected. All captures are draft state until Apply, and modal replacement/close aborts polling and listeners.

Deadzone, saturation and exponent act after normalization. Wheel mode bypasses keyboard slew limiting. Explicit keyboard steering remains available. Legacy settings versions 1 and 2 migrate to version 3; the new clutch key does not steal a previously assigned Shift key. The default clutch key is Left Shift, and manual clutch mode is opt-in.

## Physics

`FrictionClutch` couples finite engine inertia (0.34 kg m²) to the two rear-wheel inertias through the selected gear ratio. Source torque first advances engine momentum; the clutch exchanges an equal/opposite angular impulse limited by 760 Nm times engagement and timestep. The unclipped impulse is computed from the sum of inverse engine inertia and gear-referred wheel inverse inertia. Slip work is the impulse times average pre/post relative shaft speed; it is nonnegative in the isolated solve. Tire/road forces are operator-split after this coupling rather than overwritten with prescribed wheel velocity.

Pressing the clutch opens the torque path. The engine can free-rev in neutral or with the clutch pressed, shifting unloads the shaft, and releasing the pedal transfers torque through the normal tire solver. Automatic launch control derives engagement from engine speed and disconnects at rest with no throttle. The powered idle governor consumes fuel; motor deployment still debits actual battery energy. Engine drag dissipates rotation rather than clamping RPM. These coefficients are documented engineering approximations, not measured race-engine data.

Five new telemetry channels expose clutch pedal, engagement, shaft torque, slip heating, and combustion torque. Snapshot protocol version 3 and 181 named CSV channels distinguish this extension from earlier saved data. The telemetry screen includes a clutch/engine group.

## Verification

`tests/calibration.test.ts` covers endpoint normalization, sparse/reused device slots, migration, custom paddles, disconnects and malformed mappings. `tests/clutch.test.ts` checks dissipative impulse transfer, reverse/neutral/shift behavior, physical free-rev-to-launch and serialized state. `e2e/calibration.spec.ts` drives the actual settings UI with synthetic Gamepad snapshots, persists calibration, then exercises the real simulation clutch and disconnect pause. Synthetic device tests do not stand in for a real wheel/pedal hardware test.

## Browser interface reference

The W3C Gamepad specification defines sparse/reused indices, unmapped versus standard devices, and normalized axes: https://www.w3.org/TR/gamepad/. The device-ID format is browser-dependent; a browser/driver change may require reselection and recalibration. The implementation uses only Gamepad-exposed inputs; it does not send undocumented device reports.
