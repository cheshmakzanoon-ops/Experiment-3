# Scene ambient material preparation

The isolated High run on `d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6` failed its original 90-second readiness predicate. Its last independently observed native call was `getProgramInfoLog` for **APEX scalable ambient obscurance**, program 463, fragment hash `d089587d`, at the actual 480×300 obscurance target. The worker observed that call in flight for at least 12,198.3 ms. No tracked frame fence had been submitted. The complete source-matched evidence is preserved in workflow run [44559369205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205), artifact 14548105652.

The initial scene preparation visits materials attached to scene renderables. The ambient pass owns separate fullscreen materials, and its first obscurance draw follows the scene render. Those program owners were outside the original compilation coverage.

## API and ownership

`SceneAmbientPass.prepare(renderer, writeBuffer, cancelled): Promise<void>` prepares the pass's known enabled owners:

| Owner | Compilation target |
| --- | --- |
| Ambient obscurance, when AO is enabled | The pass's obscurance target |
| Depth-aware blur, when AO is enabled | The pass's blurred target |
| Composite | The actual write buffer, or the screen when `renderToScreen` is set |

The second blur uses the same retained native program on the matching obscurance target; a focused native-cache test exercises that actual target after preparation. This change does not attempt to prepare unrelated composer or ULTRA stage owners.

The helper obtains the real Three `FullScreenQuad` mesh and orthographic camera through its public `render` method using a compile-only adapter. It never forwards that call to the renderer's draw path, accesses private quad fields, substitutes geometry, or copies shaders. Scene and fullscreen compilation share the existing retained-program snapshot and metadata-resolution logic.

## State and lifecycle

The render target, cube face, mip level, viewport, scissor and scissor-test state are restored synchronously after starting compilation, before awaiting it. The quad's original material is restored at the same boundary. Preparation does not alter uniforms, defines, quality, frame counts, temporal history or GPU-completion behavior, and it issues no draw, flush or finish.

Cancellation is checked before compilation and before metadata initialization. Pass disposal marks preparation stopped, so an outstanding compile cannot query released programs or start later material phases. Native compilation errors and asynchronous rejections propagate with borrowed state restored. A live reentry can reuse still-retained native programs.

## Focused validation contract

`tests/scene-ambient-preparation.test.ts` uses the installed Three program cache and native first-use metadata implementation through the existing CPU harness. It checks actual mesh/camera/material/target ownership, ordering before scene work, untouched unrelated owners, disabled AO and screen variants, no repeat metadata on later real-quad consumption, synchronous state restoration before an await, cancellation, disposal, and both synchronous and asynchronous failures.

Existing scene-program preparation and renderer startup tests remain the integration contracts. These CPU tests do not establish browser readiness, pixel acceptance or a hardware performance result. The unchanged High and related browser gates must still run on the candidate source.

## Recorded state and renderer integration

The same diagnostic run identified `Recorded marshal display 0` as a late first-use owner during the local probe's +X face. The renderer now applies the existing recorded-display update to the unchanged paused frame before initial scene compilation. That selects the same cached material the first draw would use; it introduces no new flag state, clock, simulation step or frame write.

After initial scene compilation, the renderer awaits this pass's preparation using the actual composer write buffer and the renderer's disposal/cancellation predicate. It then executes the original shadow warmup and complete chase/cockpit loop. That loop, its `finally` restoration and both GPU waits are byte-identical to the diagnostic base. Integration tests cover the real recorded display owner, awaiting preparation, and preventing warmup after failure, cancellation or disposal.

## Actual local results and isolated CI scope

All **87 tests in seven focused files passed**, including the 37 startup cases and eight native-cache preparation cases. TypeScript and scoped ESLint also passed. Each invocation ran through the unchanged source-stability guard and exited zero. The post-check snapshot contains **7,486 protected inputs**. The implementation remained frozen during these checks; this report update and the retained evidence were added afterward.

[Complete command receipts, logs, checked file identities and source snapshot](evidence/graphics-engine-advancement/prewarm-owned-materials-local-proof/README.md).

The diagnostic branch workflow now includes the original graphics `gpu`, `gameplay` and `high` jobs unchanged, plus the original MotoGP build and its existing `menu-entry` browser matrix item. The original job commands, dependencies, environment, artifacts, quality, viewports and deadlines are preserved. Only the diagnostic branch trigger and selection of that existing menu group differ. No original workflow or publication gate is changed, and the isolated workflow cannot publish the application. Browser results for this production candidate remain to be collected; the failed diagnostic base is not a passing result for it.
