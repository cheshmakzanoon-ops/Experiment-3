# Wave 4b — retained page lifecycle

Assignment 20/60, 25 November 2026. Addresses runtime-audit finding 3. Scope is generic application lifetime, input ownership and sound cancellation; no vehicle models, characters, environments, authored content, styles or tuning changed.

## Result

`GameApp` now distinguishes persisted history navigation from terminal navigation through its actual owned `pagehide` and `pageshow` callbacks. A persisted hide retains completed circuit and Festival sessions in a paused state. A matching persisted show restores one animation/input owner with fresh presentation clocks, neutral controls and silent audio. Driving, replay playback and an automatic pregrid launch require a new player action. A terminal hide still calls the idempotent application disposal path, including `Interface.dispose()`.

The browser semantics are documented by [Google's back/forward-cache guidance](https://web.dev/articles/bfcache): a persisted hide indicates intent to cache, while a persisted show identifies an actual cache restoration. Pending tasks may resume with the retained page. The implementation therefore revokes pre-navigation asynchronous activation permissions instead of relying on task freezing or event ordering.

## Ownership and changes

### Main host

`src/main.ts` owns both page listeners and removes them on terminal disposal. A page epoch prevents a cancelled RAF delivered after restoration from scheduling another loop. The pending RAF uses `null` as its empty sentinel, retaining a valid identifier of zero through duplicate scheduling and cancellation. `InputPump.dispose()` stops its interval while away; restarting the existing owner resets its time baseline and cannot duplicate the timer. The first restored host draw uses a fresh 16 ms presentation interval rather than the wall time spent away.

Active circuit workers keep their session generation. They receive a neutral input sample and a pause request, and their final pause snapshot/receipt remains consumable. The main UI stays paused. Replay keeps its position and stops playback. Pregrid keeps its position, stops its clock and revokes automatic race start, including an already completed presentation. Menu, results and photo states remain usable and redraw once invalidated.

Unfinished circuit starts are cancelled through `WorkerReadiness`; their old worker and candidate renderer lose ownership. Unfinished Festival imports/preparation are cancelled through `SessionStartOwner`. Restoration returns those interrupted starts to the menu and rebuilds an absent circuit renderer only after the page is active. Late imports, first snapshots, renderer warming, record preparation and callback completion cannot adopt a session or enable input. An initial showroom load waits for the page to become active before allocating its renderer, and disposal/failure settles that wait.

Settings transactions capture the page epoch, so a completion delivered after a hide/show cycle cannot close the retained editor or resume through its close action. A queued language-reload completion is guarded by that same transaction predicate. A pending flashback can complete its recording cut, but its previous permission to resume driving is revoked by navigation. If graphics restoration fails, the existing recovery panel retains its explicit reload action even while menu recovery remains pending.

`apexDiagnostics().pageLifecycle` exposes the suspended state and page epoch for later browser evidence. This is an observation field, not proof of native cache admission.

### Retained Festival

The narrow `src/session/free-roam.ts` addition is `setPageSuspended(boolean)`. It uses the existing pause/control owner, sends neutral controls, resets `lastTime`, stops sound and keeps the world paused on return. Input/unpause transport is rejected while suspended. Fast travel captures its starting page epoch; a completion delivered after pageshow stays paused even though the temporary suspension flag has cleared.

Festival frame scheduling was left to the subsequent scheduling owner; this assignment adds only its early suspended-page guard. Ownership of `free-roam.ts` was released after the lifecycle regressions passed.

### Input and menu audio

The coordinator approved two additional narrow lifecycle boundaries:

- `InputController.suspendForPage()` resets both ordinary controls and the action-edge baseline. Normal pause/resume still preserves its prior button-edge behavior. A held Pause button first observed after a page return cannot resume driving, including when pageshow runs before visibility restoration.
- `UiSounds.suspend()` releases the current context, cues and graph while retaining the event owner. Main's cue settings mute requests while suspended/disposed. A pending old context activation owns no remaining voice after suspension. The next explicit cue may create a fresh context normally.

The existing five host extraction fixtures received only the new page-waiter state and page-listener cleanup expectations. The Festival lifetime fixture's vehicle mock now includes the specification export read by the production neutral-controls import. No behavior under test was replaced.

## Production regressions

`tests/engine-page-lifecycle.test.ts` extracts complete production methods and the actual constructor registrations, replacing only lazy imports and platform/rendering boundaries. It uses the real startup owners, input pump, controller action handling, Festival control owner, replay/grid/live clocks and settings transaction.

Its 28 cases cover:

- Retained moving circuit, final worker snapshot acceptance, fresh restored draw interval, no away input/start/action and a new explicit resume.
- Old cancelled RAF delivered both while away and after restoration; duplicate hide/show delivery; one RAF and one input interval after return.
- A controlled RAF identifier of zero across duplicate scheduling, hide/show and terminal teardown, without losing cancellation or old-epoch rejection.
- Menu, paused, replay, pregrid, results and photo restoration, including a completed automatic grid presentation and unchanged replay position.
- Cancelled Festival import/preparation and late loaded/driving/audio callbacks.
- Circuit cancellation during audio activation, lazy worker import, first-worker readiness, graphics warming and record preparation.
- An abandoned renderer candidate finishing after a new restored renderer has been adopted.
- Settings preparation and persistence finishing after restoration without closing the editor.
- Failed renderer restoration with an accessible reload action.
- Retained Festival and a pre-navigation travel completion arriving after pageshow.
- A pending flashback completing without automatic resume.
- Real controller held-Pause baselining without a blur/visibility-order assumption.
- Real menu cue graphs released during audible playback and pending activation, followed by fresh cue usability.
- Initial-load waiter settlement and terminal disposal exactly once, both directly and following retained navigation.

## Verification executed

Commands invoked tools directly with one Vitest worker; no npm asset hooks, Git actions, full build or browser launch were used.

| Focused execution | Result |
| --- | --- |
| Page lifecycle + Festival session lifetime | 55 passed across 2 suites at that checkpoint (21 + 34) |
| Page lifecycle, cross-mode startup, circuit settlement, host failure cleanup, resource integration, preview cancellation, input-controller lifetime, front-end sound | 159 passed across 8 suites at that checkpoint (page lifecycle then had 24 cases) |
| Final page lifecycle suite after delayed-module and failed-restoration/reload cases | 26 passed |
| Coordinator follow-up: nullable RAF ownership, including identifier zero | 28 passed in the focused lifecycle suite |
| Scoped ESLint on edited host, controller, menu audio and affected tests | Passed |
| Scoped TypeScript syntactic/semantic diagnostics for main, controller, menu audio and lifecycle test | 0 diagnostics |
| Scoped TypeScript recheck for the nullable-RAF follow-up | Process killed with exit 137 before producing diagnostics; no result claimed for this recheck |

The executed suite union contains 197 distinct passing cases. The coordinator's later aggregate gates remain authoritative.

## Native browser limit

This is deterministic host callback/state and owned resource evidence. It does not establish that a browser admitted this application to its back/forward cache, retained its WebGL/worker/audio resources, or restored real pixels/audio. Local browser launch was blocked for this work; no bypass was attempted.

The native away/Back test remains assigned to the later browser wave. It must explicitly record `pageshow.persisted === true` and verify the same retained application instance; a normal reload cannot count as successful restoration. The installed Playwright Chromium defaults contain `--disable-back-forward-cache` in `node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js`, so that fixture must deliberately account for this default and report actual cache admission rather than infer it from Back navigation alone.
