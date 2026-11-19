# High startup buffer ownership diagnostic

Status: native invocation validation is complete. The original High readiness and authored-scene appearance checks remain pending on this diagnostic source.

## Source and purpose

This isolated change starts from local `62f18b868163a9c86857ac3222414484b92bffc9`, tree `c413cd5062b6555d1e607297e99ad93db123de77`, which is the reviewed tree published remotely as `f22622e3302ed6147c5aae6f8eb6f6bc4057a242`.

That source's original CI run `44623276067` passed build, component GPU 7/7, gameplay 1/1, and menu 7/7. High still received `loading` at its unchanged 90-second readiness predicate. The last native worker observation was inside a `bufferData` call for a 26,568-byte element-array payload during the first local-reflection cube capture, on its +Z face. The existing trace did not retain buffer or source-array identities, so equal sizes, the current program, and aggregate upload time could not identify the source geometry or establish duplicate transfers.

The new test-only observer records those identities while the original application executes. It does not change production rendering, source arrays, geometry, material state, render targets, native draw counts, GPU waits, deadlines, or acceptance assertions. There is no geometry preparation or performance correction in this change.

## Existing native observation boundary

Installed Three 0.180.0 emits an `observe` event with the initialized `WebGLRenderer` from the end of its constructor when `__THREE_DEVTOOLS__` exists. The observer preserves an existing target and its listeners, or creates the target before the application loads. It ignores Scene and other renderer observations. The same hook is present in the distributed module and the retained `three-BhAVIF8D.js` bundle requested by the f226 High trace. That retained build has the same production source fingerprint, `9654582fc293da474310e3a5a19db6be2fadc6c0e780b7b1348d9fc6c019837c`.

The observer wraps the actual renderer's public `render` and `renderBufferDirect` methods and existing GL methods. It preserves receivers, arguments, return values, exceptions, nested scopes, later delegating wrappers, and retirement. It adds no native queries, submissions, synchronization, or dependency modifications.

There are two deliberately different ownership claims:

- **Exact direct index:** inside the current actual `renderBufferDirect` invocation, the submitted typed-array object equals the live `geometry.index.array`, and the material is not using Three's derived wireframe index. This identifies the current object, geometry, index attribute, and native attribute key.
- **Registered array candidates:** the submitted typed-array object matches public geometry or instance attributes registered from a scene inventory or actual direct draw. The object must still own that geometry, the geometry slot must still contain the registered attribute, and the normalized attribute must still own the submitted view. Current versions are read at the call. This records possible consumers and aliases; even a single candidate is not promoted to an exact native cache owner.

Interleaved attributes retain both their slot identity and their shared `.data` native key. Different attributes sharing one typed array remain different potential native owners. Equal-sized views and different views of the same backing storage are not merged. Wireframe-derived, stale, unregistered, and overflow cases remain explicit.

## Bounded retained metadata

Native contexts, buffers, VAOs, typed-array views, backing buffers, objects, geometries, and attributes receive process-local WeakMap identities. Element-array bindings follow the default or currently observed VAO. Context restoration advances a generation; observed deletions invalidate native handle knowledge. The observer does not request GL state to confirm an attempted binding or a driver error.

Inventories are limited to 20,000 graph nodes per scan, 16,384 registered views, 64 attribute slots per geometry, four registered consumers per view, eight parent-path entries, and eight renderer observations. A scene is inventoried on its first actual render and once more when first-chase tracing starts, rather than on every cube face. Direct draws refresh their actual geometry's registrations. Explicit truncation flags prevent a capped inventory from being represented as complete.

For the exact same typed-array view, at most four prior buffer lifecycle records are retained. These contain numeric IDs, context/generation, whether deletion was observed, and buffer-lifetime `bufferData` starts/returns. They do not retain WebGLBuffer handles or submitted bytes. Those totals belong to the buffer's lifetime, not exclusively to that view. A prior attempt can have zero successful returns. A matching view identity does not establish that its contents stayed unchanged.

Only an earlier exact direct-index observation can populate `previousExactNativeAttribute` or `previousExactVersion`. Registered candidates never populate those fields.

