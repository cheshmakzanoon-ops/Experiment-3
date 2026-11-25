# W08C — independent audio and input review

Assignment **45/60**, wave **8**. Review date: **2026-11-25**.

## Decision and exact scope

**No blocking regression found in the four reviewed production changes.** Their
ownership boundaries and their focused acceptance evidence support retaining
them. This is an independent source-and-evidence review; it introduces no
production changes and does not claim a new execution.

The reviewed candidate is
[`92e2dc2ed2f4959011bb84816e90506cefed774d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d).
Each production file was fetched at that revision and compared with the session
baseline,
[`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc).
The review also read the focused tests, native audio fixture/specification,
radio probe and shared probe loader, existing vehicle definitions, and relevant
host call sites. Host and catalogue reads were reference-only.

| Production scope | Reviewed change |
| --- | --- |
| [`src/core/radio.ts`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/core/radio.ts) | Own eight previous transition values instead of a copied packed frame |
| [`src/input/controller.ts`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/input/controller.ts) | Re-arm the fault notification when an unsuppressed device owner is acquired |
| [`src/audio/driving-cues.ts`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/audio/driving-cues.ts) | Resolve cue RPM and final-gear eligibility from recorded vehicle identity |
| [`src/audio/engine.ts`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/audio/engine.ts) | Defer driving-route creation until enabled live human use; release its ownership on disposal |

The coordinator subsequently integrated unrelated storage, event-loop and
native-worker-idle work in `e2d1fec2ff3b38a2cf962e9974cfe0622259823b` and reported
these audio/input paths unchanged. This review remains pinned to the source and
executed evidence above; it does not certify later whole-source composition.

## Radio history and buffer ownership

The baseline reads exactly eight prior values: car count, safety-car phase,
local flag, cumulative penalty, warnings, pit state, completed laps and fuel.
The replacement stores those values in one reusable object and snapshots the
seven previous transition scalars into local variables before capturing the
current frame. The car-count comparability decision also precedes capture.
This preserves the old order in which the new observation becomes history
before message arbitration begins.

The source comparison found no changed caption text, message key, urgency,
expiry, hold, posting order, engineer muting, cooldown comparison or queue
arbitration. First observation and changed-car-count observations still take
a silent transition baseline while advancing the current caption. Explicit
reset invalidates history without requiring stale numeric fields to be erased.
No supplied typed array or buffer is retained by the compact state.

The [40-case focused suite](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-radio-compact-state.test.ts)
covers all 11 caption variants under fresh, reused and actually transferred
buffers. Its other cases exercise simultaneous ordering, source overwrite and
detachment, car-count changes, engineer muting, reset and rewind/cooldown
boundaries. These are externally observable caption/ownership assertions,
rather than tests that only inspect the replacement private object.

The [radio probe](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/radio-probe.mjs)
uses an actual historical module loaded through
[`support.mjs`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/support.mjs).
The loader obtains the declared source with `git show`, checks that the
baseline target was loaded, builds separately instantiated bundles, records
source and bundle digests, and checks the candidate target and tracked status
during bundling. It replaces only `src/core/radio.ts`; dependencies come from
the same candidate checkout. The probe compares complete offered-message and
caption streams before producing its evidence hashes. It also asserts that
named fixtures exercise their intended offers and captions.

The accepted hosted report records **47 scenarios and 1,620 observations per
variant**, including seeded mixed events, rewinds, resets and changing car
counts. Its copy pass forwards the actual `Float32Array.slice` operation,
counts returned byte lengths, restores the prototype in `finally`, and keeps
frame construction outside the measured calls.

| Workload | Baseline slice calls / copied bytes | Candidate slice calls / copied bytes |
| --- | ---: | ---: |
| 600 observations, 1 car | 600 / 852,000 | 0 / 0 |
| 600 observations, 24 cars | 600 / 19,123,200 | 0 / 0 |
| 600 observations, 32 cars | 600 / 25,478,400 | 0 / 0 |

These are eliminated frame-slice operations and copy bytes. They do not measure
all allocations, retained heap, collection pauses, elapsed time or game FPS.
The sent-key cooldown map remains dependent on session history. Removing old
entries solely because forward time passed would change suppression after a
rewind; this review supports preserving the existing contract.

## Controller fault notification ownership

The production delta is deliberately at `observeButtons()`: after detecting
a different acquired identity and before installing the new held-button
baseline, it clears `lastFault`. Both `update()` and `pollActions()` reject
the currently suppressed device/mapping pair before that acquisition boundary.
Therefore an ordinary reset, focus change, pause or resume cannot admit the
same failed mapping merely by clearing `lastDevice`.

A new mapping object, changed hardware identity or newly acquired resumed
action owner can now produce its own required `deviceLost` callback even when
the text matches the preceding fault. This matters because the
[host settings transaction](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/main.ts)
replaces `input.settings`; the callback is what returns the host to its paused
state after another invalid calibration attempt. The change does not alter
axis calibration, steering response, device selection, action dispatch or the
shift queue.

The [eight focused cases](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-controller-fault-retry.test.ts)
use the real controller with synchronous host-style callbacks that disable
driving. They verify repeated saved-mapping failures, unchanged-mapping
suppression through focus/resume, valid recovery, held action/shift baselines,
replacement hardware and repeated disconnects without an intervening
successful driving sample. Thus the key witness checks host pause and revoked
control publication, not just diagnostic text.

