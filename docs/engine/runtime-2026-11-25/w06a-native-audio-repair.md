# Wave 06a: native driving-audio harness repair

## Reason for the change

The first hosted run of the three newly added driving-audio cases stopped at
`Native audio timeout: PCM observer module`. The common failing stage was the
test observer's `AudioContext.audioWorklet.addModule(blobURL)`, before any of the
three cases could produce their intended PCM evidence. That result establishes a
harness dependency failure in that run; it does not establish a production
driving-cue defect or prove that AudioWorklet is generally unsupported.

This repair changes only:

- `e2e/fixtures/engine-native-driving-audio.ts`
- `e2e/engine-native-driving-audio.spec.ts`
- this report

The existing device/RAF case and all production sources remain outside this
assignment.

## Production path used

[`RacingAudio.start(context?: BaseAudioContext)`](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/b3b8ec09183734287b71406f8894d07c91eb48c9/src/audio/engine.ts)
already accepts a native `OfflineAudioContext` for production-graph measurement.
Its `isLive` branch skips live-context resume/unlock and hardware closure for that
context. The existing
[native audio fixture](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/b3b8ec09183734287b71406f8894d07c91eb48c9/e2e/fixtures/engine-native-audio.ts)
also measures real browser-rendered offline PCM.

Each repaired case builds the complete production `RacingAudio` graph in a native
48 kHz, two-channel `OfflineAudioContext` with exactly 48,000 frames. Public mixer
levels set engine, effects, ambience, UI, and music to zero, as in the original
cases. Accessibility cues still traverse their normal master, filter, compressor,
make-up, and ceiling path.

The observer adds native channel splitters and a merger. The cue panner's left
channel becomes rendered channel 0; the final master-bus output's left channel
becomes rendered channel 1. The original final destination connection is replaced
by this channel routing so the cue and mix observations cannot sum. The production
cue-to-master connection, gain settings, synthesis, and dynamics are preserved.
These are separate mono stem measurements of centred gear cues, not a stereo
balance or physical-speaker test.

The fixture reads `AudioBuffer.getChannelData()` after native rendering and the
native completion event. Peak, RMS, finiteness, and sample counts are calculated
from those real samples. It contains no replacement audio context, generated
reference PCM, worklet module, clock override, or wall-clock sleep.

## Native clock and lifecycle

The initial context is suspended. `RacingAudio.start(context)` builds the graph
while the native clock remains at zero. Before rendering or resuming, the fixture
schedules the next native `suspend(time)` checkpoint. At each resolved checkpoint
it records the browser's actual `currentTime` and state, then performs the normal
production frame update.

Forty-millisecond steps exceed the production 25 ms update throttle. Audible
capture windows span 160 ms, covering the 90 ms cue. Window boundaries are taken
from actual native checkpoint times, including render-quantum quantization.
Assertions verify suspension, forward progress, render-quantum alignment, and
agreement with each requested checkpoint to within one quantum. Cue automation
must start at the same native time recorded for its frame update.

The use of native suspension and resumption follows the
[Web Audio offline-context contract](https://www.w3.org/TR/webaudio-1.0/#dom-offlineaudiocontext-suspend):
the rendering thread advances the audio clock, and JavaScript changes the graph
while that renderer is suspended. Timers only reject stuck operations after the
existing ten-second deadline. A MessageChannel task observes cleanup rejections
without using a timed sleep.

The one-second buffer finishes and closes the offline context before owner
disposal. The lifecycle report distinguishes initial suspension, suspension after
startup, closure after rendering, and ownership release by `RacingAudio.dispose()`.
It checks that repeated disposal returns the same promise, stops the observed cue
oscillator exactly once, resets owner diagnostics to `uninitialized`, and clears
the owned context, bus, track, director, and synth fields. It makes no claim that
owner disposal closed a live hardware context. Failure cleanup releases the graph
and completes any already-started finite offline render.

## Assertions retained

| Case | Required evidence |
| --- | --- |
| Disabled configurations | Disabled settings, zero volume, and all cue types disabled each retain zero `Track.at` calls, no director, no emitted cue, and no cue scheduling; rendered cue and mix are exactly silent. |
| Lazy route and reuse | Pre-start, paused, nonhuman, and muted updates do not build the route. The first enabled live-human update builds it and emits the audible TC1 upshift. Same-track configuration retains the director and route, with the original exact track-sampling counts through reuse, disable, and re-enable. |
| Vehicle gears | GPR1 at 18,190 RPM in gear 6 emits nothing and renders exact silence. GPR1 at the same RPM in gear 5 and TC1 at 8,090 RPM in gear 3 each emit one audible upshift. |

The six-call production AudioParam envelope remains mandatory: 1,100 Hz, centred
pan, cancellation and zero gain at the native update time, gain 0.35 at +12 ms,
and zero at +90 ms. Observation delegates every call to the original native
AudioParam method. Both stems still require at least 4,800 finite samples, peak
above 0.005 and below 0.85 for audible cases, and exact zero peak/RMS for silent
cases. The frame immutability, protocol compatibility, page-error, and unhandled
rejection assertions remain.

## Validation status

This repair was prepared through source inspection while the execution environment
was unavailable. No local formatting, type-check, build, or browser pass is claimed.
The prior reported 1,114 unit-test and full type/build results belong to the earlier
tree and are not validation of this repair.

The publishing owner must run hosted validation on the assembled commit. The
three existing JSON attachments now include actual checkpoint times, native
render dimensions, stem PCM summaries, delegated automation, exact route counts,
frame immutability, and the separate render/owner lifecycle. Those hosted results
will supply the direct native evidence; this report does not pre-empt them.
