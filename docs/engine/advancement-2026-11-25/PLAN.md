# Engine advancement — 25 November 2026

## Starting point and scope

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679` on `main`.
Personal Context identified the preceding engine work; GitHub independently confirmed
that its final implementation commit, `9119c768`, is an ancestor of this baseline.

This programme improves the existing engine. Authored 3D models, characters,
environments, track definitions, materials, textures, vehicle specifications and
handling constants are protected. Rendering work is limited to generic runtime,
scheduling, resource management and data processing. Asset-generation hooks are
not run. The final scope check compares all changed paths with this baseline.

## Execution and acceptance

The requested sixty distinct agent assignments are organized as ten waves of six.
Three workers run alongside the coordinator, so each wave uses two batches.
The coordinator owns integration, Git commits and non-force publication to `main`.
Workers have explicit file ownership; audit and verification assignments are
identified separately from implementation work. Only actually started assignments
are counted in the execution ledger.

1. Audit runtime, networking, physics, persistence, devices and graphics infrastructure.
2. Implement the highest-impact defects and cost reductions supported by that audit.
3. Extend the engine improvements into adjacent, separately owned subsystems.
4. Complete the remaining prioritized algorithms and lifecycle repairs.
5. Verify subsystem composition and correct integration defects.
6. Exercise native browser workers, audio, input, storage and rendering lifetimes.
7. Measure the relevant costs against the actual baseline and check equivalence.
8. Independently review failure paths and repair demonstrated regressions.
9. Run consolidated engine, compiler, lint and production-build validation.
10. Complete acceptance, protected-content audit, documentation and publication checks.

Specific assignments adapt to source evidence. There is no obligation to change
correct code merely to give every worker a patch. Performance claims require
measurements, and isolated algorithm gains are not presented as game-wide FPS gains.

## Working environment

This session uses its own checkout and temporary files. The initial workspace
volume was full, so the checkout was created under a separate session directory.
No other session's files are removed or modified. Locked dependencies are installed
without lifecycle scripts. Compiler, test and bundler entry points are called
directly to preserve protected content.

## Validation

Focused regression coverage must prove a concrete defect or important invariant.
Optimizations preserve output and ordering unless an intentional engine contract
change is documented. Existing unrelated failures remain visible. Native-browser,
software-renderer and physical-hardware evidence are distinguished. No physical
hardware result is claimed from this environment.
