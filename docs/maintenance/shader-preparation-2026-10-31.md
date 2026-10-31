# Shader preparation investigation · 2026-10-31

## Qualified evidence, not a performance promise

Source `906972067e3dc5ae2f9eac0387d23050a41617a8`:

- [Native run 41197123102](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123102): Windows and Apple Silicon pass all four modes. Restart throttle passes every tested lane. Required Linux Mesa fails original-model readiness after two GPU-process exits/context losses; publication is skipped.
- [SwiftShader comparison 41197123125](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123125): all four modes pass, zero GPU exits/context losses. This does not override required Mesa.
- [Babylon WebGL 41197123089](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123089): five journeys pass.
- [Unprofiled transition 41197123160](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123160): six checks pass, including the original paused-grid limit. First chase scene submission: 14.523 s; later cockpit mirror submissions: 8.683/1.414 s; post-process passes: milliseconds. Completion fences were short. This is one run, not a stable target-PC benchmark.
- [Interaction 41197123079](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123079): cancelled after Academy visibility and programme-startup failures. Lighting/frozen-frame assertions were not reached in the two Academy failures.
- [Diagnostic profile 41197123092](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41197123092): both original workloads fail with profiling enabled. Profiles show first-use `getProgramInfoLog`/`getProgramParameter` synchronization, rather than JavaScript geometry loops or grading. Profiling adds overhead; do not compare its wall times as acceptance benchmarks.

Mesa's retained loss receipt records pending sequence 35, submitted/completed 35/33, two abandoned frames, pending age 25.466 s and last draw CPU time 183.6 ms. Runtime: Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. It is evidence of unfinished graphics work, not proof of which driver command caused the loss.

## Three.js readiness coverage

Pinned Three r180 `compile()` can generate multiple programs for one shared material. Actual installed program-key generation produced three distinct keys for Mesh, InstancedMesh and SkinnedMesh; transparent DoubleSide adds front/back variants. The library `compileAsync()` collects a Set of materials and polls only each material's last `currentProgram`.

The application now submits with public `renderer.compile()`, restores render target/viewport/scissor synchronously, and then observes every live native handle from `renderer.info.programs`. This includes older pending programs. Readiness queries use only `KHR_parallel_shader_compile.COMPLETION_STATUS_KHR`, with at most 16 queries per task and a 45 s polling budget. Cancellation, disposal and context loss cannot proceed into a later draw. Suspended scheduler promises are watched independently for cancellation/context loss/polling expiry; late scheduler settlement cannot restart polling. The 45 s budget starts after synchronous compilation and state restoration, not before submission. Without the extension, the result explicitly reports unsupported and retains the original first-draw fallback; it does not claim observed completion.

The actual scene-pass target is used. A source-backed cache-key check found no current key difference between that target and the earlier same-format composer target, so that change alone is not a claimed speed fix. Shader-error checks and full draws remain enabled. Native calls cannot be preempted by JavaScript; the budget is checked around them, not a guarantee that a blocking call returns on time.

`e2e/gpu-program-readiness.spec.ts` is a real-GL coverage probe: shared mesh/instance/skin material, both sides, an older live program, native status queries, unchanged error checking, and a final draw. Local browser launch is unavailable; the probe runs through Actions. Unit/source proof must not be described as measured native-GPU readiness.

## Babylon original-model preparation

The unchanged GLB contains 94 nodes, 18 meshes/172 primitives, 101 materials, 82 textures and 1,455,118 triangles, including one skin. Its authored PBR extensions remain intact. No model, material, texture or quality reduction is part of this experiment.

Babylon's scene readiness traversal starts materials compiling concurrently. Loader-wide `compileMaterials=true` also starts jobs together and adds unused instanced variants; it is not used here. The application retains the container off-scene and compiles actual mesh/submesh material variants sequentially through the public API. Actual meshes preserve skinning/attribute/light inputs; material-only deduplication is unsafe.

An exclusive preparation owner shares the presentation context. Prior frame completion, compiler readiness and a fence must be observed before moving to the next variant. Input and authoritative physics continue; the last proxy frame is held during a compiler job, with normal presentation opportunities between jobs. Installation happens only after preparation and ownership checks. The existing two ready GPU-completed-frame gate still follows installation.

