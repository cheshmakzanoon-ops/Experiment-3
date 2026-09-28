# Supplied-player render budget continuation

Current continuation base: `80e44dc95117b14bc2d3ee9e6466b4b99f86ec58`.
Earlier rendering work began from `52e4b2215bdbb12449ff8279c3889d95ee2cf21c`.

## Delivered changes

The RB19/R06 source, high-detail representation, rig, textures and simulation
remain intact. Existing source-derived lower tiers, imported texture budgets,
single-pass decal sheets, camera/LOD corrections, vectorized fog and gated
publication are retained. The current addition reorders only opaque triangle
submission to improve vertex reuse. It does not reduce triangle counts or
change simplification tolerances, vertices, UVs, skinning, materials, cameras,
lighting, simulation timing, or transparent triangle order.

PLD2 shares identical complete index ranges only within their owning primitive;
the loader rejects partial overlaps, cross-primitive aliases, wrong counts,
corrupt hashes and invalid indices. Matching tier wrappers share one geometry
owner and are disposed once. The highest-detail original GLB is unchanged.

The independent `PLAYER_INDEX_CACHE_AUDIT.json` records the baseline derivative
hash and an aggregate oriented-triangle fingerprint. A regression recomputes it
from all 516 primitive/tier combinations of the real generated binary. Every
triangle, winding and duplicate is retained. Protected livery support surfaces
remain unsimplified. Three additional encoder tests cover permutation identity,
input validation and a reproducible locality model; three expanded loader tests
cover the baseline fingerprint, range ownership and shared geometry disposal.

| Tier | Triangles | FIFO-16 misses before | FIFO-16 misses after |
| --- | ---: | ---: | ---: |
| Efficient close | 855,654 | 992,010 | 622,914 |
| Medium distance | 814,806 | 952,099 | 595,999 |
| Distant | 797,386 | 933,925 | 583,328 |

These are modeled cache misses, not measured GPU speed or physical-device FPS.
The original high-detail tier remains 1,455,118 triangles. The generated gzip
increases from 3,906,174 to 4,213,368 bytes; no loading-time reduction is claimed.

## Measured experiments and retirement

Run `36406024237` on `d09367e` was not green: the clear-day full-lap review had
six rendered frames, and close-racing and wet-following captures did not qualify.
Source checks, physics scenarios, wet presentation and five browser shards
passed. The sky-sort correction alone did not close these full-race gates.

The extra opaque depth submission evaluated on `147df1d` passed the early GPU
pixel checks in run `36413727893`, but was 20–26% slower in the same studio:

| View | Ordinary sorted frame (ms) | Extra depth frame (ms) |
| --- | ---: | ---: |
| Front | 2664.9 | 3345.4 |
| Rear | 2768.4 | 3477.7 |
| Cockpit | 2297.1 | 2766.9 |

These synchronized samples include CPU work, GPU waiting and readback. They
are not full-race performance. The candidate was removed from normal rendering
on `80e44dc`. Its implementation and six experiment-only unit tests are now
removed entirely rather than retained as unused production code. Git history
retains the experiment; no release-critical application test is removed.

The exact-zero decal coverage optimization on `80e44dc` retained identical
front/rear/cockpit comparison pixels. Its early GPU job still failed because
switching the rejected depth benchmark contaminated a later texture-restoration
comparison. That job is not labeled successful. The active fixture now compares
only the actual production paths, still requiring exact restored pixels and
bounded resources. Positive filtered alpha values and all blend/depth policies
are unchanged; non-decal, cutout, transmission and custom-blend paths are exempt.

## Validation and remaining acceptance

The local complete check passed 1,245 tests across 127 files, lint, TypeScript
and production build for this continuation. The original GLB digest is unchanged,
and the generated PLD2 binary must match its new pinned manifest on a clean build.
Original model/camera/pause/rewind/LOD pixel validation remains in the complete
browser suite; the early GPU job retains texture/material and wet-weather checks.
The complete eight browser shards, original image thresholds, frame/event requirements, timeouts,
zero retries and successful-artifact publication gate remain required.

Only the new commit's hosted results can certify its browser acceptance. Local
browser navigation is blocked by this execution environment's administrator;
Node/unit results are not WebGL evidence. Physical target-hardware profiling,
human driving and final full-race visual acceptance remain separate. A source
push is not a live deployment: publication must consume its successful release
artifact and verify the source identifier, never a parallel or failed build.

## Static draw-range continuation

The remaining failures on `ad99b6c7` include sparse full-lap observations and
unqualified close-racing/wet-following sequences. Read-only investigation run
`36494318155` measured 2665.4 ms for the supplied Low cockpit at 640x400 versus
1066.7 ms at 16x10 with the same 668110 submitted triangles. A diagnostic basic
material measured 313.5 ms; that material substitution is NOT used in the game.
These are synchronized isolated software-GPU samples, not target-hardware FPS.

The continuation conservatively trims only wholly off-frustum prefixes and
suffixes of static primitive index streams. All visible triangles and intervening
indices keep their original order, attributes, maps and material shading. Bounds
are prepared for the existing representations; no new GPU buffer or draw call is
introduced. Each main, mirror and shadow camera computes its own range, restored
immediately after submission. Skinning, morphs, instancing, displacement, custom
shader materials, modified attributes and authored draw ranges retain their
untrimmed path. Disposal restores callbacks without disposing source geometry.

Eight focused unit cases cover these boundaries. The existing actual-binary
player GPU fixture additionally requires exact unchanged front/rear/cockpit
pixels, unchanged resource ownership and fewer submitted cockpit triangles.
The five full-race failures, all eight browser shards, existing sample/event
thresholds, zero retries, physics and successful-artifact publication remain
independent mandatory gates. A source commit does not claim those gates passed.
The temporary investigation workflow is removed with the runtime publication.
