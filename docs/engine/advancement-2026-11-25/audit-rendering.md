# Rendering infrastructure audit — 2026-11-25

Baseline: `350119e8`. Production source remained unchanged. Two actionable scopes; no model, character, environment, authored geometry, material, texture, content, quality, or simulation-tuning edits proposed. Existing texture/resource ownership work is excluded.

## 1. Merge pending attribute ranges before the bounded full-upload fallback

**Files:** `src/rendering/attribute-ranges.ts:3–25`; add focused helper/upload tests. Callers need no changes.

**Defect:** `markItems` checks the raw list length before merging. Sixteen identical or overlapping pending entries make the seventeenth mark call `markAll`, even if the dirty union is tiny. Its comment promises merging, but Three only performs that merge when an upload finally occurs. A full marker also permits redundant partial entries afterward.

**Source evidence:**

- `node_modules/three/src/renderers/webgl/WebGLAttributes.js:94–147` merges at upload and then clears ranges.
- `node_modules/three/src/renderers/WebGLRenderer.js:1757–1761` skips object/attribute updates for a frustum-culled mesh; pending CPU marks therefore can span callbacks.
- Actual helper consumers include `effects.ts:656–662`, `rain-streaks.ts:135–142`, `offroad/terrain-view.ts:461–470`, `offroad/mx-terrain-normal-edges.ts:90–91`, and `open-world/festival-trails.ts:257–258`. These are evidence only, outside the implementation scope.
- `node_modules/three/src/core/BufferAttribute.js:152–155` increments `version` on every `needsUpdate = true`; retaining that behavior is a correctness requirement.

**Executed baseline proof:** imported the real helper, `BufferAttribute`, and installed Three `WebGLAttributes` into Node; primed GPU storage through a recording GL shim; repeatedly mutated item 100 and marked inclusive items `100..103` on a 4,096-item vec3 attribute; then called the real upload implementation.

| Marks before upload | Pending entries | Attribute version | Actual recorded `bufferSubData` bytes |
| --- | ---: | ---: | ---: |
| 16 identical marks | 16 | 16 | 48 |
| 17 identical marks | 1 full entry | 17 | 49,152 |
| 1,000 identical marks | 8, including full entry | 1,000 | 49,152 |

The seventeenth duplicate increases this fixture's transfer by **1,024×**. This is measured upload-argument volume, not GPU duration or whole-game performance. `markAll` followed by one partial mark produced `[0,12288]` plus `[300,12]`, confirming redundant bookkeeping after a full mark.

**Bounded implementation:** normalize/merge the existing bounded entries plus the incoming component interval; preserve disjoint ranges; apply the unchanged 16-range fallback only to the resulting union. Merge overlapping and touching spans, including a new span bridging multiple existing entries. A pending explicit full span absorbs later marks. Keep one version increment per nonempty `markItems` call, including absorbed duplicates; keep empty spans as no-ops. Preserve `markAll`'s explicit full entry and all CPU array contents. Do not replace separated spans with one broad envelope or alter Three/vendor code.

**Required validation:**

1. Direct tests: duplicate/contained/adjacent/bridging ranges, different item sizes, full→partial and partial→full, empty spans, upload→clear→mark, 16 genuinely disjoint intervals, and the seventeenth genuinely disjoint interval.
2. Deterministic randomized write/mark/upload sequences using the real `WebGLAttributes` and a GL buffer mirror; compare uploaded final bytes with the CPU reference after every upload. Include several deferred-upload intervals and explicit full resets.
3. Assert versions increment once per nonempty call, unchanged arrays, at most 16 canonical entries, and the duplicate fixture retains a 48-byte upload after 17/1,000 marks.
4. Measure warmed helper CPU cost and uploaded bytes for duplicate, overlapping, adjacent, disjoint, and full-dirty sequences. Report any CPU cost regression separately from transfer savings; include a real culled→visible caller before extrapolating to game workloads.

**Priority:** first. Small generic helper, clear bounded behavior, exact transfer evidence, no authored-content changes.

## 2. Extend the existing GPU submission contract to Festival presentation

**Files:** `src/main.ts`, `src/session/free-roam.ts`, `src/rendering/renderer.ts`, `src/rendering/open-world/festival-renderer.ts`; reuse `src/rendering/gpu-frame-gate.ts` rather than inventing a second gate algorithm. Optional generic presentation-admission helper can isolate clock/invalidation tests.

