# W08F — independent validation and native-witness review

Assignment **48/60**, wave **8** · 25 November 2026.

## Decision

No blocking false-positive mechanism was found in the inspected CI pipeline or native witnesses. The reviewed contracts distinguish measured observations from supplied inputs, and the pipeline propagates test failures rather than accepting the output of `tee` as success.

This is **not acceptance of the newest source**. The latest inspected integration, `e2d1fec2ff3b38a2cf962e9974cfe0622259823b`, failed two unit cases and skipped its later gates. The earlier `92e2dc2ed2f4959011bb84816e90506cefed774d` focused run passed. Its evidence cannot be transferred to later source without another complete run.

This assignment authored only this report. It made no production, test, workflow, asset or ref change and executed no local runtime command.

## Inspected source and observed runs

The review fetched the workflow, source guard, shared baseline loader, Playwright configuration, worker-idle specification/host/observer, native driving-audio specification/host, device-ownership specification/host, and source-stability test source at [e2d1fec][integrated]. It separately fetched all three files in agent 42's [native desktop recovery candidate tree][desktop-tree]. Candidate storage acceptance has not yet executed at this review boundary.

The reviewer independently fetched both hosted jobs and their decoded logs:

| Source and run | Directly observed result |
| --- | --- |
| [92e2dc2, run 45637677573][accepted-run], job 139287423560 | Success: 1,135 units across 86 files; six original-baseline provenance records; full typecheck/build; 57 native cases in 4.0 minutes |
| [e2d1fec, run 45641670477][integrated-run], job 139301674493 | Failure: 1,348 of 1,350 units passed across 94 passing and one failing file; two persistence-integration payload-ownership assertions failed; probe, typecheck/build and native stages skipped |

The later failures are the `write` and `writeWithBackup` committed-private-snapshot cases in `tests/engine-persistence-integration.test.ts`. The coordinator assigned their diagnosis and correction separately. This report does not decide their production/fixture root cause.

The successful log explicitly includes both native device-ownership cases and all three native driving-audio cases. It executes Playwright with `--workers=1 --retries=0 --forbid-only`. The run metadata identifies the accepted source SHA. The saved [result record][result] agrees with those observations. The reviewer read decoded logs and sources, not the artifact ZIP or its attached browser JSON files.

## Failure propagation and gate composition

The [workflow][workflow] uses explicit fail-fast shells and `pipefail` around every logged unit, probe, build and native pipeline. A failing child cannot be converted into success by a successful `tee`. The nested probe shell also enables `-e -u -o pipefail`, so an early failing probe prevents later successful probes from hiding its status. The typecheck/build command joins the two tools with `&&`; a compiler failure prevents the build.

The [source guard][source-guard] launches an argument vector with `shell: false`. It returns the child exit status, fails closed for spawn errors or signal termination, and returns failure when its before/after snapshots differ. The changed-source check also runs after an ordinary nonzero child exit. A failed unit stage at e2d1fec demonstrably returned exit 1 and caused the later gates to be skipped. That is observed failure propagation, not only a source-level inference.

Unit selection forbids `.only` and disables retry acceptance. Browser selection likewise forbids focused tests and disables retries. The browser suite uses one worker and retains traces/screenshots on failure through the [Playwright configuration][playwright]. The artifact stage runs under `if: always()` and retains available run evidence for seven days. Its missing-files setting requires at least some matching evidence; it is not a guarantee that every named log or attachment exists after an early failure.

The focused gate does not replace the complete repository workflow. In particular, the accepted 92e focused workflow did not run ESLint. The coordinator found a new worker-test `no-this-alias` error in the broader workflow and assigned its correction to agent 47. A passing focused run must not be described as a complete repository lint/content/test pass.

The probe glob executes every matching probe currently present; release review should still require the six expected report identities. A successful process exit alone does not independently certify that an accidentally removed probe ran.

## Exact-source and historical-baseline boundaries

The workflow records checkout commit, Git tree and lockfile digest before executing the gate. Source stability then protects its declared inputs from persistent command-time modification. That is narrower than whole-repository immutability:

