# Physics-clock recording and full-session replay

This checkpoint extends directive sections 53, 67, 80–82, 99, 133–135 and 139. It is not a declaration that the entire master directive is complete.

## Capture and ownership

`TelemetrySampler` runs inside the physics worker. Every second 120 Hz tick captures a 228-channel sample; every eighth tick captures a complete numeric pose snapshot for every car. Rendering never supplies the capture clock. Six one-second transferable pages per stream provide the ordinary transport reserve. If the main thread is temporarily unable to recycle pages, each stream grows on demand to a bounded 30-page reserve; surplus pages are released after recovery so the steady-state pool returns to six. A consumer unavailable beyond that bound still produces an explicit recording-gap warning; no interpolated or invented measurements fill the gap. See [the full-race continuity milestone](FULL_RACE_CONTINUITY_MILESTONE.md).

Telemetry uses a fifteen-minute typed-array ring. Export takes a chronological copy and transfers that copy to a separate formatting worker. Cancellation, worker errors and a thirty-second timeout reject the export. A late old-worker response cannot terminate or download a later session's export.

The current wire format is version 10: sixteen header floats, 249 floats per car, four 26-float wheel records beginning at offset 96, and four eight-float debris records beginning at offset 200. Seventeen skid-contact values follow at offset 232; all earlier per-car offsets remain unchanged. Header slots 14–15 retain world wind in m/s. Version 7 uses previously spare per-car slots 90–93 for cumulative wheel-specific marble pickup. The four CSV pickup columns are appended after all 199 existing columns; version 8 appends eight actual wheel steering/camber columns after those 203, and version 9 appends 17 skid-contact fields after all 211. Version 10 reuses previously reserved per-car slots 94–95 for completed-lap validity and AI-assistance evidence without changing frame size or the existing 228 CSV columns. A frozen-header hash regression protects those earlier positions. Fields include real motor/regen power, suspension length, tire pressure/radius/puncture, graining/blistering, component health, jack height, penalties and sector state. The internal wheel sequence is **FR, FL, RR, RL**: +Z points toward the nose, +Y up, and +X toward the driver's left. CSV headers and the tire panel follow the actual hub positions.

## Replay paging

`SessionReplay` records numeric state at 15 Hz, not scene objects or GPU resources. Completed 300-frame pages are written to a private IndexedDB session cache. A maximum of four completed resident pages, the current page, and bounded write/read queues prevent memory growth proportional to race duration. Per-page timing metadata supports binary-search seeking. Unit tests retain and seek a 1,266-second recording, including its first frame, beyond the old twenty-minute rolling limit.

Spatial water/rubber/marble keyframes are recorded at the same simulation times as their original updates. Water is quantized to one micrometre in millimetre units; rubber and marbles to 16-bit normalized coverage. The surface tuple has three channels; old private-session pages are rejected by protocol version rather than misread. Playback chooses the recorded surface, while leaving the current live surface untouched and restoring it when replay closes. Weather is not reconstructed from the final session's wetness.

A seek into an evicted page displays buffering until the requested page is available. Async reads never write directly into the currently rendered frame. Invalid page versions, changed frame/surface bytes, incompatible dimensions, missing pages, storage quota failures and excessive write backlog surface explicitly. Storage failure stops further archival capture without pretending the whole race was saved. The cache is session-scoped and is cleaned when the session is replaced or disposed; it is not a user-facing permanent replay library. Browser shutdown can interrupt asynchronous cleanup.

## Simulation-to-presentation connections

Detached wing fragments now render from physical pool positions. Destroyed wings disappear from attached bodywork; a repaired front wing restores its lost component mass. Physical tire radius, suspension length and per-corner steering damage drive the rendered wheels. Hybrid audio consumes actual motor output instead of inferring it from battery changes. Tire scrub consumes the actual dissipated slip power.

Per-wheel tread uniforms consume dirt, wear, blistering and graining from the same live or replayed snapshots. Solid marble chips consume changes in actual cumulative pickup; repeated snapshots, rewinds and tire replacements cannot invent pickup bursts. The third surface texture channel consumes recorded local marble density. See [marble/surface integration](MARBLES_AND_SURFACE_STATE.md).

Both physics and CSV workers are bundled using Vite inline-worker imports. Production worker programs are created from same-document-origin blob URLs, so a CORS-enabled external asset host no longer becomes an illegal Worker constructor origin. This is not a main-thread simulation fallback. Hosts with a restrictive Content Security Policy must allow `blob:` in `worker-src`; scripts/styles still require their normal asset-origin permissions.

The desktop cockpit HUD moves beside the car instead of covering the physical steering display. Procedural cockpit and environment fidelity remain subjects for the final visual audit.

