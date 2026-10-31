# Circuit ribbon data extraction — first boundary only

## Scope

The existing Three `CircuitScene.ribbon` now delegates its unrounded construction
arrays to `src/engine/assets/circuit-ribbon-data.ts`. This is a geometry/data
boundary, **not a visible Babylon circuit upgrade**. Babylon's current diagnostic
road, its +0.010 m datum, and all Babylon rendering remain unchanged.

The Three owner still creates BufferGeometry/Float32BufferAttribute/index buffers,
computes normals with the same Three `computeVertexNormals`, applies the original
material, schedules construction, splits spans at the same <=80 m boundaries,
and records the same narrow-strip width/centreline metadata. There are no physics,
LOD, detail, texture, lighting, shader-hook, surface-height or material changes.

The shared module imports only `core/math.ts` and `simulation/track.ts`. The
latter is the existing renderer-independent track/query owner. Presentation
semantics are explicit callbacks: racing-line/brake fields, kerb/runoff styles,
usage, GP paint/gravel, and colour. Their existing implementations stay in the
Three owner, including the current Three colour-management conversion. Returning
the existing colour object avoids introducing an additional per-vertex colour
array. No shader/rendering module is imported by the shared component.

## Independent pre-edit evidence

Before changing `src/rendering/circuit.ts`, the capture compared its entire bytes
with `git show a937cacf028ae81e3bd6c6fa3d4634f2295e4886:src/rendering/circuit.ts`,
then executed that actual unmodified Three method. It did not call the extracted
component, which did not yet exist. Official Node **22.23.4**, Three **180**.

- Original source SHA-256: `f7eb51d30f26a38bee10dee2bcf4ef3e18b69d67314aa33f52c536088380c920`
- Representative case-definition SHA-256: `9bdb11c8f959fbc436885717436590288e2cc4cacf8b372b1de2f242e688fe03`
- `tests/fixtures/circuit-ribbon-a937.json.gz`: **218,400 bytes**, SHA-256 `c1f565980982ee6264b82ac4e43c98ee965f0734ad4512d85db082c4f2bd566b`
- 13 representative cases, 24 generated meshes: straight/banked asphalt,
  Vellamar variable width, lap seam, both directions of main and pit edge paint,
  both kerbs, bank-clamp/negative-lateral/custom attributes/omitted triangles,
  GP combined kerb/runoff fields, and non-GP default-step runoff.
- Every generated attribute is stored, including normals, indices and custom
  fields; metadata includes typed-array identity, item size, normalization,
  material-independent mesh flags, draw range, groups and strip diagnostics.
- The additional synthetic Uint32-index stress case retains every buffer's type,
  length and SHA-256 in `tests/fixtures/circuit-ribbon-uint32-a937.json` (file hash
  `b567c355178ab8559b5ba7f83dfe3b3daf7a1124909005eaa14aabbc7c2a61ce`). Full stress
  bytes are retained as development evidence (initial 14-case capture,
  2,690,245 bytes, SHA-256
  `b14e515244311b9ff2f6713783a40374147f02b8b485df4731d2b42e3fa51285`).

The original capture program is archived unchanged as
`circuit-ribbon-a937-capture.test.ts.txt`. It is intentionally outside test
execution: normal tests must never regenerate expected data from candidate code.
To reproduce the representative capture, use untouched a937 source and the pinned
case-definition file, copy that archive into
`tests/circuit-ribbon-capture.baseline.test.ts`, and run it with the installed
Vitest and Node22. Its explicit source-byte check rejects candidate source. To
reproduce the stress case too, append the unchanged `uint32-index-boundary`
options recorded in the stress test: start 0, end 5, step 0.01, columns 140,
offset `(t * 2 - 1) * track.at(s, trackPoint()).width` on the original clear Aurel
track. The stress metadata pins all resulting typed-buffer hashes.

## Acceptance and boundaries

`tests/circuit-ribbon-data.test.ts` compares **every byte** of each representative
attribute and index buffer with the independent oracle (no epsilon, sampled
vertices, image percentile exclusions or fixture regeneration). It also compares
all stress-buffer hashes, chunk order, strip metadata, source-track point state,
and material/parent/resource ownership. Existing Three normals are part of the
byte comparison, not replaced by a second algorithm.

Evidence limit: callback invocation order and receiver semantics were reviewed
against the original source but were not captured in an independent call-trace
oracle. Byte equivalence covers the existing callbacks and representative inputs;
it does not establish compatibility for arbitrary side-effectful or
`this`-dependent replacement callbacks. The original `kerbUsage` callback is pure
and does not depend on its invocation receiver. No stronger callback-contract
claim is made by these tests.

A future visible Babylon change is separate. Original road datum is 0 and paint
is +0.006 m: paint would be buried under today's +0.010 m Babylon road. Road and
paint must migrate together only after this shared boundary is independently
accepted. The original paint also has construction grit/wear, vehicle-grounding
and light-pool shader hooks. Off-white PBR alone is not complete material parity;
this extraction neither removes those hooks nor ports them. No generic legacy
material adapter restriction is relaxed.

The tests establish geometry/data preservation, not renderer pixels, native
performance, complete environment parity or commercial readiness. Publication
requires parent review and the affected validation gates.

### Local checks on the candidate

Official Node22 direct Vitest execution passed the initial 17 ribbon checks plus
14 existing circuit-detail, 3 terrain-tile and 6 unchanged Babylon integration
checks (40 total). The final ribbon suite, with an additional transitive-import
guard, passed all 18 checks; direct scoped ESLint passed. The transitive guard
walks relative TypeScript dependencies (including type imports) and found no
renderer source/package dependency. No browser/GPU, full build or native package
claim is made by these local results. Parent combined checks remain separate.
