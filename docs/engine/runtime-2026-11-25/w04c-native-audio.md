# W04C — Native driving audio acceptance

Assignment 21/60, wave 4. Candidate tests only; no production changes.

## Scope

Added `e2e/engine-native-driving-audio.spec.ts` and its isolated fixture
`e2e/fixtures/engine-native-driving-audio.ts`. These extend existing fake-context
coverage of the current `RacingAudio.configureDriving` and vehicle-aware
`DrivingCueDirector` behavior; they do not claim those production changes as new
work.

Three focused native browser cases cover:

1. Disabled, zero-volume, and all-cue-types-disabled configurations perform zero
   real `Track.at` samples before startup and during live updates, schedule no cue
   automation during those updates, and produce silent cue/final-mix PCM.
2. Enabled configuration remains lazy before startup and across paused, nonhuman,
   and muted updates. The first live-human update builds one real route and samples
   its current/lookahead points. Further updates and same-track disable/re-enable
   reuse that director/route. A copied volume setting still produces the expected
   1100 Hz, 12 ms attack, 90 ms total upshift envelope after caller mutation.
3. GPR1 at 18190 RPM in sixth emits no upshift and stays silent; fifth at the same
   RPM provides an audible positive control. TC1 at 8090 RPM in third emits an
   audible upshift using its own lower shift calibration.

## Native boundary and instrumentation

Each case starts production `RacingAudio` with a real 48 kHz `AudioContext`
following a Playwright user gesture. Native AudioParam observers delegate every
recorded call unchanged. The test reads the existing private cue nodes, director,
and master output solely for observation; it never replaces their implementation.
The real `Track.at` instance is wrapped only to count delegated calls.

A small native AudioWorklet records first-channel peak, RMS, sample count, and
finiteness at the existing cue output and final master output. Its own output is
silent and the production graph keeps its original destination. Recording occurs
on the audio thread so delayed browser tasks cannot miss a 90 ms tone. Silent
native buffer sources provide render-time barriers; the native clock is not
overridden. Public zero bus sliders isolate the accessibility path while all
production voices/buses remain present.

Every successful scenario asserts a running-to-closed context lifecycle, one cue
oscillator stop across repeated disposal, released cue track/director/synth
ownership, unchanged supplied frames, protocol compatibility, and no captured
unhandled rejections or page errors. The fixture uses scripted full protocol
snapshots, not a running physics worker. It does not certify stereo behavior,
physical speakers, perceptual loudness, or broader game audio.

## Validation status and recovery

**Formatting, static bundling, full typechecking, and native execution are pending.**

The initial two TypeScript files were successfully written with `apply_patch`.
The workspace then became unavailable when the scoped Prettier/esbuild validation
call started. The tool returned:

> exec-server transport disconnected; failed to resume exec-server session:
> recovery timed out after 45s

No successful formatter or bundler result was returned. No browser was launched,
no local socket restriction was bypassed, and no full compiler/build/wide test run
was attempted.

At the coordinator's explicit direction, the candidate sources were recovered
from the prior patch text, with manual formatting only, into one unreferenced
Git tree containing exactly the two assigned sources and this report. No commit,
branch, or ref changes were made by this worker. Hosted CI must perform formatting,
fixture bundling, full typechecking, and the three native cases before acceptance.

The rendering `GuideRoute` module is an existing read-only dependency; no protected
rendering, simulation protocol, main entry point, assets, or other assigned files
were modified.
