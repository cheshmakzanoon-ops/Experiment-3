# Telemetry analysis and keyboard ownership

This checkpoint completes the requested telemetry-screen groups and repairs input remapping; it does not certify the whole simulator as complete.

## Trace selection

The telemetry screen exposes seven groups, each with four independently labelled panels: driver controls, chassis/aerodynamics, tire temperature/load, tire slip/forces, brakes/wear, suspension travel, and hybrid/fuel. Every curve reads a named channel from the 176-channel recording schema. The front-aero-share curve is calculated from the recorded front and rear forces. Display conversion to km/h, millimetres, degrees, kW and MJ never changes SI simulation values or the CSV schema.

Live traces use actual sample time over the last 25 seconds. Axes expand to observed extrema rather than clipping excessive loads or slips out of view. Min/max pixel buckets retain short-duration peaks, and capture gaps break curves. Color and line dashes both identify curves.

Lap comparison aligns the latest two fully recorded lap segments by actual circuit distance, across every selectable channel group. A truncated first lap in the telemetry ring, the currently incomplete lap, or a lap containing a recording gap is not passed off as a complete recording. Invalid racing laps remain available but are visibly labelled INVALID. The engine does not fabricate missing values or resimulate a preferred result.

## Remapping

Settings version 2 adds bindings for all fifteen existing keyboard actions, including camera, hybrid mode, pit request, telemetry, replay and manual gear changes. Valid version-1 driving bindings migrate while new actions receive their defaults. Duplicate assignments and reserved keys are rejected. Escape always remains pause/cancel.

Arrow keys and Space remain fallback driving aliases only when they have not been explicitly assigned to another action. Remapping ArrowRight to throttle therefore cannot also turn the car right. The physical left-positive simulation convention is unchanged; device steering is converted once at the input boundary.

A key-capture listener belongs to the open settings modal. Starting another capture, cancelling, closing, replacing the modal or applying settings aborts the old listener. Failed validation is shown in the UI and does not apply a partial settings object. Driver instructions and HUD key hints reflect saved bindings.

## Evidence and boundaries

Focused tests validate channel lookup, finite plotting, unit-aware labels, complete-lap detection, invalid/gapped recordings, aero ratios, schema migration, duplicate binding rejection, alias ownership and single-event dispatch. Browser coverage selects the actual graph groups and verifies the accessible labels; it also checks conflict rejection, cancelled capture and saved bindings after reload.

This does not add physical wheel calibration, clutch dynamics, native force feedback, safety-car rules or the outstanding final audits. Those remain separate specification requirements rather than being silently considered solved by this UI work.

The same checkpoint replaces the unstable gyroscopic rotation update with the independently tested method in [ANGULAR_INTEGRATION.md](ANGULAR_INTEGRATION.md). The local combined suite contains 129 passing tests. Long-run AI gates remain separate and must not be inferred from this pass.
