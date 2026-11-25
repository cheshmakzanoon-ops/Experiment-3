# W08D — independent input, UI and audio review

Assignment **46/60**, wave 8. Reviewed against original commit
`350119e8ec0606e8c5de5b3ab80df41104025679` and candidate
`6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`. This review found and repaired one
concrete reentrant UI ownership defect, with coordinator authorization. The
numerical audio changes preserve their documented contracts; their measured
first-use and inactive-path costs remain part of the acceptance decision.

The review read `PLAN.md`, W03A, W03E, W04A, W04B, W05D, W05E, W06D, W06F,
W07D, the actual original/current source differences, relevant owners and
existing regression cases. Production was read-only while establishing the
finding. No child agents, authored content, model, character, environment,
sound recipe, vehicle tuning, dependency or Git mutation were involved.

## Ranked findings

### 1. Medium: a superseded modal opening can publish or orphan listeners

**Reproduced and repaired.** `Interface.modalContent()` checked `disposed`
before and after releasing old modal resources, then invoked several
synchronous callback boundaries without checking its ownership again.

The new narrow regression, `tests/engine-ui-opening-review.test.ts`, executes
the real `Interface.modalContent()`, `Interface.dispose()` and
`bindFirstRun()` implementations. Browser DOM/focus delivery is controlled;
the binding itself and its actual `AbortController`/`EventTarget` listener
registrations are not replaced. Three witnesses dispose the owner during:

1. The dialog's `showModal()` focus boundary.
2. Delivery of the synchronous `motobound:cue` opening notification.
3. The first-run binding's own initial focus operation.

All three failed at the reviewed candidate: the root UI event signal was
aborted and `disposed` was true, yet **three first-run listeners remained
registered with a live signal**. The terminal owner subsequently received a
new `firstRunBinding` reference. Calling `dispose()` again cannot release it
because the method is already terminal.

The third witness is a distinct publication hazard within the same defect:
`bindFirstRun()` installs its three listeners, focuses its initial control and
only then returns its disposer. Disposal inside that focus operation runs
before `Interface` has received the disposer. Merely adding checks after
`showModal()` and the opening cue does not cover that case. The returned
binding must be adopted only while the owner remains active, or immediately
released otherwise.

This is controlled reentrancy evidence, consistent with the callback ownership
contract already exercised by the menu/credits suites. It does not claim a
native browser naturally delivered this disposal ordering during a game run.
The regression cleans up an orphaned binding explicitly after a failed
assertion, so the negative witness does not contaminate subsequent cases.

The coordinator also requested replacement and close witnesses for these same
callback boundaries. **All three replacement variants failed** against an
initial terminal-only repair: replacing during `showModal()` or the open cue
registered six replacement listeners instead of three, while replacing during
the first-run focus left the old three listeners live and overwrote the new
binding's disposer. A seventh witness synchronously closed the modal during
first-run focus. It also failed: the dialog was closed but the late binding's
three listeners remained live. These failures establish why terminal checks
alone are insufficient.

The coordinator allocated only `src/ui/interface.ts` for the production repair.
Each modal opening now takes one operation identity before releasing old
resources. Replacement, explicit close and disposal revoke that identity.
Opening checks it after old cleanup, `showModal()`, the opening cue and the
first-run helper's focus operation. A returned first-run disposer is adopted
only by the still-current opening; otherwise it is called immediately. A
close operation also avoids closing a replacement created during old cleanup
or announcing a stale close after synchronous replacement.

`modalContent()` reports whether its opening still owns the result. The
resource-creating settings and credits callers honor that outcome, and credits
rechecks the operation after its own focus callback before creating a poller.
No authored markup, focus target, helper behavior or sound recipe changed.

The other binding in this exact opening path was inspected separately:
`bindWildcardBoard()` installs its listeners and returns without focusing or
calling a user callback. `Interface` assigns its disposer before focusing the
selected row. Disposal during that later focus therefore sees and releases the
already-owned binding. No speculative rewrite of the helper was needed.

All **seven** negative witnesses now pass. The replacement cases retain exactly
one live set of three replacement listeners, release the old binding, and then
release the replacement on disposal. The close case also opens a fresh modal
afterward and verifies its normal ownership and cleanup. The implementation
adds one private operation identity, not a new modal framework.

### 2. Advisory: retain audio gains together with their measured costs

The W07D evidence is internally consistent with the changed source. Its
candidate loudness SHA-256 still matches this review's on-disk module:
`19537125a0247ded5d1afb0992d5f9a7b4fcb4da318ec430f7ef3db045866c89`.
The retained 243,875-byte measurement record also still matches its recorded
SHA-256:
`b2f295ae8f54453247cfe50e38a654b50389a512189c91220bdb25acc9bf3791`.
This review did not rerun or trim the benchmark.

