# Retained geometry before the first probe capture — 19 November 2026

**Status: native ownership and ordering verified; hosted acceptance pending.**
The source candidate is frozen at
`619ffceb23ed4351ddfcdf6a3fc232d15e5b5e12`, tree
`8d33f4ce7255a56398689914b1a78fe4a74833ba`, on
`studio/retained-geometry-preparation-20261119`. The parent published and verified
the same tree as `b8f1445cb07d57b35ac1c5dd45e54b01d6aaec92`.
[Isolated run 44630631215](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44630631215)
was in progress when this receipt was written. This report is on a separate
documentation branch; the candidate branch remains at its frozen source commit.

## Source-specific diagnosis

The preceding texture-order source, hosted as
`f22622e3302ed6147c5aae6f8eb6f6bc4057a242`, failed the original High readiness
assertion in [run 44623276067](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44623276067),
job `135910316834`: line 786 still read `loading` instead of `paused` after
90,000 ms. Shadow/reflection warming began 50,233.034 ms after that deadline
window started. The verified High artifact SHA-256 is
`beb9d52d0de973aa5f77654e15e899b433d10fa3c41f2576d9fff66a085273d9`.

The command counters are cumulative across instrumented stages. Between the
first chase activity sample at trace time 124,726.898 ms and the last sample at
164,225.928 ms:

| Native observation | First sample | Last sample | Observed interval change |
| --- | ---: | ---: | ---: |
| `bufferData` calls | 1,032 | 3,432 | 2,400 |
| Aggregate `bufferData` CPU call time | 10.8 ms | 36,858.2 ms | 36,847.4 ms |
| New shader compiles, program links, or program metadata queries | Already present before chase | Unchanged | 0 |

These are instrumented CPU call durations, which can include previously queued
driver work. They are not isolated GPU execution times. The backend was ANGLE
over Mesa llvmpipe, and the timeout is a finite startup-budget failure, not proof
of an infinite stall.

Of the sixteen retained slow-upload records, thirteen allocate `ARRAY_BUFFER`
storage through native `projectObject → WebGLObjects.update →
WebGLGeometries.update`. Three allocate `ELEMENT_ARRAY_BUFFER` storage through
`WebGLBindingStates.setup` immediately before a draw. One 8,321.6 ms vertex-array
call occurs with the second cube face bound, after the first face has rendered;
a 7,934.7 ms index-buffer call occurs among draws of that second face. The bound
program and payload byte length do not establish which scene object owns the
buffer, and the trace does not prove duplicate uploads.

Installed Three r180 explains the ordering: `compileAsync` prepares programs
without filling its geometry/attribute cache. Vertex attributes first upload
when a particular camera projects their objects; index buffers first upload in
the binding-state setup before each draw. Thus later cube faces and later draws
can discover cold geometry after earlier raster work has already been queued.

The separate far-shadow audit did **not** justify removing a bake. The last
readable diagnostic records one construction bake, taking 7,434.1 ms. The first
chase sample already projects cube +X while every draw and clear counter is
still zero. `PhotoSky.clearDay` changes the photo cache key, whereas only a live
sun change alters `skySunKey`; the fresh High journey uses the preset day path.
The two recorded-sky captures correspond to the paused cloud cover's neighboring
bins. No redundant far bake or generic sky capture is claimed for this run.

## Production change

`src/rendering/geometry-preparation.ts` prepares the retained static geometry
selected by the **first actual cube capture**. `ReflectionSystem.updateProbe`
calls it after hiding the subject, mirrors, and existing probe exclusions, and
after placing the real probe eye, before its first cube face renders.

Selection uses visible branches, the real six face frustums, their layer masks,
and each object's existing `frustumCulled` policy. It updates world matrices only
when the scene already delegates that update to the native renderer. Automatic
LOD branches keep their native selection path, so preparation does not activate
hidden levels. The existing `sceneryResident` flag prevents preparation from
repeating on ordinary refreshes once a full first capture has succeeded.

