# Physics-clock recording and full-session replay

This checkpoint extends directive sections 53, 67, 80–82, 99, 133–135 and 139. It is not a declaration that the entire master directive is complete.

## Capture and ownership

`TelemetrySampler` runs inside the physics worker. Every second 120 Hz tick captures a 176-channel sample; every eighth tick captures a complete numeric pose snapshot for every car. Rendering never supplies the capture clock. Six transferable telemetry buffers and six pose buffers provide bounded transport queues. Buffers are returned after the main thread copies their contents. A stalled consumer produces an explicit recording-gap warning; no interpolated or invented measurements fill the gap.

Telemetry uses a fifteen-minute typed-array ring. Export takes a chronological copy and transfers that copy to a separate formatting worker. Cancellation, worker errors and a thirty-second timeout reject the export. A late old-worker response cannot terminate or download a later session's export.

The wire format is version 2: sixteen header floats, 208 floats per car, four 24-float wheel records beginning at offset 80, and four eight-float debris records beginning at offset 176. Fields include real motor/regen power, suspension length, tire pressure/radius/puncture, graining/blistering, component health, jack height, penalties and sector state. The internal wheel sequence is **FR, FL, RR, RL**: +Z points toward the nose, +Y up, and +X toward the driver's left. CSV headers and the tire panel follow the actual hub positions.

## Replay paging

`SessionReplay` records numeric state at 15 Hz, not scene objects or GPU resources. Completed 300-frame pages are written to a private IndexedDB session cache. A maximum of four completed resident pages, the current page, and bounded write/read queues prevent memory growth proportional to race duration. Per-page timing metadata supports binary-search seeking. Unit tests retain and seek a 1,266-second recording, including its first frame, beyond the old twenty-minute rolling limit.

Spatial water/rubber keyframes are recorded at the same simulation times as their original updates. Water is quantized to one micrometre in millimetre units; rubber to 16-bit normalized coverage. Playback chooses the recorded surface, while leaving the current live surface untouched and restoring it when replay closes. Weather is not reconstructed from the final session's wetness.

A seek into an evicted page displays buffering until the requested page is available. Async reads never write directly into the currently rendered frame. Invalid page versions, missing pages, storage quota failures and excessive write backlog surface explicitly. Storage failure stops further archival capture without pretending the whole race was saved. The cache is session-scoped and is cleaned when the session is replaced or disposed; it is not a user-facing permanent replay library. Browser shutdown can interrupt asynchronous cleanup.

## Simulation-to-presentation connections

Detached wing fragments now render from physical pool positions. Destroyed wings disappear from attached bodywork; a repaired front wing restores its lost component mass. Physical tire radius, suspension length and per-corner steering damage drive the rendered wheels. Hybrid audio consumes actual motor output instead of inferring it from battery changes. Tire scrub consumes the actual dissipated slip power.

The desktop cockpit HUD moves beside the car instead of covering the physical steering display. Procedural cockpit and environment fidelity remain subjects for the final visual audit.

## Verification boundaries

Local lint, TypeScript, production build and 107 tests passed during development. The three four-car weather scenarios and ten-car physical pit scenario passed; the pit report contains a small contact event, **not zero contact**. The browser workflow additionally checks real IndexedDB page creation, 176 CSV columns and exact two-tick sample spacing, camera visibility, manual steering, replay/pause safety and the results screen. A browser pass must be read from the workflow for the exact published revision.

Long-run AI contact robustness, complete wheel calibration/graphics accessibility controls, race-director depth, full requested dynamics benchmarks, target-device profiling, and final engineering/player/audiovisual audits remain open. Historical reports without a matching source revision are not current acceptance certificates.
