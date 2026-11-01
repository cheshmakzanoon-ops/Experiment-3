# Original five start lamps · isolated migration candidate

Development belongs only to `babylon-js`; `main` remains the exact restored
pre-Babylon snapshot. The isolated adapter passed on `6aad563`; its live startup integration passed exact-source GPU and Windows/macOS checks
on `3a3e977`; Linux remains failed.
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

The first checkpoint was isolated; the later live integration below has its own
qualification gate. Neither checkpoint establishes final visual parity.
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


## Isolated GPU result on 6aad563

[Run 41309156739](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41309156739)
passed **21/21 GPU journeys** and **458/458 CI CPU contracts** for exact
`6aad5634b84d35ab66cd8d3a05ec6737389e317c`. Local 478 additionally includes
20 native-smoke receipt contracts. Artifact `13085147767`, 15,177,860 bytes,
SHA-256 `ccfab045ee108c169687e4b5d86bc10797871831b2c6e5428e37aa2907ef79c0`.

All 192 state/view/cycle receipts contain five actual GPU emission readings,
correct 0/25 intensities, original linear emission, zero GL errors, completed
frames and unchanged snapshots. State changes reused programs with zero runtime
shader compile/link calls. Effect-created notifications do increase when dirty
material state rebinds; those are not new shader compilations.

Native/standalone/loss/fresh-restart pixel arrays match. All 24 captures collapse
to six byte-identical view/state groups: dark, one lit and five lit from front
and grid views. Those images were inspected. A07 co-presence receipts preserve
its four structural parts through independent lamp cleanup. All cycles return
to baseline; cancellation and real context loss followed by a fresh-context
restart pass. This is SwiftShader evidence, not physical-GPU or final PBR,
exposure, bloom or shadow parity. Co-presence is established by resource/geometry
receipts; the saved lamp captures are isolated views.

[Native run 41309156858](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41309156858)
passed Windows (40/40 draws) and macOS (27/27) with all four compatibility
journeys. Linux presented the car and later lost its GPU process (exit 512;
22/23 draws, pending age 21.853 seconds). All 413 preparations completed and
all platforms verified the live gantry. Production fingerprint:
`30e0563ed72467e2b1645fb7a29e07284de2ef1d51a4fc3580c06a9905c04b93`.
The lamps are not live in that source, so these native runs do not qualify them.

## Live integration

`LampPreparation` follows surfaces and the structural gantry under the same
absolute startup deadline and GPU owner. It applies the latest existing
simulation snapshot before installation and each draw; practice remains dark.
Installation allows required frame receipts without claiming final readiness.
Scene-ready, settled presentation and optional car loading wait for all three
owners. Independent cleanup and diagnostic clearing cover restart, loss and
errors even when scene disposal throws.

Browser/native receipts now require actual bound five parts, five materials,
400 triangles and zero lit lamps in practice. An additional browser journey
holds the real gantry fetch, pauses through the UI before readiness, releases
loading, checks ready/settled state with an unchanged physics tick, then resumes.
It preserves actual DOM evidence in JSON and has one total 120-second budget.
The exact live-source execution and captured state evidence follow below.

The expanded GPU suite is split into two required parallel shards because the
preceding 21-case job used 18 of its 20 minutes. All prior cases remain, with
separate artifacts, unchanged case/shard deadlines and fail-fast disabled.
The original aggregate `verify` check requires every shard to succeed. This is
CI scheduling, not a relaxation of game readiness or performance acceptance.

Final local live checkpoint: 494 selected contracts across 45 files passed
(including 21 native-smoke contracts), alongside lint, TypeScript and production
build. The initial split exposed two existing workflow-selector assertions;
literal selectors were retained, those assertions left unchanged, and two new
contracts now enforce exact shard coverage and fail-closed aggregation. The
focused 25-contract workflow/probe rerun passed after the final lint-only regex
formatting correction. Discovery confirms 19 retained plus three lamp cases.
Exact live-source execution remains pending.


## Live qualification on 3a3e977

[GPU run 41311886785](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41311886785)
passed both required shards and the aggregate `verify` gate for exact
`3a3e977b2254fe5b4ba825e4a7f21e86aa0cde5f`: **19 retained + 3 lamp = 22 GPU
journeys**. Each shard passed the same 473 CPU contracts; these are not 946
distinct tests. Artifacts:

- Retained `13086432076`, 15,118,994 bytes; SHA-256
  `b2038ff6b40051b107891c996b88ec221fe5c8caaa52bfe5ab014674229d5adb`.
- Lamps `13085453951`, 264,989 bytes; SHA-256
  `9513ffb499920481a5d84cebd3f8ca6b4d9009dfbbd0a7c8dea887a4fec8a31b`.

The early-paused startup case completed in 14.1 seconds. Its actual DOM receipt
records held-fetch readiness false and physics tick 700; after release, tick
700 remains unchanged while both gantry and lamps are ready and presentation is
settled at ten completed frames. Resume advances the observed tick to 745.
The practice lamps report five parts/materials, 400 triangles and zero lit.
Original-car import, driving input, resize, restart and context recovery checks
also pass. The separate lamp group re-establishes all 192 state receipts and
independent cleanup; its per-cycle baseline deliberately retains the separately
owned structure until that structure's own cleanup.

[Native run 41311886765](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41311886765)
is terminal:

- Windows passed all four installed compatibility journeys, 45/45 Babylon draws.
- Apple Silicon macOS passed all four journeys, 34/34 draws.
- Linux reached valid gantry/lamp readiness and car presentation at 80.260s,
  then failed a 15-second wait at 100.319s, followed by GPU exit 512/context loss.
  It completed 435 preparations and 26/27 draws; pending age was 20.152s.
  Cause remains unresolved; the platform remains failed.

All three native reports contain lamps ready/5 parts/5 materials/400 triangles/
0 lit and the original gantry ready/4 parts/1 material/3 textures/9,520 triangles.
Their shared production fingerprint is
`84e3f4bde198d91e9497b2cba61c0617bd029df103a2056388b963f036f698c7`.
Windows/macOS screenshots were inspected and show the original car, gantry and
dark lamp row. This completes the bounded lamp integration milestone, not an
all-platform release, physical-GPU certification or full PBR/environment parity.
Banner, shadow, bloom and exposure work remain separate.
