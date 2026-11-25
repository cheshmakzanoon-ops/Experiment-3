# W09E — Native acceptance review and interval-observer correction

Assignment 53/60, wave 9 · 25 November 2026.

## Outcome

Corrected the native worker timer observer's single-assignment declaration without changing its callback, instrumentation or scheduling behavior. The integrated worker-idle and desktop-recovery witnesses have no additional source-review blocker within their stated boundaries.

**Runtime acceptance remains pending the coordinator's complete gate.** This assignment independently inspected the failed lint run, the corrected source's subsequent successful lint step, and the test sources. It executed no local runtime. It makes no new native pass claim.

The correction was supplied promptly as blob `6e4aebe1eba2a9339bb8d5980f48efc96ec656b5` in unreferenced tree `3d532c66c70c37acd5907005228b3de9bec383a2`. The coordinator integrated it at [0bc9543][integrated]. I then fetched all five worker-idle/desktop-recovery source files at that commit: the observer exactly matches the supplied correction, and the other four files exactly match the reviewed 748814f versions.

Only the observer and this report were authored by this assignment. No production, renderer, model, character, environment, animation, protocol, vehicle-data or tuning file changed. No commit, branch or ref update was performed by this agent.

## Observed lint failure and exact correction

I independently fetched [run 45644838370][run], confirmed its source was `748814f648badd2e355c47c2f6ddc7321a0ed494`, and read [job 139312908814][job] and its decoded log. The lint stage failed with one `prefer-const` error at line 49 of the native worker-idle observer. Unit, baseline-probe, compiler/build and browser stages were all skipped. The run is a failed lint checkpoint, not partial runtime acceptance.

The observer declared `let owner!: IntervalOwner` before registering a native interval, then assigned that binding exactly once after registration returned. Its fields subsequently change, but the binding does not. The correction removes the separate declaration and changes the existing object assignment to `const owner: IntervalOwner = { ... }`.

The owner object is initialized at the same point as before. The registered callback closes over that binding and executes on a later native timer task, after the current registration call and owner initialization have finished. This fixture binds the original interval function in a fresh worker; it does not replace that function with a synchronous callback driver. The handle, arguments, requested period, owner-number allocation and scheduling timestamp retain their original order.

The callback body, cancellation body, native timeout observation, message interception and every counter remain byte-identical. Reversing only the two declaration edits reproduces the original source exactly. No lint rule was disabled and no assertion or acceptance threshold was changed.

Sources: [corrected observer][observer], [reviewed previous observer][previous-observer].

## Worker-idle witness

The [specification][idle-spec] builds the observer and production worker as separate IIFEs and places the observer first in the worker Blob. This ensures the production registration is observed. The [host][idle-host] creates an actual DedicatedWorker and communicates through real message tasks and transfer lists.

The observer forwards native interval calls with their handler receiver, delivered arguments, requested delay and returned handle. It assigns its own increasing owner number, avoiding confusion if the browser reuses an interval handle. Its observations preserve native monotonic timestamps; neither callback delivery nor elapsed time is synthesized.

The single scenario contains both inactivity assertions and positive activity controls:

| Boundary | Required observation |
| --- | --- |
| Bootstrap and live run | A real bootstrap callback retires itself; later real simulation frames reach the active tick target |
| Repeated resume | Three additional commands retain one current interval owner |
| Pause | The final frame agrees with the production pause receipt; the owner is retired |
| Paused rewind | Actual resimulation completes in flashback → surface → frame order, with timer cancellation inside its finishing callback |
| Terminal error | The exact invalid-sequence error retires the current interval |
| Queued revival | Resume, input and flashback sent to the failed owner produce no replacement timer, frame or production message |
| Fresh initialization | A new tick-zero simulation can subsequently resume, advance and park cleanly |

Each parked window requests 80 ms through the original native timeout and requires at least 60 ms of measured worker time, no active owner, and unchanged callback/owner history. The active stages require positive callback counts and real ticks, so a witness that always reports zero cannot satisfy the case.

The finishing-rewind assertion is especially useful: the owner must have canceled while its callback was executing and be inactive when that callback returned. A subsequent recycle, observation or pause message cannot conceal missing completion cleanup.

The host returns frame, telemetry and replay buffers through native transfers and requires immediate detachment. Surface arrays are checked and acknowledged normally. Unexpected worker errors reject pending operations; a bounded deadline rejects stalled work. A finally block terminates the worker, cancels the host deadline and revokes the Blob URL.

This witness tests actual browser scheduling ownership. It does not manufacture a stale callback after native cancellation, fill the surface-credit capacity, measure CPU/power/FPS, or require an exact delivered four-millisecond frequency. The controlled actual-worker suite supplies the forced stale-generation and full-credit adversaries separately.

