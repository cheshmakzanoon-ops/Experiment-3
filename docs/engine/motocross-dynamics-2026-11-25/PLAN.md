# Motocross physics and fluid animation development

## Scope and coordination

Task baseline: `b527a7e01ea247f0233a2ec4f2850639bafbd887` on `main`.
The user requests sixty distinct agent assignments in ten waves, focused on realistic motocross physics and fluid engine animation. Each wave has six assignments, scheduled in two batches of three because this workspace supports three concurrent subagents alongside the coordinator.

Work in this isolated checkout belongs to this task. Only the coordinator commits, integrates remote changes, and pushes. Every implementation assignment owns explicit files. Incoming commits are preserved by ordinary fast-forward/rebase integration; no forced updates to `main` are permitted.

Protected scope: authored assets, meshes, model construction, materials, textures, terrain/course geometry, environments, character geometry, bike geometry, other game modes, and vehicle specification tuning. Pure motion/physics controllers and the data transport required to present their results are allowed. Presentation changes operate on existing rigs. Tests may inspect models without modifying their definitions.

## Waves

| Wave | Purpose | Acceptance |
| --- | --- | --- |
| 1 | Audit dynamics, suspension, animation, input, snapshot timing and runtime verification | Concrete source evidence and reproducible priorities |
| 2 | Implement first set of independent physics/motion fixes | Focused contracts and production integration |
| 3 | Improve contact, response and transitions identified by the audits | Finite, bounded, physically coherent output |
| 4 | Verify integrated driving and implement remaining high-value corrections | Both MX classes and outdoor/stadium behavior |
| 5 | Challenge numerical and animation behavior across time steps | Energy, continuity, deterministic playback and pause/seek |
| 6 | Complete integration and correct independently reproduced issues | No detached helpers; existing consumers use the changes |
| 7 | Run scenario and browser acceptance; assess performance | Observed execution and qualified evidence |
| 8 | Independent code and regression review | Defects repaired without relaxing acceptance |
| 9 | Final stress, compatibility and protected-source review | Reproducible results on integrated source |
| 10 | Final documentation, reproduction, scope and delivery audit | Sixty completed assignments, tested commits on main |

The assignment ledger records actual agents and outcomes. These wave purposes are an initial plan and may be refined as source evidence warrants. An audit finding is not treated as a proven bug until reproduced or established directly from the code path. Numerical tests and software browser execution do not establish real-bike calibration or physical-GPU frame rate.
