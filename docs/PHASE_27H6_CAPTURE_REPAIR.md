# 27H.6 — render-buffer assertions and slow live-frame effects

Parent source: `ea334048d277b256336c009ddcf643ceba605d8d`,
tree `9f6b69b11d501c8cafe411189fd1768ec3279edd`.

The first complete menu-repaired preflight, run `36181546763`, passed lint,
1,090 unit cases, TypeScript, build, matrix, both production-menu browser cases,
the numerical scenarios and seven browser shards. The last shard exposed
two independent integration defects. This continuation retains all of that
source, including the successful bounded, scrollable menu.

## Correct dimensions without changing rendering quality

Six race checks completed their genuine event-qualified recordings before
mistaking the viewport width for the report's drawing-buffer width. A 640x400
CSS viewport with Low resolutionScale 0.75 and devicePixelRatio 1 renders at
480x300. Reports already correctly record physical render-buffer dimensions.

The assertions now independently check the unchanged 640x400 viewport, actual
device pixel ratio, the exact 0.75 scale, the calculated physical dimensions,
and the real canvas buffer. No production report semantics, graphics preset,
race condition, time limit or event acceptance is weakened.

## Bounded presentation after a slow live frame

The default-quality wet-night trace contained 83 forward presentation gaps
above two seconds among 84 observed positive gaps; its final frame time was
about 2.82 seconds. In 241 diagnostic observations the car satisfied the
existing wet-following geometry and wet-contact conditions, but every particle
count remained zero. EffectPlayback treated each slow frame as a seek and
cleared its pool without advancing emissions. The GPU, not simulation, lagged.

The renderer now explicitly distinguishes live presentation from replay.
A slow live frame reconstructs only the last two observed simulation seconds
using the existing presentation interpolation and at most 60 integration
steps. Older trails are discarded and cumulative-work baselines start at that
window, avoiding an unbounded catch-up burst. Omitted seconds and bounded
catch-up counts are exposed in diagnostics. This is a bounded visual
approximation between two actual snapshots, not reconstructed physics history
and not a performance claim. The latest state, contact loads, water and weather
remain authoritative. No new particle pool, emitter or graphics resource exists.

Replay retains its conservative gap-reset behavior. Rewinds, explicit resets,
inactive views, first observations and unchanged paused snapshots still cannot
create fabricated trails. Existing tests are retained, with six new cases
covering long live gaps, bounded work, source immutability, pause, reset, replay,
dry contacts and disabled effects.

## Validation and remaining boundary

The follow-up workflow must validate the exact new source with all existing
browser and numerical cases before activation. The previous seven green
shards are not relabelled as proof for this change. The wet-night test keeps
its original default graphics, opponents, actual spray predicate and timeouts.
No final-art, reference, physical-hardware or Steam acceptance is granted.
