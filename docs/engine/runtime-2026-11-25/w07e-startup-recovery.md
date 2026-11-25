# W07E — startup recovery and accepted-record ownership review

Assignment 41/60, wave 7. Independent review at
[`92e2dc2ed2f4959011bb84816e90506cefed774d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d).

## Decision

**No additional production defect was established in the reviewed ownership
contracts.** This assignment adds only this report. It does not change startup
or records source, add duplicate tests, alter host screen policy, or modify a
protected file.

The review traced both modules into their actual host and compared the existing
unit and native cases with the relevant failure boundaries. The useful result is
an explicit acceptance map and limits on what the existing guarantees mean.
This is source review with independently retrieved historical execution evidence;
it is not a new test, compiler, build or browser run.

## Reviewed source and host connections

The principal source is:

- [SessionStartOwner](../../../src/session/session-start-owner.ts), blob
  `597ae9c65648cc3a8f551336d8d8b205818244a6`.
- [TimeTrialRecords](../../../src/session/time-trial-records.ts), blob
  `afe6bbd7fad29c5e1e39e1bd01b01c6f4186f858`.
- [Pinned host wiring](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/main.ts):
  Festival admission, preparation callbacks, readiness, exit, circuit startup,
  time-trial preparation, accepted frames, terminal failure and disposal.
- [Festival cleanup](../../../src/session/free-roam.ts) and the
  [isolated game-event bus](../../../src/steam/events.ts), read to establish
  the real callback and disposal behavior.

Host and Festival source were read only. In particular, `src/main.ts` remains
protected and unchanged.

## Startup ownership findings

### Admission and cancellation

The owner installs its run before invoking the supplied loader. Reentrant or
duplicate startup therefore sees an already-owned run even before the lazy
module has resolved. The host also checks Festival/circuit/settings admission
before calling the owner.

Cancellation revokes `this.run` before dispatching abort or disposing the
session. Synchronous abort listeners and disposal callbacks consequently see
the old scope as no longer current. A successor admitted during those callbacks
gets a new run and generation.

The caller races completion against the run's abort notification. A never-settling
load or create promise therefore cannot keep the canceled caller pending.
The original completion remains observed: late loader rejection is consumed,
late imported modules cannot invoke creation, and a late created session is
disposed instead of adopted. The check immediately after the creation await
also covers cancellation between promise fulfillment and its adoption job.

The finalizer clears only the departed run's `starting` field. It cannot clear
a successor's loading state. Repeated cancellation sees no old owner and cannot
dispose that same adopted instance again through this owner.

### Failure and reentry

An owned load/create/readiness rejection follows a different path from
intentional cancellation. Before cleanup aborts the run, the owner removes the
cancellation waiter; cleanup's own abort therefore cannot convert a genuine
failure into successful cancellation.

Cleanup disposal may throw, but it does not prevent the host recovery callback
from running. After cleanup and again after host recovery, the admission
generation determines whether a successor has appeared. If so, obsolete
recovery or the old outer rejection is suppressed. Checking only whether the
current run is null would be insufficient here, because ordinary failure
cleanup deliberately clears that run.

If recovery succeeds, the exact startup rejection is preserved, including an
`undefined` rejection value. If recovery also throws, the AggregateError retains
the startup cause and both errors while exposing the recovery diagnostic. This
matches the host's distinction between a restored menu and terminal renderer
restoration failure.

The existing tests cover successor admission from abort, disposal and recovery,
as well as throwing old cleanup. The host tests additionally exercise readiness
callbacks that exit or dispose the application during focus release and session
event publication.

### Successful ownership and scope limits

Successful startup removes the temporary cancellation waiter; it does not abort
or replace the run's signal. The actual Festival lifetime remains linked to that
signal after readiness. Later cancellation still closes the established session.

A scope guard controls whether its callback may begin. It does not undo an
asynchronous effect that an already-admitted callback started. The host's audio,
storage and session components retain their own lifetime contracts. Likewise,
promptly settling the canceled caller does not forcibly terminate a dynamic
import or an arbitrary pending factory promise.

Direct `cancel()` retains its existing synchronous disposal-error behavior.
The owner revokes ownership first, but its caller can still receive a disposal
exception. Startup failure recovery and the host's terminal cleanup separately
contain such errors where required. This review does not redefine disposal as
an asynchronous operation.

## Records ownership findings

### Accepted work and presentation are separate

Preparation clears the previous records generation and captures circuit,
category and recorder parameters before awaiting storage. Its ownership
predicate checks the records generation both before and after the supplied host
predicate. A reentrant predicate cannot replace records and still authorize the
old continuation by returning true.

A failed load may call the host toast. Ownership is checked again afterward,
so a toast callback that clears or replaces records cannot be followed by stale
player or HUD installation.

At lap acceptance, options are copied and an improved ghost receives private
sector/sample copies before player-name and lap-event callbacks run. The
queued ghost therefore does not share writable buffers with the public
presentation player. Clear or replacement revokes later presentation updates
and notifications, while already-accepted persistence remains eligible to
complete. These are deliberately different lifetimes.

The Steam lap event uses the actual event bus, which catches listener failures.
The reviewed implementation also accounts for listeners that synchronously
clear records or mutate the original options without throwing.

### Storage ordering

The production atomic port is called as a method of the captured store, retaining
its receiver. Its updater compares against the current stored record rather
than an earlier preparation read. An older or slower compatible ghost cannot
replace a faster stored ghost through this update.

A simple read/write embedding host uses a per-store, per-key queue. The read and
write both occur inside that queued operation. Failure settles the queue link
without hiding the original operation's rejection; the next accepted update
can continue. Removal compares the stored tail promise with the settling
operation, so an old completion cannot delete a newer queued owner. Separate
keys do not block one another.

This fallback is scoped to the same JavaScript store object. It is not cross-tab
synchronization and does not coordinate two independent wrappers around the
same database. Those callers need the atomic update API.

Leaderboard and ghost persistence are **separate key updates**. The code does not
promise an all-or-nothing transaction covering both records. One can succeed
while the other fails, and each has its own result/error notification. Record
presentation also does not subscribe to other tabs' later improvements; a later
prepare reads the committed best.

### Actual host policy

The host's time-trial predicate checks circuit generation, disposal and terminal
error state. Starting a replacement circuit changes that generation; terminal
failure/disposal makes the predicate false. These connections support the
departed-circuit guarantees above.

Returning to the menu and starting Festival retain the parked circuit's
generation. The host does not clear TimeTrialRecords merely because the
foreground screen changes. Accordingly, an accepted save can still produce a
completion toast while the menu or Festival is foregrounded. That is the
existing host policy, not evidence of a stale write or data loss.

The records improvement should therefore be described as suppressing completion
effects after records/circuit/terminal ownership is revoked, not as suppressing
every notification whenever another screen appears. Changing foreground-screen
notification policy would require a deliberate host change in protected
`src/main.ts`; this assignment neither proposes nor makes that change.

## Existing acceptance and observed execution

I independently fetched the decoded log for
[workflow 45628545692, job 139255184399](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45628545692/job/139255184399),
which ran at `b3b8ec09183734287b71406f8894d07c91eb48c9`.

The observed relevant results were:

| Suite | Observed result |
| --- | --- |
| `engine-startup-error-recovery.test.ts` | 16 passed |
| `engine-cross-mode-startup.test.ts` | 24 passed |
| `engine-records-transaction-order.test.ts` | 17 passed |
| `engine-record-boundaries-review.test.ts` | 3 passed |
| `engine-native-startup-cancellation.spec.ts` | All 3 native cases passed |

The complete historical unit stage reported 1,114 passing tests. The historical
native stage was **not green overall**: it reported 52 passes and four failures
in other cases. The three named startup native cases passed within that failed
overall run. This report does not transform those partial results into complete
browser acceptance.

Git-tree comparison independently confirmed identical blobs between that
historical checkpoint and the reviewed `92e2dc2` for both principal production
modules, the startup-error suite, records transaction suite, and both native
startup spec/fixture files. This establishes the specific source identities;
it does not assert that every transitive dependency or host file is identical.

The native startup fixture bundles the real owner and uses actual browser
Promise jobs, AbortController dispatch, task turns and DOM effects. Load/create
work is deliberately deferred by the fixture; it is not a full Festival asset
load, renderer build, physical device test or arbitrary asynchronous destructor
test. The host composition suites supply the complementary admission and
restoration wiring checks.

The existing regression set already addresses the reviewed risks. Adding another
copy of those scenarios without a new failure hypothesis would not materially
strengthen acceptance. The next integrated hosted gate remains the coordinator's
responsibility, especially for other engine changes made after this review.

## Scope of this assignment

Only this report is authored. No source, existing test, protocol, renderer,
character, model, environment, authored asset, vehicle data or offroad file is
changed. No local execution was attempted, and no commit, branch or ref is
created or updated by this worker.
