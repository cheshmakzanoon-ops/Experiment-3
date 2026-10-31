# Supplied index preparation — 2026-10-31

## Scope

This candidate follows rollback main `652a00fd1d761ae8954d41dbf5b5cd9af5b0be5e` (physics identity v20). It changes the retained Three.js compatibility preparation path, not Babylon's primary-engine direction or the authoritative physics solver.

During an exclusively owned preparation draw, after the existing CPU pose, LOD, visibility and matrix updates, eligible supplied-player index streams are selected/uploaded **before any view submission or GPU-timer begin**. The shared selector is the ordinary render hook's selector; the prepass does not render, resample simulation, install temporary indices/ranges, or alter source geometry, materials, triangle order, LOD policy or mirror refresh cadence. An idle frame gate, ownership and context-health checks precede preparation.

A non-consuming mirror plan identifies only the feeds actually scheduled for that draw. It is consumed once. Root-pose, detail-callback identity, exclusion-content, quality/bind and cadence changes invalidate stale plans before submission. Normal frames allocate no plan snapshots. These guards do not promise safety against arbitrary mutable callback closure state or every possible external child/projection mutation; the owned preparation path retains the known pose/policy between planning and consumption.

Unsupported overrides/debug presentations, custom mesh/scene hooks, automatic Three.js LOD ancestors, shared geometry and unsupported material/topology cases conservatively decline. Tiny current LODs with no range-selector work are skipped. Healthy short native allocations still throw; actual buffer-size validation remains enabled. Cancellation/loss/disposal does not authorize another draw or install a candidate.

The existing per-view GPU-completion wait now runs **before** post-view compilation/readiness queries. Views, pit ordering, fence count, quality and completion/polling budgets are unchanged. This removes one ordering hazard; it cannot establish that a driver crash inside a draw is repaired.

## Bounded CPU evidence

Preparation checkpoints retain subject/compact-owner counts, exact scheduled mirror count, per-attempted-camera pool counters, and before/after-preparation counters. A best-effort post-draw receipt also runs on thrown draws and cannot replace the original failure. It says whether the synchronous draw returned, **not** whether GPU work completed.

- Only existing CPU diagnostics are read: buffers, uploads and uploaded bytes. No GL queries/wrappers, RAF/timer hooks or new acceptance gates are added.
- At most 12 subject rows and 36 camera rows are retained; omissions/truncation/drops are explicit.
- An eligible owner means an enabled compact pool with mesh bindings, not proof that every binding is visible or requires compaction. No-owner/disabled-owner cases say `not-applicable`; unavailable diagnostics remain explicitly unavailable.
- Post-draw totals aggregate **all camera pools**. Unprepared shadow/probe/wet passes may legitimately allocate or upload; extra aggregate work is not converted into failure. Render submission/triangle statistics remain separate.

CPU inspection of the actual source GLB found 172 distinct loader primitive-geometry keys and 18 mesh definitions each referenced once. Of those primitives, 61 are skinned and excluded from compaction; 111 are rigid before other eligibility checks. Source SHA256: `013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`. This is ownership evidence, not a real-render result for all 111 primitives.

## Verification and limits

Final affected checks on 2026-10-31 UTC:

- **153 tests / 6 files passed**, 16:55:16–16:55:30: `startup`, `supplied-compaction`, `mirrors`, `supplied-index-preparation`, `preparation-passes`, and `native-preparation-evidence`.
- **Root TypeScript passed**, 16:57:32–16:58:29, after correcting the diagnostic helper's optional owner types.
- Affected ESLint and diff checks passed. An earlier broader 204-test/11-file run covered the preupload/fence implementation before the CPU-evidence addition; it is not substituted for the final affected checks.

Tests cover ordered baseline/prepared bytes and exact buffer/upload counts; no new buffer-size/binding queries during prepared known-camera hooks; hidden/layer/frustum/material eligibility; cancellation, loss, disposal and healthy allocation errors; mirror cadence and stale plans; pending-frame query ordering; bounded/unavailable/no-owner evidence; and preservation of the original draw error.

The standalone `e2e/gpu-index-preupload.spec.ts` uses actual WebGL with synthetic transparent indexed geometry and three cameras to compare completed pixels, GPU index order and resource counts. Its fixture bundle, types, lint and test discovery were checked locally; **no local browser was launched**. The original `e2e/42-full-scene-index-budget.spec.ts` is unchanged. The new probe is added to the existing settings-transition workflow without dropping its prior cases. RealGL and packaged-native acceptance of this candidate remain pending Actions; unit passes do not prove GPU performance or crash resolution.

## Native baseline predates this candidate

Required run `41221026074` tested published **652a00f without these graphics changes**. Windows x64 and Apple Silicon passed Babylon checks and all four compatibility journeys; Mesa Linux failed and publication was skipped. Windows/Apple Silicon each retained 439 clean preparation packets; Mesa retained 111, without packet drops/rejections/truncation.

On Mesa, both cockpit mirrors completed (11.2890 s / 1.0125 s), then main-scene submission failed after 20.1542 s; no cockpit post-view compile span was reached. Program inventory stayed 283→283. GPU exit 512 preceded the allocation-error log by approximately 3.6 ms; the sticky primary failure remained the GPU-process crash. The secondary allocation validation error is **not OOM evidence**. Screenshots and fatal observations were retained and inspected.

Workspace receipts: `/workspace/shared/experiment3-evidence/652a00f/preupload/` and `../native-monitor.md`; earlier ownership/broader-unit evidence: `/workspace/shared/experiment3-evidence/56a2430/preupload/`. These are source-scoped engineering receipts, not visual-quality, physical-hardware or retail-readiness claims.
