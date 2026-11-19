# Passive High program-setup diagnosis — 19 November 2026

**Status: diagnostic source verified locally and independently reviewed; exact-source hosted observation is running.** No production rendering behavior changes in this candidate. The local source is `2f51253549fd431040c5c04331e14d0f1c259f63`, tree `6c9ef74ee4c52e502e1e4484037f72e453eec886`, on `studio/high-program-setup-diagnostic-20261119`, rooted at frozen geometry source `619ffceb23ed4351ddfcdf6a3fc232d15e5b5e12`. The parent published and independently verified the same tree as `31a39636a3907ff5159640affdbeb2e2c9184c6f`, on top of `b8f1445c`. [Hosted run 44634762506](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44634762506) was in progress when this receipt was frozen. This documentation is on a separate receipt branch; the diagnostic source branch remains at `2f51253`.

## What the preceding trace establishes

Exact geometry source `b8f1445cb07d57b35ac1c5dd45e54b01d6aaec92` failed the original 90,000 ms High readiness assertion in [run 44630631215](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44630631215), job `135935986093`. The verified artifact SHA-256 is `5e7165c6f199fbf384e9442297b4b0a316d5b013bec2a8063d563f4dd791eb54`. The application still reported `loading` instead of `paused`; later GP, driving, and photo checks were unreached.

The source reached shadow/reflection warming 35,634.467 ms into the readiness window. That stage completed in 42,187.1 ms, and pit-service warming started at 77,821.567 ms. The last diagnostic recorded an unfinished first pit-layout wait with 12,110.7 ms elapsed and a GPU fence pending for 11,733.1 ms. There were two frame submissions, zero observed frame completions, and no recorded frame-gate failure.

The pit label does not identify the owner of the pending work. `RacingRenderer.prepare()` submits the chase frame before its first 32×20 offscreen crew layout. `warmPitMaterials()` then submits a later fence; `GpuFrameGate.submittedFrame()` makes that fence cover all preceding commands. The first pit wait therefore includes the chase submission. Pit does not call environment or local-reflection update, and the retained samples show no new program compilation or metadata query during that wait. The second pit layout, later scene compilation, and cockpit draw were not reached.

The 84 chase activity samples span 41,499.979 ms, while the sum of instrumented native CPU-call counters grows by 1,862.2 ms, from 210.7 to 2,072.9 ms. Thirteen retained plateaus of about 1–1.5 seconds follow a returned `useProgram` with no wrapped call in flight. They establish a gap in the current instrumentation, not the cause of the elapsed time. The 926.7 ms program-info query and 468.5 ms PMREM buffer upload both belong to the earlier chase stage, not the pit wait.

Installed Three's `WebGLRenderer.setProgram()` performs camera matrix, camera position, skin/batch/morph, material/light/fog, sampler, and object-matrix uniform work after `state.useProgram()`. The existing trace does not time those uniform setters or texture binding. The retained `chase-native-gap.json` is copied verbatim from the independent checkpoint audit; the boundary receipt records the source-order review.

## Diagnostic changes

Only three source/test files change:

- `e2e/fixtures/program-setup-diagnostic.ts` provides the serializable passive observer.
- `e2e/graphics-high-journey.spec.ts` installs it within the existing first-chase diagnostic scope and retains its bounded evidence.
- `tests/program-setup-diagnostic.test.ts` verifies observational forwarding and retention.

The helper times 27 scalar/vector/matrix uniform APIs plus `activeTexture` and `bindTexture`. It forwards each original method exactly once, with the original receiver and argument identities, and returns its exact result or throws its exact exception. It caches uniform names and owning programs only from actual `getUniformLocation` return values, including queries already made before the active timing stage. No new query is issued. Unknown or null uniform locations remain unidentified.

The covered matrix setters are the square 2×2, 3×3, and 4×4 APIs. Nonsquare matrix APIs and uniform-buffer operations are not added without an observed need.

Calls lasting at least 100 ms can produce one of at most sixteen slow records. These records include the method, elapsed CPU call time, returned/error state, cached uniform owner and name where known, current program/fragment/context identity, texture arguments when applicable, payload size, and a bounded stack captured after return. The recorded texture unit is the last observed returned `activeTexture` argument; no error query is added to validate native GL state.

Every observed call contributes to local per-method counts, total duration, maximum duration, slow-call count, and thrown-call count, including calls beyond the slow-record cap. Cumulative summaries are emitted only when dirty, at stage transitions, at most once per second through the periodic observer, and alongside retained slow records. No individual uniform or texture-binding call posts worker start/end messages. This avoids adding high-volume worker traffic to the previously unmeasured path.

The Node-side artifact collector keeps slow records and the latest cumulative summary separately from the existing 256-record generic ring. Early slow evidence therefore survives later sync-poll activity. Existing command-worker and fragment-output diagnostics retain their original behavior.

## Observational limits and unchanged gates

Two clock reads and wrapper/bookkeeping work add CPU overhead to each timed call. Slow records and periodic summaries add bounded reporting work. Durations can include earlier queued driver work and are not isolated GPU execution times. The passive observer reports only calls after they return or throw; an indefinitely blocked uniform call remains outside its precise attribution. No driver query, GPU flush/wait, uniform assignment, extra raster work, quality change, or deadline change is introduced.

The whole original High workflow/assertion body remains byte-identical, SHA-256 `e012214e1b2e37cf1e2646ed1b8e21e000f031ca2ab3c956e2bcb492528e1549`. Its 960×600 viewport, High preset, 90-second readiness predicate, original test timeout, paused GP checks, and both completed photo views are unchanged. The existing fragment-output observer is also byte-identical. The complete `src`, `public`, `scripts`, package/configuration inputs, and workflow tree equal `619ffce`. The earlier frozen geometry, geometry receipt, previous main integration, and new prospective integration branch pointers remain intact.

A hosted run of this diagnostic has a distinct source identity and observer overhead. It must be reported as such; its durations cannot be represented as uninstrumented application performance or as acceptance of the earlier source.

## Verification and next step

All checks ran on clean committed `2f51253` under the existing source-stability guard:

| Check | Result |
| --- | --- |
| Focused observer conformance | 6/6 passed, 1 file; Vitest duration 0.483 seconds; exit 0 |
| Full TypeScript `--noEmit` | Exit 0; guarded command wall time 34.296 seconds |
| ESLint on the three changed files | Exit 0 |
| Source/gate parity | All production, workflow, original workload, and frozen branch checks passed |

The parent and checkpoint agent independently reviewed the frozen three-file diff without finding an observational-semantics blocker. The checkpoint agent separately confirmed the original workload and fragment-output hashes and the 90,000 ms assertion, which moves to line 820 solely because diagnostics were inserted above it.

The fixtures cover all 29 methods; exact receiver, argument, array, return, and exception identity; native query/null caching; texture-unit observation; all-call counters beyond the sixteen-record cap; report/description failures; inactive behavior; and serialization without module or worker dependencies. They use a recorded fake WebGL endpoint and make no driver-timing claim.

The [receipt](evidence/high-program-setup-diagnostic-20261119/receipt.json) retains source/native hashes, exact commands and exit codes, logs, protected input parity, the preceding failure boundary, and independent review provenance. No new product build, full unit suite, local browser, or remote publication was performed by this task. Production build evidence is unchanged; hosted execution still belongs to the parent-controlled workflow.

The next decision is to collect the unchanged High journey against the reviewed diagnostic source and attribute any returned slow setup calls to their native method and cached owner. Only that evidence can justify considering a further preparation-order change. No additional material warmup or relaxation of GPU readiness is proposed here.
