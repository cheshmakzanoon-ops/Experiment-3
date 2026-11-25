# W06C — native GPU upload and fence acceptance

Assignment 33/60, wave 6. Adds two browser acceptance cases for the production
attribute-range helper and shared GPU gate. Three exact-source native runs
passed the upload case but failed the shared-fence case's complete-image
MeshBasic control with the same reproducible pixel pattern. A six-path native
comparison isolates the observed failure to the `vec3` colour-uniform draw path
on the recorded Mesa/ANGLE/LLVM stack; its exact internal cause is not established.
The shared-gate fixture now uses an explicit test-only `vec4` witness while
retaining exact whole-image checks and always recording the failed material paths.
**The revised shared-gate oracle awaits exact-source native CI.**
Local compilation and discovery are not reported as a native GPU pass.

Owned files:

- `e2e/engine-native-gpu-advancement.spec.ts`
- `e2e/fixtures/engine-native-gpu-advancement.ts`
- This report.

No production source, existing test, dependency, workflow, authored model,
character, environment, material, shader, asset or tuning was changed. The
small plane and solid materials below are isolated test controls.

## Actual native boundaries

Both cases create a real Three `WebGLRenderer` and require a native
`WebGL2RenderingContext`. The report records its WebGL version, vendor and
renderer string, including the unmasked backend when the extension is exposed.
It explicitly records `physicalHardwareValidated: false`. The repository's
focused engine workflow independently selects and verifies Mesa software
graphics.

The first case imports the installed Three `WebGLAttributes` implementation and
the production `markItems` helper. A wrapper records actual `bufferSubData`
arguments and forwards the identical overload to Chromium. Independent
`getBufferSubData` reads retrieve the native buffer contents. No JavaScript
storage shim substitutes for driver memory, and no uploader or range-merging
algorithm is reproduced in the fixture.

The second case imports the production shared-gate provider and unchanged
`GpuFrameGate`. Its wrappers call actual `fenceSync`, `clientWaitSync`,
`deleteSync` and `flush`, returning the driver's original values. `finish` has a
fail-fast guard, and the case requires zero attempted calls. No wait result,
clock or completion flag is fabricated.

## Case 1: deferred dirty bytes and reset after a full upload

The attribute contains 4,096 Float32 vec3 items: **49,152 bytes**. Its source
view starts 20 bytes into a larger allocation, with eight guard values outside
the view. The native buffer is initially populated through Three's actual
`bufferData` path.

The case asserts the following publication sequence:

| Phase                                 | Pending range before publication, in components | Native upload bytes | Native destination offset |
| ------------------------------------- | ----------------------------------------------- | ------------------: | ------------------------: |
| 25 repeated writes to items 100–103   | `{start: 300, count: 12}`                       |                  48 |                     1,200 |
| 17 genuinely disjoint item writes     | `{start: 0, count: 12288}`                      |              49,152 |                         0 |
| Two adjacent writes after full upload | `{start: 210, count: 6}`                        |                  24 |                       840 |
| Two updates without a version change  | Empty                                           |                   0 |                         — |

Before the first publication, the actual native buffer must still equal its
original bytes even though the CPU source has changed 25 times. The full-buffer
read after publication must equal the newest CPU values, including unchanged
regions. The disjoint case must retain 16 separate ranges until the seventeenth
mark requires the full fallback. Three must clear consumed ranges so the next
marks return to a narrow transfer.

Each stage compares every readback byte, retains SHA-256 hashes, checks exact
version increments, verifies source-view offsets and bound buffer identity,
and confirms that all allocation guards remain unchanged. Removing the
attribute must delete the native buffer and remove Three's bookkeeping.

Deferral is an explicitly controlled interval between producer updates and
publication. This case does not assert that a busy Festival renderer keeps
updating its scene. W05F separately establishes the production scheduling and
caller relationship.

## Case 2: native shared fence handoff

A minimal Three scene renders a solid plane into an 8×8 target using a test-only
`RawShaderMaterial` with an explicit `vec4` colour uniform. This is a render-order
and ownership witness, not an acceptance test for MeshBasic or authored game
materials. The six-path diagnosis and reason for that boundary are retained below.
The fixture creates circuit and Festival leases on the same actual context, then
exercises two handoffs:

