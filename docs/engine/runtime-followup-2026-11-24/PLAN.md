# Engine runtime follow-up — 24 November 2026

## Scope

Develop the underlying engine on `main`, preserving authored 3D models, character assets, environments, geometry, materials, textures and vehicle tuning. Generic collision construction may change only with exact-output comparisons. Rendering edits are restricted to resource ownership, scheduling and texture budget infrastructure; no authored visual definitions change.

Starting revision: `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.

Previous engine work was recovered through Personal Context and then checked against the current repository. This programme addresses new defects and remaining costs; prior-session evidence is not presented as verification of these changes.

## Execution

The user requested sixty agents in ten waves of six. Three worker slots are available alongside the coordinator, so assignments use successive groups of up to three. Independent preparation or review from the next wave may overlap the end of a preceding wave; performance measurements retain exclusive compute ownership. The coordinator owns integration, commits, pushes and shared-file reconciliation. Agent tasks use explicit file ownership; completed reports are collected into the final ledger.

## Priorities found in the initial audit

| Area | Observed defect or repeated work | Intended behavior |
| --- | --- | --- |
| Telemetry | Flashback uses a session-time cutoff against race-time rows | Truncate the discarded timeline using the correct clock |
| Telemetry | Snapshot export copies a ring one row at a time | Copy the same chronological buffer in at most two spans |
| Ghosts | Unusable laps accumulate samples and can emit invalid recordings | Bound capture to the format's existing valid duration and sample limits |
| Network input | A shift is reapplied as a level during command duration/loss | Apply discrete shifts once, with deterministic journal replay |
| Network ownership | A peer close exception can interrupt AI takeover | Retire ownership and isolate peer transport failure |
| Network snapshots | Every recipient recaptures every vehicle | Share field capture while preserving recipient-specific packet bytes |
| Physics startup | Temporary arrays and repeated array-bound operations | Preserve all generated values with less allocation and repeated work |
| Input | Key pulses collapse before reaching the worker queue | Retain ordered discrete intent through the host boundary |
| Audio/haptics | Preview/haptic work can outlive mute or pause | Cancel owned activity at the lifecycle transition |
| Rendering resources | Festival leaves exclusive shadow/sky/output resources alive | Dispose exclusive resources without destroying the borrowed renderer |
| Texture budgeting | Shared wrappers repeatedly repaint and invalidate the group | Initialize shared storage once and update new wrappers linearly |
| Runtime | Cleanup/command/startup errors can leave partial ownership | Settle transitions and retain the original error consistently |

## Verification policy

Use direct compiler, Vitest and Vite entry points so asset-generation hooks cannot modify protected content. Add focused regression coverage for concrete defects. Verify optimization output equivalence and operation counts; report environment-specific timing separately. Run browser and integrated engine checks where resources permit, retaining failures and limitations. Existing unrelated content failures are not hidden by editing authored content or weakening assertions.

Every final claim must distinguish locally executed evidence, published CI evidence, controlled kernel measurements and unverified behavior. No overall FPS or physical-device performance gain is inferred from a microbenchmark.
