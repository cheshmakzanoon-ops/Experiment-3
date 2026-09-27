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
