# Aurel race clarity — service optics and recorded-scene radiance

Base: `f1d90682b7a895f9558a552102887c80a4b2168a` on `main`, tree
`8835f94f98dfcfefa10d31a000b80798310f9423`. Its complete ordinary CI run
`36280327889` passed before this work. That success does not certify this increment.

This is an implemented race-quality continuation, not complete Phase 27,
final character art, human Section 146 approval, hardware certification or Steam
readiness. The existing authored assets, tyre-surface work, simulation, audio,
input, saves, dependency lock and ordinary workflows are retained unchanged.

## Baseline evidence and selected repairs

The baseline's `browser-validation-8-of-8` artifact contains normal-resolution
whole-lap/reference views and populated pit/replay evidence. The pit-removal PNG
`697e98e322fdef78f641740d079a78135f9b4f41.png` shows the service far too small
behind a foreground fence. Existing numerical framing checks established only
that the subject fitted; they did not require a useful size on screen. Inspection
of the corresponding source also exposed distance-only crew detail selection,
double attenuation of captured local lighting, and player-only reflection owners.

### Readable pit service without hiding the circuit

A stopped service now uses a telephoto lens sized to the existing complete crew
sphere, retaining its angular safety margin. Ordinary moving-car and pack lens
rules are unchanged. A paused composition change immediately presents its proper
lens; it does not require resuming the simulation to finish a zoom.

The pit-facing physical platform (rig 1) is permanently 1.5 metres taller, from
3.4 to 4.9 metres above the road sample. Visible camera infrastructure uses that
same authored position. No camera teleports, deleted fence, moved mechanics,
shortened service, altered car count or fabricated state is involved.

The 12-bay/four-aspect numerical comparison contains 48 cases. At bay 0, 16:9,
the full subject-bound diameter increases from 28.45% to 71.91% of the smaller
screen dimension, with a lens change from 25.51 to 10.23 degrees. This is a
2.53-times optical enlargement of the bound, not an actor-pixel visibility score.
All eight envelope corners remain within the tested projection margin. Separate
ray checks against actual fence meshes reproduce 108 foreground intersections
at the former height and zero at the new height. Remote empty envelope corners
can still intersect the far pit fence; this is not approval of every actor pixel.

Crew detail now includes actual lens magnification and aspect, while physical
culling remains 160 metres. An optically close service retains all 15 authored
near-cloth actors. The compared service uses six active batches both before and
after. Selected visible component geometry increases from 80,464 to 104,224
triangles; the 172,800-byte bone atlas and 10,752-byte machinery matrix storage
are unchanged. This is a component workload, not full-frame submissions or
consumer-GPU timing. No new geometry asset, texture or draw pass is allocated.

### Night reflections and exact subject ownership

A local cubemap already contains lit scene radiance. Applying the sky-only gain
again suppressed reflected lamps/scenery by 12.5 times at the 0.08 night setting.
Completed local maps now use unity gain. Only the skydome contribution receives
the authored sky gain during capture; the ordinary visible sky is restored.

During a new capture, previously probe-owned materials temporarily use their
original fallback maps and gains. The wet road therefore cannot accumulate the
preceding local reflection into the next one. Held frames retain their capture,
and rewind/explicit invalidation rebuilds the requested scene without that history.
All temporary ownership is restored on an exception, including partial mip state.

Photo subjects now own their actual car's paint and mirror targets. A same-time
subject switch releases the former car's maps, restores its mirrors, binds the
new car and captures at its real position. Disabling local reflections restores
the latest sky fallback gain, not a stale value saved before a weather change.

## Executed local validation and independent browser gate

The locked toolchain passed `npm run check`: 112 files / 1,164 unit cases,
ESLint, strict TypeScript and the production Vite build. This adds seven service
regressions and four reflection regressions to the 1,153-case baseline.
`npm run test:physics`, rotation, ten-car physical pit integration, race
classification and `scripts/phase27h6-racing.ts` also completed successfully.
The integrated-driving report passed every check, including changing weather,
real tyre service, front-aero damage, complete classification, replay and CSV.
Simulation identity remains
`0dfddbb3fd97a279d2c9875bb9d03af86c583f17fbb75641176b428d469afe3c`.
These automated driver requests are not a human-driven audiovisual Section 146 run.

The existing populated pit browser journey retains every prior assertion and
adds actual rendered lens occupancy and near-cloth checks. New
`e2e/32-race-clarity.spec.ts` adds a production-reflection GPU comparison and an
ordinary 1440x900 eight-car wet-night photo-subject journey. It checks gain,
held/rewound pixel identity, warmed resources, real mirrors and paused return.
The controlled GPU fixture is not substituted for the existing whole-lap,
wet-night, populated-race, pit, recording or physics tests.

Local Chromium could not create WebGL2. Consequently the new browser assertions,
candidate full-game captures and visual comparison require the exact commit's
unchanged hosted CI; a native pass or a test path is not a browser result.
Historical acceptance-matrix rows are not promoted by these changes. Review the
new full-game pit and night captures before artistic acceptance; complete human
race, broad car/people/venue final art and physical-hardware measurements remain
open. Deploy only the exact successful ordinary-CI build, never tracked `playable/`.

