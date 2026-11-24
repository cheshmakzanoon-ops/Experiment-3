# Engine continuation — 24 November 2026

## Purpose and scope

This is a new engine-only development programme starting from `5edead7a44c8ccb5a187b22b750ce2bda7715128`, after the earlier programme documented in the parent directory.

The user requested 60 distinct agents across ten waves, implementation of substantial improvements to the underlying engine, and commits directly to main. Three agents run concurrently, so each six-agent wave has two execution batches.

No 3D models, character models, authored environments, textures, materials, tracks, vehicle catalogue tuning, or asset-generation output may be modified. Work is confined to engine algorithms, runtime coordination, transport, storage, input/audio infrastructure, tests, and engineering documentation. Algorithmic contact/query improvements must preserve ordinary simulation results unless an explicitly documented defect requires a correction.

## Working method

1. Audit the existing implementation and its previous validation before selecting changes.
2. Give every agent a concrete, separate assignment and file ownership.
3. Reproduce meaningful faults or measure hot-path costs before changing production behaviour.
4. Retain focused regression evidence and review integrations between circuit and festival runtimes.
5. Commit validated batches to main without rewriting remote history.
6. Independently audit changes against the original tree to establish that protected content is identical.

## Ten-wave programme

| Wave | Agents | Focus | Status |
|---|---|---|---|
| 1 | 01–06 | Remaining defects and performance opportunities across the shared engine | In progress |
| 2 | 07–12 | Implement the highest-priority runtime and data-transport findings | Pending audit |
| 3 | 13–18 | Simulation queries and deterministic hot-path improvements | Pending audit |
| 4 | 19–24 | Replay, telemetry, persistence and long-session memory | Pending audit |
| 5 | 25–30 | Network interpolation, codecs and bounded work | Pending audit |
| 6 | 31–36 | Input, audio and shared resource lifecycle | Pending audit |
| 7 | 37–42 | Cross-subsystem integration and regression repairs | Pending |
| 8 | 43–48 | Reproducible performance and deterministic comparisons | Pending |
| 9 | 49–54 | Independent adversarial reviews and targeted corrections | Pending |
| 10 | 55–60 | Final validation, scope audit and publication verification | Pending |

Wave scopes will be narrowed to evidence from the initial audit; assignments are not claims of changes already made.

## Validation and limitations

The repository was sparsely checked out in an isolated workspace because the disk-backed workspace has little free capacity. Source, tests and tools are available. Large authored assets are intentionally absent. Dependencies use the committed lockfile and are installed with lifecycle scripts disabled, preventing asset regeneration.

The preceding programme reports four pre-existing broad-suite failures. Those historical results are not new validation for this continuation. New results will be recorded against the actual changed source, and asset-dependent validation will be distinguished from tests runnable in this workspace.

## Results

Implementation and validation results will be added as each wave completes. See [the task ledger](TASKS.md) for the actual agent record.

