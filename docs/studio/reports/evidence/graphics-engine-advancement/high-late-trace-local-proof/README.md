# High late startup tracing — local diagnostic patch

## Scope and source

This is a test-diagnostic-only change to `e2e/graphics-high-journey.spec.ts`, based on published commit `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`, tree `51077ee3c9103d7faf139b622aa806bf8652d1f6`. The base tree is identical to the user-approved local `a1e2e38` tree. Production source is unchanged.

The candidate spec SHA-256 is `8145efd6bf378e614ea605d69da12984b232ab5311a2981e895cf6c017dc3497`. The exact spec diff is `review.patch` (94 additions, 4 removals). The baseline and candidate snapshots make the change reviewable without checking out a separate branch. The original and extended composed CPU proof harnesses are both retained.

The High viewport remains 960×600. The original 90-second state predicate, 300-second test deadline, scene, High quality, assertions and actual GPU-completion requirements are unchanged. There was no local browser run, CI rerun or publication for this patch.

## Why this diagnostic is needed

The [published High job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045749/job/135661597584) still failed its original readiness predicate. Its source-matched worker trace places the failure inside the first warmup draw, at “Warming shadows and scene reflections…”. The later second compilation and explicit GPU fence wait had not been reached. The last recorded call is an in-flight `texSubImage2D`, not an observed fence timeout.

The existing early 32-program and 64-first-use budgets were exhausted before three later program metadata requests. The worker's cumulative `getProgramInfoLog` count increased from 137 at first chase to 140 at the last sample. The queried programs were 419, 424, then 436. Program 436's call took 7.643 seconds and was the third late metadata request. The new allowance of eight covers all three requests in this observed run. This is CPU call duration and may include waiting for previous driver work; it is not isolated shader compilation or GPU execution time.

`observed-d8-coverage.json` contains the exact count transitions, source artifact SHA-256 and last in-flight record. The independent coverage review reconstructs the same result from the original JSON. The original graphics CI evidence package remains frozen outside this proof package.

## Changes

- Preserve independent summaries for the first eight first-chase `getProgramInfoLog` owners, with cached vertex/fragment source, full source hash and length, shader name, copied viewport and bounded call stack. Relinking invalidates the owner's prior summary within the same overall allowance.
- Preserve post-return call stacks for the first sixteen successful buffer or texture uploads whose existing measured native-call duration is at least 100 milliseconds.
- Keep the original early caps and activity ring unchanged. Dedicated Node-side arrays preserve the new records even after activity ring eviction.
- Read shader text only from the existing observed `shaderSource` arguments. Add no GL source/query call, draw, flush or finish. Each intercepted native operation retains its receiver, arguments, return and exception behavior.

Each source prefix is capped at 32,768 characters, each shader name at 512, and each stack at 4,096. Source length and truncation are explicit. Slow-upload reporting begins after the original native call has returned and its completion timestamp has been captured.

## Validation

All four final validation invocations used `run-guarded-command.mjs`; each recorded 7,458 protected inputs and an unchanged source manifest. The repeated identical manifest is stored once as `protected-inputs-manifest.json.gz`, whose decompressed SHA-256 is `3dd020187cf10377be1f9de9c00267ab06bd3961e22ee0112d8e36ad2b7e87c0`. The per-run receipts retain original commands, paths, times, actual exit codes and log hashes. Evidence/report files were added afterward; these checks apply to the candidate spec and implementation inputs, not to a subsequently created Git commit.

| Check | Actual exit | Result |
| --- | ---: | --- |
| Extended composed CPU proof on candidate spec | 0 | Pass, 1.854 seconds |
| Same final proof on exact old d8 spec | 1 | Expected-failure control: missing late metadata after exhausting old caps |
| `npx tsc --noEmit` | 0 | Pass, 43.592 seconds |
| `npx eslint e2e/graphics-high-journey.spec.ts` | 0 | Pass, 4.663 seconds |

The proof extracts the actual candidate wrappers and console collector, transpiles them, and runs them with a stub WebGL implementation and the actual worker code inside a CPU VM. It verifies the original native-call/return/throw invariants, early-cap exhaustion, late source retention before native entry, full source hashes with explicit truncation, relink behavior, independent 8/16 budgets, post-return slow-upload stacks, unchanged native-call counts, and retention after 400 later activity records. It does not execute a browser, driver, production scene, or GPU.

The old-source control fails specifically at `late metadata must survive exhaustion of both early caps`. Its raw receipt correctly remains `passed: false`; this is the expected counterexample, not a successful test run.

An initial candidate proof invocation failed because the external harness compared the retained first metadata call's serial with a later repeated call's serial (150 versus 149). The assertion was corrected to compare only on the first metadata call; the candidate spec stayed unchanged. The initial failed log, receipt and matching input manifest hash remain preserved under `checks/native-positive-initial.*`. The initial erroneous harness source snapshot was not retained; this package contains the final harness.

The independent source review found no blocking functional issue. Both the reviewer and root inspected the exact candidate spec hash. TypeScript and lint logs contain only an npm `http-proxy` environment warning.

## Interpretation limits and next step

The bound program recorded during an upload is context, not proof of the uploaded buffer or texture's ownership. Its returned call-site stack can identify the JavaScript path that issued the operation.

The first-eight and first-sixteen allowances may be consumed before a different event in a future run. Observed-run coverage is proven for the three metadata calls, not for every later upload. An upload that never returns has no new post-return stack; the unchanged independent worker still reports its in-flight native identity. Bounded source serialization and stack capture add diagnostic CPU overhead, so this proof does not establish wall-time neutrality or a performance improvement.

The next useful CI evidence is the cached source identity and caller for those late metadata requests, plus returned slow-upload call sites. No production ordering change follows from the current trace. High and the separate menu-entry failure remain distinct: the latter was observed at the second completed-cockpit frame wait.

## Reproduction

From a checkout with dependencies installed, pass the spec path and checkout path explicitly:

```sh
node composed-late-monitor-proof.mjs /absolute/checkout/e2e/graphics-high-journey.spec.ts /absolute/checkout
node composed-late-monitor-proof.mjs /absolute/evidence/baseline-graphics-high-journey.spec.ts /absolute/checkout
```

The second invocation is expected to exit 1 at the late-metadata assertion. The complete original guarded commands are in `checks/*.json`. `SHA256SUMS` covers this package's files; `review-report.json` records source identity and validation provenance.
