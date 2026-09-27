# Current-view detail and bounded pit-service updates

Baseline: `2426da62b8480ef81bf9d67557e66d2cca1043ed`.
Publication parent: `e9700a7f2201a6d51404f9e3a26578fa1427950b`.
Runtime/source fingerprint: `b11646fe37848e72ba0e786e62842599ba9306b00a6f4d2203af4ea28ecab12c`.

This is a scoped implementation of the full-race integration/performance pass,
not complete Phase 27, all-reference visual parity, physical-hardware approval
or human Section 146 acceptance. Exact-commit hosted CI and public deployment
remain separate gates at source publication.

## Findings and implementation

**Camera-cut detail.** The renderer selected opponent detail using the previous
camera and the newest un-interpolated snapshot, before computing the actual view.
It now poses the always-near followed car, computes the unchanged camera, then
selects and poses each opponent exactly once using its presented position and the
current lens. Detail selection precedes posing: reduced cars only update their
active wheel/suspension representation. Camera paths and simulation are unchanged.

**Long-lens cars and spectators.** A narrow field of view or portrait aspect now
uses the same optical-distance rule already established for pit personnel. Wide
views retain existing distance thresholds and hysteresis. Crowd handoff ranks,
seat transforms, original meshes, physical reaction distances and weather state
are preserved. Zoom cannot invent cheering from distant traffic. Narrow lenses
can deliberately submit more existing geometry; this is a visual-continuity fix,
not a claim that every camera now renders faster.

**Pit update allocation.** A per-view pool retains the 180 possible actor witnesses,
with reusable vectors, quaternions and matrices for hands and equipment. Machinery
copies its sixteen float32 values directly instead of allocating a temporary
subarray for each tool. Diagnostic snapshots remain detached and expose only
active actors. Bone palettes, contacts, poses, equipment ownership, actor counts,
service clocks, visibility limits and material batches are unchanged.

**First-service shader preparation.** Both cloth instance-colour attributes now
exist during construction, initialized to the same white values as Three's lazy
`setColorAt`. This lets the existing loading-time `compileAsync` compile the actual
instancing-colour variant instead of changing that variant at the first stop.
The two buffers total 4,320 bytes, allocated earlier rather than on first use.
No crew is made visible during loading and no fabricated service state is fed to
race observations. Geometry, shader equations and pit timing remain unchanged.

The original run `36312770456`, browser job `108602355575`, really failed the
populated daytime pit review. Its trace presented removal at clock 1.175 with
jack height 0.0587, then installation at 2.2917 with jack height 0.19. It did not
present the qualifying raised removal frame. The proof correctly remained open;
its jack-height, phase ordering and actor requirements are not weakened. The
cold shader variant is a concrete first-use issue, but closing that exact race
sequence still requires fresh ordinary-application browser evidence.

The earlier `e9700a7` correction changes only the obsolete cockpit selector test
position from -0.056 to the intentional -0.061 metres, preserving six-decimal
precision. Its browser partition passed; this does not certify another revision.

## Measured component cost

See [raw timings, sampled allocations and state hashes](RACE_VIEW_COST.json).
The independent baseline bundle was made from the exact baseline before editing.
The script compares 1/8/12 concurrent crews (15/120/180 actors), 620 snapshots per
run, two warmup cycles and eight alternating-order timing runs. Allocation sampling
is separate, uses a 4,096-byte interval, and includes collected objects. It is a
statistical estimate, not exact heap accounting, resident memory or GPU VRAM.

| Crews | Baseline CPU ms/update | Candidate CPU ms/update | Baseline / candidate sampled allocated bytes/update |
|---|---:|---:|---:|
| 1 | 0.2574 | 0.2432 | 72,816 / 50,751 |
| 8 | 1.9941 | 1.9184 | 587,481 / 397,445 |
| 12 | 3.0462 | 2.9305 | 874,654 / 600,471 |

All 23 compared states per crew count retain identical complete instance arrays,
colour arrays, slot arrays, bone palettes and detached pose diagnostics. Both
baseline and candidate cloth levels are warmed before byte comparison because
the candidate intentionally changes allocation time. Cold shader behaviour has
its own test. Snapshots remain unmodified. These CPU results are not full-game
FPS, first-stop latency or representative consumer-hardware measurements.

## Regression coverage and acceptance boundary

The locked local check passes ESLint, 1,185 tests in 116 files, strict TypeScript
and production build. Seven new unit cases cover current-camera/interpolation
ordering, optical detail, immutable crowd storage/reactions, bounded witnesses
and preallocated colour ownership. Running the camera-order tests against the
original renderer produces the two intended failures; candidate tests pass.

`e2e/34-race-view-continuity.spec.ts` adds two real-GPU checks. The first uses the
actual asset-loading factory and full renderer for first-frame follow changes,
held/rewound active wheel poses, a long lens and warmed resource counts. The
second compares loading-time shader counts against an explicit original-style
lazy-colour negative control. Controlled poses are clearly labelled, not human
race footage. Existing full-lap, wet-following and populated-pit suites remain.
Local Chromium cannot create WebGL2, so these GPU assertions are not claimed as
locally executed passes. Hosted results must name their exact source commit.

Native physics, integrated driving, rotation, physical pit service, classification
and populated-race checks are retained and executed separately. The unchanged
simulation fingerprint is `0dfddbb3fd97a279d2c9875bb9d03af86c583f17fbb75641176b428d469afe3c`.
Historical numerical reports are not overwritten with this run's evidence.

A read-only matrix regeneration for the source fingerprint above retains 148
directive sections and 100 reference entries: required 0 PASS / 230 PARTIAL /
2 FAIL, plus 16 excluded references. No acceptance receipts were invented. The
older committed matrix remains its historical snapshot, not a fresh --check pass.

Simulation, input, audio, workers, storage/replay, authored Blender/GLB assets,
dependency lock, original directive, CI workloads and all acceptance thresholds
are unchanged. Deploy only a successful exact-source release artifact; do not
substitute the historical tracked playable directory. Uninterrupted human driving,
handling/audio assessment, controller/wheel testing, target-PC frame times and
full-lap artistic review remain independent requirements.