Restart/cancellation prevents stale installation but cannot cancel work already sent to the driver. Ownership is retained until real completion or invalidated by context loss/disposal/fatal deadline. The original total 120 s asset budget includes fetching, decoding, preparation and final presentation. Pinned PBR error observers are retained because its async compilation wrapper can otherwise remain pending on failure.

After context loss the UI explicitly requires Restart, disables model loading and holds the old scene. Restoration alone never revives the aborted asset owner; only a completed GPU-safe rebuild creates a fresh owner. A queued Restart remains owned across restoration.

A single program can still hang. glTF parsing and texture uploads remain loader-owned. This candidate requires fresh native results and is not a proven watchdog, driver or commercial-readiness fix.

## Local candidate checks

The combined suite passed **205 tests across 19 files**. Root/desktop TypeScript, full project lint, workflow lint, whitespace checks and a source-stable production build (44.76 s) passed. Independent ownership review found no remaining concrete blocker. The real-GL probe is listed correctly but has not run locally; native and browser qualification of this candidate remains pending.

## First-use and Academy follow-up

The b224200 real-GL probe verified all seven variants, while later full-scene submission remained expensive. Synchronous log/status/buffer-allocation APIs can wait behind earlier driver commands; a profile sample in getProgramInfoLog does not prove that program alone is unfinished. Existing buffer-allocation validation remains unchanged.

The next candidate invokes the pinned library's original getUniforms/getAttributes cache getters after KHR readiness. This preserves original shader logs, link/error checks and uniform/attribute reflection, rather than disabling diagnostics. Batches contain at most four programs and use the same existing 45 s post-submission budget, including cache initialization. Unsupported-extension fallback is not primed. Getters/native calls can still block; no measured speedup is claimed. The extended real-GL probe requires the original checks during preparation and zero first-use queries during the subsequent matching draw.

Pure-JavaScript before/after preparation inventories identify old/new/removed program IDs even if net counts match. New-program keys and identities are bounded; valid detail JSON is capped at 32 KiB UTF-8 with explicit truncation/drop information. Inventory errors cannot replace the original rendering failure, and temporary methods are restored before asynchronous work.

The first Academy full-venue draw previously bypassed preparation. Its unadopted candidate now prepares the exact frozen menu view, actual selected lighting and guide, then observes GPU completion. No cockpit/pit view or simulation advance is added; race preparation retains its original scope. Pending resize drains/reprepares before adoption. The chosen LIVE lighting context is held during preparation and the normal five-second cadence resumes after adoption. Existing cancellation/close/repeated-entry ownership remains. Checkpoint-only Academy evidence leaves original input, RAF, GL and timers untouched.

Local combined checks passed **239 tests across 22 files**, TypeScript, full lint, workflow lint and a source-stable 43.00 s build. Independent review found no concrete blocker. These remain candidates for real-driver validation, not hardware certification.

## `5a24b7a`: actual fullscreen first use

The real-GL probe passed all seven checked/primed programs while preserving shader diagnostics: preparation observed seven program logs, fourteen shader logs, seven link-status queries, eighty-eight uniform and nineteen attribute reflections; the matching draw observed none and no GL error. The full workload still creates additional programs later.

Unprofiled interaction evidence recorded menu draw 141.992 s, SceneAmbient 141.727 s, and its first offscreen submission 132.638 s after the main scene's 9.038 s. Inventory grew from 174 to 184, adding AO, blur, composite, DOF, bloom, output and grade programs. The first three are the scope of the next candidate. A similar profiled delay is corroborating diagnostic evidence, not a hardware benchmark.

The narrow plan borrows original materials and actual render targets, uses an empty scene and equivalent fullscreen triangle/camera, restores all renderer bindings synchronously, and disposes only owned temporary geometry. Existing all-live KHR/cache preparation follows submission. It does not move temporal rendering, reflection bakes or exposure reads into preparation. No speedup is claimed before real-driver execution.

Native Windows/Apple Silicon passed; required Mesa failed Formula cockpit preparation after clean Babylon checks. SwiftShader reached Festival but timed out before its first ready presentation. See the source-addressed run links and precise limitations in [current status](../CURRENT_STATUS.md). After workspace replacement, reconstructed changes passed 148 fresh focused preparation tests and 28 Festival tests. Prior local receipts were not reused. Festival construction now drains the previous shared GPU frame before any quality/viewport mutation; held presentation drains and redraws if resize invalidates its viewport. Shader cancellation checkpoints are explicitly marked cancelled, not successful. Real-driver acceptance remains pending.