- The guard snapshots `src`, `public`, `scripts`, `tests`, `e2e`, `docs`, `.github`, and root files.
- It deliberately excludes the named generated player-LOD derivative, root browser receipts and ordinary output directories.
- It does not currently snapshot `desktop/src`.
- It compares each invocation with that invocation's starting inputs; it does not prohibit legitimate changes made before the invocation.

The reviewed source-stability tests contain negative controls for additions, modification, deletion, missing executables and nonzero child exits, plus explicit receipt/derived-output exceptions. Their source was reviewed; this report does not claim that this non-engine-named suite ran in the accepted focused selection.

The [baseline helper][baseline-helper] resolves the immutable dda5 commit, obtains declared historical module bytes through `git show`, and substitutes only those targets in a separate in-memory bundle. Every declared target must actually be loaded. The candidate uses its ordinary loader. Separate module identities avoid sharing module state even if bundle contents happen to match.

The helper checks target bytes, HEAD and scoped tracked status after bundling. It records target/bundle/entry digests, Node/esbuild versions, candidate HEAD, clean/dirty tracked state and the replacement scope. The accepted log contains six candidate provenance records at the same 92e source.

These are historical-module comparisons within the candidate dependency graph. They are not complete historical builds or a freeze of every transitive dependency. The helper reports dirty source rather than universally refusing it; the accepted run reports clean tracked state in its explicit scope. Untracked files are excluded from that tracked-status claim. None of these distinctions invalidates the measured comparisons, but they constrain reproduction and performance claims.

## Native worker timer witness

The [native idle specification][idle-spec] independently bundles the timer observer and unchanged production worker, concatenating the observer first. This avoids a static-import ordering mistake that would install observation after the worker registered its timer.

The [observer][idle-observer] forwards the native interval request, delay, arguments, returned handle and callback invocation. It counts lifetime owners separately from browser handle values. It does not manually deliver a callback or advance the worker clock. Its private observation message is intercepted before the production handler; ordinary commands continue through native dispatch.

Positive controls require a bootstrap callback and real simulation progress in active owners. Idle assertions require an actual measured interval of at least 60 ms for an 80 ms requested window, no active owner at either endpoint, and unchanged callback/owner history. Consequently a witness that merely reports zero activity cannot pass the live stages.

The resimulation assertion has an especially useful distinction: the finishing interval must cancel inside its own callback and be inactive when that callback returns. A later recycle or pause message cannot conceal missing callback cleanup. Repeated resume must retain one owner; terminal failure must retire it; queued revival must produce no new frames/messages; fresh initialization must admit actual new progress.

The host returns frame/telemetry/replay buffers with real transfer lists and verifies detachment. It acknowledges ordinary surface credit and verifies finite arrays. Deadlines reject stuck work; they do not drive simulation. Worker errors reject pending operations. The `finally` path terminates the worker and revokes its Blob URL.

These are bounded timer-ownership observations. The test does not measure whole-process wakeups, CPU, energy or FPS; it does not fill the surface-credit bound or manufacture stale browser callbacks. Controlled actual-worker unit tests cover those adversaries separately.

The JSON attachment is written after the browser fixture returns and before its assertions. If the fixture itself throws, that JSON may not exist, although the test still fails and Playwright retains its ordinary failure evidence. This difference affects diagnosis, not pass/fail validity.

## Native RAF and audio witnesses

The [device witness][device-host] uses a native RAF sentinel scheduled before observed owners. Its serial tracks callback batches independently of equality between exposed timestamp numbers. The original timestamps are still forwarded and recorded. Each owner is checked for maximum pending count, duplicate delivery within a witnessed batch, timestamp mismatch, late delivery/scheduling and released listeners.

A separate diagnostic owner deliberately schedules two actual callbacks in the same native batch. The specification requires the witness to observe that duplicate and excludes it from production-owner assertions. This positive calibration prevents a counter that always reports zero duplicates from passing. Equal timestamp numbers across different witnessed batches remain recorded without being relabeled as duplicate owner execution. The test makes no claim about the browser mechanism behind an earlier timestamp collision.

