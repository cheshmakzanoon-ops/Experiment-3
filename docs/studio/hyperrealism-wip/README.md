# Round-3 patch archive

Status corrected 2026-11-18 against `main`. The three patch files were saved when work
stopped on November 5; they are historical diffs against `812b933`, not a queue of three
unapplied features. Applying them wholesale would also replay old binary captures.

| Section | Current main status | What to do with the archive |
| --- | --- | --- |
| Formula / shared pipeline | Heat haze and soft-particle depth support merged as code in `dfb00ca` | Inspect the current runtime and captures; no saved patch to apply |
| MotoGP | Round 3 landed November 11 in `25c3f306bfe231aef448a98fbc2cdc59e6499914` | Keep `motogp-round3.patch` as history; do not reapply its material/type/panel changes |
| Motocross / Supercross | Round 3 landed November 11 in `1bffdae9af25ede0c155a2b68dc13a260c411e86` | Keep `motocross-round3.patch` as history; do not reapply its soil, meadow, lighting or spectator changes |
| Open world | Broad Round 3 art patch remains incomplete and unapplied | Review individual changes against current code before integrating; remove `OW-DEBUG`, `__owDbg` and `__owMorphOff` capture hooks and obtain current visual/functional evidence |

The unapplied open-world patch proposes a dedicated grass field, roadside furniture,
sea horizon, terrain geomorphing/worker changes, shared noise, and changes to coastal
water, roads and car finishes. Those features are not established shipped capabilities,
and their absence alone is not proof of a recent regression. Current focused Festival
shadow, exposure and frame-pipeline repairs are separate from this unfinished art pass.

The old GP/MX compilation and wiring problems in the November 5 handover described why
those diffs were saved then. They are not outstanding instructions for today's `main`.
Use [CURRENT_STATUS.md](../../CURRENT_STATUS.md), [EXECUTION_PLAN.md](../EXECUTION_PLAN.md)
and current source/tests for remaining work. No PS5/UE5 visual parity or real-GPU performance
has been certified by preserving or landing a patch.
