# W06B — native retained-page acceptance

Assignment 32/60. The first exact-commit browser run proved a trusted native
BFCache restoration of the same document and worker, then failed an invalid
timestamp-uniqueness assertion. That fixture assertion has been replaced with
direct native request/delivery ownership accounting. **The corrected complete
case is pending native CI; its second restoration and terminal reload are not
yet proved.** No local browser was launched.

## Acceptance boundary

The new `e2e/engine-native-page-history.spec.ts` case navigates away from a real
HTTP document and restores it through browser history twice. A final reload is
tested separately as a terminal navigation. Both retained navigations must meet
all of these assertions:

- The browser emits a trusted `pageshow` with `persisted === true`.
- The document and dedicated physics worker retain their original independent
  UUIDs. The server receives no second document request during either Back.
- The actual host remains paused with its original session generation. Its page
  epoch advances once per departure, and each restored clock starts at zero.
- There is one pending host RAF and one native input interval; recorded peak
  ownership also remains one. Each native request can enter the presentation
  boundary at most once. Duplicate or untracked deliveries, calls without a
  request, and frames belonging to cancelled or stale owners must remain zero.
  The pending native handle must match the host's current handle and epoch.
- The worker confirms the pause through the real ordered snapshot/receipt
  protocol. Its tick, step count and input-message count remain unchanged during
  a separate 150 ms observation while paused after restoration.
- No unpause command belongs to the restored page epoch until a fresh trusted
  button action. Held throttle and shift repeats do not become fresh intent.
  A subsequent release and new press reaches actual physics again.
- The same native WebGL2 context remains usable, produces the expected paused
  green pixel, and reports no context loss or GL error. No owner is disposed
  during retained navigation.

The final reload must produce new document/worker UUIDs and a trusted
non-persisted hide of the old document. A synchronous same-origin session-storage
receipt records that its real host disposer cancelled every tracked RAF and
input interval, terminated its native worker once, disposed its actual input
controller once, and released the renderer's shared GPU lease. Other owned
service boundaries must also be disposed once. A reload cannot satisfy either
retained-navigation assertion.

## Production code and native components

The test reads the current `src/main.ts`, hashes its bytes, and uses the
TypeScript AST to extract complete declarations for page hide/show, host frame
scheduling, pause/resume, post, playback suspension and disposal. It also extracts
the actual three constructor registrations for pagehide/pageshow/blur and the
single production `InputPump` assignment. Missing or ambiguous declarations fail
the fixture; lifecycle policy is not rewritten as a reference implementation.

The browser fixture imports the real `InputController`, `InputPump`,
`PauseHandshake`, `LiveFrameClock` and shared GPU gate. Timers and RAF callbacks
delegate to the native browser without changing their clocks, delays or
callback cadence; wrappers only observe owned handles and delivery identities.
Each RAF record includes a monotonic sequence, native request ID, request epoch
and generation, cancellation state, delivery state and frame-call count.
Requested minus cancelled minus live-delivered minus pending requests must
balance to zero. Direct startup calls are counted separately and also required
to be zero, rather than being silently omitted. A bounded 96-event trace and
the first eight repeated-timestamp pairs retain request/delivery details and
native observation times; repeated timestamps are diagnostics, not callback
identities. The host uses a native
WebGL2 canvas and real shared completion lease. Its small presentation boundary
clears a solid pixel instead of constructing a game scene.

The dedicated worker imports the actual `physics.worker.ts` and `Simulation`.
It keeps the ordinary native performance clock, interval, message scheduling,
transfer lists, buffer pools, pause handling and physics solve. Read-only
instrumentation forwards the unchanged real `Simulation.step()` call and keeps
bounded recent applied input observations plus scalar counters. Its inspection
messages are handled outside the production message protocol. Unlike the older
native worker-clock fixture, this worker does not replace a clock or manually
trigger simulation intervals.

The unrelated UI, audio and review services are observable small boundaries.
The audio assertions establish that the complete host invokes stop/suspend and
dispose; they are not native audio or PCM evidence. The native audio assignment
owns that verification. This is also **not full-game cache eligibility**, a
Festival session, asset loading, a physical keyboard/GPU, or performance/FPS
acceptance. Existing deterministic tests cover interrupted startup, settings,
flashback, Festival travel and adversarial stale callback delivery separately.

No production source, models, characters, environments, authored scenes,
bindings, physics constants, dependencies or workflows are changed here.

## Browser automation compatibility

The installed Playwright Chromium switch list explicitly includes
`--disable-back-forward-cache`. This spec removes only that default argument
while preserving the configured renderer arguments and Chromium executable.
The existing backend identity assertion still requires the chosen Mesa or
SwiftShader software renderer.

Playwright's [navigation documentation](https://playwright.dev/docs/navigations#backforward-cache-bfcache)
states that its normal `Page` lifecycle bookkeeping does not support BFCache
restoration. The coordinator identified this incompatibility during review.
The fixture therefore uses a raw Chrome DevTools Protocol session throughout
the case, including initial navigation, history entry selection, returned
context evaluation, trusted mouse/key dispatch and terminal reload. After the
initial CDP session is obtained, it does not call `Page.goBack()`, locators,
`Page.evaluate()` or Playwright navigation waiters.