The [audio fixture][audio-host] builds the production graph in a native 48 kHz `OfflineAudioContext`. Native suspend, resume and complete rendering establish observation windows. Automation wrappers call the original AudioParam methods. Signal assertions inspect finite PCM, peak and RMS in separately routed cue-stem and final-mix channels. Silent controls and actual cue cases prevent acceptance based only on scheduled automation metadata.

The native suspension checkpoints have explicit sample alignment/tolerance checks. Required route work and same-track reuse are counted through the real Track method. Disposal runs in `finally`, closes the finite offline render when necessary, releases owner references and checks unhandled rejection evidence.

Audio deadlines reject stuck operations. An early catch attached to the rendering promise prevents an unhandled rejection while a checkpoint is pending; the render promise is subsequently awaited, so it does not turn failure into success. Native offline closure is explicitly distinguished from closing a live hardware audio context.

The accepted run demonstrates these RAF and offline-audio conditions in its browser environment. It does not establish physical controller behavior, speaker output, autoplay permissions, AudioWorklet support, hardware frame rate or other browsers.

## Native desktop candidate

Agent 42's [candidate][desktop-tree] runs two independent recovery scenarios using separate same-origin Chromium pages and actual IndexedDB requests. The browser observer forwards every original transaction/get/put argument and records native request success, transaction completion and public-promise settlement. Each changed desktop write must contain the revision read, changed values and revision put in exactly one readwrite transaction.

The Node side imports the production `SaveMirror` and `saveMirrorService`, writes real temporary files, flushes and reopens them with fresh loaders. Assertions inspect recovered entries, revisions, source files and completion relationships. The A→B→A case cannot pass by merely assigning unique local numbers: it requires native files to remain at the older complete prefix until a fresh owner seeds all local values. The failed-seed case refuses only that explicit bridge call, then requires a later partial write to remain local until complete recovery.

The browser-to-Node connection is a labeled Playwright binding. It is not Electron preload/IPC. The scenarios intentionally serialize initial reconciliation; they do not establish simultaneous full reconciliation and writes.

Bridge settlement observes pending calls and gives derived promise chains a native message turn. It does not synthesize IndexedDB completion. Unexpected service errors appear in recorded calls and are asserted absent on success. Cleanup observes page errors/unhandled rejections, closes connections, restores native methods and flushes service debounce work before temporary-directory removal.

The specification attaches evidence in `finally`, including failed cases. Cleanup failures after an otherwise successful scenario fail the test; original assertion failures are not swallowed by the evidence/cleanup path. Source review found no blocker. Compilation and browser execution remain pending integration.

## Coordinator changes and release condition

The review identified missing workflow triggers for the newly exercised desktop service/bridge and the lint configuration. The coordinator reported staging these additions:

| Candidate gate addition | Purpose |
| --- | --- |
| Trigger `src/desktop/**`, `desktop/src/save-mirror.cjs`, `eslint.config.js` | Future changes to exercised dependencies schedule the focused gate |
| Source-guarded full `eslint src tests e2e scripts` stage, with retained log | Catch harness and source lint failures in the same acceptance run |
| Record desktop service SHA-256 before execution; verify before and after native stage; retain digest | Cover the exact imported service outside the generic source snapshot |

These are coordinator-reported candidate changes, not executed evidence reviewed here. With the existing fail-fast shell, the post-native digest check runs only after a successful pipeline. The initial digest remains useful failure evidence; it does not imply that the post-check ran after a browser failure.

Release acceptance must wait for the actual integrated source to pass lint, units, all six comparisons, typecheck/build and native cases. The coordinator should retain its exact run identity and keep the failed e2d checkpoint visible. No speculative production edit or duplicate test is required by this review.

[accepted-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[integrated-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45641670477
[integrated]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b
[workflow]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/.github/workflows/engine-runtime-validation.yml
[source-guard]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/scripts/source-stability.ts
[baseline-helper]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/scripts/engine-runtime-probes/support.mjs
[playwright]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/playwright.config.ts
[result]: evidence/92e2dc2/result.json
[idle-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/engine-native-worker-idle.spec.ts
[idle-observer]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-worker-idle-observer.ts
[device-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-device-ownership.ts
[audio-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-driving-audio.ts
[desktop-tree]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/git/trees/947e962a18840b13922ee423e66e8510fe47921b?recursive=1
