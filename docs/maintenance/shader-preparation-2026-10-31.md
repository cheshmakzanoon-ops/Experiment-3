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
