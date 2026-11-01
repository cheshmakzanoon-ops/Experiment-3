# Original dry Formula grid startup integration

Base: `7f07ecef4d40e4e8d3e360564528356804b88a3b`. The shader, geometry and GPU oracle are unchanged. One bounded adapter cleanup
correction separates mesh disposal from its independently owned geometry disposal;
new fault injection exposed the prior coupled-disposal interruption.
It is not live-qualified until its actual browser and native journeys pass.

## Ownership and scope

The original 12 slots / 36 thin boxes / 432 triangles become the fourth explicit
member of `EnvironmentPreparation`. Surface preparation still finishes first.
Gantry, lamps, banner and grid prepare sequentially under exclusive GPU leases;
all four install and subscribe synchronously before the cohort draw gate opens.
Each eligible owner independently requires two fresh actual ready completions.
The stripe still prepares after the completed cohort. No grid-only frame pair,
shader preparation, upload fence or readiness check is skipped.

Live eligibility is canonical Aurel, circuit presentation, exclusively Formula
four-wheel vehicles, nonflat geometry and the clear preset. Ineligible owners
complete without allocating grid resources and report `ineligible`, never
`ready`. The separate grid material retains original linear color, roughness
0.55, CCW/front-side culling and the original dry circuit-paint finish. It is not
registered as edge paint or given edge grounding/light-pool plugins. Original
road occlusions, geometry and frozen source world matrices are unchanged.
Wet-weather, GP-grid switching, shadows and full PBR parity remain unqualified.

## Fail-closed readiness

The grid wrapper validates installed original identities, geometry, CPU buffer
contents and native buffer object identities, submesh metadata, frozen world
matrices, material/plugin identity, visibility, counts and scene registration.
These checks are CPU-side and do not poll or query GPU state. Shared BRDF data
is not a grid-owned texture. Staged disposal waits for the coordinator's active
compiler to drain before independently cleaning siblings; failures preserve the
original thrown value. Exact mesh registrations are detached without disposing
their geometry before mesh cleanup; the independent allocation ledger then
disposes only owned geometries. This avoids a geometry-disposer exception
interrupting mesh/base cleanup and does not acquire foreign replacements.

Grid completion joins startup/model/settled readiness. Paused publication and
retained-scene restart additionally validate the grid receipt; retained reuse
requires the same owner. Existing static fingerprints automatically include its
scene resources without relaxed guards. A reused scene still requires two fresh
restart presentation completions. Context loss, full rebuild and terminal stop
retain the existing cancellation and cleanup paths.

Default scalar receipts, bounded renderer/native observation schemas, strict
native Aurel validation and live browser/reset resource accounting include grid.
No new service API, raw tracing, driver flags, security changes, test budget or
30-second first-pause deadline change is part of this candidate.

## Validation boundary

CPU contracts, full types, canonical lint, production build and browser test
discovery are necessary but do not certify GPU/native execution or startup
headroom. The existing isolated grid GPU evidence is not live qualification.
No timing improvement is asserted. Runtime outcomes own acceptance; a timeout
must remain a failure rather than widening a budget or moving the early pause.

The checkpoint also carries the separately reviewed restart-image fixture repair:
both reference and reset use a real pointer click on the existing noninteractive
heading before capture, assert identical BODY focus/non-focus-visible state,
and retain the original unmasked zero-pixel-difference requirement. The prior
7f07 GPU failure was 746 pixels confined to the Resume focus ring, not evidence
of a grid rendering error. No CSS masking, tolerance or deadline change is made.

## Frozen local verification

The reviewed combined source passed 281 focused checks across nine files and the
exact workflow CPU selection of 859 tests across 58 files, full TypeScript,
canonical project ESLint, production Vite build and discovery of all 32 browser
cases. These are not additive test totals. The earlier five injected cleanup
failures, four source-layout assertion failures and two test-type errors remain
retained as intermediate evidence; final checks ran on the unchanged corrected
source. No GPU/native pass is inferred from local validation.
