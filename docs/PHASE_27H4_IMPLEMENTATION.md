# Phase 27H.4 — Aurel environment construction and integration

Baseline: `e8b15af44c3a6d2bd10419001e79801968dca3c3`.
Scope: retained Pasted markdown(10), 27H.4; MASTER_DIRECTIVE sections
122, 128–130. This is an implemented environment checkpoint, **not full-lap
art acceptance, F1 visual parity, or a Steam release**.

## What changed in the normal runtime

The four existing districts keep their original placement planner and protected
footprints. `venue-architecture.ts` replaces their earlier construction with
four distinct, metre-authored structures:

* Orchard / Motor Club: a continuous folded standing-seam roof, closed gable
  infills, masonry foundations/returns, recessed glazing, facade fins, columns,
  knee braces, post shoes, gutters and individual bench slats.
* Quarry / Terrace: split seating tiers surrounding a real central stair,
  independently supported railings, benches, masts, footings, tie cables and a
  doubly curved tensile canopy. Stair openings are not filled by tier blocks.
* North / Works: two sawtooth-roof workshops with closed side infills,
  clerestories, profiled roller doors, one raised opening, a recessed work area,
  window/door returns and loading-yard drainage details.
* South / Concourse: three open-counter kiosks, deep supported canopies,
  sloping clerestory ribbons, counters, shelves and supported picnic tables.

`venue-plaza.ts` replaces the abrupt district base slabs with indexed patches
whose level interiors grade back to the sampled terrain over a three-metre
perimeter. Small wayfinding boards occupy side pockets instead of crossing the
central pedestrian approaches. The race track, grass apron, collision geometry,
existing service roads, circuit layout and access gates are unchanged.

`track-infrastructure.ts` retains all **56 physical drainage stations**, but gives
rendered grates actual open slots and recessed beds. Each vertex follows the
same local camber/grade ground query; the change does not alter tyre contact or
water drainage. Utility cabinets and marshal shelters gain construction detail.
Existing grandstands, paddock garages and service areas receive shared,
metre-scaled stone, timber and metal finishes without replacement people,
extra vehicles, extra texture downloads or extra live lights.

The retained event-hall candidate from `.github/phase27h-landmark.br` is now
integrated through `VenueLighting`, broadcast bounds and vegetation exclusions.
Its original staging SHA-256 was verified before selectively applying the
runtime and test files. Existing workflow/staging bytes remain unchanged; old
candidate documentation and acceptance claims were not imported. The shell
meets a load-bearing drum and sampled-ground foundation, with instanced columns
and a bounded, reversible emissive response.

Regional-weather material installation now runs **after** the static construction
and batching tasks. The former priority visited the scene before district and
other late-created materials existed. The new finish chains with the regional
fog hook; it introduces no separate animation clock or simulation writes.

`environmentAssets` diagnostics identify the four constructed runtime groups.
`e2e/26-aurel-environment.spec.ts` exercises ordinary menu/start/pause integration
and retains its explicit startup-only evidence boundary. Diagnostics and this
test do not approve the whole lap aesthetically.

## Authoring and preservation

This increment uses purpose-built Three.js geometry and the retained event-hall
candidate. It does **not** claim newly authored Blender exports. All retained
car, driver and people `.blend`/GLB assets remain unchanged. No engine migration,
new dependency, physics change, additional map/mode, or unrelated game is included.

A baseline-object comparison checked 102 protected files, covering simulation,
inputs, storage/replay, workers, audio, car/driver/people assets, original Blender
sources, dependency files, directive, test configuration and GitHub workflows.
Every checked file was identical. Static material batches retain bounds,
triangle counts, shadow flags and spatial culling.

## Executed validation

Final-source lint, strict TypeScript, production build, **998 unit tests in 100
files**, and exact matrix regeneration/check passed. The new 28 environment and
landmark cases cover geometry/index/normal validity, deterministic construction,
protected envelopes, post-batching preservation and budgets, stair/rail support,
terrain-conforming plaza edges, drain station/contact alignment, actual open
slots, shader identities and chained regional fog.

All eight existing numerical scripts passed during implementation: validation,
dynamics, marshals, wet pits, integrated driving, rotation, pit integration and
race classification. Their raw observations and original recorded source hashes
are preserved in the separate delivery evidence; the committed historical
numeric reports are not relabelled as graphics acceptance. The simulation files
used by those runs are unchanged in this candidate.

Fifteen actual Three.js-generated standard-material shader variants compiled and
linked in native Mesa: the four venue finishes and landmark display, each under
standard, lit/shadow, and regional-fog configurations. This establishes native
shader compilation, **not a managed-browser graphics pass**.

Native component views of all four old/new district constructors were compared.
They use the actual geometry, colors and finish functions with separate
inspection lighting. They omit normal-application cameras, texture signage,
full-scene weather and the production post-processing stack. They are clearly
labelled **NOT normal-game captures** and do not replace full-lap footage.

The CPU scene-graph comparison adds 78 mesh nodes, 77,152 triangles and
7,132,360 bytes of geometry buffers. The count includes inactive LOD nodes and
is not a GPU submission or frame-rate measurement. A 32-position conservative
frustum survey and per-district budgets are in `PHASE_27H4_VALIDATION.json`.
No new texture-pass or live-light budget is claimed or introduced.

## Reproduction

Use the existing dependency lock and Node 22. No dependency upgrade is required.

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/phase27h-matrix.ts --check
npm run test:e2e
```

The local complete unit run used `vitest run --maxWorkers=2`; no assertions,
timeouts, test files or CI gates were weakened. The normal GitHub workflow is
unchanged and retains every browser case.

## Open gates

The attempted normal-startup browser test failed before application navigation
with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser-policy bypass was used. Current
source hosted CI, ordinary full-lap and pit-approach video, wet/low-sun/night
presentation inspection, reference discrepancy review, and representative
hardware frame-time/VRAM measurements remain open.

The 248-row matrix retains 0 PASS / 230 PARTIAL / 2 FAIL required rows and 16
excluded references. That is an acceptance ledger, not an implementation
percentage. `finalArtApproved` remains false. 27H.5–27H.6, the later racing/game
feel/robustness phases, final audits and Steam acceptance are not closed here.