The documented [Page navigation protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
provides `getNavigationHistory`, `navigateToHistoryEntry` and `reload`.
`Runtime.evaluate` returns values from the active main context without retaining
handles to an old execution context. Only brief protocol errors from a document
context swap are retried; application exceptions fail the case. Input events
are delivered through the browser's native input protocol and their DOM trust
and repeat fields are asserted. This is controlled browser input, not a physical
device certification.

The two pages are served by a test-owned loopback HTTP server. Playwright request
routing does not intercept them. Automatic trace/screenshot collection is off
only for this spec so it does not touch a desynchronized Playwright `Page`.
Explicit JSON evidence remains enabled, including CDP runtime exceptions,
navigation events, `Page.backForwardCacheNotUsed`, and the returned document's
`notRestoredReasons`. Neither a cache rejection nor a normal reload is skipped
or treated as success.

The [browser cache lifecycle guidance](https://web.dev/articles/bfcache)
distinguishes intent to cache on pagehide from actual restoration on pageshow.
That is why the native trusted persisted-show assertion is mandatory here.

## Files and evidence

- `e2e/engine-native-page-history.spec.ts`: actual source extraction, test-owned
  HTTP server, raw CDP navigation/input and strict acceptance assertions.
- `e2e/fixtures/engine-native-page-history.ts`: retained native owner fixture.
- `e2e/fixtures/engine-native-page-history.worker.ts`: real native-clock physics
  worker with bounded read-only inspection.

The spec attaches departure and admission JSON before evaluating cache
acceptance, then a combined `native-page-history.json` on success. Evidence
includes source SHA-256, requested software backend and observed identity,
preserved launch arguments, document/worker identities, native event trust,
pause receipts, handle counts, worker input/step observations, pixels, exceptions
and cache rejection diagnostics. The existing focused workflow includes these
files through its `engine-native-*` globs.

## First exact-commit native result and correction

The coordinator's run **45573448610** tested commit
**9922926e786c35e84810efc8b15e75bcfaba5372**. The original evidence remains in
`validation/engine-9922926.zip`; extracted attachments are
`validation/checkpoint4-artifact/history-1-departure.json` and
`validation/checkpoint4-artifact/history-1-admission.json` in the coordinator's
workspace. These files record the following observations:

| Observation                              | Before departure | First restored document |
| ---------------------------------------- | ---------------- | ----------------------- |
| Page epoch                               | 0                | 1                       |
| Presentation frames at attachment        | 81               | 85                      |
| Peak pending RAF handles                 | 1                | 1                       |
| Peak input intervals                     | 1                | 1                       |
| Peak callbacks sharing a timestamp       | **2**            | **2**                   |
| Renderer reset count                     | 0                | 1                       |
| Renderer disposals / worker terminations | 0 / 0            | 0 / 0                   |

The trusted native `pageshow` had `persisted: true`, the original document and
worker UUIDs were retained, and the HTTP document request count remained one.
CDP independently recorded `BackForwardCacheRestore` and no cache failure.
The worker stayed paused, and the restored WebGL context produced the expected
green pixel without context loss or GL errors before the assertion failed.

The failing value was already two before navigation, at epoch zero with no
renderer reset. The evidence therefore rules out restoration as the origin of
this recorded timestamp repeat. The original instrumentation did not capture
the actual repeated values or request IDs, so it cannot establish their precise
browser cause or prove individual request ownership. Treating a timestamp as
a unique callback ID was an unsupported inference; raising the allowed count
to two would retain that mistake.

The correction keeps the raw timestamp statistic and adds direct per-request
identity, cancellation, delivery and frame-call evidence. Assertions still
require one pending owner and one input interval, and now explicitly reject
duplicate deliveries, unscheduled frames and frames from cancelled or prior
epoch/generation owners. No production behavior, native cadence, browser launch
flag, BFCache admission criterion or input assertion changed. This run did not
reach the second history cycle or the terminal reload, so those claims await
the corrected exact-commit workflow.

## Local verification

- Both browser fixture graphs bundled through the installed esbuild with the
  same browser/IIFE/ES2022 options used by the native spec.
- The source extraction and generated host constructor executed locally:
  exactly three actual lifecycle registrations and one input-pump assignment;
  initial disposed flag false, page epoch zero and RAF handle null.
- Playwright discovery listed one test in this file without launching a browser.
- Scoped TypeScript syntactic/semantic checking covers the spec and both
  fixtures: **zero diagnostics** on the final raw-CDP implementation. An initial
  Node/DOM timer overload mismatch was corrected using a
  typed native-browser handle; no engine behavior changed.
- Scoped ESLint passed for the three TypeScript files. Prettier passed for those
  files and this report.

The checks above describe the originally published raw-CDP fixture. For the
narrow request-accounting correction, both browser graphs bundled again without
warnings (426,247 fixture bytes and 1,081,146 worker bytes), scoped ESLint passed,
and Playwright discovery again listed exactly one case. Prettier and the scoped
diff whitespace check passed. No semantic compiler was rerun locally during
the coordinator's constrained-memory work; the exact-commit pipeline owns that
check and native execution of the corrected case.

There was no full repository typecheck/build, npm lifecycle hook, Git mutation,
browser-policy bypass or performance measurement. Local preparation checks do
not establish native execution of the corrected case.
