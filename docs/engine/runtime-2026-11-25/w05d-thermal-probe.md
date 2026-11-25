# W05D — reproducible actual-baseline thermal probe

Assignment 28/60, wave 5. Adds
`scripts/engine-runtime-probes/thermal-probe.mjs` and this report. Production
code, fixtures, dependencies, protected paths, commits and refs are outside
this assignment.

## Status and comparator

The persistent probe has been authored against candidate
`b3b8ec09183734287b71406f8894d07c91eb48c9` and the shared probe helper.
**Runtime verification is pending hosted CI.** This authoring environment has
no local checkout/executor; no local probe, test, compiler or timing run is
claimed. The numbers below describe assertions that a successful run must
satisfy, rather than a newly observed run.

The baseline is the actual Git object at
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc:src/simulation/surface-thermal.ts`.
The shared `variants()` helper obtains its bytes with `git show` and bundles
the same entry twice with esbuild. Only that production module is replaced
in the baseline bundle. Track, weather, circuits and all other dependencies
come from the candidate checkout in both bundles. Separate bundle instances
retain each thermal module's own frozen `SURFACE_THERMAL` object.

There is no copied reference solver or copied historical method in this
probe. Both variants execute their actual complete thermal modules, including
the historical signature refresh path. The resulting claim is about the
thermal change under shared candidate callers; it is not a whole-repository
baseline comparison.

The emitted JSON includes the helper's pinned baseline commit, candidate
HEAD, tracked-change status and its scope, source SHA-256 digests and byte
counts, bundle digests, entry digest, Node version and esbuild version.
Candidate working-tree bytes are the actual candidate input. The helper
checks that declared target bytes, HEAD and scoped tracked status stay
unchanged during bundling; it explicitly excludes untracked files from its
status claim.

## Exact-output coverage

Output comparisons run before any operation-count instrumentation.

| Workload | Required successful comparison |
| --- | --- |
| Frozen default solver | 12 preparations, 128 slots, two passes per preparation and one standalone `advance()` after each preparation: 3,084 columns / 12,336 finite, `Object.is`-exact scalar comparisons |
| Actual wet slot reuse | 896 second-pass wet visits must already have the matching cached slot and a different active rainfall, so these visits exercise matrix-slot restoration rather than only the same-rain early return |
| Mutable caller parameters | Each of surface capacity, substrate capacity, conduction and deep conductance is changed after preparation: 20 columns / 80 exact scalar comparisons |
| Actual Aurel Track | Initial states and all six complete surface arrays match; after four 0.5-second updates for each of clear, rain and storm, compare 1,032,192 bytes and 132 exact weather/clock scalars |

The four direct solver outputs are surface temperature, substrate temperature,
water and evaporated water. The deterministic sequence changes rain, ambient
temperature, cloud, wind, exposure and timestep (0.5, 0.25, 1 and 0.125 seconds).
It includes dry film, near-zero drainage, traffic heat and restoration of the
prepared rainfall after local cell rainfall. Each variant has its own water
coefficient bank; those dependencies use the same candidate implementation.

For mutable parameters, two slots are populated before the edit. A same-rain
call must preserve all four previous outputs. A changed-rain call must notice
the edit and invalidate the other cached slot; revisiting that slot must
produce the exact actual-baseline outputs with the changed parameter.
These are supplementary contract checks in addition to the historical-module
comparison.

Track arrays are `temperature`, `substrateTemperature`, `water`, `rubber`,
`marbles` and `frozen`. Every Float32 value must be finite, and byte comparison
includes each entire typed-array view. Weather/clock fields are `ambient`,
`cloud`, `rain`, `windX`, `windZ`, `visibility`, `dust`, `gust`,
`moisture`, `fogCover` and `surfaceClock`. The byte and scalar totals
reported above count post-update comparisons only; the additional initial
state checks are explicitly identified in JSON.

## Separate signature-count pass

Fresh solver and Track instances repeat the workloads with wrappers around
the real prototype methods. Every original property descriptor is restored
in a `finally` block. The measured method is the TypeScript-private
`refreshMatrixInputs()`; preparation, matrix-request, wet-advance and
standalone-advance calls are also counted to assert the workload actually ran.

The Track counter window begins after construction and includes exactly four
updates. Each variant must issue 8 exposure preparations, 14,336 wet cell
advances and 14,344 matrix requests for each preset.

| Preset | Historical refresh assertion | Candidate refresh assertion |
| --- | ---: | ---: |
| Clear | 10 | 8 |
| Rain | 14,349 | 8 |
| Storm | 14,349 | 8 |

These reproduce the count targets documented in
[W03E](./w03e-thermal-signature.md). They become measured evidence for this
persistent probe only when the runtime assertions pass. Successful JSON
contains the observed counter values; an unexpected count throws before the
success record is printed. The default direct sequence must refresh exactly
12 times in the candidate and more often in the historical module. Both
mutable sequences must have identical complete method counters, including
24 refreshes, retaining the caller-owned parameter behavior.

## Reproduction and failure behavior

With the repository's normal dependencies installed, run from the checkout:

```sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
node scripts/engine-runtime-probes/thermal-probe.mjs
```

Root owns the hosted baseline fetch and fail-fast probe invocation. The
probe requires the pinned baseline commit to be present; a missing object,
bundling error, output mismatch, missing instrumented method or unexpected
operation count fails with a nonzero process exit. It prints one JSON object
only after all comparisons and counter assertions succeed.

The workload is bounded: two in-memory bundles, 12 preparations over 128
direct slots, four mutable-parameter cases, and four Track ticks per preset
in each of the output and count passes. There is no timing loop, warmup,
random input or requested additional dependency. Host runtime has not been
measured here.

Limits remain narrow: no full Simulation comparison, long-run state claim,
cold-preset Track comparison, browser/native run or elapsed-time/FPS claim.
Variable dt and mid-prepare parameter changes are direct-solver coverage.
The probe changes no production arithmetic, weather data, tuning or cache
implementation.