| Represented workload                   | Original median | Candidate median | Review interpretation                                                          |
| -------------------------------------- | --------------: | ---------------: | ------------------------------------------------------------------------------ |
| First full waveform, module cold       |        2.282 ms |         4.668 ms | A measured 2.386 ms first-use cost; no startup improvement claim.              |
| First active family, module cold       |        6.386 ms |         7.839 ms | A measured 1.453 ms cost, despite fewer transcendental calls.                  |
| First family with a warm basis         |        3.502 ms |         1.238 ms | Benefit after the shared initialization has been paid.                         |
| All 72 authored waveforms, module cold |       71.666 ms |        13.264 ms | Aggregate work amortizes the basis; distinct from the first-family case.       |
| 8,192 cached active normalizers        |       86.436 ms |        26.763 ms | About 69% lower elapsed arithmetic cost for this represented loop.             |
| 4,000,000 zero-gain normalizers        |       71.060 ms |        74.738 ms | A retained 5.2% local regression, approximately 0.92 ns per call in this loop. |

The fixed **655,360-byte / 640 KiB Float64 payload** is one module-owned
allocation after full-length waveform use. Headers, existing profile cache
entries, graph objects and total retained heap are not included in that number.
The module retains the table for its own lifetime. It is not released when an
audio context is suspended or disposed; this is deliberate because it contains
only context-independent mathematical values.

The independent-median table does not justify an overall engine speedup
percentage. The retained pair data show all eight active-update pairs improving,
all eight first-waveform and zero-gain pairs worsening, and seven of eight
first-family pairs worsening. There is no threshold calculation in this review
that estimates game startup, frame rate, physical playback or device latency
from these arithmetic workloads.

**Recommendation:** retain the coefficient reuse and bounded basis, disclose
the first-use/memory/inactive-path tradeoffs, and keep any future lazy-basis
policy change as a separately measured optimization. There is no numerical or
resource-ownership defect here that would justify an unmeasured redesign.

### 3. Acceptance boundary: native audio passed; the modal repair awaits its CI

The exact native Web Audio input/bounded PCM case and both native device
ownership cases passed at `6a1c76f`, workflow `45579529295`. The coordinator's
subsequent exact-source workflow **45585197376 at `6cb1c881`** also passed the
corrected native UI-audio lifecycle case. That checkpoint passed 820 focused
unit cases, full typecheck/build and 46 of 47 native cases; its remaining
failure is the separately investigated software-raster oracle, outside this
review. It is not an all-green repository claim.

The passing UI-audio attachment is
`evidence/checkpoint-6cb1c88/native-audio-advancement-suspension.json`:
26,499 bytes, SHA-256
`81c0db417f1b4407f476f539977eb95276742a25caa65afc924c95cd7d69f430`.
Direct inspection confirms three final closed contexts, exactly one fulfilled
close per context, all 10/10/17 observed nodes disconnected, no source
handlers, no cue owner, and no playback count increase after terminal disposal.
It records six old callbacks before and six after native replacement completion;
the discarded resume remains observed without being a required close barrier.

That native evidence predates this assignment's new modal repair. The repair
has the focused local evidence below and must pass the coordinator's next
exact-source integration gates before receiving a new native acceptance claim.

The prior UI failure was localized to an abandoned native `resume()` promise
that remained pending after its context's native close had fulfilled. The
correction requires the old closes to fulfill and the replacement's actual
native `ended` events to complete, while observing the abandoned resume rather
than waiting for it. It also preserves the explicit old-handler deliveries,
source/node counts, replacement ownership and terminal cleanup checks. No
production audio change, wider timeout or numerical tolerance is needed to
address that fixture error.

## Input and callback ownership review