The tests supply Gamepad-shaped objects and event targets. They establish the
controller's callback and lifecycle contract; they do not establish physical
wheel compatibility, browser permission policy or device-driver behavior.
In-place mutation of a blocked mapping is still not the documented retry
boundary; replacing the mapping is.

## Vehicle cues and route lifetime

The director reads the first entrant's recorded `R.VEHICLE`, validates a
present identity before catalogue lookup and derives the maximum forward gear
from `gearRatios.length - 2`. The authored definitions retain reverse and
neutral entries before the forward ratios. A chassis-only sample with no
identity tail preserves the Formula fallback; a present malformed identity
does not silently select a different powertrain.

The cue thresholds retain the Formula ratios
`11800 / shiftRPM` and `4800 / downshiftRPM`, then apply those ratios to the
selected vehicle's authored RPM points. This changes advisory eligibility,
not transmission physics or catalogue tuning. Integral in-range gears are
required. Top gear cannot request another upshift, and a single forward gear
cannot request either shift direction. The original strict Formula threshold
comparisons, tone recipes, priority, dwell, cooldown and stale-tick behavior
remain in place.

The [34 focused vehicle cases](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-driving-cue-vehicles.test.ts)
include the TC-1 near its limiter, GPR-1 fifth/sixth gear, representative actual
gearbox sizes, an electric single-speed drive, Formula equality boundaries,
legacy and malformed samples, read-only frames, reset recovery and caution
braking priority. Invalid identity/gear/car-count rejection is a deliberate
behavior change; this review does not call all possible malformed-input
behavior baseline-equivalent.

In `RacingAudio`, configuration copies validated settings and retains the
latest track without constructing a director. Construction requires an
admitted update with a context, live human playback, unmuted audio, positive
cue volume, enabled settings and at least one enabled cue type. Same-track
configuration resets timing and silences pending tones while preserving an
existing route. Replacing the track releases the old director even when the
new settings are disabled.

Disposal clears the track/director synchronously before the pre-context early
return or an asynchronous context close. The close continuation has no later
write to those fields, so it cannot erase a newly configured replacement.
`stop()` continues to retain configuration and reset cue timing. Reuse after
disposal requires fresh driving configuration; that boundary is explicitly
tested.

The [nine lazy-route cases](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-driving-audio-lazy-route.test.ts)
count real `Track.at` calls through the actual route/director. They establish
zero cold route work for disabled, zero-volume and all-types-off
configurations, and zero recurring cue-silence calls for those inactive
settings. First active use on the fixture track performs 744 route samples
plus two ordinary samples; later updates add only the two ordinary samples.
They also verify copied settings, actual cue automation, track replacement,
pre-context disposal and pending-close replacement.

The optimization removes unused cold work and moves required route
construction to first active use; it does not remove the route cost for a
driver who uses guidance. Frame validity is checked inside the director after
construction, so the claim is gated live/configuration eligibility, not that
an invalid active frame can never trigger construction. A previously used
same-track route intentionally remains retained across toggles. Neither
boundary is a blocker.

## Native evidence quality and observed gate

I independently fetched the completed
[hosted run and job log](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573/job/139287423560).
The job reports source `92e2dc2ed2f4959011bb84816e90506cefed774d`, clean tracked
probe scope, **1,135 passed unit tests across 86 files**, all six baseline
comparisons, successful type check/build and **57 passed native browser cases**
with one worker and no retry acceptance. Its focused test lines report
**40 radio, 8 controller retry, 34 vehicle cue and 9 lazy-route cases** passing.
The three native driving-audio cases also passed.

The [native specification](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/e2e/engine-native-driving-audio.spec.ts)
and [fixture](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/e2e/fixtures/engine-native-driving-audio.ts)
use the production graph in a real 48 kHz `OfflineAudioContext`. Native
suspend/resume/render calls advance the audio clock; deadlines only reject
stuck operations. Automation wrappers forward the original methods. Separate
native output channels capture a cue stem and the final mix without summing
the measurements. Public mixer controls silence other buses to isolate the
accessibility signal.

Assertions cover zero signal in inactive/final-gear windows, finite nonzero
PCM for admitted upshifts, exact cue automation, route sample counts,
same-track ownership, unmodified input frames, repeated disposal and released
graph/track references. Offline render closure is explicitly distinguished
from live hardware-context close.

The coordinator has retained the accepted job-derived evidence at
[`evidence/92e2dc2/result.json`](evidence/92e2dc2/result.json),
[`probes.json`](evidence/92e2dc2/probes.json) and
[`hosted-job.log`](evidence/92e2dc2/hosted-job.log).
This assignment reviewed the retrieved decoded job log and test sources. It
did not download or inspect the archived browser attachments, run a new test
command, exercise an AudioWorklet/hardware speaker path, or measure production
game performance.

## Integration recommendation

Retain the four reviewed changes and their existing focused/native witnesses.
Run the coordinator's exact-source gate for later production composition.
Carry forward the bounded claims above: compact radio history and eliminated
frame slices; independently re-armed fault callbacks; vehicle-correct advisory
gear cues; and avoided inactive route construction with explicit disposal
ownership. No additional speculative source edits or duplicate tests are
needed for this review.

Only this report was authored by assignment 45. No renderer, shader, host,
protocol, vehicle catalogue, model, character, environment or off-road source
was changed, and no branch or ref was updated.
