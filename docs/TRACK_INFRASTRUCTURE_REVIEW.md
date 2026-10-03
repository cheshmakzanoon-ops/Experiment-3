# A01–A07 integration review — 2026-10-03

## Evidence and source identity

The authored candidate was reconstructed by workflow run `37149330552` from
`b2a7feceecee439358f4e0166bd9869e4c1a1a42`. The archived application tree is
`aa3e60e4cbae225f5b844ff389ba074e18f1a090`; source archive SHA-256 is
`59b454d5aec6f8529e11f8b5e16725b8a34c05f6e6a7704053c145384a84798e`.
Its asset hashes are the exact hosted export identities, not a claim of
byte-identical exports across CPU hosts. The continuation preserves all existing
candidate application code, seven GLBs, seven editable native sources and
protected original game files. Only the supplementary accounting assertion,
its independent unit coverage and documentation change during this review.

The original candidate's authoring, lint, unit and production-build job passed.
The existing cockpit, venue and grid/pit browser journey jobs also passed.
Those outcomes do not turn the failed supplementary survey jobs into passes.

## Failed assertion and corrected measurement contract

All six baseline/candidate day, sunset and wet-night surveys rendered and saved
their eleven views, lamp measurements and diagnostics, then failed the new test's
`normal-cockpit` draw ceiling. That assertion reused the direct-scene 1,800-call
limit for a complete production frame. The unchanged baseline itself exceeds
that limit: `RaceRenderer.draw` includes environment updates, mirrors, shadow
passes and the compositor, whereas the ten direct inspection views each use a
single `renderer.render` call. The existing draw ledger records that distinction.

The corrected contract preserves the strict `< 1800` ceiling on every direct
inspection view. It also applies that ceiling to the cockpit compositor phase,
requires mirrors/shadows/compositor to remain present, and requires every draw
phase to sum exactly to the measured full-frame calls and triangles. A new
complete-frame regression limit allows at most **2%** additional submitted calls
and triangles relative to the pinned unchanged baseline. This is not the old
ceiling silently raised: it is a separate measured workload. The baseline,
configuration and full per-phase totals are retained in
`TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`. Unit negative controls reject
inconsistent accounting, missing required passes and overruns of either limit.
No runtime, quality preset, render resolution, timeout or retry changes are made.

| Matched complete cockpit frame | Baseline calls | Candidate calls | Baseline triangles | Candidate triangles |
|---|---:|---:|---:|---:|
| Day | 2,345 | 2,356 | 10,744,392 | 10,933,016 |
| Sunset | 3,173 | 3,215 | 12,549,162 | 12,729,078 |
| Wet night | 3,457 | 3,499 | 13,147,019 | 13,252,551 |

These are submitted workload counts for the original matched frames, **not FPS**,
not full-lap maxima and not a promise of representative-hardware performance.
Fresh workflow execution of the corrected test remains required; re-evaluating
saved measurements locally is diagnostic work, not a new browser run.

## Image and behavior review

All 66 original baseline/candidate images (eleven views under three lighting
conditions per revision) were inspected in matched pairs. The revision adds the
gantry's rear catwalk, ladder, columns and braces; profiled barrier construction;
steel guardrail hardware; catch-fence attachments; strapped impact blocks and
reused tyre stacks; closed recovery gates; and fitted marshal-post equipment.
The retained cockpit framing and original car are unchanged. The wet-night
frames remain substantially darker away from circuit floodlights, including
unlit lamp housings; this review does not certify final night-art quality.

Each inspected candidate kit produces a substantial pixel difference against its
hidden-geometry negative control. Lamp-face negative controls separately observe
all existing red-light stages, lights-out, held/replayed stages and reset. A
black, unlit housing screenshot alone is not evidence that the lamps work. The
recorded stage sequence is `[0,1,2,3,4,5,0,3,3,0]`; every required lit-face gain
exceeds the existing test threshold and every unlit-face gain stays below it.
Shader errors, source/surface-state mutation, paused pixel drift and allocation
growth checks retain their original assertions.

## Acceptance boundaries

This is an integrated asset revision, not final-art or full master-directive
approval. Normal source-commit CI and playable publication must still succeed
on the final `main` commit; staging commits are not the playable implementation.
The simulator still has no aborted-start state. Gates are closed visual assets
with future-operation pivots, not an interactive recovery system. Continuous
human-driven full-lap review, target Windows/controller hardware measurements,
Vellamar propagation and final art approval remain open.
