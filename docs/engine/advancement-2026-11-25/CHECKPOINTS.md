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

## Runtime ownership, records and composed input

`955bc20f98fa1397ce1e41cd877c78c41a42cab5` publishes the completed third and
fourth implementation waves and four completed integration assignments. It
includes shared GPU completion leases, Festival frame admission and idle pacing,
retained-page suspension, UI/input teardown, credits and menu polling ownership,
bounded dirty-range unions, unsupported flashback journal elimination, ghost
first-passage lookup, telemetry closing-gap validation, audio sine-basis reuse,
and exact input-packet capacity.

The coordinator's frozen local checkpoint passed **793 tests in 58 files**.
Subsequent focused composition groups passed independently, including the final
**83 device/menu/page tests**. The actual-source network composition proof retains
2,292 equal datagrams and 278,730 equal packet bytes, with the intended remote
clock correction excluded from byte-equivalence claims. These are not timing or
physical-device results.

The [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45568546604)
completed successfully at this exact commit: **813 tests in 62 files**, full
TypeScript checking, production build, and **37 native browser/replay cases**.
The backend is WebGL2 through ANGLE/Mesa llvmpipe software graphics; the backend
probe reports no GL error and explicitly does not validate physical hardware.
Source identity, sanitized full logs, backend identity and the artifact digest
are retained under `evidence/checkpoint-955bc20/`. The newly authored wave-6
fixtures were not included in this checkpoint and require their own CI run.
