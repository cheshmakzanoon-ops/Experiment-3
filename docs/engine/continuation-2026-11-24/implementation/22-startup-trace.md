# Agent 22 — paused-grid browser startup investigation

Date: 2026-11-24. Investigation only; no production behavior or content changed.

## Outcome

The exact same implementation commit passed the unchanged browser checks on retry. The original failure remains recorded: one run exhausted the 60-second overall paused-grid assertion after substantial cold preparation work. The trace does not demonstrate a deadlocked final GPU fence or a consistently reproducible regression.

| Evidence | Source | Result |
|---|---|---|
| Initial settings-transition attempt | [Run 45451671242, attempt 1](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45451671242/attempts/1), job 138650134402 | 5 passed, 1 failed; paused-grid state was still `loading` at the assertion deadline |
| Same-commit retry | [Run 45451671242, attempt 2](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45451671242/attempts/2), job 138659194262 | **6/6 passed**, suite 2.5 minutes; paused-grid test passed in 1.3 minutes including initial menu, settings, reload and grid preparation |

Both attempts use `3c3bf024f9c2a4bd65fe5f45530b7ad029b6c77e`. The coordinator requested the single-job retry. No source, test deadline, assertion or workload was changed between these attempts. A successful retry establishes successful execution at that commit; it does not prove the cold-start timing issue cannot recur.

## What the failed trace actually shows

The failed test uses the real interface to select low quality, save, reload, select a four-car race and click **PREPARE GRID START PAUSED**. The original test timeout is 240 seconds; the failed `expect.poll` uses the project-wide 60-second assertion timeout.

The trace contains the existing `__APEX_MENU_TIMING__` instrumentation, including native fence return values and RAF/timer heartbeats. The reload document relevant to grid preparation recorded 4,479 events in 171 packets with **zero browser-dropped events**. The earlier menu document dropped 388 events; it must not be described as a complete initial-page timeline.

| Observation in the reload document | Recorded value | Meaning |
|---|---:|---|
| Largest observed main-thread task | 21,607 ms, starting at page time 49,091.5 ms | A substantial preparation task precedes the first grid-draw fence. Its internal JS/shader/driver costs cannot be separated from this trace. |
| Chase/pit preparation fences 4 and 5 | Native `CONDITION_SATISFIED`, then deleted | Earlier submitted work completed and ownership progressed. |
| Last cockpit fence 6 created | Page time 72,721.5 ms | A new fence was successfully allocated for the later grid draw. |
| Last observed wait on fence 6 | Page time 80,353.9 ms | Only **7,632.4 ms** of this fence's lifetime was observed. |
| Fence 6 native results | 60 `TIMEOUT_EXPIRED`, no signaled result | Work remained unfinished at the observed boundary. This is not evidence that it could never finish. |
| Last heartbeat | Page time 80,483.3 ms; 860 browser frames and 1,993 wrapped callbacks | Browser callbacks continued during the final wait. |
| World WebGL context | Context 1, canvas `world`; no loss event | The separate context-2 loss event belongs to the unnamed secondary canvas, not the world canvas. |

The preparation click completed at Playwright trace time 105,000.811 ms. The first captured DOM fragment saying `Waiting for completed cockpit GPU work…` appears at 157,687.393 ms, approximately **52.687 seconds later**. Thus the assertion did not spend its whole 60 seconds stuck at 94%; that label was reached near the end of the available overall budget. DOM snapshots provide observation times rather than exact stage start times.

No non-instrumentation console messages were recorded in this trace, and the coordinator found no failed HTTP status. Neither observation alone proves the absence of every possible runtime error. The original failure screenshot shows `Warming up tyres` / 94%, which `loading-copy.ts` maps to the completed-cockpit GPU wait.

## Source comparison and causal limits

The following were byte-identical between the prior successful implementation `1bb58c9` and tested `3c3bf02`: `renderer.ts`, `gpu-frame-gate.ts`, the then-current `gpu-timer.ts`, `loading-copy.ts`, the menu test, timing instrumentation, Playwright configuration, settings-transition workflow, and package lock. Their exact SHA-256 hashes are in `22-startup-source-comparison.json`.

`GameApp.start()` waits for the first worker snapshot before entering `renderer.prepare()`. Reaching the cockpit stage therefore demonstrates that first-frame readiness had already settled. During this preparation the worker remains paused, and its surface-publication loop is behind the pause return. The changed surface backpressure path is not the owner of the observed GPU wait. Desktop mirror changes are feature-detected out of ordinary browser builds. Collision algorithms were also changed in this batch; this trace is not a controlled CPU profile and cannot independently exclude an indirect timing effect from every source change.

The preparation fence gate intentionally waits for a native completion result. A timeout must not be converted into completion or used to release in-flight resources. Its per-wait preparation deadline (90 seconds) is distinct from the test's overall 60-second assertion. Fence 6 had not approached that 90-second deadline in the captured interval.

The strongest supported classification is **variable cold preparation exceeding the existing assertion budget on one attempt**, followed by successful execution at exactly the same commit. There is insufficient evidence for a production repair to a particular engine algorithm. No timeout increase, fence discard, skipped warmup, asset change or weakened assertion was made.

## Reproducible evidence helper

Added `scripts/analyze-startup-trace.py`, a dependency-free, read-only summarizer of the already recorded Playwright timing stream. It accepts an extracted `.trace` file or `trace.zip`, records the input SHA-256, preserves page-versus-trace clock boundaries, distinguishes signaled native results from timeouts, reports dropped-event counts, and emits compact expensive/terminal fence summaries. It does not run the application or alter clocks, rendering or test behavior.

Executed against the failed trace:

```sh
python3 scripts/analyze-startup-trace.py /engine-work-4e0075ccccb3/ci-evidence/trace.zip --output /engine-work-4e0075ccccb3/reports/22-startup-trace-summary.json
```

The extracted-file and ZIP-input modes were compared for identical semantic output. The helper parsed successfully and its source whitespace check passed. No full project compilation, browser rerun, asset generation or production test changes were performed by this agent. The successful remote rerun above was requested by the coordinator and its completed logs were inspected directly.

Retained evidence:

- `22-startup-trace-summary.json`: compact summary, including original trace hash.
- `22-startup-source-comparison.json`: hashes of unchanged preparation/test files.
- Original artifact 14947483818 (`settings-transition-evidence`, attempt 1), already downloaded by the coordinator.

If the cold-start failure recurs on the final implementation, compare repeated same-scene runs and the existing preparation-stage/fence evidence before changing scheduling. The final implementation still needs its own CI result; this investigation's successful retry applies specifically to `3c3bf02`.
