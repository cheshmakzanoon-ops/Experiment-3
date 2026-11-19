# Static scene texture policy before the far-shadow bake — 2026-11-19

## Correction and source boundary

This local follow-up starts from retained-texture candidate `4b9d6bb70f1443930ae674e610dc14d61e187ee3`, tree `365f4a448d3335e8ea111605471a80f457ba1a0a`. That earlier candidate remains available on its original branch. No browser result from the earlier tree is reassigned to this follow-up.

The construction queue sorts by numeric priority. Venue creation and spatial batching finish by priority 4, material installers run at 5, static transforms seal at 6, and probe-detail surveying runs at 7. Previously, the priority-9 far-shadow bake ran before the synchronous constructor or asynchronous factory registered the completed circuit with `TextureBudget`.

Registration can dispose an existing sampled texture owner, install a separate budget-owned Source, resize its image, set anisotropy and minification filtering, and create the existing authored foliage coverage mip chain. Three's native shadow consumer reads the live material map and alpha map. The earlier far bake could therefore use pre-budget texture data while later near shadows and colour used the final policy. Resource identity replacement after a native upload also requires a second native allocation and transfer for affected owners.

`RacingRenderer.queueStaticScenePreparation` now queues **Scene texture budget at priority 8**, followed by the original **Far sun shadow at priority 9**. Both construction paths drain this same queue; their two post-queue registration calls are removed. Initial quality still configures the existing texture budget before the deferred queue executes. Registration still traverses the complete final circuit at execution time, including assets loaded after renderer creation and retained variants added during construction.

No texture-budget algorithm, dimensions, quality preset, shadow size, foliage cutoff, sampler setting, shader, caster list, GPU-completion wait, browser deadline or acceptance predicate was changed. The final colour texture policy is preserved. The far bake intentionally adopts that same policy; **identical old far-shadow pixels are not claimed**.

## Native consumer and lifecycle proof

Seven new cases invoke the real production scheduling and bake methods, `BuildQueue`, `TextureBudget`, `FarShadow`, and installed Three r180 `WebGLShadowMap`, `WebGLMaterials`, `WebGLUniforms` and `WebGLTextures`. Only Canvas fixture rasterization and native GL execution are substituted. Submitted fixture pixels and mip data are snapshotted and hashed before later policy changes can mutate their owners.

The fixture contains a generated canvas map, an opted-in authored foliage map, and two compatible Source-sharing clones added during later construction phases. The foliage policy is installed after initial asset attachment. Both synchronous and cooperative queue execution retain the final sampled owner and exactly the same sampler/pixel policy through far shadow, near shadow and colour consumption. Native shadow alpha-to-coverage conversion retains its existing 0.5 depth cutoff, while the authored colour cutoff remains 0.45.

The explicit original-order control runs the unchanged native bake before registration. Its final colour policy and native final-policy upload arguments match the corrected order, but the far bake retains a different pre-budget Source/handle. The small fixture observes:

| Native sampled-resource event | Original post-bake registration | Priority-8 registration |
| --- | ---: | ---: |
| Allocated texture handles | 4 | 2 |
| Deleted texture handles before teardown | 2 | 0 |
| Payload uploads | 7 | 5 |

These are fixture counts, not counts of duplicate transfers in the authored High scene. The earlier trace did not retain native resource identity; its entire upload count must not be attributed to this ordering defect.

Cancellation immediately before registration and immediately before the bake prevents a shadow submission and restores all acquired Sources during disposal. A registration failure propagates before the far bake and releases partial ownership. Normal teardown releases each shared native owner once, restores loader Sources without changing their pixel bytes, and does not close the loader bitmap. Repeated teardown performs no native work after retirement.

The existing ten retained-texture cases are unchanged below their imports. Their native cache fixture was moved to `tests/helpers/native-texture-cache.ts` for reuse; an optional payload snapshot function records image pixels in the new tests. This extraction does not change those original assertions.

## Verification and causal control

All checks used `scripts/source-stability.ts` with output outside the source tree. Production and test source was frozen for the positive checks.

| Check | Completed result |
| --- | --- |
| Queue, startup, native texture, far-shadow, canvas/imported budget, foliage and vegetation-transition suites | **107/107 cases across 9 files**, exit 0, 46.08 seconds |
| Full TypeScript `--noEmit` | Exit 0 |
| ESLint on the changed source/test files | Exit 0 |
| Priority-only negative | **Both selected owner-consistency cases fail**, actual exit 1 |
| Original High test and isolated workflow | Byte-identical to 4b9d6bb |
| Browser/driver acceptance of this follow-up | Not run locally; still required |

The negative changes only the new registration priority from 8 to 10, placing registration after the unchanged priority-9 far bake. Both queue-mode cases then fail at the same native Source-identity assertion. Five unrelated cases are excluded by that control's explicit name filter. The exact positive renderer bytes were restored afterward and their SHA-256 rechecked. No production or test edits followed the positive checks except that isolated, fully restored control.

The [receipt](evidence/static-scene-texture-order-20261119/receipt.json) preserves exact source/native-module hashes, commands, counts and log hashes. The [positive log](evidence/static-scene-texture-order-20261119/static-order-tests.log), [negative log](evidence/static-scene-texture-order-20261119/static-order-priority-negative.log), [negative receipt](evidence/static-scene-texture-order-20261119/static-order-priority-negative.json) and [one-line control patch](evidence/static-scene-texture-order-20261119/static-order-priority-negative.patch) retain the complete evidence.

## Remaining acceptance

The original High journey must pass its unchanged total readiness predicate and complete the original GPU waits, driving and photo views. Moving registration earlier can remove native owner replacement for eligible maps, but the total startup benefit is unmeasured. Compressed maps and other owners outside `TextureBudget` are unaffected, and the earlier geometry-buffer work remains. Native fixture correctness does not establish authored-scene appearance, hosted completion time or physical-hardware performance.

Run the unchanged isolated High, component GPU, menu/settings and driving/replay gates on this exact source before considering integration into main. Retain any failed result as source-specific evidence; a shorter stage alone does not establish complete application readiness.
