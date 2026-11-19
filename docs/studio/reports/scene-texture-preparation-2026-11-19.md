# Retained scene texture preparation — 2026-11-19

## Scope and observed cause

This isolated candidate follows local `41c57598b017458c010b0d26d1627691c9b726ac`, published as `991cf4fc17f46e102318f25b643bc160789203a2` with tree `e40d41dd4894f2975e0e78cbbd9557daa43c0957`. Its original High workflow, run `44615583958`, still failed the unchanged 90,000 ms paused-readiness assertion. The first chase began 39,843.517 ms into that predicate and completed 90,983.346 ms into it. The later, post-deadline diagnostic showed one complete local probe and one warmup view, with the pit-service stage in progress; it did not establish accepted startup or either photo view.

The independent retained-data analysis found no late shader owner. Subtracting the last pre-chase native snapshot from the last pre-deadline activity gives zero additional shader compilations, links or program/uniform/attribute metadata queries. That interval instead contains 209 raw texture transfers, 262 compressed transfers, 141 texture allocations, 109 mip generations and 3,850 buffer uploads. Their CPU durations may include earlier queued GPU work. The trace does not identify individual resource objects, and equal byte lengths do not prove duplicate transfer. The original evidence is retained by the publication owner in the compact `fullscreen-ci` review package.

The candidate prepares the existing static texture owners before the real shadow/probe draws. It is an ordering hypothesis for end-to-end readiness, not a demonstrated time saving. The original browser gate must decide whether it provides sufficient benefit.

## Source change

`prepareSceneTextures` in `src/rendering/preparation.ts` reads active scalar `SAMPLER_2D` entries from programs already retained by the actual scene materials. The same explicit hidden Formula hosts used by shader preparation are omitted. It deduplicates texture wrappers, leaving Three's native Source/sampler cache to share compatible wrappers and distinguish incompatible samplers.

Built-in map slots follow the installed r180 `WebGLMaterials` assignments. Their current material property is authoritative even when null, so an old compiled uniform cannot resurrect a removed texture. Environment maps use the renderer's processed owner, rather than the raw material input. Custom shader uniforms retain their installed owner. The helper calls the public `renderer.initTexture` without changing source identity, pixels, dimensions, mip chains, version counters, filters, wrapping or colour-space settings.

Render targets, depth/video/external textures, cube/volume/array paths, unready sources, disabled uniform updates and explicitly dynamic maps remain outside this preparation. A DataTexture is eligible only when its existing ownership metadata marks decoded ground normals, static surface detail or an immutable asset; generic simulation fields and bone/state atlases are excluded. A caller's cancellation/disposal predicate is checked before every native upload. The helper is synchronous: it cannot interrupt an individual native call, and external UI cancellation requires JavaScript to regain control.

`RacingRenderer.prepare` invokes this stage after both scene and fullscreen shader metadata preparation, and before shadow-caster work. It retains every original shadow/cubemap draw, both warmup views, the pit-service route, post-draw compilation and GPU-completion wait. No rendering dimensions, quality setting, capture-face count, deadline or browser assertion changes. Camera-toggle invalidation and the FarShadow/TextureBudget policy order are unchanged.

The source audit considered avoiding the FarShadow-to-TextureBudget rebind. Common authored maps change anisotropy or coverage-preserving foliage mips at that boundary, so those transfers cannot be declared equivalent. Moving selected texture policy earlier may warrant a separate rendering-consistency investigation and appearance check; it is not included here.

## Native consumer proof

The new ten-case suite executes the installed `WebGLMaterials.refreshMaterialUniforms`, `WebGLUniforms.upload` and `WebGLTextures` implementations. Only native GL execution is recorded. Cold and prepared consumers submit the same complete 1024-square, eleven-mip data fixture, with SHA-256 snapshots of submitted bytes, the same allocation dimensions, sampler and pixel-store settings, actual anisotropy-16 extension calls, and the same mip-generation behavior. The later native consumer keeps the prepared handle and performs no repeated transfer. Upload callbacks still run exactly once per native upload.

Additional cases cover custom active samplers, different wrappers sharing one Source, sampler-key separation, native reference-counted disposal, removed/disposed maps retained in stale uniforms, processed environment targets, non-renderable objects, dynamic and unready data, hidden hosts, cancellation/renderer retirement, and upload failure followed by retry. Two startup integration cases verify preparation occurs after shader metadata and before shadow/probe drawing, and that cancellation at the new stage prevents uploads and draws. The successful path still draws and waits for both original views.

This is a native submission/cache/lifecycle proof with a deterministic data fixture. It does not execute a browser/driver, certify authored-scene pixel appearance, measure GPU execution time, or establish that all compiled texture owners are visible in the first view. The application continues to prepare the retained material set, including retained detail variants. Real startup timing and the completed photo views remain unverified for this new source until isolated CI completes.

## Verification

All production/test files were frozen during the checks. No production or test edits followed the final runs; this report and compact receipt/log copies were written afterward.

| Check | Result |
| --- | --- |
| Combined targeted graphics suite | 186/186 cases, 16/16 files passed |
| ESLint on the four changed source/test files | Exit 0 |
| Full TypeScript `--noEmit` | Exit 0 |
| Original High application/browser gate on this candidate | Pending; no local browser run claimed |

Exact commands, source/native-module identities and log hashes are in [the receipt](evidence/scene-texture-preparation-20261119/receipt.json). The committed logs are [tests](evidence/scene-texture-preparation-20261119/combined-tests.log), [lint](evidence/scene-texture-preparation-20261119/combined-lint.log), and [typecheck](evidence/scene-texture-preparation-20261119/combined-typecheck.log).

Recommended next action: publish this exact isolated tree and run the unchanged High, component GPU, gameplay and menu gates. Assess total paused-readiness completion, including the texture stage and all original completed-frame waits; a shorter first-chase interval alone is not acceptance.