**Defect:** `main.ts:1652–1655` delegates Festival and returns before `canSubmitFrame()` at 1748 and the 15 Hz idle cap at 1781–1794. `FestivalSession.frame` at `free-roam.ts:666–728` unconditionally updates presentation and draws, including when paused. `FestivalRenderer.draw` at `festival-renderer.ts:679–1079` submits reflections/composer work without recording or polling a GPU fence. The existing gate belongs to `RacingRenderer` (`renderer.ts:507,556,1787–1788,2947`).

**Executed baseline proof:** extracted the complete, unmodified `FestivalSession.frame` method through the TypeScript AST and executed it with collaborator doubles, a valid frame, `isPaused = true`, and a renderer readiness probe returning false. Across 60 callbacks at 60 Hz: **60 draws, 0 readiness polls, 60 HUD updates, 60 control syncs, 60 audio updates**. This establishes missing admission and idle scheduling; it does not measure native GPU backlog.

**Integration requirements:**

- Lend a narrow readiness/submission interface from the application's existing gate alongside the borrowed WebGL renderer (`main.ts:1038–1042`, `free-roam.ts:46–50`). One context-wide fence must cover circuit→Festival→circuit handoff. Festival must not dispose the borrowed backend or the gate; backend teardown remains with its current owner.
- Admit presentation before rider/traffic pose mutation and `draw`; record a fence after actual submitted work. Preserve all existing rendering passes and quality settings. Keep elapsed presentation time across GPU deferrals, without advancing simulation or inventing completion.
- Split presentation admission from the existing HUD/gamepad/control/audio pump. HUD gamepad polling lives at `ui/festival-hud.ts:498`; `free-roam.ts:708–710` already protects reentrant EXIT disposal. A blanket early return before HUD updates would regress controls. Use the last valid presented pose while deferred and retain disposal checks.
- Apply the existing idle cadence only to eligible paused/photo presentation; keep live play uncapped apart from GPU readiness. Preserve immediate pending resize/camera/photo redraw requests until a real permitted submission. Preserve input/audio polling on every eligible callback.
- Cover loading/preparation: `festival-renderer.ts:638–667` currently yields between two warm-up draws but never observes GPU completion, and `free-roam.ts:384–400` subsequently reveals/unpauses. Yielding one RAF is not fence completion. Use cancellable existing-style gate polling for warm-up/handoff, retaining pending ownership on timeout.
- Route gate failure/context loss through `FestivalSession.fail(..., true)` (`free-roam.ts:427–438`) so the existing cancellation/exit lifecycle releases the session. Keep bounded zero-timeout polling from `GpuFrameGate`; no synchronous `finish()` or quality downgrade.

**Required validation:**

1. Extend the existing Festival session doubles: a pending fence blocks draw and rider/traffic updates while HUD, control sync, audio mute/pause state, and gamepad EXIT continue. Completion admits one frame; no skipped redraw request is consumed.
2. Controlled-clock cadence test: paused/photo callbacks are capped at the existing cadence, live-ready frames remain eligible, and resume/resize/camera changes draw at the next GPU-permitted opportunity. Check retained delta and long hidden-tab gaps.
3. Shared-context lifecycle: a pending circuit fence blocks Festival's first normal submission; Festival completion remains visible to the circuit after exit; Festival disposal neither deletes the borrowed gate nor disposes the backend. Check startup cancellation, pending warm-up, failed waits, context loss, and reentrant disposal.
4. Native browser evidence: count submitted/completed/deferred frames with artificial fence delay; compare paused draw counts and callback responsiveness. Verify unchanged rendering settings and the same image for an identical submitted snapshot. Do not infer native FPS from the clock doubles.

**Priority:** second. Broadly useful scheduling parity, but shared-context startup/exit and HUD ordering require an integration owner; coordinate with the runtime audit rather than duplicating its work.

## Checks completed

Direct command, bypassing asset-generating npm hooks:

```sh
./node_modules/.bin/vitest run tests/effects-upload.test.ts tests/gpu-frame-gate.test.ts tests/festival-session-lifecycle.test.ts --reporter=dot
```

**3 files / 48 tests passed** in 1.33 s. Both baseline reproductions above ran successfully against production source and installed Three 0.180.0. No source edits, assets, commits, native GPU measurements, or full-suite/build claims.