| Owner                              | Reviewed boundary                                                                                   | Assessment                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MenuGamepad`                      | Focus, visibility, page, selected controller values, scope and persistent-modal content replacement | Fresh samples establish a button baseline. Held directions must reach neutral before navigation/repeat. A reused mutable gamepad object cannot hide an index/id/mapping change because values are copied.                                                         |
| `CreditsGamepad`                   | Independent focus/page/device ownership while menu navigation yields the credits modal              | Baseline, navigation-neutral gate and prior button set are independent of the driving controller. B/Start still take precedence over A.                                                                                                                           |
| Both pollers                       | Pagehide, pageshow, repeated disposal and controlled stale RAF delivery                             | Nullable handles preserve identifier zero. Callback generations prevent a cancelled old callback clearing or restarting the replacement loop. Scheduling checks reject terminal owners.                                                                           |
| `InputController.suspendForPage()` | Retained-page action and ordinary-input ownership                                                   | Resets `ControllerActions` in addition to ordinary controls, shift queues, keys and captured touch input. Normal pause/resume policy remains separate.                                                                                                            |
| `Interface.dispose()`              | Independent resource cleanup, failure and reentry                                                   | Detaches owner fields first, attempts all cleanup branches and rethrows the first failure afterward. Settings listeners share the settings abort signal; the resize callback checks terminal state. Opening-time late publication is repaired as described above. |

The reentrancy checks after menu/credits actions preserve remaining-sample
ownership rather than postponing suppressed buttons. Active scope is compared
again after user callbacks. Page reset and explicit disposal cancel pollers;
ordinary hidden/unfocused polls may still execute their reset path until the
browser next delivers a frame, so this review does not claim zero background
CPU in every focus state.

The existing native device fixture uses actual DOM, dialogs, RAF, trusted focus
transitions and form submission, with scripted `navigator.getGamepads()`
samples. It is useful evidence about ownership at that boundary. It does not
certify physical gamepads, reconnect drivers, OS focus behavior or controller
latency. The host's native retained-page fixture likewise proves its recorded
fixture restoration; it does not establish whole-game BFCache eligibility.

## Audio arithmetic and cache review

The low-pass coefficient pair is local to an active `loudnessScale()` call and
shared only among that call's bands. The same `Math.cos(w)` and `Math.cos(2*w)`
values feed the original three biquad expressions. Numerator/denominator
arithmetic, harmonic accumulation, the inclusive 20 kHz bound, cutoff clamps,
tiny-power behavior and normalization clamps remain in their original order.
Inactive gains do not read the profile or initialize waveform data.

The basis preserves the original `(i / 2048) * Math.PI * 2` angle and
`Math.sin(k * theta)` values as Float64, and preserves each waveform's ordered
Float32-coefficient multiplication and JavaScript-number accumulation. Short
cold spectra use the original scan; short warmed spectra reuse only existing
columns; spectra longer than 40 always use the original full scan. There is no
growth or input-history retention. The existing waveform `WeakMap` remains
keyed by profile identity, including its documented preexisting behavior for
mutating an already-cached profile.

Reviewed exactness evidence includes W03A's 28,755 actual-baseline comparisons,
W04A's authored/seeded/edge spectra and cache-allocation assertions, and W05E's
actual-source 487,954-byte composition record. The composition observation
digest is
`2f0476466eacd6a2bb5fced0c8f912fa9f699692d3f6b8e5c0f2c9be3f09ec14`;
it follows direct deep and byte comparisons rather than replacing them.
Native `PeriodicWave` objects remain owned by their own context. Sharing the
numeric basis does not share native wave/node objects across graph lifetimes.

The native PCM contract is correctly distinguished from exact supplied inputs.
An original-versus-original control already differed at the mixed output, so
the represented DSP output is not claimed bit deterministic. The fixed
`2*gamma_11` budget, same-implementation controls and real extra-gain rejection
provide scoped acceptance evidence; the output-scaled budget is not a general
worst-case theorem for arbitrary cancellation or time-varying filters. Neither
that software-backend evidence nor controlled context-rate metadata proves
physical acoustic equivalence.

`UiSounds.releaseContext()` snapshots the old context, nodes and cue closures,
then clears current ownership, noise and repeat state before cleanup. Old ended
callbacks retain their own branch and idempotent cancellation guard. Resume
and close promises do not contain a continuation that adopts a replacement
context or schedules an abandoned cue. A deliberate later cue starts from the
new context's time origin; stale branch cleanup cannot delete that new branch's
distinct cancellation function. No additional production defect was found in
these reviewed suspension/replacement paths.

## Verification and acceptance

Negative witness executed after the coordinator released the network timing
reservation:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-ui-opening-review.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Result before repair: **3/3 terminal-disposal cases failed**, each reporting
three live first-run listener registrations after terminal disposal. Against
the first terminal-only repair, the added three replacement cases and one
close case failed while the original three passed. These negative results
remain explicit rather than being presented as passing runs.

After the authorized repair:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-ui-opening-review.test.ts \
  tests/engine-menu-gamepad-lifecycle.test.ts \
  tests/engine-device-lifecycle-composition.test.ts \
  tests/front-end-board.test.ts tests/first-run.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Result: **106/106 passed across five files**, comprising 7 new opening cases,
42 menu/credits/interface cases, 13 device composition cases, 34 front-end board
cases and 10 first-run cases. Existing tests and assertions were unchanged.

The final seven-case test was then rerun after strengthening its return-value
and fresh-after-close assertions; all seven passed again. Scoped ESLint passed
for the changed production file and new test. Prettier passed for the new test
and this report; the existing production file formatting was preserved.
`git diff --check` passed for the production patch.

A TypeScript AST inventory compared every string and template token in
`Interface` against the exact pre-repair `6cb1c881` file: **all 1,413 tokens
match exactly**, including the authored markup. The inventory SHA-256 is
`71db141195d043781a57c50c55b853e2ff8caae26a69c82027af7f9889c91ef1`.
Both changed TypeScript files parse without diagnostics; this is a syntax check,
not a claim of a new full typecheck.

**Recommendation:** accept the narrow modal ownership repair and retain the
reviewed input/audio improvements with the recorded tradeoffs. The native
UI-audio result is now resolved at `6cb1c881`; the new modal repair remains
subject to the coordinator's next exact-source integration gates. No new
audio arithmetic or input-owner defect was found in this review. No full
compiler/build, npm lifecycle hook, local browser launch or performance rerun
was used.
