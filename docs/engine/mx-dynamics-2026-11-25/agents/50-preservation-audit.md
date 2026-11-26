# Assignment 50 — Exact preservation boundaries

**Pass on source fingerprint
`a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0`.**
This is the candidate before assignment 49's wet-race investigation; it is
not evidence for an unidentified later revision. No runtime, test, asset,
baseline, dependency, Git index, commit, or branch was changed by this audit.

The [machine-readable receipt](../evidence/50-preservation-audit.json)
records complete comparison refs, changed paths, Git modes/blob IDs,
manifest digests, sparse-checkout accounting, and the five snapshot results.

## Separate this task from incoming main development

| Reference | Role |
| --- | --- |
| `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` | Initial task baseline, simulation 39 |
| `39d9d497880e92801a7d77de6af2639b4186bfcc` | Incoming engine pass, simulation 40 |
| `c9c94c7029dbc3e29b18101ef7ccea0a897184d1` | Integrated main including later reports; runtime equals `39d9d497` |
| `b2879248fbce047a299c45b84476adbcc3dbc71f` | Local audited checkpoint, simulation 41 |

The incoming pass changed **18 runtime paths** from the initial baseline.
This task changes **nine runtime files** relative to integrated main:

| Runtime file | Scope |
| --- | --- |
| `src/core/session-identity.ts` | Simulation identity |
| `src/rendering/wheel-pose.ts` | Wheel phase/rate interpolation |
| `src/simulation/bike-vehicle.ts` | Recovery motion and handoff |
| `src/simulation/bike.ts` | Explicit actuator aid budgets |
| `src/simulation/offroad/ai.ts` | Jump approach and settling decisions |
| `src/simulation/offroad/contact-impulse.ts` | Coupled unilateral constraints |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | Player MX integration and state transport |
| `src/simulation/offroad/mx-ground-physics.ts` | Tyre contact, gravity and work budgets |
| `src/simulation/offroad/session.ts` | Consistent physical gate placement |

All other task changes are confined to tests, benchmark scripts, and this
task's engineering report directory. The audit compared full Git trees,
including files not materialized by sparse checkout; it did not infer
preservation from an empty filtered working-directory listing.

## Protected files

| Boundary | Files | Task differences from integrated main |
| --- | ---: | ---: |
| Runtime source outside the nine files | 1,117 | 0 |
| Rendering source except `wheel-pose.ts` | 714 | 0 |
| Authored asset/reference roots | 291 | 0 |
| Explicit course, terrain, bike-definition and jump-target sources | 11 | 0 |
| Build/dependency/runtime configuration | 9 | 0 |
| All tracked paths outside the allowed task scope | 9,524 | 0 |

These rows overlap and must not be added together. The 291 asset/reference
files are also unchanged from the **initial** baseline. The protected roots
include `public`, `assets`, `authoring`, `reference`, `playable`,
`lookdev-tmp`, `screenshots`, and `scratch-tmp`. No untracked or ignored
files exist in these roots or `src` at the audit boundary.

For the union of runtime outside the nine files, authored assets/reference
roots, and configuration, **1,381 materialized files** were read and their
Git blob IDs and executable/symlink modes recomputed independently. Every
one matches the candidate tree and integrated main. Another **36 files**
are intentionally absent and carry Git's `skip-worktree` flag; their
unchanged complete-tree entries supply their preservation evidence.
There are no unexpected missing files or content/mode mismatches.

The seven rendering files changed upstream, and the additional upstream
motion helpers, are recorded separately in the receipt. This audit does
not misattribute that incoming work to the nine files changed by this task.

## Protocol and immutable non-MX evidence

`src/simulation/protocol.ts` is byte-identical to incoming engine main
(Git blob `ef3f361fbb429905c871fa3dba5d0a627eaccdc9`). Protocol **17**, header
**24 floats**, and entrant stride **331 floats** remain unchanged. Compared
with the initial baseline, the upstream pass introduced optional posture
and foot-trajectory fields inside the existing zero-mask contact tail;
this task makes no protocol-file change.

The original preservation runner passed without edits:

```sh
node --max-old-space-size=384 --experimental-transform-types \
  scripts/bench/mx-dynamics-preservation.ts \
  --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

| Selected discipline / vehicle | Full snapshots | Baseline match |
| --- | ---: | --- |
| Formula / `apx01` | 1,201 | Exact bytes |
| GP motorcycle / `gpr1` | 1,201 | Exact bytes |
| Road superbike / `sbk1000` | 1,201 | Exact bytes |
| Supermoto / `sm450` | 1,201 | Exact bytes |
| Rallycross / `rcx6` | 1,201 | Exact bytes |

Each case runs one scripted player and one seeded AI opponent on clear
Aurel for ten seconds at 120 Hz, including the initial snapshot. Every
686-float snapshot contributes all its bytes to the case digest: **6,005
snapshots and 16,477,720 bytes** in total, with **55 additional checkpoint
digests** compared. Options, inputs, snapshot sizes/counts, identities and
record categories also match; only the deliberate simulation/category
version **39 → 41** is normalized. There are **zero mismatches**.

The runner SHA-256 remains
`b9bb64bb3bf0c3f33aaae2c1b894b3d783f496627881595b289d45fd6f1f0417`;
the immutable baseline file SHA-256 remains
`f719ad80a6dccd33d33e7f7625d2d9f2f98c4124f9d8c079f8210b5c7044ba5c`.
The receipt includes every complete case digest and workload identity.

This proves exact preservation for the five executed workloads and exact
file preservation at the stated boundaries. It does not establish
equivalence for every possible non-MX setup, input history, or track, and
it makes no browser, GPU, or physical-device performance claim.
