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

## First runtime result: `57d5a475`

[GPU run 41359235723](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41359235723)
finished with 31 passed and one failed. The new Restart case expected
`reused-scene` but received `rebuilt-scene`, after 27.412 s, not a timeout.
Identical-focus assertions passed; the strict reset-image comparison was not
reached. All four isolated shards passed, all 380 common PNGs stayed identical,
and grid still verified 315 visible/nine occluded fixed samples and normal
buffer disposal. Retained artifact 13105011223 SHA-256:
`93265f66f31e7b93d33b1f985770868a4ef62d8f0ec22a70f0ed5061f2f52a38`.

Source investigation and a regression using the real controller/wrapper found
an integration error: RestartOwnership drains by invoking rebuild before clearing
its pending flag. The new grid validation used public completed/receipt checks,
whose current-owner predicate correctly rejects while restart is pending. It
therefore rejected the internal retained-scene handoff too. The correction must
separate a captured retained-resource proof from public readiness, not clear
pending early or relax the two-new-frame requirement. Tests must also use the
actual environment cohort's combined cancellation signal, not a raw-controller
lookalike that misses this ownership boundary.

[Native run 41359235735](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41359235735)
passed Windows/macOS and all four compatibility journeys: 36/36 and 23/23 draws,
449 preparations each. Actual grid receipts reported two parts, one material,
12 slots, 36 boxes, 432 triangles and dry-only scope; screenshots visibly show
those original grid markings. All platforms recorded component 2 / scene 2,
confirming full rebuild, not reuse.

Linux passed initial 6/6 with grid ready (28.500 s host readiness bracket), then
failed second readiness before model import with a GPU-health error. GPU exit 512
was logged about 7 ms before rejection, after a 29.594 s host gate bracket and
285 polls. The last poll, 26 ms before rejection, showed 10/9 frames, 253 completed
preparations and pending age 27.457 s. Epoch-2 frame 10 was paused at tick 30,
surface preparation, zero throttle and no wheel adapter. Rebuilt grid was not
yet installed. This differs from the preceding post-model Pause-click timeout;
no driver-cause or Linux-repair claim follows.

Verified artifacts: Windows 13105005582, macOS 13103734736, Linux 13104509374.
Fingerprint: `4c60660b09972a8e55d17aa261b3d2cdf6569e777553d9610e475d54ae8a8d17`.

## Retained-grid handoff correction

A proof is captured only when the grid is publicly complete and its actual
bindings are valid. During the drained restart handoff it revalidates the same
wrapper, scene, owned resources and captured combined cancellation signal without
mistaking the transient public pending gate for resource invalidity. Main still
requires the exact current component, scene, controller and healthy drained GPU.
The controller's pending flag is not cleared early. Public completed/receipt
checks stay closed while pending, and two new ready reset frames remain mandatory.

The regression now constructs actual EnvironmentPreparation, all four real
preparation wrappers/subscriptions, the real grid owner and production
RestartOwnership/main callbacks. Synthetic sibling resources are explicitly CPU
fixtures. It reproduces the original pending-gate failure and an intermediate
combined-signal identity error: the environment forwards AbortSignal.any, not the
raw asset controller's signal. The proof retains that actual combined signal;
main independently retains raw controller identity. Environment disposal with the
raw signal still alive must invalidate the proof. Changed scene/component,
missing proof, replaced/mutated grid, abort and repeated restart remain negatives.

The corrected exact workflow selection passed 878 tests across 58 files, with
93 focused checks, full types and canonical lint. These are overlapping selections,
not additive totals. Earlier test-fixture typing/lint failures are retained.
Runtime activation and unmasked reset-image equivalence still require a fresh
published-source GPU/native run; no Linux reliability result is implied.

Final frozen production build and discovery of all 32 browser cases also passed.
The ordinary large-chunk warning remains. Independent review verified the exact
four-file correction; no source changes occurred during the final check sequence.

## Corrected handoff result: `6f6812b5`

[GPU run 41362626902](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41362626902)
passed all 32 cases, all five shards and the aggregate with no flaky/skipped
cases. Restart actually retained scene epoch 2 while component advanced 2 → 3;
after driving to tick 54, two fresh reset receipts completed (11 → 13) at tick 0.
Canonical state matched, BODY/no-focus UI setup matched, and unmasked 1440×900
RGBA had zero changed pixels. Both image hashes were
`5e339c6c5c5b3bcac1d1d63e5cd9b247762d542650dee38f0956fcbfa296b11f`.
The separate early-pause viewport proof also had zero differences (tick 700 held,
then 730 resumed). Live grid receipts remained exact and all 380 isolated PNGs
were unchanged. Retained artifact 13106945048 SHA-256:
`cd7dc8877cbbcc81f0991cf3628fe8bc18da67357b48afb78dac89cca182bc9f`.
This is SwiftShader proof, not physical-device performance.

[Native run 41362626885](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41362626885)
passed the complete Babylon path on all three platforms: initial readiness,
restart, keyboard, model import, wheel movement, pause/freeze and screenshot.
All recorded component 2 / scene 1 reuse, 311 preparations and exact live-grid
counts. Linux reached 18/18 draws, Windows 50/50 and macOS 49/49. Linux retained
its two ready reset submissions 10/11 followed by 12/12 completion; the earliest
Mac/Windows pair was evicted, so their later retained receipts must not be
presented as a capture of that exact pair.

Windows/macOS passed all four compatibility journeys. Linux passed Formula, GP
and MX, then lost its GPU context in the retained Three.js Festival resume
segment after a paused receipt (tick 1516). Festival failed at 484.984 s; the
loss named retained `index.html`/Three renderer, not the already completed Babylon
path. The saved healthy Babylon snapshot is historical, not proof of health at
the later failure. Full Linux workflow remains failed; no driver-cause or general
reliability claim follows. The fully validated download baseline stays `468c4cdb`.

Verified native artifacts: Linux 13106138991, Windows 13105374602,
macOS 13106530819. Fingerprint:
`907ff36bfa24699fee21cd796356fa0fb0694bbdcb56be7910d0159c18123e9f`.