1. The circuit submits a red frame. Releasing and replacing the Festival
   borrower must retain the same pending gate, one live native sync and zero
   deletions. Completion is polled through alternating surviving leases.
2. The replacement renders green, submits, and releases its lease. The circuit
   and another borrower must retain the pending second submission. The released
   owner cannot admit or submit work. The surviving owners observe completion
   through the real native wait API.

All waits use flags `0` and timeout `0`, yielding between browser tasks when
necessary. A driver may report immediate completion; neither a particular
number of deferred callbacks nor a minimum GPU delay is required. The trace
must contain exactly one observed completion and one deletion for each of
these two fences.

Only after completion has been observed does native pixel readback occur.
Every byte of both 256-byte images must match the expected red or green control,
and the report retains their hashes. Readback is not used to establish gate
readiness.

A third blue submission exercises terminal cleanup. It is deliberately
abandoned and is **not counted as completed or read back**. Releasing one owner
must retain its native sync; the final lease must delete it exactly once while
leaving the borrowed backend undisposed and the context alive. Each of the
three sync objects must be deleted once. The separately owned geometry,
material/program and render target are then released, Three's corresponding
memory counts return to zero, and the fixture disposes its backend once.

## Local validation

The fixture was bundled with installed esbuild for the browser, targeting
ES2022, with `bundle: true`, `format: 'iife'` and `write: false`. The output was
1,108,485 bytes, with seven static bundle inputs. No bundle output was written
into the game.

Playwright discovery found **two tests in one file**:

```sh
node node_modules/@playwright/test/cli.js test \
  e2e/engine-native-gpu-advancement.spec.ts --list
```

Scoped ESLint passed. A narrow TypeScript semantic check over the two new files
and their imported types caught a test-only numeric-literal `includes` typing
issue; it was corrected to an explicitly numeric set without changing the
accepted native wait results. The final targeted semantic check passed with a
512 MiB heap limit, and scoped ESLint and Prettier checks passed:

```sh
node --max-old-space-size=512 node_modules/typescript/bin/tsc \
  --noEmit --target ES2022 --module ESNext --moduleResolution Bundler \
  --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck \
  --allowImportingTsExtensions --types node \
  e2e/engine-native-gpu-advancement.spec.ts \
  e2e/fixtures/engine-native-gpu-advancement.ts
```

No full repository compiler/build or npm lifecycle hook ran.

## First native run and diagnostic follow-up

The focused engine workflow
[45573448610](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45573448610)
executed the cases at commit `9922926e786c35e84810efc8b15e75bcfaba5372`,
tree `9d1471a772048e1edd95fb0376be026023670add`, using
`ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`.

- The attribute upload case **passed**, including native readback and its full
  sequence of narrow/full/narrow transfers.
- The shared-fence case **failed** at the strict full red-image comparison.
  All preceding lease and pending-ownership assertions passed. Both first RGBA
  pixels matched their red/green controls, but each full 256-byte image reported
  64 differing bytes. This is not enough information to classify the remaining
  image discrepancy as an engine or driver defect.

The attached native report records 22 actual zero-time waits: 20
`TIMEOUT_EXPIRED` results and two `CONDITION_SATISFIED` results. It records
exactly one deletion for each of the three submitted syncs, zero finish calls,
zero GL errors, a live context, and zero retained Three geometry/texture/program
counts after cleanup. Assertions after the image failure did not execute;
these fields are inspected report evidence, not a passed test case.

The failed image hashes are retained:

| Image | SHA-256                                                            |
| ----- | ------------------------------------------------------------------ |
| Red   | `c71a938f01e7932926a8a7de17446c1ab97662b2838cda203b18b5c6c23be6e2` |
| Green | `d9dfbcc840c37fbf43fc03ce9abcd555ec8ef05fea3f708036c16e094fccda12` |

The original attachment omitted full pixel values. The follow-up therefore adds
bounded diagnostics without changing any rendering state, gate behavior, or
assertion: all 256 actual and expected bytes, mismatch counts by channel and
row, the first 16 mismatches, colour counts, expected hashes, and native
viewport/scissor/packing/framebuffer state plus material and colour-space
settings. Readbacks and state queries still happen only after observed native
completion. The failed checkpoint remains preserved; no production patch or
assertion weakening is justified by the available evidence.