## Hosted review continuation — prepare wet recording before grid release

Run `36285091223` for `2bf2f1cd` passed build/unit checks, physics scenarios,
wet presentation, browser shards 1–7, all four normal-resolution full-lap lighting
journeys, the populated pit journey and the new local-radiance/subject tests.
The full run nevertheless **failed**: the daylight cockpit wet-following review
ended with `Session finished` before its strict event sequence qualified.
Its best run was 2.9491958618164062 seconds, not the required three seconds.
The failed `browser-validation-8-of-8` artifact (`10921565039`, SHA-256
`f8fa2412295323563f88bc31a58fbfab5e9629e660d8ba45b575251efb2abbbc`)
retains the video, trace, screenshot and interruption diagnostics. It is not
promoted to a passing release receipt.

The trace exposes nondeterministic preparation: the test entered a running race,
then enabled AI after lights-out (the first observed AI-enabled frame is at
6.583333 seconds), changed cameras, and began recording at about 7.85 seconds.
Renderer startup and test action latency had already changed the physical race.

Both wet-following views now use the existing **PREPARE GRID START PAUSED** UI.
AI, the selected camera, and night lighting are prepared before release; actual
worker time/tick must remain zero through preparation and its PNG capture. The
recorder starts before the ordinary resume action. The first live diagnostic is
still attached, but its extra synchronous screenshot moves to the paused grid;
continuous live video and qualified/complete images remain. Exported reports
must independently prove a recorded grid launch and at least three seconds of
same-leader, loaded-contact-water, real-emitted-spray following.

No runtime, shader, geometry, physics, frame protocol, render resolution, car
count, service timing, qualification threshold, timeout, retry count, dependency
or workflow is changed by this preparation repair. The same five workloads and
all other browser gates remain. Normal-resolution footage is still independent
of this 640x400 functional workload (320x200 buffer for cockpit).

Three new production-simulation/component regressions start the real eight-car
wet race before release and sample it at 2 Hz, 1.5 Hz and irregular subsecond
intervals. Physics still advances at 120 Hz. Each qualifies real following before
60 simulated seconds, rejects held-frame progress, and rejects a control with no
leader spray. These are not WebGL or consumer-hardware tests. The repaired
source requires its own complete hosted run and exact-release deployment.

This continuation's local `npm run check` passed: 113 test files / 1,167 unit
cases, lint, strict TypeScript and the production build. This count belongs to
the preparation repair, not to the earlier failed hosted run. The Vite warning
about large existing application chunks remains; no performance limit was raised.

## Render-qualified replay inspection

The preparation repair `e38559e6` passed both wet-following views, all four
normal-resolution full-lap views and browser shards 1–7 in run `36289477897`.
The full run still failed on the populated pit replay's displaced-wheel check.
Its preserved shard-8 artifact is `10921954885`, SHA-256
`dc9f0e007d6d6769079d74954e2525038ccea4f8e03be4b7431ebac4b6f00c21`.

The coarse session recorder's last phase-3 row was simulation time 116.866669,
service clock 1.4 seconds. The actual replay had a 0.094667-metre jack height and
692–841 N remaining wheel loads. Zero outward wheel offsets were correct: the
real presentation prohibits removal above 50 N. A phase label alone therefore
was not a valid locator for this assertion. The trace also shows the seek range
acknowledging its position while the last rendered view still showed pit exit.

The existing replay helper now waits for the requested absolute time to be
presented, rather than treating range acknowledgement as a rendered receipt.
The pit journey uses a decoded phase-3 clock to locate interior removal (2.0 s)
and installation (2.6 s) inside the same actual recorded service. These are
ordinary UI seek requests, not replacement snapshots or animation overrides.
The removal-offset assertion is retained and installation additionally requires
phase 4 with displaced wheels. Full crew, magnified lens, framing, pose reuse,
held/rewound equality, all cameras and no-error assertions remain unchanged.
Three regressions preserve the failing loaded sample, prove cadence-independent
clock anchoring, and reject corrupt or nonservice anchors. Loaded hubs still
cannot move even at the selected later clock.

Image inspection also rejected the first `night-eight-car-local-reflections.png`
from the preceding captures as a night-art receipt: its requested mode was night,
but its busy render queue still displayed daytime. Later selected-car/return
images were night views. The existing photo test now requires an advanced
presentation frame, four actually active night lights and a refreshed reflection
probe before taking that first image. No runtime or default quality is changed.

These test-only corrections preserve every game asset, shader, physics value,
workload resolution, opponent count, threshold, timeout, retry and CI dependency.
Their own full hosted suite and deployment must pass independently. Human art,
continuous manual Section 146 and representative physical hardware remain open.

Local `npm run check` for these corrections passed 114 test files / 1,170 unit
cases, lint, strict TypeScript and the production build. The seven production
files remain byte-identical to the preceding candidate; browser-test correctness
and complete source-specific CI still require a new hosted run.
