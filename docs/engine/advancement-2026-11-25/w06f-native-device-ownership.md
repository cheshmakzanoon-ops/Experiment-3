# Wave 6 — native device ownership acceptance

Assignment **36 of 60**. This contribution adds two browser acceptance cases for the existing `MenuGamepad` and `CreditsGamepad` implementations. It changes no production source, application content, controls, navigation geometry, character models, environments, or assets.

## Coverage and boundaries

The fixture imports the real production classes. Dialogs, focus transitions, scrolling, clicks, form submission, event registration/removal, animation-frame scheduling, callbacks, and timestamps use the browser's actual implementations. Instrumentation forwards native requests and callbacks unchanged and records which production owner created them.

The device boundary is explicitly scripted: the fixture supplies `navigator.getGamepads()` samples with a controller identifier, button states, and a vertical axis. Changing the identifier at index zero models device replacement; it does not establish physical controller behavior. No synthetic focus, visibility, page-transition, or gamepad DOM events are dispatched. These cases make no BFCache, physical hardware, GPU, audio, frame-rate, or end-to-end game-performance claim.

The first case moves focus through a real input inside a child iframe within the modal dialog. Placing that iframe inside the dialog keeps it eligible for interaction while the dialog makes the rest of the page inert. The case requires trusted browser blur and focus events. Controller-driven `HTMLElement.click()` is expected to produce an untrusted click, and its attribution is asserted separately from the trusted pointer/focus interactions.

## The two cases

| Case                                                | Behavior asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native focus and controller replacement             | A real pointer opens the credits dialog. Held A, B, Start, Down, and an axis direction do nothing while a child frame owns focus and after focus returns. Neutral input followed by fresh A activates the focused control once; fresh Down scrolls the real list. Replacing the controller identifier while actions are held establishes a new baseline without closing, activating, scrolling, or submitting. A fresh Start closes credits; the same held Start cannot submit the newly restored menu. Neutral followed by fresh Start calls the actual form submission path and produces a `SubmitEvent` with the expected submitter. |
| Content replacement and reentrant owner replacement | A, B, and Start are sampled together in a generic dialog. A replaces the dialog content, and the remaining actions cannot affect the replacement in the same sample or while held. Fresh A after neutral reaches the replacement control. In credits, A synchronously disposes and replaces its own `CreditsGamepad`; the old owner releases its resources, the new owner baselines held A, and only a fresh A activates it. Fresh B closes that replacement. Repeated disposal is idempotent.                                                                                                                                          |

After disposal, the first case performs actual iframe focus, pointer, and keyboard interactions, then supplies held controller input. It requires no additional gamepad reads or actions and checks that the retained focus-ring marker is not removed by stale root event listeners. Both cases wait for native frames after release and verify owner resource accounting.

## Evidence and resource accounting

Each case attaches JSON even if an assertion fails:

- `native-device-focus-ownership.json`
- `native-device-content-ownership.json`

The attachments contain named checkpoints, action and submission counts, controller read counts, actual focus-event trust flags, click attribution and trust flags, active element, dialog state, scroll position, owner generations, and JavaScript page errors. Their boundary labels explicitly state that controller input is scripted and physical controllers and native history are not validated.

Per-owner records include scheduled, delivered, and cancelled animation frames; the maximum simultaneous pending count; duplicate timestamp deliveries; frames scheduled or delivered after release; and remaining listener/frame counts. The owner label propagates through actual RAF callbacks so a reentrant replacement can reveal an old owner scheduling work after disposal. Helper checkpoint frames use the captured native RAF directly and are excluded from production-owner accounting.

The asserted live resource counts are one pending RAF and eight registered listeners for the menu owner, plus one pending RAF and six listeners for each active credits owner. Replaced or disposed owners must retain zero of each. Every owner must have a maximum of one pending frame, zero duplicate-timestamp deliveries, and zero frames scheduled or delivered after release. These are authored acceptance assertions, not measured native results until CI executes the cases.

Cleanup restores the original RAF and cancellation functions, event registration/removal methods, and `navigator.getGamepads` descriptor. The final snapshot verifies restored function identities as well as zero remaining owned resources. Helper listeners are released with their abort signal.

## Local verification

| Check                                                | Result                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| esbuild browser fixture bundle                       | Passed; 582,730 bytes, 120 static inputs, no `import.meta` in emitted output.                                                                     |
| Playwright discovery                                 | Passed; exactly two cases in the new spec.                                                                                                        |
| Scoped TypeScript semantic and syntactic diagnostics | Passed; zero diagnostics for the two owned TypeScript files, using repository compiler options and `src/build-flags.d.ts`.                        |
| ESLint                                               | Passed for both owned TypeScript files.                                                                                                           |
| Prettier                                             | Passed for the spec, fixture, and this report.                                                                                                    |
| Native browser execution                             | Pending root-managed CI. Local Chromium execution was not attempted because the environment's browser socket restriction was already established. |

The bundler reports `empty-import-meta` from the existing optional asset helper in `src/rendering/assets/third-party.ts`. Tree shaking removes that unused helper from this fixture's emitted output. No production change or replacement asset path was introduced to suppress the warning.

Local checks used the repository's installed tool entrypoints directly: `node node_modules/eslint/bin/eslint.js`, `node node_modules/@playwright/test/cli.js test e2e/engine-native-device-ownership.spec.ts --list`, the esbuild JavaScript API, the TypeScript API scoped to the two owned files, and Prettier. No npm hooks, full production build, full compiler run, or local native browser launch was performed by this assignment.

## Files

- `e2e/engine-native-device-ownership.spec.ts`
- `e2e/fixtures/engine-native-device-ownership.ts`
- `docs/engine/advancement-2026-11-25/w06f-native-device-ownership.md`

The work extends the menu lifecycle, page lifecycle, and device lifecycle composition changes documented by assignments w03e, w04b, and w05d. It leaves existing native input and native history suites intact. Root owns native CI verification, integration, and publication.