The diagnostic follow-up bundle passed at 1,110,500 bytes with seven inputs;
scoped ESLint passed and both modified files were formatted. The spec and all
its strict assertions remain unchanged. No local browser run or additional
TypeScript/build process was started; the coordinator reserved available memory
for the other active work and the exact-source CI compiler check.

## Second native run and raster-path isolation

The diagnostic rerun
[45579529295](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45579529295)
used commit `6a1c76fae3736e4d814ab6d0a354f6837320731c` and the same reported
ANGLE/Mesa/llvmpipe backend. The upload case passed again. The shared-fence case
again failed its strict full-image comparison, with exactly the same red and
green hashes recorded above.

The complete readback now makes the discrepancy reproducible: each red row is
`red, blue, green, red, red, blue, green, red`; each green row is
`green, red, blue, green, green, red, blue, green`. Each image contains 32 pixels
of the intended colour and 16 pixels of each other primary colour. All 64 alpha
values are 255. Red mismatch counts by channel are `[32, 16, 16, 0]`; every row
has eight differing bytes.

The recorded state has an 8×8 viewport and scissor, disabled scissor testing,
`PACK_ALIGNMENT = 4`, zero row length/skips, and a complete framebuffer. Material
colours are exactly `[1, 0, 0]` and `[0, 1, 0]`, material dithering/tone mapping
are disabled, and output colour space is linear sRGB. The report contains 19
real zero-time waits, including 17 timeouts and two satisfied results. Pending
ownership and handoff assertions again passed before the image failure; this
does not turn the whole shared-fence test into a pass.

Installed Three 0.180.0's `WebGLRenderer.readRenderTargetPixels` calls the native
`readPixels` API with the target texture's format/type. Its `WebGLTextures`
implementation selects `RGBA8` for the default unsigned-byte RGBA target with
no sRGB transfer. The
[Khronos WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/)
defines the relevant native readback and framebuffer-attachment queries. These
contracts did not identify the cause of the observed stripes. At this checkpoint,
packing, shader/uniform, backend, and fixture issues still required controls to
separate them; no production-engine change was justified.

A failure-only diagnostic was added using a separate native context and the same
8×8 RGBA target to compare six paths:

| Input path                                       | Boundary exercised                                   |
| ------------------------------------------------ | ---------------------------------------------------- |
| Three MeshBasic red draw                         | Original minimal Three material path                 |
| Native `clearBufferfv` with red RGBA             | Native colour clear without a shader draw            |
| Native `texSubImage2D` with exact red RGBA bytes | CPU-to-texture publication without shader evaluation |
| Raw shader with a constant red `vec4`            | Native rasterization without a colour uniform        |
| Raw shader with a red `vec3` uniform             | Three/native three-component uniform path            |
| Raw shader with a red `vec4` uniform             | Three/native four-component uniform path             |

After each input, the actual shared gate submits and observes a real fence.
Only then does the diagnostic compare a bulk native RGBA read, all 64 native
1×1 pixel reads assembled in row order, and Three's bulk readback. Every path
retains complete expected/actual bytes and hashes. The report also records
attachment component sizes/type, implementation read format/type, actual native
colour-uniform values for draw paths, shader logs, GL errors, and native gate
counts. No synthetic wait status or blocking completion shortcut is used.

At this checkpoint the diagnostic ran only when the original image differed, attached
`native-gpu-raster-path-diagnostics.json`, and cannot replace or satisfy the
original oracle. All red/green full-image and lease assertions retain their
exact expected values. The pixel assertions now follow the complete fence and
cleanup checks so a raster failure does not prevent those lifetime assertions
from executing. Both failed checkpoints and their image evidence are retained.

The matrix fixture bundles locally to **1,117,564 bytes with seven inputs**;
scoped ESLint and formatting passed. No local browser, full compiler/build, npm
lifecycle hook, or production-source change was run. Native matrix execution
and any resulting cause classification were pending at that handoff.

## Third native run: observed vec3 colour-path failure

The six-path matrix executed in focused workflow
[45585197376](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45585197376)
at exact commit `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`, on
`ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`. The original shared
case still failed its unchanged MeshBasic image oracle. All native ownership,
fence, zero-time wait, and cleanup assertions preceding that oracle passed.

The separate-context matrix recorded these differing-byte counts against the
exact 256-byte solid-red control:

