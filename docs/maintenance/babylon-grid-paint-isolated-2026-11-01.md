# Isolated original Formula grid paint slice · 2026-11-01

Originally developed against `f0ca199`, then combined and checked atop the
`6c0cc646` diagnostic source. This branch-only isolated owner is not imported into
live startup. A fifth required GPU shard qualifies it separately; existing four
shards, their deadlines and the fail-closed aggregate remain unchanged. No main,
driver, security, physics or quality-budget change.

## Source boundary

`src/engine/babylon/grid-paint.ts` adapts the unchanged original
`GridPaintPresentation` in Formula mode, canonical Aurel only. Its 12 slots,
36 thin boxes and 432 triangles are not replaced by GP conformed quads.
The original layer's spatial batches, indices, positions, normals, UVs and
world matrices are copied without another parent batching pass; the original
CircuitScene excludes this grid root from that parent pass.

A separate PBR material takes the original Three material's linear color,
roughness .55 and metalness, FrontSide/CCW orientation, and the existing original
dry `CircuitPaintFinishPlugin`. It does not borrow decorated edge material or
relax `importLegacyMesh` guards. No canvas, external model or texture is added.

The original global WeatherPresentation decorates this paint material. This
slice is explicitly **dry-only**: wet response, GP switching, other venues,
shadow/lighting parity, car grounding and light pools are not qualified here.
Original shadow flags are established in the reference, not presented as a
Babylon shadow-system implementation.

## Ownership

One exclusive GPU lease constructs and stages material/meshes/geometries
outside scene collections. The existing preparation routine compiles every
actual mesh/material variant under its existing exclusive leases and deadline.
User cancellation cannot dispose a compiler's resources before it drains.
Installation synchronously registers all batches, then the unchanged
waitForPresentation requires two fresh ready GPU completion receipts; CPU
render events do not qualify. Loss/nonready receipts reset that pair.
Cancellation, stale ownership, partial failure and final disposal remove only
owned resources; the pre-existing scene-shared BRDF remains owned by the scene.

## Independent CPU oracle and pending runtime gate

`tests/babylon-grid-paint.test.ts` executes the already-frozen original builder
from `tests/gp-grid-paint.test.ts`, independent of the adapter's helper. Material
construction comes from the actual original CircuitScene grid method. Tests
compare every index/position/normal/UV and matrix, visibility/facing, original
paint algebra, lease coverage, readiness, cleanup and resource baselines.
The existing original tests remain unchanged.

NullEngine contracts and synthetic completion delivery are not real rendering,
fence timing, shader compilation, visual parity or a native startup claim.
Before activation, an independent original-Three GPU reference must qualify the
dry finish and actual source-derived road depth/visibility; do not require all
marks visible where the authored boxes intersect the original road. Current
combined-source GPU/native qualification takes priority over this held work.

## Held GPU qualification fixture (not executed locally)

`e2e/babylon-grid-paint.spec.ts` discovers default browser UBO, forced-standalone and
context-loss/restart cases with unchanged browser settings and budgets. The existing 1024×384 target and shared 120-second case/restart deadline
remain. All rendering, compilation and readback retain exclusive preparation
and completed-frame gates. No local GPU launch or runtime qualification is
claimed by discovery, types or bundle checks.

The Three reference uses actual `GridPaintPresentation` and its original dry
finish hook. This is a shared original producer, not an independent browser
geometry implementation: the pre-existing frozen builder independently checks
all source buffers and matrices. Fixed top, oblique and closed-box underside
views compare linear albedo/view normals with max 2 codes, mean .25, at most
8 whole-frame coverage mismatches and no missing interior/partial alpha.
Every spatial batch must actually draw with CCW/BACK/LEQUAL state.

Depth uses actual full-road `queueRibbon` chunk boundaries, not an arbitrary
subset that changes tessellation phase. The bounded native subset must match
these original chunks' indices/positions exactly. Before any GPU comparison,
source-only CPU rays preregistered row 0 and row 4: all 324 fixed pixels are
retained, 315 visible and 9 occluded, with no missing rays or near-tie masking.
Minimum original gaps are approximately .555 mm and .154 mm respectively.
The original Three composite and road-only witnesses must repeat exactly;
visible native pixels compare to original paint factors, occluded native pixels
to the actual native road-only witness. Original-road magenta is diagnostic
reference output only, not a replacement production shader.

Initial arbitrary-subset counts and the rejected near-tied row are preserved
in external evidence, followed by the full-original-chunk survey. Samples were
selected using original geometry only, before any candidate GPU output. CPU
negative controls raise/lower the reference road and must flip the classes.
Cancellation, repeated ownership, context loss and a fresh restart check resource
and independent-owner restoration. No live integration, wet/GP/shadow or final
lighting fidelity follows from this held fixture.

## Combined local verification

The frozen combined checkpoint passed the exact workflow CPU selection of
775 tests across 56 files, full TypeScript, canonical project ESLint, production
Vite build and discovery of 31 GPU cases. Earlier repaired-owner verification
passed 1,339 tests/99 files; that older run does not cover the new fixture. The
new isolated fixture separately passed 66 focused tests/three files and bundling.
Independent review checked constructor-failure cleanup, partial evidence retention,
falsy failures and actual buffer-disposal witnesses. Real GPU output remains
unqualified until this exact checkpoint executes successfully.
