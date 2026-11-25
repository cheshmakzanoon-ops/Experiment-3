# Published engine checkpoints

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`.
The coordinator publishes completed, reviewed file sets to `main` with a
fast-forward lease. Concurrent CI documentation commits are preserved.

## Audit and ownership plan

`e7e443ae06ba04020e07e8a8d980e4e1304a433c` records the baseline, six audits,
protected scope and actual assignment ledger. This is documentation, not a
production performance change.

## Startup ownership and remote presentation

`6c96144dad0b2171ea15116ad97c79fbe6fb7f09` prevents simultaneous circuit and
Festival startup ownership and separates the remote presentation clock from
authoritative network timing. Implementation evidence is in `w02d-startup.md`
and `w02b-network-clock.md`.

The [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45557220386)
completed successfully at this exact commit: focused units, full TypeScript
checking, production build, native browser contracts and replay ownership.
Its browser backend is Mesa software graphics. This does not certify a physical
GPU, controller or audio device, or assert that every unrelated workflow passed.

## Exact work reuse

`b594cfc762338c8a6766d8a6243b41e34e17a35a` publishes paved lane query indexing,
surface coefficient reuse, shared snapshot serialization and audio filter math
reuse. The four new suites passed together: 44 tests, zero failures. Scoped
ESLint passed. A full TypeScript check passed with a 4 GiB Node heap. Individual
notes retain the broader existing regressions and actual baseline comparisons.

The lane work reduces candidate checks; surface and audio changes reduce repeated
arithmetic; snapshot batching reduces repeated scalar serialization. These are
operation-count results until the separate timing wave runs. New retained surface
arrays cost 280 KiB per Track; multi-recipient snapshots add three temporary
backing buffers per boundary. These costs remain part of performance acceptance.

Its [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45558489932)
completed successfully at this exact commit, including focused units,
TypeScript, production build, native browser contracts and replay ownership.
The artifact verifies **579 unit tests in 48 files** and **37 browser/replay
tests**. The browser backend remains Mesa software graphics. Source identity,
backend identity, full sanitized logs and the archive digest are retained under
`evidence/checkpoint-b594cfc/`.