| Draw/publication path                 | Native bulk read | All 64 individual pixel reads | Three readback |
| ------------------------------------- | ---------------: | ----------------------------: | -------------: |
| MeshBasic                             |           **64** |                        **64** |         **64** |
| Native RGBA clear                     |                0 |                             0 |              0 |
| Native exact RGBA texture upload      |                0 |                             0 |              0 |
| Constant-colour raw shader            |                0 |                             0 |              0 |
| Raw shader with `vec3` colour uniform |           **64** |                        **64** |         **64** |
| Raw shader with `vec4` colour uniform |                0 |                             0 |              0 |

MeshBasic and the minimal raw `vec3` shader produced the same failed hash,
`c71a938f01e7932926a8a7de17446c1ab97662b2838cda203b18b5c6c23be6e2`.
The other four paths produced the exact expected red hash,
`0d1b5807a072040df4aab5871837e4296ddafc56a83226a1d098e6e86961c001`.
All three read methods agreed byte-for-byte for every path. Native uniform
queries returned the correct `[1, 0, 0]` or `[1, 0, 0, 1]` values; attachments
were complete, unsigned-normalized RGBA with eight bits per component. There
were no shader logs, GL errors, finish calls, or context loss, and all six
diagnostic submissions reached observed native completion.

These controls rule out the observed bulk-read packing hypothesis and isolate
the mismatch to the tested `vec3` colour-uniform raster path on this software
stack. The minimal shader reproduces it without MeshBasic's shader chunks or
borrower handoffs. This evidence does **not** identify whether ANGLE translation,
Mesa/llvmpipe compilation, LLVM, or another native draw implementation detail
is responsible. It does not establish an authored game-material defect or
justify changing game shaders. The original failed cases remain failed evidence.

### Strict vec4 witness and visible material limitation

The revised shared-gate case uses the same minimal `vec4` material as the exact
matrix control. Its shader directly writes the four-component colour uniform.
It still renders red, then green, then an abandoned blue submission using the
same lease sequence and actual asynchronous native fence completion. The complete
red and green byte arrays retain their original expected values, and all gate,
pending-owner, released-owner, sync deletion, GL-error, and cleanup assertions
remain intact. No tolerance, selected-pixel acceptance, expected stripes, skip,
fabricated wait result, or readback-based admission is introduced.

The test name and result metadata explicitly identify the `vec4` witness and
its limited render-order/ownership scope. The six-path matrix now runs and is
attached on **every** shared-gate execution. Any nonzero image differences remain
listed in `rasterPathFailures` and visible Playwright
`native-backend-raster-limitation` annotations. MeshBasic and `vec3` image failures
are not represented as passing material checks. Their expected images remain
the solid-red control; the test does not require a defect to persist on another
backend or future driver.

The known-valid clear, texture-upload, constant-shader, and `vec4` controls are
now asserted exactly for all three read methods, including all 256 bytes and
their expected hashes. The separate-context, single-owner `vec4` red result must
also equal the shared-handoff red result. Both use the production gate; this is
an independent context/ownership control, not a second implementation of the
gate. Native attachment properties, agreement between read methods, zero GL
errors, and diagnostic completion state remain checked; the shared-gate case
continues to assert its native-sync and Three resource cleanup.

### Local validation of the revised witness

The fixture bundles to **1,118,974 bytes with seven inputs**. Scoped ESLint and
the narrow semantic TypeScript check documented above passed, with the compiler
limited to a 512 MiB heap. Formatting passed, and Playwright discovery still
finds two tests in this file. These are local static checks;
the new witness has not yet executed in the native browser. No local browser,
full repository compiler/build, npm lifecycle hook, production code, authored
shader, model, character, or environment was changed. The attribute-upload
fixture representation was not changed in this follow-up.

## CI evidence to retain

The existing `engine-native-*.spec.ts` workflow glob includes these cases. Each
test attaches its report before checking the returned assertions:

- `native-gpu-attribute-uploads.json`
- `native-gpu-shared-fences.json`
- `native-gpu-raster-path-diagnostics.json` on every shared-gate execution

CI must execute both cases without retries or skips and retain the exact source
commit/tree and backend identity. The revised vec4-witness run is pending at handoff.
Even after passing, this is native software-renderer correctness and lifetime
evidence, not a physical-GPU, game-wide image-equivalence, latency, FPS, energy
or performance result.