The JSON attachment is created only after the host fixture returns. A fixture exception still fails the test and retains the configured Playwright failure evidence, but it can prevent that specific JSON attachment. This is a diagnostic limit, not a swallowed-failure path.

## Desktop recovery witness

The two [desktop cases][desktop-spec] run actual SaveStore and DesktopMirror instances in separate same-origin Chromium pages. Each page has an independent native database connection. Operations are deliberately sequenced; separate owners are tested without claiming simultaneous full reconciliation.

The [browser observer][desktop-host] forwards the original transaction/get/put calls and arguments. It records revision reads, data and revision writes, native request successes, transaction completion and public promise resolution. Every changed desktop write must use one native readwrite transaction, and its completion event must precede the observed promise settlement.

The Node side imports production SaveMirror and saveMirrorService, uses unique real temporary directories, and flushes/reopens them through fresh production loaders. File contents and completion relationships are asserted through actual service loads. No fabricated checksum, private mirror mutation or synthetic transaction completion supplies the result.

### Returning-owner recovery

A and B both initialize before either writes. A writes career data, B updates a ghost, then A writes career with backup. The test requires local revisions 1, 2 and 3 while the native file prefix remains at complete revision 1. Only A's first incremental commit may reach the service.

A fresh owner must seed all local values at revision 4, including the intervening ghost and recovery backup. A later settings update must resume incremental forwarding from predecessor 4 to revision 5. Flushing and reopening must recover the expected profile/ghost relationship from the real primary files.

This distinguishes correct blocking from simply assigning unique revisions. It also includes a positive recovery/write control, so permanently refusing every incremental batch cannot pass.

### Failed full seed

A browser-only owner first writes ordinary local values without creating desktop revision metadata. The explicit test binding refuses exactly the first subsequent seed before calling the native service. A later settings update must remain local, and the service must still reopen as genuinely empty.

A fresh owner must recover both local values in a complete seed before a later write-with-backup can incrementally commit. The old career value, newer settings and backup must all survive the real file reload.

The refusal is a test-transport condition. It is not represented as a filesystem crash or as a failure returned by the native service itself.

### Settlement, failure and cleanup

Bridge calls are tracked at the exposed binding boundary. After pending promises settle, a native MessageChannel turn permits the mirror's derived promise chain to finish. No fixed sleep is used to manufacture IndexedDB completion.

The desktop cases attach their accumulated evidence in finally, including recorded calls, native transaction observations and cleanup results. Successful scenarios require no page error, unhandled rejection or outstanding bridge call. Database connections are closed and observer methods restored. The service is flushed before its temporary directory is removed.

A failed assertion is not caught and converted to success by this cleanup. A cleanup assertion after an otherwise passing case also fails the test. The two witnesses therefore preserve useful positive, blocked and recovered states without weakening the production fail-closed policy.

These are real browser-storage and production file-service composition cases through an **explicit Playwright binding**. They do not establish Electron preload/IPC, Steam Cloud, arbitrary disk-failure timing, cross-browser behavior, or globally atomic reconciliation concurrent with writes.

## Integration and release boundary

After the correction was integrated, I independently fetched [follow-up run 45645636058](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45645636058), verified its exact 0bc9543 source, and inspected job 139315775862. Its full source/test/script ESLint step completed successfully. At that observation the unit stage was still executing; probe, build and native acceptance remained pending. This is an observed lint pass, not a complete gate result.

The reviewed [focused workflow][workflow] selects all three new native cases through its existing native-spec glob, executes one Playwright worker with no retries, and places lint, focused units, six baseline comparisons and complete typecheck/build before browser acceptance. Its native service digest is recorded before the gate and checked before and after successful native execution. The post-check is not claimed when an earlier fail-fast command exits.

The failed 748814f job demonstrates that the new lint stage refuses a harness defect before runtime acceptance. The coordinator's next complete run must establish the corrected source's actual results. Earlier accepted 92e evidence remains historical and cannot certify these newer cases.

No additional test or production edit was justified by this source review. The required remaining step is execution of the corrected integrated checkpoint and retention of its exact source/run evidence.

[run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45644838370
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45644838370/job/139312908814
[integrated]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a
[observer]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/e2e/fixtures/engine-native-worker-idle-observer.ts
[previous-observer]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/e2e/fixtures/engine-native-worker-idle-observer.ts
[idle-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/e2e/engine-native-worker-idle.spec.ts
[idle-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/e2e/fixtures/engine-native-worker-idle.ts
[desktop-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/e2e/engine-native-desktop-recovery.spec.ts
[desktop-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/e2e/fixtures/engine-native-desktop-recovery.ts
[workflow]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/.github/workflows/engine-runtime-validation.yml
