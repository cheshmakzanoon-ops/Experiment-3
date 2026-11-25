# W01E — physics/query efficiency audit

Assignment 5/60, wave 1. Read-only production audit against session baseline
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`; only this report is authored.
Read `SESSION.md`, prior advancement README/ENGINE_CHANGES, W07A/W07B,
prior physics audit, current lane/surface implementations and relevant tests.
No authored content, handling, protected files, dependencies or Git state changed.

## Recommended work

| Priority | Concrete change | Caller-backed reason | Required acceptance |
| --- | --- | --- | --- |
| P1 | Preserve bounded insertion-order eviction with a FIFO key ring | Every paved `Track.nearest` miss after 2,048 resident cells restarts a Map iterator at its oldest slot | Exact candidates, nearest fields and eviction order; bounded memory; paired cold/warm and real Simulation measurements |
| P1 | Skip redundant per-cell matrix-signature refresh for the known frozen default parameter object | `Track` passes `SURFACE_THERMAL` to both solvers; `prepare()` already refreshes dt/air/signature before every cell loop | Exact thermal/water outputs and mutable-parameter invalidation; clear/rain/storm/variable-dt comparisons |

These improve overhead of the existing algorithms. They do not re-propose the
already completed lane cache, surface coefficient banks or BVH/OBB changes.

## 1. Lane eviction restarts an iterator on every miss

`src/simulation/track-lane-index.ts:candidates` currently evicts with
`this.cells.delete(this.cells.keys().next().value!)`. A fresh iterator starts
at the beginning of the Map on every eviction; V8 may traverse deleted slots
before finding the oldest live entry. The cache intentionally uses FIFO,
so a fixed array of resident keys and a circular cursor preserves its policy.
The existing Map remains the lookup owner; geometry construction, witness,
height fallback, candidate order and nearest arithmetic remain untouched.

Actual callers are `Track.nearest` (`track.ts`), `Vehicle.step`/placement
(`vehicle.ts`), contact ownership (`contact.ts`), four chassis corners
(`collision.ts`) and `Simulation.step` (`world.ts`). The prior W07A
4,096-cell stream was 2.19–2.67 times slower than coarse-only queries.
Reducing eviction cost addresses a specific part of that penalty without
introducing an unproved cache-admission policy or increasing the 2,048 cap.

### Executed exploratory probe

A temporary transformed copy of the actual index replaced only eviction for
capacity 2,048. Two passes over 4,096 deterministic shuffled Aurel hash cells
compared actual `Track.nearest`: **8,192 queries / 106,496 exact scalar
comparisons** passed with `Object.is`; final Map key order also matched.
The copied candidate filter, witness and all nearest operations were unchanged.

| Scope, four alternating AB/BA pairs | Original ms | FIFO ms | FIFO/original |
| --- | --- | --- | --- |
| Actual nearest, 32,768 all-miss queries | 121.341 / 93.617 / 156.542 / 86.206 | 118.971 / 64.674 / 129.418 / 99.718 | 0.980 / 0.691 / 0.827 / 1.157 |
| Actual nearest, 32,768 warm queries | 17.165 / 18.124 / 20.908 / 18.698 | 29.728 / 17.529 / 16.655 / 18.591 | 1.732 / 0.967 / 0.797 / 0.994 |
| Isolated 65,536 evictions, 2,048 capacity | 52.818 / 39.461 / 52.714 / 54.507 | 4.044 / 5.271 / 5.155 / 4.313 | 0.077 / 0.134 / 0.098 / 0.079 |

These were short shared-host probes, **not reserved performance acceptance**.
Actual nearest samples overlap and include regressions; no whole-query speedup
is established. The isolated comparison consistently identifies eviction as
avoidable cost, but cannot be substituted for the caller's full workload.
No result claims a game-wide or browser improvement.

Implementation should initialize ring bookkeeping only for supported bounded
capacities and keep the existing unbounded path. Add no LRU hit updates.
For nonpositive/fractional/nonfinite capacity values, either retain the exact
existing fallback or prove compatible behavior; the constructor currently
accepts them. Added storage is at most capacity key references plus a cursor,
not duplicated geometry or new strings; measure the actual retention tradeoff.
Acceptance: repeated eviction/revisit, capacities 1/2/2,048/Infinity, same-cell
hits, negative grid boundaries, bank/bridge layers, complete output fields,
and existing `engine-paved-lane-index`/road-contact ownership tests.
Record real Simulation miss/eviction counts before claiming representative gain.

## 2. Frozen default thermal parameters need one refresh per prepare

`SurfaceThermalStep.prepare()` always calls `refreshMatrixInputs()`.
On every differing rainfall, `prepareMatrix()` calls it again, comparing dt,
air and four matrix parameters. The default `SURFACE_THERMAL` object is frozen;
`Track` uses it for exposed and covered solvers, and dt/air only change in
`prepare()`. Its repeated per-cell checks can therefore be omitted safely.
Keep the existing check for all caller-supplied parameter objects, including
mutable objects retained behind the Readonly API. A narrow identity guard,
`if (this.parameters !== SURFACE_THERMAL) this.refreshMatrixInputs()`, avoids
new public APIs, persistent cache epochs and changes to mutable contracts.

Actual operation counts from four `Track.evolve(0.5, time)` updates:

| Preset | Cells updated | Matrix requests | Signature refresh calls | `log1p` calls |
| --- | ---: | ---: | ---: | ---: |
| Clear | 14,336 | 14,344 | 10 | 14,336 |
| Rain | 14,336 | 14,344 | 14,349 | 0 |
| Storm | 14,336 | 14,344 | 14,349 | 0 |

For default solvers the proposed guard leaves eight signature refreshes at
`prepare()` boundaries over four ticks. It changes neither coefficient
calculation nor cache fill/read order, and retains current ambient, solar,
vapour, exposure, rainfall, water-bank and parameter validation behavior.
A transformed actual-source solver with that single guard matched **1,536
columns / 6,144 Float64 outputs exactly** across changing rain, wind, ambient,
cloud, actual dt values 0.5/0.25/1/0.125, zero water and tiny drainage.
This is correctness evidence for the frozen branch, not a measured speed claim.

Acceptance should extend `engine-surface-coefficients` and `surface-thermal`
with mid-prepare mutable parameter edits while rainfall changes; retain
current same-rain fast-path semantics. Compare actual full surface arrays
and complete Simulation outputs, not merely rounded thermal numbers.
Measure clear, first rainy tick, steady rain, evolving storm and direct
variable-dt costs. `Track.evolve` itself uses fixed 0.5-second steps: W07B's
variable-dt penalty is a direct-solver workload, not ordinary Track cadence.

## Scope and reproduction limits

Temporary probes: `tmp/w01e-probe.mjs` and `tmp/w01e-thermal-probe.mjs` under
the session root; run with `node --no-warnings --experimental-transform-types`.
No production edit, dependency operation, full test suite, build or browser
run occurred. Cache bank write bypasses, wider admission schemes and dry-film
shortcuts are deferred: the two findings above already have specific callers,
exact witnesses and bounded implementation scope.