Each selected geometry is borrowed by a temporary ordinary mesh with a simple
material and a zero-count draw range. The **installed WebGLRenderer** performs
its usual geometry registration, attribute uploads, and index-cache setup. The
original range object is restored immediately. There are no geometry clones,
separate native attribute caches, original-object callback substitutions,
instance-attribute borrowing, framebuffer clears, or additional nonzero
primitive draws. Native zero-count draw calls remain real API calls and are
counted normally; subsequent real frames reset their usual counters.

Original geometry disposal owns the allocated buffers. Original object
materials, parents, transforms, and callbacks remain intact. Native attribute
upload callbacks retain their normal ownership and run on the first upload,
which now occurs earlier for eligible owners. There are no such hooks in the
current rendering source. A local mirror-reference snapshot lets the existing
capture `finally` restore visibility even when disposal clears the mirror list
during an upload.

The optimization has an explicit **canvas-entry** contract. A non-null render
target skips preparation and runs the original cube capture path. This avoids
adding driver queries or attempting to reconstruct arbitrary offscreen viewport
and scissor overrides from logical renderer settings.

Instance matrices and instance colours stay on their real `InstancedMesh`
upload/disposal path. Skinned, morph, dynamic, external-buffer, batched, and
automatic-LOD owners also keep normal first-use uploads. This change does not
claim that every first-frame buffer becomes resident early.

## Native proof and focused validation

All application/test bytes checked below are preserved in source commit
`619ffce`. The complete installed renderer, geometry/attribute caches, binding
states, cube camera, and draw dispatch execute against a recorded GL endpoint.
The endpoint validates buffer binding and disposal and records native calls; it
does not execute a GPU driver or verify rendered pixels.

| Check | Result |
| --- | --- |
| Focused rendering/startup tests | **128/128 passed across 8 files**, 26.60 seconds, exit 0 |
| Native geometry cases included above | **15/15 passed** |
| TypeScript `--noEmit` | Exit 0 |
| Scoped ESLint | Exit 0 |
| Ordering mutation-negative control | Expected failure, exit 1; 1 selected case failed, 14 filtered out; original source restored |

The native three-object cube fixture uploads twelve buffers in both the cold
and prepared cases. The cold case has eight uploads after its first nonzero
draw. Preparation moves all twelve before capture, with three zero-count draw
calls; the subsequent cube capture performs **zero additional buffer uploads**
and uses the same native index handles, draw ranges, face order, and raster
submission descriptors.

The actual `ReflectionSystem` fixture selects six eligible geometry owners and
omits eight subject, mirror, hidden, layer-excluded, out-of-range, or inactive-LOD
owners. Its twenty-four buffers upload before the first real face draw; the
following refresh has no preparation draws or payload uploads. Native tests also
cover interleaved/shared attribute ownership, original-owner disposal before any
real draw, cancellation between owners, bounded failed-capture retry, disposal
during upload, translated bounds, and explicit matrix ownership. The offscreen
fallback records zero native preparation calls while preserving actual
framebuffer, viewport, and scissor state at pixel ratio 2, both with default
target settings and explicit overrides.

For the negative control, only the placement of the same preparation was moved
after the six native cube face renders. The actual first-capture test fails
because buffer uploads occur inside cube faces. This demonstrates the ordering
defect without changing payload counts, quality, or acceptance assertions.

## Evidence and remaining acceptance

The [receipt](evidence/retained-geometry-preparation-20261119/receipt.json) retains
source hashes, installed-module hashes, protected-input hashes, the exact check
commands and exits, parsed native proof results, the source-specific diagnosis,
and the negative-control patch/log. The original High test, 90-second readiness
assertion, other deadlines, completed-GPU requirements, rendering quality, and
isolated workflow remain unchanged.

No additional full unit suite, local browser, or product build was run for this
candidate. The parent submitted the original hosted build and browser gates
against the frozen source. Driver scheduling and total startup time remain
unmeasured for the new source, and its real completed-GPU gate still has to pass.
The native proof does not imply a 36.8-second saving or a hardware performance
claim. The next decision belongs to the retained artifact from that exact
hosted run.

The prospective main integration at `bd3f98655c96f4bad0be202c4cb568567b84b305`
remains clean and untouched. It has not been accepted or published.