## Verification boundaries

Historical evidence from the first recording checkpoint: local lint, TypeScript, production build and 107 tests passed during that checkpoint. The three four-car weather scenarios and ten-car physical pit scenario passed; the pit report contains a small contact event, **not zero contact**. The current browser workflow additionally checks real IndexedDB page creation, 228 CSV columns and exact two-tick sample spacing, camera visibility, manual steering, replay/pause safety and the results screen. A browser pass must be read from the workflow for the exact published revision.

Later changes added explicit wheel calibration, individual graphics/accessibility controls, marshal rules, dynamics benchmarks and long-run AI evidence. See the coverage ledger and subsystem documents for their actual scope. Target-device profiling, the complete combined scenario and final engineering/player/audiovisual audits are not certified by this recording page. Historical reports without a matching source revision are not current acceptance certificates.

## Simulation-time effects and camera audio

The replay/audio continuation removes the renderer's replay-only particle
suppression. A separate reusable interpolated presentation frame drives effects
and camera-relative audio without altering archived measurements. Particle aging
and births follow recorded simulation time, freeze on pause, and reset on seeks.
Live-only engineering contact/AI probe records are explicitly not substituted
into replay history. See [the lifecycle and validation contract](REPLAY_AUDIO_AND_ENGINEERING.md).

## Continuation from a2195f9: replay integrity and exclusive playback ownership

The source archive was recovered from successful GitHub run `35432049517`; its
Git tree matched `365c1e1d56ffd321cb5bdbbbb08e3ed4697dbe46` exactly. The original
59,242-byte directive remains byte-identical. This continuation addresses sections
80–82, 117, 119–120 and 139 without changing simulation/core physics or wire version 8.

Capture rejects wrong car counts, non-finite/negative/regressing times and invalid
car orientation quaternions. A session has one fixed spatial grid shape. Sealed
pages retain independent in-memory witnesses of captured pose words and surface
keyframe times, lengths and quantized data. Reloaded pages are checked against
those witnesses before either output frame is touched. These lightweight hashes
are accidental-corruption checks, **not cryptographic authentication or permission
to import untrusted replays**. Pose hashing is incremental during capture; surface
hashes are computed once and retained weakly. Page sealing does not scan megabytes
of history. Evicted-page validation yields between bounded frame/surface work
units after roughly four milliseconds, checks disposal after yielding, and keeps
the existing two-read/four-resident-page limits.

A new page carries the last surface valid at its left boundary plus any later
keyframes already delivered ahead of the batched poses. Cross-page interpolation
also considers the next page's eligible surface. Rewinding before the first
surface clears the decoded state instead of retaining future rain/rubber/marbles.
No interpolation modifies the captured numeric samples or CSV measurements.

A seek draws its requested position once before advancing, including after an
asynchronous read. Replay HUD values now use the same interpolated presentation
frame as the rendered car, rather than the next recorded frame. Telemetry pauses
replay and mutes audio; returning requires explicit Play. Native dialog Escape
cannot also resume the live worker or leave replay. Gamepad action polling is
inactive behind dialogs. Focus loss pauses replay without auto-resuming on focus
return, and replay exit silences audio immediately. Read-only diagnostics expose
playback ownership and selected surface time to the browser assertions.

Twenty-two new unit regressions cover corruption, page seams, forward weather
delivery, rewinding, invalid capture, out-of-order reads, disposal and dialog key
ownership. Nineteen fail against the recovered pre-change code; the other three
protect already-correct behavior. The full suite now contains 460 unit tests.
The new real-application browser case records an actual wet session and checks
exact first-frame seeking, modal/keyboard isolation, frozen poses, audio state,
focus interruption, and unchanged live simulation. It joins the existing full
Chromium suite; it does not replace any previous assertion or use a fake worker.
Local application navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`, so that
full-application gate must be read from the GitHub run for the published revision.
A local CPU-only seal probe is not representative-hardware or GPU certification.

The complete combined manual section-146 scenario and final independent handling,
audiovisual and hardware-performance acceptance remain open. This is not a claim
that adding tests has satisfied every qualitative requirement in the directive.

## Protocol-9 contact work

Both replay paths retain actual floor support/load, sliding and damping power,
hard-contact position/normal/velocity, and cumulative work. Presentation uses
recorded work changes for sparks, never the current live chassis. See
[road contact and skid recording](ROAD_CONTACT_AND_SKIDS.md) for the unchanged
CSV prefix, lifecycle guards and controlled browser experiment. Earlier version-8
continuation evidence above remains historical rather than a version-9 test pass.
