# Physics-clock recording and full-session replay

This checkpoint extends directive sections 53, 67, 80–82, 99, 133–135 and 139. It is not a declaration that the entire master directive is complete.

## Capture and ownership

`TelemetrySampler` runs inside the physics worker. Every second 120 Hz tick captures a 203-channel sample; every eighth tick captures a complete numeric pose snapshot for every car. Rendering never supplies the capture clock. Six transferable telemetry buffers and six pose buffers provide bounded transport queues. Buffers are returned after the main thread copies their contents. A stalled consumer produces an explicit recording-gap warning; no interpolated or invented measurements fill the gap.

Telemetry uses a fifteen-minute typed-array ring. Export takes a chronological copy and transfers that copy to a separate formatting worker. Cancellation, worker errors and a thirty-second timeout reject the export. A late old-worker response cannot terminate or download a later session's export.

The current wire format is version 7: sixteen header floats, 224 floats per car, four 24-float wheel records beginning at offset 96, and four eight-float debris records beginning at offset 192. Header slots 14–15 retain world wind in m/s. Version 7 uses previously spare per-car slots 90–93 for cumulative wheel-specific marble pickup. The four CSV pickup columns are appended after all 199 existing columns; a frozen-header hash regression protects those earlier positions. Fields include real motor/regen power, suspension length, tire pressure/radius/puncture, graining/blistering, component health, jack height, penalties and sector state. The internal wheel sequence is **FR, FL, RR, RL**: +Z points toward the nose, +Y up, and +X toward the driver's left. CSV headers and the tire panel follow the actual hub positions.

## Replay paging

`SessionReplay` records numeric state at 15 Hz, not scene objects or GPU resources. Completed 300-frame pages are written to a private IndexedDB session cache. A maximum of four completed resident pages, the current page, and bounded write/read queues prevent memory growth proportional to race duration. Per-page timing metadata supports binary-search seeking. Unit tests retain and seek a 1,266-second recording, including its first frame, beyond the old twenty-minute rolling limit.

Spatial water/rubber/marble keyframes are recorded at the same simulation times as their original updates. Water is quantized to one micrometre in millimetre units; rubber and marbles to 16-bit normalized coverage. The surface tuple has three channels; old private-session pages are rejected by protocol version rather than misread. Playback chooses the recorded surface, while leaving the current live surface untouched and restoring it when replay closes. Weather is not reconstructed from the final session's wetness.

A seek into an evicted page displays buffering until the requested page is available. Async reads never write directly into the currently rendered frame. Invalid page versions, missing pages, storage quota failures and excessive write backlog surface explicitly. Storage failure stops further archival capture without pretending the whole race was saved. The cache is session-scoped and is cleaned when the session is replaced or disposed; it is not a user-facing permanent replay library. Browser shutdown can interrupt asynchronous cleanup.

## Simulation-to-presentation connections

Detached wing fragments now render from physical pool positions. Destroyed wings disappear from attached bodywork; a repaired front wing restores its lost component mass. Physical tire radius, suspension length and per-corner steering damage drive the rendered wheels. Hybrid audio consumes actual motor output instead of inferring it from battery changes. Tire scrub consumes the actual dissipated slip power.

Per-wheel tread uniforms consume dirt, wear, blistering and graining from the same live or replayed snapshots. Solid marble chips consume changes in actual cumulative pickup; repeated snapshots, rewinds and tire replacements cannot invent pickup bursts. The third surface texture channel consumes recorded local marble density. See [marble/surface integration](MARBLES_AND_SURFACE_STATE.md).

Both physics and CSV workers are bundled using Vite inline-worker imports. Production worker programs are created from same-document-origin blob URLs, so a CORS-enabled external asset host no longer becomes an illegal Worker constructor origin. This is not a main-thread simulation fallback. Hosts with a restrictive Content Security Policy must allow `blob:` in `worker-src`; scripts/styles still require their normal asset-origin permissions.

The desktop cockpit HUD moves beside the car instead of covering the physical steering display. Procedural cockpit and environment fidelity remain subjects for the final visual audit.

## Verification boundaries

Historical evidence from the first recording checkpoint: local lint, TypeScript, production build and 107 tests passed during that checkpoint. The three four-car weather scenarios and ten-car physical pit scenario passed; the pit report contains a small contact event, **not zero contact**. The current browser workflow additionally checks real IndexedDB page creation, 203 CSV columns and exact two-tick sample spacing, camera visibility, manual steering, replay/pause safety and the results screen. A browser pass must be read from the workflow for the exact published revision.

Later changes added explicit wheel calibration, individual graphics/accessibility controls, marshal rules, dynamics benchmarks and long-run AI evidence. See the coverage ledger and subsystem documents for their actual scope. Target-device profiling, the complete combined scenario and final engineering/player/audiovisual audits are not certified by this recording page. Historical reports without a matching source revision are not current acceptance certificates.
