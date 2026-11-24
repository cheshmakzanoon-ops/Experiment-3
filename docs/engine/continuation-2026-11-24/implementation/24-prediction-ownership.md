# Agent 24 — local prediction state ownership

Date: 2026-11-24. Wave 4. Scope: predictor retention and public read boundaries.

## Outcome

`LocalCarPredictor` now owns incoming authoritative values and returns detached authoritative and predicted snapshots. A consumer cannot rewrite retained history through a queried pose, alter the retained HUD state by reusing a decoded input object, or mutate the authoritative wrapper's tick. This repairs the audit's fabricated reconciliation-error case.

Current ordinary repository consumers were not observed mutating these objects. This is an integration ownership defect, not evidence of spontaneous wire corruption or a measured gameplay performance improvement.

Changed only:

- `src/net/prediction.ts` — ownership helper, accepted-input copy and detached getters; agent 19's metric windows remain intact.
- `tests/prediction-state-ownership.test.ts` — 22 focused ownership regressions.

No response-model arithmetic, smoothing, history horizon, options, wire format, physics, models, characters, authored environments, sound profiles, dependencies, Git commits or refs were changed.

## Ownership contract

After the existing stale-tick rejection, reconciliation copies all 26 scalar `CarNetState` fields into one owned object. The copy includes inherited/non-enumerable accessor-backed contract fields and excludes unrelated producer metadata. Every field is read once before any predictor metric, history, model or input callback is touched. A throwing property read leaves the preceding predictor state intact; an ignored stale snapshot is never read or copied.

The owned object is retained by `lastAuth`. `authoritative` returns a new wrapper and a new complete scalar-state copy, preserving `null` before an accepted authority. `predictedAt` returns a new seven-field pose or `undefined` when the requested tick is absent. The internal `history` and `shown` maps can continue sharing their privately owned pose, so no additional copy enters prediction's per-tick loop. Existing rendered poses were already detached and retain that behavior.

The cost is one state object per accepted authority, one wrapper/state pair per explicit authoritative read, and one pose per successful explicit predicted-history read. No performance improvement is claimed. Raw scalar copying preserves negative zero and diagnostic non-finite HUD values; wire validation remains upstream.

## Focused verification

**47/47 tests passed across three suites.**

| Suite | Passed |
|---|---:|
| `prediction-state-ownership.test.ts` | 22 |
| `net-prediction.test.ts` | 8 |
| `network-metric-retention.test.ts` | 17 |

The new cases cover the audited false reconciliation error; mutation of every returned pose/state field; independent wrappers and repeated reads; retained old snapshots during producer reuse; all 26 inherited getters read once; unrelated metadata exclusion; producer mutation from an input callback; stale/duplicate snapshots with throwing producers; late property failures before and after initial authority; subsequent recovery; empty/pruned/out-of-horizon results; detached render output; and a 128-reconciliation trajectory mixing ordinary, contact and AI states with deliberately damaged public views.

The existing prediction suite includes the actual four-client, ten-second online slice at 100 ms RTT and 2% loss. Its unchanged accuracy, smoothing, delivery and bandwidth thresholds passed. The metric suite preserves agent 19's collector and real-client retention checks.

Commands:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/prediction-state-ownership.test.ts tests/net-prediction.test.ts tests/network-metric-retention.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/net/prediction.ts tests/prediction-state-ownership.test.ts
git diff --check -- src/net/prediction.ts tests/prediction-state-ownership.test.ts
```

Scoped ESLint, Prettier and whitespace checks passed. No full-project typecheck, build, asset-generation hook or browser execution was run by this agent; root retains those integration gates.

## Independent original-source comparison

A separate native Node v24.22.3 probe imported the untouched original predictor from reference commit `5edead7a44c8ccb5a187b22b750ce2bda7715128` and the current candidate as different modules. Across 32 deterministic trajectories, it checked:

- 4,096 reconciliations, including AI/contact flags and different input lags/horizons.
- 97,536 exact predicted-pose comparisons.
- 12,288 exact rendered-pose comparisons at three presentation times per reconciliation.
- 4,096 complete authoritative-wrapper/state comparisons, followed by an additional isolation read.
- Every original metric array/counter at each trajectory's end, within the unchanged pre-eviction window.

The candidate producer object was reused and overwritten after each call. Every candidate returned pose and authoritative state was overwritten after comparison, while the original reference retained independent unchanged input objects. Strict deep equality passed for all comparisons, including floating-point signed-zero semantics. Positive and negative local time origins were covered. Response-model and numerical primitive source regions also remain byte-identical to the original reference.

Combined trace SHA-256: `a554aac2ef44b44f6728e91b2e2d5ef65c974d0d91aa235438225f196b924e3f`.

The portable probe and exact source fingerprints are retained alongside this report as `24-prediction-ownership-comparison.mjs` and `24-prediction-ownership-comparison.json`.

```sh
node --no-warnings --experimental-transform-types 24-prediction-ownership-comparison.mjs /path/to/baseline /path/to/candidate /path/to/output.json
```

This comparison establishes output compatibility and ownership isolation for the tested trajectories, not a claim about all external callbacks, real network timing or GPU performance.
