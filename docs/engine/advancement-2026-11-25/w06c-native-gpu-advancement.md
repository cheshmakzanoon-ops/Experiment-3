# W06C — native GPU upload and fence acceptance

Assignment 33/60, wave 6. Adds two browser acceptance cases for the production
attribute-range helper and shared GPU gate. The first exact-source native run
passed the upload case but failed the shared-fence case's complete-image
control. **The shared-fence case remains failed pending diagnosis and rerun.**
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

A minimal Three scene renders a solid plane into an 8×8 target. The fixture
creates circuit and Festival leases on the same actual context, then exercises
two handoffs:

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

## CI evidence to retain

The existing `engine-native-*.spec.ts` workflow glob includes these cases. Each
test attaches its report before checking the returned assertions:

- `native-gpu-attribute-uploads.json`
- `native-gpu-shared-fences.json`

CI must execute both cases without retries or skips and retain the exact source
commit/tree and backend identity. The diagnostic rerun is pending at handoff.
Even after passing, this is native software-renderer correctness and lifetime
evidence, not a physical-GPU, game-wide image-equivalence, latency, FPS, energy
or performance result.
