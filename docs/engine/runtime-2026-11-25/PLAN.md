# Engine runtime development — 25 November 2026

Starting commit: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. Previous engine handoff: `c803ac92`.

## Scope and ownership

This work is restricted to game-engine code. Models, characters, animation, environment content, authored assets and rendering files are protected. The current animation work on `main` is preserved. A separate checkout, explicit file ownership, and non-forced publication keep independent sessions from overwriting each other.

## Ten waves

Each wave comprises six distinct agent assignments, executed in two batches because three concurrent worker slots are available. Assignments and completion evidence are recorded in AGENTS.json.

1. Audit remaining engine issues and prioritize production fixes.
2. Implement runtime, worker, and persistence fixes.
3. Implement network and device fixes.
4. Improve simulation queries and hot paths.
5. Integrate recording, replay, and resource lifecycles.
6. Address remaining engine performance and correctness findings.
7. Exercise actual runtime composition and targeted browser paths.
8. Review changes independently and resolve concrete findings.
9. Validate integrated code, measured costs, and content protection.
10. Complete acceptance, concurrent publication, and the next-agent handoff.

The details of each wave follow verified findings rather than a predetermined count of edits.
