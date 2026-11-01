# Original five start lamps · isolated migration candidate

Development belongs only to `babylon-js`; `main` remains the exact restored
pre-Babylon snapshot. This adapter is **not imported by the live entry**.
The original A07 structural gantry remains independently owned and qualified
as recorded in [its evidence](babylon-start-gantry-2026-11-01.md).

## Preserved original contract

The source is the five-lamp construction and snapshot update in
`src/rendering/circuit.ts`, not newly designed artwork:

- Five `CylinderGeometry(0.16, 0.16, 0.08, 20)` meshes, each 124 vertices,
  240 indices and 80 triangles; 400 triangles total.
- Original local positions `((i - 2) * 0.45, 4.95, -0.3)` and X rotation π/2,
  beneath the original track-station-zero position/yaw.
- Five original independent materials: linearized Three base colour `0x1a0e0c`,
  emission `0xff210c`, roughness 1, metallic 0 and front-sided rendering.
- Intensity is exactly `i < snapshot[H.LIGHTS] ? 25 : 0`. No new timer, race
  state, countdown, audio, point light or simulation write is introduced.
- Exact original vertex/normal/UV/index data and Float32 original world matrices
  are retained. Original source/asset/physics files are unchanged.

The existing live Babylon workbench is a practice session. Its authoritative
snapshot keeps lamps dark; this migration must not change session mode merely
to display an illuminated countdown. Real race snapshots supply isolated test
states, including held frames, rewind, lights-out and reset.

## Ownership and rendering boundary

`src/engine/babylon/start-lamps.ts` stages its separate resources off-scene,
performs geometry upload through the existing GPU preparation owner, prepares
both emission endpoints under one caller deadline and restores dark state before
returning. Installation requires completed presentation receipts. Cancellation,
stale ownership and partial construction drain independent resources; disposing
lamps does not transfer ownership of the gantry container or global lights.

Snapshot application skips unchanged values. Babylon's intensity setter may
mark material state dirty, so CPU tests alone do not establish shader/program
reuse. The isolated GPU fixture must demonstrate actual binding, emission pixels,
program stability, completed frames, cleanup and context-loss/fresh-context
recovery in both uniform transports. Partial receipts are preserved before
assertions. No local mock or test discovery is real-GPU acceptance.

The CPU oracle executes uniquely bounded construction snippets from the pinned,
unchanged original circuit source using its original mesh/placement helpers and
snapshot updater. This avoids testing only against duplicated candidate constants.

## Explicit limits

This is an isolated candidate, not live lamp activation or final visual parity.
Banner printing/back-face treatment is a separate port. Shadows, HDR bloom,
exposure and complete environment/PBR parity remain open. Original lamps are
emissive surfaces, not lights that illuminate surrounding geometry. No new
lighting is added to compensate for the unported bloom pipeline.

Exact GPU/native qualification results will be appended after execution. The
existing Linux post-model GPU loss remains unresolved; no all-platform release
or physical-hardware certification is claimed.

## Local checkpoint before first GPU run

All 478 selected contracts passed across 44 files (including 20 native-smoke
receipt tests), with full lint, TypeScript and production build. The three new
lamp cases expand the existing 18-case GPU suite to 21 cases. Fixture bundling,
formatting and discovery passed; no local browser was run.

The GPU fixture records actual per-material UBO values or per-lamp post-draw
standalone uniforms, real emission pixels, effect/program/cache identity and
compile/link counts. A co-presence cycle retains the original A07 structure
through lamp cancellation and disposal, then independently cleans that owner.
These are implemented acceptance gates, not results until the real run completes.