The existing startup worker receives owner metadata before the corresponding native-start message, linked by an upload ID. It keeps the matching current owner and the already bounded slow-call records, so it can report an owner while the main thread remains blocked in the native call. Metadata delivery and inventory work occur outside the measured native-call span but inside overall startup time. The next CI result therefore remains instrumentation-bearing; an upload's CPU wall time may include earlier queued GPU work.

## Files

| File | Change |
| --- | --- |
| `e2e/high-buffer-owners.ts` | Self-contained init-script observer and bounded identity/lifecycle metadata. |
| `e2e/graphics-high-journey.spec.ts` | Installs the observer and correlates its records with the existing worker's native call stream. |
| `tests/helpers/native-geometry-renderer.ts` | Runs the complete installed WebGLRenderer with only GL execution replaced by a recording surface. |
| `tests/high-buffer-owners.test.ts` | Eighteen native invocation, attribution, failure, lifetime, and restoration controls. |
| `.github/workflows/graphics-high-diagnostic.yml` | Adds the exact unique diagnostic branch and helper path to the existing push trigger. All five jobs remain byte-identical. |

No production or dependency file changed. The complete original High test body, normalized only for the new init-script argument, is byte-identical to the base. Viewport, one-GP scene, original predicate, five-minute test timeout, quality settings, subsequent GPU-completion and photo assertions are preserved.

## Validation

All commands ran under `node --experimental-transform-types scripts/source-stability.ts --` in the exclusively owned `studio/graphics-buffer-owner-2218-20261119` worktree. Inputs remained unchanged throughout each command.

| Command after the guard | Result |
| --- | --- |
| `./node_modules/.bin/vitest run tests/high-buffer-owners.test.ts` | 18/18 passed. |
| `./node_modules/.bin/eslint e2e/high-buffer-owners.ts e2e/graphics-high-journey.spec.ts tests/high-buffer-owners.test.ts tests/helpers/native-geometry-renderer.ts` | Passed, no findings. |
| `./node_modules/.bin/tsc --noEmit` | Passed. |
| `./node_modules/.bin/playwright test e2e/graphics-high-journey.spec.ts --list` | One original High case discovered; no browser test executed. |

An additional JSON discovery check confirmed the exact new worktree/configuration and one case with an empty execution-results list. The Playwright transform cache's embedded source content matched the frozen High spec and observer byte-for-byte. The discovery listing's mapped source-line label is not used as source identity.

The native control compares the entire cold and observed installed-renderer GL command sequence, including two nonzero indexed draws, buffer submissions, native attribute callbacks, and teardown. Other controls cover distinct/equal-sized arrays, same-array/different-attribute aliases, a shared native attribute across geometries and its disposal/recreation, interleaved slots, live version changes, scene callback array and geometry replacement, derived wireframe indices, nested real renderers during `onBeforeCompile` with success and failure, native upload failures, pre-call visibility, VAO bindings, renderer reuse, context restoration, bounded inventories/aliases, reporter exceptions, and delegated instanced draws.

This is installed-native JavaScript invocation evidence. The GL execution surface in those CPU tests is a recorder; real GPU pixels, driver scheduling, original High completion, and selected-policy shadow appearance still require the unchanged browser workload. The local environment did not launch a browser.

The committed evidence directory is `docs/studio/reports/evidence/high-buffer-owner-2218-20261119/`. Its receipt identifies all five source/test files, six installed native modules, the exact unchanged acceptance/job hashes, and the guarded logs. Earlier fixture/lint iterations remain separately in the scratch evidence directory; they are not represented as successful final validation.

## Next steps

1. Publish this exact reviewed source on the unique `ci/high-buffer-owner-2218-20261119` diagnostic branch. Concurrency remains `isolated-high-startup-${{ github.ref }}`, so it cannot cancel an older run on the other diagnostic branch.
2. Run the original isolated workflow and inspect the first-chase upload's exact/candidate precision, native handle/view/attribute identities, deletion observations, and context generation. Preserve all uncertainty and truncation flags.
3. Propose a geometry or lifecycle correction only if those native identities establish a concrete source inconsistency. Repeated sizes, a shared backing buffer, or shifted call timings alone remain insufficient evidence.

The candidate stays isolated until the required original browser and authored-scene appearance checks pass. No readiness-time or whole-scene transfer improvement is claimed by this diagnostic change.
