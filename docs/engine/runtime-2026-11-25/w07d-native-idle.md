# W07D — native circuit-worker idle scheduling acceptance

Assignment 40/60, wave 7.

## Deliverable and current status

Added one native browser acceptance case in four new files:

- [Specification](../../../e2e/engine-native-worker-idle.spec.ts)
- [Browser host fixture](../../../e2e/fixtures/engine-native-worker-idle.ts)
- [Worker timer observer](../../../e2e/fixtures/engine-native-worker-idle-observer.ts)
- This report

The inspected production checkpoint is
[`92e2dc2ed2f4959011bb84816e90506cefed774d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d).
The review included its actual circuit worker, W06E scheduling regression and
report, the native flashback-diagnostics host, and the Playwright configuration.

**Execution is pending coordinator CI.** The local execution environment was
unavailable. No new TypeScript, esbuild, Playwright, callback-count, CPU, battery
or frame-rate result is claimed. This report describes authored acceptance
conditions and the reviewed observation boundary.

No production source, existing test, renderer, model, animation, environment,
asset, protocol, offroad module, vehicle definition or tuning value changed.
The candidate was delivered as an unreferenced tree; this agent did not create
a commit or update a ref.

## Why this native case is useful

W06E's actual-worker unit tests control clock and timer delivery so they can
exercise fractional time, stale callback generations, work budgets and the
full surface-credit bound deterministically. They do not establish that the
browser's real interval registration and cancellation behave correctly when
the worker processes real message tasks.

This case fills that boundary. It uses an actual DedicatedWorker, native
interval and timeout APIs, the unchanged production worker entry, real
simulation and resimulation, and ordinary transferable-buffer returns.
Simulation progress is observed through its actual frame ticks. No fake
timer clock, manually delivered interval callback, private simulation state,
or substituted worker pump is involved.

## Observer construction and ownership

The spec builds three separate IIFEs with esbuild: the browser host, the timer
observer and the production worker. The worker Blob contains the observer
followed by the unchanged production bundle. This order matters: a static
import in a wrapper would execute the imported worker before installing
observation.

The observer forwards each production function interval through native
`setInterval`, preserving its period, arguments, returned handle and native
callback invocation. It forwards `clearInterval` to the native API. Records
use their own monotonically increasing owner number, so evidence does not
mistake a reused browser handle for the same lifetime.

Each record includes scheduled and canceled native-clock timestamps, callback
count, callback-after-cancel count, whether it remained active after its last
callback returned, and whether cancellation occurred inside that owner’s
callback. The aggregate tracks the highest simultaneous active-owner count.

The callback-exit fields prevent an important false positive. If finishing a
rewind forgot to reconcile its timer, a later recycled frame or pause message
could otherwise park it before observation and conceal the omission. Acceptance
requires the rewind owner to have canceled inside its own real interval
callback and to be inactive when that callback returns.

The first native message listener intercepts only the fixture's private
`__engineIdleObserve` request and stops further dispatch of that request.
Every ordinary production message continues unchanged to the real handler.
An observation sent after a production command therefore records a later
message-task boundary without adding a test command to the production protocol.

For an idle window, the observer uses an unmodified native `setTimeout` and
records the worker's actual `performance.now()` before and after. It does not
advance physics. The requested window is 80 ms; acceptance requires at least
60 ms of measured elapsed time and identical interval-owner/callback state
throughout the two endpoints. The tolerance avoids treating timer granularity
as an engine failure while rejecting an immediate fabricated window.

The HTML timer contract explicitly allows scheduling delay; this case verifies
the **requested four-millisecond period and ownership**, not an exact delivered
frequency. The observer uses the standard same-target event-dispatch stop for
its private messages. Primary references:

- [HTML timer algorithms](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)
- [DOM stopImmediatePropagation](https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation)

## Single native scenario

| Stage | Acceptance condition |
| --- | --- |
| Uninitialized worker | The bootstrap interval receives one real callback, cancels itself and leaves no active interval. A subsequent native observation window records no new callbacks. |
| Initialized, paused | A genuine one-car tick-zero frame arrives. Initialization does not create a periodic owner, and another idle window stays unchanged. |
| Running | Actual simulation frames reach at least tick 120. There is one active interval with the unchanged requested 4 ms period and positive native callback delivery. |
| Repeated resume | Three real pause-false commands and their production receipts retain the same interval owner; no duplicate interval is created. |
| Pause | The final frame tick equals the production pause receipt. The periodic owner is canceled, and no callback occurs during the measured idle window. |
| Flashback while paused | A new interval drives real resimulation to tick 60. Completion retains the production flashback → surface → frame order. The resimulation owner cancels within its finishing callback and remains parked before a later pause receipt. |
| Resume after rewind | Actual new frames reach at least tick 84 under one new interval owner. |
| Terminal failure | A deliberately invalid pause sequence produces the exact existing protocol error and cancels the active owner. |
| Rejected revival | Resume, input and flashback messages sent to the failed owner create no timer, frame or other production message during an idle window. |
| Fresh initialization | A new tick-zero simulation is admitted while paused. A subsequent resume advances real frames to at least tick 24 and pauses cleanly. |
| Final release | All five expected interval owners are retired, the maximum concurrent count was one, no delivered callback was recorded after cancellation, and the host has no outstanding waits before terminating the worker. |

The five owners are bootstrap, first live run, resimulation, post-rewind live
run, and fresh-session live run. Both active runs and the bootstrap provide
positive controls against a witness that simply reports no callbacks.

All frame, telemetry and replay buffers are returned with actual transfer
lists; the host requires them to detach immediately. Surface arrays are
consumed, checked for finite values and acknowledged normally. The fixture
does not intentionally introduce unrelated channel starvation. The existing
W06E unit case remains responsible for the actual 120-packet surface bound and
its long blocked interval.

## Evidence and failure behavior

The spec attaches `native-worker-idle-ownership.json` with every native
observation, interval-owner history, pause and rewind boundaries, recovery
progress, transfer counters, surface counts and error information.

Case and operation deadlines reject stuck work; they are not clocks used to
drive the worker. The host terminates the worker and revokes its Blob URL in
`finally`, including on setup or assertion failure. Unexpected worker errors
reject pending operations. The one deliberate terminal protocol error is
reported separately and must match exactly.

Suggested focused hosted gate:

```sh
npx playwright test e2e/engine-native-worker-idle.spec.ts --workers=1 --retries=0
```

The repository's focused engine workflow already selects the new spec through
its `e2e/engine-native-*.spec.ts` glob. Complete TypeScript/build acceptance is
still required because the observer and host are newly authored TypeScript.

## Limits

Zero observed periodic callbacks in these bounded idle windows supports timer
parking in the tested states. It does not measure system CPU utilization,
battery use, whole-process wakeups, browser throttling policy, renderer work or
game FPS. The observer adds small bookkeeping costs, so its active counts are
ownership evidence rather than a performance benchmark.

Native cancellation normally prevents later interval delivery. This case
does not fabricate a stale browser callback to exercise the production
generation guard; the controlled actual-worker unit test covers that adversary.
It also does not fill the surface-credit capacity, replay a full race, validate
a physical controller or change any visual content.
