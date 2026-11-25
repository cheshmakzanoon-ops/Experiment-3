# W06B — Preserve engineering diagnostics through flashback

Assignment **32/60**, wave 6. Repository: `cheshmakzanoon-ops/Experiment-3`.
Implementation baseline: `b3b8ec09183734287b71406f8894d07c91eb48c9`.

## Result

A successful circuit flashback now rebases engineering inspection without
changing the latest user enable state. The first eligible publication on the
restored timeline no longer needs an extra engineering-enable message from the
host. Fresh session initialization still disables inspection.

This repairs the source-confirmed caller mismatch recorded in W04F audit blob
`68d7bf3b6e9ba3dc15c835de87ea8ad5f59b7a92`, read directly through GitHub's Git
blob endpoint. Before this change,
[`finishFlashback`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/b3b8ec09183734287b71406f8894d07c91eb48c9/src/workers/physics.worker.ts)
called `engineeringChannel.reset()`; the
[`EngineeringProbe.reset`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/b3b8ec09183734287b71406f8894d07c91eb48c9/src/workers/diagnostics.ts)
implementation set `enabled = false`. The actual host completion/resume path
does not resend the enable message while its debug selection remains enabled.

## Changes

| File | Exact scope |
| --- | --- |
| `src/workers/diagnostics.ts` | Add `EngineeringProbe.rebase()`, which resets only `lastTick`; reuse it from existing reset and toggle operations. Add `EngineeringChannel.rebase()`, which advances epoch and rebases the probe. |
| `src/workers/physics.worker.ts` | Replace the single `engineeringChannel.reset()` call inside `finishFlashback` with `rebase()`. Keep the init reset unchanged. |
| `tests/engine-flashback-diagnostics-state.test.ts` | Add seven actual-worker cases covering enabled, disabled, held-credit, cadence, during-rewind toggles, and fresh-init behavior. |
| `tests/engine-diagnostics-backpressure.test.ts` | Revise only the existing flashback test that expected the broken disable behavior and sent an unrealistic extra enable. Preserve every byte outside that named test, including the mx450 tests. |
| This report | Record the repair, ownership checks, regression coverage, and execution boundary. |

The coordinator explicitly expanded the original four-file assignment to
authorize the single existing-test revision. Without that correction the old
test would continue requiring the proven host/worker mismatch.

The rebase API keeps the current enable flag at completion; it does not snapshot
the flag when rewind starts. Therefore a debug toggle received while the
resimulation is pending remains authoritative. Both enabled and disabled states
survive the same-session rebase.

Neither rebase method clears the outstanding delivery ticket or resets sequence.
An old packet continues occupying the sole engineering credit. Its original
epoch/sequence ACK remains valid after rebase, and a duplicate old ACK cannot
retire the subsequent packet. Resetting cadence makes earlier restored ticks
eligible without waiting for the abandoned timeline's last sampled tick; the
existing twelve-tick cadence then applies.

## Regression coverage

The new fixture imports the production physics worker once and initializes each
case through its public messages. It controls the clock/timer seam, uses real
simulation and resimulation code, and transfers worker output through
`structuredClone`. It does not substitute an implementation of the channel,
probe, worker message handler, or rewind job.

- **Enabled with free credit:** sample at tick 36, pause and rewind to tick 12,
  resume with no second enable, and receive tick 13 in the next epoch. No sample
  appears before twelve further physics ticks.
- **Enabled with held credit:** keep the tick-36 packet across rewind and resumed
  physics. Forged receipts do not release it. Its one valid ACK produces the
  current tick-24 sample with incremented epoch and sequence. A duplicate old
  ACK and a receipt combining the new epoch with the old sequence cannot free
  the new credit. The saved old payload remains unchanged.
- **Disabled controls:** both never-enabled and explicitly disabled sessions
  remain disabled through rewind, old receipt retirement, and resumed ticks.
- **Toggles during rewind:** disabled-to-enabled and enabled-to-disabled messages
  delivered after the request but before completion keep their latest state.
- **Fresh init:** an enabled prior session becomes disabled, including after an
  old outstanding receipt is retired. A deliberate new-session enable restores
  inspection without reusing sequence.

Both positive flashback cases assert that the entire host message trace contains
exactly one engineering-enable message. Completion also checks the real
`flashback → surface → frame` publication order and matching frame tick.

## Ownership and verification status

Before creating the candidate, current main was read at
`ebd1e3fba64f80c5f08afb8523014961d4c5e184`. Its three existing owned files matched
the baseline blobs exactly:

| File | Baseline and current-main blob |
| --- | --- |
| `src/workers/diagnostics.ts` | `89751668241e7b82d954b073228cff0e76a07685` |
| `src/workers/physics.worker.ts` | `92b1ac16b442e712aca9c03992f421514937db35` |
| `tests/engine-diagnostics-backpressure.test.ts` | `b8abae54a3c13058ae94197938164cb7a3cd3236` |

The new test and report paths were absent from that complete current-main tree.
Static comparison confirmed that the existing diagnostics test file is
byte-identical outside its authorized flashback case.

**Execution is pending coordinator CI.** No local shell, test suite, type check,
build, or browser/native-worker measurement was run in this assignment.
Recommended focused CI coverage is:

```sh
npx vitest run tests/engine-flashback-diagnostics-state.test.ts tests/engine-diagnostics-backpressure.test.ts tests/engineering.test.ts
npx tsc --noEmit
```

The candidate consists of exactly the five files above in an unreferenced tree
created without a base tree. It changes no branch or commit. Protected rendering,
assets, environment, main-thread code, protocol layout, authored tuning, and
offroad implementation remain outside this candidate.
